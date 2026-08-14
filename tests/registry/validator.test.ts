import { describe, expect, test } from "bun:test";

import { validateFormat } from "../../src/registry/validator.ts";
import { ValidationError } from "../../src/registry/errors.ts";
import type { YamlValue } from "@promptlang/yaml-parser";

// ---------------------------------------------------------------------------
// Test helper: build a fresh, complete, valid parsed-YAML object.
// Every test mutates a clone to isolate a single failure mode.
// ---------------------------------------------------------------------------

function base(): { [k: string]: YamlValue } {
  return {
    id: "sample-format",
    name: "Sample Format",
    version: "1.0.0",
    metadata: {
      author: "Test Author",
      organization_style: "generic",
      language: "en",
      last_reviewed: "2026-08-14",
    },
    target_length: { pages: 2, words: 800 },
    sections: [
      {
        id: "context",
        title: "Context",
        purpose: "Establish the situation.",
        max_length: { words: 200 },
        required_agents: ["scoping", "research"],
        tone_directives: "neutral",
        validation_rules: ["must_contain_recommendation: false"],
      },
      {
        id: "recommendation",
        title: "Recommendation",
        purpose: "State the recommended action.",
        max_length: { words: 150 },
        required_agents: ["synthesis"],
        tone_directives: "authoritative",
      },
    ],
    sourcing_policy: "strict",
    style_guide: {
      voice: "authoritative",
      sentence_structure: "short declarative",
      forbidden_terms: ["it seems", "perhaps"],
    },
    output_targets: ["md", "pdf"],
  };
}

/**
 * Structured clone of the base object — needed because mutating nested
 * objects/arrays on the raw output of `base()` would poison later tests.
 */
function clone(): { [k: string]: YamlValue } {
  return JSON.parse(JSON.stringify(base())) as { [k: string]: YamlValue };
}

function expectIssue(
  raw: YamlValue,
  path: string,
  substring?: string
): ValidationError {
  let caught: unknown;
  try {
    validateFormat(raw);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  const err = caught as ValidationError;
  const matches = err.issues.filter(
    (i) => i.path === path && (substring === undefined || i.message.includes(substring))
  );
  expect(matches.length).toBeGreaterThan(0);
  return err;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("validateFormat — happy path", () => {
  test("accepts a fully valid format", () => {
    const format = validateFormat(base());
    expect(format.id).toBe("sample-format");
    expect(format.sections).toHaveLength(2);
    expect(format.sections[0]!.validation_rules).toEqual(["must_contain_recommendation: false"]);
    expect(format.sections[1]!.validation_rules).toBeUndefined();
    expect(format.output_targets).toEqual(["md", "pdf"]);
  });

  test("accepts a format without optional validation_rules on any section", () => {
    const raw = clone();
    for (const s of raw["sections"] as { [k: string]: YamlValue }[]) {
      delete s["validation_rules"];
    }
    expect(() => validateFormat(raw)).not.toThrow();
  });

  test("accepts an empty forbidden_terms array", () => {
    const raw = clone();
    (raw["style_guide"] as { [k: string]: YamlValue })["forbidden_terms"] = [];
    const f = validateFormat(raw);
    expect(f.style_guide.forbidden_terms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Root shape
// ---------------------------------------------------------------------------

describe("validateFormat — root shape", () => {
  test("rejects non-object root", () => {
    expect(() => validateFormat(null)).toThrow(ValidationError);
    expect(() => validateFormat("string")).toThrow(ValidationError);
    expect(() => validateFormat(42)).toThrow(ValidationError);
    expect(() => validateFormat([])).toThrow(ValidationError);
  });

  test("rejects an unknown top-level key", () => {
    const raw = clone();
    raw["extra_top_level_key"] = "nope";
    expectIssue(raw, "extra_top_level_key", "unknown key");
  });

  test("accumulates multiple issues in a single throw", () => {
    const raw = clone();
    delete raw["id"];
    delete raw["name"];
    delete raw["version"];
    const err = expectIssue(raw, "id");
    expect(err.issues.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Required top-level fields — one test per field
// ---------------------------------------------------------------------------

describe("validateFormat — required top-level fields", () => {
  test("rejects missing id", () => {
    const raw = clone();
    delete raw["id"];
    expectIssue(raw, "id", "required");
  });

  test("rejects missing name", () => {
    const raw = clone();
    delete raw["name"];
    expectIssue(raw, "name", "required");
  });

  test("rejects missing version", () => {
    const raw = clone();
    delete raw["version"];
    expectIssue(raw, "version", "required");
  });

  test("rejects missing metadata", () => {
    const raw = clone();
    delete raw["metadata"];
    expectIssue(raw, "metadata", "required");
  });

  test("rejects missing target_length", () => {
    const raw = clone();
    delete raw["target_length"];
    expectIssue(raw, "target_length", "required");
  });

  test("rejects missing sections", () => {
    const raw = clone();
    delete raw["sections"];
    expectIssue(raw, "sections", "required");
  });

  test("rejects missing sourcing_policy", () => {
    const raw = clone();
    delete raw["sourcing_policy"];
    expectIssue(raw, "sourcing_policy", "required");
  });

  test("rejects missing style_guide", () => {
    const raw = clone();
    delete raw["style_guide"];
    expectIssue(raw, "style_guide", "required");
  });

  test("rejects missing output_targets", () => {
    const raw = clone();
    delete raw["output_targets"];
    expectIssue(raw, "output_targets", "required");
  });
});

// ---------------------------------------------------------------------------
// id / version formats
// ---------------------------------------------------------------------------

describe("validateFormat — id and version formats", () => {
  test("rejects a non-kebab-case id", () => {
    const raw = clone();
    raw["id"] = "Not_KebabCase";
    expectIssue(raw, "id", "kebab-case");
  });

  test("rejects an id containing spaces", () => {
    const raw = clone();
    raw["id"] = "with spaces";
    expectIssue(raw, "id", "kebab-case");
  });

  test("rejects an invalid SemVer version", () => {
    const raw = clone();
    raw["version"] = "1.0";
    expectIssue(raw, "version", "SemVer");
  });

  test("rejects id that is a number", () => {
    const raw = clone();
    raw["id"] = 42;
    expectIssue(raw, "id", "must be a string");
  });

  test("rejects empty id string", () => {
    const raw = clone();
    raw["id"] = "";
    expectIssue(raw, "id", "non-empty");
  });
});

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------

describe("validateFormat — metadata", () => {
  test("rejects missing metadata.author", () => {
    const raw = clone();
    delete (raw["metadata"] as { [k: string]: YamlValue })["author"];
    expectIssue(raw, "metadata.author", "required");
  });

  test("rejects an invalid organization_style", () => {
    const raw = clone();
    (raw["metadata"] as { [k: string]: YamlValue })["organization_style"] = "deloitte";
    expectIssue(raw, "metadata.organization_style", "must be one of");
  });

  test("rejects an invalid language", () => {
    const raw = clone();
    (raw["metadata"] as { [k: string]: YamlValue })["language"] = "de";
    expectIssue(raw, "metadata.language", "must be one of");
  });

  test("rejects an invalid ISO date", () => {
    const raw = clone();
    (raw["metadata"] as { [k: string]: YamlValue })["last_reviewed"] = "2026-13-45";
    expectIssue(raw, "metadata.last_reviewed", "ISO date");
  });

  test("rejects an unknown key inside metadata", () => {
    const raw = clone();
    (raw["metadata"] as { [k: string]: YamlValue })["nickname"] = "sample";
    expectIssue(raw, "metadata.nickname", "unknown key");
  });

  test("rejects metadata that is not a mapping", () => {
    const raw = clone();
    raw["metadata"] = "not a map";
    expectIssue(raw, "metadata", "must be a mapping");
  });
});

// ---------------------------------------------------------------------------
// target_length
// ---------------------------------------------------------------------------

describe("validateFormat — target_length", () => {
  test("rejects pages <= 0", () => {
    const raw = clone();
    (raw["target_length"] as { [k: string]: YamlValue })["pages"] = 0;
    expectIssue(raw, "target_length.pages", "greater than 0");
  });

  test("rejects negative words", () => {
    const raw = clone();
    (raw["target_length"] as { [k: string]: YamlValue })["words"] = -100;
    expectIssue(raw, "target_length.words", "greater than 0");
  });

  test("rejects non-integer pages", () => {
    const raw = clone();
    (raw["target_length"] as { [k: string]: YamlValue })["pages"] = 1.5;
    expectIssue(raw, "target_length.pages", "integer");
  });

  test("rejects target_length that is not a mapping", () => {
    const raw = clone();
    raw["target_length"] = 800;
    expectIssue(raw, "target_length", "must be a mapping");
  });
});

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

describe("validateFormat — sections", () => {
  test("rejects an empty sections array", () => {
    const raw = clone();
    raw["sections"] = [];
    expectIssue(raw, "sections", "at least one section");
  });

  test("rejects sections that is not a sequence", () => {
    const raw = clone();
    raw["sections"] = { not: "a sequence" };
    expectIssue(raw, "sections", "must be a sequence");
  });

  test("rejects a duplicate section id", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[1]!["id"] = "context";
    expectIssue(raw, "sections[1].id", "duplicate");
  });

  test("rejects a missing section field", () => {
    const raw = clone();
    delete (raw["sections"] as { [k: string]: YamlValue }[])[0]!["max_length"];
    expectIssue(raw, "sections[0].max_length", "required");
  });

  test("rejects an unknown key inside a section", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[0]!["nickname"] = "foo";
    expectIssue(raw, "sections[0].nickname", "unknown key");
  });

  test("rejects a section id not in kebab-case", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[0]!["id"] = "Bad_Id";
    expectIssue(raw, "sections[0].id", "kebab-case");
  });

  test("rejects an invalid agent id in required_agents", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[0]!["required_agents"] = [
      "not-a-real-agent",
    ];
    expectIssue(raw, "sections[0].required_agents[0]", "must be one of");
  });

  test("rejects an empty required_agents array", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[0]!["required_agents"] = [];
    expectIssue(raw, "sections[0].required_agents", "at least one agent");
  });

  test("rejects duplicate agents in required_agents", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[0]!["required_agents"] = [
      "research",
      "research",
    ];
    expectIssue(raw, "sections[0].required_agents[1]", "duplicate agent");
  });

  test("rejects a section max_length.words <= 0", () => {
    const raw = clone();
    ((raw["sections"] as { [k: string]: YamlValue }[])[0]!["max_length"] as {
      [k: string]: YamlValue;
    })["words"] = 0;
    expectIssue(raw, "sections[0].max_length.words", "greater than 0");
  });

  test("rejects a validation_rules entry that is not 'key: value' shape", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[0]!["validation_rules"] = ["just words"];
    expectIssue(raw, "sections[0].validation_rules[0]", "key: value");
  });

  test("rejects a non-string validation_rules entry", () => {
    const raw = clone();
    (raw["sections"] as { [k: string]: YamlValue }[])[0]!["validation_rules"] = [42];
    expectIssue(raw, "sections[0].validation_rules[0]", "non-empty string");
  });
});

// ---------------------------------------------------------------------------
// sourcing_policy / style_guide / output_targets
// ---------------------------------------------------------------------------

describe("validateFormat — misc fields", () => {
  test("rejects an invalid sourcing_policy", () => {
    const raw = clone();
    raw["sourcing_policy"] = "relaxed";
    expectIssue(raw, "sourcing_policy", "must be one of");
  });

  test("rejects a missing style_guide.voice", () => {
    const raw = clone();
    delete (raw["style_guide"] as { [k: string]: YamlValue })["voice"];
    expectIssue(raw, "style_guide.voice", "required");
  });

  test("rejects an empty string in forbidden_terms", () => {
    const raw = clone();
    (raw["style_guide"] as { [k: string]: YamlValue })["forbidden_terms"] = [""];
    expectIssue(raw, "style_guide.forbidden_terms[0]", "non-empty");
  });

  test("rejects forbidden_terms that is not a sequence", () => {
    const raw = clone();
    (raw["style_guide"] as { [k: string]: YamlValue })["forbidden_terms"] = "nope";
    expectIssue(raw, "style_guide.forbidden_terms", "must be a sequence");
  });

  test("rejects an invalid output target", () => {
    const raw = clone();
    raw["output_targets"] = ["epub"];
    expectIssue(raw, "output_targets[0]", "must be one of");
  });

  test("rejects an empty output_targets array", () => {
    const raw = clone();
    raw["output_targets"] = [];
    expectIssue(raw, "output_targets", "at least one target");
  });

  test("rejects duplicate output targets", () => {
    const raw = clone();
    raw["output_targets"] = ["md", "md"];
    expectIssue(raw, "output_targets[1]", "duplicate");
  });
});
