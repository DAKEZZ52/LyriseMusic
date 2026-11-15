# 把本地 release/ 产物发布到 GitHub Release（v<version>）。
# 已存在则覆盖：先按名字删掉同名 asset，再上传；不存在则新建（先 draft，传完再发布）。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $token = (Get-Content '.keys\github_token' -Raw).Trim()
  $pkg = Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = $pkg.version
  $tag = "v$version"
  $repo = 'DAKEZZ52/LyriseMusic'

  $files = @(
    "release\LyriseMusic-$version.exe",
    "release\LyriseMusic-$version.exe.blockmap",
    'release\latest.yml',
    'release\latest.yml.sig'
  )
  foreach ($f in $files) { if (-not (Test-Path $f)) { throw "缺少发布产物：$f" } }

  # 从 CHANGELOG 摘出本版本的更新内容作为 release 正文
  $changelog = Get-Content CHANGELOG.md -Raw -Encoding UTF8
  $m = [regex]::Match($changelog, "(?s)## \[$([regex]::Escape($version))\][^\n]*\n(.*?)(?=\n## \[|\z)")
  $body = if ($m.Success) { $m.Groups[1].Value.Trim() } else { "详见 CHANGELOG.md" }

  $headers = @{ Authorization = "token $token"; 'User-Agent' = 'LyriseMusic-Publish'; Accept = 'application/vnd.github+json' }

  Write-Host "==> 目标 $tag（$repo）" -ForegroundColor Cyan

  $existing = $null
  try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers -TimeoutSec 30
    Write-Host "    已有 release id=$($existing.id)，将覆盖其同名的 asset" -ForegroundColor Yellow
  } catch {
    Write-Host '    没有现成 release，将新建' -ForegroundColor DarkGray
  }

  if ($existing) {
    $releaseId = $existing.id
    foreach ($name in @('latest.yml', 'latest.yml.sig', "LyriseMusic-$version.exe.blockmap", "LyriseMusic-$version.exe")) {
      $asset = $existing.assets | Where-Object { $_.name -eq $name }
      if ($asset) {
        Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($asset.id)" -Headers $headers -TimeoutSec 60 | Out-Null
        Write-Host "    已删除旧 asset：$name"
      }
    }
    # 覆盖时同步正文与状态
    $patch = @{ body = $body; draft = $true; name = "LyriseMusic $version" } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$repo/releases/$releaseId" -Headers $headers -Body $patch -ContentType 'application/json' -TimeoutSec 60 | Out-Null
  } else {
    $payload = @{
      tag_name         = $tag
      target_commitish = 'main'
      name             = "LyriseMusic $version"
      body             = $body
      draft            = $true
      prerelease       = $false
    } | ConvertTo-Json -Compress
    $created = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body $payload -ContentType 'application/json' -TimeoutSec 60
    $releaseId = $created.id
    Write-Host "    已创建 draft release id=$releaseId"
  }

  foreach ($f in $files) {
    $name = Split-Path $f -Leaf
    $size = [math]::Round((Get-Item $f).Length / 1MB, 2)
    Write-Host "==> 上传 $name（$size MB）" -ForegroundColor Cyan
    $out = & curl.exe -sS --fail-with-body --max-time 1800 -X POST `
      -H "Authorization: token $token" `
      -H 'User-Agent: LyriseMusic-Publish' `
      -H 'Content-Type: application/octet-stream' `
      --data-binary "@$f" `
      "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=$name" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "上传失败：$name`n$out" }
  }

  $publishPayload = @{ draft = $false } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$repo/releases/$releaseId" -Headers $headers -Body $publishPayload -ContentType 'application/json' -TimeoutSec 60 | Out-Null
  Write-Host '==> 已发布（draft=false）' -ForegroundColor Green

  $final = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers -TimeoutSec 30
  Write-Host "=== $tag assets ==="
  $final.assets | Select-Object name, size, state | Format-Table -AutoSize | Out-String | Write-Host
} finally {
  Pop-Location
}
