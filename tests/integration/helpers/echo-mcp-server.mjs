#!/usr/bin/env node
/**
 * Minimal local stdio MCP server for the spec 04 integration tier —
 * spawned with `process.execPath`, no npx, no network.
 *
 * Exposes one read-only tool (`ping`) and one mutating-by-name stub
 * (`delete_file`, never actually destructive) so the test can assert the
 * namespaced keys (`echo_ping`, `echo_delete_file`) and that the default
 * approval predicate gates the mutating name but not the read-only one.
 *
 * Appends its `process.pid` to $MCP_PID_FILE once per spawn — the test
 * counts lines to prove the §3.3 singleton spawns EXACTLY one subprocess.
 */
import { appendFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

if (process.env.MCP_PID_FILE) {
  appendFileSync(process.env.MCP_PID_FILE, `${process.pid}\n`);
}

const server = new McpServer({ name: 'echo', version: '1.0.0' });

server.registerTool(
  'ping',
  { title: 'Ping', description: 'Read-only ping — always answers "pong"' },
  async () => ({ content: [{ type: 'text', text: 'pong' }] }),
);

server.registerTool(
  'delete_file',
  { title: 'Delete file (stub)', description: 'Mutating-name stub for approval-gate tests — deletes nothing' },
  async () => ({ content: [{ type: 'text', text: 'deleted (stub, nothing happened)' }] }),
);

await server.connect(new StdioServerTransport());
