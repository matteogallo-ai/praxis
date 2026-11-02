# Supply chain

What protects the code between a commit and a release, which part the
repository enforces by itself, and which part lives in GitHub settings the
maintainer applies.

## In the repository

| Control | Where | DoD |
| --- | --- | --- |
| Every action pinned to a commit SHA, version in a comment | `.github/workflows/*.yml` | A3 |
| `bun.lock` committed, installed with `--frozen-lockfile` | `bun.lock`, CI | A3 |
| Dependabot, weekly, one grouped pull request per ecosystem (bun, GitHub Actions) | `.github/dependabot.yml` | A2 |
| Workflow tokens read-only; each widening is per job, with a comment | every workflow | A4 |
| CodeQL (`security-extended`) on TypeScript and on the workflows, every pull request and weekly | `.github/workflows/security.yml` | A5, A7 |
| OSV-Scanner on `bun.lock`, failing on a known vulnerability, every pull request and weekly | `.github/workflows/security.yml` | A6 |
| OpenSSF Scorecard, results published, badge in the README | `.github/workflows/scorecard.yml` | A11 |
| A `v*` tag's source archive attested (SLSA Build L2) and released with its Sigstore bundle | `.github/workflows/release.yml` | A10, G3 |

The license is MIT; GitHub reads it from `LICENSE` as the SPDX id `MIT`
(`gh api repos/matteogallo-ai/praxis --jq .license.spdx_id`), and
`package.json` declares the same id (A9).

There is no exception to the vulnerability gate. When one is needed it is
written here, with the advisory id, why it does not apply, and a review date,
and passed to OSV-Scanner through an `osv-scanner.toml` `IgnoredVulns` entry.

### The release artefact

The release is the tag's source archive (`git archive`). Praxis is not
published to npm: until PromptLang's lexer and parser come from npm
(`docs/CLAIMS.md` C19), the package does not install on its own, and a
tarball that does not run would be a false promise. The attestation says the
archive was produced by `release.yml` from that tag's commit; verify it with

```bash
gh attestation verify praxis-<version>.tar.gz --repo matteogallo-ai/praxis
```

## In GitHub settings (applied by the maintainer)

The JSON bodies are in `.github/settings/`. They are not read by any workflow.

**Required checks on `main` (A1).** Replaces the `main` ruleset with the same
rules plus the CI, CodeQL and OSV-Scanner checks, branches up to date before
merge:

```bash
gh api -X PUT repos/matteogallo-ai/praxis/rulesets/26384707 \
  --input .github/settings/ruleset-main.json
```

A check renamed in a workflow must be renamed here in the same pull request,
or `main` waits for a check that never reports.

**The `release` environment.** The release job waits for the maintainer's
approval; admins cannot bypass it; only `v*` tags may deploy to it:

```bash
gh api -X PUT repos/matteogallo-ai/praxis/environments/release \
  --input .github/settings/environment-release.json
gh api -X POST repos/matteogallo-ai/praxis/environments/release/deployment-branch-policies \
  --input .github/settings/environment-release-tags.json
```

**Dependabot security updates (A2).** Dependabot's version updates come from
`.github/dependabot.yml`; security updates are a repository switch:

```bash
gh api -X PUT repos/matteogallo-ai/praxis/automated-security-fixes
```

## Scorecard checks that stay low

Scorecard scores practices a solo, unpublished project cannot have. These
are expected and are not hidden:

| Check | Why it is low |
| --- | --- |
| Code-Review | One maintainer: pull requests are merged without a second human approval. Each change gets a context-free agent review instead (`CLAUDE.md`, rule 11), which Scorecard cannot see. |
| Contributors | Every commit comes from one account; the check counts contributing organisations. |
| Branch-Protection | Scorecard's default token cannot read every ruleset setting, and approvals required is 0 for the reason above. |
| CII-Best-Practices | No OpenSSF Best Practices badge yet (DoD F2, self-certified by the maintainer). |
| Maintained | Counts activity over 90 days; a young or quiet repository scores low whatever its state. |
| Packaging | Nothing is published to a package registry (see "The release artefact"). |
| Signed-Releases | Scores the last releases; those before `release.yml` carry no signature. It rises with each signed release. |
| Fuzzing | Low until Scorecard finds a fuzzer or a property-based testing library it recognises. |

The live score is on the badge in the README; the results also land in the
repository's Security tab.
