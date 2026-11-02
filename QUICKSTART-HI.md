# GitHub Master MCP — Hinglish Quick Start

Bhai, ye server tumhare PC/Termux par locally chalega. Isko Render/Vercel/VPS par host nahi karna hai.

## 1) Install

### Termux

```bash
pkg update -y
pkg install nodejs-lts git unzip -y
node -v
git --version
```

Node version **20.6+** honi chahiye. ZIP ko extract karke folder ke andar jao:

```bash
cd github-master-mcp
bash setup.sh
```

### Windows PowerShell

```powershell
cd github-master-mcp
.\setup.ps1
```

### Linux / macOS

```bash
cd github-master-mcp
bash setup.sh
```

## 2) GitHub token banao

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.

Sirf wahi repositories select karo jinhe AI se access dena hai. Minimum permissions:

- **Metadata: Read** — repository details.
- **Contents: Read and write** — files, branches, commits, push.
- **Issues: Read and write** — issues create/list.
- **Pull requests: Read and write** — PR create/list/merge.
- **Actions: Read and write** — workflows aur rerun.
- **Repository creation: Write** (ya GitHub endpoint ke mutabik Administration: Write) — naya repository create karne ke liye.

Har optional feature ke liye permission zaroori nahi. Sirf zaroorat wali permissions select karo.

## 3) `.env` configure karo

```bash
nano .env
```

`GITHUB_TOKEN` mein token daalo aur `GITHUB_MCP_CONFIRMATION_PHRASE` ko apne private long phrase se replace karo. Token ya phrase chat mein mat bhejna.

Starting ke liye ye safe defaults rehne do:

```env
GITHUB_MCP_MODE=edit
GITHUB_MCP_ALLOW_PUSH=false
GITHUB_MCP_ALLOW_COMMANDS=false
```

## 4) AI client mein MCP connect karo

`examples/` folder mein Claude Desktop, Cursor aur OpenCode config samples hain. Unmein `/ABSOLUTE/PATH` ko apne device ke actual folder path se replace karo.

Server launch command ye hai:

```bash
node --env-file=/absolute/path/github-master-mcp/.env /absolute/path/github-master-mcp/src/index.js
```

AI app ko isi machine/environment par local command launch kar paana chahiye. Sirf Android ChatGPT app mein repo link paste karne se local MCP apne-aap connect nahi hota; app ko MCP support aur local STDIO launch support chahiye.

## 5) Use kaise karna hai

MCP connect hone ke baad AI chat mein likho:

```text
Open this repository: https://github.com/OWNER/REPO
Analyze the project structure and existing features. Then make the changes I describe.
Preserve the current stack and existing behavior. Show me the Git diff.
Do not commit or push until I explicitly approve.
```

AI `open_repository` call karke project local clone karega. Uske baad woh files read, search aur modify kar sakta hai.

## 6) Push kab enable karna hai?

Pehle diff check karo. Push chahiye tab `.env` mein:

```env
GITHUB_MCP_ALLOW_PUSH=true
```

MCP restart karo. Commit/push tool ke liye chat mein explicitly approval dete waqt hi apna local confirmation phrase provide karo. Phrase kisi aur ko mat dena.

## Important

- MCP server hosting nahi maangta, lekin local GitHub repo clone karne ke liye internet chahiye.
- Repo edits pehle local copy mein hote hain. Push ke bina GitHub par changes publish nahi honge.
- `GITHUB_MCP_ALLOW_COMMANDS=true` sirf trusted repo par use karo; project scripts arbitrary code chala sakti hain.
- Runtime dependencies ke liye `npm install` required hai.
