import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ToolRegistry } from "./tools/registry.js";
import { createLogger, defaultLogPath } from "./logger.js";
import { getAppVersionTool } from "./tools/get-app-version.js";

async function main() {
  const logger = createLogger(defaultLogPath());
  const registry = new ToolRegistry();
  registry.register(getAppVersionTool);

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
