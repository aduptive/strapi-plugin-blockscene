'use strict'

const CUSTOM_FIELD = 'plugin::blockscene.text-template'
const TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']
const ROLES = ['eyebrow', 'title', 'description', 'body']
const MODIFIERS = ['uppercase', 'lowercase', 'underline']
const ID = /^[a-z][a-z0-9_-]{0,47}$/
const TOKEN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
const MAX_ENTRIES = 24
const MAX_TEXT = 50000
const BINDING = /^[a-z][a-z0-9_-]*(?:::[a-z][a-z0-9_-]*)?(?:\.[a-z][a-z0-9_-]*)+$/

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const codePoints = value => [...String(value || '')].length
const cleanLineBreaks = value => String(value || '').replace(/\r\n?/g, '\n')

function templateError(message) {
  const error = new Error(message)
  error.name = 'ValidationError'
  throw error
}

function validateTemplate(value) {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) templateError(`Text template must contain at most ${MAX_ENTRIES} entries`)
  const ids = new Set()
  return value.map((raw, index) => {
    if (!plain(raw)) templateError(`Text template entry ${index + 1} must be an object`)
    const allowed = ['id', 'label', 'role', 'tag', 'token', 'modifiers', 'required', 'allowBreaks', 'softLines', 'maxChars', 'demo']
    for (const key of Object.keys(raw)) if (!allowed.includes(key)) templateError(`Unknown text template option "${key}"`)
    if (typeof raw.id !== 'string' || !ID.test(raw.id) || ids.has(raw.id)) templateError(`Invalid or duplicate text template id "${raw.id}"`)
    ids.add(raw.id)
    if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 80) templateError(`Invalid label for text template entry "${raw.id}"`)
    if (!ROLES.includes(raw.role)) templateError(`Invalid role for text template entry "${raw.id}"`)
    if (!TAGS.includes(raw.tag)) templateError(`Invalid Tag HTML for text template entry "${raw.id}"`)
    if (raw.token !== undefined && (typeof raw.token !== 'string' || (raw.token && !TOKEN.test(raw.token)))) templateError(`Invalid style token for text template entry "${raw.id}"`)
    if (!Array.isArray(raw.modifiers) || raw.modifiers.some(item => !MODIFIERS.includes(item)) || new Set(raw.modifiers).size !== raw.modifiers.length || (raw.modifiers.includes('uppercase') && raw.modifiers.includes('lowercase'))) templateError(`Invalid modifiers for text template entry "${raw.id}"`)
    if (typeof raw.required !== 'boolean' || typeof raw.allowBreaks !== 'boolean') templateError(`Invalid rules for text template entry "${raw.id}"`)
    if (raw.softLines !== undefined && (!Number.isInteger(raw.softLines) || raw.softLines < 1 || raw.softLines > 20)) templateError(`Invalid line guidance for text template entry "${raw.id}"`)
    if (raw.maxChars !== undefined && (!Number.isInteger(raw.maxChars) || raw.maxChars < 1 || raw.maxChars > MAX_TEXT)) templateError(`Invalid character limit for text template entry "${raw.id}"`)
    if (typeof raw.demo !== 'string' || codePoints(raw.demo) > MAX_TEXT) templateError(`Invalid demo text for text template entry "${raw.id}"`)
    if (!raw.allowBreaks && /[\r\n]/.test(raw.demo)) templateError(`Demo text for "${raw.id}" cannot contain line breaks`)
    if (raw.maxChars && codePoints(raw.demo) > raw.maxChars) templateError(`Demo text for "${raw.id}" exceeds its character limit`)
    return { id: raw.id, label: raw.label.trim(), role: raw.role, tag: raw.tag, token: raw.token || '', modifiers: [...raw.modifiers], required: raw.required,
      allowBreaks: raw.allowBreaks, ...(raw.softLines && { softLines: raw.softLines }), ...(raw.maxChars && { maxChars: raw.maxChars }), demo: cleanLineBreaks(raw.demo) }
  })
}

function normalizeValue(value) {
  if (value == null) return { version: 1, values: {} }
  if (!plain(value) || value.version !== 1 || !plain(value.values)) templateError('Text template value must be { version: 1, values: { ... } }')
  if (Object.keys(value.values).length > 100) templateError('Text template value has too many entries')
  const values = {}
  for (const [id, text] of Object.entries(value.values)) {
    if (!ID.test(id) || typeof text !== 'string' || codePoints(text) > MAX_TEXT) templateError(`Invalid text template value for "${id}"`)
    values[id] = cleanLineBreaks(text)
  }
  return { version: 1, values }
}

function validateValue(template, value) {
  const entries = validateTemplate(template)
  const normalized = normalizeValue(value)
  const errors = []
  for (const entry of entries) {
    const text = normalized.values[entry.id] || ''
    if (entry.required && !text.trim()) errors.push({ id: entry.id, code: 'required', message: `${entry.label} is required` })
    if (!entry.allowBreaks && /\n/.test(text)) errors.push({ id: entry.id, code: 'lineBreak', message: `${entry.label} does not allow line breaks` })
    if (entry.maxChars && codePoints(text) > entry.maxChars) errors.push({ id: entry.id, code: 'maxChars', message: `${entry.label} exceeds ${entry.maxChars} characters` })
  }
  return { value: normalized, errors }
}

function demoValue(template) {
  return { version: 1, values: Object.fromEntries(validateTemplate(template).map(entry => [entry.id, entry.demo])) }
}

function renderTextTemplate(template, value) {
  const entries = validateTemplate(template)
  const normalized = normalizeValue(value)
  return entries.flatMap(entry => {
    const text = normalized.values[entry.id] || ''
    if (!text.trim()) return []
    return [{ id: entry.id, tag: entry.tag, text, lines: text.split('\n'), className: [entry.token, ...entry.modifiers].filter(Boolean).join(' ') }]
  })
}

function renderTextTemplateElement(part, createElement) {
  if (!plain(part) || !TAGS.includes(part.tag) || typeof part.text !== 'string' || typeof createElement !== 'function') templateError('Invalid projected text template part')
  const children = part.text.split('\n').flatMap((line, index) => index ? [createElement('br', { key: `${part.id}-break-${index}` }), line] : [line])
  return createElement(part.tag, { key: part.id, className: part.className || undefined }, ...children)
}

function binding(uid, name) { return `${uid}.${name}` }
function isTextTemplateBinding(value) { return typeof value === 'string' && BINDING.test(value) }
function resolveBinding(attribute, contentTypeUID, name) {
  const explicit = attribute?.options?.blockscene?.textTemplate || attribute?.pluginOptions?.blockscene?.textTemplate
  if (isTextTemplateBinding(explicit)) return explicit
  return typeof contentTypeUID === 'string' && contentTypeUID ? binding(contentTypeUID, String(name || '').split('.').pop()) : ''
}
function createEntryId(entries, values, nonce) {
  const used = new Set([...entries.map(entry => entry.id), ...Object.keys(values || {})])
  const safe = String(nonce || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)
  const base = `text-${safe || Date.now().toString(36)}`
  let id = base, suffix = 2
  while (used.has(id)) id = `${base}-${suffix++}`
  return id
}
function applyTextChange(entry, current, next, { composing = false, compositionStart = current } = {}) {
  const value = entry.allowBreaks ? cleanLineBreaks(next) : String(next || '').replace(/[\r\n]+/g, ' ')
  if (entry.maxChars && codePoints(value) > entry.maxChars && !composing) return { accepted: false, value: compositionStart, code: 'maxChars' }
  return { accepted: true, value }
}
function mergePartialDocument(stored, patch) { return { ...(plain(stored) ? stored : {}), ...(plain(patch) ? patch : {}) } }
// Schema files use `type: customField`; Strapi's runtime model exposes the registered underlying JSON type.
// The namespaced customField id is the stable discriminator in both representations.
function isTextTemplate(attr) { return attr?.customField === CUSTOM_FIELD }

function textTemplateBindings(schemas) {
  const bindings = new Set()
  for (const [uid, schema] of Object.entries(schemas || {})) {
    for (const [name, attribute] of Object.entries(schema?.attributes || {})) {
      if (!isTextTemplate(attribute)) continue
      const key = resolveBinding(attribute, uid, name)
      if (key) bindings.add(key)
    }
  }
  return bindings
}

function validateDocument(schemas, uid, data, templates, path = []) {
  if (!plain(data)) return []
  const schema = schemas?.[uid]
  if (!schema) return []
  const errors = []
  for (const [name, attr] of Object.entries(schema.attributes || {})) {
    const here = [...path, name]
    if (isTextTemplate(attr)) {
      const template = templates?.[resolveBinding(attr, uid, name)]
      if (!template) continue
      let result
      try { result = validateValue(template, data[name]) }
      catch (error) { errors.push({ path: here, code: 'invalid', message: error.message }); continue }
      errors.push(...result.errors.map(error => ({ ...error, path: [...here, error.id] })))
    } else if (!(name in data)) continue
    else if (attr?.type === 'component') {
      const list = attr.repeatable ? data[name] : [data[name]]
      if (Array.isArray(list)) list.forEach((item, index) => errors.push(...validateDocument(schemas, attr.component, item, templates, attr.repeatable ? [...here, index] : here)))
    } else if (attr?.type === 'dynamiczone' && Array.isArray(data[name])) {
      data[name].forEach((item, index) => errors.push(...validateDocument(schemas, item?.__component, item, templates, [...here, index])))
    }
  }
  return errors
}

function textTemplatePopulate(schemas, uid, templates) {
  const active = new Set(Object.keys(templates || {}))
  const walk = (schemaUid, seen = new Set()) => {
    if (seen.has(schemaUid)) return { configured: false, populate: {} }
    const next = new Set(seen).add(schemaUid)
    let configured = false
    const populate = {}
    for (const [name, attr] of Object.entries(schemas?.[schemaUid]?.attributes || {})) {
      if (isTextTemplate(attr) && active.has(resolveBinding(attr, schemaUid, name))) configured = true
      else if (attr?.type === 'component') {
        const child = walk(attr.component, next)
        if (child.configured) { populate[name] = Object.keys(child.populate).length ? { populate: child.populate } : true; configured = true }
      } else if (attr?.type === 'dynamiczone') {
        const children = (attr.components || []).map(component => [component, walk(component, next)]).filter(([, child]) => child.configured)
        if (children.length) {
          populate[name] = { on: Object.fromEntries(children.map(([component, child]) => [component,
            Object.keys(child.populate).length ? { populate: child.populate } : {}])) }
          configured = true
        }
      }
    }
    return { configured, populate }
  }
  const result = walk(uid)
  return result.configured ? result.populate : null
}

module.exports = { CUSTOM_FIELD, TAGS, ROLES, MODIFIERS, MAX_ENTRIES, codePoints, validateTemplate, normalizeValue, validateValue, demoValue, renderTextTemplate, renderTextTemplateElement, binding, isTextTemplateBinding, resolveBinding, createEntryId, applyTextChange, mergePartialDocument, isTextTemplate, textTemplateBindings, validateDocument, textTemplatePopulate }
