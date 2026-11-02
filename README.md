# GitHub Master MCP

A local-first MCP server that gives MCP-compatible AI clients tools to open, inspect, edit, test, commit, and manage GitHub repositories.

**No hosting, VPS, public server, or database is required.** The MCP server runs locally over STDIO. Repositories are cloned to your computer, and edits happen in that local checkout. Changes reach GitHub only when you explicitly enable and approve a push.

> Important: this is for AI applications that support MCP servers. Pasting a repository URL into a chat app that does not support MCP will not grant that app access. Configure this server in the AI client first.

## What it can do

This release exposes **30 MCP tools** across local project editing and GitHub management.

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
- An MCP-compatible AI application that supports local STDIO servers.

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

- **Local STDIO only:** the MCP server does not listen on a network port.
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
| `GITHUB_MCP_WORKSPACE` | `~/.github-master-mcp/workspaces` | Local clone directory |
| `GITHUB_MCP_MODE` | `edit` | `read-only` blocks local file edits, branch creation, commits and pushes |
| `GITHUB_MCP_ALLOW_PUSH` | `false` | Must be `true` for push tools |
| `GITHUB_MCP_CONFIRMATION_PHRASE` | empty | Private phrase required for destructive/remote actions |
| `GITHUB_MCP_ALLOW_COMMANDS` | `false` | Enables allow-listed project scripts |
| `GITHUB_MCP_ALLOWED_SCRIPTS` | `test,build,lint,typecheck,check` | Allowed package.json script names |
| `GITHUB_MCP_MAX_FILES` | `500` | Maximum file count in a project scan |

## Troubleshooting

- **MCP server not starting:** confirm Node 20+, run `npm install`, then run `npm run check`. Check the MCP client's logs; STDIO stdout must be reserved for the MCP protocol.
- **`git` not found:** install Git and make sure `git --version` works in the same environment used by your AI client.
- **401/403/404 from GitHub:** check that the token is valid, has access to that repository, and has the endpoint-specific fine-grained permissions. GitHub may return 404 for private repositories the token cannot access.
- **Private clone fails:** confirm `GITHUB_TOKEN` is passed to the MCP process, has Contents read access, and includes that repository.
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
