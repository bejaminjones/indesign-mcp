import { describe, it, expect } from "vitest";
import { runOsascript } from "../../src/transport/osascript.js";

describe("runOsascript", () => {
  it("runs a trivial AppleScript and returns stdout", async () => {
    const result = await runOsascript({
      language: "AppleScript",
      script: 'return "hello"',
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("runs trivial JavaScript and returns stdout", async () => {
    const result = await runOsascript({
      language: "JavaScript",
      script: '"world"',
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.stdout.trim()).toBe("world");
  });

  it("captures non-zero exit codes as kind: ok with the failing exit", async () => {
    // AppleScript that explicitly errors
    const result = await runOsascript({
      language: "AppleScript",
      script: 'error "boom" number 1234',
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("boom");
  });

  it("returns kind: timeout when the script exceeds timeoutMs", async () => {
    const result = await runOsascript({
      language: "AppleScript",
      script: "delay 5",
      timeoutMs: 200,
    });
    expect(result.kind).toBe("timeout");
  });
});
