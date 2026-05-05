import type { ZodTypeAny } from "zod";
import type { Envelope } from "../types.js";

export interface ToolDefinition<TInput, TResult> {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  handler: (input: TInput) => Promise<Envelope<TResult>>;
}

export type AnyToolDefinition = ToolDefinition<any, any>;

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  list(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }
}

export function defineTool<TInput, TResult>(
  def: ToolDefinition<TInput, TResult>,
): ToolDefinition<TInput, TResult> {
  return def;
}
