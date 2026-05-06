import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ToolRegistry } from "./tools/registry.js";
import { createLogger, defaultLogPath } from "./logger.js";
import { registerLogger } from "./logger-singleton.js";
import { getAppVersionTool } from "./tools/get-app-version.js";
import { createDocumentTool } from "./tools/create-document.js";
import { addPageTool } from "./tools/add-page.js";
import { saveDocumentTool } from "./tools/save-document.js";
import { exportPdfTool } from "./tools/export-pdf.js";
import { createTextFrameTool } from "./tools/create-text-frame.js";

async function main() {
  const logger = createLogger(defaultLogPath());
  registerLogger(logger);
  const registry = new ToolRegistry();
  registry.register(getAppVersionTool);
  registry.register(createDocumentTool);
  registry.register(addPageTool);
  registry.register(saveDocumentTool);
  registry.register(exportPdfTool);
  registry.register(createTextFrameTool);

  const server = createServer({ registry, logger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await logger.info("server_started", { tools: registry.list().map((t) => t.name) });
}

main().catch((err) => {
  // Last-resort error: write to stderr because logger may not be initialised.
  process.stderr.write(`indesign-mcp fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
