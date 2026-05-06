import { describe } from "vitest";
import { deflateSync } from "node:zlib";
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

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function pngCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = PNG_CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Generates a valid 1×1 transparent RGBA PNG using Node's stdlib zlib.
 * Used by integration tests that need a real image to place — InDesign 2026
 * validates PNGs strictly (rejects malformed IDAT length / wrong CRC).
 */
export function tinyPngBytes(): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const idat = deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
