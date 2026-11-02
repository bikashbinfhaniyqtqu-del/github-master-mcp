import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { getRepository, parseGitHubRepoUrl } from './github.js';

let activeWorkspace = null;
let activeRepository = null;

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.nuxt', '.output', 'dist', 'build', 'coverage', '.venv', 'venv', '__pycache__', 'vendor', '.turbo']);
const PROTECTED_PARTS = new Set(['.git', 'node_modules']);
const SECRET_NAME = /(^|\/)(\.env($|\.)|\.npmrc$|\.pypirc$|\.netrc$|\.git-credentials$|id_(rsa|ed25519|ecdsa)$|.*\.(pem|p12|pfx|key)$|credentials\.json$|service[-_]account.*\.json$|token\.json$|aws\/credentials$)/i;

export function getActiveWorkspace() {
  if (!activeWorkspace) throw new Error('No repository is open. Call open_repository with a GitHub repository URL first.');
  return activeWorkspace;
}

export function getActiveRepository() {
  if (!activeRepository) throw new Error('No repository is open. Call open_repository first.');
  return activeRepository;
}

export function setActiveWorkspace(folder, repository) {
  activeWorkspace = folder;
  activeRepository = repository;
}

export function assertEditable() {
  if (config.mode === 'read-only') throw new Error('Server is in read-only mode. Set GITHUB_MCP_MODE=edit to enable local file changes.');
}

export function resolveWorkspacePath(relativePath, workspace = getActiveWorkspace()) {
  const candidate = String(relativePath || '').replaceAll('\\', '/');
  if (!candidate || candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) {
    throw new Error('Provide a non-empty relative path inside the opened repository.');
  }
  const segments = candidate.split('/');
  if (segments.some((segment) => segment === '..' || PROTECTED_PARTS.has(segment))) {
    throw new Error('Path traversal and protected folders (.git, node_modules) are not allowed.');
  }
  const resolved = path.resolve(workspace, candidate);
  const root = path.resolve(workspace);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Path is outside the opened repository.');
  if (isSecretPath(candidate)) throw new Error('Secret files such as .env, private keys, and credentials are blocked.');
  return resolved;
}

function gitAuthEnv(gitArgs = []) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' };
  const operation = gitArgs[0];
  const needsNetworkAuth = ['clone', 'fetch', 'push', 'ls-remote'].includes(operation);
  // Do not pass the raw token or approval phrase to local Git hooks.
  delete env.GITHUB_TOKEN;
  delete env.GITHUB_MCP_CONFIRMATION_PHRASE;
  // Repository-provided/local hooks are arbitrary code. The MCP performs explicit
  // checks instead of allowing an implicit hook to execute during commit/push.
  env.GIT_CONFIG_COUNT = needsNetworkAuth && process.env.GITHUB_TOKEN ? '2' : '1';
  env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
  env.GIT_CONFIG_VALUE_0 = process.platform === 'win32' ? 'NUL' : '/dev/null';
  if (needsNetworkAuth && process.env.GITHUB_TOKEN) {
    const auth = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64');
    env.GIT_CONFIG_KEY_1 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_1 = `AUTHORIZATION: basic ${auth}`;
  }
  return env;
}

export function runGit(args, cwd = getActiveWorkspace(), options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: gitAuthEnv(args),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs) : null;
    child.on('error', (error) => { if (timer) clearTimeout(timer); reject(new Error(`Could not start git: ${error.message}`)); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) reject(new Error(`git ${args[0]} failed (${code}): ${(stderr || stdout).trim()}`));
      else resolve({ stdout, stderr });
    });
  });
}

export async function openRepository(url, branch) {
  const parsed = parseGitHubRepoUrl(url);
  const repo = await getRepository(parsed.owner, parsed.repo);
  const folderName = `${parsed.owner}__${parsed.repo}`.replace(/[^A-Za-z0-9_.-]/g, '_');
  await fs.mkdir(config.workspaceRoot, { recursive: true });
  const folder = path.resolve(config.workspaceRoot, folderName);
  if (!folder.startsWith(path.resolve(config.workspaceRoot) + path.sep)) throw new Error('Invalid workspace folder.');

  let isGitRepo = false;
  try { await fs.access(path.join(folder, '.git')); isGitRepo = true; } catch { /* not cloned */ }
  if (isGitRepo) {
    const { stdout: origin } = await runGit(['remote', 'get-url', 'origin'], folder);
    const normalizedOrigin = origin.trim().replace(/\.git$/, '').toLowerCase();
    const expectedOrigin = parsed.cloneUrl.replace(/\.git$/, '').toLowerCase();
    if (normalizedOrigin !== expectedOrigin) throw new Error('The workspace folder already belongs to a different Git remote.');
    await runGit(['fetch', '--prune', 'origin'], folder, { timeoutMs: 120_000 });
    const requestedBranch = branch || parsed.branch;
    if (requestedBranch) {
      const localRef = await runGit(['branch', '--list', requestedBranch], folder);
      if (localRef.stdout.trim()) await runGit(['switch', requestedBranch], folder);
      else await runGit(['switch', '--track', '-c', requestedBranch, `origin/${requestedBranch}`], folder);
    }
  } else {
    try { await fs.access(folder); throw new Error(`Workspace folder already exists but is not a Git repository: ${folder}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const args = ['clone', '--depth', '1'];
    const requestedBranch = branch || parsed.branch;
    if (requestedBranch) args.push('--branch', requestedBranch);
    args.push(parsed.cloneUrl, folder);
    try { await runGit(args, config.workspaceRoot, { timeoutMs: 180_000 }); }
    catch (error) { await fs.rm(folder, { recursive: true, force: true }).catch(() => {}); throw error; }
  }

  const result = {
    fullName: parsed.fullName,
    url: repo.html_url,
    description: repo.description,
    private: repo.private,
    defaultBranch: repo.default_branch,
    currentBranch: (await runGit(['branch', '--show-current'], folder)).stdout.trim(),
    localPath: folder,
    permissions: repo.permissions || null,
    note: 'Repository is checked out locally. Local edits are not pushed until commit_and_push is explicitly enabled and confirmed.',
  };
  setActiveWorkspace(folder, { owner: parsed.owner, repo: parsed.repo, fullName: parsed.fullName, html_url: repo.html_url, default_branch: repo.default_branch });
  return result;
}

export async function walkFiles(root = getActiveWorkspace(), limit = config.maxFiles) {
  const results = [];
  async function visit(folder, relative = '') {
    if (results.length >= limit) return;
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= limit) return;
          if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(path.join(folder, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (!isSecretPath(rel)) results.push(rel);
      }
    }
  }
  await visit(root);
  return results;
}

export async function getGitStatus(workspace = getActiveWorkspace()) {
  const { stdout } = await runGit(['status', '--short', '--branch'], workspace);
  return stdout.trim() || 'Working tree clean.';
}

export function isSecretPath(rel) {
  const normalized = String(rel).replaceAll('\\', '/');
  if (normalized.split('/').at(-1).toLowerCase() === '.env.example') return false;
  return SECRET_NAME.test(normalized);
}

export function workspaceHome() {
  return config.workspaceRoot || path.join(os.homedir(), '.github-master-mcp', 'workspaces');
}
