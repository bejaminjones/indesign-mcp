import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../src/logger.js";

describe("createLogger", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "indesign-mcp-log-"));
    path = join(dir, "server.log");
  });

  it("writes one JSON line per log call", async () => {
    const log = createLogger(path);
    await log.info("tool_call", { name: "ping", id: "1" });
    await log.info("tool_result", { id: "1", ok: true });
    await log.close();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.event).toBe("tool_call");
    expect(first.level).toBe("info");
    expect(first.data).toEqual({ name: "ping", id: "1" });
    expect(typeof first.ts).toBe("string");
  });

  it("error level is recorded distinctly", async () => {
    const log = createLogger(path);
    await log.error("dispatch_failed", { reason: "no app" });
    await log.close();

    const line = JSON.parse(readFileSync(path, "utf8").trim());
    expect(line.level).toBe("error");
    expect(line.event).toBe("dispatch_failed");
  });

  it("creates the parent directory if missing", async () => {
    const nestedPath = join(dir, "nested", "deeper", "server.log");
    const log = createLogger(nestedPath);
    await log.info("hello", {});
    await log.close();
    expect(readFileSync(nestedPath, "utf8")).toContain("hello");
  });
});
