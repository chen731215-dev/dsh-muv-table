// 复现②：presetId 不存在时，端点悄悄返回另一张卡（tavern-lite 的「川上富江」）。
//
// Run: node repro-preset-not-found.mjs
// 退出码 0 = 已修好，1 = 仍然是坏的。
//
// 实测（改前）：GET /api/muv-table/tavern-card?presetId=does-not-exist
//   -> HTTP 200 { ok:true, found:true, cardName:'川上富江', presetDir:'tavern-lite' }
// 用户以为在看自己的卡，其实看的是 tavern-lite 的。预设改名/重名时同样中招。
//
// 复现方式跟 DSH 一致：用桩 webServer 走 apply() 注册真实路由，再在进程内请求。

import { apply } from './lib/index.js'

let bad = 0
function line(label, ok, detail) {
  console.log((ok ? '  OK   ' : '  FAIL ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) bad++
}

console.log('=== 复现②: presetId 不存在 → 静默换一张卡 ===\n')

const routes = []
apply({ get: () => undefined, webServer: { register: (r) => routes.push(r) } })
const route = routes.find(r => r.path === '/api/muv-table/tavern-card')
if (!route) {
  console.log('  FAIL 路由没注册出来')
  process.exit(1)
}

async function call(qs) {
  let status = 0
  let raw = ''
  await route.handler(
    { method: 'GET', url: '/api/muv-table/tavern-card' + qs },
    { writeHead: (s) => { status = s }, end: (b) => { raw = String(b) } },
  )
  let body = null
  try { body = JSON.parse(raw) } catch (_) {}
  return { status, body }
}

// 1) 明确不存在的 presetId
console.log('[1] ?presetId=does-not-exist')
const r1 = await call('?presetId=does-not-exist')
console.log('  返回: HTTP ' + r1.status + ' ' + JSON.stringify({
  ok: r1.body?.ok, found: r1.body?.found, cardName: r1.body?.cardName,
  presetDir: r1.body?.presetDir, error: r1.body?.error,
}))
line('HTTP 200（不是 500）', r1.status === 200, 'status=' + r1.status)
line('found:false', r1.body?.found === false, 'found=' + r1.body?.found)
line('不返回任何卡的 schema', (r1.body?.schemas || []).length === 0,
  'schemas=' + (r1.body?.schemas || []).length)
line('错误信息里点名了那个 presetId',
  typeof r1.body?.error === 'string' && r1.body.error.includes('does-not-exist'),
  'error=' + JSON.stringify(r1.body?.error))
line('没有偷偷换成别的 preset',
  r1.body?.presetDir === undefined || r1.body.presetDir === '',
  'presetDir=' + r1.body?.presetDir)

// 2) 路径穿越式输入不能被当成合法 preset
console.log('\n[2] ?presetId=../tavern-lite（不许逃出预设根目录）')
const r2 = await call('?presetId=' + encodeURIComponent('../tavern-lite'))
console.log('  返回: HTTP ' + r2.status + ' found=' + r2.body?.found
  + ' presetDir=' + r2.body?.presetDir + ' error=' + JSON.stringify(r2.body?.error))
line('found:false（不解析带分隔符的 id）', r2.body?.found === false, 'found=' + r2.body?.found)

// 3) 真的存在的 preset 必须照旧能读出来（别把正常路径一起修坏了）
console.log('\n[3] 合法 preset 仍然正常（回归保护）')
const r3 = await call('?presetId=tavern-lite')
console.log('  返回: HTTP ' + r3.status + ' found=' + r3.body?.found
  + ' cardName=' + r3.body?.cardName + ' presetDir=' + r3.body?.presetDir
  + ' presetSource=' + r3.body?.presetSource)
line('found:true', r3.body?.found === true, 'found=' + r3.body?.found)
line('presetDir 就是请求的那个', r3.body?.presetDir === 'tavern-lite', 'presetDir=' + r3.body?.presetDir)
line('有卡名', !!r3.body?.cardName, 'cardName=' + r3.body?.cardName)
line('来源标明是显式指定', r3.body?.presetSource === 'explicit', 'presetSource=' + r3.body?.presetSource)

// 4) 会话没绑定预设（绑定是 default / 没有绑定）——酒馆自己会把这种会话当 tavern-lite
//    （lib/index.js:2404 `if (currentPresetId === 'default') currentPresetId = 'tavern-lite'`），
//    所以这里回退到 tavern-lite 是**照抄酒馆的规则**，不是瞎猜；但必须由 presetSource 标出来。
console.log('\n[4] 会话未绑定预设（sessionId 指向一个不存在的绑定）')
const r4 = await call('?sessionId=session-does-not-exist')
console.log('  返回: HTTP ' + r4.status + ' found=' + r4.body?.found
  + ' presetDir=' + r4.body?.presetDir + ' presetSource=' + r4.body?.presetSource
  + ' error=' + JSON.stringify(r4.body?.error))
line('HTTP 200', r4.status === 200, 'status=' + r4.status)
line('结果是可解释的（要么明确 found:false，要么标成 session-default）',
  (r4.body?.found === false && typeof r4.body?.error === 'string')
  || r4.body?.presetSource === 'session-default',
  'found=' + r4.body?.found + ' source=' + r4.body?.presetSource)
line('绝不谎称是显式指定的那张卡', r4.body?.presetSource !== 'explicit',
  'presetSource=' + r4.body?.presetSource)

// 5) 没有定位参数：只能靠「最近写入的会话」猜，猜中要标明来源
console.log('\n[5] 无定位参数')
const r5 = await call('')
console.log('  返回: HTTP ' + r5.status + ' found=' + r5.body?.found
  + ' presetDir=' + r5.body?.presetDir + ' presetSource=' + r5.body?.presetSource)
line('要么 found:false，要么标明 presetSource', r5.body?.found === false || !!r5.body?.presetSource,
  JSON.stringify({ found: r5.body?.found, source: r5.body?.presetSource }))

console.log('\n=== ' + (bad ? bad + ' 项不通过 —— bug 仍在' : '全部通过 —— 已修复') + ' ===')
process.exit(bad ? 1 : 0)
