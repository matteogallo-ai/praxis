/**
 * The `brief` flags that control a run rather than what it produces:
 * `--resume <run-id>`, `--runs-dir <path>`, `--max-cost-usd <n>` and
 * `--price-table <path>`, and the clock (`PRAXIS_NOW`). They are taken out
 * of the argument list before the briefing flags are parsed; `--resume` puts back the question and
 * format recorded in the run, and `--full`, so a resumed run cannot drift
 * from the one it continues.
 */
import { CheckpointStore } from "../orchestrator/checkpoint.ts";

export interface RunArgs {
  resume: string | null;
  runsDir: string;
  maxCostUsd: number | null;
  priceTable: string | null;
  /**
   * The date freshness is judged against and the run id is stamped with:
   * `PRAXIS_NOW` when set, else the wall clock. A frozen clock makes a
   * briefing's sourcing verdicts reproducible; the test preload sets it.
   */
  now: Date;
}

/** `PRAXIS_RUNS_DIR` when set (the test preload points it at a temp dir), else `.praxis/runs`. */
function defaultRunsDir(): string {
  const fromEnv = process.env["PRAXIS_RUNS_DIR"];
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : ".praxis/runs";
}

// UTC date and time only: a bare date or a local time would be read in the
// machine's zone, and `Date` accepts looser forms and rolls 30 February over
// into March, hence the round-trip check.
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function clock(): Date | { error: string } {
  const fromEnv = process.env["PRAXIS_NOW"];
  if (fromEnv === undefined || fromEnv.length === 0) return new Date();
  const at = new Date(fromEnv);
  if (!UTC_INSTANT.test(fromEnv) || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 19) !== fromEnv.slice(0, 19)) {
    return { error: `PRAXIS_NOW expects a UTC date and time, e.g. 2026-08-20T00:00:00Z; got "${fromEnv}"` };
  }
  return at;
}

const VALUE_FLAGS = ["--resume", "--runs-dir", "--max-cost-usd", "--price-table"] as const;

export function extractRunArgs(
  args: readonly string[]
): { rest: string[]; run: RunArgs } | { error: string } {
  const values: Partial<Record<(typeof VALUE_FLAGS)[number], string>> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const flag = VALUE_FLAGS.find((f) => a === f || a.startsWith(`${f}=`));
    if (flag === undefined) {
      rest.push(a);
      continue;
    }
    const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
    if (value === undefined || value.length === 0) return { error: `${flag} expects a value` };
    values[flag] = value;
  }
  let maxCostUsd: number | null = null;
  if (values["--max-cost-usd"] !== undefined) {
    maxCostUsd = Number(values["--max-cost-usd"]);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      return { error: "--max-cost-usd expects a positive number of US dollars" };
    }
  }
  const now = clock();
  if (!(now instanceof Date)) return now;
  return {
    rest,
    run: {
      now,
      resume: values["--resume"] ?? null,
      runsDir: values["--runs-dir"] ?? defaultRunsDir(),
      maxCostUsd,
      priceTable: values["--price-table"] ?? null,
    },
  };
}

/**
 * The argument list a resumed run is parsed from: the recorded question and
 * format, plus `--full`. A question or format given again must match.
 */
export function resumeArgs(rest: readonly string[], store: CheckpointStore): string[] | { error: string } {
  const { question, format_id: formatId, run_id: runId } = store.manifest;
  const out = [...rest];
  const formatAt = out.findIndex((a) => a === "--format" || a.startsWith("--format="));
  if (formatAt === -1) {
    out.push("--format", formatId);
  } else {
    const flag = out[formatAt] as string;
    const given = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : out[formatAt + 1];
    if (given !== formatId) {
      return { error: `--resume ${runId}: the run used --format ${formatId}, not ${given ?? "(none)"}` };
    }
  }
  const flagsWithValue = new Set(["--format", "--provider", "--output", "--render", "--theme", "--on-sourcing-failure"]);
  const positional = out.filter((a, i) => !a.startsWith("--") && !flagsWithValue.has(out[i - 1] ?? ""));
  if (positional.length === 0) out.unshift(question);
  else if (positional.length > 1 || positional[0] !== question) {
    return { error: `--resume ${runId}: the run's question is "${question}"; leave it out or repeat it exactly` };
  }
  if (!out.includes("--full")) out.push("--full");
  return out;
}
