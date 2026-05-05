import { it, expect } from "vitest";
import { integrationGate } from "./helpers.js";
import { getAppVersionTool } from "../../src/tools/get-app-version.js";

integrationGate("get_app_version (integration)", () => {
  it("returns InDesign 2026's version when the app is running", async () => {
    const env = await getAppVersionTool.handler({});
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(typeof env.result?.version).toBe("string");
    // 2026's version line begins with 21.x. Accept any 21+ to allow point updates.
    expect(env.result?.version).toMatch(/^2[1-9]\./);
  }, 30_000);
});
