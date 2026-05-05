import type { Logger } from "./logger.js";

let registered: Logger | undefined;

/**
 * Register the process-wide logger. Called once from index.ts at startup.
 * Subsequent calls overwrite (useful for tests).
 */
export function registerLogger(logger: Logger): void {
  registered = logger;
}

/**
 * Returns the registered logger, or undefined if none has been registered.
 * Modules that want to log must handle the undefined case (best-effort).
 */
export function getLogger(): Logger | undefined {
  return registered;
}

/**
 * Test helper: clears the registered logger. Use in afterEach.
 */
export function clearLogger(): void {
  registered = undefined;
}
