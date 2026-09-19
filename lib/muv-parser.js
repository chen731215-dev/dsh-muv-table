// MUV Schema Parser: extracts variable structure from character card JSON.
// Uses initvar data to infer the schema tree (more reliable than regex-parsing Zod).

import { parseInitvar } from './initvar-parser.js'

// Where a card keeps its variable block.
//
// Two shapes are in the wild:
//
//   1) `<initvar>…</initvar>` — MUV-native, YAML-ish, handled by initvar-parser.
//   2) `<VariableInsert>{ …plain JSON… }</VariableInsert>` — the community
//      form. These cards carry *no* `<initvar>` anywhere, so a parser that only
//      looked for shape 1 returned `schemas: 0` and the variable panel came up
//      empty even though the whole tree was sitting in the opening greeting.
//
// Shape 2 is normally in the greeting that opens the chat, but a card may just
// as well park it in description/scenario, so all three are scanned.
const VARIABLE_TEXT_FIELDS = ['first_mes', 'description', 'scenario']

/** Arrays only — a malformed card may carry an object where a list belongs. */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Every text blob of a card that might hold `<initvar>` / `<VariableInsert>`.
 *
 * Besides the obvious greeting fields, two more sources carry these blocks in
 * the field and used to be skipped entirely:
 *
 *  - world book entries (`character_book.entries[].content`) — `[initvar]变量初始化勿开`
 *    is a world-book entry, not a greeting, in the cards that use this shape;
 *  - `tavern_helper` scripts, whose source often contains the same block.
 *
 * The list is ordered by preference and grouped, so a caller can ask for "the
 * greeting-level sources first" without hardcoding field names again.
 * @param {object} data - the card's `data` object
 * @returns {Array<{group: string, where: string, text: string}>}
 */
function variableTextCandidates(data) {
  const out = []
  if (!data || typeof data !== 'object') return out

  const push = (group, where, text) => {
    if (typeof text === 'string') out.push({ group, where, text })
  }

  for (const field of VARIABLE_TEXT_FIELDS) push('field', field, data[field])
  for (const greeting of asArray(data.alternate_greetings)) {
    push('greeting', 'alternate_greetings', greeting)
  }
  for (const entry of asArray(data.character_book?.entries)) {
    push('worldbook', 'character_book:' + String(entry?.comment || ''), entry?.content)
  }
  for (const script of asArray(data.extensions?.tavern_helper?.scripts)) {
    push('script', 'tavern_helper:' + String(script?.name || ''), script?.content)
  }
  return out
}

/** All texts belonging to the given candidate groups, in candidate order. */
function textsInGroups(candidates, ...groups) {
  return candidates.filter(c => groups.includes(c.group)).map(c => c.text)
}

/** The first `<initvar>` block in a list of texts, or null. */
function firstInitvarBlock(texts) {
  for (const text of texts) {
    const match = text.match(/<initvar>([\s\S]*?)<\/initvar>/i)
    if (match) return { raw: match[1].trim(), parsed: parseInitvar(match[1]) }
  }
  return null
}

/**
 * A card's variable data, whichever spec shape it uses.
 *
 * Spec-v2 cards wrap every field in `data`; spec-v1 (flat) cards put the same
 * fields at the top level. Reading only `data` made a flat card — one
 * `findJsonMatch` happily found by name — parse as `{name:'Unnamed'}` with 0
 * fields, i.e. the library file was located and then thrown away.
 * @param {object} cardJson
 * @returns {object}
 */
function cardData(cardJson) {
  if (!cardJson || typeof cardJson !== 'object') return {}
  const inner = cardJson.data
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
  return cardJson
}

/**
 * Drop a collection's `$template` placeholder.
 *
 * `主播档案.$template` is the card's own sketch of "what an主播 looks like" —
 * not an actual character. Rendering it put a bogus 主播 row in the panel.
 * @param {object} data
 * @returns {object} a shallow copy with `$template` removed from 主播档案
 */
export function stripPlaceholderEntries(data) {
  if (!data || typeof data !== 'object') return data
  const clean = { ...data }
  const anchors = clean['主播档案']
  if (anchors && typeof anchors === 'object' && !Array.isArray(anchors) && '$template' in anchors) {
    const inner = { ...anchors }
    delete inner.$template
    clean['主播档案'] = inner
  }
  return clean
}

/**
 * Find a `<VariableInsert>{…JSON…}</VariableInsert>` block in a card and return
 * it as usable variable data.
 * @param {object} data - the card's `data` object
 * @returns {{ data: object, raw: string }|null}
 */
export function extractVariableInsert(data) {
  if (!data || typeof data !== 'object') return null

  for (const { text } of variableTextCandidates(data)) {
    const match = text.match(/<VariableInsert>([\s\S]*?)<\/VariableInsert>/i)
    if (!match) continue
    const raw = match[1].trim()
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { data: stripPlaceholderEntries(parsed), raw }
      }
    } catch (_) {
      // Not JSON — keep looking; another block might be the real one.
      // World-book entries and helper scripts routinely *quote* the tags in
      // prose (「必须使用 `<VariableInsert>`」) or inside a fenced code block, and
      // those examples are never valid JSON, so this is the common case there.
    }
  }
  return null
}

/**
 * Parse a MUV character card JSON and extract schema + variable data.
 * @param {object} cardJson - The full character card JSON
 * @returns {{ name: string, schemas: object[], initvarData: object, zodSource: string }}
 */
export function parseMuvCard(cardJson) {
  const data = cardData(cardJson)
  const name = data.name || cardJson?.data?.name || cardJson?.name || 'Unnamed'
  const candidates = variableTextCandidates(data)
  const tavernHelper = data.extensions?.tavern_helper

  // Extract Zod schema source (for reference)
  //
  // 原先这里是 `s.name === 'zod'` 的精确等值匹配，而真机上的卡几乎不这么命名：
  // 「变量结构」「星辉zod」…… 一个都对不上，于是 zodSource 恒为空。而 Zod
  // （`z.object({...})` / `registerMvuSchema`）其实是 MUV 最主流的 schema 载体，
  // 读不到就等于整张卡的变量表建不出来。
  // 现在按「名字含 zod」或「内容像 Zod schema」两条线索找，兼容各种命名。
  // `scripts` 不一定是数组（畸形卡），先归一化再找，否则这里会先抛 TypeError。
  const scripts = asArray(tavernHelper?.scripts)
  const zodScript = scripts.find(s => /zod/i.test(String(s?.name || '')))
    || scripts.find(s => /z\.object\s*\(|registerMvuSchema|Mvu\.|z\.string\s*\(|prefault\s*\(/.test(String(s?.content || '')))
  const zodSource = zodScript?.content || ''

  // Extract initvar blocks from alternate_greetings
  const initvarBlocks = []

  for (const text of textsInGroups(candidates, 'greeting')) {
    const match = text.match(/<initvar>([\s\S]*?)<\/initvar>/i)
    if (match) {
      initvarBlocks.push({
        raw: match[1].trim(),
        parsed: parseInitvar(match[1])
      })
    }
  }

  // An <initvar> may live in the opening greeting instead. Only consulted when
  // alternate_greetings had none, so a card that already worked keeps reading
  // from exactly the same place it used to. (`scenario` is included here for the
  // same reason `<VariableInsert>` already scans it — the two paths were
  // asymmetric.)
  if (initvarBlocks.length === 0) {
    const hit = firstInitvarBlock(textsInGroups(candidates, 'field'))
    if (hit) initvarBlocks.push(hit)
  }

  // Use the first initvar block as default data
  let initvarData = initvarBlocks.length > 0 ? initvarBlocks[0].parsed : {}
  let initvarRaw = initvarBlocks.map(b => b.raw)

  // No <initvar> anywhere → fall back to the community <VariableInsert> shape.
  if (initvarRaw.length === 0) {
    const inserted = extractVariableInsert(data)
    if (inserted) {
      initvarData = inserted.data
      initvarRaw = [inserted.raw]
    }
  }

  // Still nothing → the block may only exist in the world book or in a
  // tavern_helper script. This is deliberately the last resort, after
  // <VariableInsert>: those two sources are full of *quoted examples* of the
  // syntax, and an example is far more likely to be a bare `<initvar>` skeleton
  // (which parses into junk but never throws) than a usable JSON tree.
  if (initvarRaw.length === 0) {
    const hit = firstInitvarBlock(textsInGroups(candidates, 'worldbook', 'script'))
    if (hit) {
      initvarData = hit.parsed
      initvarRaw = [hit.raw]
    }
  }

  // Infer schema from initvar data
  const schemas = inferSchemaFromData(initvarData)

  return {
    name,
    schemas,
    initvarData,
    initvarBlocks: initvarRaw,
    zodSource
  }
}

/**
 * Infer a schema tree from a nested data object.
 * @param {object} data
 * @param {string} [name='']
 * @returns {object[]}
 */
function inferSchemaFromData(data, name = '') {
  if (!data || typeof data !== 'object') return []

  const fields = []
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Nested object
      const children = inferSchemaFromData(value, key)
      if (children.length > 0) {
        fields.push({
          name: key,
          type: 'object',
          defaultValue: '{}',
          description: '',
          children
        })
      }
    } else if (typeof value === 'number') {
      fields.push({
        name: key,
        type: 'number',
        defaultValue: String(value),
        description: '',
        children: []
      })
    } else if (Array.isArray(value)) {
      // A `- item` list. The panel edits one row per field, so the items are
      // joined with newlines for display; `initvarData` keeps the real array and
      // serializeInitvar writes it back as `- item` lines. Without this branch a
      // list fell into the `String(value)` case and showed up as "a,b".
      fields.push({
        name: key,
        type: 'string',
        defaultValue: value.map(v => (v === null || v === undefined) ? '' : String(v)).join('\n'),
        description: '',
        children: [],
        isList: true
      })
    } else {
      fields.push({
        name: key,
        type: 'string',
        defaultValue: String(value ?? ''),
        description: '',
        children: []
      })
    }
  }
  return fields
}

/**
 * Walk the schema tree and extract values from data into flattened rows.
 * @param {object[]} schemas
 * @param {object} data
 * @param {string} [prefix='']
 * @returns {object[]}
 */
export function flattenSchemaData(schemas, data, prefix = '') {
  const rows = []
  for (const field of schemas) {
    const path = prefix ? `${prefix}.${field.name}` : field.name
    const value = data?.[field.name]

    if (field.type === 'object' && field.children && field.children.length > 0) {
      rows.push({ path, key: field.name, type: 'object', value: '(object)', isContainer: true, depth: prefix.split('.').filter(Boolean).length })
      rows.push(...flattenSchemaData(field.children, value || {}, path))
    } else {
      rows.push({
        path,
        key: field.name,
        type: field.type,
        value: value ?? field.defaultValue ?? '',
        isContainer: false,
        depth: prefix.split('.').filter(Boolean).length
      })
    }
  }
  return rows
}