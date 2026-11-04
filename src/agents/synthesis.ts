/**
 * Synthesis agent — v0.6, the sixth Praxis agent.
 *
 * Assembles the final briefing text one section at a time, respecting
 * the target format's tone directives, max_length, forbidden_terms,
 * and validation_rules. Consumes ALL FIVE prior artefacts (Scoping,
 * Research, Stakeholders, Risks, Options).
 *
 * Pipeline:
 *   1. Load `prompts/synthesis.prompt` and parse it with PromptLang.
 *   2. For each section in `ctx.format.sections[]` (in declared order):
 *      a. Build the section-specific inputs (tone directives, max
 *         words, validation rules, required agents, style guide).
 *      b. Interpolate the prompt template.
 *      c. Dispatch to `llm.complete` (no tool use — Synthesis does
 *         not add facts). Falls back to `llm.completeWithTools` when
 *         `complete` is unavailable, with an empty tool list.
 *      d. Parse the response as JSON { content_markdown,
 *         sources_cited[], validation_issues[] }.
 *      e. Post-parse the section: compute word_count, apply the
 *         format-level checks (forbidden terms, max_length,
 *         validation_rules) and append to `validation_issues`.
 *   3. Assemble the final SynthesisResult with a full
 *      `format_conformance` report.
 *
 * The synthesis agent NEVER fabricates content — the prompt is
 * explicit and the parser validates every cited source is a full
 * `SourceReference` object. Fabricated sources are structurally
 * forbidden. This mirrors the sourcing discipline enforced on
 * upstream agents.
 */

import { withRetry } from "./retry.ts";
import {
  callModel,
  extractJsonText,
  loadPrompt,
  renderPrompt,
  untrusted,
  untrustedJson,
} from "./prompt-runtime.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type {
  EditorialAttempt,
  FailedValidationRule,
  ForbiddenTermHit,
  FormatConformance,
  RevisionContext,
  SynthesisContext,
  SynthesisResult,
  SynthesizedSection,
} from "./types.ts";
import type {
  EditorialAction,
  Format,
  FormatSection,
} from "../registry/schema.ts";
import { DEFAULT_MAX_REGENERATION_ATTEMPTS } from "../registry/schema.ts";
import type { SourceReference } from "../sourcing/types.ts";
import {
  EditorialFailureError,
  InvalidAgentOutputError,
  SynthesisError,
} from "./errors.ts";

const AGENT_ID = "synthesis";

/**
 * Constrains decoding to the shape `parseSectionResponse` validates. Length
 * limits (excerpt ≤ 500 characters) are not expressible in a structured
 * output schema and stay in the parser.
 */
const SECTION_SCHEMA = {
  type: "object",
  properties: {
    content_markdown: { type: "string" },
    sources_cited: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          accessed_at: { type: "string" },
          excerpt: { type: "string" },
        },
        required: ["url", "title", "accessed_at", "excerpt"],
        additionalProperties: false,
      },
    },
    validation_issues: { type: "array", items: { type: "string" } },
  },
  required: ["content_markdown", "sources_cited", "validation_issues"],
  additionalProperties: false,
};
const PROMPT_NAME = "synthesis";
const DEFAULT_PROMPT_PATH = "prompts/synthesis.prompt";

/** How much slack to grant before flagging a section as over-length. */
const OVER_LENGTH_TOLERANCE_PCT = 0.1;

export interface ExecuteSynthesisOptions {
  /** Overrides the default `prompts/synthesis.prompt` location — used in tests. */
  promptPath?: string;
  /**
   * Attempts per section on recoverable errors. Retrying here rather than
   * around the stage means one bad section does not rewrite the others.
   */
  attempts?: number;
}

export async function executeSynthesis(
  ctx: SynthesisContext,
  llm: LLMProvider,
  options: ExecuteSynthesisOptions = {}
): Promise<SynthesisResult> {
  const promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH;
  const loaded = loadPrompt(AGENT_ID, promptPath, PROMPT_NAME);

  const sourcesByAgent = collectUpstreamSources(ctx);
  const editorial = buildEditorialConfig(ctx.format);
  const revisionBlockGlobal = buildRevisionInstruction(ctx.revision_context);

  // Each section's prompt reads the upstream stages and its own format
  // entry, never another section's text, so sections are written
  // concurrently; editorial regeneration stays sequential within a section.
  const synthesizeSection = async (section: FormatSection): Promise<SynthesizedSection> => {
    const attempts: EditorialAttempt[] = [];
    let lastReason: EditorialReason | undefined;
    let lastDetails: string | undefined;
    let acceptedParsed: ParsedSectionResponse | null = null;
    let acceptedAttempt = 0;

    // In non-strict mode, we always run exactly one attempt (v0.7 behaviour).
    // In strict mode, up to `max_regeneration_attempts` total attempts.
    const maxAttempts = editorial.strict ? editorial.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const retryBlock =
        attempt > 1 && lastReason !== undefined && lastDetails !== undefined
          ? buildRetryInstruction(lastReason, lastDetails)
          : "";
      const revisionBlockForSection = buildSectionRevisionInstruction(
        revisionBlockGlobal,
        ctx.revision_context,
        section
      );

      const inputs = buildSectionInputs(
        ctx,
        section,
        revisionBlockForSection,
        retryBlock
      );
      const rendered = renderPrompt(AGENT_ID, loaded, inputs);
      const completion = await callModel(AGENT_ID, llm, loaded, rendered, {
        tools: [],
        outputSchema: SECTION_SCHEMA,
        errorContext: `while synthesising '${section.id}'`,
      });
      const parsed = parseSectionResponse(completion.text, section, sourcesByAgent);

      if (editorial.strict) {
        const check = checkEditorialConformance(parsed, section, ctx, editorial);
        if (check.rejected) {
          attempts.push({
            attempt_number: attempt,
            reason: check.reason,
            details: check.details,
            accepted: false,
          });
          lastReason = check.reason;
          lastDetails = check.details;
          continue;
        }
        attempts.push({
          attempt_number: attempt,
          reason: "accepted",
          details: "all strict editorial rules passed",
          accepted: true,
        });
      }

      acceptedParsed = parsed;
      acceptedAttempt = attempt;
      break;
    }

    if (acceptedParsed === null) {
      throw new EditorialFailureError(
        section.id,
        lastReason ?? "forbidden_terms",
        attempts
      );
    }

    const post = postValidate(acceptedParsed, section, ctx);
    return {
      ...post,
      editorial_attempts: attempts,
      final_attempt_number: acceptedAttempt,
    };
  };
  // Settled, not raced: when one section fails, the others already sent are
  // billed, so their usage must reach the ledger before the error does.
  const settled = await Promise.allSettled(
    ctx.format.sections.map((section) =>
      withRetry(() => synthesizeSection(section), options.attempts ?? 1)
    )
  );
  const failed = settled.find((r) => r.status === "rejected");
  if (failed !== undefined) throw failed.reason;
  const sections = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

  const totalWordCount = sections.reduce((acc, s) => acc + s.word_count, 0);
  const conformance = buildFormatConformance(ctx, sections, totalWordCount);

  return {
    sections,
    total_word_count: totalWordCount,
    format_conformance: conformance,
  };
}


/**
 * A stored `SynthesisResult` (a checkpoint), checked before reuse: one
 * section per format section, in format order, each with the fields the
 * renderers read. Synthesis has no single parser for its whole output (it
 * is assembled from per-section answers), so this checks the assembled shape.
 */
export function parseStoredSynthesis(
  stored: string,
  format: Format,
  upstream: Omit<SynthesisContext, "format" | "revision_context">
): SynthesisResult {
  const knownSources = collectUpstreamSources({ ...upstream, format });
  const fail = (what: string): never => {
    throw new InvalidAgentOutputError(AGENT_ID, what, stored);
  };
  const value: unknown = JSON.parse(stored);
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("expected an object");
  const obj = value as Record<string, unknown>;
  const sections = obj["sections"];
  if (!Array.isArray(sections)) return fail("'sections' must be an array");
  const expected = format.sections.map((s) => s.id);
  const ids = sections.map((s) => (s as Record<string, unknown> | null)?.["section_id"]);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    fail(`'sections' must be the format's sections in order (${expected.join(", ")})`);
  }
  for (const [i, raw] of sections.entries()) {
    const s = raw as Record<string, unknown>;
    for (const key of ["title", "content_markdown"]) {
      if (typeof s[key] !== "string") fail(`sections[${i}].${key} must be a string`);
    }
    for (const key of ["word_count", "final_attempt_number"]) {
      if (typeof s[key] !== "number") fail(`sections[${i}].${key} must be a number`);
    }
    for (const key of ["sources_cited", "validation_issues", "editorial_attempts"]) {
      if (!Array.isArray(s[key])) fail(`sections[${i}].${key} must be an array`);
    }
    checkProse(s["content_markdown"] as string, `sections[${i}]`, knownSources, stored);
    checkMarkers(s["content_markdown"] as string, `sections[${i}]`, (s["sources_cited"] as unknown[]).length, stored);
    for (const [j, source] of (s["sources_cited"] as unknown[]).entries()) {
      parseCitedSource(source, `sections[${i}].sources_cited[${j}]`, knownSources, stored);
    }
  }
  if (typeof obj["total_word_count"] !== "number") fail("'total_word_count' must be a number");
  const conformance = obj["format_conformance"];
  if (typeof conformance !== "object" || conformance === null) fail("'format_conformance' must be an object");
  return value as SynthesisResult;
}

function buildSectionInputs(
  ctx: SynthesisContext,
  section: FormatSection,
  revisionBlock: string,
  retryBlock: string
): Record<string, string> {
  return {
    scoping_json: untrustedJson("scoping", ctx.scoping),
    research_json: untrustedJson("research", ctx.research),
    stakeholders_json: untrustedJson("stakeholders", ctx.stakeholders),
    risks_json: untrustedJson("risks", ctx.risks),
    options_json: untrustedJson("options", ctx.options),
    format_id: ctx.format.id,
    section_id: section.id,
    section_title: section.title,
    section_purpose: section.purpose,
    section_tone_directives: section.tone_directives,
    section_tone_hook: section.tone_hook ?? "(none)",
    section_max_words: String(section.max_length.words),
    section_required_agents: section.required_agents.join(", "),
    section_validation_rules:
      section.validation_rules === undefined || section.validation_rules.length === 0
        ? "(none)"
        : section.validation_rules.join("; "),
    style_voice: ctx.format.style_guide.voice,
    style_sentence_structure: ctx.format.style_guide.sentence_structure,
    forbidden_terms:
      ctx.format.style_guide.forbidden_terms.length === 0
        ? "(none)"
        : ctx.format.style_guide.forbidden_terms.join(", "),
    revision_block: revisionBlock,
    retry_block: retryBlock,
  };
}

// ---------------------------------------------------------------------------
// v0.8 — strict_editorial config, conformance gate, prompt blocks
// ---------------------------------------------------------------------------

type EditorialReason = "forbidden_terms" | "over_length" | "validation_rule";

interface EditorialConfig {
  /** Master switch — false collapses every axis to "warn" (v0.7 behaviour). */
  strict: boolean;
  /** Total attempts per section under strict mode (initial + retries combined). */
  maxAttempts: number;
  forbiddenTermsAction: EditorialAction;
  overLengthAction: EditorialAction;
  validationRulesAction: EditorialAction;
}

function buildEditorialConfig(format: Format): EditorialConfig {
  const e = format.sourcing_rules?.editorial;
  const strict = e?.strict_editorial === true;
  const maxAttempts = e?.max_regeneration_attempts ?? DEFAULT_MAX_REGENERATION_ATTEMPTS;
  return {
    strict,
    maxAttempts,
    forbiddenTermsAction: strict ? (e?.forbidden_terms_action ?? "warn") : "warn",
    overLengthAction: strict ? (e?.over_length_action ?? "warn") : "warn",
    validationRulesAction: strict ? (e?.validation_rules_action ?? "warn") : "warn",
  };
}

type EditorialCheck =
  | { rejected: false }
  | { rejected: true; reason: EditorialReason; details: string };

/**
 * Under strict mode: return the FIRST reject-action failure (or clean pass).
 * Order matters — forbidden_terms > over_length > validation_rule — so the
 * retry prompt gets the highest-signal reason to fix first.
 */
function checkEditorialConformance(
  parsed: ParsedSectionResponse,
  section: FormatSection,
  ctx: SynthesisContext,
  cfg: EditorialConfig
): EditorialCheck {
  if (cfg.forbiddenTermsAction === "reject") {
    const lowered = parsed.content_markdown.toLowerCase();
    const hits: string[] = [];
    for (const term of ctx.format.style_guide.forbidden_terms) {
      if (countOccurrences(lowered, term.toLowerCase()) > 0) hits.push(term);
    }
    if (hits.length > 0) {
      return {
        rejected: true,
        reason: "forbidden_terms",
        details: `found: ${hits.map((t) => `'${t}'`).join(", ")}`,
      };
    }
  }

  if (cfg.overLengthAction === "reject") {
    const wordCount = countWords(parsed.content_markdown);
    const overCap = Math.floor(
      section.max_length.words * (1 + OVER_LENGTH_TOLERANCE_PCT)
    );
    if (wordCount > overCap) {
      return {
        rejected: true,
        reason: "over_length",
        details: `${wordCount} words exceeds cap ${section.max_length.words} (tolerance ${OVER_LENGTH_TOLERANCE_PCT * 100}%)`,
      };
    }
  }

  if (
    cfg.validationRulesAction === "reject" &&
    section.validation_rules !== undefined &&
    section.validation_rules.length > 0
  ) {
    const acknowledged = parsed.validation_issues.map((s) => s.toLowerCase());
    const failed: string[] = [];
    for (const rule of section.validation_rules) {
      const key = ruleKey(rule).toLowerCase();
      if (acknowledged.some((issue) => issue.includes(key))) failed.push(rule);
    }
    if (failed.length > 0) {
      return {
        rejected: true,
        reason: "validation_rule",
        details: `unmet: ${failed.map((r) => `'${r}'`).join("; ")}`,
      };
    }
  }

  return { rejected: false };
}

/**
 * Build the REVISION MODE prompt block. Returns "" when no revision
 * context is present (v0.7 behaviour). The block is per-section — it
 * filters `critiques_to_address` to those targeting this section (or
 * unscoped critiques), so the model gets only the load-bearing subset.
 */
function buildRevisionInstruction(rc: RevisionContext | undefined): {
  header: string;
  alt: string;
  instruction: string;
  critiques: RevisionContext["critiques_to_address"];
} | null {
  if (rc === undefined) return null;
  return {
    header: "REVISION MODE",
    alt: rc.steelmanned_alternative ?? "(none supplied)",
    instruction: rc.instruction,
    critiques: rc.critiques_to_address,
  };
}

function buildSectionRevisionInstruction(
  global: ReturnType<typeof buildRevisionInstruction>,
  rc: RevisionContext | undefined,
  section: FormatSection
): string {
  if (global === null || rc === undefined) return "";
  const relevant = global.critiques.filter(
    (c) => c.target.section_id === undefined || c.target.section_id === section.id
  );
  const critiquesText =
    relevant.length === 0
      ? "(no critiques targeted at this section — align recommendation and prose with the steelmanned alternative)"
      : untrusted(
          "adversarial critiques",
          relevant
            .map(
              (c) =>
                `- ${c.id} [${c.severity}, ${c.category}]: ${c.steelmanned_position}\n    implication_if_true: ${c.implication_if_true}\n    suggested_revision: ${c.suggested_revision}`
            )
            .join("\n")
        );
  return [
    `${global.header} — the initial synthesis attracted adversarial critiques that this pass MUST address.`,
    "",
    "Critiques to address:",
    critiquesText,
    "",
    `Steelmanned alternative recommendation:\n${untrusted("steelmanned alternative", global.alt)}`,
    "",
    `Instruction: ${global.instruction}`,
    "",
    "Preserve the section id, title, and structural boundaries exactly. Re-write only the prose.",
  ].join("\n");
}

function buildRetryInstruction(reason: EditorialReason, details: string): string {
  const readable = reason === "forbidden_terms"
    ? "forbidden terms detected in content"
    : reason === "over_length"
      ? "section exceeded its word-count cap"
      : "one or more validation_rules were not honoured";
  return [
    "STRICT EDITORIAL RETRY — the previous attempt at this section was rejected.",
    `Reason: ${reason} (${readable}).`,
    `Details: ${details}.`,
    "Regenerate the section keeping identical structure, but eliminate the failure cause. Do not merely rephrase — remove the offending element.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Per-section parsing + post-validation
// ---------------------------------------------------------------------------

interface ParsedSectionResponse {
  content_markdown: string;
  sources_cited: SourceReference[];
  validation_issues: string[];
}

function parseSectionResponse(
  raw: string,
  section: FormatSection,
  knownSources: KnownSourcesIndex
): ParsedSectionResponse {
  const stripped = extractJsonText(raw);
  if (stripped.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `empty response for section '${section.id}'`,
      raw
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(stripped);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `not valid JSON for section '${section.id}' (${message})`,
      raw
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `expected a JSON object for section '${section.id}'`,
      raw
    );
  }
  const obj = value as Record<string, unknown>;

  const content = obj["content_markdown"];
  if (typeof content !== "string" || content.length === 0) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `section '${section.id}': content_markdown must be a non-empty string`,
      raw
    );
  }

  checkProse(content, `section '${section.id}'`, knownSources, raw);

  const rawSources = obj["sources_cited"];
  if (!Array.isArray(rawSources)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `section '${section.id}': sources_cited must be an array`,
      raw
    );
  }
  const sources = rawSources.map((s, i) =>
    parseCitedSource(s, `section '${section.id}': sources_cited[${i}]`, knownSources, raw)
  );
  checkMarkers(content, `section '${section.id}'`, sources.length, raw);

  const issuesRaw = obj["validation_issues"];
  if (!Array.isArray(issuesRaw)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `section '${section.id}': validation_issues must be an array (possibly empty)`,
      raw
    );
  }
  const issues: string[] = [];
  for (const [i, e] of issuesRaw.entries()) {
    if (typeof e !== "string" || e.length === 0) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `section '${section.id}': validation_issues[${i}] must be a non-empty string`,
        raw
      );
    }
    issues.push(e);
  }
  const unmarked = unmarkedParagraph(content);
  if (
    section.validation_rules?.some((r) => r.trim() === PARAGRAPH_END_RULE) === true &&
    unmarked !== null &&
    !issues.some((i) => i.includes(PARAGRAPH_END_RULE))
  ) {
    issues.push(
      `validation_rule not honoured: '${PARAGRAPH_END_RULE}' (checked by code: paragraph ${unmarked} does not end with a citation marker [n])`
    );
  }

  return {
    content_markdown: content,
    sources_cited: sources,
    validation_issues: issues,
  };
}

function postValidate(
  parsed: ParsedSectionResponse,
  section: FormatSection,
  ctx: SynthesisContext
): SynthesizedSection {
  const wordCount = countWords(parsed.content_markdown);
  const extraIssues: string[] = [];

  // max_length check with tolerance.
  const overCap = Math.floor(
    section.max_length.words * (1 + OVER_LENGTH_TOLERANCE_PCT)
  );
  if (wordCount > overCap) {
    extraIssues.push(
      `section exceeds max_length: ${wordCount} words vs cap ${section.max_length.words} (tolerance ${OVER_LENGTH_TOLERANCE_PCT * 100}%)`
    );
  }

  // forbidden_terms check (case-insensitive substring, whole content).
  const lowered = parsed.content_markdown.toLowerCase();
  for (const term of ctx.format.style_guide.forbidden_terms) {
    const count = countOccurrences(lowered, term.toLowerCase());
    if (count > 0) {
      extraIssues.push(
        `forbidden term '${term}' found ${count} time(s) in section '${section.id}'`
      );
    }
  }

  // validation_rules — we can't semantically enforce every rule (they
  // are free-form declarative strings) but we surface the rule names
  // that the LLM did not explicitly acknowledge via a soft warning.
  // Any rule the LLM already flagged in its validation_issues is
  // trusted; the remaining rules are noted as "not confirmed" so the
  // reader can decide.
  if (section.validation_rules !== undefined && section.validation_rules.length > 0) {
    const acknowledged = new Set(
      parsed.validation_issues.map((s) => s.toLowerCase())
    );
    for (const rule of section.validation_rules) {
      const key = ruleKey(rule);
      const isAck = [...acknowledged].some((issue) =>
        issue.includes(key.toLowerCase())
      );
      // A rule the code already reported in this form is not reported again.
      const reported = parsed.validation_issues.some((i) => i.startsWith(`validation_rule not honoured: '${rule}'`));
      if (isAck && !reported) {
        extraIssues.push(
          `validation_rule not honoured: '${rule}' (agent flagged it in validation_issues)`
        );
      }
    }
  }

  return {
    section_id: section.id,
    title: section.title,
    content_markdown: parsed.content_markdown,
    word_count: wordCount,
    sources_cited: parsed.sources_cited,
    validation_issues: [...parsed.validation_issues, ...extraIssues],
    editorial_attempts: [],
    final_attempt_number: 1,
  };
}

function ruleKey(rule: string): string {
  // Rules are `key: value` (e.g. `must_state_recommendation_in_first_sentence: true`).
  // The key alone is what we look for inside the agent's issue lines.
  const colon = rule.indexOf(":");
  return colon > 0 ? rule.slice(0, colon).trim() : rule.trim();
}

function buildFormatConformance(
  ctx: SynthesisContext,
  sections: readonly SynthesizedSection[],
  totalWordCount: number
): FormatConformance {
  const target = ctx.format.target_length.words;
  const deviationPct = target === 0 ? 0 : ((totalWordCount - target) / target) * 100;

  const sectionsOverLength: string[] = [];
  for (const s of sections) {
    const decl = ctx.format.sections.find((fs) => fs.id === s.section_id);
    if (decl === undefined) continue;
    const overCap = Math.floor(
      decl.max_length.words * (1 + OVER_LENGTH_TOLERANCE_PCT)
    );
    if (s.word_count > overCap) sectionsOverLength.push(s.section_id);
  }

  const forbiddenHits: ForbiddenTermHit[] = [];
  for (const s of sections) {
    const lowered = s.content_markdown.toLowerCase();
    for (const term of ctx.format.style_guide.forbidden_terms) {
      const count = countOccurrences(lowered, term.toLowerCase());
      if (count > 0) {
        forbiddenHits.push({ term, section_id: s.section_id, count });
      }
    }
  }

  const failedRules: FailedValidationRule[] = [];
  for (const s of sections) {
    for (const issue of s.validation_issues) {
      const m = issue.match(/^validation_rule not honoured: '([^']+)'/);
      if (m !== null) {
        failedRules.push({ section_id: s.section_id, rule: m[1]! });
      }
    }
  }

  return {
    target_words: target,
    actual_words: totalWordCount,
    deviation_pct: Number(deviationPct.toFixed(1)),
    sections_over_length: sectionsOverLength,
    forbidden_terms_found: forbiddenHits,
    failed_validation_rules: failedRules,
  };
}

// ---------------------------------------------------------------------------
// Upstream sources index — used to enforce the no-invention rule.
// ---------------------------------------------------------------------------

export interface KnownSourcesIndex {
  hasUrl(url: string): boolean;
  /** Every upstream URL, longest first. */
  urls(): string[];
}

/** What, once the upstream URLs are taken out, makes prose point elsewhere. */
const PROSE_POINTERS: readonly [RegExp, string][] = [
  [/!\[/, "an image (a Markdown viewer fetches it on open)"],
  [/\b(?:src|href)\s*=/i, "an HTML element that loads or links a URL"],
  [/^\s*\[[^\]]+\]:\s*\S/m, "a reference link to a URL no upstream stage returned"],
  [/<[a-z][a-z0-9+.-]{1,31}:[^\s>]*>/i, "an autolink to a URL no upstream stage returned"],
  [/\b[a-z][a-z0-9+.-]*:\/\//i, "a URL no upstream stage returned"],
  [/(?:^|[\s("'=])\/\/[^\s/]/, "a protocol-relative URL"],
  // The whole address is quoted, without a closing punctuation mark, so a refusal names it.
  [/\bwww\.(?:[^\s()<>[\]"']*[^\s()<>[\]"'.,;:!?])?/i, "a www. address, which viewers turn into a link"],
];

/** A link destination left empty once its upstream URL is taken out: `()`, `(<>)`, with an optional title. */
const EMPTIED_DESTINATION = /^\]\(\s*(?:<>)?\s*(?:"[^"]*"|'[^']*')?\s*\)/;

/** A citation marker: `[n]` cites the n-th entry (1-based) of the section's `sources_cited`. */
const CITATION_MARKER = /\[(\d+)\]/g;
const PARAGRAPH_END_RULE = "every_paragraph_ends_with_citation: true";

/** A marker that points at no listed source is a citation the reader cannot follow. */
function checkMarkers(content: string, where: string, count: number, raw: string): void {
  for (const m of content.matchAll(CITATION_MARKER)) {
    const n = Number(m[1]);
    if (n < 1 || n > count) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `${where}: content_markdown has a citation marker [${n}] that points at no entry of sources_cited (${count} listed)`,
        raw
      );
    }
  }
}

/** The 1-based number of the first paragraph that does not end with a marker, or null. */
function unmarkedParagraph(content: string): number | null {
  const paragraphs = content.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const at = paragraphs.findIndex((p) => !/\[\d+\][.)]?$/.test(p));
  return at === -1 ? null : at + 1;
}

/** The longest refused text an error quotes. */
const QUOTE_MAX = 200;

/** Where an upstream URL may end: what follows it cannot extend it into another URL. */
const URL_END = `(?=$|[\\s)>"'\\]]|[.,;:!?](?:\\s|$))`;

/**
 * A section's prose may point only at upstream sources, exactly as they were
 * returned: no image, no element that loads a URL, and no link, reference,
 * autolink, scheme, protocol-relative or `www.` address beyond them. A page
 * the model searched could otherwise steer it into a beacon image that leaks
 * the briefing when opened, or a look-alike link (OWASP LLM05). An upstream
 * URL with anything appended is refused too: the upstream page may be the
 * attacker's. Checked on fresh answers and stored checkpoints alike.
 */
function checkProse(content: string, where: string, knownSources: KnownSourcesIndex, raw: string): void {
  let rest = content;
  for (const url of knownSources.urls()) {
    rest = rest.replace(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + URL_END, "g"), "");
  }
  // The quote lands in error records committed to git, and a beacon address can carry briefing text.
  const refuse = (what: string, hit: string): never => {
    const quoted = hit.length > QUOTE_MAX ? `${hit.slice(0, QUOTE_MAX)}…` : hit;
    throw new InvalidAgentOutputError(AGENT_ID, `${where}: content_markdown contains ${what}: '${quoted}'`, raw);
  };
  for (const [pattern, what] of PROSE_POINTERS) {
    const hit = pattern.exec(rest);
    if (hit !== null) refuse(what, hit[0]);
  }
  for (let at = rest.indexOf("]("); at !== -1; at = rest.indexOf("](", at + 2)) {
    if (!EMPTIED_DESTINATION.test(rest.slice(at))) refuse("a link to a URL no upstream stage returned", rest.slice(at, at + 40));
  }
}

/**
 * One entry of a section's `sources_cited`, for a fresh answer and for a
 * stored synthesis alike: the four fields as non-empty strings (excerpt may
 * be empty), and a URL that some upstream stage returned. Fabricated URLs
 * are structurally forbidden.
 */
export function parseCitedSource(
  s: unknown,
  where: string,
  knownSources: KnownSourcesIndex,
  raw: string
): SourceReference {
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    throw new InvalidAgentOutputError(AGENT_ID, `${where} must be an object`, raw);
  }
  const so = s as Record<string, unknown>;
  const url = so["url"];
  const title = so["title"];
  const accessedAt = so["accessed_at"];
  const excerpt = so["excerpt"];
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    typeof title !== "string" ||
    title.length === 0 ||
    typeof accessedAt !== "string" ||
    accessedAt.length === 0 ||
    typeof excerpt !== "string"
  ) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `${where} must have url/title/accessed_at/excerpt (all strings)`,
      raw
    );
  }
  if (!knownSources.hasUrl(url)) {
    throw new SynthesisError(
      `${where}: cited source url '${url}' is not present in any upstream artefact. Synthesis must not invent sources.`
    );
  }
  return { url, title, accessed_at: accessedAt, excerpt };
}
function collectUpstreamSources(ctx: SynthesisContext): KnownSourcesIndex {
  const urls = new Set<string>();
  for (const f of ctx.research.findings) {
    if ("url" in f.source) urls.add(f.source.url);
  }
  for (const s of ctx.stakeholders.stakeholders) {
    if ("url" in s.position_evidence) urls.add(s.position_evidence.url);
  }
  for (const r of ctx.risks.risks) {
    if ("url" in r.likelihood_evidence) urls.add(r.likelihood_evidence.url);
    if ("url" in r.impact_evidence) urls.add(r.impact_evidence.url);
  }
  for (const o of ctx.options.options) {
    if ("url" in o.supporting_evidence) urls.add(o.supporting_evidence.url);
  }
  const longestFirst = [...urls].sort((a, b) => b.length - a.length);
  return {
    hasUrl(url: string): boolean {
      return urls.has(url);
    },
    urls: () => longestFirst,
  };
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Count words in Markdown text. Strips code fences and inline code,
 * collapses whitespace, splits on runs of whitespace. Close enough for
 * a section budget check; the reader's editor decides the ground truth.
 */
export function countWords(markdown: string): number {
  const noCodeBlocks = markdown.replace(/```[\s\S]*?```/g, " ");
  const noInlineCode = noCodeBlocks.replace(/`[^`]*`/g, " ");
  const noBrackets = noInlineCode.replace(/[[\]()#>*_~|-]/g, " ");
  const words = noBrackets.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

