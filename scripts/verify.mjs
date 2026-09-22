/**
 * 统一验证脚本（主智能体与所有子智能体共用）。
 *
 * 用法：
 *   node scripts/verify.mjs type     仅类型检查（快，子智能体用它自检）
 *   node scripts/verify.mjs build    仅构建
 *   node scripts/verify.mjs smoke    构建 + 启动 Electron 冒烟验收
 *   node scripts/verify.mjs all      全量
 *
 * 注意：build/smoke 需要 electron-vite(esbuild) 与 Electron 派生子进程，
 * 在受限沙箱下会报 spawn EPERM，必须在放开权限的运行环境执行。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mode = process.argv[2] ?? 'type'
const electronBin = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

function run(label, cmd, args, env = {}) {
  process.stdout.write(`\n=== ${label} ===\n`)
  try {
    execFileSync(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32'
    })
    return true
  } catch (err) {
    process.stdout.write(`[FAIL] ${label} (exit ${err.status ?? '?'})\n`)
    return false
  }
}

const results = []

if (mode === 'type' || mode === 'all') {
  results.push(['typecheck:main', run('typecheck main+preload', 'npx', ['tsc', '-p', 'tsconfig.node.json', '--noEmit'])])
  results.push(['typecheck:renderer', run('typecheck renderer', 'npx', ['tsc', '-p', 'tsconfig.web.json', '--noEmit'])])
}

if (mode === 'build' || mode === 'all') {
  results.push(['build', run('electron-vite build', 'npx', ['electron-vite', 'build'])])
}

if (mode === 'smoke' || mode === 'all') {
  const reports = join(root, 'reports')
  mkdirSync(reports, { recursive: true })
  const out = join(reports, 'smoke.json')
  const ok = run('electron smoke', electronBin, ['.'], {
    WA_SMOKE: '1',
    WA_SMOKE_STAGE: process.env.WA_SMOKE_STAGE ?? 'smoke',
    WA_SMOKE_OUT: out,
    ELECTRON_RUN_AS_NODE: ''
  })
  let passed = 0
  let total = 0
  if (existsSync(out)) {
    try {
      const r = JSON.parse(readFileSync(out, 'utf8'))
      passed = r.passed ?? 0
      total = r.total ?? 0
      process.stdout.write(`\n冒烟测试: ${passed}/${total} 通过\n`)
      for (const c of r.checks ?? []) {
        process.stdout.write(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' — ' + c.detail : ''}\n`)
      }
    } catch (err) {
      process.stdout.write(`读取冒烟报告失败: ${err.message}\n`)
    }
  }
  results.push(['smoke', ok && total > 0 && passed === total])
}

process.stdout.write('\n=== 汇总 ===\n')
let allOk = true
for (const [name, ok] of results) {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`)
  if (!ok) allOk = false
}
process.exit(allOk ? 0 : 1)
