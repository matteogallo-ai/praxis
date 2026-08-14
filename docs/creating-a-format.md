# Creating a New Praxis Format

This guide walks a contributor through adding a new briefing format to
Praxis. If you have not yet read
[`format-schema.md`](format-schema.md), start there — this document
assumes you know the shape of a format.

---

## When to create a new format

Create a new format when an organization or discipline has a briefing
convention that would not be captured by tweaking an existing format's
`tone_directives` or `forbidden_terms`. Examples of good reasons:

- **A new organization style.** The organization has an unmistakable
  house-style (structure, voice, forbidden idioms).
- **A distinct document class.** Board memo, family-office IC memo,
  policy brief, litigation timeline — each has a fixed shape that
  distinguishes it from every other class.
- **A different language register.** French institutional French is not
  a `tone_directives` tweak on an English format — it is a different
  format.

Do **not** create a new format for a one-off variation of an existing
one. Fork a format only when the changes touch the section list, the
sourcing policy, or the language.

---

## Step-by-step

### 1. Pick an id

- kebab-case, singular, descriptive.
- Include the document class first, the flavour second:
  `position-paper-corporate`, `board-memo-family-office`,
  `policy-brief-government`.
- Verify uniqueness: `bun run cli formats list` shows every registered
  id.

### 2. Copy the closest existing format as a starting point

```bash
cp formats/executive-pre-read.yaml formats/your-new-format.yaml
```

Starting from a valid file guarantees you never fight the parser or the
validator over structural mistakes.

### 3. Fill in `metadata`

- `author`: your name and (optionally) your organization.
- `organization_style`: pick the closest enum. If none fits, open an
  issue proposing a new value — do not invent a string, the validator
  will reject it.
- `language`: `en`, `fr`, or `multi`.
- `last_reviewed`: today, ISO format `YYYY-MM-DD`.

### 4. Set `target_length`

Set `pages` and `words` to the real target of the document as an actual
practitioner would produce it. Do not exceed 6 pages / 2500 words — if
the document is longer, it is a report, not a briefing.

The sum of `sections[].max_length.words` must stay ≤ `target_length.words`.
The formats integrity test enforces this.

### 5. Design the section list

For each section, ask:

- **What must this section deliver?** (`purpose`)
- **How much space?** (`max_length.words`)
- **Which agents contribute?** (`required_agents`)
- **What voice?** (`tone_directives`)
- **What structural rules must the output pass?** (`validation_rules`,
  optional)

Every section MUST list at least one `required_agent` from the fixed
whitelist: `scoping`, `research`, `stakeholder`, `risk`, `options`,
`adversarial`, `synthesis`. Even in v0.1 (no agents run yet), the
contract is real.

Keep section ids kebab-case and unique within the format.

### 6. Write the `style_guide`

- `voice`: describe the register in one line.
- `sentence_structure`: cap sentence length, active vs passive,
  nominalization guidance.
- `forbidden_terms`: list every corporate cliché, hedge, or vernacular
  the style rejects. Be specific — `"leverage" (as verb)` becomes two
  entries in this v0.1 (the linter is a string-match scan):
  `to leverage`, `leveraging`.

### 7. Choose `output_targets`

Pick at minimum one of `pdf`, `docx`, `md`. All three are safe defaults
for institutional documents.

### 8. Choose the `sourcing_policy`

- `strict` (default): every fact must be sourced. Recommended for any
  format that will be read by external stakeholders.
- `permissive`: internal drafts, exploratory notes.

### 9. Validate locally

```bash
bun run cli formats validate formats/your-new-format.yaml
```

If it fails, every issue is listed with its path. Fix them all, then run
again.

### 10. Add an integrity test

Open `tests/formats/formats-integrity.test.ts` and add a targeted test
for your format alongside the existing three:

```ts
test("your-new-format.yaml loads and validates", () => {
  const f = loadFormatFile(resolve(FORMATS, "your-new-format.yaml"));
  expect(f.id).toBe("your-new-format");
  expect(f.sections.map((s) => s.id)).toEqual([
    // ordered section ids you expect
  ]);
});
```

Also update the `registry contains exactly the three shipped v0.1 formats`
test — its list needs your new id.

### 11. Update `README.md` and `CHANGELOG.md`

- `README.md`: add the format to any list of shipped formats.
- `CHANGELOG.md`: add an `Added` entry under the current unreleased
  section (or a new one).

### 12. Run the full check

```bash
bunx tsc --noEmit
bun test
bun run cli formats list
```

All three must be green.

---

## Anti-patterns to avoid

- **Vague `purpose` strings.** "Introduces the topic" is useless. Say
  what the section decides.
- **`required_agents: [synthesis]` everywhere.** Synthesis only runs
  well when the section's evidence has already been produced by another
  agent. If the section calls for facts, name `research`. If it calls
  for a rebuttal, name `adversarial`.
- **`forbidden_terms` as a wish list.** Only add a term if you have seen
  a real briefing damaged by it.
- **`validation_rules` that do not match `key: value` shape.** The
  validator will reject `"must be crisp"`. Write
  `"must_be_crisp: true"`.
- **Copy-pasting an existing format's `style_guide` verbatim.** The
  style guide is the second-most differentiating field after
  `organization_style`. If both are identical to another format, you
  probably do not need a new format.

---

## Getting help

Open an issue on GitHub with the `format-proposal` label. Include the
target organization/discipline, one example real-world briefing (link or
gist), and your draft `id`.
