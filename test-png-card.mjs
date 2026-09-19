// Regression for the PNG character-card reader.
//
// Run: node test-png-card.mjs
//
// The reader is what lets DSH see a SillyTavern card's *original* data —
// regex scripts, world book, helper scripts. DSH's own `characters.json`
// keeps only {name, desc, first}, so if this breaks, a card dragged into
// SillyTavern silently arrives with none of its rendering machinery.
import { readPngCard, readPngChunks, extractCharaPayload, isPngCard } from './lib/png-card.js'
import { parseMuvCard } from './lib/muv-parser.js'
import { readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs'
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

// 5) A PNG card may declare its variables as
//    `<VariableInsert>{…plain JSON…}</VariableInsert>` instead of `<initvar>`.
//    Reading the PNG correctly is not enough — if the schema comes out empty
//    the variable panel has nothing to build a table from, which is exactly how
//    「足控天堂2」 showed up as `schemas: 0`.
const TOP_LEVEL_KEYS = ['世界信息', '主角信息', '公司', '道具系统', '剧情事件', '因特网', '剧情选项', '主播档案']

function variableInsertCard() {
  const tree = {
    世界信息: { 时间: { 日期: '2026年8月26日', 时间详情: '10:00' }, 游戏模式: '香脚模式' },
    主角信息: { 名称: '{{user}}', 年龄: '20岁' },
    公司: { 总现金: 40000, 濒死状态: false },
    道具系统: { $template: { 库存: 0 }, 安神片: { 库存: 2, 描述: '降低压力值10' } },
    剧情事件: { $template: { 事件描述: '' }, 事件描述: '先撑过本周现金关' },
    因特网: { 公司主播推特1: '超天酱：袜子穿久了有点潮……' },
    剧情选项: { 选项1: '', 选项2: '', 选项3: '' },
    主播档案: {
      $template: { 直播时人格: '', 数值: { 压力值: 0 } },
      超天酱: { 直播时人格: '超天酱', 数值: { 压力值: 45 } },
    },
  }
  return {
    name: 'vi',
    description: 'desc',
    first_mes: '【主页】\n\n<VariableInsert>\n' + JSON.stringify(tree, null, 2) + '\n</VariableInsert>',
    data: { name: 'vi', description: 'desc', first_mes: '【主页】\n\n<VariableInsert>\n' + JSON.stringify(tree, null, 2) + '\n</VariableInsert>' },
  }
}

console.log('\n[5] <VariableInsert> 卡能建出变量表')
// readPngCard takes a *path*, so the synthetic card has to touch disk. It is
// written to a temp dir and removed again so the test stays self-contained.
function buildPngFile(cardObj) {
  const file = path.join(os.tmpdir(), 'dsh-muv-table-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.png')
  writeFileSync(file, buildPng(cardObj))
  return file
}
const viFile = buildPngFile(variableInsertCard())
let viParsed = { schemas: [], initvarData: {} }
try {
  const viCard = readPngCard(viFile)
  check('PNG 里的 VariableInsert 卡读得出来', !!viCard && viCard.data.name === 'vi')
  viParsed = parseMuvCard(viCard)
} finally {
  rmSync(viFile, { force: true })
}
check('schemas 非空', viParsed.schemas.length > 0, 'schemas=' + viParsed.schemas.length)
const viKeys = viParsed.schemas.map(s => s.name)
check('顶层键齐全', TOP_LEVEL_KEYS.every(k => viKeys.includes(k)),
  '缺: ' + TOP_LEVEL_KEYS.filter(k => !viKeys.includes(k)).join(','))
check('initvarData 里有真实变量树', Object.keys(viParsed.initvarData || {}).length === TOP_LEVEL_KEYS.length)
check('主播档案.$template 不是条目（不渲染假主播）', !viKeys.includes('$template'))
const viAnchor = viParsed.schemas.find(s => s.name === '主播档案')
check('主播档案 下是真实主播而不是 $template',
  !!viAnchor && (viAnchor.children || []).some(c => c.name === '超天酱')
    && !(viAnchor.children || []).some(c => c.name === '$template'),
  'children=' + (viAnchor ? (viAnchor.children || []).map(c => c.name).join(',') : 'n/a'))
check('数值是 number 不是 string',
  JSON.stringify(viParsed.schemas.find(s => s.name === '公司')?.children?.find(c => c.name === '总现金'))
    .includes('"type":"number"'))

console.log('\n[6] <VariableInsert> 兜底不能踩到别的东西')
const nativeCard = {
  data: {
    name: 'native',
    alternate_greetings: ['<initvar>\n名字: 原生\n年龄: 3\n</initvar>'],
    first_mes: '<VariableInsert>{"不该被用":1}</VariableInsert>',
  },
}
const nativeParsed = parseMuvCard(nativeCard)
check('有 <initvar> 时不走 VariableInsert', Object.keys(nativeParsed.initvarData).join(',') === '名字,年龄',
  Object.keys(nativeParsed.initvarData).join(','))
const initvarInFirstMes = parseMuvCard({
  data: { name: 'x', first_mes: '<initvar>\n名字: 开头问候里\n</initvar>' },
})
check('first_mes 里的 <initvar> 也认', Object.keys(initvarInFirstMes.initvarData).join(',') === '名字',
  Object.keys(initvarInFirstMes.initvarData).join(','))
const badJson = parseMuvCard({
  data: { name: 'y', first_mes: '<VariableInsert>不是 JSON {</VariableInsert>', description: '' },
})
check('VariableInsert 不是 JSON 时返回空表而不抛异常', badJson.schemas.length === 0 && badJson.initvarData != null)
const noVars = parseMuvCard({ data: { name: 'z', first_mes: '普通问候' } })
check('没有变量块的卡照样返回有效结构', noVars.schemas.length === 0 && typeof noVars.initvarData === 'object')

console.log('\n[7] 真实卡：_足控天堂2（存在才测）')
const target = dirs.map(d => path.join(d, '_足控天堂2.png')).find(p => existsSync(p))
if (!target) {
  console.log('  SKIP 未找到 _足控天堂2.png')
} else {
  const real = readPngCard(target)
  const realParsed = parseMuvCard(real)
  check('schemas 不为空', realParsed.schemas.length > 0, 'schemas=' + realParsed.schemas.length)
  const keys = realParsed.schemas.map(s => s.name)
  check('顶层键含 ' + TOP_LEVEL_KEYS.join('/'),
    TOP_LEVEL_KEYS.every(k => keys.includes(k)),
    '缺: ' + TOP_LEVEL_KEYS.filter(k => !keys.includes(k)).join(','))
  check('initvarData 有真实变量树', Object.keys(realParsed.initvarData || {}).length === TOP_LEVEL_KEYS.length,
    'keys=' + Object.keys(realParsed.initvarData || {}).join(','))
  const star = realParsed.schemas.find(s => s.name === '主播档案')
  check('主播档案 下是 超天酱', !!star && (star.children || []).some(c => c.name === '超天酱'),
    'children=' + (star ? (star.children || []).map(c => c.name).join(',') : 'n/a'))
  check('超天酱 的 数值.压力值 可编辑', !!star
    && !!star.children.find(c => c.name === '超天酱')?.children?.find(c => c.name === '数值')?.children?.some(c => c.name === '压力值'))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
