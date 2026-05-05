import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Envelope } from "./types.js";
import type { Logger } from "./logger.js";
import { ToolRegistry } from "./tools/registry.js";
import { fail } from "./errors.js";

export interface CreateServerOptions {
  registry: ToolRegistry;
  logger: Logger;
}

export function createServer(opts: CreateServerOptions): Server {
  const { registry, logger } = opts;

  const server = new Server(
    { name: "indesign-mcp", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const tool = registry.get(name);
    if (!tool) {
      const env = fail("invalid_args", `unknown tool: ${name}`);
      return toMcpResult(env);
    }
    const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const env = fail("invalid_args", parsed.error.message);
      logger.error("invalid_args", { name, error: parsed.error.format() });
      return toMcpResult(env);
    }
    const callId = `${name}-${Date.now()}`;
    await logger.info("tool_call", { id: callId, name, args: parsed.data });
    try {
      const env = await tool.handler(parsed.data);
      await logger.info("tool_result", { id: callId, ok: env.ok });
      return toMcpResult(env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logger.error("tool_threw", { id: callId, message });
      return toMcpResult(fail("script_error", `tool handler threw: ${message}`));
    }
  });

  return server;
}

function toMcpResult(env: Envelope<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(env) }],
    isError: !env.ok,
  };
}
