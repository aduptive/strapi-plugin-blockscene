'use strict'

const PLUGIN = 'blockscene'
// 'none' shows a plain "no preview" placeholder instead of a wireframe (blocks that have no faithful image).
const TEMPLATES = ['generic', 'banner', 'cards', 'imageText', 'faq', 'none']
const INITIAL_STATES = ['closed', 'open', 'remember']
const PREVIEW_MODES = ['form', 'split', 'preview']
const HIDDEN_MODES = ['strip', 'flag', 'off']
const DEFAULTS = {
  palette: { background: '#F6F6F9', surface: '#DCDCE4', text: '#32324D', accent: '#4945FF' },
  components: {},
  // previewUrl: '' means "reuse Strapi's native Preview origin when configured"; a URL overrides it.
  // blockPreviewInForm: compact read-only preview above a block's fields in form
  // mode. Only installations that ship the accordion integration (server config
  // `blockPreview: true`) show and honour it; the page preview is the editor.
  editor: { enabled: true, showOpenAll: true, showCloseAll: true, showRowThumbnails: true, initialState: 'closed', previewMode: 'form', previewUrl: '', blockPreviewUrl: '', blockPreviewInForm: false,
    // Strapi 5: rich-text custom fields render a read-only preview until clicked (see admin/LazyInput.tsx).
    lazyEditors: true, lazyFields: ['plugin::ckeditor5.CKEditor'],
    // Row actions in each block header (see README "Row actions"). hiddenBlocks: what the content API does with rows
    // hidden on the site: 'strip' removes them, 'flag' sends them with the attribute, 'off' hides the eye icon.
    confirmDelete: true, hiddenBlocks: 'strip', duplicate: true, clipboard: true,
    // Edit view labels that are still the raw attribute name read as "Mobile columns count" (see README "Field labels").
    friendlyLabels: true,
    // Page preview pane (Strapi 5): which toolbar controls show, in order, and the width menu's entries.
    previewToolbar: ['modes', 'history', 'devices', 'status', 'actions'], previewDevices: ['fit', 'mobile', 'tablet', 'desktop'] },
  // Per content type (only the ones with a Dynamic Zone): { enabled: false } turns the plugin off there;
  // previewMode overrides editor.previewMode as the mode the edit view opens in. Absent means the global behaviour.
  contentTypes: {},
  // Version history (Strapi 5, see README "Version history"): off until turned on. contentTypes: 'all' (every api:: type)
  // or a list of uids. Snapshots are kept retentionDays and at most maxSnapshots per document; events eventDays; deleted
  // documents stay in the trash trashDays (fixed per document when it is deleted).
  history: { enabled: false, contentTypes: 'all', retentionDays: 90, maxSnapshots: 100, eventDays: 365, trashDays: 90 },
}
// Visual editor sidebar: each item opens some of the document's own fields (its native inputs) in a modal or drawer.
const ICONS = ['text', 'tag', 'seo', 'settings', 'image', 'link', 'palette', 'list', 'globe', 'info']
const SIDEBAR_POSITIONS = ['left', 'right', 'bottom']
const OPENS = ['modal', 'drawer']
const LABEL = /^[^<>]{1,40}$/
// Pane toolbar: an ordered subset of the known controls (none repeated). Width menu: known devices and custom widths
// ({ label, width }), 1 to 8 entries, no name or width twice.
const TOOLBAR = ['modes', 'history', 'devices', 'status', 'actions']
const DEVICE_NAMES = ['fit', 'mobile', 'tablet', 'desktop']
const previewToolbar = value => Array.isArray(value) && value.every(id => TOOLBAR.includes(id)) && new Set(value).size === value.length
const DEVICE_LABEL = /^[^<>]{1,24}$/
const customDevice = item => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).every(key => ['label', 'width'].includes(key)) &&
  typeof item.label === 'string' && DEVICE_LABEL.test(item.label.trim()) && Number.isInteger(item.width) && item.width >= 240 && item.width <= 3840
const previewDevices = value => Array.isArray(value) && value.length >= 1 && value.length <= 8 &&
  value.every(item => DEVICE_NAMES.includes(item) || customDevice(item)) &&
  new Set(value.map(item => typeof item === 'string' ? item : item.width)).size === value.length
const cleanDevices = value => value.map(item => typeof item === 'string' ? item : { label: item.label.trim(), width: item.width })
const sidebarItem = (item, attributes) => item && typeof item === 'object' && !Array.isArray(item) &&
  Object.keys(item).every(key => ['label', 'icon', 'open', 'fields'].includes(key)) &&
  typeof item.label === 'string' && LABEL.test(item.label.trim()) &&
  (item.icon === undefined || item.icon === '' || ICONS.includes(item.icon)) && OPENS.includes(item.open) &&
  Array.isArray(item.fields) && item.fields.length > 0 && item.fields.length <= 30 &&
  item.fields.every(field => typeof field === 'string' && (!attributes || attributes.includes(field)))
// Each predicate receives the value and the content type's attribute names (null when unknown: no field check).
const TYPE_KEYS = {
  enabled: value => typeof value === 'boolean',
  previewMode: value => PREVIEW_MODES.includes(value),
  sidebarPosition: value => SIDEBAR_POSITIONS.includes(value),
  previewToolbar,
  previewDevices,
  sidebar: (value, attributes) => Array.isArray(value) && value.length <= 12 && value.every(item => sidebarItem(item, attributes)),
}
// contentTypes: an array of uids, or { uid: [attribute names] } to also check sidebar fields.
const typeMap = (types) => Array.isArray(types) ? Object.fromEntries(types.map(uid => [uid, null])) : (types || {})
const PREVIEW_URL = /^https?:\/\/[^\s"'<>]{1,500}$/
// blockPreviewUrl: an http(s) URL whose braces are only the known placeholders ({uid}, {name}, {category}, {variant}, {locale}).
const blockPreviewUrl = value => typeof value === 'string' && (value === '' || (PREVIEW_URL.test(value) &&
  !/[{}]/.test(value.replace(/\{(uid|name|category|variant|locale)\}/g, '')) && URL.canParse?.(value.replace(/[{}]/g, '')) !== false))
const COLOR = /^#[0-9A-Fa-f]{6}$/
const FIELD_UID = /^(plugin|global)::[\w.-]+$/
const lazyFields = value => Array.isArray(value) && value.length <= 20 && value.every(uid => typeof uid === 'string' && FIELD_UID.test(uid))
const UID = /^[a-z0-9-]+\.[a-z0-9-]+$/

// history: each predicate receives the value and the api:: uids that exist (null when unknown: no existence check).
const API_UID = /^api::[\w-]+\.[\w-]+$/
const days = value => Number.isInteger(value) && value >= 1 && value <= 3650
const HISTORY_KEYS = {
  enabled: value => typeof value === 'boolean',
  contentTypes: (value, uids) => value === 'all' || (Array.isArray(value) && value.length <= 500 && value.every(uid => typeof uid === 'string' && API_UID.test(uid) && (!uids || uids.includes(uid)))),
  retentionDays: days,
  maxSnapshots: value => Number.isInteger(value) && value >= 1 && value <= 1000,
  eventDays: days,
  trashDays: days,
}

// Gallery taxonomy. Facets are read from the schema; the typology is guessed from the name unless overridden.
const TYPOLOGIES = ['hero', 'text', 'media', 'listing', 'cards', 'cta', 'form', 'layout']
const TAG = /^[^<>\n]{1,24}$/
const cleanTags = (value) => Array.isArray(value) ? [...new Set(value.filter(tag => typeof tag === 'string' && TAG.test(tag.trim())).map(tag => tag.trim()))].slice(0, 10) : []
const validTags = (value) => Array.isArray(value) && value.length <= 10 && value.every(tag => typeof tag === 'string' && TAG.test(tag.trim()))
const GUESSES = [['hero', /hero|banner|cover/], ['text', /text|rich|quote|title/], ['media', /image|media|video|gallery|carousel/],
  ['listing', /list|query|archive|related|posts|projects/], ['cards', /card/], ['cta', /cta|button|link/], ['form', /form|contact/],
  ['layout', /wrapper|column|grid|divider|divisor|spacer|section/]]
// The uid's category ("sections.faq") is left out: it names a folder, not the block.
function guessTypology(uid, displayName = '') {
  const name = `${uid.split('.').pop()} ${displayName}`.toLowerCase()
  return GUESSES.find(([, pattern]) => pattern.test(name))?.[0] || 'text'
}
// Attributes of the component and of the components it nests, one level down.
function facetsOf(uid, schema, schemas = {}) {
  const facets = new Set()
  const read = (attributes, nested) => {
    for (const attr of Object.values(attributes || {})) {
      if (attr?.type === 'media') {
        const allowed = attr.allowedTypes
        if (!allowed || allowed.includes('images')) facets.add('image')
        if (!allowed || allowed.includes('videos')) facets.add('video')
        if (attr.multiple) facets.add('gallery')
      } else if (['richtext', 'blocks'].includes(attr?.type) || (attr?.type === 'customField' && /ckeditor/i.test(String(attr.customField)))) facets.add('richtext')
      else if (attr?.type === 'relation') facets.add('dynamic')
      else if (attr?.type === 'component') {
        if (attr.repeatable) facets.add('list')
        if (!nested) read(schemas[attr.component]?.attributes, true)
      }
    }
  }
  read(schema?.attributes, false)
  if (/query|archive|related/i.test(uid)) facets.add('dynamic')
  if (/form|contact/i.test(`${uid} ${schema?.info?.displayName || ''}`)) facets.add('form')
  return [...facets]
}

const safeUrl = (value) => typeof value === 'string' &&
  (/^\/(?!\/)/.test(value) || /^https?:\/\//.test(value)) ? value : undefined
const { safeGroups, validLayout } = require('./groups')
const safeVersion = (value) => typeof value === 'string' && /^[\w.-]{1,32}$/.test(value) ? value : undefined
// Strapi maps ValidationError to 400; outside a Strapi host (unit tests) a plain error with the same name is thrown.
const fail = (message, details) => {
  let ValidationError
  try { ValidationError = require('@strapi/utils').errors.ValidationError } catch { ValidationError = class extends Error { constructor(m, d) { super(m); this.name = 'ValidationError'; this.details = d } } }
  throw new ValidationError(message, details)
}

// `schemas` (the host's components) adds facets, typology and tags to every component; the code config can set
// typology and tags, and its legacy `category` still filters as a tag.
function catalog(config = {}) {
  const entries = {}
  for (const [uid, entry] of Object.entries(config.components || {})) {
    if (!entry || typeof entry !== 'object') continue
    entries[uid] = Object.fromEntries(
      ['label', 'description', 'category', 'keywords'].filter(key => typeof entry[key] === 'string')
        .map(key => [key, entry[key]])
    )
    entries[uid].image = safeUrl(entry.image)
    if (TYPOLOGIES.includes(entry.typology)) entries[uid].typology = entry.typology
    const tags = cleanTags(entry.tags)
    if (tags.length || entries[uid].category) entries[uid].tags = tags.length ? tags : cleanTags([entries[uid].category])
  }
  for (const [uid, schema] of Object.entries(config.schemas || {})) {
    const entry = entries[uid] ||= {}
    entry.facets = facetsOf(uid, schema, config.schemas)
    entry.typology ||= guessTypology(uid, schema?.info?.displayName)
    entry.tags ||= []
  }
  return { components: entries, previewBaseUrl: safeUrl(config.previewBaseUrl) || '/block-previews',
    previewVersion: safeVersion(config.previewVersion), disabled: config.disabled === true, blockPreviewAvailable: config.blockPreview === true,
    // Optional OPEN -> CLOSE map (see groups.js); null means every component is an ordinary block.
    groups: safeGroups(config.groups, config.componentUids) }
}

// Strict validation for PUT: reject instead of silently coercing.
// historyTypes: every api:: content type uid (history may cover types without a Dynamic Zone); null skips that check.
// schemas: the host's components (uid -> schema), for `layout`; null skips the attribute check.
function validateSettings(input, componentUids, contentTypeUids = [], historyTypes = null, schemas = null) {
  const types = typeMap(contentTypeUids)
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Settings must be an object')
  if (JSON.stringify(input).length > 64 * 1024) fail('Settings payload too large')
  const out = structuredClone(DEFAULTS)
  for (const key of Object.keys(input)) if (!(key in DEFAULTS)) fail(`Unknown setting "${key}"`)
  for (const [key, value] of Object.entries(input.palette || {})) {
    if (!(key in DEFAULTS.palette)) fail(`Unknown palette color "${key}"`)
    if (!COLOR.test(String(value))) fail(`Color "${key}" must use #RRGGBB`)
    out.palette[key] = String(value).toUpperCase()
  }
  for (const [key, value] of Object.entries(input.editor || {})) {
    if (!(key in DEFAULTS.editor)) fail(`Unknown editor option "${key}"`)
    const valid = key === 'initialState' ? INITIAL_STATES.includes(value) : key === 'previewMode' ? PREVIEW_MODES.includes(value)
      : key === 'hiddenBlocks' ? HIDDEN_MODES.includes(value)
      : key === 'previewUrl' ? value === '' || (typeof value === 'string' && PREVIEW_URL.test(value))
      : key === 'blockPreviewUrl' ? blockPreviewUrl(value) : key === 'lazyFields' ? lazyFields(value)
      : key === 'previewToolbar' ? previewToolbar(value) : key === 'previewDevices' ? previewDevices(value) : typeof value === 'boolean'
    if (!valid) fail(`Invalid value for editor option "${key}"`)
    out.editor[key] = key === 'previewUrl' && value ? String(new URL(value).href).replace(/\/$/, '') : key === 'lazyFields' ? [...new Set(value)]
      : key === 'previewDevices' ? cleanDevices(value) : value
  }
  const components = input.components || {}
  if (typeof components !== 'object' || Array.isArray(components)) fail('components must be an object')
  for (const [uid, entry] of Object.entries(components)) {
    if (!UID.test(uid) || !componentUids.includes(uid)) fail(`Unknown component "${uid}"`)
    if (!entry || typeof entry !== 'object') fail(`Invalid entry for "${uid}"`)
    const clean = {}
    for (const key of Object.keys(entry)) {
      if (key === 'template') { if (!TEMPLATES.includes(entry.template)) fail(`Unknown template for "${uid}"`); clean.template = entry.template }
      else if (key === 'typology') { if (!TYPOLOGIES.includes(entry.typology)) fail(`Unknown typology for "${uid}"`); clean.typology = entry.typology }
      else if (key === 'tags') { if (!validTags(entry.tags)) fail(`Invalid tags for "${uid}": up to 10, each 1 to 24 characters`); clean.tags = cleanTags(entry.tags) }
      else if (key === 'mediaId') { if (!Number.isInteger(entry.mediaId) || entry.mediaId <= 0) fail(`Invalid media for "${uid}"`); clean.mediaId = entry.mediaId }
      else if (key === 'layout') { if (!validLayout(entry.layout, schemas && (schemas[uid]?.attributes || {}))) fail(`Invalid layout for "${uid}": columnsField (and mobileColumnsField) must name a number, string or numeric enumeration attribute of the component; maxColumns 1 to 12`); clean.layout = structuredClone(entry.layout) }
      else fail(`Unknown component setting "${key}"`)
    }
    if (Object.keys(clean).length) out.components[uid] = clean
  }
  const perType = input.contentTypes || {}
  if (typeof perType !== 'object' || Array.isArray(perType)) fail('contentTypes must be an object')
  for (const [uid, entry] of Object.entries(perType)) {
    if (!(uid in types)) fail(`Unknown content type "${uid}"`)
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`Invalid entry for "${uid}"`)
    for (const [key, value] of Object.entries(entry)) {
      if (!(key in TYPE_KEYS)) fail(`Unknown content type setting "${key}"`)
      if (!TYPE_KEYS[key](value, types[uid])) fail(`Invalid value for "${key}" of "${uid}"`)
    }
    if (Object.keys(entry).length) out.contentTypes[uid] = { ...structuredClone(entry), ...(entry.previewDevices && { previewDevices: cleanDevices(entry.previewDevices) }) }
  }
  const history = input.history || {}
  if (typeof history !== 'object' || Array.isArray(history)) fail('history must be an object')
  for (const [key, value] of Object.entries(history)) {
    if (!(key in HISTORY_KEYS)) fail(`Unknown history option "${key}"`)
    if (!HISTORY_KEYS[key](value, historyTypes)) fail(`Invalid value for history option "${key}"`)
    out.history[key] = Array.isArray(value) ? [...new Set(value)] : value
  }
  // Purging an event takes its snapshot with it: events must outlive the snapshot retention.
  if (out.history.eventDays < out.history.retentionDays) fail('history.eventDays must be at least history.retentionDays')
  return out
}

// Lenient read: saved values that no longer apply (deleted component) are dropped.
function mergeSaved(saved, componentUids, contentTypeUids = [], historyTypes = null, schemas = null) {
  const types = typeMap(contentTypeUids)
  const out = structuredClone(DEFAULTS)
  if (!saved || typeof saved !== 'object') return out
  for (const key of Object.keys(DEFAULTS.palette)) if (COLOR.test(String(saved.palette?.[key]))) out.palette[key] = saved.palette[key]
  for (const key of Object.keys(DEFAULTS.editor)) {
    const value = saved.editor?.[key]
    if (value === undefined || typeof value !== typeof DEFAULTS.editor[key]) continue
    if (key === 'initialState' && !INITIAL_STATES.includes(value)) continue
    if (key === 'previewMode' && !PREVIEW_MODES.includes(value)) continue
    if (key === 'hiddenBlocks' && !HIDDEN_MODES.includes(value)) continue
    if (key === 'previewUrl' && value && !PREVIEW_URL.test(value)) continue
    if (key === 'blockPreviewUrl' && !blockPreviewUrl(value)) continue
    if (key === 'previewToolbar' && !previewToolbar(value)) continue
    if (key === 'previewDevices' && !previewDevices(value)) continue
    // A list with a bad uid keeps its valid ones.
    if (key === 'lazyFields') { if (!Array.isArray(value)) continue; out.editor[key] = [...new Set(value.filter(uid => lazyFields([uid])))].slice(0, 20); continue }
    out.editor[key] = value
  }
  for (const [uid, entry] of Object.entries(saved.components || {})) {
    if (!componentUids.includes(uid) || !entry || typeof entry !== 'object') continue
    const clean = { ...entry }
    if ('typology' in clean && !TYPOLOGIES.includes(clean.typology)) delete clean.typology
    if ('tags' in clean) { clean.tags = cleanTags(clean.tags); if (!clean.tags.length) delete clean.tags }
    if ('layout' in clean && !validLayout(clean.layout, schemas && (schemas[uid]?.attributes || {}))) delete clean.layout
    if (Object.keys(clean).length) out.components[uid] = clean
  }
  for (const [uid, entry] of Object.entries(saved.contentTypes || {})) {
    if (!(uid in types) || !entry || typeof entry !== 'object') continue
    // A sidebar naming a field that no longer exists keeps its other items.
    const fix = (key, value) => key === 'sidebar' && Array.isArray(value) ? value.filter(item => sidebarItem(item, types[uid])) : value
    const clean = Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, fix(key, value)]).filter(([key, value]) => TYPE_KEYS[key]?.(value, types[uid])))
    if (Object.keys(clean).length) out.contentTypes[uid] = clean
  }
  for (const key of Object.keys(HISTORY_KEYS)) {
    let value = saved.history?.[key]
    // A list naming a removed content type keeps the others.
    if (key === 'contentTypes' && Array.isArray(value)) value = value.filter(uid => HISTORY_KEYS.contentTypes([uid], historyTypes))
    if (value !== undefined && HISTORY_KEYS[key](value, historyTypes)) out.history[key] = value
  }
  out.history.eventDays = Math.max(out.history.eventDays, out.history.retentionDays)
  return out
}

// Project baseline (plugin config `settings`, validated) under the saved document: palette and editor key by key,
// components and contentTypes per uid entry (a saved entry replaces the code entry for that uid).
const ENTRY_KEYS = ['components', 'contentTypes']
// Optional URLs where '' means "not set": an empty saved value never hides the project's code value (a Settings page
// saved before the code default existed would otherwise keep the preview off). Clearing the field restores the code one.
const UNSET_WHEN_EMPTY = ['previewUrl', 'blockPreviewUrl']
const withoutEmpty = (editor) => Object.fromEntries(Object.entries(editor).filter(([key, value]) => !(UNSET_WHEN_EMPTY.includes(key) && value === '')))
function layer(base, saved) {
  if (!base) return saved
  const doc = saved && typeof saved === 'object' ? saved : {}
  const own = (key) => doc[key] && typeof doc[key] === 'object' ? (key === 'editor' ? withoutEmpty(doc[key]) : doc[key]) : {}
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, { ...base[key], ...own(key) }]))
}
// What to store: only what differs from the baseline, so later code changes still reach untouched keys. A baseline
// uid the admin removed is kept as {} (an empty entry replaces the code entry and is then dropped on read).
function overrides(next, base) {
  if (!base) return next
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => {
    const entries = Object.entries(next[key] || {}).filter(([name, value]) => JSON.stringify(value) !== JSON.stringify(base[key]?.[name]) &&
      !(key === 'editor' && UNSET_WHEN_EMPTY.includes(name) && value === ''))
    if (ENTRY_KEYS.includes(key)) for (const uid of Object.keys(base[key] || {})) if (!(uid in (next[key] || {}))) entries.push([uid, {}])
    return [key, Object.fromEntries(entries)]
  }))
}

// Plugin config `fields` (code only): { "<content type or component uid>": { "<attribute>": { label, description,
// placeholder, help } } }, each text a string or { "<locale>": string }. `schemas`: uid -> attribute names.
const FIELD_TEXT = { label: 80, description: 300, placeholder: 120, help: 500 }
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const fieldText = (value, max) => typeof value === 'string' ? value.trim() !== '' && value.length <= max
  : plain(value) && Object.keys(value).length > 0 && Object.keys(value).length <= 30 && Object.entries(value).every(([locale, text]) => LOCALE.test(locale) && fieldText(text, max))
// Entries naming a uid or attribute the schema no longer has are left out and listed in `stale` (schemas change after
// the config was written); a malformed entry rejects the whole map.
function validateFields(input, schemas = {}, stale = []) {
  if (input === null || input === undefined) return {}
  if (!plain(input)) fail('fields must be an object')
  if (JSON.stringify(input).length > 256 * 1024) fail('fields config too large')
  const out = {}
  for (const [uid, entries] of Object.entries(input)) {
    if (!plain(entries)) fail(`Invalid entry for "${uid}"`)
    for (const [name, entry] of Object.entries(entries)) {
      if (!plain(entry)) fail(`Invalid entry for "${uid}.${name}"`)
      for (const [key, value] of Object.entries(entry)) {
        if (!(key in FIELD_TEXT)) fail(`Unknown field setting "${key}" of "${uid}.${name}"`)
        if (!fieldText(value, FIELD_TEXT[key])) fail(`Invalid ${key} of "${uid}.${name}": a string of 1 to ${FIELD_TEXT[key]} characters, or { "<locale>": string }`)
      }
      if (!schemas[uid]?.includes(name)) { stale.push(`${uid}.${name}`); continue }
      ;(out[uid] ||= {})[name] = structuredClone(entry)
    }
  }
  return out
}

// Plugin config `components[uid].variants` (code only): [{ id, label, values }], named presets the gallery inserts.
// `values` is a partial field map merged over the schema defaults at insert: scalar attributes (by type, enumerations
// against their values), JSON, blocks and nested components (single or repeatable, each item validated against its
// schema). A content-API shaped block (a fixture) is accepted: `id` and `__component` keys are dropped, and so are media
// and relation values (ids of another install cannot be checked here; noted at boot). Unknown attributes, passwords and
// Dynamic Zones reject the variant. Bounds: 12 variants per component, 16 KB per variant, 256 KB in all, 100 items per list.
const VARIANT = { id: /^[a-z0-9][a-z0-9_-]{0,39}$/, perComponent: 12, bytes: 16 * 1024, total: 256 * 1024, items: 100 }
const text = value => typeof value === 'string'
const finite = value => typeof value === 'number' && Number.isFinite(value)
const SCALARS = { string: text, text, richtext: text, email: text, uid: text, date: text, datetime: text, time: text, timestamp: text,
  integer: Number.isInteger, biginteger: value => Number.isInteger(value) || (text(value) && /^-?\d{1,19}$/.test(value)), float: finite, decimal: finite,
  boolean: value => typeof value === 'boolean', json: () => true, customField: () => true, blocks: Array.isArray,
  enumeration: (value, attr) => (attr.enum || []).includes(value) }
function variantValues(values, schema, schemas, path, skipped) {
  if (!plain(values)) throw new Error(`${path} must be an object`)
  const out = {}
  for (const [name, value] of Object.entries(values)) {
    if (name === 'id' || name === '__component') continue
    const attr = schema.attributes?.[name], at = `${path}.${name}`
    if (!attr) throw new Error(`${at} is not an attribute of the component`)
    if (attr.type === 'media' || attr.type === 'relation') { skipped.push(at); continue }
    if (attr.type === 'component') {
      const nested = schemas[attr.component], max = Math.min(attr.max ?? Infinity, VARIANT.items)
      if (!nested) throw new Error(`${at}: unknown component "${attr.component}"`)
      if (!attr.repeatable) out[name] = value === null ? null : variantValues(value, nested, schemas, at, skipped)
      else if (!Array.isArray(value) || value.length > max) throw new Error(`${at} must be a list of at most ${max} items`)
      else out[name] = value.map((item, index) => variantValues(item, nested, schemas, `${at}[${index}]`, skipped))
    } else if (value === null || SCALARS[attr.type]?.(value, attr)) out[name] = structuredClone(value)
    else throw new Error(`${at}: ${SCALARS[attr.type] ? `not a valid ${attr.type}` : `${attr.type} values are not supported`}`)
  }
  return out
}
// An invalid variant is left out with a note (its component keeps the valid ones); `notes` collects the boot warnings.
function validateVariants(config, schemas = {}, notes = []) {
  const out = {}
  let total = 0
  for (const [uid, entry] of Object.entries(plain(config) ? config : {})) {
    if (!plain(entry) || entry.variants === undefined) continue
    if (!schemas[uid]) { notes.push(`${uid}: unknown component`); continue }
    if (!Array.isArray(entry.variants) || entry.variants.length > VARIANT.perComponent) { notes.push(`${uid}: variants must be a list of at most ${VARIANT.perComponent}`); continue }
    const ids = new Set()
    entry.variants.forEach((variant, index) => {
      const name = `${uid} variant "${variant?.id ?? index}"`
      try {
        if (!plain(variant) || Object.keys(variant).some(key => !['id', 'label', 'values'].includes(key))) throw new Error('expected { id, label, values }')
        if (!text(variant.id) || !VARIANT.id.test(variant.id) || ids.has(variant.id)) throw new Error('id must be 1 to 40 lowercase letters, digits, "-" or "_", unique per component')
        if (!fieldText(variant.label, 60)) throw new Error('label must be a string of 1 to 60 characters, or { "<locale>": string }')
        const skipped = []
        const values = variantValues(variant.values ?? {}, schemas[uid], schemas, 'values', skipped)
        const size = JSON.stringify(values).length
        if (size > VARIANT.bytes) throw new Error(`values over ${VARIANT.bytes / 1024} KB`)
        if (total + size > VARIANT.total) throw new Error(`all variants together over ${VARIANT.total / 1024} KB`)
        if (skipped.length) notes.push(`${name}: media and relation values are not inserted (${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', ...' : ''})`)
        ids.add(variant.id)
        total += size
        ;(out[uid] ||= []).push({ id: variant.id, label: structuredClone(variant.label), values })
      } catch (error) { notes.push(`${name} ignored: ${error.message}`) }
    })
  }
  return out
}

// Per admin user gallery preferences: starred and recently used components (most recent first), existing uids only.
const PREFS = { starred: 200, recent: 20 }
function validatePrefs(input, componentUids) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Preferences must be an object')
  const out = { starred: [], recent: [] }
  for (const [key, value] of Object.entries(input)) {
    if (!(key in PREFS)) fail(`Unknown preference "${key}"`)
    if (!Array.isArray(value) || value.length > PREFS[key] || !value.every(uid => typeof uid === 'string' && componentUids.includes(uid))) fail(`Invalid value for "${key}"`)
    out[key] = [...new Set(value)]
  }
  return out
}
const mergePrefs = (saved, componentUids) => Object.fromEntries(Object.entries(PREFS).map(([key, max]) =>
  [key, Array.isArray(saved?.[key]) ? [...new Set(saved[key].filter(uid => componentUids.includes(uid)))].slice(0, max) : []]))

module.exports = { PLUGIN, HIDDEN_MODES, TEMPLATES, TYPOLOGIES, guessTypology, facetsOf, validatePrefs, mergePrefs, ICONS, DEFAULTS, catalog, validateSettings, validateFields, validateVariants, mergeSaved, layer, overrides, safeUrl, fail }
