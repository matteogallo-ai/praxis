import { PRAXIS_VERSION } from "../version-constant.ts";

export function versionCommand(): number {
  process.stdout.write(`praxis v${PRAXIS_VERSION}\n`);
  return 0;
}
