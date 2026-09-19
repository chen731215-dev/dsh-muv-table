// Locate real character cards on this machine for the tests.
//
// The search roots mirror `MUV_CARD_DIRS` in lib/index.js so a test finds the
// same files the plugin would. Nothing here writes to disk; a missing card is a
// normal outcome (`null`) and callers turn that into a SKIP, never a failure —
// the tests must stay runnable on a machine without the sample library.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Directories worth searching for a sample card. */
export function cardDirs() {
  const roots = [
    'C:/MySpecialFolder/SillyTavern',
    path.join(os.homedir(), 'SillyTavern'),
    path.join(os.homedir(), 'Documents', 'SillyTavern'),
  ]
  // Same order index.js uses: explicit download dir, env override, ST, then the
  // usual download/desktop drop zones.
  const out = ['E:/BaiduNetdiskDownload/EdgeDownload']
  for (const d of String(process.env.DSH_MUV_CARD_DIRS || '').split(path.delimiter)) {
    if (d.trim()) out.push(d.trim())
  }

  // SillyTavern keeps cards under data/<user>/characters.
  for (const root of roots) {
    const dataDir = path.join(root, 'data')
    if (!fs.existsSync(dataDir)) continue
    try {
      for (const user of fs.readdirSync(dataDir)) {
        const chars = path.join(dataDir, user, 'characters')
        if (fs.existsSync(chars)) out.push(chars)
      }
    } catch (_) {}
  }

  out.push(path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'))

  return out.filter((d, i, all) => all.indexOf(d) === i)
}

/**
 * Find a card file by base name (without extension).
 * @param {string} name - e.g. '苍玄界', '_足控天堂2'
 * @returns {string} absolute path, or '' when not on this machine
 */
export function findCard(name) {
  const explicit = process.env.MUV_TEST_CARD_DIR
  const dirs = explicit ? [explicit, ...cardDirs()] : cardDirs()
  for (const dir of dirs) {
    for (const ext of ['.png', '.json']) {
      const p = path.join(dir, name + ext)
      if (fs.existsSync(p)) return p
    }
  }
  return ''
}
