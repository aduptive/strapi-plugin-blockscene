'use strict'

// Optional layout groups. Sites that keep "wrappers" in the flat Dynamic Zone
// (an OPEN row … its CLOSE row) opt in with a map of OPEN uid -> CLOSE uid:
//   groups: { 'wrappers.join': 'wrappers.close', 'wrappers.background': 'wrappers.close' }
// With no config every component is an ordinary block. Content is never
// rewritten: the helpers only read the flat list, and the publish guard only
// reports. One file for the server (CommonJS) and the admin bundles (esbuild).

const UID = /^[a-z0-9-]+\.[a-z0-9-]+$/
// Returns the validated map or null (malformed input never throws: the site falls back to ordinary blocks).
// `knownUids` (component uids of the host) drops pairs that reference unknown components.
function safeGroups(value, knownUids) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const [open, close] of Object.entries(value)) {
    if (!UID.test(open) || typeof close !== 'string' || !UID.test(close) || open === close) continue
    if (knownUids && (!knownUids.includes(open) || !knownUids.includes(close))) continue
    out[open] = close
  }
  // A CLOSE can never also be an OPEN: that would make the pairing ambiguous.
  for (const close of Object.values(out)) if (out[close]) return null
  return Object.keys(out).length ? out : null
}
const uidOf = row => typeof row?.__component === 'string' ? row.__component : ''
const isOpener = (row, g) => Boolean(g) && Object.prototype.hasOwnProperty.call(g, uidOf(row))
const isClose = (row, g) => Boolean(g) && Object.values(g).includes(uidOf(row))
// Saved rows keep their id across reorders, but component ids are only unique per
// component table, so the key pairs uid and id. Unsaved rows use their temp key.
const blockKey = row => row && row.id != null ? `${row.__component}#${row.id}` : row && row.__temp_key__ != null ? String(row.__temp_key__) : null

// Structural policy (documented in the README):
//  - an OPEN starts a group that ends at ITS configured CLOSE; groups may nest (stack);
//  - a CLOSE right after its OPEN is a valid empty group;
//  - errors: 'closeBeforeOpen' (CLOSE with no open group), 'mismatch' (CLOSE is not the
//    one expected by the innermost open group), 'unclosed' (OPEN never closed).
// Returns [] when the list is well formed. Ordinary blocks are ignored.
function validateGroups(rows, g) {
  const errors = []
  if (!g || !Array.isArray(rows)) return errors
  const stack = []
  rows.forEach((row, index) => {
    const uid = uidOf(row)
    if (isOpener(row, g)) { stack.push({ index, uid, close: g[uid] }); return }
    if (!isClose(row, g)) return
    const top = stack[stack.length - 1]
    if (!top) errors.push({ code: 'closeBeforeOpen', index, uid })
    else if (top.close !== uid) errors.push({ code: 'mismatch', index, uid, expected: top.close, open: top.uid, openIndex: top.index })
    else stack.pop()
  })
  for (const open of stack) errors.push({ code: 'unclosed', index: open.index, uid: open.uid, expected: open.close })
  return errors
}
// [start, end] of the group opened at `start` (end = its matching close, or the last row when unclosed). Lenient: used for rendering only.
function groupRange(rows, start, g) {
  const stack = [g[uidOf(rows[start])]]
  for (let i = start + 1; i < rows.length; i++) {
    const row = rows[i]
    if (isOpener(row, g)) stack.push(g[uidOf(row)])
    else if (isClose(row, g) && uidOf(row) === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return [start, i] }
  }
  return [start, rows.length - 1]
}
// Tree for rendering: { type: 'group', key, closeKey, row, index, depth, children } | { type: 'block', key, row, index, depth }.
// A stray CLOSE (no open group) is kept as an ordinary block so the editor can see and delete it; nothing is repaired.
function groupRows(rows, g, depth = 0, offset = 0) {
  const out = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    if (isOpener(row, g)) {
      const [, end] = groupRange(rows, i, g)
      const closed = uidOf(rows[end]) === g[uidOf(row)] && end > i
      out.push({ type: 'group', key: blockKey(row), closeKey: closed ? blockKey(rows[end]) : null, row, index: offset + i, depth,
        children: groupRows(rows.slice(i + 1, closed ? end : end + 1), g, depth + 1, offset + i + 1) })
      i = end + 1
      continue
    }
    out.push({ type: 'block', key: blockKey(row), row, index: offset + i, depth, stray: isClose(row, g) })
    i++
  }
  return out
}
// Sibling ranges at the top level (block = itself, group = open…close).
function topLevelRanges(rows, g) {
  const ranges = []
  let i = 0
  while (i < rows.length) {
    const end = isOpener(rows[i], g) ? groupRange(rows, i, g)[1] : i
    ranges.push([i, end]); i = end + 1
  }
  return ranges
}
// New flat list with the group whose OPEN has `key` swapped with its previous/next top-level sibling; null when impossible.
function moveGroup(rows, key, direction, g) {
  if (!g) return null
  const ranges = topLevelRanges(rows, g)
  const at = ranges.findIndex(([s]) => blockKey(rows[s]) === String(key))
  const to = at + (direction === 'up' ? -1 : 1)
  if (at < 0 || to < 0 || to >= ranges.length) return null
  const [a, b] = direction === 'up' ? [ranges[to], ranges[at]] : [ranges[at], ranges[to]]
  return [...rows.slice(0, a[0]), ...rows.slice(b[0], b[1] + 1), ...rows.slice(a[0], a[1] + 1), ...rows.slice(b[1] + 1)]
}
// New flat list without the whole group (OPEN, children, CLOSE); null when the key is not a group.
function removeGroup(rows, key, g) {
  if (!g) return null
  const start = rows.findIndex(row => blockKey(row) === String(key))
  if (start < 0 || !isOpener(rows[start], g)) return null
  const [, end] = groupRange(rows, start, g)
  return [...rows.slice(0, start), ...rows.slice(end + 1)]
}

module.exports = { safeGroups, validateGroups, groupRange, groupRows, topLevelRanges, moveGroup, removeGroup, blockKey, isOpener, isClose }
