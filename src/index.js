#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'github-master-mcp',
  version: '1.0.0',
});

registerTools(server);

// STDIO is deliberate: no web server, public endpoint, VPS, or hosting is needed.
// Do not write logs to stdout; stdout is reserved for MCP protocol messages.
process.on('uncaughtException', (error) => {
  console.error(`[github-master-mcp] Uncaught error: ${error.message}`);
  process.exitCode = 1;
});
process.on('unhandledRejection', (error) => {
  console.error(`[github-master-mcp] Unhandled rejection: ${error instanceof Error ? error.message : String(error)}`);
});

serveStdio(() => server);
