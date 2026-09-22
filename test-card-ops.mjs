// 卡运维回归：「点『➕ 把当前卡的开场白注入会话末尾』→ 发出去的请求体是什么」。
//
// Run: node test-card-ops.mjs
//
// 为什么测这个：这条链路唯一的"协议"就是那个 HTTP 请求。面板上一切（成功/已存在/降级）
// 都是从响应里读出来的，所以**请求体形状**错了，用户看到的现象会非常难查（服务端按
// sessionId 权威解析预设；带错 presetId 会静默串台到别的卡，见 docs/04 排错手册）。
//
// 本用例**逐字提取** lib/client.js 里两端标记之间的那段函数执行 —— 不是复制一份到测试里，
// 所以被测代码改了它就会跟着变（对照组会因此变红，见 §D）。
// 因此那段代码有硬约束：不许引用 React / DOM / 外层闭包变量，只用入参 + 全局 fetch。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(here, 'lib', 'client.js')
const src = fs.readFileSync(CLIENT, 'utf8')

// ── 逐字提取被标记的那段 ─────────────────────────────────────────────
const BEGIN = '// [[card-ops-greeting-start]]'
const END = '// [[card-ops-greeting-end]]'
const i0 = src.indexOf(BEGIN)
const i1 = src.indexOf(END)
if (i0 < 0 || i1 < 0 || i1 < i0) {
  console.log('FAIL 在 lib/client.js 里找不到 [[card-ops-greeting-start/end]] 标记')
  process.exit(1)
}
const extracted = src.slice(i0 + BEGIN.length, i1).trim()

console.log('=== 卡运维 · 开场白注入（逐字提取执行）===\n')

// 把提取到的函数体编译出来（声明语句 → 取出函数引用）
function buildFn(body) {
  // eslint-disable-next-line no-new-func
  return new Function(body + '\nreturn cardOpsInsertGreeting')()
}

// 假的 fetch：记录请求，按脚本回响应
function mockFetch(responder) {
  const calls = []
  const f = async (url, init) => {
    calls.push({ url, init })
    return responder(url, init)
  }
  f.calls = calls
  return f
}
function jsonRes(status, obj) {
  return { status, ok: status >= 200 && status < 300, json: async () => obj }
}
// 路由不存在时的真实形态：非 JSON 响应 ⇒ json() 抛错
function htmlRes(status) {
  return { status, ok: false, json: async () => { throw new SyntaxError('Unexpected token <') } }
}

console.log('[A] 结构不变量（提取段必须自洽，否则"逐字提取"就成了假的）')
check('提取段含 cardOpsInsertGreeting 声明', /async function cardOpsInsertGreeting\s*\(/.test(extracted))
check('提取段不引用 React / document / window（否则无法独立执行）',
  !/\bReact\b|\bdocument\b|\bwindow\.__/.test(extracted),
  (extracted.match(/\bReact\b|\bdocument\b|\bwindow\.__/g) || []).join(','))

const insetGreeting = buildFn(extracted)

console.log('\n[B] 手势 → 请求：有会话 id 时')
{
  const f = mockFetch(() => jsonRes(200, { ok: true, inserted: true, cardName: '足控天堂', greetingLen: 321, turn: 1 }))
  const r = await insetGreeting({ sessionId: 'session-0123456789abcdef0123456789abcdef', fetch: f })
  check('只发一次请求', f.calls.length === 1, 'calls=' + f.calls.length)
  const c = f.calls[0] || {}
  check('打的是 /api/tavern/greeting/insert', c.url === '/api/tavern/greeting/insert', String(c.url))
  check('方法 POST', c.init && c.init.method === 'POST', String(c.init && c.init.method))
  check('content-type: application/json',
    c.init && c.init.headers && c.init.headers['content-type'] === 'application/json',
    JSON.stringify(c.init && c.init.headers))
  check('请求体**只**含 sessionId（presetId 由服务端按会话权威解析，不许发猜的）',
    c.init && c.init.body === '{"sessionId":"session-0123456789abcdef0123456789abcdef"}',
    String(c.init && c.init.body))
  check('成功 ⇒ kind=ok 且带回卡名与字数',
    r.kind === 'ok' && r.message.includes('足控天堂') && r.message.includes('321'),
    JSON.stringify(r))
}

console.log('\n[C] 手势 → 请求：认不出会话（不带 sessionId）')
{
  const f = mockFetch(() => jsonRes(200, { ok: true, cardName: 'X', greetingLen: 1, turn: 1 }))
  const r = await insetGreeting({ sessionId: '', fetch: f })
  const c = f.calls[0] || {}
  check('请求体为空对象 {}（undefined 键被 JSON.stringify 丢掉，交给服务端兜底 lastSessionId）',
    c.init && c.init.body === '{}', String(c.init && c.init.body))
  check('仍然 kind=ok（不是本地拦下）', r.kind === 'ok', JSON.stringify(r))
}

console.log('\n[D] 对照臂（必须真变红）：把请求体改回"带上猜出来的 presetId"')
{
  // 函数式 replace（铁律）：大段文本替换一律用函数式替换串
  const mutated = extracted.replace(
    'body: JSON.stringify({ sessionId: sessionId || undefined })',
    () => "body: JSON.stringify({ sessionId: sessionId || undefined, presetId: 'stuck-preset-from-dom' })"
  )
  check('对照臂的替换确实生效（没生效的话下面的断言就是空跑）', mutated !== extracted)
  const bad = buildFn(mutated)
  const f = mockFetch(() => jsonRes(200, { ok: true, cardName: 'X', greetingLen: 1, turn: 1 }))
  await bad({ sessionId: 'session-0123456789abcdef0123456789abcdef', fetch: f })
  const c = f.calls[0] || {}
  const wouldPass = c.init && c.init.body === '{"sessionId":"session-0123456789abcdef0123456789abcdef"}'
  check('带 presetId 的请求体**过不了** [B] 的断言（断言不是永真）',
    !wouldPass, 'body=' + String(c.init && c.init.body))
}

console.log('\n[E] 响应分支：已存在 / 服务端明确原因 / 接口不存在 / 网络不可达')
{
  const okSpy = mockFetch(() => jsonRes(200, { ok: false, error: 'greeting-already-present' }))
  const r1 = await insetGreeting({ sessionId: 'session-0123456789abcdef0123456789abcdef', fetch: okSpy })
  check('greeting-already-present ⇒ kind=present（蓝色提示，不是报错）',
    r1.kind === 'present' && r1.message.includes('已有开场白'), JSON.stringify(r1))

  const liveSpy = mockFetch(() => jsonRes(404, { ok: false, error: 'session-not-live：会话 x 当前没有活跃的 Session 对象' }))
  const r2 = await insetGreeting({ sessionId: 'session-0123456789abcdef0123456789abcdef', fetch: liveSpy })
  check('404 + JSON（会话不活跃）⇒ kind=error 且照原样显示服务端原因（不当成"接口不存在"）',
    r2.kind === 'error' && r2.message.includes('session-not-live'), JSON.stringify(r2))

  const missSpy = mockFetch(() => htmlRes(404))
  const r3 = await insetGreeting({ sessionId: 'session-0123456789abcdef0123456789abcdef', fetch: missSpy })
  check('404 + 非 JSON（路由没实现）⇒ kind=degrade，提示更新/重启酒馆插件',
    r3.kind === 'degrade' && r3.message.includes('dsh-tavern-v2'), JSON.stringify(r3))

  const badSpy = mockFetch(() => { throw new TypeError('Failed to fetch') })
  const r4 = await insetGreeting({ sessionId: 'session-0123456789abcdef0123456789abcdef', fetch: badSpy })
  check('fetch 直接抛（酒馆插件没起）⇒ kind=degrade，不向上抛异常',
    r4.kind === 'degrade' && r4.message.includes('Failed to fetch'), JSON.stringify(r4))
}

console.log('\n[F] 提取段确实来自 lib/client.js 的交付版本（不是测试自带副本）')
check('标记在文件里各出现一次',
  src.split(BEGIN).length - 1 === 1 && src.split(END).length - 1 === 1)
check('client.js 里 UI 侧确实调用它（按钮 → 纯函数）',
  src.includes('setGreet(await cardOpsInsertGreeting('), '缺少调用点')
check('client.js 里有卡运维区块的挂载点与元素标记',
  src.includes("'data-dsh-muv-card-ops'") &&
  src.includes("'data-dsh-card-ops-greeting-insert'") &&
  src.includes("'data-dsh-card-ops-refresh'"))

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
