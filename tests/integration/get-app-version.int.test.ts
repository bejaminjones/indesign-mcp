import { it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS } from "./helpers.js";
import { getAppVersionTool } from "../../src/tools/get-app-version.js";

integrationGate("get_app_version (integration)", () => {
  it("returns a plausible InDesign version string", async () => {
    const first = await getAppVersionTool.handler({});
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result).toBeDefined();
    // Any major version 20+: matches 21.x, 30.x, 200.x, etc.
    expect(first.result?.version).toMatch(/^[2-9]\d*\./);

    // Idempotency: a second call should also succeed.
    const second = await getAppVersionTool.handler({});
    expect(second.ok).toBe(true);
  }, INTEGRATION_TIMEOUT_MS);
});
