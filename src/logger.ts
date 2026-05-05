import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Logger {
  info(event: string, data: Record<string, unknown>): Promise<void>;
  error(event: string, data: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
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
      await ensureDir();
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        data,
      });
      await appendFile(path, line + "\n", "utf8");
    });
    return queue;
  };

  return {
    info: (event, data) => write("info", event, data),
    error: (event, data) => write("error", event, data),
    close: () => queue,
  };
}

export function defaultLogPath(): string {
  const home = process.env.HOME ?? "";
  return `${home}/Library/Logs/indesign-mcp/server.log`;
}
