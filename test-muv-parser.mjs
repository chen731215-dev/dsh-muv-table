// Regression: the MUV card/variable parser.
//
// Run: node test-muv-parser.mjs
//
// Covers the "silent data loss / robustness" round of fixes:
//   ① `空值 + 下一行 - ` 列表被吞成空对象 → 内容既不在数据里也不在 schema 里
//   ③ 变量块的候选来源只扫 4 个字段，世界书条目 / tavern_helper 脚本读不到
//   ④ alternate_greetings（或 entries / scripts）是对象时 for...of 抛 TypeError → 端点 500
//   ⑤ 扁平 V1 卡（没有 data 包装）能被 findJsonMatch 找到，却被 parseMuvCard 读成 0 字段
//   ⑥ `键: ""` 空字符串被序列化成裸的 `键: `，再解析回来变成 `{}`（类型静默翻转）
//
// 真实卡只在存在时才测（缺失 → SKIP），合成卡负责精确覆盖每条分支。

import { parseInitvar, serializeInitvar } from './lib/initvar-parser.js'
import { parseMuvCard, extractVariableInsert } from './lib/muv-parser.js'
import { applyEditsAndGenerate, generateMuvBlock } from './lib/block-generator.js'
import { readPngCard } from './lib/png-card.js'
import { findCard } from './test-cards.mjs'
import fs from 'node:fs'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

/** Find a dot-path in a schema tree; returns the field object or undefined. */
function fieldAt(schemas, path) {
  const keys = path.split('.')
  let list = schemas
  let found
  for (const key of keys) {
    found = (list || []).find(f => f.name === key)
    if (!found) return undefined
    list = found.children
  }
  return found
}
function at(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj)
}
function leafPaths(schemas, prefix = '') {
  const out = []
  for (const f of schemas || []) {
    const p = prefix ? prefix + '.' + f.name : f.name
    if (f.type === 'object' && (f.children || []).length > 0) out.push(...leafPaths(f.children, p))
    else out.push(p)
  }
  return out
}

console.log('=== MUV 解析器回归 ===\n')

// ─────────────────────────────────────────────────────────
console.log('[1] ① 列表值：`键: ` + 下一行 `- item` 必须是数组')
const listText = [
  '人际交往:',
  '  结识道友录:',
  '    沈慕微:',
  '      关系标签: 师尊',
  '      最近互动记录: ',
  '          - 因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。',
  '    江念:',
  '      最近互动记录:',
  '        - （呼呼大睡中，听到动静也只是翻了个身）。',
  '世界系统:',
  '  在场角色: ""',
].join('\n')
const listParsed = parseInitvar(listText)
check('列表成为数组', Array.isArray(at(listParsed, '人际交往.结识道友录.沈慕微.最近互动记录')),
  JSON.stringify(at(listParsed, '人际交往.结识道友录.沈慕微.最近互动记录')))
check('列表内容原样保留',
  at(listParsed, '人际交往.结识道友录.沈慕微.最近互动记录')?.[0] === '因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。')
check('同缩进的列表也认（键与 `- ` 对齐）',
  Array.isArray(at(listParsed, '人际交往.结识道友录.江念.最近互动记录'))
  && at(listParsed, '人际交往.结识道友录.江念.最近互动记录')[0] === '（呼呼大睡中，听到动静也只是翻了个身）。')
check('列表后面的兄弟键仍然归到上一层', at(listParsed, '世界系统.在场角色') === '',
  JSON.stringify(at(listParsed, '世界系统.在场角色')))
check('普通嵌套对象没被改成数组', !Array.isArray(at(listParsed, '人际交往.结识道友录.沈慕微')))

const multi = parseInitvar('甲:\n  - 一\n  - 二\n  - 三\n乙: 1')
check('多条目列表', JSON.stringify(at(multi, '甲')) === '["一","二","三"]', JSON.stringify(at(multi, '甲')))
check('列表里的数字/布尔按标量解析', JSON.stringify(at(parseInitvar('甲:\n  - 3\n  - true\n  - 文字'), '甲')) === '[3,true,"文字"]',
  JSON.stringify(at(parseInitvar('甲:\n  - 3\n  - true\n  - 文字'), '甲')))
check('孤立的 `- item`（上面没有待定键）不会污染根对象',
  Object.keys(parseInitvar('- 野生条目\n名字: 甲')).join(',') === '名字',
  Object.keys(parseInitvar('- 野生条目\n名字: 甲')).join(','))
check('列表写回仍是列表（往返）',
  serializeInitvar(listParsed).includes('  - 因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。')
  && Array.isArray(at(parseInitvar(serializeInitvar(listParsed)), '人际交往.结识道友录.沈慕微.最近互动记录')))
check('空列表往返为 []（不是 {}）',
  JSON.stringify(at(parseInitvar(serializeInitvar(parseInitvar('甲: []'))), '甲')) === '[]',
  JSON.stringify(at(parseInitvar(serializeInitvar(parseInitvar('甲: []'))), '甲')))

// ─────────────────────────────────────────────────────────
console.log('\n[2] ⑥ 空字符串往返：`键: ""` 不能再变成 `{}`')
const emptyRound = parseInitvar(serializeInitvar(parseInitvar('在场角色: ""')))
check('`键: ""` 往返仍是空字符串', emptyRound['在场角色'] === '', JSON.stringify(emptyRound['在场角色']))
check('类型没变（不是 object）', typeof emptyRound['在场角色'] !== 'object', typeof emptyRound['在场角色'])

// ─────────────────────────────────────────────────────────
console.log('\n[3] ③ 变量块的候选来源：世界书条目 + tavern_helper 脚本')
const wbInitvarCard = {
  data: {
    name: 'wb-initvar',
    first_mes: '普通问候',
    character_book: {
      entries: [
        { comment: '无关设定', content: '这里没有变量块' },
        { comment: '[initvar]变量初始化勿开', content: '<initvar>\n名字: 世界书\n年龄: 9\n</initvar>' },
      ],
    },
  },
}
const wbInitvar = parseMuvCard(wbInitvarCard)
check('世界书条目里的 <initvar> 被读到', Object.keys(wbInitvar.initvarData).join(',') === '名字,年龄',
  Object.keys(wbInitvar.initvarData).join(','))
check('世界书条目里的 <initvar> 建有 schema', wbInitvar.schemas.length === 2, 'schemas=' + wbInitvar.schemas.length)

const scriptTree = { 世界信息: { 时间: '10:00' }, 主播档案: { 超天酱: { 数值: { 压力值: 45 } } } }
const scriptCard = {
  data: {
    name: 'script-vi',
    first_mes: '普通问候',
    extensions: {
      tavern_helper: {
        scripts: [
          { name: '注释脚本', content: '// 没有变量' },
          { name: '变量初始化', content: 'const n = 1\n<VariableInsert>' + JSON.stringify(scriptTree) + '</VariableInsert>' },
        ],
      },
    },
  },
}
const scriptParsed = parseMuvCard(scriptCard)
check('脚本里的 <VariableInsert> 被读到',
  Object.keys(scriptParsed.initvarData).join(',') === '世界信息,主播档案',
  Object.keys(scriptParsed.initvarData).join(','))
check('脚本里的变量树建得出嵌套 schema',
  !!fieldAt(scriptParsed.schemas, '主播档案.超天酱.数值.压力值'))

// 顺序：问候语里的真块永远优先于世界书/脚本（已经是好的卡不许变）
const precedence = parseMuvCard({
  data: {
    name: 'precedence',
    first_mes: '<VariableInsert>' + JSON.stringify({ 真变量: 1 }) + '</VariableInsert>',
    alternate_greetings: ['<initvar>\n名字: 问候语里的\n</initvar>'],
    character_book: { entries: [{ comment: 'x', content: '<initvar>\n名字: 世界书里的\n</initvar>' }] },
    extensions: { tavern_helper: { scripts: [{ name: 's', content: '<VariableInsert>{"脚本里的":1}</VariableInsert>' }] } },
  },
})
check('<initvar> 优先于任何 <VariableInsert>', at(precedence.initvarData, '名字') === '问候语里的',
  JSON.stringify(precedence.initvarData))
check('问候语里的 <VariableInsert> 优先于世界书里的 <initvar>',
  parseMuvCard({
    data: {
      name: 'p2',
      first_mes: '<VariableInsert>{"问候语里的":1}</VariableInsert>',
      character_book: { entries: [{ comment: 'x', content: '<initvar>\n名字: 世界书示例\n</initvar>' }] },
    },
  }).initvarData['问候语里的'] === 1)

// 文档块（引用了标签但不是 JSON）不能抢走真块，也不能抛异常
const docCard = parseMuvCard({
  data: {
    name: 'doc',
    first_mes: '【主页】\n<VariableInsert>' + JSON.stringify({ 真变量: { a: 1 } }) + '</VariableInsert>',
    character_book: {
      entries: [{ comment: '规则', content: '- 新增则 `<VariableInsert>`\n```json\n{ "示例": 1 }\n```\n</VariableInsert>' }],
    },
  },
})
check('世界书里的文档块不被误命中', Object.keys(docCard.initvarData).join(',') === '真变量',
  Object.keys(docCard.initvarData).join(','))
check('只有非法文档块时返回空表而不抛异常',
  (() => {
    const d = parseMuvCard({
      data: {
        name: 'doc-only',
        first_mes: '没有变量',
        character_book: { entries: [{ comment: 'd', content: '<VariableInsert>不是 JSON {</VariableInsert>' }] },
      },
    })
    return d.schemas.length === 0 && typeof d.initvarData === 'object'
  })())

// ─────────────────────────────────────────────────────────
console.log('\n[4] ④ 畸形卡：该是数组的地方来了对象/字符串')
const malformed = {
  name: 'malformed',
  first_mes: 'hi',
  alternate_greetings: { a: 'x' },
  character_book: { entries: { not: 'an array' } },
  extensions: { tavern_helper: { scripts: 'not an array' } },
}
let malformedError = ''
try {
  const m = parseMuvCard(malformed)
  check('parseMuvCard 不抛异常', true)
  check('返回可用的空结构', Array.isArray(m.schemas) && m.schemas.length === 0, 'schemas=' + m.schemas.length)
} catch (e) { malformedError = e.message; check('parseMuvCard 不抛异常', false, e.message) }
check('extractVariableInsert 不抛异常', (() => {
  try { extractVariableInsert({ alternate_greetings: { a: 1 }, first_mes: 'x' }); return true } catch { return false }
})())
check('alternate_greetings 是对象时仍能读到 first_mes 里的变量',
  Object.keys(parseMuvCard({
    data: { name: 'm2', alternate_greetings: {}, first_mes: '<initvar>\n甲: 1\n</initvar>' },
  }).initvarData).join(',') === '甲')
check('entries 是数组但条目是 null 时不抛异常', (() => {
  try {
    const m = parseMuvCard({ data: { name: 'm3', first_mes: 'x', character_book: { entries: [null, 7, { content: 'ok' }] } } })
    return Array.isArray(m.schemas)
  } catch { return false }
})())
check('parseMuvCard(null) 不抛异常', (() => {
  try { return parseMuvCard(null).name === 'Unnamed' } catch { return false }
})())
console.log('  (畸形卡: ' + (malformedError || '无异常') + ')')

// ─────────────────────────────────────────────────────────
console.log('\n[5] ⑤ 扁平 V1 卡（没有 data 包装）')
const flat = parseMuvCard({
  name: 'flat',
  description: '描述',
  first_mes: '<initvar>\n名字: 扁平卡\n年龄: 18\n</initvar>',
  spec: 'chara_card_v1',
  extensions: { regex_scripts: [{ scriptName: 'r1' }] },
})
check('卡名读得到', flat.name === 'flat', 'name=' + flat.name)
check('initvarData 非空', Object.keys(flat.initvarData).join(',') === '名字,年龄',
  Object.keys(flat.initvarData).join(','))
check('schemas 非空', flat.schemas.length === 2, 'schemas=' + flat.schemas.length)
check('扁平卡里的 <VariableInsert> 也认',
  Object.keys(parseMuvCard({ name: 'f2', first_mes: '<VariableInsert>{"世界信息":1}</VariableInsert>' }).initvarData).join(',') === '世界信息')
check('有 data 包装时以 data 为准（不回归）', (() => {
  const w = parseMuvCard({ name: 'outer', first_mes: '<initvar>\n外层: 1\n</initvar>', data: { name: 'inner', first_mes: '<initvar>\n内层: 1\n</initvar>' } })
  return w.name === 'inner' && Object.keys(w.initvarData).join(',') === '内层'
})(), 'name=' + parseMuvCard({ name: 'outer', data: { name: 'inner' } }).name)

// ─────────────────────────────────────────────────────────
console.log('\n[6] 列表在 schema 里的形状 + 编辑后仍然写成列表')
const listSchema = parseMuvCard({ name: 'ls', first_mes: '<initvar>' + listText + '</initvar>' })
const listField = fieldAt(listSchema.schemas, '人际交往.结识道友录.沈慕微.最近互动记录')
check('列表字段进了 schema', !!listField)
check('类型是文本、标记 isList', listField?.type === 'string' && listField?.isList === true,
  JSON.stringify({ type: listField?.type, isList: listField?.isList }))
check('默认值是多行文本', listField?.defaultValue === '因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。',
  JSON.stringify(listField?.defaultValue))
const edited = applyEditsAndGenerate(listSchema.initvarData, [
  { path: '人际交往.结识道友录.沈慕微.最近互动记录', value: '第一条\n第二条' },
])
check('编辑列表行 → 生成块仍是 `- ` 列表',
  edited.includes('      - 第一条') && edited.includes('      - 第二条'), edited.split('\n').filter(l => l.includes('第一条')).join('|'))
check('编辑列表行 → 路径没被拍平成一个字符串',
  edited.includes('最近互动记录:\n'), edited.split('\n').slice(0, 14).join(' / '))
check('生成块包着 <initvar> 且可再解析',
  generateMuvBlock(listSchema.initvarData).startsWith('<UpdateVariable>\n<initvar>'))

// ─────────────────────────────────────────────────────────
console.log('\n[7] 真实卡：往返一致性（解析→序列化→解析 必须一模一样）')
const REAL = ['苍玄界', '_足控天堂2', '食人世界', '涩涩提瓦特', '异世界农场']
let blocks = 0, notIdempotent = 0, realParsed = 0
const seen = []
for (const nm of REAL) {
  const file = findCard(nm)
  if (!file) continue
  let card
  try { card = file.endsWith('.png') ? readPngCard(file) : JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { continue }
  seen.push(nm)
  // 解析不抛异常
  let parsed
  try { parsed = parseMuvCard(card) } catch (e) {
    check(nm + ' parseMuvCard 不抛异常', false, e.message)
    continue
  }
  realParsed++
  const data = card.data && typeof card.data === 'object' && !Array.isArray(card.data) ? card.data : card
  const texts = []
  for (const k of ['first_mes', 'description', 'scenario']) if (typeof data[k] === 'string') texts.push(data[k])
  for (const g of (Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [])) if (typeof g === 'string') texts.push(g)
  for (const t of texts) {
    const m = t.match(/<initvar>([\s\S]*?)<\/initvar>/i)
    if (!m) continue
    blocks++
    const once = parseInitvar(m[1])
    const twice = parseInitvar(serializeInitvar(once))
    if (JSON.stringify(once) !== JSON.stringify(twice)) {
      notIdempotent++
      if (notIdempotent <= 2) console.log('     首个不一致: ' + nm + ' ' + firstDiff(once, twice))
    }
  }
  check(nm + ' 解析成功（schemas=' + parsed.schemas.length + ', blocks=' + parsed.initvarBlocks.length + '）', true)
}
function firstDiff(x, y, pre = '') {
  const keys = new Set([...Object.keys(x || {}), ...Object.keys(y || {})])
  for (const k of keys) {
    const xv = x?.[k], yv = y?.[k]
    if (JSON.stringify(xv) === JSON.stringify(yv)) continue
    if (xv && yv && typeof xv === 'object' && typeof yv === 'object' && !Array.isArray(xv) && !Array.isArray(yv)) {
      return firstDiff(xv, yv, pre + k + '.')
    }
    return pre + k + ': ' + JSON.stringify(xv) + ' -> ' + JSON.stringify(yv)
  }
  return '(仅嵌套差异)'
}
if (!seen.length) {
  console.log('  SKIP 本机没有真实卡样本')
} else {
  console.log('  真实卡: ' + seen.join(' / '))
  check('真实卡的 initvar 块都被解析了 (' + blocks + ' 块)', blocks > 0)
  check('每块都往返一致（0 处元数据丢失）', notIdempotent === 0, notIdempotent + ' 块不一致')
}

// ─────────────────────────────────────────────────────────
console.log('\n[8] 真实卡：苍玄界 的两个列表字段（本次修复的原始病灶）')
const cangxuan = findCard('苍玄界')
if (!cangxuan) {
  console.log('  SKIP 找不到 苍玄界')
} else {
  const card = cangxuan.endsWith('.png') ? readPngCard(cangxuan) : JSON.parse(fs.readFileSync(cangxuan, 'utf8'))
  const parsed = parseMuvCard(card)
  const WANT = ['人际交往.结识道友录.沈慕微.最近互动记录', '人际交往.结识道友录.江念.最近互动记录']
  const leaves = leafPaths(parsed.schemas)
  check('两条互动记录路径都在 schema 里', WANT.every(p => leaves.includes(p)),
    '缺: ' + WANT.filter(p => !leaves.includes(p)).join(',') + ' (共 ' + leaves.length + ' 叶子)')
  check('叶子行数 >= 67', leaves.length >= 67, 'leaves=' + leaves.length)
  check('数据里是数组', Array.isArray(at(parsed.initvarData, WANT[0])), JSON.stringify(at(parsed.initvarData, WANT[0])))
}

// ─────────────────────────────────────────────────────────
console.log('\n[9] 真实卡：足控天堂2 的文档块不能顶掉真变量树')
const fk = findCard('_足控天堂2')
if (!fk) {
  console.log('  SKIP 找不到 _足控天堂2')
} else {
  const parsed = parseMuvCard(readPngCard(fk))
  const keys = parsed.schemas.map(s => s.name)
  check('schemas 仍是 8 组', parsed.schemas.length === 8, 'schemas=' + parsed.schemas.length)
  check('读的是真树（公司.总现金=40000）', at(parsed.initvarData, '公司.总现金') === 40000,
    '总现金=' + at(parsed.initvarData, '公司.总现金'))
  check('世界书/脚本里的文档示例没被当变量', !keys.includes('示例') && !keys.includes('变量结构'), keys.join(','))
  check('主播档案.$template 仍被剔除', !keys.includes('$template'))
}

// ─────────────────────────────────────────────────────────
// 这条是**钉住现状**，不是本次要修的东西：世界书里还有一种「没有 <initvar> 标签、
// 只有注释前缀 [initvar] 的裸 YAML」投递方式（`异世界农场` 的
// `[initvar]变量初始化勿开` 就是它，content 里只有 `时间:`/`种族好感度:` 这样的裸文本）。
// 按标签扫描（③ 要求的那套）确实扫不到它，所以那张卡依然是 schemas: 0。
// 要接住它需要一条**新的**判定规则（例如「comment 以 [initvar] 开头的世界书条目，
// 在彻底找不到变量块时把 content 当 initvar 块解析」），那是另一个决定 —— 见 CHANGELOG。
console.log('\n[10] 真实卡：异世界农场 —— 裸 [initvar] 世界书条目（现状钉住）')
const farm = findCard('异世界农场')
if (!farm) {
  console.log('  SKIP 找不到 异世界农场')
} else {
  const card = readPngCard(farm)
  const entry = (card.data.character_book?.entries || [])
    .find(e => /^\[initvar\]/i.test(String(e?.comment || '')))
  check('确实存在注释为 [initvar]… 的世界书条目', !!entry, entry?.comment)
  check('★那份 content 里没有 <initvar> 标签（所以按标签扫不到）',
    !!entry && !/<initvar>/i.test(String(entry.content || '')),
    'content 前 40 字: ' + String(entry?.content || '').slice(0, 40))
  const parsed = parseMuvCard(card)
  check('现状：schemas 仍是 0（这条不在本轮范围内）', parsed.schemas.length === 0, 'schemas=' + parsed.schemas.length)
  check('但 Zod 变量结构读得到（上一轮的修复仍然有效）', String(parsed.zodSource || '').length > 100,
    'zodSource=' + String(parsed.zodSource || '').length)
  check('没有产生垃圾 schema', parsed.schemas.length === 0 && Object.keys(parsed.initvarData || {}).length === 0)
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
