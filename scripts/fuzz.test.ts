import { describe, expect, test } from "bun:test";

import { parseFuzzArgs } from "./fuzz.ts";

describe("parseFuzzArgs", () => {
  test("takes a time budget and a seed", () => {
    expect(parseFuzzArgs(["--seconds", "600", "--seed", "42"])).toEqual({ seconds: 600, seed: 42 });
  });

  test("defaults to 60 seconds and a fresh seed", () => {
    const args = parseFuzzArgs([]);
    expect("seconds" in args && args.seconds).toBe(60);
    expect("seed" in args && Number.isInteger(args.seed)).toBe(true);
  });

  test("refuses unknown flags, missing values and non-positive or fractional numbers", () => {
    for (const argv of [["--time", "5"], ["--seconds"], ["--seconds", "0"], ["--seed", "1.5"], ["--seconds", "x"]]) {
      expect(parseFuzzArgs(argv)).toHaveProperty("error");
    }
  });
});
