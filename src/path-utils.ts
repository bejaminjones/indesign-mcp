import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Expand a leading `~/` to the user's home directory, then resolve to an
 * absolute path. Bare `~` (no slash) is left as-is — that's a literal
 * file/dir name in some contexts.
 */
export function resolveUserPath(input: string): string {
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return resolve(input);
}
