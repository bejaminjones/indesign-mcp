import { describe } from "vitest";
import { wrapExtendScript } from "../../src/compose.js";
import { runScriptWithResultFile } from "../../src/transport/result-file.js";

// Conditional describe — only runs when INDESIGN_MCP_INTEGRATION=1.
// Run with `npm run test:integration`. Requires InDesign 2026 running.
export const integrationGate =
  process.env.INDESIGN_MCP_INTEGRATION === "1" ? describe : describe.skip;

// Generous timeout to accommodate cold InDesign launches.
export const INTEGRATION_TIMEOUT_MS = 60_000;

/**
 * Closes every open InDesign document without saving. Call from `afterEach`
 * to give each integration test a clean slate. Idempotent — succeeds even
 * when no documents are open.
 */
export async function closeAllDocuments(): Promise<void> {
  const body = `
    while (app.documents.length > 0) {
      app.documents[0].close(SaveOptions.NO);
    }
    return { closed: true };
  `;
  const scriptTemplate = wrapExtendScript(body);
  await runScriptWithResultFile<{ closed: boolean }>({
    language: "JavaScript",
    scriptTemplate,
  });
}
