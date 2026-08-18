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

import { readFileSync, existsSync } from "node:fs";

import { tokenize } from "promptlang/lexer";
import { parse } from "promptlang/parser";
import type { Program, PromptDeclaration, MessageSection } from "promptlang/ast";

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
  AgentExecutionError,
  EditorialFailureError,
  InvalidAgentOutputError,
  PromptFileError,
  SynthesisError,
} from "./errors.ts";

const AGENT_ID = "synthesis";
const PROMPT_NAME = "synthesis";
const DEFAULT_PROMPT_PATH = "prompts/synthesis.prompt";

/** How much slack to grant before flagging a section as over-length. */
const OVER_LENGTH_TOLERANCE_PCT = 0.1;

export interface ExecuteSynthesisOptions {
  /** Overrides the default `prompts/synthesis.prompt` location — used in tests. */
  promptPath?: string;
}

export async function executeSynthesis(
  ctx: SynthesisContext,
  llm: LLMProvider,
  options: ExecuteSynthesisOptions = {}
): Promise<SynthesisResult> {
  const promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH;
  const declaration = loadPromptDeclaration(promptPath);

  const sections: SynthesizedSection[] = [];
  const sourcesByAgent = collectUpstreamSources(ctx);
  const editorial = buildEditorialConfig(ctx.format);
  const revisionBlockGlobal = buildRevisionInstruction(ctx.revision_context);

  for (const section of ctx.format.sections) {
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
      validateParameterCoverage(declaration, inputs, promptPath);

      const systemText = renderSection(declaration, "system", inputs, promptPath);
      const userText = renderSection(declaration, "user", inputs, promptPath);
      const prompt = `${systemText.trim()}\n\n---\n\n${userText.trim()}`;

      let text: string;
      try {
        text = await callLLM(llm, prompt);
      } catch (err) {
        if (err instanceof AgentExecutionError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new AgentExecutionError(
          AGENT_ID,
          `LLM provider error while synthesising '${section.id}' — ${message}`
        );
      }

      const parsed = parseSectionResponse(text, section, sourcesByAgent);

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
    sections.push({
      ...post,
      editorial_attempts: attempts,
      final_attempt_number: acceptedAttempt,
    });
  }

  const totalWordCount = sections.reduce((acc, s) => acc + s.word_count, 0);
  const conformance = buildFormatConformance(ctx, sections, totalWordCount);

  return {
    sections,
    total_word_count: totalWordCount,
    format_conformance: conformance,
  };
}

async function callLLM(llm: LLMProvider, prompt: string): Promise<string> {
  // Synthesis does not use tools — call `complete` directly. Some
  // providers may only implement `completeWithTools`; fall back to it
  // with an empty tool list.
  if (typeof llm.complete === "function") {
    return llm.complete(prompt);
  }
  if (typeof llm.completeWithTools === "function") {
    const r = await llm.completeWithTools(prompt, []);
    return r.text;
  }
  throw new AgentExecutionError(
    AGENT_ID,
    `LLM provider '${llm.name}' implements neither complete() nor completeWithTools()`
  );
}

function loadPromptDeclaration(path: string): PromptDeclaration {
  if (!existsSync(path)) {
    throw new PromptFileError(AGENT_ID, path, "file not found");
  }
  let source: string;
  try {
    source = readFileSync(path, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PromptFileError(AGENT_ID, path, `read failed — ${message}`);
  }

  let program: Program;
  try {
    program = parse(tokenize(source));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PromptFileError(AGENT_ID, path, `parse failed — ${message}`);
  }

  const decl = program.declarations.find(
    (d): d is PromptDeclaration =>
      d.kind === "PromptDeclaration" && d.name === PROMPT_NAME
  );
  if (!decl) {
    throw new PromptFileError(
      AGENT_ID,
      path,
      `missing prompt declaration '${PROMPT_NAME}'`
    );
  }
  return decl;
}

function validateParameterCoverage(
  decl: PromptDeclaration,
  inputs: Record<string, string>,
  path: string
): void {
  const declared = new Set(decl.parameters.map((p) => p.name));
  for (const name of Object.keys(inputs)) {
    if (!declared.has(name)) {
      throw new PromptFileError(
        AGENT_ID,
        path,
        `runtime passed input '${name}' but the prompt does not declare it as a parameter`
      );
    }
  }
  for (const name of declared) {
    if (!(name in inputs)) {
      throw new PromptFileError(
        AGENT_ID,
        path,
        `prompt declares parameter '${name}' but the runtime did not provide it`
      );
    }
  }
}

function renderSection(
  decl: PromptDeclaration,
  role: "system" | "user",
  inputs: Record<string, string>,
  path: string
): string {
  const section = decl.sections.find(
    (s): s is MessageSection => s.kind === "MessageSection" && s.role === role
  );
  if (!section) {
    throw new PromptFileError(AGENT_ID, path, `missing '${role}:' section`);
  }
  const raw = section.content.value;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
    const value = inputs[varName];
    if (value === undefined) {
      throw new PromptFileError(
        AGENT_ID,
        path,
        `'${role}:' references unknown parameter '{{${varName}}}'`
      );
    }
    return value;
  });
}

function buildSectionInputs(
  ctx: SynthesisContext,
  section: FormatSection,
  revisionBlock: string,
  retryBlock: string
): Record<string, string> {
  return {
    scoping_json: JSON.stringify(ctx.scoping, null, 2),
    research_json: JSON.stringify(ctx.research, null, 2),
    stakeholders_json: JSON.stringify(ctx.stakeholders, null, 2),
    risks_json: JSON.stringify(ctx.risks, null, 2),
    options_json: JSON.stringify(ctx.options, null, 2),
    format_id: ctx.format.id,
    section_id: section.id,
    section_title: section.title,
    section_purpose: section.purpose,
    section_tone_directives: section.tone_directives,
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
      : relevant
          .map(
            (c) =>
              `- ${c.id} [${c.severity}, ${c.category}]: ${c.steelmanned_position}\n    implication_if_true: ${c.implication_if_true}\n    suggested_revision: ${c.suggested_revision}`
          )
          .join("\n");
  return [
    `${global.header} — the initial synthesis attracted adversarial critiques that this pass MUST address.`,
    "",
    "Critiques to address:",
    critiquesText,
    "",
    `Steelmanned alternative recommendation:\n${global.alt}`,
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
  const stripped = stripJsonFences(raw).trim();
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

  const rawSources = obj["sources_cited"];
  if (!Array.isArray(rawSources)) {
    throw new InvalidAgentOutputError(
      AGENT_ID,
      `section '${section.id}': sources_cited must be an array`,
      raw
    );
  }
  const sources: SourceReference[] = [];
  for (const [i, s] of rawSources.entries()) {
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      throw new InvalidAgentOutputError(
        AGENT_ID,
        `section '${section.id}': sources_cited[${i}] must be an object`,
        raw
      );
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
        `section '${section.id}': sources_cited[${i}] must have url/title/accessed_at/excerpt (all strings)`,
        raw
      );
    }
    // Non-invention guard: the cited URL must exist somewhere in the
    // upstream artefacts. Fabricated URLs are structurally forbidden.
    if (!knownSources.hasUrl(url)) {
      throw new SynthesisError(
        `section '${section.id}': cited source url '${url}' is not present in any upstream artefact. Synthesis must not invent sources.`
      );
    }
    sources.push({ url, title, accessed_at: accessedAt, excerpt });
  }

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
      if (isAck) {
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

interface KnownSourcesIndex {
  hasUrl(url: string): boolean;
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
  return {
    hasUrl(url: string): boolean {
      return urls.has(url);
    },
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
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function stripJsonFences(raw: string): string {
  const fenced = raw.match(/^```(?:json)?\n([\s\S]*?)\n```\s*$/);
  if (fenced && fenced[1] !== undefined) return fenced[1];
  return raw;
}

/** Re-exported so callers can construct richer errors. */
export { SynthesisError };
