// MUV Initvar parser: converts YAML-like indented initvar text to nested objects.
// Format: 2-space indentation, `键: 值` pairs. Supports nested objects, `- item`
// lists, and inline lists (comma-separated values wrapped in [ ]).

/**
 * Parse an initvar text block into a nested object.
 * @param {string} text - The initvar text (between <initvar> and </initvar>)
 * @returns {object} Parsed nested object
 */
export function parseInitvar(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const root = {}
  // Each frame remembers the key that opened it and the object that holds it, so
  // a frame created as an assumed-empty object can still be turned into an array
  // once its contents turn out to be `- item` lines.
  const stack = [{ obj: root, indent: -1, key: null, parent: null, list: false }]

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') continue

    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()

    // A `- item` line is a list entry, not a `键: 值` pair. It used to be dropped
    // outright (`colonIdx === -1` → continue), which silently emptied every list
    // a card declares the way 苍玄界 does:
    //
    //     最近互动记录: 
    //        - 因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。
    //
    // The key before it looks like an empty value, so the entry belongs to the
    // innermost *pending* key: that key was optimistically created as `{}` and is
    // now revealed to be an array. Checked before the stack pop because a list is
    // allowed to sit at the same indent as its own key.
    const itemMatch = /^-(?:\s+(.*))?$/.exec(trimmed)
    if (itemMatch) {
      const frame = stack[stack.length - 1]
      if (frame.key !== null && !frame.list && Object.keys(frame.obj).length === 0) {
        const arr = []
        frame.parent[frame.key] = arr
        frame.obj = arr
        frame.list = true
      }
      // No pending key above us means a stray item with nowhere to go; dropping
      // it is the same behaviour this line always had.
      if (frame.list) frame.obj.push(parseValue((itemMatch[1] ?? '').trim()))
      continue
    }

    // Pop stack until we find the right parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const parentFrame = stack[stack.length - 1]
    const parent = parentFrame.obj
    const colonIdx = trimmed.indexOf(':')

    if (colonIdx === -1) {
      // Value-only line (continuation) — not representable in this format, and
      // dropped exactly as before. Inside a list there are no keys at all, so the
      // raw line is kept as an item rather than vanishing.
      if (parentFrame.list) parent.push(trimmed)
      continue
    }

    // A `键: 值` line under a list is not a key either (`- a` followed by an
    // indented `x: 1` is a list of objects, which this format cannot express).
    // Keeping the text as an item preserves the content; writing it as a property
    // of an array would be silently lost by JSON.stringify.
    if (parentFrame.list) {
      parent.push(trimmed)
      continue
    }

    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()

    if (value === '') {
      // Nested object start — may still turn out to be a list (see above).
      const newObj = {}
      parent[key] = newObj
      stack.push({ obj: newObj, indent, key, parent, list: false })
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
 * @returns {string|number|boolean|Array}
 */
function parseValue(val) {
  // Empty string
  if (val === '""' || val === "''") return ''
  if (val === '{}') return '{}'
  // Empty list — serialized that way so it does not come back as `{}`.
  if (val === '[]') return []

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
    if (Array.isArray(value)) {
      // Lists are written the way the cards write them (`键:` then `  - item`), so
      // a parsed list survives a round trip instead of collapsing into "a,b".
      if (value.length === 0) {
        result += `${indent}${key}: []\n`
      } else {
        result += `${indent}${key}:\n`
        for (const item of value) result += `${indent}  - ${formatValue(item)}\n`
      }
    } else if (value !== null && typeof value === 'object') {
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
  // An empty string must stay quoted. Written bare (`键: `) the line looks like
  // the start of a nested object, so 苍玄界's `在场角色: ""` came back as `{}`
  // the next time the block was read — a silent type flip. The cards quote it
  // themselves; this just keeps that convention on the way out.
  if (val === '') return '""'
  return String(val)
}