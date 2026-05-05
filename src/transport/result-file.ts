import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Envelope } from "../types.js";
import { fail } from "../errors.js";
import { runOsascript } from "./osascript.js";

export interface RunScriptInput {
  language: "AppleScript" | "JavaScript";
  /** Script body. Occurrences of the literal `RESULT_PATH` are replaced
   *  with the absolute temp file path before execution. */
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
    const script = input.scriptTemplate.replaceAll("RESULT_PATH", resultPath);
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

    // Trust the script's envelope shape — it's our own contract.
    return parsed as Envelope<T>;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
