import { spawn } from "node:child_process";

export interface OsascriptInput {
  language: "AppleScript" | "JavaScript";
  script: string;
  timeoutMs?: number;
}

export type OsascriptResult =
  | { kind: "ok"; stdout: string; stderr: string; exitCode: number }
  | { kind: "timeout"; partialStdout: string; partialStderr: string }
  | { kind: "spawn_error"; message: string };

const DEFAULT_TIMEOUT_MS = 30_000;

export function runOsascript(input: OsascriptInput): Promise<OsascriptResult> {
  const args =
    input.language === "JavaScript" ? ["-l", "JavaScript", "-e", input.script] : ["-e", input.script];

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      child = spawn("osascript", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({
        kind: "spawn_error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ kind: "timeout", partialStdout: stdout, partialStderr: stderr });
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ kind: "ok", stdout, stderr, exitCode: code ?? -1 });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ kind: "spawn_error", message: err.message });
    });
  });
}
