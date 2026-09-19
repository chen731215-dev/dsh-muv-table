// Repro helper (keep): dump every world-book entry whose comment starts with a
// `[...]` marker, so the `[initvar]` vs `[mvu_update]` distinction can be checked
// against real cards instead of guessing.
//
// Run: node repro-wb-initvar-scan.mjs
import { readPngCard } from './lib/png-card.js'
import { findCard } from './test-cards.mjs'

const CARDS = ['异世界农场', '苍玄界', '_足控天堂2', '食人世界', '涩涩提瓦特']

for (const nm of CARDS) {
  const file = findCard(nm)
  if (!file) { console.log(`SKIP ${nm}（找不到卡）`); continue }
  let card
  try { card = readPngCard(file) } catch (e) { console.log(`SKIP ${nm}（读取失败: ${e.message}）`); continue }
  const data = card.data && typeof card.data === 'object' ? card.data : card
  const entries = Array.isArray(data.character_book?.entries) ? data.character_book.entries : []
  const marked = entries.filter(e => /^\s*\[/.test(String(e?.comment || '')))
  console.log(`\n=== ${nm}（世界书 ${entries.length} 条，带 [标记] 的 ${marked.length} 条）===`)
  for (const e of marked) {
    const content = String(e?.content || '')
    console.log(`  comment=${JSON.stringify(e.comment)} enabled=${e.enabled}`)
    console.log(`    有<initvar>标签=${/<initvar>/i.test(content)} 长度=${content.length} 前80字=${JSON.stringify(content.slice(0, 80))}`)
  }
}
