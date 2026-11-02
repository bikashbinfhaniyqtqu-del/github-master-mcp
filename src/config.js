import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

// Load .env from the current working directory. MCP clients may launch with a different cwd,
// so production setups should pass env values directly in their MCP configuration.
dotenv.config({ quiet: true });

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const configuredWorkspace = process.env.GITHUB_MCP_WORKSPACE || path.join(os.homedir(), '.github-master-mcp', 'workspaces');

export const config = Object.freeze({
  token: process.env.GITHUB_TOKEN || '',
  workspaceRoot: path.resolve(configuredWorkspace),
  mode: (process.env.GITHUB_MCP_MODE || 'edit').toLowerCase(),
  allowPush: bool(process.env.GITHUB_MCP_ALLOW_PUSH, false),
  confirmationPhrase: process.env.GITHUB_MCP_CONFIRMATION_PHRASE || '',
  allowCommands: bool(process.env.GITHUB_MCP_ALLOW_COMMANDS, false),
  allowedScripts: new Set((process.env.GITHUB_MCP_ALLOWED_SCRIPTS || 'test,build,lint,typecheck,check')
    .split(',').map((item) => item.trim()).filter(Boolean)),
  maxFiles: Math.min(Math.max(Number.parseInt(process.env.GITHUB_MCP_MAX_FILES || '500', 10) || 500, 20), 3000),
  maxReadBytes: 512 * 1024,
  maxWriteBytes: 1024 * 1024,
  commandTimeoutMs: 120_000,
});

if (!['read-only', 'edit'].includes(config.mode)) {
  throw new Error('GITHUB_MCP_MODE must be either "read-only" or "edit".');
}
