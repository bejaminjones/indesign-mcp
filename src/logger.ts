import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Logger {
  info(event: string, data: Record<string, unknown>): Promise<void>;
  error(event: string, data: Record<string, unknown>): Promise<void>;
  flush(): Promise<void>;
}

type Level = "info" | "error";

export function createLogger(path: string): Logger {
  let ensured = false;
  let queue: Promise<void> = Promise.resolve();

  const ensureDir = async () => {
    if (ensured) return;
    await mkdir(dirname(path), { recursive: true });
    ensured = true;
  };

  const write = (level: Level, event: string, data: Record<string, unknown>) => {
    queue = queue.then(async () => {
      try {
        await ensureDir();
        const line = JSON.stringify({
          ts: new Date().toISOString(),
          level,
          event,
          data,
        });
        await appendFile(path, line + "\n", "utf8");
      } catch (err) {
        // Best-effort: surface to stderr, don't poison the queue.
        process.stderr.write(`[logger] write failed: ${(err as Error).message}\n`);
      }
    });
    return queue;
  };

  return {
    info: (event, data) => write("info", event, data),
    error: (event, data) => write("error", event, data),
    flush: () => queue,
  };
}

export function defaultLogPath(): string {
  const home = process.env.HOME ?? "";
  return `${home}/Library/Logs/indesign-mcp/server.log`;
}
