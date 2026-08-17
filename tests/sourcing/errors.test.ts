import { describe, expect, test } from "bun:test";

import { SourcingValidationError } from "../../src/sourcing/errors.ts";
import { PraxisError } from "../../src/registry/errors.ts";
import type { SourcingReport } from "../../src/sourcing/types.ts";

describe("SourcingValidationError", () => {
  test("carries the report and mentions counts and policy", () => {
    const report: SourcingReport = {
      policy: "strict",
      total_items: 4,
      missing_sources_count: 2,
      warnings: [
        { kind: "missing_source", finding_index: 1, searched_for: "X" },
        { kind: "missing_source", finding_index: 3, searched_for: "Y" },
      ],
    };
    const err = new SourcingValidationError(report);
    expect(err.report).toBe(report);
    expect(err.message).toContain("strict");
    expect(err.message).toContain("2");
    expect(err.message).toContain("4");
    expect(err.name).toBe("SourcingValidationError");
    expect(err).toBeInstanceOf(PraxisError);
  });

  test("works with stakeholder-evidence warnings", () => {
    const report: SourcingReport = {
      policy: "strict",
      total_items: 5,
      missing_sources_count: 1,
      warnings: [
        {
          kind: "missing_stakeholder_evidence",
          stakeholder_index: 2,
          stakeholder_name: "BMDV",
          searched_for: "Berlin position statement",
        },
      ],
    };
    const err = new SourcingValidationError(report);
    expect(err.report.warnings[0]!.kind).toBe("missing_stakeholder_evidence");
    expect(err.message).toContain("strict");
    expect(err.message).toContain("1");
    expect(err.message).toContain("5");
  });
});
