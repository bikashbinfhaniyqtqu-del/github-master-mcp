import fs from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { githubRequest, githubWhoAmI } from './github.js';
import {
  assertEditable, getActiveRepository, getActiveWorkspace, getGitStatus, isSecretPath,
  openRepository, resolveWorkspacePath, runGit, walkFiles,
} from './workspace.js';

function textResult(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function tool(handler) {
  return async (args) => {
    try { return textResult(await handler(args || {})); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: `Error: ${error.message}` }] }; }
  };
}

function requirePhrase(value, action) {
  if (!config.confirmationPhrase || config.confirmationPhrase.startsWith('CHANGE-THIS-')) {
    throw new Error('Set a private GITHUB_MCP_CONFIRMATION_PHRASE in your local .env before using this destructive action.');
  }
  if (value !== config.confirmationPhrase) {
    throw new Error(`Confirmation required. Ask the account owner to explicitly approve ${action} and provide their locally configured confirmation phrase.`);
  }
}

function requirePushEnabled() {
  if (!config.allowPush) throw new Error('Git push is disabled. Set GITHUB_MCP_ALLOW_PUSH=true in your local MCP environment after reviewing the risks.');
}

function requireRepoApiPermissionsHint() {
  return 'The token must have access to this repository and the endpoint-specific fine-grained permissions.';
}

async function assertNoSymlinkPath(rel, workspace = getActiveWorkspace()) {
  const normalized = String(rel).replaceAll('\\', '/');
  let current = workspace;
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment);
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw new Error('Symbolic-link paths are blocked to prevent escaping the local repository workspace.');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

async function readTextFile(rel, workspace = getActiveWorkspace()) {
  await assertNoSymlinkPath(rel, workspace);
  const absolute = resolveWorkspacePath(rel, workspace);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error('The requested path is not a file.');
  if (stat.size > config.maxReadBytes) throw new Error(`File is too large (${stat.size} bytes). Maximum is ${config.maxReadBytes} bytes.`);
  return await fs.readFile(absolute, 'utf8');
}

async function runScript(script, manager) {
  if (!config.allowCommands) throw new Error('Project command execution is disabled. Set GITHUB_MCP_ALLOW_COMMANDS=true only for repositories you trust.');
  if (!config.allowedScripts.has(script)) throw new Error(`Script "${script}" is not allow-listed. Allowed: ${[...config.allowedScripts].join(', ')}.`);

  const workspace = getActiveWorkspace();
  const packageFile = path.join(workspace, 'package.json');
  let pkg;
  try { pkg = JSON.parse(await fs.readFile(packageFile, 'utf8')); }
  catch { throw new Error('No valid package.json found. This command runner currently supports Node.js package scripts only.'); }
  if (!pkg.scripts || typeof pkg.scripts[script] !== 'string') throw new Error(`package.json does not define a "${script}" script.`);

  const lockfiles = {
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
    bun: 'bun.lock',
  };
  let selected = manager;
  if (selected === 'auto') {
    selected = pkg.packageManager?.split('@')[0] || 'npm';
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(selected)) selected = 'npm';
    if (!pkg.packageManager) {
      for (const [name, file] of Object.entries({ pnpm: lockfiles.pnpm, bun: lockfiles.bun, yarn: lockfiles.yarn, npm: lockfiles.npm })) {
        try { await fs.access(path.join(workspace, file)); selected = name; break; } catch { /* next */ }
      }
      if (selected === 'bun') { try { await fs.access(path.join(workspace, 'bun.lockb')); } catch { /* bun.lock is current */ } }
    }
  }
  const command = selected === 'pnpm' ? 'pnpm' : selected === 'yarn' ? 'yarn' : selected === 'bun' ? 'bun' : 'npm';
  const args = command === 'yarn' ? ['run', script] : command === 'bun' ? ['run', script] : ['run', script];

  return await new Promise((resolve, reject) => {
    const commandEnv = { ...process.env };
    delete commandEnv.GITHUB_TOKEN;
    delete commandEnv.GITHUB_MCP_CONFIRMATION_PHRASE;
    delete commandEnv.GITHUB_MCP_ALLOW_PUSH;
    const child = spawn(command, args, { cwd: workspace, env: commandEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 100_000) stdout = stdout.slice(-100_000); });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 100_000) stderr = stderr.slice(-100_000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), config.commandTimeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`Could not start ${command}: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ command: `${command} ${args.join(' ')}`, exitCode: code, timedOut: code === null, stdout, stderr, success: code === 0 });
    });
  });
}

async function stageSafeChanges() {
  const workspace = getActiveWorkspace();
  const { stdout } = await runGit(['status', '--porcelain=v1', '--untracked-files=all'], workspace);
  const rows = stdout.split(/\r?\n/).filter(Boolean);
  const safe = [];
  const skipped = [];
  for (const row of rows) {
    const rawPath = row.slice(3).split(' -> ').at(-1).replace(/^"|"$/g, '');
    if (!rawPath) continue;
    if (isSecretPath(rawPath)) { skipped.push(rawPath); continue; }
    safe.push(rawPath);
  }
  if (!safe.length) throw new Error('No safe, stageable changes were found.');
  const unique = [...new Set(safe)];
  await runGit(['add', '-A', '--', ...unique.map((file) => `./${file}`)], workspace);
  const { stdout: staged } = await runGit(['diff', '--cached', '--name-only'], workspace);
  const stagedPaths = staged.split(/\r?\n/).filter(Boolean);
  const unsafe = stagedPaths.filter(isSecretPath);
  if (unsafe.length) {
    await runGit(['reset', '--', ...unsafe.map((file) => `./${file}`)], workspace);
    throw new Error(`Sensitive files were detected in the staged set and have been unstaged: ${unsafe.join(', ')}`);
  }
  return { staged: stagedPaths, skipped };
}

export function registerTools(server) {
  server.registerTool('github_whoami', {
    description: 'Verify the configured GitHub token and show the authenticated GitHub account.',
    inputSchema: z.object({}),
  }, tool(async () => await githubWhoAmI()));

  server.registerTool('list_repositories', {
    description: 'List repositories accessible to the authenticated GitHub user, sorted by most recently updated.',
    inputSchema: z.object({ visibility: enumSchema(['all', 'public', 'private']), limit: optionalNumber() }),
  }, tool(async ({ visibility = 'all', limit = 50 }) => {
    const { data } = await githubRequest(`/user/repos?visibility=${visibility}&sort=updated&per_page=${Math.min(Math.max(limit, 1), 100)}`);
    return data.map((item) => ({ fullName: item.full_name, url: item.html_url, private: item.private, defaultBranch: item.default_branch, updatedAt: item.updated_at, description: item.description }));
  }));

  server.registerTool('fork_repository', {
    description: 'Create a fork of the active repository under the authenticated user or a specified organization.',
    inputSchema: z.object({ organization: optionalString() }),
  }, tool(async ({ organization }) => {
    const repo = getActiveRepository();
    const endpoint = `/repos/${repo.owner}/${repo.repo}/forks`;
    const { data } = await githubRequest(endpoint, { method: 'POST', body: organization ? { organization } : {} });
    return { fullName: data.full_name, url: data.html_url, message: 'Fork requested. GitHub may complete fork creation asynchronously.' };
  }));

  server.registerTool('get_repository_details', {
    description: 'Get the current active repository metadata and permissions from GitHub.',
    inputSchema: z.object({}),
  }, tool(async () => {
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}`);
    return { fullName: data.full_name, url: data.html_url, description: data.description, private: data.private, defaultBranch: data.default_branch, language: data.language, topics: data.topics, permissions: data.permissions, archived: data.archived, openIssues: data.open_issues_count };
  }));

  server.registerTool('create_repository', {
    description: 'Create a new GitHub repository for the authenticated user, or under an organization when organization is provided.',
    inputSchema: z.object({
      name: awaitlessString(), description: optionalString(), isPrivate: optionalBoolean(), autoInit: optionalBoolean(), organization: optionalString(),
    }),
  }, tool(async ({ name, description = '', isPrivate = true, autoInit = true, organization }) => {
    const pathName = organization ? `/orgs/${encodeURIComponent(organization)}/repos` : '/user/repos';
    const { data } = await githubRequest(pathName, { method: 'POST', body: {
      name, description, private: isPrivate, auto_init: autoInit,
    } });
    return { name: data.full_name, url: data.html_url, private: data.private, defaultBranch: data.default_branch, message: 'Repository created. Use open_repository with the returned URL to edit it locally.' };
  }));

  server.registerTool('open_repository', {
    description: 'Open a GitHub repository from its URL. Clones it to the local workspace and makes it the active project for subsequent project tools. Accepts repository URLs and /tree/branch URLs.',
    inputSchema: z.object({ url: awaitlessString(), branch: optionalString() }),
  }, tool(async ({ url, branch }) => await openRepository(url, branch)));

  server.registerTool('analyze_project', {
    description: 'Analyze the currently open repository: project type, manifests, README, file tree, likely scripts, and Git status. Open a repository first.',
    inputSchema: z.object({}),
  }, tool(async () => {
    const workspace = getActiveWorkspace();
    const repo = getActiveRepository();
    const files = await walkFiles(workspace);
    const manifests = ['package.json', 'pnpm-workspace.yaml', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json'];
    const detected = [];
    const excerpts = {};
    for (const file of manifests) {
      try {
        const content = await readTextFile(file, workspace);
        detected.push(file);
        if (file === 'package.json') {
          const pkg = JSON.parse(content);
          excerpts.package = { name: pkg.name, version: pkg.version, description: pkg.description, scripts: pkg.scripts || {}, dependencies: Object.keys(pkg.dependencies || {}).slice(0, 40), devDependencies: Object.keys(pkg.devDependencies || {}).slice(0, 40) };
        } else excerpts[file] = content.slice(0, 8000);
      } catch (error) { if (error.code !== 'ENOENT') { /* invalid/large manifests are skipped */ } }
    }
    for (const readme of ['README.md', 'readme.md', 'README.rst']) {
      try { excerpts.readme = (await readTextFile(readme, workspace)).slice(0, 8000); break; } catch { /* next */ }
    }
    return {
      repository: repo,
      localPath: workspace,
      projectFiles: files.length,
      fileLimitReached: files.length >= config.maxFiles,
      manifests: detected,
      projectMetadata: excerpts,
      topLevelFiles: files.filter((file) => !file.includes('/')).slice(0, 100),
      importantFolders: [...new Set(files.filter((file) => file.includes('/')).map((file) => file.split('/')[0]))].slice(0, 40),
      gitStatus: await getGitStatus(workspace),
      guidance: 'Use list_project_files/read_project_file/search_project_code for targeted inspection. Do not assume skipped build/dependency folders are absent from the repository.',
    };
  }));

  server.registerTool('list_project_files', {
    description: 'List tracked and untracked text-project files in the open repository. Dependency/build folders and secret-like files are excluded.',
    inputSchema: z.object({ limit: optionalNumber() }),
  }, tool(async ({ limit = config.maxFiles }) => {
    const files = await walkFiles(getActiveWorkspace(), Math.min(Math.max(limit, 1), config.maxFiles));
    return { count: files.length, files, note: 'Hidden files except .github and generated/dependency directories are intentionally excluded.' };
  }));

  server.registerTool('read_project_file', {
    description: 'Read a UTF-8 text file in the open repository. Paths are repository-relative; secrets and paths outside the repository are blocked.',
    inputSchema: z.object({ path: awaitlessString() }),
  }, tool(async ({ path: relativePath }) => ({ path: relativePath, content: await readTextFile(relativePath) })));

  server.registerTool('write_project_file', {
    description: 'Create or replace a UTF-8 file in the open repository. This changes only the local checkout; it does not push to GitHub.',
    inputSchema: z.object({ path: awaitlessString(), content: awaitlessString() }),
  }, tool(async ({ path: relativePath, content }) => {
    assertEditable();
    if (Buffer.byteLength(content, 'utf8') > config.maxWriteBytes) throw new Error(`Content exceeds ${config.maxWriteBytes} bytes.`);
    await assertNoSymlinkPath(relativePath);
    const absolute = resolveWorkspacePath(relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await assertNoSymlinkPath(relativePath);
    await fs.writeFile(absolute, content, 'utf8');
    return { path: relativePath, bytesWritten: Buffer.byteLength(content, 'utf8'), localOnly: true };
  }));

  server.registerTool('delete_project_file', {
    description: 'Delete a repository file locally. Requires the owner confirmation phrase. Cannot delete Git metadata or secret files.',
    inputSchema: z.object({ path: awaitlessString(), confirmationPhrase: awaitlessString() }),
  }, tool(async ({ path: relativePath, confirmationPhrase }) => {
    assertEditable();
    requirePhrase(confirmationPhrase, `deleting ${relativePath}`);
    await assertNoSymlinkPath(relativePath);
    const absolute = resolveWorkspacePath(relativePath);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error('Only files can be deleted with this tool.');
    await fs.unlink(absolute);
    return { deleted: relativePath, localOnly: true };
  }));

  server.registerTool('search_project_code', {
    description: 'Search repository text files for a literal or regular-expression pattern. Does not search secrets, dependencies, or generated folders.',
    inputSchema: z.object({ query: awaitlessString(), useRegex: optionalBoolean(), caseSensitive: optionalBoolean(), maxMatches: optionalNumber() }),
  }, tool(async ({ query, useRegex = false, caseSensitive = false, maxMatches = 100 }) => {
    const files = await walkFiles(getActiveWorkspace());
    const flags = caseSensitive ? 'g' : 'gi';
    let pattern;
    try { pattern = new RegExp(useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags); }
    catch (error) { throw new Error(`Invalid regular expression: ${error.message}`); }
    const matches = [];
    for (const file of files) {
      if (matches.length >= Math.min(Math.max(maxMatches, 1), 500)) break;
      let content;
      try { content = await readTextFile(file); } catch { continue; }
      if (content.includes('\0')) continue;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        pattern.lastIndex = 0;
        if (pattern.test(lines[index])) {
          matches.push({ file, line: index + 1, text: lines[index].slice(0, 500) });
          if (matches.length >= Math.min(Math.max(maxMatches, 1), 500)) break;
        }
      }
    }
    return { query, count: matches.length, matches };
  }));

  server.registerTool('git_status', {
    description: 'Show Git branch and working-tree status for the active repository.', inputSchema: z.object({}),
  }, tool(async () => await getGitStatus()));

  server.registerTool('git_diff', {
    description: 'Show the local diff. Use staged=false for unstaged changes and staged=true for staged changes.',
    inputSchema: z.object({ staged: optionalBoolean() }),
  }, tool(async ({ staged = false }) => {
    const args = staged ? ['diff', '--cached', '--no-ext-diff', '--'] : ['diff', '--no-ext-diff', '--'];
    const { stdout } = await runGit(args);
    return stdout.slice(0, 100_000) || 'No diff found. Note: untracked files are not shown by git diff; use git_status and read_project_file for those.';
  }));

  server.registerTool('create_branch', {
    description: 'Create and switch to a new local branch in the open repository.',
    inputSchema: z.object({ branch: awaitlessString() }),
  }, tool(async ({ branch }) => {
    assertEditable();
    if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error('Invalid branch name.');
    await runGit(['switch', '-c', branch]);
    return { branch, switched: true, localOnly: true };
  }));

  server.registerTool('list_branches', {
    description: 'List branches in the active GitHub repository.',
    inputSchema: z.object({ limit: optionalNumber() }),
  }, tool(async ({ limit = 100 }) => {
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/branches?per_page=${Math.min(Math.max(limit, 1), 100)}`);
    return data.map((item) => ({ name: item.name, protected: item.protected, commitSha: item.commit.sha }));
  }));

  server.registerTool('list_commits', {
    description: 'List recent commits in the active GitHub repository, optionally filtered by branch or path.',
    inputSchema: z.object({ branch: optionalString(), path: optionalString(), limit: optionalNumber() }),
  }, tool(async ({ branch, path: filePath, limit = 20 }) => {
    const repo = getActiveRepository();
    const params = new URLSearchParams({ per_page: String(Math.min(Math.max(limit, 1), 100)) });
    if (branch) params.set('sha', branch);
    if (filePath) params.set('path', filePath);
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/commits?${params}`);
    return data.map((item) => ({ sha: item.sha, shortSha: item.sha.slice(0, 7), message: item.commit.message, author: item.commit.author?.name, date: item.commit.author?.date, url: item.html_url }));
  }));

  server.registerTool('run_project_script', {
    description: 'Run an allow-listed npm/pnpm/yarn/bun script from package.json. Disabled by default because repository scripts execute code.',
    inputSchema: z.object({ script: awaitlessString(), packageManager: enumSchema(['auto', 'npm', 'pnpm', 'yarn', 'bun']) }),
  }, tool(async ({ script, packageManager = 'auto' }) => await runScript(script, packageManager)));

  server.registerTool('commit_changes', {
    description: 'Stage safe local changes and create a local Git commit. Requires the owner confirmation phrase. Secret-like files are never staged.',
    inputSchema: z.object({ message: awaitlessString(), confirmationPhrase: awaitlessString() }),
  }, tool(async ({ message, confirmationPhrase }) => {
    assertEditable();
    requirePhrase(confirmationPhrase, 'creating a local Git commit');
    if (!message.trim() || message.length > 200) throw new Error('Commit message must be 1-200 characters.');
    const staged = await stageSafeChanges();
    await runGit(['commit', '-m', message.trim()]);
    const { stdout: sha } = await runGit(['rev-parse', '--short', 'HEAD']);
    return { commit: sha.trim(), message, staged: staged.staged, skippedSensitiveFiles: staged.skipped, localOnly: true };
  }));

  server.registerTool('push_branch', {
    description: 'Push the current local branch to origin. Requires GITHUB_MCP_ALLOW_PUSH=true and the owner confirmation phrase.',
    inputSchema: z.object({ confirmationPhrase: awaitlessString() }),
  }, tool(async ({ confirmationPhrase }) => {
    assertEditable();
    requirePushEnabled();
    requirePhrase(confirmationPhrase, 'pushing the current branch to GitHub');
    const branch = (await runGit(['branch', '--show-current'])).stdout.trim();
    if (!branch) throw new Error('Detached HEAD cannot be pushed with this tool.');
    await runGit(['push', '-u', 'origin', branch], getActiveWorkspace(), { timeoutMs: 180_000 });
    return { pushed: true, branch, repository: getActiveRepository().fullName };
  }));

  server.registerTool('commit_and_push', {
    description: 'Stage safe changes, create a commit, then push the current branch. Requires GITHUB_MCP_ALLOW_PUSH=true and the owner confirmation phrase.',
    inputSchema: z.object({ message: awaitlessString(), confirmationPhrase: awaitlessString() }),
  }, tool(async ({ message, confirmationPhrase }) => {
    assertEditable(); requirePushEnabled(); requirePhrase(confirmationPhrase, 'committing and pushing to GitHub');
    if (!message.trim() || message.length > 200) throw new Error('Commit message must be 1-200 characters.');
    const staged = await stageSafeChanges();
    await runGit(['commit', '-m', message.trim()]);
    const branch = (await runGit(['branch', '--show-current'])).stdout.trim();
    await runGit(['push', '-u', 'origin', branch], getActiveWorkspace(), { timeoutMs: 180_000 });
    const sha = (await runGit(['rev-parse', '--short', 'HEAD'])).stdout.trim();
    return { commit: sha, message, branch, pushed: true, staged: staged.staged, skippedSensitiveFiles: staged.skipped };
  }));

  server.registerTool('create_pull_request', {
    description: 'Create a pull request for the current or supplied head branch. The branch must already exist on GitHub.',
    inputSchema: z.object({ title: awaitlessString(), body: optionalString(), head: optionalString(), base: optionalString(), draft: optionalBoolean() }),
  }, tool(async ({ title, body = '', head, base, draft = false }) => {
    const repo = getActiveRepository();
    const localBranch = (await runGit(['branch', '--show-current'])).stdout.trim();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls`, { method: 'POST', body: {
      title, body, head: head || localBranch, base: base || repo.default_branch, draft,
    } });
    return { number: data.number, url: data.html_url, state: data.state, title: data.title, message: requireRepoApiPermissionsHint() };
  }));

  server.registerTool('list_issues', {
    description: 'List issues for the open repository. Pull requests are excluded from the returned issue list.',
    inputSchema: z.object({ state: enumSchema(['open', 'closed', 'all']), limit: optionalNumber() }),
  }, tool(async ({ state = 'open', limit = 30 }) => {
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/issues?state=${state}&per_page=${Math.min(Math.max(limit, 1), 100)}`);
    return data.filter((item) => !item.pull_request).map((item) => ({ number: item.number, title: item.title, state: item.state, url: item.html_url, labels: item.labels.map((label) => label.name) }));
  }));

  server.registerTool('create_issue', {
    description: 'Create an issue in the open GitHub repository.',
    inputSchema: z.object({ title: awaitlessString(), body: optionalString(), labels: stringArray() }),
  }, tool(async ({ title, body = '', labels = [] }) => {
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/issues`, { method: 'POST', body: { title, body, labels } });
    return { number: data.number, url: data.html_url, title: data.title };
  }));

  server.registerTool('list_pull_requests', {
    description: 'List pull requests in the open repository.',
    inputSchema: z.object({ state: enumSchema(['open', 'closed', 'all']), limit: optionalNumber() }),
  }, tool(async ({ state = 'open', limit = 30 }) => {
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&per_page=${Math.min(Math.max(limit, 1), 100)}`);
    return data.map((item) => ({ number: item.number, title: item.title, state: item.state, draft: item.draft, url: item.html_url, head: item.head.ref, base: item.base.ref }));
  }));

  server.registerTool('merge_pull_request', {
    description: 'Merge a pull request in the open repository. Requires owner confirmation phrase to prevent accidental merges.',
    inputSchema: z.object({ number: awaitlessNumber(), mergeMethod: enumSchema(['merge', 'squash', 'rebase']), confirmationPhrase: awaitlessString() }),
  }, tool(async ({ number, mergeMethod = 'squash', confirmationPhrase }) => {
    requirePhrase(confirmationPhrase, `merging pull request #${number}`);
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: mergeMethod } });
    return { merged: data.merged, message: data.message, sha: data.sha };
  }));

  server.registerTool('create_release', {
    description: 'Create a GitHub release in the active repository. The tag can be created from targetCommitish when needed.',
    inputSchema: z.object({ tagName: awaitlessString(), name: optionalString(), body: optionalString(), targetCommitish: optionalString(), draft: optionalBoolean(), prerelease: optionalBoolean() }),
  }, tool(async ({ tagName, name = '', body = '', targetCommitish, draft = false, prerelease = false }) => {
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases`, { method: 'POST', body: { tag_name: tagName, name, body, target_commitish: targetCommitish, draft, prerelease } });
    return { id: data.id, tagName: data.tag_name, name: data.name, url: data.html_url, draft: data.draft, prerelease: data.prerelease };
  }));

  server.registerTool('list_workflows', {
    description: 'List GitHub Actions workflows configured in the open repository.',
    inputSchema: z.object({}),
  }, tool(async () => {
    const repo = getActiveRepository();
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/actions/workflows`);
    return data.workflows.map((item) => ({ id: item.id, name: item.name, path: item.path, state: item.state, url: item.html_url }));
  }));

  server.registerTool('list_workflow_runs', {
    description: 'List recent GitHub Actions workflow runs in the active repository.',
    inputSchema: z.object({ limit: optionalNumber(), status: optionalString() }),
  }, tool(async ({ limit = 20, status }) => {
    const repo = getActiveRepository();
    const params = new URLSearchParams({ per_page: String(Math.min(Math.max(limit, 1), 100)) });
    if (status) params.set('status', status);
    const { data } = await githubRequest(`/repos/${repo.owner}/${repo.repo}/actions/runs?${params}`);
    return data.workflow_runs.map((item) => ({ id: item.id, name: item.name, event: item.event, status: item.status, conclusion: item.conclusion, branch: item.head_branch, url: item.html_url, createdAt: item.created_at }));
  }));

  server.registerTool('rerun_workflow', {
    description: 'Re-run a GitHub Actions workflow run by run ID. Requires owner confirmation phrase.',
    inputSchema: z.object({ runId: awaitlessNumber(), confirmationPhrase: awaitlessString() }),
  }, tool(async ({ runId, confirmationPhrase }) => {
    requirePhrase(confirmationPhrase, `re-running GitHub Actions run ${runId}`);
    const repo = getActiveRepository();
    await githubRequest(`/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/rerun`, { method: 'POST' });
    return { requested: true, runId };
  }));
}

// Small schema factories keep registration definitions readable.
function awaitlessString() { return z.string().min(1); }
function optionalString() { return z.string().optional(); }
function optionalBoolean() { return z.boolean().optional(); }
function optionalNumber() { return z.number().int().positive().optional(); }
function awaitlessNumber() { return z.number().int().positive(); }
function stringArray() { return z.array(z.string()).optional(); }
function enumSchema(values) { return z.enum(values).optional(); }
