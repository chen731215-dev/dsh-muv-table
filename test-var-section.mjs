// 运行时变量折叠区回归（P1：自 dsh-tavern-v2「🔢 变量面板」迁入 MUV 表格面板）。
//
// Run: node test-var-section.mjs
//
// 为什么测这些：这条链路的"协议"是 muv-engine 的 HTTP 形状 —— 保存请求体必须是
// 精确的 { sessionId, merge:true, data }（merge 语义只加不改不删，null/0/false/''
// 这些"假值叶子"一旦在提交前被 coerce 就会被静默吃掉）；以及三块纯行为契约：
// 失败保留本地 edits、已覆盖三态、快照入口探测失败必须隐藏。
//
// 本用例**逐字提取** lib/client.js 里两端标记之间的那段纯函数执行 —— 不是复制一份到
// 测试里，所以被测代码改了它就会跟着变（结构断言会因此变红）。
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

// ── 逐字提取被标记的纯函数段 ─────────────────────────────────────────
const BEGIN = '// [[var-section-core-start]]'
const END = '// [[var-section-core-end]]'
const i0 = src.indexOf(BEGIN)
const i1 = src.indexOf(END)
if (i0 < 0 || i1 < 0 || i1 < i0) {
  console.log('FAIL 在 lib/client.js 里找不到 [[var-section-core-start/end]] 标记')
  process.exit(1)
}
const extracted = src.slice(i0 + BEGIN.length, i1).trim()

// UI 切片（含 React 壳）：从核心段开头到 MacroPanel 标记，供结构断言用
const UI_END = '// ============ MacroPanel ============'
const uiSlice = src.slice(i0, src.indexOf(UI_END))

const api = new Function(extracted + '\nreturn {' +
  'varSectionLoadState, varSectionSave, varSectionListSnapshots, varSectionEnterSnapshot,' +
  'varSectionEditsToPayload, varSectionIsOverridden, varSectionLeafDisplay, varSectionNormalizeEdit,' +
  'varSectionApplySaveResult, varSectionDefaultExpanded, varSectionSearchHits, varSectionSnapLabel,' +
  'varSectionExportText, VAR_PATH_SEP }')()

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
function htmlRes(status) {
  return { status, ok: false, json: async () => { throw new SyntaxError('Unexpected token <') } }
}

const SID = 'session-0123456789abcdef0123456789abcdef'
const SEP = api.VAR_PATH_SEP

console.log('=== 📊 运行时变量折叠区（逐字提取执行）===\n')

console.log('[A] 结构不变量（提取段必须自洽，否则"逐字提取"就成了假的）')
check('提取段含 varSectionSave / varSectionLoadState 声明',
  /async function varSectionSave\s*\(/.test(extracted) && /async function varSectionLoadState\s*\(/.test(extracted))
check('提取段不引用 React / document / window / innerHTML（否则无法独立执行）',
  !/\bReact\b|\bdocument\b|\bwindow\b|innerHTML/.test(extracted),
  (extracted.match(/\bReact\b|\bdocument\b|\bwindow\b|innerHTML/g) || []).join(','))
check('标记在文件里各出现一次',
  src.split(BEGIN).length - 1 === 1 && src.split(END).length - 1 === 1)

console.log('\n[B] 保存按钮 → 请求体**精确形状** { sessionId, merge:true, data }')
{
  const edits = {}
  edits['战斗' + SEP + 'hp'] = { value: 0, type: 'number' }
  edits['旗标'] = { value: false, type: 'boolean' }
  edits['备注'] = { value: '', type: 'string' }
  edits['深度' + SEP + '嵌套' + SEP + '空串'] = { value: '', type: 'string' }
  const f = mockFetch(() => jsonRes(200, { ok: true }))
  const r = await api.varSectionSave({ sessionId: SID, edits, fetch: f })
  check('只发一次请求', f.calls.length === 1, 'calls=' + f.calls.length)
  const c = f.calls[0] || {}
  check('打的是 POST /api/muv-engine/state',
    c.url === '/api/muv-engine/state' && c.init && c.init.method === 'POST',
    String(c.url) + ' ' + String(c.init && c.init.method))
  check('请求体精确形状（merge:true；edits 拍成嵌套 data；值原样）',
    c.init && c.init.body === '{"sessionId":"' + SID + '","merge":true,"data":{"战斗":{"hp":0},"旗标":false,"备注":"","深度":{"嵌套":{"空串":""}}}}',
    String(c.init && c.init.body))
  check('成功 ⇒ kind=ok 且带回写回处数', r.kind === 'ok' && r.count === 4, JSON.stringify(r))

  const f2 = mockFetch(() => jsonRes(200, { ok: true }))
  const r2 = await api.varSectionSave({ sessionId: '', edits, fetch: f2 })
  check('无会话 ⇒ kind=no-session 且**不发请求**', r2.kind === 'no-session' && f2.calls.length === 0, JSON.stringify(r2))
  const f3 = mockFetch(() => jsonRes(200, { ok: true }))
  const r3 = await api.varSectionSave({ sessionId: SID, edits: {}, fetch: f3 })
  check('没有修改 ⇒ kind=nothing 且不发请求', r3.kind === 'nothing' && f3.calls.length === 0, JSON.stringify(r3))
}

console.log('\n[C] 失败保留 edits + 状态行说人话；成功清空；刷新丢弃')
{
  const edits = {}
  edits['a' + SEP + 'b'] = { value: 1, type: 'number' }
  const f = mockFetch(() => jsonRes(500, { ok: false, error: 'session-not-live：会话当前不活跃' }))
  const r = await api.varSectionSave({ sessionId: SID, edits, fetch: f })
  check('失败 ⇒ kind=error 且 keepEdits=true', r.kind === 'error' && r.keepEdits === true, JSON.stringify(r))
  check('状态行带服务端原因 + "本地修改已保留"（说人话）',
    r.message.includes('session-not-live') && r.message.includes('保留'), String(r.message))
  check('失败后 edits 表**原封不动**（同一引用，可重试）',
    api.varSectionApplySaveResult(edits, r) === edits)
  check('成功 ⇒ edits 清空', Object.keys(api.varSectionApplySaveResult(edits, { kind: 'ok' })).length === 0)
  check('网络层直接抛（引擎没起）⇒ 同样 keepEdits=true 不向上抛',
    (async () => {
      const bad = mockFetch(() => { throw new TypeError('Failed to fetch') })
      const rr = await api.varSectionSave({ sessionId: SID, edits, fetch: bad })
      return rr.kind === 'error' && rr.keepEdits === true && rr.message.includes('Failed to fetch')
    })())
}

console.log('\n[D] 已覆盖标记三态（对照 initvarData）')
{
  const init = { a: 1, s: 'x', deep: { k: null } }
  check('值不同 ⇒ 标', api.varSectionIsOverridden(init, ['a'], 2) === true)
  check('值相同 ⇒ 不标', api.varSectionIsOverridden(init, ['a'], 1) === false)
  check('initvarData 无此键 ⇒ 不标', api.varSectionIsOverridden(init, ['missing'], 999) === false)
  check('深路径值相同（null==null）⇒ 不标', api.varSectionIsOverridden(init, ['deep', 'k'], null) === false)
  check('没有 initvarData（null/非对象）⇒ 不标',
    api.varSectionIsOverridden(null, ['a'], 1) === false && api.varSectionIsOverridden(undefined, ['a'], 1) === false)
}

console.log('\n[E] null / 0 / false / "" 的叶子：渲染正常 + 保存原样提交（不被 merge 吃掉）')
{
  check('null 叶子：不可编辑、显示文本 "null"',
    (() => { const d = api.varSectionLeafDisplay(null); return d.editable === false && d.text === 'null' })())
  check('0 叶子：可编辑、显示 "0"',
    (() => { const d = api.varSectionLeafDisplay(0); return d.editable === true && d.text === '0' && d.type === 'number' })())
  check('"" 叶子：可编辑、显示空串',
    (() => { const d = api.varSectionLeafDisplay(''); return d.editable === true && d.text === '' })())
  check('false 叶子：可编辑、布尔型',
    (() => { const d = api.varSectionLeafDisplay(false); return d.editable === true && d.type === 'boolean' })())
  check('编辑 0：数字输入 "0" 还原成数字 0（严格 ===，不是 "0"）',
    api.varSectionNormalizeEdit('number', '0') === 0)
  check('编辑数字填了非数字 ⇒ 保留字符串（不强转）',
    api.varSectionNormalizeEdit('number', 'abc') === 'abc')
  check('布尔编辑还原成布尔 false', api.varSectionNormalizeEdit('boolean', false) === false)
  check('字符串编辑原样', api.varSectionNormalizeEdit('string', '') === '')

  const edits = {}
  edits['hp' + SEP + 'cur'] = { value: 0, type: 'number' }
  edits['f'] = { value: false, type: 'boolean' }
  edits['m'] = { value: '', type: 'string' }
  edits['n'] = { value: null, type: 'null' }
  const payload = api.varSectionEditsToPayload(edits)
  check('提交 payload：0/false/""/null 全部原样（JSON 逐字对照）',
    JSON.stringify(payload) === '{"hp":{"cur":0},"f":false,"m":"","n":null}',
    JSON.stringify(payload))
  check('数组叶子：显示 "[数组 N 项]"（不可编辑）',
    (() => { const d = api.varSectionLeafDisplay([1, 2, 3]); return d.editable === false && d.text === '[数组 3 项]' })())
}

console.log('\n[F] 大树懒展开：默认只展开顶层对象分支，深层点开才渲染')
{
  const tree = { 顶层A: { x: 1, 子: { 深: 1 } }, 顶层B: 2, 顶层C: {} }
  const de = api.varSectionDefaultExpanded(tree)
  check('默认展开集合 = 顶层对象分支（空的顶层C 不算）',
    JSON.stringify(Object.keys(de).sort()) === JSON.stringify(['顶层A']), JSON.stringify(Object.keys(de)))
  check('深层路径不在默认展开集合里（懒展开，不预开）',
    Object.keys(de).every(k => k in tree))
  check('空树 / 非树 ⇒ 空集合',
    Object.keys(api.varSectionDefaultExpanded(null)).length === 0 &&
    Object.keys(api.varSectionDefaultExpanded({})).length === 0)
  check('UI：对象子层只在 isOpen 时渲染（if (isOpen) 才 push 子层）',
    /if \(isOpen\)/.test(uiSlice))
}

console.log('\n[G] 搜索过滤：命中 / 无命中 / 值命中')
{
  const tree = { 战斗: { hp: 100, 魔力: 20 }, 状态: { 中毒: true } }
  const h1 = api.varSectionSearchHits(tree, 'hp')
  check('路径名命中 1 条叶子（战斗.hp）',
    h1.length === 1 && h1[0].path.join('.') === '战斗.hp' && h1[0].value === 100, JSON.stringify(h1))
  const h2 = api.varSectionSearchHits(tree, '中毒')
  check('深层路径命中', h2.length === 1 && h2[0].path.join('.') === '状态.中毒', JSON.stringify(h2))
  const h3 = api.varSectionSearchHits(tree, '100')
  check('值也能命中', h3.length === 1 && h3[0].value === 100, JSON.stringify(h3))
  check('无命中 ⇒ 空数组（UI 显示"没有匹配的变量"）',
    api.varSectionSearchHits(tree, '不存在zzz').length === 0)
  check('空查询 ⇒ 空数组（走树视图，不走拍平视图）',
    api.varSectionSearchHits(tree, '').length === 0)
  check('limit 生效（大树防炸）',
    api.varSectionSearchHits({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }, '1', 3).length <= 3)
}

console.log('\n[H] 快照入口（按楼回看）：探测失败 ⇒ 隐藏，不报错不假装有数据')
{
  const h404 = await api.varSectionListSnapshots({ sessionId: SID, fetch: mockFetch(() => jsonRes(404, { ok: false, error: 'no-snapshots' })) })
  check('404 + !ok ⇒ kind=hidden', h404.kind === 'hidden', JSON.stringify(h404))
  const hnet = await api.varSectionListSnapshots({ sessionId: SID, fetch: mockFetch(() => { throw new TypeError('Failed to fetch') }) })
  check('网络错 ⇒ kind=hidden（静默，不抛）', hnet.kind === 'hidden')
  const hempty = await api.varSectionListSnapshots({ sessionId: SID, fetch: mockFetch(() => jsonRes(200, { ok: true, snapshots: [] })) })
  check('快照为空 ⇒ kind=hidden（保持隐藏）', hempty.kind === 'hidden')
  const ok = await api.varSectionListSnapshots({
    sessionId: SID,
    fetch: mockFetch(() => jsonRes(200, { ok: true, snapshots: [{ key: 'msg-abc12345678', at: 1690000000000, data: {} }] }))
  })
  check('有快照 ⇒ kind=ok 且原样带回列表', ok.kind === 'ok' && ok.snapshots.length === 1, JSON.stringify(ok))
  check('无会话 ⇒ hidden（不发探测）',
    (await api.varSectionListSnapshots({ sessionId: '', fetch: mockFetch(() => jsonRes(200, { ok: true, snapshots: [{}] })) })).kind === 'hidden')

  const e404 = await api.varSectionEnterSnapshot({ sessionId: SID, messageKey: 'msg-x', fetch: mockFetch(() => jsonRes(404, { ok: false })) })
  check('进楼失败（404）⇒ kind=error 且 message 可读', e404.kind === 'error' && e404.message.includes('快照不存在'), JSON.stringify(e404))
  const eok = await api.varSectionEnterSnapshot({
    sessionId: SID, messageKey: 'msg-k',
    fetch: mockFetch(() => jsonRes(200, { ok: true, state: { data: { 回看: 1 } } }))
  })
  check('进楼成功 ⇒ kind=ok 且带回该楼树', eok.kind === 'ok' && eok.tree && eok.tree.回看 === 1, JSON.stringify(eok))
  check('快照标签：键尾 8 位 + 过大未存标记',
    api.varSectionSnapLabel({ key: 'msg-abc12345678', at: 1690000000000, data: null }).includes('…12345678') &&
    api.varSectionSnapLabel({ key: 'msg-abc12345678', at: 1690000000000, data: null }).includes('（过大未存）'))
  check('UI：快照行只在 snapList 非空时渲染（探测失败整行不出现）',
    uiSlice.includes("snapList && snapList.length > 0 && jsx.jsxs('div', { 'data-dsh-muv-var-snap-row'"))
}

console.log('\n[I] XSS：变量值是外部数据，绝不允许变成真实元素')
{
  const evil = '<img src=x onerror=alert(1)>'
  const d = api.varSectionLeafDisplay(evil)
  check('恶意值原样作为**文本**交给渲染层（可编辑文本框的 value）',
    d.editable === true && d.text === evil, JSON.stringify(d))
  check('UI 切片无 innerHTML / insertAdjacentHTML / dangerouslySetInnerHTML',
    !uiSlice.includes('innerHTML') && !uiSlice.includes('insertAdjacentHTML') && !uiSlice.includes('dangerouslySetInnerHTML'))
  check('提取段同样无任何 DOM 写入手法',
    !/innerHTML|outerHTML|insertAdjacentHTML|document\./.test(extracted))
}

console.log('\n[J] 接收方集成约束（防双滚动 / 默认折叠 / 复用既有链路 / 同一批监听）')
{
  check('新区不自带滚动容器（无 maxHeight / overflow / max-height 字样 ⇒ 嵌外层滚动防双滚）',
    !uiSlice.includes('maxHeight') && !uiSlice.includes('max-height') && !uiSlice.includes('overflow'),
    (uiSlice.match(/maxHeight|max-height|overflow/g) || []).join(','))
  check('默认折叠（open 初始 false）',
    uiSlice.includes("const [open, setOpen] = React.useState(false)"))
  check('sessionId 复用 muv-table 既有链路 currentSessionId()（面板里同一取值点）',
    src.includes('sessionId: currentSessionId()'))
  check('initvarData 复用面板 state（不二次请求 tavern-card）',
    src.includes('initvarData: state.initvarData') && !uiSlice.includes('/api/muv-table/tavern-card'))
  check('会话/预设切换挂同一批监听（varTick 在 check() 消费 forceReload 处 bump，新区不另挂监听）',
    src.includes('setVarTick(t => t + 1)') && uiSlice.includes('reloadToken') &&
    !uiSlice.includes("addEventListener('tavern-preset-changed'") &&
    !uiSlice.includes("addEventListener('tavern-session-changed'"))
  check('保存按钮走纯函数（请求体形状由 varSectionSave 保证）',
    uiSlice.includes('varSectionSave({ sessionId, edits'))
  check('功能标记齐全（search/refresh/save/export/snap-row/snap-select/back-latest/status/tree）',
    ['data-dsh-muv-var-search', 'data-dsh-muv-var-refresh', 'data-dsh-muv-var-save',
     'data-dsh-muv-var-export', 'data-dsh-muv-var-snap-row', 'data-dsh-muv-var-snap-select',
     'data-dsh-muv-var-back-latest', 'data-dsh-muv-var-status', 'data-dsh-muv-var-tree']
      .every(k => uiSlice.includes("'" + k + "'")))
  check('新区嵌在 MUV 既有滚动容器里（Content 容器把 RuntimeVarsSection 与变量树放进同一层）',
    src.includes("jsx.jsx(RuntimeVarsSection, {"))
  check('配色走面板既有 CSS 变量（C token / var(--dsw-alias-*)），无硬编码色值',
    !/#c5a065|rgba\(39,174,96|#e74c3c'|#3498db'/.test(uiSlice.replace(/var\(--dsw-alias-[a-z-]+,#?[0-9a-fA-F)]*\)/g, '')))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
