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
    await log.flush();

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
    await log.flush();

    const line = JSON.parse(readFileSync(path, "utf8").trim());
    expect(line.level).toBe("error");
    expect(line.event).toBe("dispatch_failed");
  });

  it("creates the parent directory if missing", async () => {
    const nestedPath = join(dir, "nested", "deeper", "server.log");
    const log = createLogger(nestedPath);
    await log.info("hello", {});
    await log.flush();
    expect(readFileSync(nestedPath, "utf8")).toContain("hello");
  });

  it("serializes concurrent writes in call order", async () => {
    const log = createLogger(path);
    const promises = Array.from({ length: 50 }, (_, i) =>
      log.info("evt", { i })
    );
    await Promise.all(promises);
    await log.flush();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    const observed = lines.map((l) => JSON.parse(l).data.i);
    expect(observed).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("does not poison the queue when an underlying write fails", async () => {
    const log = createLogger(path);

    // Suppress stderr noise from the best-effort fallback during this test.
    const originalWrite = process.stderr.write.bind(process.stderr);
    // @ts-expect-error — stub signature varies
    process.stderr.write = () => true;

    try {
      // BigInt will make JSON.stringify throw inside the queue task.
      await log.info("first", { val: 1n as unknown as number });
      // The queue must NOT be poisoned — this second call should succeed.
      await log.info("second", { ok: true });
      await log.flush();
    } finally {
      process.stderr.write = originalWrite;
    }

    const lines = readFileSync(path, "utf8").trim().split("\n");
    // Only the second write produces a usable line; the first was caught.
    const events = lines.map((l) => JSON.parse(l).event);
    expect(events).toContain("second");
  });
});
