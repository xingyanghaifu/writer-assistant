#!/usr/bin/env pwsh
# Windows one-click packaging script (v3 P4)
# Usage: from repo root run  .\scripts\build-win.ps1
# ASCII-only to survive GBK PowerShell terminals.
# (If blocked by ExecutionPolicy, prefer scripts\build-win.cmd)

$ErrorActionPreference = 'Stop'

Write-Host "[1/4] Type check..." -ForegroundColor Cyan
& npx tsc -p tsconfig.node.json --noEmit
& npx tsc -p tsconfig.web.json --noEmit

Write-Host "[2/4] electron-vite build..." -ForegroundColor Cyan
& npx electron-vite build

Write-Host "[3/4] electron-builder (Windows NSIS + zip)..." -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
& npx electron-builder --win nsis

Write-Host "[4/4] Done." -ForegroundColor Green
Write-Host "Artifacts in release/:" -ForegroundColor Green
Get-ChildItem release -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB,1)}} | Format-Table | Out-String | Write-Host