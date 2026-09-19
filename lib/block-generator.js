// MUV Block Generator: takes structured table data and generates
// a correctly formatted <UpdateVariable><initvar> block.

import { serializeInitvar } from './initvar-parser.js'

/**
 * Generate a complete <UpdateVariable> block from a nested data object.
 * @param {object} data - The full variable data (nested object)
 * @returns {string} The formatted <UpdateVariable><initvar>...</initvar></UpdateVariable> block
 */
export function generateMuvBlock(data) {
  const inner = serializeInitvar(data)
  return `<UpdateVariable>\n<initvar>\n${inner}</initvar>\n</UpdateVariable>`
}

/**
 * Apply table edits to the data tree and generate the MUV block.
 * @param {object} originalData - The original parsed initvar data
 * @param {Array<{path: string, value: any}>} edits - Array of path-value edits
 * @returns {string} The generated MUV block
 */
export function applyEditsAndGenerate(originalData, edits) {
  const data = JSON.parse(JSON.stringify(originalData)) // deep clone

  for (const edit of edits) {
    setNestedValue(data, edit.path, edit.value)
  }

  return generateMuvBlock(data)
}

/**
 * Set a deeply nested value by dot-separated path.
 * @param {object} obj
 * @param {string} path - e.g. "Player.资产.黄金"
 * @param {*} value
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current)) {
      current[key] = {}
    }
    current = current[key]
  }
  const lastKey = keys[keys.length - 1]

  // A list row is edited as newline-joined text; splitting it back keeps the
  // field a list so the generated block still writes `- item` lines instead of
  // collapsing the list into one comma-joined string.
  if (Array.isArray(current[lastKey]) && typeof value === 'string') {
    current[lastKey] = value.split('\n').map(s => s.trim()).filter(s => s !== '')
    return
  }

  // Coerce types
  if (typeof current[lastKey] === 'number' || (!isNaN(current[lastKey]) && current[lastKey] !== '' && current[lastKey] !== null && current[lastKey] !== undefined)) {
    const num = Number(value)
    current[lastKey] = isNaN(num) ? value : num
  } else {
    current[lastKey] = value
  }
}