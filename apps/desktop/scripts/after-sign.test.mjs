import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { Arch, MacPackager } from 'app-builder-lib'
import { MacTargetHelper } from 'app-builder-lib/internal'
import { test } from 'vitest'

import { adhocSignIfUnsigned } from './after-sign.mjs'

const require = createRequire(import.meta.url)
const config = require('../electron-builder.config.cjs')
const desktop = path.resolve(import.meta.dirname, '..')

const codesign = (...args) => childProcess.spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' })

// An x64 Electron app as the builder leaves it without a Developer ID: a real
// Mach-O executable with no signature at all.
function unsignedApp(root) {
  const app = path.join(root, 'Hermes.app')
  const executable = path.join(app, 'Contents', 'MacOS', 'Hermes')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.copyFileSync('/usr/bin/true', executable)
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Hermes</string>
<key>CFBundleIdentifier</key><string>com.example.hermes-fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`)
  assert.equal(codesign('--remove-signature', executable).status, 0)
  assert.match(codesign('--display', app).stderr, /not signed at all/)
  return app
}

function builderPackager() {
  const packager = {
    config,
    info: { getWorkspaceRoot: async () => path.resolve(desktop, '../..') },
    appInfo: { productFilename: 'Hermes', type: 'module' },
    buildResourcesDir: path.join(desktop, 'build'),
    resourceList: Promise.resolve([]),
    expandArch: value => [value],
    // The builder's real dispatch, as electron-builder runs it for `identity: '-'`.
    doSign: MacPackager.prototype.doSign
  }
  packager.helper = new MacTargetHelper(packager)
  return packager
}

test.skipIf(process.platform !== 'darwin')('an app no Developer ID signed leaves afterSign signed ad-hoc, and a signed app is left alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-sign-'))
  try {
    const app = unsignedApp(root)
    const context = { appOutDir: root, arch: Arch.x64, packager: builderPackager() }

    assert.equal(await adhocSignIfUnsigned(context, { log: () => {} }), true)
    const signed = codesign('--display', '--verbose=2', app).stderr
    assert.match(signed, /Signature=adhoc/)
    assert.equal(codesign('--verify', '--strict', app).status, 0)
    const entitlements = codesign('--display', '--entitlements', '-', '--xml', app).stdout
    assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/)

    assert.equal(await adhocSignIfUnsigned(context, { log: () => {} }), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 60000)
