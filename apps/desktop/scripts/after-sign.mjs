// electron-builder afterSign hook (macOS): ad-hoc sign an app nothing signed,
// then notarize.
//
// With a custom `mac.sign` function and no Developer ID in the keychain,
// electron-builder skips signing without a word and still runs this hook. On
// arm64 the Electron binaries carry the linker's ad-hoc signature anyway, but
// x64 Electron ships unsigned, so an Intel build came out "not signed at all".
// macOS then has no code identity to attach privacy grants to: Local Network
// access is denied with EHOSTUNREACH and no prompt, so Desktop cannot reach a
// LAN gateway. Signing ad-hoc through the builder's own dispatch (the path its
// `identity: '-'` takes) keeps the per-file entitlements, hardened runtime and
// payload digest refresh of a real signature.
import path from 'node:path'

import notarize, { runCommand } from './notarize.mjs'

/**
 * @param {string} appPath
 * @param {typeof runCommand} [run]
 */
export async function isUnsigned(appPath, run = runCommand) {
  try {
    await run('codesign', ['--display', appPath])
    return false
  } catch (/** @type {any} */ error) {
    if (/code object is not signed at all/.test(String(error.stderr ?? ''))) return true
    throw error
  }
}

/**
 * @param {{ appOutDir: string, arch: number, packager: any }} context
 * @param {{ run?: typeof runCommand, log?: (message: string) => void }} [options]
 * @returns {Promise<boolean>} whether the app was ad-hoc signed
 */
export async function adhocSignIfUnsigned({ appOutDir, arch, packager }, { run = runCommand, log = console.log } = {}) {
  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
  if (!(await isUnsigned(appPath, run))) return false
  const identity = { name: '-' }
  const sign = packager.config.mac?.sign
  const declared = typeof sign === 'object' ? sign : undefined
  const opts = await packager.helper.buildSignOptions(appPath, identity, declared, undefined, arch, 'mac')
  await packager.doSign(opts, sign, identity)
  log(`[after-sign] no Developer ID signed ${appPath}; signed it ad-hoc so macOS privacy grants apply`)
  return true
}

/** @param {any} context */
export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  await adhocSignIfUnsigned(context)
  await notarize(context)
}
