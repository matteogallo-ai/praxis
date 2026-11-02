/**
 * Masks secrets and personal data in text the CLI writes to stderr.
 *
 * Applied once, at the stderr sink installed by `run()`, so every message —
 * progress, errors carrying a provider's response body, a question echoed
 * back — goes through it, including ones added later.
 */

/** Environment variables whose values are secrets wherever they appear. */
const SECRET_ENV = ["ANTHROPIC_API_KEY"] as const;

/** Shorter values are too likely to match ordinary text. */
const MIN_SECRET_LENGTH = 8;

export function redactSecrets(
  text: string,
  env: Record<string, string | undefined> = process.env
): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const value = env[name];
    if (value !== undefined && value.length >= MIN_SECRET_LENGTH) {
      out = out.split(value).join("[redacted]");
    }
  }
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-[redacted]");
  out = out.replace(/(x-api-key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1$2[redacted]");
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  const home = env["HOME"];
  if (home !== undefined && home.length > 1) out = out.split(home).join("~");
  return out;
}

/**
 * Runs `fn` with `process.stderr.write` routed through `redactSecrets`,
 * restoring the previous writer afterwards.
 */
export async function withRedactedStderr<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stderr.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) =>
    (write as (...a: unknown[]) => boolean).call(
      process.stderr,
      typeof chunk === "string" ? redactSecrets(chunk) : chunk,
      ...rest
    )) as typeof process.stderr.write;
  try {
    return await fn();
  } finally {
    process.stderr.write = write;
  }
}
