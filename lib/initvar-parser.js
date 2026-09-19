// MUV Initvar parser: converts YAML-like indented initvar text to nested objects.
// Format: 2-space indentation, `键: 值` pairs. Supports nested objects and inline
// lists (comma-separated values wrapped in [ ]).

/**
 * Parse an initvar text block into a nested object.
 * @param {string} text - The initvar text (between <initvar> and </initvar>)
 * @returns {object} Parsed nested object
 */
export function parseInitvar(text) {
  const lines = text.split(/\r?\n/)
  const root = {}
  const stack = [{ obj: root, indent: -1 }]

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') continue

    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()

    // Pop stack until we find the right parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1].obj
    const colonIdx = trimmed.indexOf(':')

    if (colonIdx === -1) {
      // Value-only line (continuation or list item)
      continue
    }

    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()

    if (value === '') {
      // Nested object start
      const newObj = {}
      parent[key] = newObj
      stack.push({ obj: newObj, indent })
    } else {
      // Leaf value
      parent[key] = parseValue(value)
    }
  }

  return root
}

/**
 * Parse a leaf value string to appropriate type.
 * @param {string} val
 * @returns {string|number|boolean}
 */
function parseValue(val) {
  // Empty string
  if (val === '""' || val === "''") return ''
  if (val === '{}') return '{}'

  // Number
  if (/^-?\d+(\.\d+)?$/.test(val)) {
    return Number(val)
  }

  // Boolean
  if (val === 'true') return true
  if (val === 'false') return false

  return val
}

/**
 * Serialize a nested object back to initvar text.
 * @param {object} obj
 * @param {number} [depth=0]
 * @returns {string}
 */
export function serializeInitvar(obj, depth = 0) {
  const indent = '  '.repeat(depth)
  let result = ''

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result += `${indent}${key}:\n`
      result += serializeInitvar(value, depth + 1)
    } else {
      result += `${indent}${key}: ${formatValue(value)}\n`
    }
  }

  return result
}

function formatValue(val) {
  if (val === null || val === undefined) return ''
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (typeof val === 'number') return String(val)
  return String(val)
}