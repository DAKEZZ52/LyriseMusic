<#
.SYNOPSIS
  一次构建，分发两边：腾讯云（主更新源）+ GitHub Release（兜底源）

.DESCRIPTION
  GitHub Release 的产物已改由本机上传，CI 不再构建发布（见 .github/workflows/build.yml）。
  根本原因：更新清单要用 .keys/build-ed25519.pem 签名，而私钥只留在本地、不进 CI。

  两个渠道用同一份 release/ 产物，脚本最后会比对两边 latest.yml 的 sha512，
  不一致就直接报错——避免再出现「同一版本号、两个不同二进制」。

.EXAMPLE
  .\publish-all.ps1            # 用 release/ 里现成的产物发两边
  .\publish-all.ps1 -Build     # 先重新打包，再发两边
#>
param([switch]$Build)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $pkg = Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = $pkg.version
  $repo = 'DAKEZZ52/LyriseMusic'
  Write-Host "==> 发布 $version 到两个渠道" -ForegroundColor Cyan

  Write-Host ''
  Write-Host '--- 1/3 腾讯云（主源）---' -ForegroundColor Cyan
  try {
    if ($Build) { & "$PSScriptRoot\publish-release.ps1" -Build }
    else { & "$PSScriptRoot\publish-release.ps1" }
  } catch {
    throw "腾讯云发布失败，已中止（GitHub 这侧没有动）：$($_.Exception.Message)"
  }

  Write-Host ''
  Write-Host '--- 2/3 GitHub Release（兜底源）---' -ForegroundColor Cyan
  try {
    & "$PSScriptRoot\publish-github-release.ps1"
  } catch {
    throw "GitHub 发布失败（腾讯云那侧已完成，客户端主更新链路不受影响）：$($_.Exception.Message)"
  }

  Write-Host ''
  Write-Host '--- 3/3 校验两边是同一份产物 ---' -ForegroundColor Cyan
  $localSha = [regex]::Match((Get-Content 'release\latest.yml' -Raw), '(?m)^sha512:\s*(\S+)').Groups[1].Value
  if (-not $localSha) { throw '本地 latest.yml 里没找到 sha512' }

  $ghUrl = "https://github.com/$repo/releases/download/$version/latest.yml"
  $remoteSha = ''
  for ($i = 1; $i -le 6; $i++) {
    $gh = (& curl.exe -sSL --max-time 30 $ghUrl) -join "`n"
    $remoteSha = [regex]::Match($gh, '(?m)^sha512:\s*(\S+)').Groups[1].Value
    if ($remoteSha -eq $localSha) { break }
    Write-Host "    第 $i 次读到的 GitHub 清单还没更新，5 秒后重试…" -ForegroundColor DarkGray
    Start-Sleep -Seconds 5
  }
  if ($remoteSha -ne $localSha) {
    throw "两边 sha512 不一致`n本地:   $localSha`nGitHub: $remoteSha"
  }
  Write-Host "    两边 sha512 一致：$($localSha.Substring(0, 16))…" -ForegroundColor Green

  Write-Host ''
  Write-Host "发布完成：$version" -ForegroundColor Green
} finally {
  Pop-Location
}
