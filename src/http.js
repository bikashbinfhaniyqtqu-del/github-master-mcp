import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { config } from './config.js';
import { bearerTokenMatches } from './auth.js';
import { registerTools } from './tools.js';

const MCP_PATH = '/mcp';

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

export async function startHttpServer() {
  if (!config.accessToken || config.accessToken.length < 32) {
    throw new Error('Remote mode requires GITHUB_MCP_ACCESS_TOKEN with at least 32 characters. Generate one with: npm run generate:token');
  }
  if (!config.token) {
    throw new Error('Remote mode requires GITHUB_TOKEN to be configured on the server.');
  }

  // The MCP SDK creates a fresh server instance for each stateless HTTP exchange.
  // Repository workspace state is retained by the single-owner workspace manager.
  const mcpHandler = createMcpHandler(() => {
    const server = new McpServer({ name: 'github-master-mcp', version: '1.1.0' });
    registerTools(server);
    return server;
  });
  const nodeMcpHandler = toNodeHandler(mcpHandler);

  const httpServer = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;

    if (pathname === '/healthz' && request.method === 'GET') {
      return sendJson(response, 200, { ok: true, service: 'github-master-mcp', transport: 'streamable-http' });
    }

    if (pathname === '/' && request.method === 'GET') {
      return sendJson(response, 200, {
        name: 'GitHub Master MCP',
        transport: 'Streamable HTTP',
        endpoint: MCP_PATH,
        health: '/healthz',
        authentication: 'Bearer token required',
      });
    }

    if (pathname !== MCP_PATH) {
      return sendJson(response, 404, { error: 'Not found' });
    }

    // CORS is needed by browser-based MCP hosts. Access still requires the
    // private bearer token; no cookies or ambient credentials are accepted.
    const origin = request.headers.origin;
    response.setHeader('Access-Control-Allow-Origin', origin || '*');
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
    response.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      return response.end();
    }

    if (!['GET', 'POST', 'DELETE'].includes(request.method || '')) {
      response.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
      return sendJson(response, 405, { error: 'Method not allowed' });
    }

    if (!bearerTokenMatches(request.headers.authorization, config.accessToken)) {
      return sendJson(response, 401, { error: 'Unauthorized. Supply the configured bearer token.' }, {
        'WWW-Authenticate': 'Bearer realm="github-master-mcp"',
      });
    }

    try {
      Promise.resolve(nodeMcpHandler(request, response)).catch((error) => {
        console.error(`[github-master-mcp] HTTP handler error: ${error.message}`);
        if (!response.headersSent) sendJson(response, 500, { error: 'Internal MCP server error' });
        else response.destroy();
      });
    } catch (error) {
      console.error(`[github-master-mcp] HTTP handler error: ${error.message}`);
      if (!response.headersSent) sendJson(response, 500, { error: 'Internal MCP server error' });
      else response.destroy();
    }
  });

  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 60_000;
  httpServer.keepAliveTimeout = 65_000;

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  console.error(`[github-master-mcp] Remote MCP endpoint listening at http://${config.host}:${config.port}${MCP_PATH}`);
  console.error('[github-master-mcp] Bearer authentication is enabled. Never share the access token in public.');

  const shutdown = async () => {
    httpServer.close();
    await mcpHandler.close();
  };
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });

  return httpServer;
}
