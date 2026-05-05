import type { ErrorKind, Envelope, ToolError, SuccessEnvelope } from "./types.js";

export type { ErrorKind } from "./types.js";

export interface OkOptions {
  warnings?: string[];
  document_state_delta?: import("./types.js").DocumentStateDelta;
}

export function ok<T = void>(
  result?: T,
  options: OkOptions = {},
): Envelope<T> {
  const env: SuccessEnvelope<T> = { ok: true };
  if (result !== undefined) env.result = result;
  if (options.warnings !== undefined) env.warnings = options.warnings;
  if (options.document_state_delta !== undefined) env.document_state_delta = options.document_state_delta;
  return env;
}

export function fail(
  kind: ErrorKind,
  message: string,
  extra: Partial<Omit<ToolError, "kind" | "message">> = {},
): Envelope<never> {
  return { ok: false, error: { kind, message, ...extra } };
}
