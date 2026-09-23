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
// Saved rows keep their id across reorders (Strapi regenerates __temp_key__ on
// moves), but component ids are only unique per component table, so the key
// pairs uid and id. Unsaved rows fall back to their __temp_key__.
export const blockKey = row => row && row.id != null ? `${row.__component}#${row.id}` : row && row.__temp_key__ != null ? String(row.__temp_key__) : null

// Projects one row through its schema: scalars by allowlist, local media only,
// components recursively (depth-limited). Passwords, relations and unknown keys never leave the admin.
export function projectRow(row, schema, components, cmsOrigin, depth = 0) {
  if (!row || !schema || depth > 3) return null
  const out = {}
  for (const [name, attr] of Object.entries(schema.attributes || {})) {
    const value = row[name]
    if (attr.type === 'password' || attr.type === 'relation' || attr.private) continue
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
    if (!attr || attr.private === true) return null
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
  const push = (name, attr, label) => { if (!SYSTEM.includes(name.split('.').pop()) && attr?.private !== true && EDITABLE_TYPES.includes(attr?.type)) out.push({ name, type: attr.type, label }) }
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
    if (attr.type === 'media' && attr.private !== true) media[name] = { required: attr.required === true, multiple: attr.multiple === true, present: attr.multiple ? Array.isArray(row?.[name]) && row[name].length > 0 : Boolean(row?.[name]) }
  }
  return media
}
export function projectPage(rows, components, cmsOrigin) {
  return (Array.isArray(rows) ? rows : []).slice(0, 200).flatMap((row, index) => {
    const uid = row?.__component
    const key = blockKey(row)
    const schema = components?.[uid]
    if (!uid || key == null || !schema) return []
    return [{ key, index, uid, label: schema.info?.displayName || uid, data: projectRow(row, schema, components, cmsOrigin),
      fields: editableFields(uid, row, components), media: mediaFields(uid, row, components) }]
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
export function isPreviewMessage(event, origin, source, channel, type) {
  return event.origin === origin && event.source === source && event.data?.protocol === PROTOCOL && event.data?.channel === channel && event.data?.type === type
}
// Insertion gap resolved at confirmation time from the neighbouring key: null
// means "at the start"; a key that no longer exists yields -1 (abort, never append).
export function insertIndex(rows, after) {
  if (after === null || after === undefined) return 0
  const index = (Array.isArray(rows) ? rows : []).findIndex(row => blockKey(row) === String(after))
  return index < 0 ? -1 : index + 1
}

// Layout groups live in ../server/groups.js (shared with the publish guard) and are re-exported here.
export { groupRange, groupRows, topLevelRanges, moveGroup, removeGroup, validateGroups, safeGroups } from '../server/groups.js'
