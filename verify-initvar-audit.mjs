// ③「世界书 [initvar] 条目」的**独立黑盒审计**。
//
// 为什么要另写一份：工作马自己的 repro 是白盒的（它知道门控在哪、按门控构造用例）。
// 独立审计要满足两点它做不到的要求：
//   ① 只用**公开 API**（parseMuvCard），不 import 内部函数 —— 测的是对外行为；
//   ② **对抗用例**：不是"标记存在就通过"，而是逐条试图骗过门控（同前缀的兄弟约定、
//      禁用条目、全角冒号散文、只有一个键的说明文档、只有列表项没有键……），
//      并钉住"能过"和"不能过"两侧 —— 只测一侧的测试无法区分"门控生效"和"门控从不生效"。
//   ③ 新旧对照：用 aef7569 之前的解析器跑同样 5 张卡，证明**只有该变的那张变了**。
//
// 运行：node verify-initvar-audit.mjs [旧版muv-parser.mjs路径]

import { readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parseMuvCard } from './lib/muv-parser.js'
import { readPngCard } from './lib/png-card.js'

const DIR = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const summarize = (r) => ({
  schemas: r.schemas, initvarData: r.initvarData, schemaSource: r.schemaSource,
})

// ── A. 真卡矩阵 ──────────────────────────────────────────────────────────────
console.log('=== A. 真卡矩阵（公开 API：parseMuvCard）===')
const cards = {}
let readCount = 0
for (const f of readdirSync(DIR).filter((x) => x.toLowerCase().endsWith('.png'))) {
  let data
  try { data = readPngCard(path.join(DIR, f)).data } catch (e) { console.log(`  ${f}: 读取失败 ${e.message}`); continue }
  const r = parseMuvCard(data)
  const keys = Object.keys(r.initvarData || {})
  cards[f] = { data, r }
  readCount++
  console.log(`  ${f.padEnd(22)} source=${String(r.schemaSource).padEnd(18)} schemas=${String(r.schemas.length).padStart(2)}  顶层键=${keys.slice(0, 5).join('/') || '（无）'}`)
}
check('5 张真卡都读到了（防空循环假绿）', readCount === 5, `只读到 ${readCount} 张`)

const farm = cards['异世界农场.png']
if (farm) {
  check('异世界农场：来源标记为 worldbook-initvar', farm.r.schemaSource === 'worldbook-initvar', '实际 ' + farm.r.schemaSource)
  check('异世界农场：schemas 由 0 变成 3', farm.r.schemas.length === 3, '实际 ' + farm.r.schemas.length)
  // ⚠ 已知偏差（P3，**不是 ③ 引入的**）：`parseInitvar` 不剥 YAML 的单引号，
  //   `日期: '05-20'` 读出来是带引号的 `"'05-20'"`。按 YAML 语义引号是语法、不是内容。
  //   这条**不判失败**（它是共用解析器的既有行为，改它要动所有 `<initvar>` 路径，
  //   风险和收益都不在本次范围内），但在这里显式记录，免得以后被当成 ③ 的 bug 反复排查。
  const dateVal = farm.r.initvarData?.时间?.日期
  check('异世界农场：时间.日期 真的读得到', dateVal === '05-20' || dateVal === "'05-20'", JSON.stringify(dateVal))
  if (dateVal === "'05-20'") {
    console.log(`  NOTE parseInitvar 保留了 YAML 单引号（既有行为，非 ③ 引入）：${JSON.stringify(dateVal)}`)
  }
  check('异世界农场：三个顶层键都在',
    ['时间', '种族好感度', '个人好感度'].every((k) => k in (farm.r.initvarData || {})),
    Object.keys(farm.r.initvarData || {}).join('/'))
}
const foot = cards['_足控天堂2.png']
if (foot) {
  check('_足控天堂2：仍走 <VariableInsert>（没有回归到世界书）',
    foot.r.schemaSource === 'variable-insert', '实际 ' + foot.r.schemaSource)
  check('_足控天堂2：schemas 仍是 8', foot.r.schemas.length === 8, '实际 ' + foot.r.schemas.length)
}
const cangxuan = cards['苍玄界.png']
if (cangxuan === undefined) console.log('  （没有 苍玄界.png，跳过它的反例）')

// ── B. 新旧对照：只有该变的那张能变 ──────────────────────────────────────────
const oldPath = process.argv[2]
if (oldPath) {
  console.log('\n=== B. 新旧对照（aef7569 之前 vs 现在）===')
  const old = await import('file:///' + oldPath.replace(/\\/g, '/'))
  const diffs = []
  for (const [f, { data }] of Object.entries(cards)) {
    let before, after
    try { before = summarize(old.parseMuvCard(data)) } catch (e) { before = { error: e.message } }
    after = summarize(parseMuvCard(data))
    const a = JSON.stringify({ schemas: before.schemas, initvarData: before.initvarData })
    const b = JSON.stringify({ schemas: after.schemas, initvarData: after.initvarData })
    if (a !== b) diffs.push(f)
  }
  console.log('  行为发生变化的卡：' + (diffs.length ? diffs.join(', ') : '（无）'))
  check('恰好只有「异世界农场」发生变化', diffs.length === 1 && diffs[0] === '异世界农场.png', diffs.join(', ') || '没有任何卡变化')
} else {
  console.log('\n（未提供旧版解析器，跳过新旧对照）')
}

// ── C. 对抗用例：逐条试图骗过门控 ────────────────────────────────────────────
console.log('\n=== C. 对抗用例 ===')
const YAML = '时间:\n  日期: \'05-20\'\n  星期: 周日\n种族好感度:\n  人类: 10\n'
const mk = (entries) => ({ name: 'Synthetic', character_book: { entries } })
const run = (entries) => parseMuvCard(mk(entries))

// C1-C3：不该读的
{
  const r = run([{ comment: '[mvu_update]变量输出格式', content: YAML }])
  check('C1 [mvu_update] 兄弟约定不被读', r.schemaSource === 'none' && r.schemas.length === 0, r.schemaSource)
}
{
  const r = run([{ comment: '[mvu_plot]插画强调', content: YAML }])
  check('C2 [mvu_plot] 不被读', r.schemaSource === 'none' && r.schemas.length === 0, r.schemaSource)
}
{
  const r = run([{ comment: '普通条目', content: YAML, enabled: false }])
  check('C3 禁用 + 无标记 → 不读（垃圾进不来）', r.schemaSource === 'none' && r.schemas.length === 0, r.schemaSource)
}
{
  const r = run([{ comment: '[initvar_extra]扩展', content: YAML }])
  check('C4 [initvar_extra] 不匹配（前缀要求紧跟 ]）', r.schemaSource === 'none', r.schemaSource)
}
{
  const r = run([{ comment: '[initvar]说明', content: '变量初始化格式说明：请按照下面的格式输出。\n第二行也是散文。\n' }])
  check('C5 全角冒号散文被形状判定挡住', r.schemaSource === 'none', r.schemaSource)
}
{
  const r = run([{ comment: '[initvar]半散文', content: '时间:\n这是一段中文说明文字，不是变量。\n' }])
  check('C6 一个键 + 一段散文 → 有一行不合规就否决', r.schemaSource === 'none', r.schemaSource)
}
{
  const r = run([{ comment: '[initvar]只有列表', content: '- 甲\n- 乙\n' }])
  check('C7 只有列表项没有键 → 否决（keys > 0）', r.schemaSource === 'none', r.schemaSource)
}

// C8-C11：该读的
{
  const r = run([{ comment: '[initvar]变量初始化勿开', content: YAML, enabled: false }])
  check('C8 禁用 + [initvar] → **读**（作者约定，有意豁免）',
    r.schemaSource === 'worldbook-initvar' && r.schemas.length === 2, r.schemaSource + '/' + r.schemas.length)
}
{
  const r = run([{ comment: '[initvar]变量初始化', content: YAML, enabled: true }])
  check('C9 启用 + [initvar] → 读', r.schemaSource === 'worldbook-initvar', r.schemaSource)
}
{
  const r = run([{ comment: '[InitVar]大小写', content: YAML }])
  check('C10 大小写不敏感 → 读（有意：作者写法不统一）', r.schemaSource === 'worldbook-initvar', r.schemaSource)
}
{
  const r = run([{ comment: '[initvar]带注释和列表', content: '# 说明\n时间:\n  日期: \'05-20\'\n\n- 甲\n- 乙\n' }])
  check('C11 注释行/空行/列表项都不影响键的识别', r.schemaSource === 'worldbook-initvar', r.schemaSource)
}

// C12：原生 <initvar> 必须优先
{
  const native = '时间:\n  日期: \'01-01\'\n'
  const r = parseMuvCard({
    name: 'Synthetic',
    first_mes: '<initvar>' + native + '</initvar>',
    character_book: { entries: [{ comment: '[initvar]世界书', content: YAML, enabled: false }] },
  })
  const c12 = r.initvarData?.时间?.日期
  check('C12 原生 <initvar> 优先于世界书条目（且来源标记正确）',
    r.schemaSource === 'initvar' && (c12 === '01-01' || c12 === "'01-01'"),
    `${r.schemaSource} / ${JSON.stringify(c12)}`)
}

// C13：空映射要否决
{
  const r = run([{ comment: '[initvar]空', content: '\n\n# 只有注释\n' }])
  check('C13 空映射 → 否决（闸④ 非空）', r.schemaSource === 'none', r.schemaSource)
}

console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
