#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { config } from './config.js';
import { registerTools } from './tools.js';

function createServer() {
  const server = new McpServer({
    name: 'github-master-mcp',
    version: '1.1.0',
  });
  registerTools(server);
  return server;
}

process.on('uncaughtException', (error) => {
  console.error(`[github-master-mcp] Uncaught error: ${error.message}`);
  process.exitCode = 1;
});
process.on('unhandledRejection', (error) => {
  console.error(`[github-master-mcp] Unhandled rejection: ${error instanceof Error ? error.message : String(error)}`);
});

if (config.transport === 'http') {
  const { startHttpServer } = await import('./http.js');
  await startHttpServer();
} else {
  // STDIO remains available for local clients and backwards compatibility.
  serveStdio(createServer);
}
