# GitHub Master MCP — Hinglish Quick Start

Bhai, ab GitHub Master ke do modes hain:

- **STDIO:** local computer/Termux par chalne wala MCP.
- **Remote HTTP:** Render jaise host par public HTTPS MCP URL; client ko URL ke saath Bearer token dena hoga.

Ye remote version single-owner hai: server par set GitHub token se hi repositories access hongi. Public URL akela access nahi deta.

## 1) GitHub token banao

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.

Sirf wahi repositories select karo jinhe manage karna hai. Project file read/edit/push ke liye **Contents: Read and write** aur **Metadata: Read** minimum hain. Issues, Pull Requests, Actions aur repository creation ke liye un features ki permission alag se enable karo.

## 2) Remote access token generate karo

Project folder mein:

```bash
npm install
npm run generate:token
```

Jo random token print hoga use private jagah save karo. Ye `GITHUB_TOKEN` se alag hai. Isko kisi public chat ya GitHub source code mein mat daalna.

## 3) Render par deploy karo

1. Is updated project ko apne GitHub repo mein push karo.
2. Render → New → Web Service → apna repo select karo.
3. Render `render.yaml` se service setup kar sakta hai.
4. Render ke Environment section mein ye 3 secret variables set karo:

```env
GITHUB_TOKEN=your_github_fine_grained_token
GITHUB_MCP_ACCESS_TOKEN=the_generated_random_token
GITHUB_MCP_CONFIRMATION_PHRASE=your_own_private_confirmation_phrase
```

Baaki defaults safe hain: `GITHUB_MCP_ALLOW_PUSH=false` aur `GITHUB_MCP_ALLOW_COMMANDS=false`.

Deploy complete hone ke baad MCP URL hoga:

```text
https://YOUR-SERVICE.onrender.com/mcp
```

Health check:

```text
https://YOUR-SERVICE.onrender.com/healthz
```

## 4) AI app mein connect karo

AI app ko remote MCP / Streamable HTTP support karna chahiye. MCP server URL mein `/mcp` do aur Authentication/Bearer Token ya custom headers mein ye set karo:

```text
Authorization: Bearer YOUR_GITHUB_MCP_ACCESS_TOKEN
```

Har AI app ka connect karne ka UI alag hota hai. Kuch apps custom Bearer header allow nahi karte. Ye setup abhi GitHub OAuth one-click login ya AI app directory listing nahi hai.

## 5) Chat mein use karo

```text
Open this repository: https://github.com/OWNER/REPO
Analyze the full project structure, framework, dependencies and important files.
Then make the changes I ask for. Preserve the existing stack and features.
Run available checks and show me the final diff. Do not commit or push until I approve.
```

AI `open_repository`, `analyze_project`, `list_project_files`, `read_project_file`, `search_project_code` aur `write_project_file` tools use karega.

## 6) Commit / Push

Push default mein disabled hai. Jab ready ho tab Render Environment mein:

```env
GITHUB_MCP_ALLOW_PUSH=true
```

set karke redeploy karo. Commit/push phir bhi confirmation phrase maangenge. Project commands default mein disabled hi rakho; unhe enable karne se repository scripts code execute kar sakti hain.

## Important safety

- GitHub PAT, remote Bearer token aur confirmation phrase ko kabhi repository mein commit mat karna.
- Access token kisi aur ko mat dena; is version mein sab authenticated clients same single-owner GitHub account use karte hain.
- Render free service sleep/restart ho sakti hai. Restart ke baad repository ko `open_repository` se phir kholna pad sakta hai.
- ChatGPT Free custom write-enabled MCP connect nahi kar sakta. Har AI client ka remote MCP/auth support alag hai.
