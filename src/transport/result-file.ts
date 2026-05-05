import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Envelope } from "../types.js";
import { fail } from "../errors.js";
import { runOsascript } from "./osascript.js";
import { RESULT_PATH_SENTINEL } from "../compose.js";

// Minimal envelope schema: validates shape, not the inner result/error payload
// (those are tool-specific). Catches truthy-but-wrong envelopes from scripts.
const EnvelopeSchema = z.union([
  z.object({
    ok: z.literal(true),
    result: z.unknown().optional(),
    document_state_delta: z.unknown().optional(),
    warnings: z.array(z.string()).optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      kind: z.string(),
      message: z.string(),
    }).passthrough(),
  }),
]);

export interface RunScriptInput {
  language: "AppleScript" | "JavaScript";
  /** Script body. Occurrences of `RESULT_PATH_SENTINEL` are replaced with
   *  the absolute temp file path before execution. */
  scriptTemplate: string;
  timeoutMs?: number;
}

const TEMP_PREFIX = "indesign-mcp-";

export async function runScriptWithResultFile<T = unknown>(
  input: RunScriptInput,
): Promise<Envelope<T>> {
  const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const resultPath = join(dir, "result.json");

  try {
    const script = input.scriptTemplate.replaceAll(RESULT_PATH_SENTINEL, resultPath);
    const dispatch = await runOsascript({
      language: input.language,
      script,
      timeoutMs: input.timeoutMs,
    });

    if (dispatch.kind === "timeout") {
      return fail("timeout", "osascript dispatch exceeded timeout") as Envelope<T>;
    }
    if (dispatch.kind === "spawn_error") {
      return fail("io_error", `osascript spawn failed: ${dispatch.message}`) as Envelope<T>;
    }
    // dispatch.kind === "ok"
    let raw: string;
    try {
      raw = await readFile(resultPath, "utf8");
    } catch {
      // Script didn't write a result file. Use stderr as best-effort context.
      const stderrSnippet = dispatch.stderr.slice(0, 500);
      return fail(
        "script_error",
        `script did not produce a result file (exit ${dispatch.exitCode})`,
        { stack: stderrSnippet },
      ) as Envelope<T>;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return fail(
        "script_error",
        `result file was not valid JSON: ${(err as Error).message}`,
        { stack: raw.slice(0, 500) },
      ) as Envelope<T>;
    }

    const validation = EnvelopeSchema.safeParse(parsed);
    if (!validation.success) {
      return fail(
        "script_error",
        `script returned an envelope with the wrong shape: ${validation.error.message}`,
        { stack: raw.slice(0, 500) },
      ) as Envelope<T>;
    }
    return validation.data as Envelope<T>;
  } finally {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `[indesign-mcp] tempdir cleanup failed: ${dir}: ${(err as Error).message}`,
      );
    }
  }
}
