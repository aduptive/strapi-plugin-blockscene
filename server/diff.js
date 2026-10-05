'use strict'

// Version history, pure pieces shared by the server (capture, summary) and the admin (diff against the form, load into
// the form). No Strapi and no Node APIs here: the admin bundles this file.

// Bookkeeping that is not content: never part of a snapshot, a diff or a restore.
const IGNORED = ['id', 'documentId', 'locale', 'localizations', 'createdAt', 'updatedAt', 'publishedAt', 'firstPublishedAt', 'createdBy', 'updatedBy', 'strapi_stage', 'strapi_assignee', '__temp_key__', '__pivot']
const morph = (attr) => String(attr?.relation || '').toLowerCase().includes('morph')
// Attributes a snapshot keeps: content, not bookkeeping; morph relations (no target to resolve) and passwords left out.
const kept = (name, attr) => attr && !IGNORED.includes(name) && attr.type !== 'password' && !(attr.type === 'relation' && (morph(attr) || attr.visible === false))
const empty = (value) => value === null || value === undefined || value === ''

// Populate for a database query (`strapi.db.query(uid).findMany`) reading exactly what a snapshot keeps: components and
// Dynamic Zones recursively, relations as documentId (+ locale), media as ids. Component ids are not read: restoring
// always creates new component rows, and ids would make every publish look like a change.
function snapshotPopulate(uid, schemaOf, stack = []) {
  const schema = schemaOf(uid)
  if (!schema || stack.includes(uid)) return {}
  const scalars = (component) => Object.entries(schemaOf(component)?.attributes || {})
    .filter(([name, attr]) => kept(name, attr) && !['relation', 'media', 'component', 'dynamiczone'].includes(attr.type)).map(([name]) => name)
  // A component with no scalar attribute still needs a column, or the query would select every one.
  const nested = (component) => ({ select: scalars(component).length ? scalars(component) : ['id'], populate: snapshotPopulate(component, schemaOf, [...stack, uid]) })
  const out = {}
  for (const [name, attr] of Object.entries(schema.attributes || {})) {
    if (!kept(name, attr)) continue
    if (attr.type === 'relation') out[name] = { select: ['documentId', 'locale'] }
    else if (attr.type === 'media') out[name] = { select: ['id'] }
    else if (attr.type === 'component') out[name] = nested(attr.component)
    else if (attr.type === 'dynamiczone') out[name] = { on: Object.fromEntries((attr.components || []).map(component => [component, nested(component)])) }
  }
  return out
}

// One canonical shape for a stored entry, a snapshot or the edit form's values, so they can be hashed and compared:
// only schema attributes, empty values (null, '', undefined) left out, media as ids, relations as { documentId, locale }
// (or left out with `relations: false`: the form holds relation changes, not relations), rows as { __component, ... }.
function canonical(data, schema, schemaOf, { relations = true } = {}, depth = 0) {
  const out = {}
  if (!data || typeof data !== 'object' || depth > 20) return out
  const idOf = (file) => file && typeof file === 'object' ? file.id : file
  const ref = (item) => item && typeof item === 'object' && item.documentId ? { documentId: item.documentId, ...(item.locale && { locale: item.locale }) } : null
  for (const [name, attr] of Object.entries(schema?.attributes || {})) {
    const value = data[name]
    if (!kept(name, attr) || empty(value)) continue
    if (attr.type === 'relation') {
      if (!relations) continue
      const refs = (Array.isArray(value) ? value : [value]).map(ref).filter(Boolean)
      if (refs.length) out[name] = Array.isArray(value) ? refs : refs[0]
    } else if (attr.type === 'media') {
      const ids = (Array.isArray(value) ? value : [value]).map(idOf).filter(id => !empty(id))
      if (ids.length) out[name] = attr.multiple ? ids : ids[0]
    } else if (attr.type === 'component') {
      const child = schemaOf(attr.component)
      if (attr.repeatable) { if (Array.isArray(value) && value.length) out[name] = value.map(item => canonical(item, child, schemaOf, { relations }, depth + 1)) }
      else out[name] = canonical(value, child, schemaOf, { relations }, depth + 1)
    } else if (attr.type === 'dynamiczone') {
      if (Array.isArray(value) && value.length) out[name] = value.filter(row => row && typeof row.__component === 'string')
        .map(row => ({ __component: row.__component, ...canonical(row, schemaOf(row.__component), schemaOf, { relations }, depth + 1) }))
    } else out[name] = value
  }
  return out
}

// JSON with sorted keys: equal content, equal text (the hash and the comparisons rely on it).
const stable = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const same = (a, b) => stable(a ?? null) === stable(b ?? null)

// Block-level diff of two row lists: identical rows are matched in order (longest common subsequence), then the rows left
// between two matches are paired by component in order as "changed"; the rest are added or removed.
// Returns [{ op: 'same' | 'changed' | 'added' | 'removed', from?: index in `before`, to?: index in `after`, uid }].
function diffRows(before = [], after = []) {
  const a = before.map(stable), b = after.map(stable)
  const n = a.length, m = b.length
  // Pathological sizes (Dynamic Zones are far smaller) are compared by position instead.
  if (n * m > 250000) return after.map((row, to) => ({ op: a[to] === b[to] ? 'same' : 'changed', from: to < n ? to : undefined, to, uid: row.__component }))
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out = []
  const gap = (fromRows, toRows) => {
    const removed = [...fromRows]
    for (const to of toRows) {
      const k = removed.findIndex(from => before[from].__component === after[to].__component)
      if (k === -1) out.push({ op: 'added', to, uid: after[to].__component })
      else out.push({ op: 'changed', from: removed.splice(k, 1)[0], to, uid: after[to].__component })
    }
    for (const from of removed) out.push({ op: 'removed', from, uid: before[from].__component })
  }
  let i = 0, j = 0, fromRows = [], toRows = []
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { gap(fromRows, toRows); fromRows = []; toRows = []; out.push({ op: 'same', from: i, to: j, uid: after[j].__component }); i++; j++ }
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) toRows.push(j++)
    else fromRows.push(i++)
  }
  gap(fromRows, toRows)
  return out
}

// What changed from `before` to `after` (canonical snapshots of one schema): top-level fields changed, and per Dynamic
// Zone the rows added, removed and changed. `before` null: the first version.
function summarize(before, after, schema) {
  const zones = Object.entries(schema?.attributes || {}).filter(([, attr]) => attr?.type === 'dynamiczone').map(([name]) => name)
  const blocks = { total: zones.reduce((n, name) => n + (Array.isArray(after?.[name]) ? after[name].length : 0), 0), added: 0, removed: 0, changed: 0 }
  if (!before) return { initial: true, fields: [], blocks: { ...blocks, added: blocks.total } }
  const names = [...new Set([...Object.keys(before), ...Object.keys(after || {})])]
  const fields = names.filter(name => !zones.includes(name) && !same(before[name], after?.[name])).sort()
  for (const name of zones) for (const { op } of diffRows(before[name], after?.[name])) if (op !== 'same') blocks[op]++
  return { fields, blocks }
}

module.exports = { IGNORED, kept, snapshotPopulate, canonical, stable, same, diffRows, summarize }
