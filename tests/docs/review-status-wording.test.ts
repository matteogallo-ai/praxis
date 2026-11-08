/**
 * What has been reviewed by a human, worded once and pinned in every file
 * that states the live briefings' status, so that no file says "not yet
 * reviewed" while another publishes the question 10 source review.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REVIEW = "benchmarks/outputs/live/README.md";
const ANCHOR = "question-10-human-review-of-its-first-party-sources";
const FILES = ["README.md", "CLAUDE.md", "docs/SYSTEM_CARD.md", "docs/THREAT_MODEL.md", "docs/CLAIMS.md"];

const flat = (p: string) => readFileSync(p, "utf-8").replace(/\s+/g, " ");
const wording = (link: string) =>
  "A human review (4 Nov 2026) covered only question 10's eight first-party sources, the ones the rule accepted: " +
  `the reviewer accepted 6 and refused 2 ([review](${link})). ` +
  "The quality of the briefings themselves is reviewed for question 12 only, in one blind comparison with a single model call.";

describe("live review status wording", () => {
  test("the counts are the published review's", () => {
    expect(flat(REVIEW)).toContain("8 reviewed, 6 accepted, 2 refused.");
    expect(readFileSync(REVIEW, "utf-8")).toContain("### Question 10: human review of its first-party sources");
  });

  for (const file of FILES) {
    test(`${file} states it, with a link that resolves`, () => {
      const target = file.startsWith("docs/") ? `../${REVIEW}` : REVIEW;
      expect(flat(file)).toContain(wording(`${target}#${ANCHOR}`));
      expect(existsSync(join(dirname(file), target))).toBe(true);
      expect(flat(file)).not.toMatch(/not yet reviewed|Quality not reviewed/);
    });
  }
});

describe("briefing excerpt: 39 flagged items against the run record's counts", () => {
  const RUN = "benchmarks/outputs/live/12-sodium-ion-plant-morocco/run-2026-11-04T13-20-16-572Z";
  const meta = JSON.parse(readFileSync(`${RUN}/metadata.json`, "utf-8")) as {
    sourcing: { counts: { untrusted: number; missing: number }; untrusted_citations: { stage: string; id: string }[] };
  };
  const options = meta.sourcing.untrusted_citations.filter((c) => c.stage === "options");

  test("the flag's count is missing + untrusted + options citations, as the excerpt explains", () => {
    const { untrusted, missing } = meta.sourcing.counts;
    const flagged = untrusted + missing + options.length;
    expect(readFileSync(`${RUN}/brief.md`, "utf-8")).toContain(`The ${flagged} item(s) below did not meet it.`);
    expect(flat(REVIEW)).toContain(
      `The flag lists ${flagged} items where the run record counts ${missing} without a source and ${untrusted} from untrusted domains: ` +
        `the remaining item is option ${options[0]?.id}'s citation on an untrusted host`
    );
    expect(options).toHaveLength(1);
  });
});
