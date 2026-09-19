// Repro (keep): the `[initvar]` world-book entry that carries bare YAML.
//
// `异世界农场` keeps its whole variable tree in a world-book entry whose comment is
// `[initvar]变量初始化勿开` (`enabled: false`) and whose content has **no <initvar>
// tag** — just `时间:` / `种族好感度:` … So the tag-based scan never reached it and
// the card reported `schemas: 0`.
//
// This script loads the PREVIOUS parser straight out of git HEAD and the current one,
// then walks the cards on this machine side by side: the only card that may change is
// the one this fix is for. It also exercises the three gates directly.
//
// Run: node repro-wb-initvar.mjs
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseMuvCard } from './lib/muv-parser.js'
import { readPngCard } from './lib/png-card.js'
import { findCard } from './test-cards.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))

// The old module has to sit next to lib/initvar-parser.js for its relative import to
// resolve, and is removed again right after loading (dynamic import caches it).
const TMP = path.join(DIR, 'lib', 'tmp-old-muv-parser.mjs')
let oldParse
try {
  fs.writeFileSync(TMP, execFileSync('git', ['show', 'HEAD:lib/muv-parser.js'], { cwd: DIR, encoding: 'utf8' }))
  oldParse = (await import(pathToFileURL(TMP).href)).parseMuvCard
} catch (e) {
  console.log('无法从 git HEAD 取旧版解析器: ' + e.message)
}
fs.rmSync(TMP, { force: true })

let fail = 0
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}

console.log('=== 真实卡：旧 vs 新 ===\n')
const CARDS = ['异世界农场', '苍玄界', '_足控天堂2', '食人世界', '涩涩提瓦特', 'default_Seraphina']
for (const nm of CARDS) {
  const file = findCard(nm)
  if (!file) { console.log('  SKIP ' + nm + '（本机没有这张卡）'); continue }
  const card = readPngCard(file)
  const now = parseMuvCard(card)
  const before = oldParse ? oldParse(card) : null
  const diff = before
    ? (JSON.stringify(before.initvarData) !== JSON.stringify(now.initvarData) ? '数据变了' : '数据没变')
    : '(无法比较)'
  console.log('  ' + nm.padEnd(16) + ' schemas ' + (before ? before.schemas.length : '?') + ' -> ' + now.schemas.length +
    '   source=' + String(now.schemaSource).padEnd(18) + ' ' + diff)
  if (nm === '异世界农场') {
    check('★ 异世界农场：0 -> 3 组', now.schemas.length === 3, 'schemas=' + now.schemas.length)
    check('★ 组名就是 时间 / 种族好感度 / 个人好感度',
      now.schemas.map(s => s.name).join(',') === '时间,种族好感度,个人好感度',
      now.schemas.map(s => s.name).join(','))
    check('★ schemaSource 标成 worldbook-initvar', now.schemaSource === 'worldbook-initvar', now.schemaSource)
    check('★ 数据真的能读到（时间.日期）', String(now.initvarData?.时间?.日期 || '').includes('05-20'),
      JSON.stringify(now.initvarData?.时间))
    check('★ Zod 仍然读得到（上一轮修复没被挤掉）', String(now.zodSource || '').length > 100)
  } else if (before) {
    check(nm + '：解析结果与旧版逐字节一致（没有误伤）',
      JSON.stringify({ s: before.schemas, d: before.initvarData }) === JSON.stringify({ s: now.schemas, d: now.initvarData }),
      'schemas ' + before.schemas.length + ' -> ' + now.schemas.length)
  }
}

console.log('\n=== 三道闸 ===\n')

// 闸①：其它来源只要还能用上，就不许改读世界书。
const gate1 = parseMuvCard({
  data: {
    name: 'gate1',
    first_mes: '<initvar>\n名字: 问候语里的\n</initvar>',
    character_book: { entries: [{ comment: '[initvar]变量初始化勿开', content: '名字: 世界书里的\n年龄: 3' }] },
  },
})
check('闸① 问候语里的 <initvar> 优先于裸 [initvar] 世界书条目',
  gate1.initvarData.名字 === '问候语里的' && gate1.schemaSource === 'initvar',
  JSON.stringify(gate1.initvarData) + ' source=' + gate1.schemaSource)

const gate1b = parseMuvCard({
  data: {
    name: 'gate1b',
    first_mes: '<VariableInsert>{"问候语里的":1}</VariableInsert>',
    character_book: { entries: [{ comment: '[initvar]变量初始化勿开', content: '名字: 世界书里的' }] },
  },
})
check('闸① <VariableInsert> 也优先于裸 [initvar] 世界书条目',
  gate1b.initvarData['问候语里的'] === 1 && gate1b.schemaSource === 'variable-insert',
  JSON.stringify(gate1b.initvarData) + ' source=' + gate1b.schemaSource)

// 闸②：解析出来是空的就不采用。
for (const [label, content] of [['空串', ''], ['只有空白行', '\n\n   \n'], ['只有注释', '# 变量初始化']]) {
  const g = parseMuvCard({
    data: { name: 'gate2', first_mes: '没有变量', character_book: { entries: [{ comment: '[initvar]x', content }] } },
  })
  check('闸② ' + label + ' -> 不采用，schemas=0 且 source=none',
    g.schemas.length === 0 && g.schemaSource === 'none' && Object.keys(g.initvarData).length === 0,
    'schemas=' + g.schemas.length + ' source=' + g.schemaSource + ' data=' + JSON.stringify(g.initvarData))
}

// 闸③ + 前缀边界：只有 `[initvar]` 才算数据，兄弟约定是**文档**。
const docOnly = parseMuvCard({
  data: {
    name: 'doconly',
    first_mes: '没有变量',
    character_book: {
      entries: [
        { comment: '[mvu_update]变量输出格式', content: '---\n变量输出格式:\n  rule:\n    - you must output the update analysis' },
        { comment: '[mvu_update]变量更新规则', content: '变量更新规则:\n  种族好感度: 0' },
        { comment: '[mvu_plot]插画强调', content: '---\n[插画强调]\n重要' },
      ],
    },
  },
})
check('★ [mvu_update] / [mvu_plot] 条目不会被当成变量（文档不是数据）',
  docOnly.schemas.length === 0 && docOnly.schemaSource === 'none',
  'schemas=' + docOnly.schemas.length + ' source=' + docOnly.schemaSource + ' data=' + JSON.stringify(docOnly.initvarData))

const gate3 = parseMuvCard({
  data: { name: 'gate3', first_mes: '没有变量', character_book: { entries: [{ comment: '[initvar]变量初始化勿开', content: '甲: 1\n乙:\n  丙: 2' }] } },
})
check('闸③ 裸 [initvar] 条目被采用且标出来源',
  gate3.schemas.length === 2 && gate3.schemaSource === 'worldbook-initvar' && gate3.initvarData.乙?.丙 === 2,
  'schemas=' + gate3.schemas.length + ' source=' + gate3.schemaSource)

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
