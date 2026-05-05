import { expect } from "vitest";
import type { Envelope, FailureEnvelope } from "../../src/types.js";

/**
 * Returns the most recent argument tuple passed to a Vitest mock. Structural
 * typing — accepts anything with `.mock.calls`. Throws if the mock has not
 * been called yet so ordering bugs fail fast instead of returning undefined.
 */
export function lastCall<TArgs extends unknown[]>(
  mock: { mock: { calls: TArgs[] } },
): TArgs {
  const calls = mock.mock.calls;
  if (calls.length === 0) {
    throw new Error("lastCall: mock has not been called");
  }
  return calls[calls.length - 1];
}

/**
 * Asserts that an Envelope is a failure and narrows its type accordingly.
 * Replaces the `expect(env.ok).toBe(false); if (env.ok) return;` boilerplate.
 */
export function expectFailure<T>(env: Envelope<T>): asserts env is FailureEnvelope {
  expect(env.ok).toBe(false);
  if (env.ok) {
    throw new Error("expectFailure: envelope is success");
  }
}
