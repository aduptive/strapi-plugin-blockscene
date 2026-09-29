'use strict'

// "Hide on the site": a boolean attribute added at register time to every component used in a Dynamic Zone (the way
// i18n adds `locale`), toggled by the row eye icon and never rendered as an input (the admin's edit-layout hook removes it).
// It stays `visible` to the Content Manager: before 5.45 its edit view crashes on a data key missing from the schema. In `strip` mode a
// document service middleware (Strapi 5) or an entity service decorator (Strapi 4) drops hidden rows from Dynamic
// Zones in content-API reads only; admin reads always see every row. One file for the server and the unit tests.

const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/
const DEFAULT_NAME = 'bsHidden'
// Plugin config `hiddenAttribute`: a name, or false to add nothing. Anything else is ignored (null) with a warning.
const hiddenName = (value) => value === undefined ? DEFAULT_NAME : value === false ? false : typeof value === 'string' && NAME.test(value) ? value : null

const zoneComponents = (contentTypes) => [...new Set(Object.values(contentTypes || {}).flatMap(schema =>
  Object.values(schema?.attributes || {}).filter(attr => attr?.type === 'dynamiczone').flatMap(attr => attr.components || [])))]

// Adds the attribute; returns { added, skipped } (skipped: an attribute of that name with another type already exists).
function injectHidden(components, contentTypes, name) {
  const added = [], skipped = []
  for (const uid of zoneComponents(contentTypes)) {
    const schema = components?.[uid]
    if (!schema) continue
    schema.attributes ||= {}
    const current = schema.attributes[name]
    if (current && current.type !== 'boolean') { skipped.push(uid); continue }
    if (!current) schema.attributes[name] = { type: 'boolean', default: false, configurable: false }
    added.push(uid)
  }
  return { added, skipped }
}

// Keeps the attribute out of what the Content-Type Builder reads, so its UI never sends it back on save and it is never
// written to a component file. i18n's `locale` stays out the same way, through `visible: false` (the builder lists only
// visible attributes), but that flag also removes it from the Content Manager's schema, which crashes before 5.45.
// The builder keeps what it does not see: on save it replaces only configurable attributes, and a file that already has
// the attribute (`configurable: false`, as the builder wrote it) keeps it untouched. Wraps, through the services
// registry's `extend`, `components.formatComponent` (GET /components, what the builder UI reads on Strapi 4 and 5.0) and
// `schema.getSchema` (GET /schema, what it reads on later 5.x); a service that does not exist is skipped.
// `uids`: the components that have it.
function hideFromBuilder(services, uids, name) {
  const has = new Set(uids)
  const drop = (attributes) => Array.isArray(attributes) ? attributes.filter(attr => attr?.name !== name)
    : attributes && typeof attributes === 'object' ? Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== name)) : attributes
  const extend = (uid, wrap) => { if (services?.get?.(uid)) services.extend(uid, wrap) }
  extend('plugin::content-type-builder.components', (service) => ({ ...service, formatComponent(component, ...rest) {
    const out = service.formatComponent(component, ...rest)
    return has.has(component?.uid) && out?.schema ? { ...out, schema: { ...out.schema, attributes: drop(out.schema.attributes) } } : out
  } }))
  extend('plugin::content-type-builder.schema', (service) => ({ ...service, async getSchema(...args) {
    const out = await service.getSchema(...args)
    for (const uid of has) if (out?.components?.[uid]) out.components[uid] = { ...out.components[uid], attributes: drop(out.components[uid].attributes) }
    return out
  } }))
}

// Removes Dynamic Zone rows whose `name` is true, recursively through components and populated relations (a related
// document's zones are stripped too). Mutates and returns `data`. `schemaOf(uid)` gives a content type or component.
function stripHidden(data, schema, schemaOf, name, depth = 0) {
  if (!data || typeof data !== 'object' || !schema || depth > 20) return data
  if (Array.isArray(data)) { data.forEach(item => stripHidden(item, schema, schemaOf, name, depth)); return data }
  const walk = (value, target) => Array.isArray(value) ? value.forEach(item => stripHidden(item, target, schemaOf, name, depth + 1)) : stripHidden(value, target, schemaOf, name, depth + 1)
  for (const [key, attr] of Object.entries(schema.attributes || {})) {
    const value = data[key]
    if (value == null || typeof value !== 'object') continue
    if (attr?.type === 'dynamiczone' && Array.isArray(value)) {
      data[key] = value.filter(row => !(row && row[name] === true))
      for (const row of data[key]) stripHidden(row, schemaOf(row?.__component), schemaOf, name, depth + 1)
    } else if (attr?.type === 'component') walk(value, schemaOf(attr.component))
    else if (attr?.type === 'relation' && attr.target) walk(value, schemaOf(attr.target))
  }
  return data
}

// Content-API requests only: the route of the current request says so (admin and internal calls are never touched).
const contentApi = (strapi) => { try { return strapi.requestContext?.get?.()?.state?.route?.info?.type === 'content-api' } catch { return false } }
const READS = ['findMany', 'findOne', 'findFirst']
function registerHiddenStrip(strapi, name, plugin) {
  if (!name) return
  const schemaOf = (uid) => uid && (strapi.getModel?.(uid) || strapi.components?.[uid] || strapi.contentTypes?.[uid])
  // One settings read per content-API document read; the mode is changed in Settings without a restart.
  const stripping = async () => { try { return (await plugin.service('settings').get()).editor.hiddenBlocks === 'strip' } catch { return true } }
  const apply = async (uid, result) => result && contentApi(strapi) && await stripping() ? stripHidden(result, schemaOf(uid), schemaOf, name) : result
  if (strapi.documents?.use) {
    strapi.documents.use(async (ctx, next) => {
      const result = await next()
      return READS.includes(ctx.action) ? apply(ctx.uid, result) : result
    })
    return
  }
  // Strapi 4: the REST and GraphQL core services read through the entity service.
  strapi.entityService?.decorate?.((service) => ({
    async findMany(uid, params) { return apply(uid, await service.findMany(uid, params)) },
    async findOne(uid, id, params) { return apply(uid, await service.findOne(uid, id, params)) },
    async findPage(uid, params) { const page = await service.findPage(uid, params); if (page?.results) await apply(uid, page.results); return page },
  }))
}

module.exports = { DEFAULT_NAME, hiddenName, zoneComponents, injectHidden, hideFromBuilder, stripHidden, registerHiddenStrip }
