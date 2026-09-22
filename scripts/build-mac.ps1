#!/usr/bin/env pwsh
# macOS 一键打包脚本（v3 P4）
# 用法：在仓库根目录执行 .\scripts\build-mac.ps1
# 产物：release/写作副驾-1.3.0-x64.dmg 等

$ErrorActionPreference = 'Stop'

Write-Host "[1/4] Type check..." -ForegroundColor Cyan
& npx tsc -p tsconfig.node.json --noEmit
& npx tsc -p tsconfig.web.json --noEmit

Write-Host "[2/4] Electron-vite build..." -ForegroundColor Cyan
& npx electron-vite build

Write-Host "[3/4] electron-builder (macOS dmg + zip)..." -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
& npx electron-builder --mac dmg zip

Write-Host "[4/4] 完成。" -ForegroundColor Green
Write-Host "产物在 release/ 目录：" -ForegroundColor Green
Get-ChildItem release -Filter "*.dmg" | Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB,1)}} | Format-Table | Out-String | Write-Host