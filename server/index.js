'use strict'

const { PLUGIN, TEMPLATES, TYPOLOGIES, DEFAULTS, catalog, validateSettings, mergeSaved, validatePrefs, mergePrefs, safeUrl, fail } = require('./settings')
const { safeGroups, validateGroups } = require('./groups')

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
      groups: null },
    validator: catalog,
  },
  async bootstrap({ strapi }) {
    await strapi.admin.services.permission.actionProvider.registerMany([
      { section: 'plugins', displayName: 'Read gallery settings', uid: 'settings.read', pluginName: PLUGIN },
      { section: 'plugins', displayName: 'Change gallery settings', uid: 'settings.update', pluginName: PLUGIN },
    ])
    registerPublishGuard(strapi)
  },
  services: { settings: ({ strapi }) => ({
    async get() { return mergeSaved(await readSettings(strapi), componentUids(strapi), contentTypeUids(strapi)) },
    async set(value) {
      const next = validateSettings(value, componentUids(strapi), contentTypeUids(strapi))
      for (const [uid, entry] of Object.entries(next.components)) {
        if (entry.mediaId && !(await findMedia(strapi, entry.mediaId).catch(() => null))) fail(`Media for "${uid}" does not exist`)
      }
      await store(strapi).set({ key: 'settings', value: next })
      return next
    },
  }) },
  controllers: {
    catalog: ({ strapi }) => ({
      async find(ctx) {
        const plugin = strapi.plugin(PLUGIN)
        const base = catalog({ components: plugin.config('components'), previewBaseUrl: plugin.config('previewBaseUrl'),
          previewVersion: plugin.config('previewVersion'), disabled: plugin.config('disabled'), blockPreview: plugin.config('blockPreview'),
          groups: plugin.config('groups'), componentUids: componentUids(strapi), schemas: strapi.components })
        const settings = await plugin.service('settings').get()
        const media = await resolveMedia(strapi, settings)
        for (const [uid, entry] of Object.entries(settings.components)) {
          base.components[uid] = { ...base.components[uid], ...media[uid], template: entry.template,
            ...(entry.typology && { typology: entry.typology }), ...(entry.tags && { tags: entry.tags }) }
        }
        ctx.body = { ...base, palette: settings.palette, contentTypes: settings.contentTypes,
          editor: { ...settings.editor, enabled: settings.editor.enabled && !base.disabled } }
      },
    }),
    settings: ({ strapi }) => ({
      async find(ctx) {
        const settings = await strapi.plugin(PLUGIN).service('settings').get()
        // typology: the value without a Settings override (code config, else the guess), shown as "Automatic".
        const auto = catalog({ components: strapi.plugin(PLUGIN).config('components'), schemas: strapi.components }).components
        const components = Object.entries(strapi.components || {}).map(([uid, schema]) => ({ uid,
          displayName: schema.info?.displayName || uid, category: schema.category || uid.split('.')[0], typology: auto[uid]?.typology }))
        const contentTypes = Object.keys(contentTypeUids(strapi)).map(uid => ({ uid, displayName: strapi.contentTypes[uid].info?.displayName || uid, kind: strapi.contentTypes[uid].kind,
          attributes: Object.entries(strapi.contentTypes[uid].attributes || {}).filter(([, attr]) => attr?.type !== 'dynamiczone' && !attr?.private).map(([name, attr]) => ({ name, type: attr.type })) }))
        ctx.body = { settings, components, contentTypes, media: await resolveMedia(strapi, settings), templates: TEMPLATES, typologies: TYPOLOGIES,
          disabled: strapi.plugin(PLUGIN).config('disabled') === true, blockPreviewAvailable: strapi.plugin(PLUGIN).config('blockPreview') === true, defaults: DEFAULTS }
      },
      async update(ctx) { ctx.body = await strapi.plugin(PLUGIN).service('settings').set(ctx.request?.body) },
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
  },
  routes: { admin: { type: 'admin', routes: [
    { method: 'GET', path: '/catalog', handler: 'catalog.find', config: { policies: ['admin::isAuthenticatedAdmin'] } },
    ...['GET', 'PUT'].map(method => ({ method, path: '/me/prefs', handler: `prefs.${method === 'GET' ? 'find' : 'update'}`, config: { policies: ['admin::isAuthenticatedAdmin'] } })),
    ...['find', 'update'].map((handler, index) => ({ method: index ? 'PUT' : 'GET', path: '/settings', handler: `settings.${handler}`,
      config: { policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions',
        config: { actions: [`plugin::${PLUGIN}.settings.${index ? 'update' : 'read'}`] } }] } })),
  ] } },
}
