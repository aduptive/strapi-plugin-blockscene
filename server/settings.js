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
}
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
function validateSettings(input, componentUids) {
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
  return out
}

// Lenient read: saved values that no longer apply (deleted component) are dropped.
function mergeSaved(saved, componentUids) {
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
  return out
}

module.exports = { PLUGIN, TEMPLATES, DEFAULTS, catalog, validateSettings, mergeSaved, safeUrl, fail }
