import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript } from "../compose.js";

const InputSchema = z.object({}).strict();

interface Result {
  version: string;
}

const SCRIPT_BODY = `
return { version: String(app.version) };
`.trim();

export const getAppVersionTool = defineTool<Record<string, never>, Result>({
  name: "get_app_version",
  description:
    "Returns the version string of the running InDesign application. Requires InDesign 2026 to be open.",
  inputSchema: InputSchema,
  async handler() {
    const scriptTemplate = wrapExtendScript(SCRIPT_BODY);
    return runScriptWithResultFile<Result>({
      language: "JavaScript",
      scriptTemplate,
    });
  },
});
