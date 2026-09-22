// Downloads the Electron prebuilt binary without spawning any child process.
// The sandbox blocks npm lifecycle scripts (spawn EPERM), so we perform the
// download that @electron/get would have done, using pure Node APIs.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))

function log(msg) {
  process.stdout.write(`[setup-electron] ${msg}\n`)
}

function fetchFollow(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'))
    https
      .get(url, { timeout: 120000, headers: { 'user-agent': 'writer-assistant-setup' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return resolve(fetchFollow(new URL(res.headers.location, url).toString(), redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        resolve(res)
      })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('timeout'))
      })
  })
}

async function downloadBuffer(url) {
  const res = await fetchFollow(url)
  const chunks = []
  for await (const c of res) chunks.push(c)
  return Buffer.concat(chunks)
}

async function main() {
  let electronPkg
  try {
    electronPkg = require('electron/package.json')
  } catch {
    log('electron is not installed yet. Run `npm install --ignore-scripts` first.')
    process.exit(1)
  }
  const version = electronPkg.version

  const electronDir = join(root, 'node_modules', 'electron')
  const pathTxt = join(electronDir, 'path.txt')
  const distDir = join(electronDir, 'dist')

  let platformPath = 'electron.exe'
  if (process.platform === 'darwin') platformPath = 'Electron.app/Contents/MacOS/Electron'
  else if (process.platform === 'linux') platformPath = 'electron'

  if (existsSync(join(distDir, platformPath))) {
    if (!existsSync(pathTxt)) writeFileSync(pathTxt, platformPath)
    log(`already present: ${join(distDir, platformPath)}`)
    return
  }

  const arch = process.arch
  const targets = []
  if (process.platform === 'win32') {
    targets.push(`https://npmmirror.com/mirrors/electron/${version}/electron-v${version}-win32-${arch}.zip`)
    targets.push(`https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-${arch}.zip`)
  } else if (process.platform === 'darwin') {
    targets.push(`https://npmmirror.com/mirrors/electron/${version}/electron-v${version}-darwin-${arch}.zip`)
    targets.push(`https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-darwin-${arch}.zip`)
  } else {
    targets.push(`https://npmmirror.com/mirrors/electron/${version}/electron-v${version}-linux-${arch}.zip`)
    targets.push(`https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-linux-${arch}.zip`)
  }

  let zipBuf = null
  let used = null
  for (const url of targets) {
    try {
      log(`downloading ${url}`)
      zipBuf = await downloadBuffer(url)
      used = url
      log(`downloaded ${(zipBuf.length / 1048576).toFixed(1)} MB`)
      break
    } catch (err) {
      log(`failed: ${err.message}`)
    }
  }
  if (!zipBuf) {
    log('ERROR: could not download the Electron binary from any mirror.')
    process.exit(2)
  }

  const tmpZip = join(root, '.electron-download.zip')
  writeFileSync(tmpZip, zipBuf)
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })

  log('extracting...')
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${distDir}' -Force`],
      { stdio: 'inherit' }
    )
  } else {
    execFileSync('unzip', ['-oq', tmpZip, '-d', distDir], { stdio: 'inherit' })
  }
  rmSync(tmpZip, { force: true })

  if (!existsSync(join(distDir, platformPath))) {
    log(`ERROR: extracted archive missing ${platformPath}`)
    process.exit(3)
  }

  writeFileSync(pathTxt, platformPath)
  writeFileSync(join(electronDir, 'dist', 'version'), version)
  log(`OK electron ${version} ready at ${join(distDir, platformPath)}`)
}

main().catch((err) => {
  log(`FATAL ${err.stack || err.message}`)
  process.exit(1)
})
