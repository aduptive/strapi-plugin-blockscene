// Framework-independent whole-page preview contract (Strapi 5 distribution).
// The admin projects the live form values of the first Dynamic Zone through the
// schema and posts them to the frontend's preview route; the frontend renders
// with its own components and styles and asks the admin for edits. Nothing
// here is specific to a site.
export const PROTOCOL = 'blockscene:page-preview:v1'
export const TEXT_TYPES = ['string', 'text']
export const RICH_TYPES = ['richtext', 'blocks', 'customField']
export const EDITABLE_TYPES = [...TEXT_TYPES, ...RICH_TYPES]
const SCALAR = ['string', 'text', 'richtext', 'email', 'enumeration', 'integer', 'biginteger', 'float', 'decimal', 'boolean', 'date', 'datetime', 'time', 'json', 'blocks', 'uid', 'customField']
const ENTRY_SYSTEM = ['id', 'documentId', 'locale', 'createdAt', 'updatedAt', 'publishedAt']
const privateAttribute = attr => attr?.private === true || attr?.pluginOptions?.blockscene?.private === true
export const fieldReadable = (path, allowed, all = false) => {
  if (all) return true
  const fields = Array.isArray(allowed) ? allowed : []
  const parts = String(path).split('.')
  return parts.some((_, index) => fields.includes(parts.slice(0, index + 1).join('.'))) ||
    fields.some(field => field.startsWith(`${path}.`))
}
// Saved rows keep their id across reorders (Strapi regenerates __temp_key__ on
// moves), but component ids are only unique per component table, so the key
// pairs uid and id. Unsaved rows fall back to their __temp_key__.
export const blockKey = row => row && row.id != null ? `${row.__component}#${row.id}` : row && row.__temp_key__ != null ? String(row.__temp_key__) : null

// Makes relation/custom-field values safe for structured cloning without deciding what they mean to the frontend.
// Schema projection below remains the privacy boundary; this only bounds size/depth and strips non-data values.
function plainValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 200000)
  if (typeof value !== 'object' || depth > 8) return undefined
  if (Array.isArray(value)) return value.slice(0, 500).map(item => plainValue(item, depth + 1)).filter(item => item !== undefined)
  const out = {}
  for (const [name, child] of Object.entries(value).slice(0, 500)) {
    const projected = plainValue(child, depth + 1)
    if (projected !== undefined) out[name] = projected
  }
  return out
}

function projectEntryValue(value, attr, components, cmsOrigin, depth = 0, readable = () => true, path = '') {
  if (privateAttribute(attr) || attr?.type === 'password' || depth > 8) return undefined
  if (attr?.type === 'media') {
    const files = (attr.multiple ? (Array.isArray(value) ? value : []) : value ? [value] : [])
      .map(file => projectMedia(file, cmsOrigin)).filter(Boolean)
    return attr.multiple ? files : files[0] || null
  }
  if (attr?.type === 'component') {
    const schema = components?.[attr.component]
    const one = item => {
      if (!item || !schema) return null
      const projected = projectEntryObject(item, schema, components, cmsOrigin, depth + 1, readable, path)
      return item.id != null ? { id: item.id, ...projected } : projected
    }
    return attr.repeatable ? (Array.isArray(value) ? value : []).slice(0, 500).map(one).filter(Boolean) : one(value)
  }
  if (attr?.type === 'dynamiczone') {
    return (Array.isArray(value) ? value : []).slice(0, 500).flatMap(item => {
      const uid = item?.__component
      const schema = components?.[uid]
      if (!uid || !schema) return []
      const projected = projectEntryObject(item, schema, components, cmsOrigin, depth + 1, readable, path)
      return [{ ...(item.id != null && { id: item.id }), __component: uid, ...projected }]
    })
  }
  return plainValue(value, depth)
}

function projectEntryObject(values, schema, components, cmsOrigin, depth = 0, readable = () => true, prefix = '') {
  const out = {}
  for (const [name, attr] of Object.entries(schema?.attributes || {})) {
    const path = prefix ? `${prefix}.${name}` : name
    if (!readable(path) || privateAttribute(attr) || attr.type === 'password' || values?.[name] === undefined) continue
    const projected = projectEntryValue(values[name], attr, components, cmsOrigin, depth, readable, path)
    if (projected !== undefined) out[name] = projected
  }
  return out
}

// The page route receives the complete live entry by default. Top-level RBAC is enforced by `readable`; Strapi's
// `private` and Blockscene's explicit `pluginOptions.blockscene.private` opt-out apply recursively to components.
export function projectEntry(values, schema, components, cmsOrigin, readable = () => true) {
  const out = projectEntryObject(values, schema, components, cmsOrigin, 0, readable)
  for (const name of ENTRY_SYSTEM) if (values?.[name] !== undefined) out[name] = plainValue(values[name])
  return out
}

// Projects one row through its schema: scalars by allowlist, local media only,
// components recursively (depth-limited). Passwords, relations and unknown keys never leave the admin.
export function projectRow(row, schema, components, cmsOrigin, depth = 0) {
  if (!row || !schema || depth > 3) return null
  const out = {}
  for (const [name, attr] of Object.entries(schema.attributes || {})) {
    const value = row[name]
    if (attr.type === 'password' || attr.type === 'relation' || privateAttribute(attr)) continue
    if (SCALAR.includes(attr.type)) { if (value !== undefined) out[name] = typeof value === 'string' ? value.slice(0, 200000) : value }
    else if (attr.type === 'media') {
      const files = (attr.multiple ? (Array.isArray(value) ? value : []) : value ? [value] : []).map(file => projectMedia(file, cmsOrigin)).filter(Boolean)
      out[name] = attr.multiple ? files : files[0] || null
    } else if (attr.type === 'component') {
      const child = components?.[attr.component]
      out[name] = attr.repeatable ? (Array.isArray(value) ? value : []).slice(0, 100).map((item, i) => ({ ...projectRow(item, child, components, cmsOrigin, depth + 1), __key: blockKey(item) ?? String(i) })) : projectRow(value, child, components, cmsOrigin, depth + 1)
    }
  }
  return out
}
export function projectMedia(file, cmsOrigin) {
  if (!file || typeof file.url !== 'string') return null
  try {
    // Absolute http(s) URLs (S3, CDN, any upload provider) and same-origin relative paths; other schemes are dropped.
    const url = new URL(file.url, cmsOrigin)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return { url: url.href, alternativeText: String(file.alternativeText || ''), caption: String(file.caption || ''), width: Number(file.width) || 0, height: Number(file.height) || 0, mime: String(file.mime || '') }
  } catch { return null }
}
export function resolveField(uid, field, components) {
  if (typeof field !== 'string' || field.length > 200) return null
  let schema = components?.[uid]
  const parts = field.split('.')
  for (let i = 0; i < parts.length; i++) {
    const attr = schema?.attributes?.[parts[i]]
    if (!attr || privateAttribute(attr)) return null
    if (i === parts.length - 1) return attr
    if (attr.type !== 'component') return null
    if (attr.repeatable) { if (!/^\d{1,3}$/.test(parts[i + 1] || '')) return null; i++ }
    schema = components?.[attr.component]
  }
  return null
}
// Editable text fields straight from the schema: top level plus one level of repeatable rows.
export function editableFields(uid, row, components) {
  const schema = components?.[uid]
  const out = []
  // System attributes are never editable content.
  const SYSTEM = ['id', 'documentId', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'localizations', '__component', '__temp_key__']
  const push = (name, attr, label) => { if (!SYSTEM.includes(name.split('.').pop()) && !privateAttribute(attr) && EDITABLE_TYPES.includes(attr?.type)) out.push({ name, type: attr.type, label }) }
  for (const [name, attr] of Object.entries(schema?.attributes || {})) {
    if (attr.type === 'component' && attr.repeatable) {
      (Array.isArray(row?.[name]) ? row[name] : []).slice(0, 50).forEach((_, i) => {
        for (const [child, childAttr] of Object.entries(components?.[attr.component]?.attributes || {})) push(`${name}.${i}.${child}`, childAttr, `${name} ${i + 1} · ${child}`)
      })
    } else push(name, attr, name)
  }
  return out
}
export function mediaFields(uid, row, components) {
  const media = {}
  for (const [name, attr] of Object.entries(components?.[uid]?.attributes || {})) {
    if (attr.type === 'media' && !privateAttribute(attr)) media[name] = { required: attr.required === true, multiple: attr.multiple === true, present: attr.multiple ? Array.isArray(row?.[name]) && row[name].length > 0 : Boolean(row?.[name]) }
  }
  return media
}
// `hidden`: the "hide on the site" attribute name; a row with it set is sent with `hidden: true` (dimmed by the page).
export function projectPage(rows, components, cmsOrigin, hidden = null) {
  return (Array.isArray(rows) ? rows : []).slice(0, 200).flatMap((row, index) => {
    const uid = row?.__component
    const key = blockKey(row)
    const schema = components?.[uid]
    if (!uid || key == null || !schema) return []
    return [{ key, index, uid, label: schema.info?.displayName || uid, data: projectRow(row, schema, components, cmsOrigin),
      fields: editableFields(uid, row, components), media: mediaFields(uid, row, components), ...(hidden && row[hidden] === true && { hidden: true }) }]
  })
}
export const validateFocus = (uid, field, components) => { const attr = resolveField(uid, field, components); return attr && EDITABLE_TYPES.includes(attr.type) ? attr : null }
// Inline plain-text edits: any string/text attribute (the frontend decides which ones it maps).
export function validateEdit(uid, field, value, components) {
  if (typeof value !== 'string' || value.length > 5000) return null
  const attr = resolveField(uid, field, components)
  return attr && TEXT_TYPES.includes(attr.type) ? value.replace(/[\r\n]+/g, ' ') : null
}
export const mediaAttribute = (uid, field, components) => { const attr = resolveField(uid, field, components); return attr?.type === 'media' ? attr : null }
// Reads a dotted path (repeatable rows included) on a row; undefined when any step is missing.
export const getIn = (row, path) => String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), row)
// Hover sync (both directions): null clears; otherwise a key of the current rows. undefined means "ignore the message".
export const hoverKey = (key, rows) => key === null ? null
  : typeof key === 'string' && key.length <= 200 && (Array.isArray(rows) ? rows : []).some(row => blockKey(row) === key) ? key : undefined
export function isPreviewMessage(event, origin, source, channel, type) {
  return event.origin === origin && event.source === source && event.data?.protocol === PROTOCOL && event.data?.channel === channel && event.data?.type === type
}
// Historical previews never act on the live form, including select/focus/hover. Only the handshake is accepted.
export const previewMessageAllowed = (event, origin, source, channel, readOnly) =>
  isPreviewMessage(event, origin, source, channel, event.data?.type) && (!readOnly || event.data?.type === 'ready')
// Insertion gap resolved at confirmation time from the neighbouring key: null
// means "at the start"; a key that no longer exists yields -1 (abort, never append).
export function insertIndex(rows, after) {
  if (after === null || after === undefined) return 0
  const index = (Array.isArray(rows) ? rows : []).findIndex(row => blockKey(row) === String(after))
  return index < 0 ? -1 : index + 1
}

// Layout groups live in ../server/groups.js (shared with the publish guard) and are re-exported here.
export { groupRange, groupRows, topLevelRanges, moveGroup, removeGroup, unwrapGroup, validateGroups, safeGroups } from '../server/groups.js'
