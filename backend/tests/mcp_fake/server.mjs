// Fake MCP stdio server for backend/tests/mcp.test.ts (Workstream 17).
// Run under Deno: deno run --quiet --no-check server.mjs [flags]
//   --fail: exit(1) before the handshake (tests MCP_UNREACHABLE)
//   --hang: consume stdin forever without answering (tests MCP_TIMEOUT)
//   --with-error-tool: also register `error`, a tool that always answers isError
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const args = Deno.args;

if (args.includes("--fail")) {
  console.error("fake mcp server: exiting before handshake (--fail)");
  Deno.exit(1);
}

if (args.includes("--hang")) {
  // Keep the event loop busy forever (a bare `await new Promise(() => {})`
  // makes Deno exit with "Top-level await promise never resolved").
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

const server = new McpServer({ name: "fake-mcp", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Returns the given text unchanged (read-only).",
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true },
  },
  ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] }),
);

server.registerTool(
  "boom",
  {
    description: "Simulates a mutating operation (no readOnlyHint).",
    inputSchema: {},
  },
  () => ({ content: [{ type: "text", text: "boom-done" }] }),
);

server.registerTool(
  "structured",
  {
    description: "Returns a structuredContent payload (read-only).",
    inputSchema: { value: z.number() },
    annotations: { readOnlyHint: true },
  },
  ({ value }) => ({
    structuredContent: { doubled: value * 2 },
    content: [{ type: "text", text: "structured" }],
  }),
);

server.registerTool(
  "slowpoke",
  {
    description: "Sleeps 30 seconds (for timeout tests).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    return { content: [{ type: "text", text: "slow" }] };
  },
);

if (args.includes("--with-error-tool")) {
  server.registerTool(
    "error",
    {
      description: "Always fails (isError) — for error-handling tests.",
      inputSchema: {},
    },
    () => ({ content: [{ type: "text", text: "tool-level failure" }], isError: true }),
  );
}

await server.connect(new StdioServerTransport());
