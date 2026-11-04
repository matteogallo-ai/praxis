import { describe, expect, test } from "bun:test";

import { renderedTargets } from "./markdown-inert.ts";

// The check must see every way rendered HTML can point at the host, or a
// regression in inert() could pass it.
describe("renderedTargets", () => {
  test.each([
    ["a Markdown link", "[x](https://a.attacker.example)"],
    ["an image", "![x](https://a.attacker.example/p.png)"],
    ["an autolink", "www.a.attacker.example"],
    ["raw HTML, single quotes", "<a href='https://a.attacker.example'>x</a>"],
    ["raw HTML, unquoted", "<img src=https://a.attacker.example/p.png>"],
    ["raw HTML, upper case", '<A HREF="https://a.attacker.example">x</A>'],
    ["a host written with entities", '<a href="https://a.attacker&#46;example">x</a>'],
    ["a host in another case", "[x](https://a.ATTACKER.example)"],
  ])("finds %s", (_, md) => {
    expect(renderedTargets(md, "attacker.example").length).toBe(1);
  });

  test("plain text and the front matter are not targets", () => {
    expect(renderedTargets('---\nq: "www.attacker.example"\n---\n\nwww\\.attacker.example', "attacker.example")).toEqual([]);
  });
});
