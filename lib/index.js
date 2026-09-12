// dsh-muv-table server half: provides API endpoints for parsing MUV cards,
// extracting Zod schemas, and generating <UpdateVariable> blocks.

import { parseMuvCard } from './muv-parser.js'
import { generateMuvBlock, applyEditsAndGenerate } from './block-generator.js'
import { parseInitvar } from './initvar-parser.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let PANEL_HTML = ''
try { PANEL_HTML = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8') } catch (_) {}
const PRESETS_ROOT = path.join(os.homedir(), '.dsh', '.agent-presets')
const TAVERN_PRESET_DIR = path.join(PRESETS_ROOT, 'tavern-lite')
const MUV_CARD_DIRS = ['E:/BaiduNetdiskDownload/EdgeDownload']

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
  // 1) Find the persona text: |- block first (the actual character card content)
  const textMatch = yml.match(/text:\s*\|-?\s*\n([\s\S]*?)(?=\n\s*[-a-zA-Z@_]+:|\n\s*$)/)
  const body = textMatch ? textMatch[1] : yml
  // 2) 角色名：xxx pattern (used by tavern cards)
  const personaMatch = body.match(/角色名[：:]\s*([^\s#\n]+)/)
  if (personaMatch) return personaMatch[1].trim()
  // 3) First meaningful line of the persona block (card title)
  const firstLine = body.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('['))
  if (firstLine) return firstLine.replace(/[#*_【】「」]/g, '').trim()
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
    for (const dir of [...dirs, path.join(os.homedir(), '.dsh')]) {
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
    const bindPath = path.join(os.homedir(), '.dsh', '.agent-presets', 'session-bindings.json')
    if (sessionId && fs.existsSync(bindPath)) {
      const bind = JSON.parse(fs.readFileSync(bindPath, 'utf8'))
      const preset = bind[sessionId]
      if (preset && preset !== 'default') return path.join(PRESETS_ROOT, preset)
    }
  } catch (_) {}
  return TAVERN_PRESET_DIR
}

/**
 * Search a person text for a matching card JSON in MUV dirs.
 * Returns parsed card or null.
 */
function findJsonMatch(cardNameLower, dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir).filter(f2 => f2.endsWith('.json'))) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
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
 * Extract MUV card info from a preset's persona YAML/yml text.
 * Looks for <initvar> blocks and builds a fake card object for parseMuvCard.
 */
function extractMuvFromYml(yml) {
  if (!yml) return null
  try {
    const nameMatch = yml.match(/角色名[：:]\s*([^\s#\n]+)/) || yml.match(/^\s*name:\s*(.+)$/m)
    const name = nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : 'MUV Card'
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
      path: '/api/muv-table/tavern-card',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost')
          const presetId = url.searchParams.get('presetId') || ''

          // If a specific preset is requested, read from that preset's directory
          let ymlPath, presetDir
          if (presetId) {
            presetDir = path.join(PRESETS_ROOT, presetId)
            ymlPath = path.join(presetDir, 'agent.cordis.yml')
          } else {
            presetDir = TAVERN_PRESET_DIR
            ymlPath = path.join(TAVERN_PRESET_DIR, 'agent.cordis.yml')
          }

          let yml = fs.existsSync(ymlPath) ? readYmlSafe(ymlPath) : ''
          let cardName = extractCardNameFromYml(yml)

          if (!cardName) {
            const allPresets = scanAllPresetCards()
            const nonEmpty = allPresets.filter(p => p.cardName).sort((a, b) => b.mtime - a.mtime)
            if (nonEmpty.length > 0) {
              cardName = nonEmpty[0].cardName
              yml = nonEmpty[0].yml
            }
          }

          const match = findJsonMatch(String(cardName || '').toLowerCase(), MUV_CARD_DIRS)

          if (match) {
            const result = parseMuvCard(match.json)
            json(res, 200, {
              ok: true, found: true, fileName: match.fileName,
              cardName, presetDir: path.basename(presetDir),
              ...result
            })
          } else if (cardName && yml) {
            const parsed = extractMuvFromYml(yml)
            json(res, 200, {
              ok: true, found: true,
              fileName: path.basename(presetDir) + '/agent.cordis.yml',
              cardName, presetDir: path.basename(presetDir),
              ...parsed
            })
          } else {
            json(res, 200, { ok: true, found: false, error: 'no card in preset' })
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