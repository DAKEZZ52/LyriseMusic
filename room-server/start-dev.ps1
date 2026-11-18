# 本地起语聊房后端（开发用）
#
#   .\start-dev.ps1               # 默认 3001 端口
#   .\start-dev.ps1 -Port 3010    # 换端口
#
# 没设置的环境变量会用开发默认值；已经设置的一律沿用，
# 方便临时指到真实 LiveKit 上调试。
# 数据落在 .dev-data/（已在 .gitignore 里），不会进仓库。
param([int]$Port = 3001)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$dataDir = Join-Path $PSScriptRoot '.dev-data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

if (-not $env:LK_API_KEY) { $env:LK_API_KEY = 'devkey' }
if (-not $env:LK_API_SECRET) { $env:LK_API_SECRET = 'devsecret' }
if (-not $env:LK_HTTP_URL) { $env:LK_HTTP_URL = 'http://127.0.0.1:7880' }
if (-not $env:LK_WS_URL) { $env:LK_WS_URL = 'ws://127.0.0.1:7880' }
if (-not $env:DATA_FILE) { $env:DATA_FILE = './.dev-data/rooms.json' }
if (-not $env:DB_FILE) { $env:DB_FILE = './.dev-data/users.db' }

# JWT 密钥与管理员口令哈希只在第一次生成后复用，
# 否则每次重启都会让已发出的 token 失效。
$secretFile = Join-Path $dataDir 'jwt-secret.txt'
if (-not $env:JWT_SECRET) {
  if (Test-Path $secretFile) {
    $env:JWT_SECRET = (Get-Content $secretFile -Raw).Trim()
  } else {
    $env:JWT_SECRET = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
    Set-Content -Path $secretFile -Value $env:JWT_SECRET -NoNewline -Encoding ASCII
    Write-Host '已生成新的 JWT_SECRET 并保存到 .dev-data/jwt-secret.txt' -ForegroundColor DarkGray
  }
}

$hashFile = Join-Path $dataDir 'admin-hash.txt'
if (-not $env:ADMIN_HASH) {
  if (Test-Path $hashFile) {
    $env:ADMIN_HASH = (Get-Content $hashFile -Raw).Trim()
  } else {
    $env:ADMIN_HASH = (node -e "console.log(require('bcrypt').hashSync('devadmin',10))")
    Set-Content -Path $hashFile -Value $env:ADMIN_HASH -NoNewline -Encoding ASCII
    Write-Host '管理员口令是 devadmin（哈希已保存到 .dev-data/admin-hash.txt）' -ForegroundColor DarkGray
  }
}

$env:PORT = "$Port"

Write-Host "语聊房后端启动：http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host '本地没有 LiveKit 时，房间列表/消息接口可用，进房语音会连不上。' -ForegroundColor DarkGray
node index.js
