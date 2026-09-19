// Minimal reproduction: a PNG card whose variables live in
// `<VariableInsert>{…JSON…}</VariableInsert>` yielded `schemas: 0`, so the
// variable panel had nothing to build a table from.
//
// Run: node repro-variableinsert.mjs
//
// Exit code 0 = fixed, 1 = still broken. Run it before and after the change —
// this file is the "reproduce first" half of the fix and is kept on purpose.
//
// It exercises the plugin exactly the way DSH does: it mounts the real routes
// through `apply()` with a stub web server, then calls
// `/api/muv-table/tavern-card` in-process. That is the same code path the
// browser hits, without needing a DSH restart.

import { readPngCard } from './lib/png-card.js'
import { parseMuvCard } from './lib/muv-parser.js'
import { apply } from './lib/index.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CARD = process.env.MUV_REPRO_CARD
  || 'C:/MySpecialFolder/SillyTavern/data/default-user/characters/_足控天堂2.png'
const PRESET_ID = process.env.MUV_REPRO_PRESET || 'preset-mt5ip9cc-t6josi'

const REQUIRED_KEYS = ['世界信息', '主角信息', '公司', '道具系统', '剧情事件', '因特网', '剧情选项', '主播档案']

let bad = 0
function line(label, ok, detail) {
  console.log((ok ? '  OK   ' : '  FAIL ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) bad++
}

console.log('=== 复现: VariableInsert 卡读不到变量表 ===\n')
console.log('card: ' + CARD)

if (!fs.existsSync(CARD)) {
  console.log('  SKIP 卡文件不存在')
  process.exit(0)
}

// ── 1) 卡本身的形状 ────────────────────────────────────────
const card = readPngCard(CARD)
const hay = JSON.stringify(card?.data || {})
const hasInsert = /<VariableInsert>/i.test(hay)
const hasInitvar = /<initvar>/i.test(hay)
console.log('\n[1] 卡的形状')
line('<VariableInsert> 存在', hasInsert)
line('<initvar> 不存在（这就是根因）', !hasInitvar, hasInitvar ? '卡里居然有 initvar' : '')

// ── 2) 解析层 ─────────────────────────────────────────────
console.log('\n[2] parseMuvCard（PNG 卡主路径真正调用的函数）')
const parsed = parseMuvCard(card)
line('schemas 非空', parsed.schemas.length > 0, 'schemas=' + parsed.schemas.length)
line('initvarData 有真实变量树', Object.keys(parsed.initvarData || {}).length > 0,
  'keys=' + Object.keys(parsed.initvarData || {}).join(','))
if (parsed.schemas.length > 0) {
  const top = parsed.schemas.map(s => s.name)
  line('顶层键齐全', REQUIRED_KEYS.every(k => top.includes(k)),
    '缺: ' + REQUIRED_KEYS.filter(k => !top.includes(k)).join(',') + '  实有: ' + top.join(','))
  line('主播档案.$template 不算条目', !top.includes('$template'))
  const anchor = parsed.schemas.find(s => s.name === '主播档案')
  if (anchor) {
    line('主播档案 下有真实主播 超天酱',
      (anchor.children || []).some(c => c.name === '超天酱'),
      'children=' + (anchor.children || []).map(c => c.name).join(','))
  }
}

// ── 3) 端点层（和浏览器走同一条路径）────────────────────
console.log('\n[3] /api/muv-table/tavern-card（进程内挂载真实路由）')
const routes = []
apply({
  get: () => undefined,
  webServer: { register: (r) => { routes.push(r) } },
})
const route = routes.find(r => r.path === '/api/muv-table/tavern-card')
line('路由已注册', !!route, '已注册: ' + routes.map(r => r.path).join(' '))

let endpoint = null
if (route) {
  const req = {
    method: 'GET',
    url: '/api/muv-table/tavern-card?presetId=' + encodeURIComponent(PRESET_ID),
  }
  let status = 0
  let raw = ''
  const res = {
    writeHead: (s) => { status = s },
    end: (b) => { raw = String(b) },
  }
  await route.handler(req, res)
  try { endpoint = JSON.parse(raw) } catch (_) {}
  line('HTTP 200', status === 200, 'status=' + status)
  if (endpoint) {
    console.log('  cardName=' + endpoint.cardName + '  source=' + endpoint.cardSource
      + '  file=' + endpoint.fileName)
    line('schemas 长度 > 0', (endpoint.schemas || []).length > 0,
      'schemas=' + (endpoint.schemas || []).length)
    const keys = Object.keys(endpoint.initvarData || {})
    line('initvarData 里有真实的变量树', keys.length > 0, 'keys=' + keys.join(','))
    line('顶层键齐全', REQUIRED_KEYS.every(k => keys.includes(k)),
      '缺: ' + REQUIRED_KEYS.filter(k => !keys.includes(k)).join(','))
    line('仍是卡库里的 PNG 卡', endpoint.cardSource === 'library' && /\.png$/.test(endpoint.fileName || ''),
      endpoint.cardSource + '/' + endpoint.fileName)
  }
}

// ── 4) 幂等：不能把有 initvar 的卡搞坏 ───────────────────
console.log('\n[4] 反向保护：<initvar> 卡仍走原路径')
const nativeCard = {
  data: {
    name: 'native',
    alternate_greetings: ['<initvar>\n名字: 原生\n年龄: 3\n</initvar>'],
    first_mes: '<VariableInsert>{"不该被用":1}</VariableInsert>',
  },
}
const nv = parseMuvCard(nativeCard)
line('有 initvar 时不被 VariableInsert 抢走', Object.keys(nv.initvarData).join(',') === '名字,年龄',
  Object.keys(nv.initvarData).join(','))

console.log('\n=== ' + (bad ? bad + ' 项不通过 —— bug 仍在' : '全部通过 —— 已修复') + ' ===')
process.exit(bad ? 1 : 0)
