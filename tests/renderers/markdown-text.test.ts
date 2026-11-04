/**
 * plainText: model text a GFM viewer shows as written. The expected strings
 * were checked against micromark (GFM) and marked: none renders a link or an
 * image, and the text reads as the model wrote it.
 */
import { describe, expect, test } from "bun:test";

import { plainText } from "../../src/renderers/markdown-text.ts";

describe("plainText — no link, image or autolink outside code spans", () => {
  test.each([
    ["an inline link", "See [a](https://x.example) now", "See \\[a\\](https\\://x.example) now"],
    ["an image", "![i](https://x.example/p.png)", "!\\[i\\](https\\://x.example/p.png)"],
    ["a reference definition", "[1]: https://x.example", "\\[1\\]: https\\://x.example"],
    ["a www. autolink, in any case", "www.x.example, WWW.y.example, Www.z.example", "www\\.x.example, WWW\\.y.example, Www\\.z.example"],
    ["a scheme autolink", "ftp://x.example and HTTPS://y.example", "ftp\\://x.example and HTTPS\\://y.example"],
    ["an e-mail autolink", "mail ceo@x.example or mailto:a@b.example", "mail ceo\\@x.example or mailto:a\\@b.example"],
    ["a backslash the model wrote", "\\[a](https://x.example)", "\\\\\\[a\\](https\\://x.example)"],
  ])("%s", (_, input, expected) => {
    expect(plainText(input)).toBe(expected);
  });

  test("emphasis, lists and markers stay Markdown", () => {
    expect(plainText("**Bold** _it_\n\n- one\n- two [1]")).toBe("**Bold** _it_\n\n- one\n- two \\[1\\]");
  });

  test("a code span keeps its text: nothing in it is a link", () => {
    expect(plainText("`www.x.example [a](u)` then www.y.example")).toBe("`www.x.example [a](u)` then www\\.y.example");
    expect(plainText("``a ` www.x.example``")).toBe("``a ` www.x.example``");
  });

  // Text read as code would be left live; read as text, it only shows a backslash.
  test("a backtick that opens no span on its line leaves the rest text", () => {
    expect(plainText("`a www.x.example")).toBe("`a www\\.x.example");
    expect(plainText("- a `x\n- b www.y.example`")).toBe("- a `x\n- b www\\.y.example`");
    expect(plainText("``a` www.x.example")).toBe("``a` www\\.x.example");
  });

  test("a backslash before a backtick is escaped, so the span the scan sees is the viewer's", () => {
    expect(plainText("\\`www.x.example`")).toBe("\\\\`www.x.example`");
  });

  test("empty text stays empty", () => {
    expect(plainText("")).toBe("");
  });
});
