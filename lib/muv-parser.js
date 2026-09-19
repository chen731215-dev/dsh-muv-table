// MUV Schema Parser: extracts variable structure from character card JSON.
// Uses initvar data to infer the schema tree (more reliable than regex-parsing Zod).

import { parseInitvar } from './initvar-parser.js'

/**
 * Parse a MUV character card JSON and extract schema + variable data.
 * @param {object} cardJson - The full character card JSON
 * @returns {{ name: string, schemas: object[], initvarData: object, zodSource: string }}
 */
export function parseMuvCard(cardJson) {
  const name = cardJson?.data?.name || cardJson?.name || 'Unnamed'
  const extensions = cardJson?.data?.extensions
  const tavernHelper = extensions?.tavern_helper

  // Extract Zod schema source (for reference)
  const zodScript = tavernHelper?.scripts?.find(s => s.name === 'zod')
  const zodSource = zodScript?.content || ''

  // Extract initvar blocks from alternate_greetings
  const greetings = cardJson?.data?.alternate_greetings || []
  const initvarBlocks = []

  for (const greeting of greetings) {
    if (typeof greeting !== 'string') continue
    const match = greeting.match(/<initvar>([\s\S]*?)<\/initvar>/i)
    if (match) {
      initvarBlocks.push({
        raw: match[1].trim(),
        parsed: parseInitvar(match[1])
      })
    }
  }

  // Use the first initvar block as default data
  const initvarData = initvarBlocks.length > 0 ? initvarBlocks[0].parsed : {}

  // Infer schema from initvar data
  const schemas = inferSchemaFromData(initvarData)

  return {
    name,
    schemas,
    initvarData,
    initvarBlocks: initvarBlocks.map(b => b.raw),
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