import type { ErrorKind, Envelope, ToolError } from "./types.js";

export type { ErrorKind } from "./types.js";

export function ok<T = void>(result?: T): Envelope<T> {
  return result === undefined
    ? { ok: true }
    : { ok: true, result };
}

export function fail(
  kind: ErrorKind,
  message: string,
  extra: Partial<Omit<ToolError, "kind" | "message">> = {},
): Envelope<never> {
  return { ok: false, error: { kind, message, ...extra } };
}
