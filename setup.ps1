$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$nodeVersion = node -p "process.versions.node"
$parts = $nodeVersion.Split('.')
if ([int]$parts[0] -lt 20 -or ([int]$parts[0] -eq 20 -and [int]$parts[1] -lt 6)) {
  throw "Node.js 20.6+ is required. Current version: $nodeVersion"
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git is required. Install Git and rerun this script.'
}

npm install
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from .env.example. Add your GitHub token and private confirmation phrase.'
} else {
  Write-Host 'Existing .env preserved.'
}
Write-Host 'Setup complete. Configure your MCP client using the examples/ directory.'
Write-Host 'Keep GITHUB_MCP_ALLOW_PUSH=false until you are ready to enable pushes.'
