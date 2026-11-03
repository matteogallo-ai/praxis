#!/usr/bin/env bun
/**
 * Runs the JSON-extraction fuzzer (`tests/fuzz/json-extraction.fuzz.ts`) for
 * a time budget. The test suite runs it briefly with a fixed seed; this runs
 * it for longer with a fresh seed, printed so a failure can be replayed.
 *
 *   bun run fuzz                          # 60 s, random seed
 *   bun run fuzz -- --seconds 600 --seed 42
 */
import fc from "fast-check";

import { checkExtraction, fuzzInput } from "../tests/fuzz/json-extraction.fuzz.ts";

export function parseFuzzArgs(argv: readonly string[]): { seconds: number; seed: number } | { error: string } {
  let seconds = 60;
  let seed = Math.floor(Math.random() * 2 ** 31);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = Number(argv[i + 1]);
    const min = flag === "--seconds" ? 1 : 0;
    if ((flag !== "--seconds" && flag !== "--seed") || !Number.isInteger(value) || value < min) {
      return { error: "usage: bun run fuzz -- [--seconds <positive integer>] [--seed <non-negative integer>]" };
    }
    if (flag === "--seconds") seconds = value;
    else seed = value;
    i++;
  }
  return { seconds, seed };
}

if (import.meta.main) {
  const args = parseFuzzArgs(process.argv.slice(2));
  if ("error" in args) {
    process.stderr.write(`${args.error}\n`);
    process.exit(2);
  }
  process.stdout.write(`fuzzing extractJsonText for ${args.seconds} s, seed ${args.seed}\n`);
  const details = fc.check(fc.property(fuzzInput, (raw) => checkExtraction(raw)), {
    seed: args.seed,
    numRuns: Number.MAX_SAFE_INTEGER,
    interruptAfterTimeLimit: args.seconds * 1000,
  });
  if (details.failed) {
    process.stderr.write(`${fc.defaultReportMessage(details) ?? "failed"}\n`);
    process.exit(1);
  }
  process.stdout.write(`${details.numRuns} inputs, no failure\n`);
}
