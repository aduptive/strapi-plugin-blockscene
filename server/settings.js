'use strict'

const PLUGIN = 'blockscene'
// 'none' shows a plain "no preview" placeholder instead of a wireframe (blocks that have no faithful image).
const TEMPLATES = ['generic', 'banner', 'cards', 'imageText', 'faq', 'none']
const INITIAL_STATES = ['closed', 'open', 'remember']
const PREVIEW_MODES = ['form', 'split', 'preview']
const DEFAULTS = {
  palette: { background: '#F6F6F9', surface: '#DCDCE4', text: '#32324D', accent: '#4945FF' },
  components: {},
  // previewUrl: '' means "reuse Strapi's native Preview origin when configured"; a URL overrides it.
  // blockPreviewInForm: compact read-only preview above a block's fields in form
  // mode. Only installations that ship the accordion integration (server config
  // `blockPreview: true`) show and honour it; the page preview is the editor.
  editor: { enabled: true, showOpenAll: true, showCloseAll: true, initialState: 'closed', previewMode: 'form', previewUrl: '', blockPreviewInForm: false },
  // Per content type (only the ones with a Dynamic Zone): { enabled: false } turns the plugin off there;
  // previewMode overrides editor.previewMode as the mode the edit view opens in. Absent means the global behaviour.
  contentTypes: {},
}
// Visual editor sidebar: each item opens some of the document's own fields (its native inputs) in a modal or drawer.
const ICONS = ['text', 'tag', 'seo', 'settings', 'image', 'link', 'palette', 'list', 'globe', 'info']
const SIDEBAR_POSITIONS = ['left', 'right', 'bottom']
const OPENS = ['modal', 'drawer']
const LABEL = /^[^<>]{1,40}$/
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
  sidebar: (value, attributes) => Array.isArray(value) && value.length <= 12 && value.every(item => sidebarItem(item, attributes)),
}
// contentTypes: an array of uids, or { uid: [attribute names] } to also check sidebar fields.
const typeMap = (types) => Array.isArray(types) ? Object.fromEntries(types.map(uid => [uid, null])) : (types || {})
const PREVIEW_URL = /^https?:\/\/[^\s"'<>]{1,500}$/
const COLOR = /^#[0-9A-Fa-f]{6}$/
const UID = /^[a-z0-9-]+\.[a-z0-9-]+$/

const safeUrl = (value) => typeof value === 'string' &&
  (/^\/(?!\/)/.test(value) || /^https?:\/\//.test(value)) ? value : undefined
const { safeGroups } = require('./groups')
const safeVersion = (value) => typeof value === 'string' && /^[\w.-]{1,32}$/.test(value) ? value : undefined
// Strapi maps ValidationError to 400; outside a Strapi host (unit tests) a plain error with the same name is thrown.
const fail = (message, details) => {
  let ValidationError
  try { ValidationError = require('@strapi/utils').errors.ValidationError } catch { ValidationError = class extends Error { constructor(m, d) { super(m); this.name = 'ValidationError'; this.details = d } } }
  throw new ValidationError(message, details)
}

function catalog(config = {}) {
  const entries = {}
  for (const [uid, entry] of Object.entries(config.components || {})) {
    if (!entry || typeof entry !== 'object') continue
    entries[uid] = Object.fromEntries(
      ['label', 'description', 'category', 'keywords'].filter(key => typeof entry[key] === 'string')
        .map(key => [key, entry[key]])
    )
    entries[uid].image = safeUrl(entry.image)
  }
  return { components: entries, previewBaseUrl: safeUrl(config.previewBaseUrl) || '/block-previews',
    previewVersion: safeVersion(config.previewVersion), disabled: config.disabled === true, blockPreviewAvailable: config.blockPreview === true,
    // Optional OPEN -> CLOSE map (see groups.js); null means every component is an ordinary block.
    groups: safeGroups(config.groups, config.componentUids) }
}

// Strict validation for PUT: reject instead of silently coercing.
function validateSettings(input, componentUids, contentTypeUids = []) {
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
      : key === 'previewUrl' ? value === '' || (typeof value === 'string' && PREVIEW_URL.test(value)) : typeof value === 'boolean'
    if (!valid) fail(`Invalid value for editor option "${key}"`)
    out.editor[key] = key === 'previewUrl' && value ? String(new URL(value).href).replace(/\/$/, '') : value
  }
  const components = input.components || {}
  if (typeof components !== 'object' || Array.isArray(components)) fail('components must be an object')
  for (const [uid, entry] of Object.entries(components)) {
    if (!UID.test(uid) || !componentUids.includes(uid)) fail(`Unknown component "${uid}"`)
    if (!entry || typeof entry !== 'object') fail(`Invalid entry for "${uid}"`)
    const clean = {}
    for (const key of Object.keys(entry)) {
      if (key === 'template') { if (!TEMPLATES.includes(entry.template)) fail(`Unknown template for "${uid}"`); clean.template = entry.template }
      else if (key === 'mediaId') { if (!Number.isInteger(entry.mediaId) || entry.mediaId <= 0) fail(`Invalid media for "${uid}"`); clean.mediaId = entry.mediaId }
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
    if (Object.keys(entry).length) out.contentTypes[uid] = structuredClone(entry)
  }
  return out
}

// Lenient read: saved values that no longer apply (deleted component) are dropped.
function mergeSaved(saved, componentUids, contentTypeUids = []) {
  const types = typeMap(contentTypeUids)
  const out = structuredClone(DEFAULTS)
  if (!saved || typeof saved !== 'object') return out
  for (const key of Object.keys(DEFAULTS.palette)) if (COLOR.test(String(saved.palette?.[key]))) out.palette[key] = saved.palette[key]
  for (const key of Object.keys(DEFAULTS.editor)) {
    const value = saved.editor?.[key]
    if (value === undefined || typeof value !== typeof DEFAULTS.editor[key]) continue
    if (key === 'initialState' && !INITIAL_STATES.includes(value)) continue
    if (key === 'previewMode' && !PREVIEW_MODES.includes(value)) continue
    if (key === 'previewUrl' && value && !PREVIEW_URL.test(value)) continue
    out.editor[key] = value
  }
  for (const [uid, entry] of Object.entries(saved.components || {})) if (componentUids.includes(uid) && entry && typeof entry === 'object') out.components[uid] = { ...entry }
  for (const [uid, entry] of Object.entries(saved.contentTypes || {})) {
    if (!(uid in types) || !entry || typeof entry !== 'object') continue
    // A sidebar naming a field that no longer exists keeps its other items.
    const fix = (key, value) => key === 'sidebar' && Array.isArray(value) ? value.filter(item => sidebarItem(item, types[uid])) : value
    const clean = Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, fix(key, value)]).filter(([key, value]) => TYPE_KEYS[key]?.(value, types[uid])))
    if (Object.keys(clean).length) out.contentTypes[uid] = clean
  }
  return out
}

module.exports = { PLUGIN, TEMPLATES, ICONS, DEFAULTS, catalog, validateSettings, mergeSaved, safeUrl, fail }
