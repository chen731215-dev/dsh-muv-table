// Regression: preset resolution in `/api/muv-table/tavern-card`.
//
// Run: node test-preset-resolve.mjs
//
// ② 的实测症状：`?presetId=does-not-exist` 会静默返回 tavern-lite 的「川上富江」
//    （HTTP 200 / found:true / cardName=川上富江），用户以为在看自己的卡。
//    预设改名或重名（历史上「深渊区」→「精简酒馆」）同样中招。
//
// 这个用例**不碰用户真实环境**：先把 DSH_HOME 指到一个临时目录，造出假预设，
// 再动态 import 插件（模块级 PRESETS_ROOT 是 import 时确定的），然后走真实路由。
// 因此它的结果在任何机器上一致，而不是「本机恰好有哪张卡」。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

console.log('=== 预设定位回归（临时 DSH_HOME，不碰真实环境）===\n')

// ── 临时环境 ──────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-muv-preset-'))
const presets = path.join(tmp, '.agent-presets')
const cardsDir = path.join(tmp, 'cards')
fs.mkdirSync(presets, { recursive: true })
fs.mkdirSync(cardsDir, { recursive: true })

const PERSONA_YML = [
  'name: "@deepseek-ai/dsh-persona"',
  'text: |-',
  '  角色名：测试预设',
  '  # 没有 <initvar>，变量树从 characters.json 取',
  '',
].join('\n')

/** A preset directory with one card in tavern's own store. */
function writePreset(id, cardName, desc) {
  const dir = path.join(presets, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent.cordis.yml'), PERSONA_YML, 'utf8')
  fs.writeFileSync(path.join(dir, 'characters.json'), JSON.stringify([
    { name: cardName, desc, first: '', enabled: true },
  ]), 'utf8')
}

const LIST_DESC = [
  '开场。',
  '<initvar>',
  '主角状态:',
  '  名字: 测试',
  '人际交往:',
  '  最近互动记录: ',
  '    - 第一条互动',
  '    - 第二条互动',
  '</initvar>',
].join('\n')

writePreset('tavern-lite', 'ZZ-MUV-DEFAULT-CARD', '<initvar>\n默认卡: 1\n</initvar>')
writePreset('real-preset', 'ZZ-MUV-REAL-CARD', LIST_DESC)
writePreset('malformed-preset', 'ZZ-MUV-MALFORMED-CARD', '没有变量')

// A library card whose `alternate_greetings` is an object instead of a list — the
// shape that used to make parseMuvCard throw and the endpoint answer 500.
fs.writeFileSync(path.join(cardsDir, 'ZZ-MUV-MALFORMED-CARD.json'), JSON.stringify({
  data: { name: 'ZZ-MUV-MALFORMED-CARD', first_mes: 'hi', alternate_greetings: { a: 'x' } },
}), 'utf8')

// The same trick with a card that is fine, to prove the library lookup still works.
fs.writeFileSync(path.join(cardsDir, 'ZZ-MUV-LIB-CARD.json'), JSON.stringify({
  data: { name: 'ZZ-MUV-LIB-CARD', first_mes: '<initvar>\n库卡: 1\n</initvar>' },
}), 'utf8')
writePreset('lib-preset', 'ZZ-MUV-LIB-CARD', '没有变量')

fs.writeFileSync(path.join(presets, 'session-bindings.json'), JSON.stringify({
  'session-bound-real': 'real-preset',
  'session-bound-gone': 'renamed-away',   // 预设改过名 → 绑定悬空
  'session-bound-default': 'default',     // 酒馆语义：default ⇒ tavern-lite
}), 'utf8')

process.env.DSH_HOME = tmp
process.env.DSH_MUV_CARD_DIRS = cardsDir

const { apply } = await import('./lib/index.js')

const routes = []
apply({ get: () => undefined, webServer: { register: (r) => routes.push(r) } })
const route = routes.find(r => r.path === '/api/muv-table/tavern-card')
check('路由已注册', !!route, routes.map(r => r.path).join(' '))

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

function show(label, r) {
  console.log('  ' + label + ' -> HTTP ' + r.status + ' ' + JSON.stringify({
    ok: r.body?.ok, found: r.body?.found, cardName: r.body?.cardName,
    presetDir: r.body?.presetDir, presetSource: r.body?.presetSource, error: r.body?.error,
  }))
}

// ── 1) 显式 presetId 不存在：必须明说，不许换卡 ─────────────
console.log('\n[1] ?presetId=does-not-exist')
const r1 = await call('?presetId=does-not-exist')
show('返回', r1)
check('HTTP 200（不是 500）', r1.status === 200, 'status=' + r1.status)
check('found:false', r1.body?.found === false, 'found=' + r1.body?.found)
check('错误里点名了那个 id',
  typeof r1.body?.error === 'string' && r1.body.error.includes('does-not-exist'),
  JSON.stringify(r1.body?.error))
check('reason=preset-not-found', r1.body?.reason === 'preset-not-found', r1.body?.reason)
check('★没有偷偷换成默认预设的卡',
  r1.body?.cardName !== 'ZZ-MUV-DEFAULT-CARD' && r1.body?.presetDir === undefined,
  'cardName=' + r1.body?.cardName + ' presetDir=' + r1.body?.presetDir)
check('顺便给出真实存在的预设清单',
  Array.isArray(r1.body?.availablePresets) && r1.body.availablePresets.includes('real-preset'),
  JSON.stringify(r1.body?.availablePresets))

// ── 2) 合法 preset：数据必须完整到手（① 也一起走通） ────────
console.log('\n[2] ?presetId=real-preset（合法）')
const r2 = await call('?presetId=real-preset')
show('返回', r2)
check('found:true', r2.body?.found === true, 'found=' + r2.body?.found)
check('cardName 正确', r2.body?.cardName === 'ZZ-MUV-REAL-CARD', r2.body?.cardName)
check('presetDir 正确', r2.body?.presetDir === 'real-preset', r2.body?.presetDir)
check('presetSource=explicit', r2.body?.presetSource === 'explicit', r2.body?.presetSource)
const listVal = r2.body?.initvarData?.人际交往?.最近互动记录
check('★列表内容端到端到手（①）', Array.isArray(listVal) && listVal.length === 2,
  JSON.stringify(listVal))
const listField = (r2.body?.schemas || []).find(s => s.name === '人际交往')
  ?.children?.find(c => c.name === '最近互动记录')
check('列表进了 schema', !!listField && listField.isList === true,
  JSON.stringify(listField))

// ── 3) 路径穿越 ───────────────────────────────────────────
console.log('\n[3] ?presetId=../tavern-lite（越界）')
const r3 = await call('?presetId=' + encodeURIComponent('../tavern-lite'))
show('返回', r3)
check('found:false（不解析带分隔符的 id）', r3.body?.found === false, 'found=' + r3.body?.found)

// ── 4) 会话绑定 ──────────────────────────────────────────
console.log('\n[4] ?sessionId=session-bound-real')
const r4 = await call('?sessionId=session-bound-real')
show('返回', r4)
check('found:true', r4.body?.found === true, 'found=' + r4.body?.found)
check('按绑定取到 real-preset', r4.body?.presetDir === 'real-preset', r4.body?.presetDir)
check('presetSource=session', r4.body?.presetSource === 'session', r4.body?.presetSource)

console.log('\n[5] ?sessionId=session-bound-gone（绑定指向一个已改名的预设）')
const r5 = await call('?sessionId=session-bound-gone')
show('返回', r5)
check('found:false（悬空绑定不再静默换卡）', r5.body?.found === false, 'found=' + r5.body?.found)
check('错误里点名了那个已消失的预设',
  typeof r5.body?.error === 'string' && r5.body.error.includes('renamed-away'),
  JSON.stringify(r5.body?.error))
check('★没有偷偷换成默认预设的卡', r5.body?.cardName !== 'ZZ-MUV-DEFAULT-CARD', 'cardName=' + r5.body?.cardName)

console.log('\n[6] ?sessionId=session-bound-default（绑定是 default）')
const r6 = await call('?sessionId=session-bound-default')
show('返回', r6)
check('found:true（酒馆自己把 default 当 tavern-lite）', r6.body?.found === true, 'found=' + r6.body?.found)
check('落在 tavern-lite', r6.body?.presetDir === 'tavern-lite', r6.body?.presetDir)
check('★来源标明 session-default（不是谎称显式指定）',
  r6.body?.presetSource === 'session-default', r6.body?.presetSource)

console.log('\n[7] ?sessionId=session-unbound（完全没有绑定记录）')
const r7 = await call('?sessionId=session-unbound')
show('返回', r7)
check('结果可解释：要么 found:false，要么标成 session-default',
  r7.body?.found === false || r7.body?.presetSource === 'session-default',
  'found=' + r7.body?.found + ' source=' + r7.body?.presetSource)
check('绝不谎称 explicit', r7.body?.presetSource !== 'explicit', r7.body?.presetSource)

// ── 8) ★ 串台钉子：会话绑定优先于显式 presetId ───────────────
//
// 实测事故：客户端两个 id 都送、且 presetId 排在前面，而 presetId 来自酒馆面板的
// `dataset.presetId` / localStorage —— **切换会话后它可能仍是上一个会话的预设**。
// 于是用户切到「瑟瑟提瓦特」后，服务端还按「足控天堂」的 presetId 出卡，**串台**。
//
// 会话 id 是唯一随会话切换必然变化的依据（服务端按 session-bindings.json 查），必须优先。
console.log('\n[8] ?sessionId=session-bound-real&presetId=tavern-lite（会话绑定 A + 过期的 presetId B）')
const r8 = await call('?sessionId=session-bound-real&presetId=tavern-lite')
show('返回', r8)
check('★ 解析出会话绑定的那个（real-preset），不是过期的 presetId',
  r8.body?.presetDir === 'real-preset', r8.body?.presetDir)
check('★ presetSource=session（一眼能看出这个结果是按会话来的）',
  r8.body?.presetSource === 'session', r8.body?.presetSource)
check('★ 绝不能是 explicit（那就说明 presetId 又盖掉了会话）',
  r8.body?.presetSource !== 'explicit', r8.body?.presetSource)

console.log('\n[8b] ?presetId=tavern-lite（没有 sessionId：原语义必须保持）')
const r8b = await call('?presetId=tavern-lite')
show('返回', r8b)
check('found:true', r8b.body?.found === true, 'found=' + r8b.body?.found)
check('按 presetId 取到 tavern-lite', r8b.body?.presetDir === 'tavern-lite', r8b.body?.presetDir)
check('presetSource=explicit（没有会话时它就是显式指定）',
  r8b.body?.presetSource === 'explicit', r8b.body?.presetSource)

console.log('\n[8c] ?sessionId=session-bound-real&presetId=tavern-lite&preferPreset=1（显式开关）')
const r8c = await call('?sessionId=session-bound-real&presetId=tavern-lite&preferPreset=1')
show('返回', r8c)
check('★ preferPreset=1 时按 presetId 走（不把需要它的调用方语义悄悄改掉）',
  r8c.body?.presetDir === 'tavern-lite' && r8c.body?.presetSource === 'explicit',
  r8c.body?.presetDir + '/' + r8c.body?.presetSource)

console.log('\n[8d] ?sessionId=session-bound-gone&presetId=tavern-lite（会话绑定悬空 + 有 presetId）')
const r8d = await call('?sessionId=session-bound-gone&presetId=tavern-lite')
show('返回', r8d)
check('★ 仍报 found:false：会话绑定的预设不存在时，不许退回用 presetId 静默换一张卡',
  r8d.body?.found === false, 'found=' + r8d.body?.found + ' dir=' + r8d.body?.presetDir)
check('错误里点名的是会话绑定的那个已消失预设',
  typeof r8d.body?.error === 'string' && r8d.body.error.includes('renamed-away'),
  JSON.stringify(r8d.body?.error))

// ── 9) 畸形卡不再 500（④ 的端点面） ────────────────────────
console.log('\n[9] 畸形卡（alternate_greetings 是对象）走端点')
const r9 = await call('?presetId=malformed-preset')
show('返回', r9)
check('HTTP 200（不是 500）', r9.status === 200, 'status=' + r9.status + ' err=' + r9.body?.error)
check('仍返回同一张卡、只是变量表为空',
  r9.body?.found === true && r9.body?.cardName === 'ZZ-MUV-MALFORMED-CARD' && (r9.body?.schemas || []).length === 0,
  JSON.stringify({ found: r9.body?.found, name: r9.body?.cardName, schemas: r9.body?.schemas?.length }))

console.log('\n[10] 同一张卡库查找仍然正常（别把库路径改坏）')
const r10 = await call('?presetId=lib-preset')
show('返回', r10)
check('从卡库按名找到', r10.body?.cardSource === 'library', r10.body?.cardSource)
check('变量读得到', Object.keys(r10.body?.initvarData || {}).join(',') === '库卡',
  Object.keys(r10.body?.initvarData || {}).join(','))

// 清理
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_) {}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
