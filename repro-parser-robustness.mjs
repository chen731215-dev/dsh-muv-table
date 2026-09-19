// 复现③④⑤：变量块的候选来源太窄 + 两种畸形卡会让解析直接炸/读空。
//
// Run: node repro-parser-robustness.mjs
// 退出码 0 = 已修好，1 = 仍然是坏的。
//
// ③ 只扫 first_mes/description/scenario/alternate_greetings 四个字段，
//    世界书条目（character_book.entries[].content）和 tavern_helper 脚本里
//    的 <initvar> / <VariableInsert> 全都读不到。
// ④ alternate_greetings 是对象（不是数组）时 `for...of` 抛 TypeError
//    → /api/muv-table/tavern-card 直接 500。
// ⑤ 扁平 V1 JSON 卡（没有 data 包装）能被 findJsonMatch 按名找到，
//    但 parseMuvCard 只看 cardJson.data → 字段数 0。

import { parseMuvCard, extractVariableInsert } from './lib/muv-parser.js'
import { readPngCard } from './lib/png-card.js'
import { findCard } from './test-cards.mjs'

let bad = 0
function line(label, ok, detail) {
  console.log((ok ? '  OK   ' : '  FAIL ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) bad++
}

console.log('=== 复现③④⑤: 候选来源过窄 + 畸形卡 ===\n')

// ── ③-a 世界书条目里的 <initvar> ─────────────────────────
console.log('[3a] <initvar> 只写在世界书条目里')
const wbCard = {
  data: {
    name: 'wb-only',
    first_mes: '普通问候，没有变量',
    character_book: {
      entries: [
        { comment: '背景', content: '与变量无关的一段设定' },
        { comment: '[initvar]变量初始化勿开', content: '<initvar>\n名字: 世界书里的\n年龄: 7\n</initvar>' },
      ],
    },
  },
}
const a = parseMuvCard(wbCard)
line('世界书里的 <initvar> 被读到', Object.keys(a.initvarData || {}).join(',') === '名字,年龄',
  'initvarData keys=' + Object.keys(a.initvarData || {}).join(','))

// ── ③-b tavern_helper 脚本里的 <VariableInsert> ───────────
console.log('\n[3b] <VariableInsert> 只写在 tavern_helper 脚本里')
const tree = { 世界信息: { 时间: '10:00' }, 主播档案: { 超天酱: { 数值: { 压力值: 45 } } } }
const scriptCard = {
  data: {
    name: 'script-only',
    first_mes: '普通问候',
    extensions: {
      tavern_helper: {
        scripts: [
          { name: '无关注释', content: '// nothing here' },
          { name: '变量初始化', content: 'const x = 1\n<VariableInsert>' + JSON.stringify(tree) + '</VariableInsert>' },
        ],
      },
    },
  },
}
const b = parseMuvCard(scriptCard)
line('脚本里的 <VariableInsert> 被读到', Object.keys(b.initvarData || {}).join(',') === '世界信息,主播档案',
  'initvarData keys=' + Object.keys(b.initvarData || {}).join(','))
line('schemas 建得出来', b.schemas.length === 2, 'schemas=' + b.schemas.length)

// ── ③-c 非法 JSON 的文档块不能被误命中，也不能抛异常 ──────
console.log('\n[3c] 世界书里的「文档代码块」不能抢走真正的变量块')
const docCard = {
  data: {
    name: 'doc-first',
    first_mes: '【主页】\n\n<VariableInsert>' + JSON.stringify({ 真变量: { a: 1 } }) + '</VariableInsert>',
    character_book: {
      entries: [{ comment: '规则文档', content: '<VariableInsert>\n```json\n{ "示例": 1 }\n```\n</VariableInsert>' }],
    },
  },
}
const c = parseMuvCard(docCard)
line('仍然用 first_mes 里那个块', Object.keys(c.initvarData || {}).join(',') === '真变量',
  'keys=' + Object.keys(c.initvarData || {}).join(','))
line('非法 JSON 不抛异常', c.schemas.length === 1, 'schemas=' + c.schemas.length)
const docOnly = parseMuvCard({
  data: {
    name: 'doc-only',
    first_mes: '没有变量',
    character_book: { entries: [{ comment: 'd', content: '<VariableInsert>不是 JSON {</VariableInsert>' }] },
  },
})
line('全是非法块时返回空表而不抛异常', docOnly.schemas.length === 0 && docOnly.initvarData != null,
  'schemas=' + docOnly.schemas.length)

// ── ④ 畸形卡：alternate_greetings 是对象 ─────────────────
console.log('\n[4] alternate_greetings 是对象（不是数组）')
let threw = ''
try {
  const d = parseMuvCard({ data: { name: 'malformed', alternate_greetings: { a: 'x' }, first_mes: 'hi' } })
  line('parseMuvCard 不抛异常', true)
  line('返回可用的空结构', Array.isArray(d.schemas) && d.schemas.length === 0, 'schemas=' + d.schemas.length)
} catch (e) {
  threw = e.constructor.name + ': ' + e.message
  line('parseMuvCard 不抛异常', false, threw)
}
let threw2 = ''
try {
  extractVariableInsert({ name: 'x', alternate_greetings: { a: 1 }, first_mes: 'hi' })
  line('extractVariableInsert 不抛异常', true)
} catch (e) {
  threw2 = e.constructor.name + ': ' + e.message
  line('extractVariableInsert 不抛异常', false, threw2)
}
let threw3 = ''
try {
  const e3 = parseMuvCard({
    data: {
      name: 'malformed2',
      first_mes: '<initvar>\n名字: 好\n</initvar>',
      character_book: { entries: { not: 'array' } },
      extensions: { tavern_helper: { scripts: 'not-an-array' } },
    },
  })
  line('世界书/脚本字段畸形也不抛异常', Object.keys(e3.initvarData).join(',') === '名字',
    'keys=' + Object.keys(e3.initvarData).join(','))
} catch (e) {
  threw3 = e.constructor.name + ': ' + e.message
  line('世界书/脚本字段畸形也不抛异常', false, threw3)
}

// ── ⑤ 扁平 V1 JSON 卡 ────────────────────────────────────
console.log('\n[5] 扁平 V1 卡（没有 data 包装）')
const flat = {
  name: 'flat-v1',
  description: '描述',
  first_mes: '<initvar>\n名字: 扁平卡\n年龄: 18\n</initvar>',
  spec: 'chara_card_v1',
}
const f = parseMuvCard(flat)
line('卡名读得到', f.name === 'flat-v1', 'name=' + f.name)
line('initvarData 非空', Object.keys(f.initvarData || {}).length === 2,
  'keys=' + Object.keys(f.initvarData || {}).join(','))
line('schemas 非空', f.schemas.length === 2, 'schemas=' + f.schemas.length)
const flatVi = parseMuvCard({
  name: 'flat-v1-vi',
  first_mes: '<VariableInsert>' + JSON.stringify({ 世界信息: { 时间: '10:00' } }) + '</VariableInsert>',
})
line('扁平卡里的 <VariableInsert> 也认', Object.keys(flatVi.initvarData || {}).join(',') === '世界信息',
  'keys=' + Object.keys(flatVi.initvarData || {}).join(','))
// 包装卡不能被破坏
const wrapped = parseMuvCard({ name: 'outer', data: { name: 'inner', first_mes: '<initvar>\n甲: 1\n</initvar>' } })
line('有 data 包装时仍以 data 为准', wrapped.name === 'inner' && Object.keys(wrapped.initvarData).join(',') === '甲',
  'name=' + wrapped.name + ' keys=' + Object.keys(wrapped.initvarData).join(','))

// ── 真实卡：足控天堂2 的文档块不能抢走真变量树 ─────────────
console.log('\n[6] 真实卡 _足控天堂2（存在才测）')
const p = findCard('_足控天堂2')
if (!p) {
  console.log('  SKIP 找不到 _足控天堂2')
} else {
  const real = parseMuvCard(readPngCard(p))
  const keys = real.schemas.map(s => s.name)
  console.log('  schemas=' + real.schemas.length + ' keys=' + keys.join(','))
  line('schemas 仍是 8 组', real.schemas.length === 8, 'schemas=' + real.schemas.length)
  line('公司.总现金 = 40000（真树，不是文档示例）',
    real.initvarData?.公司?.总现金 === 40000, '总现金=' + real.initvarData?.公司?.总现金)
  line('世界书里的文档块没被当成变量', !keys.includes('示例'), keys.join(','))
}

console.log('\n=== ' + (bad ? bad + ' 项不通过 —— bug 仍在' : '全部通过 —— 已修复') + ' ===')
process.exit(bad ? 1 : 0)
