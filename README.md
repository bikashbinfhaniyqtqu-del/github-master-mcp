# GitHub Master MCP

A local and remote MCP server that gives compatible AI clients tools to open, inspect, edit, test, commit, and manage GitHub repositories.

**Two connection modes are available:** local STDIO for desktop/local MCP clients, or remote Streamable HTTP at `/mcp` for clients that can connect to a remote MCP URL and send a Bearer token. Remote mode is protected by a separate high-entropy access token. The GitHub token stays on the server and is never sent to the AI client.

> Important: publishing this repository on GitHub does not automatically make it appear in an AI app's plugin directory. The AI app must support remote MCP servers and the authentication method configured here. This version uses a static Bearer access token, not a GitHub OAuth sign-in flow or an app-directory listing.

## What it can do

This release exposes the existing GitHub/project tools over either local STDIO or authenticated remote Streamable HTTP.

### Project workflow

1. `open_repository` — paste a GitHub repository URL (or a `/tree/branch` URL); clone/fetch it locally and set it as the active project.
2. `analyze_project` — inspect project manifests, scripts, README, top-level files, and Git status.
3. `list_project_files`, `read_project_file`, `search_project_code` — explore the codebase.
4. `write_project_file`, `delete_project_file` — modify local project files.
5. `git_status`, `git_diff` — review changes.
6. `run_project_script` — run allow-listed project scripts when local command execution is enabled.
7. `create_branch`, `commit_changes`, `push_branch`, `commit_and_push` — prepare and send changes to GitHub with safeguards.

### GitHub operations

- Verify the authenticated account (`github_whoami`).
- Create repositories for the authenticated user or an organization (`create_repository`).
- Create and list issues.
- Create and list pull requests; merge a pull request with confirmation.
- List GitHub Actions workflows and request a workflow run rerun with confirmation.

Repository discovery, details, branch/commit history, releases, workflow runs, and reruns are included. Repository forks are supported too. The available operations depend on the token's repository access and fine-grained permissions. This project intentionally does not expose repository deletion or arbitrary API passthrough tools.

## Requirements

- Node.js 20.6 or newer (Node 22 LTS or newer recommended).
- Git installed and available on PATH.
- A GitHub fine-grained Personal Access Token for private repositories and write operations.
- An MCP-compatible AI application that supports local STDIO or remote Streamable HTTP with Bearer-token headers.

## Install

```bash
git clone https://github.com/YOUR_USERNAME/github-master-mcp.git
cd github-master-mcp
npm install
cp .env.example .env
```

Edit `.env` and set at least:

```env
GITHUB_TOKEN=github_pat_your_token_here
GITHUB_MCP_WORKSPACE=./workspaces
GITHUB_MCP_MODE=edit
GITHUB_MCP_ALLOW_PUSH=false
GITHUB_MCP_CONFIRMATION_PHRASE=use-a-long-private-phrase-here
GITHUB_MCP_ALLOW_COMMANDS=false
GITHUB_MCP_ALLOWED_SCRIPTS=test,build,lint,typecheck,check
```

Never commit `.env`, paste your token into an AI chat, or share the confirmation phrase. `.env` is ignored by Git.


## Remote MCP deployment (Render)

Remote mode makes the MCP endpoint reachable over HTTPS so a compatible AI client can connect by URL. The endpoint is `/mcp`; `/healthz` is a public health check. Remote mode is **single-owner**: every authenticated connection uses the GitHub token configured on this server. Do not share the endpoint and access token with other people.

### 1. Prepare secrets

Install dependencies locally, then generate a separate remote access token:

```bash
npm install
npm run generate:token
```

Copy the generated value somewhere private. It is the MCP connection password; it is **not** your GitHub token. Also prepare a GitHub fine-grained PAT with access only to the repositories you intend the server to manage.

### 2. Deploy the repository

Push this project to your GitHub repository, then create a Render **Web Service** from that repository. Render can read the included `render.yaml`. In the service Environment settings, add these secrets:

- `GITHUB_TOKEN` — your GitHub fine-grained PAT.
- `GITHUB_MCP_ACCESS_TOKEN` — the generated random bearer token.
- `GITHUB_MCP_CONFIRMATION_PHRASE` — a separate private phrase used to approve destructive actions.

The blueprint sets remote HTTP mode, editing enabled, and push/command execution disabled by default. Keep those safe defaults initially. Render supplies `PORT`; the service binds to `0.0.0.0`.

When the deploy is live, your MCP URL is:

```text
https://YOUR-SERVICE.onrender.com/mcp
```

Health check:

```text
https://YOUR-SERVICE.onrender.com/healthz
```

### 3. Connect an MCP client

In an MCP client that supports remote Streamable HTTP and custom Bearer headers, connect to the `/mcp` URL and set this header:

```text
Authorization: Bearer YOUR_GITHUB_MCP_ACCESS_TOKEN
```

Some clients expose this as an Authentication/API key field instead of a custom header. Their setup screens differ; use the exact option for that client. `examples/remote-mcp.json` is only a generic configuration example, not a universal config format.

### 4. Start working

Once connected, ask the AI to open a repository URL, analyze it, and make changes. Example:

```text
Open https://github.com/OWNER/REPO. Analyze the project structure and important files.
Make the requested changes, preserve the current stack and existing behavior,
run the available checks, and show me the final diff. Do not commit or push until
I explicitly approve.
```

### Remote-mode limitations

- This is a private, single-owner remote MCP server using one GitHub PAT. It is not yet multi-user GitHub OAuth, and this code does not publish an app to any AI app directory.
- A client must support remote MCP plus the configured Bearer authentication. A URL alone does not grant access.
- Keep `GITHUB_MCP_ALLOW_PUSH=false` until you are ready. To enable pushing, set it to `true` in the host environment and redeploy; commit/push tools still require the confirmation phrase.
- Keep `GITHUB_MCP_ALLOW_COMMANDS=false`. Repository scripts can execute arbitrary code and are disabled by default.
- Render free services may sleep or restart. The working clone is not guaranteed to survive a restart; call `open_repository` again after reconnecting.
- Never place GitHub PATs, bearer tokens, or confirmation phrases in source files, commit history, or public chat.

## GitHub token permissions

Create a **fine-grained** token and limit it to only the repositories you need. For normal project editing and pushing, grant repository **Contents: Read and write**. Add only what you need for the optional tools:

- Repository creation: **Repository creation: Write** or **Administration: Write**, depending on the endpoint/account type; organization creation may require additional organization-level rights.
- Issues: **Issues: Read and write**.
- Pull requests: **Pull requests: Read and write**; merge operations also require contents write access.
- GitHub Actions list/rerun: **Actions: Read** for listing and **Actions: Write** for rerunning.
- Private repository checkout: token must include the selected repository and Contents read access.

GitHub changes its fine-grained permission requirements by endpoint. Check the live GitHub permissions reference if an endpoint returns 403/404. A token cannot grant access beyond the account's own repository/org rights.

## Connect to an AI client

The examples in `examples/` show common STDIO configuration shapes. Replace `/ABSOLUTE/PATH` with the actual absolute path to this project. The command passes the `.env` file explicitly using Node's `--env-file` option so it does not matter which directory the AI client starts in.

### Claude Desktop

Copy the contents of `examples/claude-desktop.config.json` into your Claude Desktop MCP configuration and replace the paths. Restart Claude Desktop.

### Cursor

Use the configuration in `examples/cursor.mcp.json` in your MCP configuration (commonly `.cursor/mcp.json` in a project, or the global MCP configuration UI). Replace the paths and reload MCP servers.

### OpenCode

Merge `examples/opencode.json` into your OpenCode config and replace the paths. Do not overwrite other existing config entries; merge the `mcp.github-master` object.

Other MCP-compatible hosts use the same STDIO launch command:

```bash
node --env-file=/absolute/path/github-master-mcp/.env /absolute/path/github-master-mcp/src/index.js
```

If your client supports environment variables directly, you can pass the `.env` values in its MCP server environment instead of using `--env-file`.

## How to use it in chat

After the MCP server shows as connected, paste a repository URL and ask the AI to work on it. Example:

> Open `https://github.com/owner/repository`, analyze the whole project, then redesign the settings page. Preserve the existing stack and behavior. Inspect the relevant files first, make the smallest safe changes, and show me the Git diff. Do not commit or push yet.

Then review the AI's changes using `git_status` and `git_diff`. If satisfied, explicitly ask it to commit. The tool requires your private phrase. To push, `GITHUB_MCP_ALLOW_PUSH=true` must also be enabled in your local `.env`, and the owner must provide the phrase in the conversation when approving that push.

### Useful prompt

```text
Use GitHub Master MCP. Open this repository: <PASTE_REPOSITORY_URL>
First analyze the project structure, framework, dependencies, and important flows.
Before editing, inspect the relevant files and explain the implementation plan.
Make the requested changes in the local checkout. Preserve existing UI, routes,
APIs, and features unless I specifically ask to change them. Do not fabricate
files or claim tests passed unless you ran them. Run only the available safe
checks, inspect the final diff, and do not commit or push until I explicitly approve.
```

## Security model and defaults

- **Authentication:** remote `/mcp` calls require a high-entropy Bearer token checked before MCP requests reach the tools.
- **Local checkout:** code edits are made in the selected local workspace; opening a repo does not push anything.
- **Push disabled by default:** set `GITHUB_MCP_ALLOW_PUSH=true` only when you are ready to permit remote pushes.
- **Confirmation phrase:** commit, push, PR merge, workflow rerun, and file deletion require the local phrase configured in `.env`. The owner should only disclose it in chat when approving that exact action.
- **Command execution disabled by default:** project scripts can execute repository-controlled code. Enable `GITHUB_MCP_ALLOW_COMMANDS=true` only for repositories you trust. Only script names in `GITHUB_MCP_ALLOWED_SCRIPTS` are accepted, each run has a timeout, and the GitHub token/approval phrase are stripped from the script environment. Git hooks are disabled for MCP-managed Git commands.
- **Secret-file guard:** `.env` files, private keys, certificate bundles, common credential files, `.git`, and `node_modules` are blocked from file tools; secret-like paths are also excluded from automatic commit staging.
- **Path guard:** absolute paths, parent traversal, and protected internal directories are blocked.
- **Least privilege:** use a fine-grained token restricted to selected repositories and minimum permissions.

The confirmation phrase is an additional guard, not a replacement for the AI client's own tool-approval UI or a trusted local machine. Do not enable write/push permissions for an AI client you do not trust.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | empty | GitHub token; required for private repos and API write operations |
| `GITHUB_MCP_TRANSPORT` | `stdio` | `stdio` for local MCP or `http` for remote Streamable HTTP |
| `GITHUB_MCP_ACCESS_TOKEN` | empty | Required in HTTP mode; private Bearer token, minimum 32 characters |
| `PORT` / `GITHUB_MCP_PORT` | `10000` | HTTP listen port; Render sets `PORT` automatically |
| `GITHUB_MCP_WORKSPACE` | `~/.github-master-mcp/workspaces` | Local clone directory |
| `GITHUB_MCP_MODE` | `edit` | `read-only` blocks local file edits, branch creation, commits and pushes |
| `GITHUB_MCP_ALLOW_PUSH` | `false` | Must be `true` for push tools |
| `GITHUB_MCP_CONFIRMATION_PHRASE` | empty | Private phrase required for destructive/remote actions |
| `GITHUB_MCP_ALLOW_COMMANDS` | `false` | Enables allow-listed project scripts |
| `GITHUB_MCP_ALLOWED_SCRIPTS` | `test,build,lint,typecheck,check` | Allowed package.json script names |
| `GITHUB_MCP_MAX_FILES` | `500` | Maximum file count in a project scan |

## Troubleshooting

- **MCP server not starting:** confirm Node 20+, run `npm install`, then run `npm run check`. Check the MCP client logs. In STDIO mode, stdout is reserved for MCP protocol messages.
- **`git` not found:** install Git and make sure `git --version` works in the same environment used by your AI client.
- **401/403/404 from GitHub:** check that the token is valid, has access to that repository, and has the endpoint-specific fine-grained permissions. GitHub may return 404 for private repositories the token cannot access.
- **Remote endpoint returns 401:** confirm the client sends `Authorization: Bearer ...` and that it exactly matches `GITHUB_MCP_ACCESS_TOKEN` on the host.
- **HTTP mode does not start:** confirm `GITHUB_MCP_TRANSPORT=http`, `GITHUB_TOKEN`, and a 32+ character `GITHUB_MCP_ACCESS_TOKEN` are set.
- **Private clone fails:** confirm `GITHUB_TOKEN` is set on the server, has Contents read access, and includes that repository.
- **Push blocked:** confirm local changes are committed, `GITHUB_MCP_ALLOW_PUSH=true`, the configured phrase is set, and the token has Contents write access.
- **Command execution blocked:** by design. Set `GITHUB_MCP_ALLOW_COMMANDS=true` only for a trusted repo and allow the needed script name.

## Git author setup

Before creating commits, configure your Git author once on the machine if it is not already set:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Development

```bash
npm run check
npm test
```

## License

MIT. See [LICENSE](LICENSE).
