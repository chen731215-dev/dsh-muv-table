// 复现①：initvar 里的列表值被吞成空对象，内容静默消失且不进 schema。
//
// Run: node repro-initvar-list.mjs
// 退出码 0 = 已修好，1 = 仍然是坏的。改代码前后各跑一次。
//
// 实测卡：苍玄界（`E:/BaiduNetdiskDownload/EdgeDownload/苍玄界.png`）。它的
// <initvar> 里有两条这种写法：
//
//     最近互动记录: 
//        - 因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。
//
// 键后面是空的，内容全在下一行的 `- ` 里 —— 而解析器把「空值」当成嵌套对象
// 的开始，又把「没有冒号的行」整行丢掉，于是 `最近互动记录` 变成一个空对象 `{}`。
// 卡里有 65 个叶子行，两个 `最近互动记录` 都不在 schema 里。

import { readPngCard } from './lib/png-card.js'
import { parseInitvar, serializeInitvar } from './lib/initvar-parser.js'
import { parseMuvCard } from './lib/muv-parser.js'
import { findCard } from './test-cards.mjs'

const CARD = process.env.MUV_TEST_CARD || findCard('苍玄界')

let bad = 0
function line(label, ok, detail) {
  console.log((ok ? '  OK   ' : '  FAIL ') + label + (detail ? '  -> ' + detail : ''))
  if (!ok) bad++
}

console.log('=== 复现①: initvar 列表值被吞成空对象 ===\n')

if (!CARD) {
  console.log('  SKIP 找不到 苍玄界 卡（可用 MUV_TEST_CARD 指定路径）')
  process.exit(0)
}
console.log('card: ' + CARD + '\n')

const card = readPngCard(CARD)
const greetings = card?.data?.alternate_greetings
const block = (Array.isArray(greetings) ? greetings : [])
  .map(g => String(g).match(/<initvar>([\s\S]*?)<\/initvar>/i))
  .find(Boolean)
if (!block) {
  console.log('  SKIP 这张卡没有 <initvar>')
  process.exit(0)
}
const raw = block[1]

// ── 1) 解析层：列表必须活着 ───────────────────────────────
console.log('[1] parseInitvar —— `空值 + 下一行 - ` 应成为数组')
const parsed = parseInitvar(raw)
const a = parsed?.人际交往?.结识道友录?.沈慕微?.最近互动记录
const b = parsed?.人际交往?.结识道友录?.江念?.最近互动记录
line('沈慕微.最近互动记录 是数组', Array.isArray(a), describe(a))
line('数组里有那句互动', Array.isArray(a) && a.some(s => String(s).includes('因为想吃灵鹤')),
  describe(a))
line('江念.最近互动记录 是数组', Array.isArray(b), describe(b))
line('数组里有那句互动', Array.isArray(b) && b.some(s => String(s).includes('呼呼大睡')),
  describe(b))
line('不是空对象（旧症状）', !(a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length === 0),
  describe(a))

function describe(v) {
  if (Array.isArray(v)) return 'array(' + v.length + ')=' + JSON.stringify(v[0] || '')
  if (v && typeof v === 'object') return 'object keys=[' + Object.keys(v).join(',') + ']'
  return typeof v + ' ' + JSON.stringify(v)
}

// ── 2) schema 层：内容必须进表 ────────────────────────────
console.log('\n[2] parseMuvCard —— 两个路径都要出现在 schema 里')
const muv = parseMuvCard(card)
const WANTED = [
  '人际交往.结识道友录.沈慕微.最近互动记录',
  '人际交往.结识道友录.江念.最近互动记录',
]
const leaves = schemaPaths(muv.schemas)
const missing = WANTED.filter(p => !leaves.includes(p))
line('两条路径都在 schema 里', missing.length === 0,
  missing.length ? '缺: ' + missing.join(' | ') + '（共 ' + leaves.length + ' 个叶子）' : '')
line('叶子行数 >= 65', leaves.length >= 65, 'leaves=' + leaves.length)

function schemaPaths(schemas, prefix = '') {
  const out = []
  for (const f of schemas || []) {
    const p = prefix ? prefix + '.' + f.name : f.name
    if (f.type === 'object' && (f.children || []).length > 0) out.push(...schemaPaths(f.children, p))
    else out.push(p)
  }
  return out
}

// ── 3) 往返：改了值以后生成的块不能又把列表写没了 ─────────
console.log('\n[3] serializeInitvar —— 列表写回去还得是列表')
const round = serializeInitvar(parsed)
const reparsed = parseInitvar(round)
const a2 = reparsed?.人际交往?.结识道友录?.沈慕微?.最近互动记录
line('序列化后再解析仍是数组', Array.isArray(a2), describe(a2))
line('内容没变', JSON.stringify(a2) === JSON.stringify(a), JSON.stringify(a2))

console.log('\n=== ' + (bad ? bad + ' 项不通过 —— bug 仍在' : '全部通过 —— 已修复') + ' ===')
process.exit(bad ? 1 : 0)
