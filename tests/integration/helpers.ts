import { describe } from "vitest";

// Conditional describe — only runs when INDESIGN_MCP_INTEGRATION=1.
// Run with `npm run test:integration`. Requires InDesign 2026 running.
export const integrationGate =
  process.env.INDESIGN_MCP_INTEGRATION === "1" ? describe : describe.skip;
