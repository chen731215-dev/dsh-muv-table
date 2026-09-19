// Regression for the PNG character-card reader.
//
// Run: node test-png-card.mjs
//
// The reader is what lets DSH see a SillyTavern card's *original* data —
// regex scripts, world book, helper scripts. DSH's own `characters.json`
// keeps only {name, desc, first}, so if this breaks, a card dragged into
// SillyTavern silently arrives with none of its rendering machinery.
import { readPngCard, readPngChunks, extractCharaPayload, isPngCard } from './lib/png-card.js'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

console.log('=== PNG 卡解析回归 ===\n')

// 1) Synthesise a PNG so the test does not depend on any particular machine's
//    card library. Build the smallest valid chunk set with a `chara` tEXt.
function buildPng(cardObj) {
  const chunks = []
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4) // CRC is not validated by the reader
    return Buffer.concat([len, t, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4)
  chunks.push(chunk('IHDR', ihdr))
  const b64 = Buffer.from(JSON.stringify(cardObj), 'utf8').toString('base64')
  chunks.push(chunk('tEXt', Buffer.concat([Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from(b64, 'latin1')])))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])
}

const sampleCard = {
  name: 'sample',
  description: 'desc',
  first_mes: 'hello',
  data: {
    name: 'sample',
    description: 'desc text',
    first_mes: 'hello there',
    extensions: {
      regex_scripts: [{ scriptName: 'a' }, { scriptName: 'b' }],
      tavern_helper: { scripts: [{ name: 'x' }] },
    },
    character_book: { name: 'wb', entries: [{ comment: 'e1' }] },
  },
}

console.log('[1] 合成的 PNG 能被解析')
const buf = buildPng(sampleCard)
const chunks = readPngChunks(buf)
check('chunk 遍历出 IHDR/tEXt/IEND', chunks.map(c => c.type).join(',') === 'IHDR,tEXt,IEND', chunks.map(c => c.type).join(','))
const payload = extractCharaPayload(buf)
check('chara payload 提取成功', typeof payload === 'string' && payload.length > 10)
check('payload 是 base64', /^[A-Za-z0-9+/=]+$/.test(payload || ''))
const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
check('解出正则数量=2', (decoded.data.extensions.regex_scripts || []).length === 2)
check('解出世界书', decoded.data.character_book?.entries?.length === 1)
check('解出 helper 脚本', (decoded.data.extensions.tavern_helper.scripts || []).length === 1)

console.log('\n[2] 不是卡的 PNG 返回 null（不能瞎认）')
const plainPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  (() => { const l = Buffer.alloc(4); l.writeUInt32BE(13); const t = Buffer.from('IHDR'); const d = Buffer.alloc(13); return Buffer.concat([l, t, d, Buffer.alloc(4)]) })(),
  (() => { const l = Buffer.alloc(4); l.writeUInt32BE(0); const t = Buffer.from('IEND'); return Buffer.concat([l, t, Buffer.alloc(4)]) })(),
])
check('无 chara 块 -> null', extractCharaPayload(plainPng) === null)
check('垃圾数据不抛异常', (() => { try { extractCharaPayload(Buffer.from('not a png')); return true } catch { return false } })())

console.log('\n[3] isPngCard')
check('.png 判定', isPngCard('a/b/c.png') === true)
check('.json 不判定为 png', isPngCard('a.json') === false)

console.log('\n[4] 真实卡库（存在才测，缺失则跳过）')
function sillyTavernDirs() {
  const roots = [process.env.DSH_SILLYTAVERN_DIR, 'C:/MySpecialFolder/SillyTavern',
    path.join(os.homedir(), 'SillyTavern'), path.join(os.homedir(), 'Documents', 'SillyTavern')].filter(Boolean)
  const out = []
  for (const root of roots) {
    const dataDir = path.join(root, 'data')
    if (!existsSync(dataDir)) continue
    for (const user of readdirSync(dataDir)) {
      const chars = path.join(dataDir, user, 'characters')
      if (existsSync(chars)) out.push(chars)
    }
  }
  return out
}
const dirs = sillyTavernDirs()
let realCards = 0, realWithRegex = 0
for (const d of dirs) {
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.png')) continue
    const card = readPngCard(path.join(d, f))
    if (!card) continue
    realCards++
    if ((card.data.extensions?.regex_scripts || []).length > 0) realWithRegex++
  }
}
if (realCards === 0) {
  console.log('  SKIP 未找到 SillyTavern 卡库')
} else {
  check('读到真实 PNG 卡 (' + realCards + ' 张)', realCards > 0)
  check('其中带正则脚本的 (' + realWithRegex + ' 张)', realWithRegex > 0)
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
