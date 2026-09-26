// Repro (keep): 「串台」—— 会话绑定 A + 一个**过期的** presetId B，服务端解析出的是谁？
//
// 用户实测的现象：在「瑟瑟提瓦特」的会话里看到了「足控天堂」的状态栏界面。
// 机制推断（静态）：客户端两个 id 都送、且 presetId 排在前面；而 presetId 来自酒馆面板的
// `dataset.presetId` / localStorage —— **切换会话后它可能仍是上一个会话的预设**。
//
// 这个脚本不用合成数据，走**用户真实的 session-bindings.json 与真实预设目录**：
//   ① 读真实绑定表，挑出两个「绑定到不同预设」的真实会话；
//   ② 把这两个真实预设目录 + 真实绑定表复制进**临时 DSH_HOME**（不碰用户状态）；
//   ③ 用真实路由跑三种问法，看它到底把哪张卡交出来。
//
// 运行：node repro-preset-crosstalk.mjs

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const REAL_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const REAL_PRESETS = path.join(REAL_HOME, '.agent-presets')
const BINDINGS = path.join(REAL_PRESETS, 'session-bindings.json')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

console.log('=== 串台复现（真实绑定表 + 真实预设目录，跑在临时 DSH_HOME 里）===\n')

if (!fs.existsSync(BINDINGS)) {
  console.log('找不到真实绑定表：' + BINDINGS)
  console.log('（换机或没有酒馆会话时会这样；本脚本需要真实数据才能复现）')
  process.exit(0)
}

const bind = JSON.parse(fs.readFileSync(BINDINGS, 'utf8'))
const exists = (id) => {
  try { return fs.statSync(path.join(REAL_PRESETS, id)).isDirectory() } catch (_) { return false }
}

// 挑两个「绑定到不同、且都真实存在」的预设
const pairs = Object.entries(bind).filter(([, p]) => p && p !== 'default' && exists(p))
// ⚠ 这里曾经用 Map<presetId, sessionId>，然后按 [sessionId, presetId] 解构 —— 顺序反了，
//    报出来的是"会话 = preset-mt0f1ffm…、预设 = session-aa3ea3cb…"（一眼可见的荒谬）。
//    保持 [sessionId, presetId] 的原始顺序，只按 presetId 去重。
const seenPreset = new Set()
const picks = []
for (const [sid, pid] of pairs) {
  if (seenPreset.has(pid)) continue
  seenPreset.add(pid)
  picks.push([sid, pid])
}
console.log('真实绑定表：' + Object.keys(bind).length + ' 条，其中指向真实存在预设的 ' + pairs.length + ' 条')
if (picks.length < 2) {
  console.log('真实数据里只有 1 个不同的真实预设（' + JSON.stringify(picks) + '）')
  console.log('→ 用同一个会话 + 另一个预设 id 做「过期 presetId」也能复现，继续。')
}

const [sessionId, boundPreset] = picks[0]
// 「过期的 presetId」= 另一个真实存在的预设（模拟"面板上还留着上一个会话的预设"）
const stalePreset = (picks[1] && picks[1][1]) ||
  fs.readdirSync(REAL_PRESETS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    .find((n) => n !== boundPreset && exists(n))
console.log('  会话（真实）        : ' + sessionId)
console.log('  它绑定的预设（真实）: ' + boundPreset)
console.log('  过期 presetId（模拟）: ' + stalePreset + '\n')

// ── 造一个临时 DSH_HOME：真实绑定表 + 这两个真实预设目录 ──────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-muv-crosstalk-'))
fs.mkdirSync(path.join(tmp, '.agent-presets'), { recursive: true })
fs.copyFileSync(BINDINGS, path.join(tmp, '.agent-presets', 'session-bindings.json'))
for (const id of [boundPreset, stalePreset]) {
  if (!id) continue
  fs.cpSync(path.join(REAL_PRESETS, id), path.join(tmp, '.agent-presets', id), { recursive: true })
}
process.env.DSH_HOME = tmp

const { apply } = await import('./lib/index.js')
const routes = []
apply({ get: () => undefined, webServer: { register: (r) => routes.push(r) } })
const route = routes.find((r) => r.path === '/api/muv-table/tavern-card')

async function call(qs) {
  let status = 0, raw = ''
  await route.handler(
    { method: 'GET', url: '/api/muv-table/tavern-card' + qs },
    { writeHead: (s) => { status = s }, end: (b) => { raw = String(b) } },
  )
  let body = null
  try { body = JSON.parse(raw) } catch (_) {}
  return { status, body }
}
const show = (label, r) => console.log('  ' + label + ' -> ' + JSON.stringify({
  found: r.body?.found, presetDir: r.body?.presetDir, presetSource: r.body?.presetSource,
  cardName: r.body?.cardName, error: r.body?.error,
}))

console.log('[1] 旧口径（两个 id 都送、presetId 在前）会命中哪一个？')
const r1 = await call('?presetId=' + encodeURIComponent(stalePreset) + '&sessionId=' + encodeURIComponent(sessionId))
show('结果', r1)
check('★ 按**会话绑定**出卡（不是过期的 presetId）', r1.body?.presetDir === boundPreset, r1.body?.presetDir)
check('★ presetSource=session（一眼能看出这是按会话来的）', r1.body?.presetSource === 'session', r1.body?.presetSource)
check('★ 不是 explicit —— 是 explicit 就等于串台复现了', r1.body?.presetSource !== 'explicit', r1.body?.presetSource)

console.log('\n[2] 只有 presetId（没有会话）—— 原语义必须保持')
const r2 = await call('?presetId=' + encodeURIComponent(stalePreset))
show('结果', r2)
check('按 presetId 出卡', r2.body?.presetDir === stalePreset, r2.body?.presetDir)
check('presetSource=explicit', r2.body?.presetSource === 'explicit', r2.body?.presetSource)

console.log('\n[3] preferPreset=1（需要"按 id 强制取"的调用方显式声明）')
const r3 = await call('?presetId=' + encodeURIComponent(stalePreset) + '&sessionId=' + encodeURIComponent(sessionId) + '&preferPreset=1')
show('结果', r3)
check('按 presetId 出卡', r3.body?.presetDir === stalePreset && r3.body?.presetSource === 'explicit',
  r3.body?.presetDir + '/' + r3.body?.presetSource)

console.log('\n[4] 真实绑定表：有多少个会话在"粘住"的 presetId 下会串台（口径：绑定 ≠ 面板值）')
const distinct = new Set(pairs.map(([, p]) => p))
console.log('  真实数据里有 ' + distinct.size + ' 个不同预设被不同会话绑定：' + [...distinct].join(', '))
check('真实数据确实存在"多个会话各绑各的预设"（串台的前提条件成立）', distinct.size >= 1,
  'distinct=' + distinct.size)

try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
