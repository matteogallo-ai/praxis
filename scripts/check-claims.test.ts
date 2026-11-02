import { describe, expect, test } from "bun:test";

import { checkReadme, parseClaims } from "./check-claims.ts";

const TABLE = `| ID | Claim | Implementation | Tests | Status |
|---|---|---|---|---|
| C01 | Renders PDF. | \`src/r.ts\` | \`tests/r.test.ts::pdf\`<br>\`tests/s.test.ts\` | shipped |
| C02 | Runs live. | — | — | roadmap |
`;

describe("parseClaims", () => {
  test("reads ids, statuses and the backticked tests", () => {
    const { claims, problems } = parseClaims(TABLE);
    expect(problems).toEqual([]);
    expect(claims).toEqual([
      { id: "C01", status: "shipped", tests: ["tests/r.test.ts::pdf", "tests/s.test.ts"] },
      { id: "C02", status: "roadmap", tests: [] },
    ]);
  });

  test("a shipped claim without a test is a problem", () => {
    const { problems } = parseClaims("| C03 | X. | `src/x.ts` | — | shipped |");
    expect(problems).toEqual(["CLAIMS.md:1: shipped claim C03 lists no test"]);
  });

  test("unknown statuses, duplicate ids and wrong column counts are problems", () => {
    const { problems } = parseClaims(
      ["| C01 | a | b | c | done |", "| C02 | a | b | — | roadmap |", "| C02 | a | b | — | roadmap |", "| C04 | a | b |"].join("\n")
    );
    expect(problems).toEqual([
      "CLAIMS.md:1: C01 has status 'done'",
      "CLAIMS.md:3: duplicate claim id C02",
      "CLAIMS.md:4: expected 5 columns, found 3",
    ]);
  });
});

describe("checkReadme", () => {
  const { claims } = parseClaims(TABLE);

  test("a README that cites each claim in its section is consistent", () => {
    const readme = "## Features\n\n- PDF output (C01)\n\n## Roadmap\n\n- Live runs (C02)\n";
    expect(checkReadme(readme, claims)).toEqual([]);
  });

  test("a roadmap claim listed as a feature is caught", () => {
    const readme = "## Features\n\n- PDF (C01)\n- Live (C02)\n\n## Roadmap\n\n- Live (C02)\n";
    expect(checkReadme(readme, claims)).toEqual(["README.md Features: C02 is roadmap, not shipped"]);
  });

  test("a feature bullet without a claim id and an unlisted claim are caught", () => {
    const readme = "## Features\n\n- Fast\n\n## Roadmap\n\n- Live (C02)\n";
    expect(checkReadme(readme, claims)).toEqual([
      "README.md Features: bullet without a claim id: - Fast",
      "README.md Features: shipped claim C01 not listed",
    ]);
  });

  test("missing sections are reported", () => {
    expect(checkReadme("# Title\n", claims)).toEqual([
      "README.md: missing '## Features' section",
      "README.md: missing '## Roadmap' section",
      "README.md Features: shipped claim C01 not listed",
      "README.md Roadmap: roadmap claim C02 not listed",
    ]);
  });
});
