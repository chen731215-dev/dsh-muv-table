// dsh-muv-table server half: provides API endpoints for parsing MUV cards,
// extracting Zod schemas, and generating <UpdateVariable> blocks.

import { parseMuvCard } from './muv-parser.js'
import { generateMuvBlock, applyEditsAndGenerate } from './block-generator.js'
import { parseInitvar } from './initvar-parser.js'
import { readPngCard } from './png-card.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let PANEL_HTML = ''
try { PANEL_HTML = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8') } catch (_) {}

// ── DSH home 解析 ─────────────────────────────────────────
// 与 @deepseek-ai/dsh-home-paths 的 resolveDshHome() 一致：
// 优先级 = 显式配置 → $DSH_HOME（非空）→ ~/.dsh。
// 用户预设目录 = <dshHome>/.agent-presets（酒馆插件也用同一份）。
// 写死 ~/.dsh 会让 DSH_HOME 指向非默认位置的部署读不到预设。
function expandHomePrefix(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}
function resolveDshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim().length > 0) return path.resolve(expandHomePrefix(env.trim()))
  return path.join(os.homedir(), '.dsh')
}

// apply() 时按 DSH 实际 home 重新绑定
let DSH_HOME = resolveDshHome()
let PRESETS_ROOT = path.join(DSH_HOME, '.agent-presets')
let TAVERN_PRESET_DIR = path.join(PRESETS_ROOT, 'tavern-lite')
let SESSION_BINDINGS_FILE = path.join(PRESETS_ROOT, 'session-bindings.json')

/**
 * 绑定路径到 DSH 实际 home：优先用 DSH 的 dshHomePath 服务，拿不到再自行解析。
 * @param {object} ctx - cordis 上下文
 */
function bindDshPaths(ctx) {
  let home = ''
  try {
    const fn = ctx && typeof ctx.get === 'function' ? ctx.get('dshHomePath') : undefined
    if (typeof fn === 'function') home = String(fn() || '')
  } catch {}
  if (!home) home = resolveDshHome()
  DSH_HOME = home
  PRESETS_ROOT = path.join(home, '.agent-presets')
  TAVERN_PRESET_DIR = path.join(PRESETS_ROOT, 'tavern-lite')
  SESSION_BINDINGS_FILE = path.join(PRESETS_ROOT, 'session-bindings.json')
}

// External character-card library searched when a preset has no managed copy.
// Historically this was a single hardcoded download folder, which silently
// limited every lookup to whatever happened to sit there. Keep that folder
// first (existing installs rely on it), then widen to the other places cards
// actually get downloaded to, and allow an explicit override.
//
// The SillyTavern folders matter because that is where a user's *original* PNG
// cards live. DSH's own `characters.json` keeps only `{name, desc, first}`, so
// for a card dragged into SillyTavern the original file is the only place its
// regex scripts, world book and helper scripts still exist.
function sillyTavernCharacterDirs() {
  const roots = []
  const explicit = process.env.DSH_SILLYTAVERN_DIR
  if (explicit) roots.push(explicit)
  // Common install locations; each may hold data/<user>/characters.
  roots.push('C:/MySpecialFolder/SillyTavern')
  roots.push(path.join(os.homedir(), 'SillyTavern'))
  roots.push(path.join(os.homedir(), 'Documents', 'SillyTavern'))

  const out = []
  for (const root of roots) {
    try {
      const dataDir = path.join(root, 'data')
      if (!fs.existsSync(dataDir)) continue
      for (const user of fs.readdirSync(dataDir)) {
        const chars = path.join(dataDir, user, 'characters')
        if (fs.existsSync(chars)) out.push(chars)
      }
    } catch (_) {}
  }
  return out
}

const MUV_CARD_DIRS = [
  'E:/BaiduNetdiskDownload/EdgeDownload',
  ...(process.env.DSH_MUV_CARD_DIRS || '').split(path.delimiter).map(s => s.trim()).filter(Boolean),
  ...sillyTavernCharacterDirs(),
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Desktop')
].filter((dir, i, all) => all.indexOf(dir) === i)

/** Read a YAML/yml file with encoding detection (GBK → UTF-8 fallback). */
function readYmlSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath)
    const utf8 = raw.toString('utf8')
    // If text looks garbled (multiple high bytes in a row), try GBK
    if (/[\x80-\xFF]{3,}/.test(utf8)) {
      try { return new TextDecoder('gbk').decode(raw) } catch (_) {}
    }
    return utf8
  } catch (_) { return '' }
}

/**
 * Extract the character card name from an agent.cordis.yml persona text.
 * Looks for 角色名/name markers or the persona's own title.
 */
function extractCardNameFromYml(yml) {
  if (!yml) return ''
  // 1) Find the persona body. Tavern writes `prefix: |-`; other generators use
  //    `text:`. Matching only `text:` made everything below scan raw YAML,
  //    where the first non-comment line is the persona *service* name.
  const textMatch = yml.match(/(?:prefix|text):\s*\|-?\s*\n([\s\S]*?)(?=\n\s*[-a-zA-Z@_]+:|\n\s*$)/)
  const body = textMatch ? textMatch[1] : ''
  // 2) 角色名：xxx pattern (used by tavern cards)
  const personaMatch = body.match(/角色名[：:]\s*([^\s#\n]+)/)
  if (personaMatch) return personaMatch[1].trim()
  // 3) Card title: the first meaningful line of the persona body only — never
  //    fall back to the raw YAML, whose lines are configuration keys.
  const firstLine = body.split(/\r?\n/).map(l => l.trim())
    .find(l => l && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('[') && !/^[a-zA-Z@_][\w@./-]*:/.test(l))
  if (firstLine) {
    const cleaned = firstLine.replace(/[#*_【】「」]/g, '').replace(/[🔒🔓]\s*/g, '').trim()
    if (cleaned) return cleaned
  }
  // 4) Upstream structured name: — but skip service names like '@deepseek-ai/dsh-persona'
  const nameMatch = yml.match(/^\s*name:\s*(.+)$/m)
  if (nameMatch) {
    const n = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
    if (n && !n.startsWith('@') && !n.includes('/')) return n
  }
  return ''
}

/**
 * Scan all agent presets for card names.
 * @returns {Array<{presetDir, cardName, yml, mtime}>}
 */
function scanAllPresetCards() {
  const results = []
  try {
    const dirs = fs.readdirSync(PRESETS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(PRESETS_ROOT, d.name))
    // Also scan the DSH root (presets like anchored-standard live there too)
    for (const dir of [...dirs, DSH_HOME]) {
      const ymlPath = path.join(dir, 'agent.cordis.yml')
      if (!fs.existsSync(ymlPath)) continue
      try {
        const yml = readYmlSafe(ymlPath)
        const cardName = extractCardNameFromYml(yml)
        const stat = fs.statSync(ymlPath)
        results.push({ presetDir: path.basename(dir), cardName, yml, mtime: stat.mtimeMs })
      } catch (_) {}
    }
  } catch (_) {}
  return results
}

/** Resolve preset dir for a session id via session-bindings.json */
function presetDirForSession(sessionId) {
  try {
    const bindPath = SESSION_BINDINGS_FILE
    if (sessionId && fs.existsSync(bindPath)) {
      const bind = JSON.parse(fs.readFileSync(bindPath, 'utf8'))
      const preset = bind[sessionId]
      if (preset && preset !== 'default') return path.join(PRESETS_ROOT, preset)
    }
  } catch (_) {}
  return TAVERN_PRESET_DIR
}

/**
 * Which preset is the user actually in?
 *
 * The panel opens without knowing the session, and `tavern-lite` was the
 * hardcoded fallback — so a user working in another preset saw *that* preset's
 * card in the variable panel (a stale 苍玄界 copy, in the reported case).
 *
 * The most reliable signal available server-side is the session store: the
 * binding belonging to the most recently written session is the one on screen.
 * @returns {string} a preset directory name, or '' when nothing can be resolved
 */
function activePresetId() {
  try {
    if (!fs.existsSync(SESSION_BINDINGS_FILE)) return ''
    const bind = JSON.parse(fs.readFileSync(SESSION_BINDINGS_FILE, 'utf8'))

    // Session transcripts live under <dshHome>/storages/session_projcache/sessions
    const sessDir = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
    if (fs.existsSync(sessDir)) {
      const files = fs.readdirSync(sessDir)
        .filter(f => f.startsWith('session-') && f.endsWith('.json'))
        .map(f => {
          let mtime = 0
          try { mtime = fs.statSync(path.join(sessDir, f)).mtimeMs } catch (_) {}
          return { id: f.replace(/\.json$/, ''), mtime }
        })
        .sort((a, b) => b.mtime - a.mtime)

      for (const s of files) {
        const preset = bind[s.id]
        if (preset && preset !== 'default') {
          if (fs.existsSync(path.join(PRESETS_ROOT, preset))) return preset
        }
      }
    }
  } catch (_) {}
  return ''
}

/**
 * Search the MUV card dirs for a card matching a name.
 *
 * Reads both `.json` cards and SillyTavern `.png` cards — the latter carries
 * the full card (regex scripts, world book, helper scripts) in a `tEXt` chunk,
 * which is the only place that data survives when a card was dragged into
 * SillyTavern rather than imported through DSH.
 * @param {string} cardNameLower
 * @param {string[]} dirs
 * @returns {{json:object, fileName:string}|null}
 */
function findJsonMatch(cardNameLower, dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    let files
    try { files = fs.readdirSync(dir) } catch (_) { continue }
    for (const f of files) {
      const isJson = f.endsWith('.json')
      const isPng = f.endsWith('.png')
      if (!isJson && !isPng) continue
      try {
        let json
        if (isPng) {
          json = readPngCard(path.join(dir, f))
        } else {
          json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        }
        const name = json?.data?.name || json?.name || ''
        if (!name) continue
        if (cardNameLower && (name.toLowerCase().includes(cardNameLower) || cardNameLower.includes(name.toLowerCase()))) {
          return { json, fileName: f }
        }
      } catch (_) {}
    }
  }
  return null // No fallback — if no exact match, use yml extraction
}

/**
 * Read the active character name from a preset's tavern-managed store.
 *
 * `characters.json` is where tavern actually records the imported card
 * (`[{ name, desc, first, enabled }]`), so it is the authoritative card name.
 * Parsing the persona YAML only yields the preset module's title, which is a
 * different thing entirely.
 * @param {string} presetDir - absolute preset directory
 * @returns {string} the enabled character's name, or ''
 */
function cardNameFromCharactersJson(presetDir) {
  const file = path.join(presetDir, 'characters.json')
  if (!fs.existsSync(file)) return ''
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(list)) return ''
    const enabled = list.find(c => c && c.enabled && c.name)
    if (enabled) return String(enabled.name).trim()
    const first = list.find(c => c && c.name)
    return first ? String(first.name).trim() : ''
  } catch (_) {
    return ''
  }
}

/**
 * Load the full raw character card for a preset, so its `regex_scripts` are
 * available to the rendering engine.
 *
 * The tavern/MUV-managed copy inside the preset (`muv-tables/card.json`) is the
 * authoritative one: it is the card the user actually imported and edited, and
 * it is the only location guaranteed to sit next to the preset that uses it.
 * Only when it is absent do we fall back to matching by name against the
 * external card library.
 * @param {string} presetDir - absolute preset directory
 * @param {string} cardName - card name resolved from the preset's persona
 * @returns {{ json: object, fileName: string, source: string }|null}
 */
function loadRawCardForPreset(presetDir, cardName) {
  const managed = path.join(presetDir, 'muv-tables', 'card.json')
  if (fs.existsSync(managed)) {
    try {
      const json = JSON.parse(fs.readFileSync(managed, 'utf8'))
      const managedName = String(json?.data?.name || json?.name || '')
      // The managed copy goes stale: `tavern-lite` held a 苍玄界 card from
      // August while the preset's characters.json had moved on to 川上富江.
      // Serving it anyway showed the wrong card in the variable panel, so only
      // trust it when the names actually agree. (An empty name means the card
      // carries none — then there is nothing to contradict, so keep it.)
      const wanted = String(cardName || '')
      const agrees = !managedName || !wanted
        || managedName.toLowerCase().includes(wanted.toLowerCase())
        || wanted.toLowerCase().includes(managedName.toLowerCase())
      if (agrees) {
        return { json, fileName: path.basename(presetDir) + '/muv-tables/card.json', source: 'preset' }
      }
    } catch (_) {}
  }
  // A PNG card sitting next to the preset — the user may have dropped the
  // original file there instead of letting tavern import it.
  try {
    for (const f of fs.readdirSync(presetDir)) {
      if (!f.endsWith('.png')) continue
      const json = readPngCard(path.join(presetDir, f))
      if (!json) continue
      const name = json?.data?.name || json?.name || ''
      if (!cardName || !name) continue
      const a = name.toLowerCase(), b = String(cardName).toLowerCase()
      if (a.includes(b) || b.includes(a)) {
        return { json, fileName: path.basename(presetDir) + '/' + f, source: 'preset-png' }
      }
    }
  } catch (_) {}
  const match = findJsonMatch(String(cardName || '').toLowerCase(), MUV_CARD_DIRS)
  if (match) return { ...match, source: 'library' }
  return null
}

/**
 * Pull the card's regex scripts in whatever shape the card carries them.
 * @param {object|null} cardJson
 * @returns {object[]}
 */
function regexScriptsOf(cardJson) {
  const scripts = cardJson?.data?.extensions?.regex_scripts
  return Array.isArray(scripts) ? scripts : []
}

/**
 * Extract the card's variable schema from tavern's own character store.
 *
 * Tavern keeps what it imported in `<presetDir>/characters.json`, so for a card
 * whose original JSON file is not in any searched library folder this is the
 * only place the variables still exist. Two encodings appear in the field:
 *
 *  - `<VariableInsert>{…JSON…}</VariableInsert>` — community cards that ship a
 *    plain JSON schema (this is what the 足控-style cards use).
 *  - `<UpdateVariable><initvar>…</initvar></UpdateVariable>` — the MUV-native
 *    YAML-ish form.
 *
 * Without this, a preset imported like that reported `found:false` and the
 * variable panel stayed empty even though the data was sitting right there.
 * @param {string} presetDir
 * @returns {{name:string, schemas:object[], initvarData:object, initvarBlocks:string[], zodSource:string, cardName:string}|null}
 */
function extractMuvFromCharactersJson(presetDir) {
  try {
    const file = path.join(presetDir, 'characters.json')
    if (!fs.existsSync(file)) return null
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(list) || !list.length) return null
    const card = list.find(c => c && c.enabled) || list[0]
    if (!card) return null
    const name = String(card.name || '').trim() || 'MUV Card'
    const text = String(card.desc || '') + '\n' + String(card.first || '')

    // 1) Plain-JSON schema.
    const vi = text.match(/<VariableInsert>([\s\S]*?)<\/VariableInsert>/i)
    if (vi) {
      const body = vi[1].trim()
      try {
        const data = JSON.parse(body)
        // `$template` is the card's own placeholder entry, not a real character.
        const clean = { ...data }
        if (clean['主播档案'] && clean['主播档案'].$template) {
          clean['主播档案'] = { ...clean['主播档案'] }
          delete clean['主播档案'].$template
        }
        return {
          name, cardName: name,
          schemas: inferSchemas(clean),
          initvarData: clean,
          initvarBlocks: [body],
          zodSource: ''
        }
      } catch (_) {
        // Fall through: the block may still be YAML-ish.
      }
    }

    // 2) MUV-native initvar.
    const iv = text.match(/<initvar>([\s\S]*?)<\/initvar>/i)
    if (iv) {
      const parsed = parseInitvar(iv[1])
      return {
        name, cardName: name,
        schemas: inferSchemas(parsed),
        initvarData: parsed,
        initvarBlocks: [iv[1]],
        zodSource: ''
      }
    }
    return null
  } catch (_) {
    return null
  }
}

/**
 * Extract MUV card info from a preset's persona YAML/yml text.
 * Looks for <initvar> blocks and builds a fake card object for parseMuvCard.
 */
function extractMuvFromYml(yml) {
  if (!yml) return null
  try {
    const nameMatch = yml.match(/角色名[：:]\s*([^\s#\n]+)/) || yml.match(/^\s*name:\s*(.+)$/m)
    let name = nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : 'MUV Card'
    // `^\s*name:` 兜底会吃到 YAML 里的**服务声明**（`name: '@deepseek-ai/dsh-persona'`），
    // 于是面板把插件包名当卡名显示出来。隔壁 extractCardNameFromYml() 有同样的守卫，
    // 这里补上——否则面板会显示 `@deepseek-ai/dsh-persona` 并把它写进 localStorage 粘住。
    if (/^@/.test(name) || name.includes('/')) name = 'MUV Card'
    // Try to find an <initvar> block in the persona
    const m = yml.match(/<initvar>([\s\S]*?)<\/initvar>/i)
    if (m) {
      const blockText = m[1]
      const parsed = parseInitvar(blockText)
      const schemas = inferSchemas(parsed)
      return { name, schemas, initvarData: parsed, initvarBlocks: [blockText], zodSource: '' }
    }
    // No initvar default — serve empty-but-valid so the panel opens empty
    return { name, schemas: [], initvarData: {}, initvarBlocks: [], zodSource: '' }
  } catch (_) {
    return null
  }
}

/** Infer schema tree from data (mirrors muv-parser.inferSchemaFromData). */
function inferSchemas(data) {
  const fields = []
  if (!data || typeof data !== 'object') return fields
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const children = inferSchemas(value)
      if (children.length > 0) fields.push({ name: key, type: 'object', defaultValue: '{}', description: '', children })
    } else if (typeof value === 'number') {
      fields.push({ name: key, type: 'number', defaultValue: String(value), description: '', children: [] })
    } else {
      fields.push({ name: key, type: 'string', defaultValue: String(value ?? ''), description: '', children: [] })
    }
  }
  return fields
}

export const name = 'muv-table'
export const inject = ['webServer']

const MAX_BODY = 5 * 1024 * 1024 // 5MB for large cards like 苍玄界

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  bindDshPaths(ctx)
  console.log('[dsh-muv-table] DSH_HOME = ' + DSH_HOME + '  预设目录 = ' + PRESETS_ROOT)
  const routes = [
    {
      kind: 'exact',
      path: '/muv-table',
      handler: (req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(PANEL_HTML)
      }
    },
    {
      kind: 'exact',
      path: '/api/muv-table/parse-card',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const cardJson = await readBody(req)
          const result = parseMuvCard(cardJson)
          json(res, 200, { ok: true, ...result })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    {
      kind: 'exact',
      path: '/api/muv-table/parse-initvar',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { text } = await readBody(req)
          if (!text) return json(res, 400, { ok: false, error: 'missing text field' })
          const parsed = parseInitvar(text)
          json(res, 200, { ok: true, data: parsed })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    {
      kind: 'exact',
      path: '/api/muv-table/generate',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { originalData, edits } = await readBody(req)
          if (!originalData || !edits) {
            return json(res, 400, { ok: false, error: 'missing originalData or edits' })
          }
          const block = applyEditsAndGenerate(originalData, edits)
          json(res, 200, { ok: true, block })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    {
      kind: 'exact',
      path: '/api/muv-table/generate-raw',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { data } = await readBody(req)
          if (!data) return json(res, 400, { ok: false, error: 'missing data' })
          const block = generateMuvBlock(data)
          json(res, 200, { ok: true, block })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    {
      kind: 'exact',
      path: '/api/muv-table/presets',
      handler: (req, res) => {
        try {
          const presets = scanAllPresetCards()
          json(res, 200, { ok: true, presets })
        } catch (e) {
          json(res, 500, { ok: false, error: e.message })
        }
      }
    },
    {
      kind: 'exact',
      path: '/api/muv-table/active-preset',
      handler: (req, res) => {
        try {
          const presetId = activePresetId()
          json(res, 200, { ok: true, presetId, fallback: presetId ? '' : path.basename(TAVERN_PRESET_DIR) })
        } catch (e) {
          json(res, 500, { ok: false, error: e.message })
        }
      }
    },
    {
      kind: 'exact',
      path: '/api/muv-table/tavern-card',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const presetId = url.searchParams.get('presetId') || ''
          const sessionId = url.searchParams.get('sessionId') || ''

          // Resolve the preset: explicit id > the session's bound preset >
          // whichever preset the user is actually in. The last resort used to be
          // a hardcoded `tavern-lite`, which made the panel show that preset's
          // card (a stale 苍玄界 copy) whenever the client had no preset id yet
          // — which is the common case, since the id only arrives via a
          // `tavern-preset-changed` event that never fires on a fresh page.
          let presetDir
          if (presetId) {
            presetDir = path.join(PRESETS_ROOT, presetId)
          } else if (sessionId) {
            presetDir = presetDirForSession(sessionId)
          } else {
            const active = activePresetId()
            presetDir = active ? path.join(PRESETS_ROOT, active) : TAVERN_PRESET_DIR
          }
          if (!fs.existsSync(presetDir)) presetDir = TAVERN_PRESET_DIR
          const ymlPath = path.join(presetDir, 'agent.cordis.yml')

          let yml = fs.existsSync(ymlPath) ? readYmlSafe(ymlPath) : ''
          // Prefer tavern's own character store; fall back to the persona YAML.
          let cardName = cardNameFromCharactersJson(presetDir) || extractCardNameFromYml(yml)

          // The raw card is the source of regex_scripts. Prefer the preset's own
          // card; fall back to the external library matched by name.
          const raw = loadRawCardForPreset(presetDir, cardName)
          if (raw) {
            const regexScripts = regexScriptsOf(raw.json)
            json(res, 200, {
              ok: true, found: true,
              fileName: raw.fileName,
              cardSource: raw.source,
              cardName,
              presetDir: path.basename(presetDir),
              ...parseMuvCard(raw.json),
              // Consumers read the scripts from either shape; keep both so an
              // existing reader keeps working while the engine migrates.
              regexScripts,
              data: { extensions: { regex_scripts: regexScripts } }
            })
            return
          }

          if (cardName && yml) {
            // Neither a managed copy nor a library file: read the schema out of
            // tavern's own character store. Imported cards routinely live only
            // here, and returning found:false left the variable panel empty
            // while the data sat in characters.json.
            const fromStore = extractMuvFromCharactersJson(presetDir)
            if (fromStore) {
              json(res, 200, {
                ok: true, found: true,
                fileName: path.basename(presetDir) + '/characters.json',
                cardSource: 'characters',
                cardName: fromStore.cardName || cardName,
                presetDir: path.basename(presetDir),
                name: fromStore.name,
                schemas: fromStore.schemas,
                initvarData: fromStore.initvarData,
                initvarBlocks: fromStore.initvarBlocks,
                zodSource: fromStore.zodSource,
                regexScripts: [],
                data: { extensions: { regex_scripts: [] } }
              })
              return
            }
            const parsed = extractMuvFromYml(yml)
            json(res, 200, {
              ok: true, found: true,
              fileName: path.basename(presetDir) + '/agent.cordis.yml',
              cardName, presetDir: path.basename(presetDir),
              ...parsed,
              regexScripts: [],
              data: { extensions: { regex_scripts: [] } }
            })
          } else {
            json(res, 200, { ok: true, found: false, error: 'no card in preset', regexScripts: [] })
          }
        } catch (e) {
          json(res, 500, { ok: false, error: e.message })
        }
      }
    }
  ]

  for (const route of routes) {
    ctx.webServer.register(route)
  }
}