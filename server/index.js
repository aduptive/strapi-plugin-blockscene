'use strict'

const { PLUGIN, TEMPLATES, TYPOLOGIES, DEFAULTS, catalog, validateSettings, validateFields, validateVariants, schemaMetadata, mergeSaved, layer, overrides, validatePrefs, mergePrefs, safeUrl, fail } = require('./settings')
const { safeGroups, validateGroups, layoutFields } = require('./groups')
const { hiddenName, injectHidden, registerHiddenStrip } = require('./hidden')
const { CRON, covers, eventContentType, historyService, historyController, registerHistory, registerPurge } = require('./history')
const { trashContentType, trashService, trashController } = require('./trash')
// Set at build time for the Strapi 4 package; from source (tests) it is Strapi 5. Version history is Strapi 5 only.
const STRAPI5 = process.env.BLOCKSCENE_STRAPI_MAJOR !== '4'

const store = (strapi) => strapi.store({ type: 'plugin', name: PLUGIN })
// Settings saved by the plugin under its previous id ("block-picker", alphas before the rename) are copied once.
const LEGACY_PLUGIN = 'block-picker'
async function readSettings(strapi) {
  const current = await store(strapi).get({ key: 'settings' })
  if (current) return current
  const legacy = await strapi.store({ type: 'plugin', name: LEGACY_PLUGIN }).get({ key: 'settings' })
  if (legacy) { await store(strapi).set({ key: 'settings', value: legacy }); strapi.log.info(`[${PLUGIN}] settings migrated from "${LEGACY_PLUGIN}"`) }
  return legacy
}
const componentUids = (strapi) => Object.keys(strapi.components || {})
const findMedia = (strapi, id) => strapi.db.query('plugin::upload.file').findOne({ where: { id }, select: ['id', 'url', 'mime', 'name'] })

async function resolveMedia(strapi, settings) {
  const resolved = {}
  for (const [uid, entry] of Object.entries(settings.components)) {
    if (!entry.mediaId) continue
    const file = await findMedia(strapi, entry.mediaId).catch(() => null)
    resolved[uid] = file && safeUrl(file.url) && String(file.mime || '').startsWith('image/') ? { manualImage: file.url, manualName: file.name } : { manualMissing: true }
  }
  return resolved
}

// Content types the plugin can act on: the project's own types that have a Dynamic Zone.
// uid -> its attribute names (sidebar items may only name fields of their own type).
const contentTypeUids = (strapi) => Object.fromEntries(Object.entries(strapi.contentTypes || {})
  .filter(([uid, schema]) => uid.startsWith('api::') && zonesOf(schema).length)
  .map(([uid, schema]) => [uid, Object.keys(schema.attributes || {})]))
// Every project content type: what version history may cover (with or without a Dynamic Zone).
const apiUids = (strapi) => Object.keys(strapi.contentTypes || {}).filter(uid => uid.startsWith('api::'))
const zonesOf = (schema) => Object.entries(schema?.attributes || {}).filter(([, attr]) => attr?.type === 'dynamiczone').map(([name]) => name)
const label = (error) => `row ${error.index + 1}: ${error.code === 'closeBeforeOpen' ? `close marker ${error.uid} has no open marker before it` :
  error.code === 'mismatch' ? `close marker ${error.uid} does not match the open group ${error.open} (expected ${error.expected})` : `group ${error.uid} is not closed (expected ${error.expected})`}`
// Publishing is refused while a configured pair is unbalanced. Drafts are still saved so the editor can repair them; nothing is rewritten here.
function checkZones(strapi, uid, entry, groups) {
  for (const name of zonesOf(strapi.getModel(uid))) {
    const errors = validateGroups(Array.isArray(entry?.[name]) ? entry[name] : [], groups)
    // Strapi's admin formats `details.errors[{ path, message }]` onto the form (row-level), so the shape follows the core validation errors.
    if (errors.length) fail(`Block groups in "${name}" are not balanced; fix the markers before publishing (${errors.map(label).join('; ')}).`,
      { plugin: PLUGIN, field: name, errors: errors.map(error => ({ path: [name, error.index], message: label(error), name: 'ValidationError', code: error.code, uid: error.uid, expected: error.expected })) })
  }
}
function registerPublishGuard(strapi) {
  const plugin = strapi.plugin(PLUGIN)
  const groups = safeGroups(plugin.config('groups'), componentUids(strapi))
  if (plugin.config('groups') && !groups) strapi.log.warn(`[${PLUGIN}] "groups" config ignored: expected { "<open component uid>": "<close component uid>" } with existing components; every block is treated as ordinary.`)
  if (!groups) return
  // The guard follows the same switches as the editor: the env/config bypass, the Settings on/off and the per-type
  // off. Read on every publish (one store read), so turning the plugin off in the panel takes effect at once.
  const active = async (uid) => {
    if (plugin.config('disabled') === true) return false
    const settings = await plugin.service('settings').get()
    return settings.editor.enabled && settings.contentTypes?.[uid]?.enabled !== false
  }
  if (strapi.documents?.use) {
    // Strapi 5. Every publish path of the document service goes through the facade: `publish`, and `create`/`update`
    // with `status: 'published'` (the repository then calls its internal publish, which never re-enters this
    // middleware, so both are intercepted here). Admin Publish, bulk publish, REST and custom code using
    // `strapi.documents` are covered; direct `strapi.db.query` writes are not. The rows checked are the ones the
    // request publishes: the data being written (create/update) or the stored draft(s) of the exact target
    // locale(s): the requested locale, every locale for '*', the default locale when none is given (the same
    // resolution the repository applies). The check runs before the repository's own work, not inside its
    // transaction: a concurrent draft update between the check and the publish is not covered.
    const defaultLocale = async () => { try { return await strapi.plugin('i18n')?.service('locales')?.getDefaultLocale?.() } catch { return undefined } }
    strapi.documents.use(async (ctx, next) => {
      const { action, params = {} } = ctx
      const publishing = action === 'publish' || ((action === 'create' || action === 'update') && params.status === 'published')
      if (!publishing || !ctx.uid) return next()
      const model = strapi.getModel(ctx.uid)
      const zones = zonesOf(model)
      if (!zones.length || !(await active(ctx.uid))) return next()
      if (action === 'create') { checkZones(strapi, ctx.uid, params.data || {}, groups); return next() }
      const populate = Object.fromEntries(zones.map(name => [name, true]))
      const localized = Boolean(model?.pluginOptions?.i18n?.localized)
      const { documentId } = params
      let drafts
      if (!localized) drafts = [await strapi.documents(ctx.uid).findOne({ documentId, status: 'draft', populate })]
      else if (params.locale === '*') drafts = await strapi.documents(ctx.uid).findMany({ filters: { documentId }, status: 'draft', locale: '*', populate })
      else {
        const locale = params.locale || await defaultLocale()
        drafts = [await strapi.documents(ctx.uid).findOne({ documentId, locale, status: 'draft', populate })]
      }
      for (const draft of drafts) {
        // update: the rows being written win over the stored draft, zone by zone
        const entry = action === 'update' ? { ...(draft || {}), ...Object.fromEntries(zones.filter(name => Array.isArray(params.data?.[name])).map(name => [name, params.data[name]])) } : draft
        checkZones(strapi, ctx.uid, entry, groups)
      }
      return next()
    })
    return
  }
  // Strapi 4: publishing sets publishedAt through entityService.update/create (admin, REST) or db updateMany (bulk publish).
  const published = (data) => Boolean(data && data.publishedAt)
  strapi.db.lifecycles.subscribe({
    async beforeCreate(event) { if (published(event.params?.data) && await active(event.model.uid)) checkZones(strapi, event.model.uid, event.params.data, groups) },
    async beforeUpdate(event) {
      const { data, where } = event.params || {}
      const zones = zonesOf(strapi.getModel(event.model.uid))
      if (!published(data) || !zones.length || !(await active(event.model.uid))) return
      const entry = zones.every(name => Array.isArray(data[name])) ? data : { ...(await strapi.entityService.findOne(event.model.uid, where?.id, { populate: zones })), ...data }
      checkZones(strapi, event.model.uid, entry, groups)
    },
    async beforeUpdateMany(event) {
      const { data, where } = event.params || {}
      const zones = zonesOf(strapi.getModel(event.model.uid))
      if (!published(data) || !zones.length || !(await active(event.model.uid))) return
      for (const entry of await strapi.entityService.findMany(event.model.uid, { filters: where, populate: zones })) checkZones(strapi, event.model.uid, entry, groups)
    },
  })
}

module.exports = {
  config: {
    default: { components: {}, previewBaseUrl: '/block-previews', previewVersion: undefined,
      // Emergency bypass read once at boot: BLOCKSCENE_DISABLED=true forces the native editor. Restart to change.
      disabled: process.env.BLOCKSCENE_DISABLED === 'true',
      // true only where the Content Manager ships the per-block preview slot (see docs).
      blockPreview: false,
      // Optional layout groups: OPEN component uid -> its CLOSE uid, e.g. { 'wrappers.join': 'wrappers.close' }.
      // Empty/absent: every Dynamic Zone component is an ordinary block. See README "Layout groups".
      groups: null,
      // Project defaults from code: same shape as the stored settings, e.g. require('./blockscene.json'). See README "Settings page".
      settings: null,
      // Edit view field texts from code (never stored): { uid: { attribute: { label, description, placeholder } } }. See README "Field labels".
      fields: null,
      // Other languages for the schema metadata (pluginOptions.blockscene, info.description), one flat map per locale:
      // { 'pt-BR': require('./blockscene/pt-BR.json') }. See README "Describing blocks and fields in the schema".
      translations: null,
      // "Hide on the site": boolean attribute added to every Dynamic Zone component (a DB column); false adds nothing.
      hiddenAttribute: 'bsHidden' },
    validator: catalog,
  },
  // Before the database schema sync, so the column exists. A name the host already uses with another type is skipped.
  register({ strapi }) {
    const plugin = strapi.plugin(PLUGIN)
    const name = hiddenName(plugin.config('hiddenAttribute'))
    if (name === null) strapi.log.warn(`[${PLUGIN}] "hiddenAttribute" config ignored: expected a name like "bsHidden" or false. Hiding blocks is off.`)
    if (!name) return
    const { skipped } = injectHidden(strapi.components, strapi.contentTypes, name)
    if (skipped.length) strapi.log.warn(`[${PLUGIN}] "${name}" already exists with another type on ${skipped.join(', ')}; those blocks cannot be hidden.`)
  },
  async bootstrap({ strapi }) {
    await strapi.admin.services.permission.actionProvider.registerMany([
      { section: 'plugins', displayName: 'Read gallery settings', uid: 'settings.read', pluginName: PLUGIN },
      { section: 'plugins', displayName: 'Change gallery settings', uid: 'settings.update', pluginName: PLUGIN },
      ...(STRAPI5 ? [['history.read', 'Read version history'], ['activity.read', 'Read content activity'], ['trash.read', 'Read the trash'],
        ['trash.restore', 'Restore from the trash'], ['trash.purge', 'Delete from the trash forever']].map(([uid, displayName]) => ({ section: 'plugins', displayName, uid, pluginName: PLUGIN })) : []),
    ])
    strapi.plugin(PLUGIN).service('settings').projectDefaults()
    strapi.plugin(PLUGIN).service('settings').fields()
    strapi.plugin(PLUGIN).service('settings').variants()
    registerPublishGuard(strapi)
    registerHiddenStrip(strapi, hiddenName(strapi.plugin(PLUGIN).config('hiddenAttribute')), strapi.plugin(PLUGIN))
    if (STRAPI5) { registerHistory(strapi); registerPurge(strapi) }
  },
  destroy({ strapi }) { if (STRAPI5) strapi.cron?.remove?.(CRON) },
  // Version history events and the trash (Strapi 5): hidden from the Content Manager and the Content-Type Builder.
  contentTypes: STRAPI5 ? { event: eventContentType, trash: trashContentType } : {},
  services: { settings: ({ strapi }) => {
    // Code settings (plugin config `settings`): validated once, strictly; invalid ones are ignored with a warning.
    let project
    const projectDefaults = () => {
      if (project !== undefined) return project
      const code = strapi.plugin(PLUGIN).config('settings')
      project = null
      if (code) try { project = validateSettings(code, componentUids(strapi), contentTypeUids(strapi), apiUids(strapi), strapi.components) }
      catch (error) { strapi.log?.warn(`[${PLUGIN}] "settings" config ignored: ${error.message}. Using the built-in defaults under the saved settings.`) }
      return project
    }
    // Schema metadata (pluginOptions.blockscene, info.description) with the `translations` config: read once, one warning for what is left out.
    let meta
    const schemaMeta = () => {
      if (meta !== undefined) return meta
      const notes = []
      meta = schemaMetadata({ ...strapi.contentTypes, ...strapi.components }, strapi.plugin(PLUGIN).config('translations'), notes)
      if (notes.length) strapi.log?.warn(`[${PLUGIN}] schema metadata left out: ${notes.slice(0, 20).join('; ')}${notes.length > 20 ? `; and ${notes.length - 20} more` : ''}.`)
      return meta
    }
    // Code field texts (plugin config `fields`): validated once; a malformed map is ignored and stale entries skipped, with a warning.
    // Each code text wins over the schema metadata's text of the same key.
    let fields
    const fieldTexts = () => {
      if (fields !== undefined) return fields
      const schemas = Object.fromEntries(Object.entries({ ...strapi.contentTypes, ...strapi.components }).map(([uid, schema]) => [uid, Object.keys(schema?.attributes || {})]))
      const stale = []
      let code = {}
      try { code = validateFields(strapi.plugin(PLUGIN).config('fields'), schemas, stale) }
      catch (error) { strapi.log?.warn(`[${PLUGIN}] "fields" config ignored: ${error.message}. Field labels fall back to the schema metadata and the Content Manager's own.`) }
      if (stale.length) strapi.log?.warn(`[${PLUGIN}] "fields" entries for fields the schema no longer has were skipped: ${stale.slice(0, 20).join(', ')}${stale.length > 20 ? ` and ${stale.length - 20} more` : ''}.`)
      fields = structuredClone(schemaMeta().fields)
      for (const [uid, entries] of Object.entries(code)) for (const [name, entry] of Object.entries(entries)) (fields[uid] ||= {})[name] = { ...fields[uid][name], ...entry }
      return fields
    }
    // Insert variants (plugin config `components[uid].variants`): validated once against the schemas; what is left out is warned about.
    let variants
    const insertVariants = () => {
      if (variants !== undefined) return variants
      const notes = []
      variants = validateVariants(strapi.plugin(PLUGIN).config('components'), strapi.components || {}, notes)
      for (const note of notes) strapi.log?.warn(`[${PLUGIN}] components variants: ${note}.`)
      return variants
    }
    const get = async () => mergeSaved(layer(projectDefaults(), await readSettings(strapi)), componentUids(strapi), contentTypeUids(strapi), apiUids(strapi), strapi.components)
    return {
      projectDefaults, get, fields: fieldTexts, schema: schemaMeta, variants: insertVariants,
      async set(value) {
        const next = validateSettings(value, componentUids(strapi), contentTypeUids(strapi), apiUids(strapi), strapi.components)
        for (const [uid, entry] of Object.entries(next.components)) {
          if (entry.mediaId && !(await findMedia(strapi, entry.mediaId).catch(() => null))) fail(`Media for "${uid}" does not exist`)
        }
        await store(strapi).set({ key: 'settings', value: overrides(next, projectDefaults()) })
        return next
      },
      // Back to the project defaults (or the built-in ones); the legacy copy goes too, or it would be migrated again.
      async reset() {
        await store(strapi).delete({ key: 'settings' })
        await strapi.store({ type: 'plugin', name: LEGACY_PLUGIN }).delete({ key: 'settings' })
        return get()
      },
    }
  }, ...(STRAPI5 && { history: historyService, trash: trashService }) },
  controllers: {
    catalog: ({ strapi }) => ({
      async find(ctx) {
        const plugin = strapi.plugin(PLUGIN)
        const base = catalog({ components: plugin.config('components'), previewBaseUrl: plugin.config('previewBaseUrl'),
          previewVersion: plugin.config('previewVersion'), disabled: plugin.config('disabled'), blockPreview: plugin.config('blockPreview'),
          groups: plugin.config('groups'), componentUids: componentUids(strapi), schemas: strapi.components, blocks: plugin.service('settings').schema().blocks })
        const settings = await plugin.service('settings').get()
        const media = await resolveMedia(strapi, settings)
        for (const [uid, list] of Object.entries(plugin.service('settings').variants())) base.components[uid] = { ...base.components[uid], variants: list }
        for (const [uid, entry] of Object.entries(settings.components)) {
          base.components[uid] = { ...base.components[uid], ...media[uid], template: entry.template,
            ...(entry.typology && { typology: entry.typology }), ...(entry.tags && { tags: entry.tags }) }
        }
        const hidden = hiddenName(plugin.config('hiddenAttribute')) || null
        // types: what the Strapi 5 layout hook matches an edit layout against (it receives no model uid).
        const types = Object.fromEntries(Object.entries(strapi.contentTypes || {}).filter(([uid]) => !uid.startsWith('admin::'))
          .map(([uid, schema]) => [uid, [schema.info?.displayName || '', ...Object.keys(schema.attributes || {})]]))
        // history: the content types whose versions are captured (Strapi 5, module on and not bypassed), else null.
        const history = STRAPI5 && strapi.documents?.use && !base.disabled && settings.history.enabled ? { contentTypes: apiUids(strapi).filter(uid => covers(settings.history, uid)) } : null
        // Layout grids of the configured OPENs (a layout on any other component does nothing).
        const layouts = Object.fromEntries(Object.entries(settings.components).filter(([uid, entry]) => entry.layout && base.groups?.[uid]).map(([uid, entry]) => [uid, entry.layout]))
        ctx.body = { ...base, layouts, palette: settings.palette, contentTypes: settings.contentTypes, hiddenAttribute: hidden, fields: plugin.service('settings').fields(), types, history,
          editor: { ...settings.editor, enabled: settings.editor.enabled && !base.disabled, ...(!hidden && { hiddenBlocks: 'off' }) } }
      },
    }),
    settings: ({ strapi }) => ({
      async find(ctx) {
        const settings = await strapi.plugin(PLUGIN).service('settings').get()
        // typology: the value without a Settings override (code config, else the guess), shown as "Automatic".
        const auto = catalog({ components: strapi.plugin(PLUGIN).config('components'), schemas: strapi.components, blocks: strapi.plugin(PLUGIN).service('settings').schema().blocks }).components
        const components = Object.entries(strapi.components || {}).map(([uid, schema]) => ({ uid,
          displayName: schema.info?.displayName || uid, category: schema.category || uid.split('.')[0], typology: auto[uid]?.typology,
          layoutFields: layoutFields(schema) }))
        const contentTypes = Object.keys(contentTypeUids(strapi)).map(uid => ({ uid, displayName: strapi.contentTypes[uid].info?.displayName || uid, kind: strapi.contentTypes[uid].kind,
          attributes: Object.entries(strapi.contentTypes[uid].attributes || {}).filter(([, attr]) => attr?.type !== 'dynamiczone' && !attr?.private).map(([name, attr]) => ({ name, type: attr.type })) }))
        ctx.body = { settings, components, contentTypes, media: await resolveMedia(strapi, settings), templates: TEMPLATES, typologies: TYPOLOGIES,
          disabled: strapi.plugin(PLUGIN).config('disabled') === true, hiddenAttribute: hiddenName(strapi.plugin(PLUGIN).config('hiddenAttribute')) || null, blockPreviewAvailable: strapi.plugin(PLUGIN).config('blockPreview') === true, defaults: DEFAULTS,
          projectDefaults: strapi.plugin(PLUGIN).service('settings').projectDefaults(),
          // Version history (Strapi 5 only): the content types it can cover.
          historyTypes: STRAPI5 && strapi.documents?.use ? apiUids(strapi).map(uid => ({ uid, displayName: strapi.contentTypes[uid].info?.displayName || uid })) : null }
      },
      async update(ctx) { ctx.body = await strapi.plugin(PLUGIN).service('settings').set(ctx.request?.body) },
      async reset(ctx) { ctx.body = await strapi.plugin(PLUGIN).service('settings').reset() },
    }),
    prefs: ({ strapi }) => ({
      async find(ctx) {
        const id = ctx.state?.user?.id; if (!id) return ctx.unauthorized()
        ctx.body = mergePrefs(await store(strapi).get({ key: `prefs:${id}` }), componentUids(strapi))
      },
      async update(ctx) {
        const id = ctx.state?.user?.id; if (!id) return ctx.unauthorized()
        const value = validatePrefs(ctx.request?.body, componentUids(strapi))
        await store(strapi).set({ key: `prefs:${id}`, value })
        ctx.body = value
      },
    }),
    ...(STRAPI5 && { history: historyController, trash: trashController }),
  },
  routes: { admin: { type: 'admin', routes: [
    { method: 'GET', path: '/catalog', handler: 'catalog.find', config: { policies: ['admin::isAuthenticatedAdmin'] } },
    ...['GET', 'PUT'].map(method => ({ method, path: '/me/prefs', handler: `prefs.${method === 'GET' ? 'find' : 'update'}`, config: { policies: ['admin::isAuthenticatedAdmin'] } })),
    ...[['GET', 'find', 'read'], ['PUT', 'update', 'update'], ['DELETE', 'reset', 'update']].map(([method, handler, action]) => ({ method, path: '/settings', handler: `settings.${handler}`,
      config: { policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions',
        config: { actions: [`plugin::${PLUGIN}.settings.${action}`] } }] } })),
    ...(STRAPI5 ? [['GET', '/history/:uid/:documentId', 'history.list', 'history.read'], ['GET', '/history-events/:id', 'history.find', 'history.read'],
      ['GET', '/activity', 'history.activity', 'activity.read'], ['GET', '/trash', 'trash.list', 'trash.read'], ['GET', '/trash/:id', 'trash.find', 'trash.read'],
      ['GET', '/trash/:id/check', 'trash.check', 'trash.restore'], ['POST', '/trash/:id/restore', 'trash.restore', 'trash.restore'], ['DELETE', '/trash/:id', 'trash.remove', 'trash.purge'],
    ].map(([method, path, handler, action]) => ({ method, path, handler,
      config: { policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: [`plugin::${PLUGIN}.${action}`] } }] } })) : []),
  ] } },
}
