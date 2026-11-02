import { config } from './config.js';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2026-03-10';

export function requireToken() {
  if (!config.token) {
    throw new Error('GITHUB_TOKEN is not configured. Add a GitHub fine-grained Personal Access Token to the MCP server environment.');
  }
}

export async function githubRequest(endpoint, options = {}) {
  const { method = 'GET', body, tokenRequired = true, headers = {} } = options;
  if (tokenRequired) requireToken();

  const response = await fetch(`${API_ROOT}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'github-master-mcp',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!response.ok) {
    const message = data && typeof data === 'object' ? data.message : String(data || response.statusText);
    const hint = response.status === 403 || response.status === 404
      ? ' Check token repository access and fine-grained permissions; private repositories may appear as 404 when access is missing.'
      : '';
    throw new Error(`GitHub API ${method} ${endpoint} failed (${response.status}): ${message}.${hint}`);
  }
  return { data, headers: response.headers };
}

export function parseGitHubRepoUrl(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('A GitHub repository URL is required.');

  let match = value.match(/^git@github\.com:([^/]+)\/([^/#?]+?)(?:\.git)?$/i);
  if (!match) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Enter a valid GitHub URL such as https://github.com/owner/repo.'); }
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
      throw new Error('Only github.com repositories are supported in this version.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('The URL must include both owner and repository name.');
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    let branch = undefined;
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) branch = decodeURIComponent(parts[3]);
    match = [value, owner, repo, branch];
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  const branch = match[3] ? decodeURIComponent(match[3]) : undefined;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('The repository URL contains an unsupported owner or repository name.');
  }
  return { owner, repo, branch, fullName: `${owner}/${repo}`, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

export async function getRepository(owner, repo) {
  const { data } = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { tokenRequired: false });
  return data;
}

export async function githubWhoAmI() {
  const { data } = await githubRequest('/user');
  return { login: data.login, name: data.name, html_url: data.html_url, plan: data.plan?.name };
}
