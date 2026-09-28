'use strict'

// Version history (Strapi 5): one event row per content change made through the document service, with a snapshot of the
// entry (deduplicated by hash), read by the edit view's History section. Content activity, not a security audit log:
// raw `strapi.db.query` or SQL writes are not seen. See README "Version history".

const { createHash } = require('node:crypto')
const { PLUGIN } = require('./settings')
const { snapshotPopulate, canonical, stable, summarize } = require('./diff')

const EVENT_UID = `plugin::${PLUGIN}.event`
const ACTIONS = ['create', 'update', 'publish', 'unpublish', 'discard', 'delete', 'restore']
// Document service action -> event action. `clone` makes a new document, so it is a create.
const CAPTURED = { create: 'create', clone: 'create', update: 'update', publish: 'publish', unpublish: 'unpublish', discardDraft: 'discard', delete: 'delete' }
const CRON = 'blocksceneHistoryPurge'
const BATCH = 500
const DAY = 24 * 60 * 60 * 1000
const LIST_LIMIT = 100

// `documentId` is reserved by Strapi 5 (every content type has its own) and `uid` reads as this row's: the target is
// `contentType` + `relatedDocumentId`, the names Strapi's own history uses.
const eventContentType = { schema: {
  kind: 'collectionType', collectionName: 'blockscene_events',
  info: { singularName: 'event', pluralName: 'events', displayName: 'Blockscene event' },
  options: { draftAndPublish: false },
  pluginOptions: { 'content-manager': { visible: false }, 'content-type-builder': { visible: false }, i18n: { localized: false } },
  attributes: {
    contentType: { type: 'string', required: true },
    relatedDocumentId: { type: 'string', required: true },
    locale: { type: 'string' },
    action: { type: 'enumeration', enum: ACTIONS, required: true },
    // 'admin:<id>', 'token:<id>', 'user:<id>' (Users & Permissions) or 'system'; the name as it was at that moment.
    actor: { type: 'string', required: true },
    actorName: { type: 'string' },
    at: { type: 'datetime', required: true },
    // { fields: [names], blocks: { added, removed, changed }, initial? } vs the previous snapshot; { missing: true } when the capture failed.
    summary: { type: 'json' },
    // Null when identical to the previous snapshot of the same locale (same hash) or purged.
    snapshot: { type: 'json' },
    hash: { type: 'string' },
    size: { type: 'integer' },
  },
  indexes: [{ name: 'blockscene_events_lookup', columns: ['content_type', 'related_document_id', 'locale', 'at'] }],
} }

const fail = (message, Kind = 'ApplicationError') => {
  let E
  try { E = require('@strapi/utils').errors[Kind] } catch { E = class extends Error { constructor(m) { super(m); this.name = Kind } } }
  throw new E(message)
}
const hashOf = (text) => createHash('sha256').update(text).digest('hex')
const covers = (history, uid) => Boolean(history?.enabled) && uid.startsWith('api::') && (history.contentTypes === 'all' || (Array.isArray(history.contentTypes) && history.contentTypes.includes(uid)))
// Retention cut-off dates for a purge run at `now`.
const retention = ({ retentionDays, eventDays }, now = Date.now()) => ({ snapshotsBefore: new Date(now - retentionDays * DAY), eventsBefore: new Date(now - eventDays * DAY) })

// Who made the change: the admin user, the API token or the Users & Permissions user of the current request, else system.
function actorOf(strapi) {
  let ctx
  try { ctx = strapi.requestContext?.get?.() } catch { ctx = null }
  const strategy = ctx?.state?.auth?.strategy?.name, user = ctx?.state?.user, token = ctx?.state?.auth?.credentials
  const name = (value) => String(value || '').slice(0, 255)
  if (strategy === 'admin' && user?.id) return { actor: `admin:${user.id}`, actorName: name([user.firstname, user.lastname].filter(Boolean).join(' ') || user.username || user.email) }
  if (strategy === 'api-token' && token?.id) return { actor: `token:${token.id}`, actorName: name(token.name) }
  if (user?.id) return { actor: `user:${user.id}`, actorName: name(user.username || user.email) }
  return { actor: 'system', actorName: '' }
}

// Media ids and relation targets a snapshot references, walked against the current schema.
function refsOf(snapshot, schema, schemaOf) {
  const media = new Set(), relations = []
  const walk = (data, schema, depth) => {
    if (!data || typeof data !== 'object' || depth > 20) return
    for (const [name, attr] of Object.entries(schema?.attributes || {})) {
      const value = data[name]
      if (value == null) continue
      const list = Array.isArray(value) ? value : [value]
      if (attr.type === 'media') list.forEach(id => Number.isInteger(id) && media.add(id))
      else if (attr.type === 'relation' && attr.target) list.forEach(ref => ref?.documentId && relations.push({ target: attr.target, ...ref }))
      else if (attr.type === 'component') list.forEach(item => walk(item, schemaOf(attr.component), depth + 1))
      else if (attr.type === 'dynamiczone') list.forEach(row => walk(row, schemaOf(row?.__component), depth + 1))
    }
  }
  walk(snapshot, schema, 0)
  return { media: [...media], relations }
}

function historyService({ strapi }) {
  const plugin = () => strapi.plugin(PLUGIN)
  const schemaOf = (uid) => uid && (strapi.getModel?.(uid) || strapi.components?.[uid] || strapi.contentTypes?.[uid])
  const localized = (uid) => Boolean(schemaOf(uid)?.pluginOptions?.i18n?.localized)
  const draftAndPublish = (uid) => schemaOf(uid)?.options?.draftAndPublish === true
  const events = () => strapi.db.query(EVENT_UID)
  // The locales a call acts on, resolved the way the repository does: '*' every locale (null), a list, one locale, else
  // the default locale. Non-localized types have one row per status: [null].
  const scope = async (uid, locale) => {
    if (!localized(uid)) return [null]
    if (locale === '*') return null
    if (Array.isArray(locale) && locale.length) return locale
    if (typeof locale === 'string' && locale) return [locale]
    return [await strapi.plugin('i18n').service('locales').getDefaultLocale()]
  }
  // The stored rows of a document (drafts, or the published versions), with exactly what a snapshot keeps.
  const rows = async (uid, documentId, locales, published = false) => !documentId ? [] : strapi.db.query(uid).findMany({
    where: { documentId, ...(locales && localized(uid) && { locale: { $in: locales } }),
      ...(draftAndPublish(uid) && { publishedAt: published ? { $notNull: true } : { $null: true } }) },
    populate: snapshotPopulate(uid, schemaOf),
  })
  const self = {
    EVENT_UID,
    async config() { return (await plugin().service('settings').get()).history },
    covers,
    // One event. The snapshot is stored unless identical to the latest stored one of the same document and locale.
    async record({ uid, documentId, locale = null, action, entry, actor, missing = false }) {
      let summary = missing ? { missing: true } : null, snapshot = null, hash = null, size = 0
      if (entry) {
        const content = canonical(entry, schemaOf(uid), schemaOf)
        const text = stable(content)
        hash = hashOf(text)
        const previous = await events().findOne({ select: ['hash', 'snapshot'], where: { contentType: uid, relatedDocumentId: documentId, locale, size: { $gt: 0 } }, orderBy: [{ at: 'desc' }, { id: 'desc' }] })
        summary = summarize(previous?.snapshot || null, content, schemaOf(uid))
        if (previous?.hash !== hash) { snapshot = content; size = Buffer.byteLength(text) }
      }
      return events().create({ data: { contentType: uid, relatedDocumentId: documentId, locale, action, ...actor, at: new Date(), summary, snapshot, hash, size } })
    },
    // After a save or publish: one event per affected entry (drafts, or the published versions after a publish).
    async captureSave({ uid, action, documentId, locales, published, actor }) {
      if (!documentId) return
      for (const entry of await rows(uid, documentId, locales, published)) await self.record({ uid, documentId, locale: entry.locale ?? null, action, entry, actor })
    },
    scope, rows,
    // Latest events of one document and locale, newest first; `stored`: its snapshot (or an identical one) can be loaded.
    async list({ uid, documentId, locale }) {
      const where = { contentType: uid, relatedDocumentId: documentId, locale: locale || null }
      const [list, kept] = await Promise.all([
        events().findMany({ select: ['id', 'action', 'actor', 'actorName', 'at', 'summary', 'hash', 'size'], where, orderBy: [{ at: 'desc' }, { id: 'desc' }], limit: LIST_LIMIT }),
        events().findMany({ select: ['hash'], where: { ...where, size: { $gt: 0 } } }),
      ])
      const hashes = new Set(kept.map(row => row.hash))
      return list.map(({ hash, size, ...event }) => ({ ...event, stored: Boolean(hash && hashes.has(hash)) }))
    },
    // One event with its snapshot (from an identical event when this one was deduplicated) and what loading it needs:
    // the media files and relation targets that still exist (relation labels from the Content Manager's main field).
    async find(id) {
      const event = await events().findOne({ where: { id } })
      if (!event) return null
      const { snapshot: own, ...meta } = event
      const snapshot = own || (event.hash && (await events().findOne({ select: ['snapshot'], where: { contentType: event.contentType, relatedDocumentId: event.relatedDocumentId, locale: event.locale, hash: event.hash, size: { $gt: 0 } } }))?.snapshot) || null
      if (!snapshot) return { event: meta, snapshot: null, media: {}, relations: {} }
      const refs = refsOf(snapshot, schemaOf(event.contentType), schemaOf)
      const files = refs.media.length ? await strapi.db.query('plugin::upload.file').findMany({ where: { id: { $in: refs.media } } }) : []
      const relations = {}
      for (const target of [...new Set(refs.relations.map(ref => ref.target))]) {
        if (!strapi.contentTypes?.[target]) continue
        let mainField = null
        try { mainField = (await strapi.plugin('content-manager').service('content-types').findConfiguration(strapi.contentTypes[target]))?.settings?.mainField } catch { mainField = null }
        const scalar = mainField && !['relation', 'media', 'component', 'dynamiczone', 'password'].includes(schemaOf(target)?.attributes?.[mainField]?.type) && mainField !== 'id'
        const found = await strapi.db.query(target).findMany({
          select: ['id', 'documentId', 'locale', ...(scalar ? [mainField] : [])],
          where: { documentId: { $in: [...new Set(refs.relations.filter(ref => ref.target === target).map(ref => ref.documentId))] }, ...(draftAndPublish(target) && { publishedAt: { $null: true } }) },
        })
        relations[target] = found.map(row => ({ id: row.id, documentId: row.documentId, locale: row.locale || null, label: scalar && row[mainField] != null ? String(row[mainField]) : undefined, mainField: scalar ? mainField : undefined }))
      }
      return { event: meta, snapshot, media: Object.fromEntries(files.map(file => [file.id, file])), relations }
    },
    // Nightly, in batches, idempotent (two instances running it is harmless): events past eventDays are deleted;
    // snapshots past retentionDays, or beyond maxSnapshots per document (newest kept), are emptied. Never touches media.
    async purge(now = Date.now()) {
      const history = await self.config()
      const { snapshotsBefore, eventsBefore } = retention(history, now)
      const counts = { events: 0, expired: 0, excess: 0 }
      const batches = async (key, query, apply) => {
        for (;;) {
          const ids = (await events().findMany({ select: ['id'], limit: BATCH, ...query })).map(row => row.id)
          if (ids.length) await apply({ id: { $in: ids } })
          counts[key] += ids.length
          if (ids.length < BATCH) return
        }
      }
      const empty = (where) => events().updateMany({ where, data: { snapshot: null, size: 0 } })
      await batches('events', { where: { at: { $lt: eventsBefore } }, orderBy: { id: 'asc' } }, where => events().deleteMany({ where }))
      await batches('expired', { where: { at: { $lt: snapshotsBefore }, size: { $gt: 0 } }, orderBy: { id: 'asc' } }, empty)
      const meta = strapi.db.metadata.get(EVENT_UID)
      const column = (name) => meta.attributes[name].columnName || name
      const crowded = await strapi.db.connection(meta.tableName).select({ uid: column('contentType'), documentId: column('relatedDocumentId') })
        .where(column('size'), '>', 0).groupBy(column('contentType'), column('relatedDocumentId')).havingRaw('count(*) > ?', [history.maxSnapshots])
      for (const { uid, documentId } of crowded) await batches('excess', { where: { contentType: uid, relatedDocumentId: documentId, size: { $gt: 0 } },
        orderBy: [{ at: 'desc' }, { id: 'desc' }], offset: history.maxSnapshots }, empty)
      return counts
    },
  }
  return self
}

// Capture: one document service middleware for every covered content type. Failure policy: a failed capture never
// blocks a save or a publish (logged, event marked missing); a failed capture fails a delete (nothing deleted), because
// losing content silently is what this exists to prevent. The kill switch (BLOCKSCENE_DISABLED) and the module switch
// turn capture off. The plugin's own content types are never covered (only api:: types), so the event writes (raw
// database queries) never come back here.
function registerHistory(strapi) {
  if (!strapi.documents?.use) return
  const service = () => strapi.plugin(PLUGIN).service('history')
  const warn = (message, error) => strapi.log.error(`[${PLUGIN}] ${message}: ${error?.message || error}`)
  strapi.documents.use(async (ctx, next) => {
    const action = CAPTURED[ctx.action]
    if (!action || !String(ctx.uid || '').startsWith('api::') || strapi.plugin(PLUGIN).config('disabled') === true) return next()
    const history = service()
    const params = ctx.params || {}
    if (action === 'delete') {
      if (!params.documentId || !history.covers(await history.config(), ctx.uid)) return next()
      // One transaction around the read, the delete and the events: a failed capture rolls the delete back (a caller's
      // transaction, like the Content Manager's bulk delete, is joined and rolled back whole).
      return strapi.db.transaction(async () => {
        const actor = actorOf(strapi)
        let entries
        try { entries = await history.rows(ctx.uid, params.documentId, await history.scope(ctx.uid, params.locale)) }
        catch (error) { warn('reading the document before a delete failed', error); fail(`The version history could not record this delete, so nothing was deleted (${error.message}).`) }
        const result = await next()
        try { for (const entry of entries) await history.record({ uid: ctx.uid, documentId: params.documentId, locale: entry.locale ?? null, action, entry, actor }) }
        catch (error) { warn('recording a delete failed, the delete was rolled back', error); fail(`The version history could not record this delete, so nothing was deleted (${error.message}).`) }
        return result
      })
    }
    let covered = false
    try { covered = history.covers(await history.config(), ctx.uid) } catch (error) { warn('reading the history settings failed, this change is not recorded', error) }
    if (!covered) return next()
    const actor = actorOf(strapi)
    const result = await next()
    // Saves are captured after the change committed (outside any transaction this middleware owns): a failed capture can
    // neither roll the change back nor poison the transaction (Postgres aborts a transaction after a failed statement).
    const documentId = ['create', 'update'].includes(action) ? (result?.documentId || params.documentId) : params.documentId
    const locales = ['publish', 'unpublish', 'discard'].includes(action) ? [...new Set((result?.entries || []).map(entry => entry?.locale ?? null))]
      : ctx.action === 'clone' ? null : await history.scope(ctx.uid, params.locale).catch(() => [result?.locale ?? null])
    const steps = [[action, action === 'publish']]
    // create/update with status 'published' publish inside the repository, without coming back through the middleware.
    if (['create', 'update'].includes(ctx.action) && params.status === 'published' && strapi.getModel(ctx.uid)?.options?.draftAndPublish) steps.push(['publish', true])
    for (const [step, published] of steps) {
      if (locales && !locales.length) continue
      try { await history.captureSave({ uid: ctx.uid, action: step, documentId, locales, published, actor }) }
      catch (error) {
        warn(`recording "${step}" of ${ctx.uid} ${documentId} failed, the change was saved without a version`, error)
        try { if (documentId) for (const locale of locales || [null]) await history.record({ uid: ctx.uid, documentId, locale, action: step, actor, missing: true }) }
        catch (again) { warn('marking the missing version failed too', again) }
      }
    }
    return result
  })
}

// Nightly purge (03:00 server time). Added from bootstrap: Strapi's cron service schedules a job added after it started.
function registerPurge(strapi) {
  if (!strapi.documents?.use || !strapi.cron?.add) return
  strapi.cron.add({ [CRON]: { options: '0 3 * * *', task: async () => {
    try { const counts = await strapi.plugin(PLUGIN).service('history').purge(); if (counts.events || counts.expired || counts.excess) strapi.log.info(`[${PLUGIN}] history purge: ${counts.events} events deleted, ${counts.expired + counts.excess} snapshots emptied`) }
    catch (error) { strapi.log.error(`[${PLUGIN}] history purge failed: ${error?.message || error}`) }
  } } })
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
// Reading a version needs `history.read` (route policy) and read access to the content type in the Content Manager.
const canRead = (strapi, ctx, uid) => {
  try { return !strapi.plugin('content-manager').service('permission-checker').create({ userAbility: ctx.state.userAbility, model: uid }).cannot.read() }
  catch { return false }
}
const historyController = ({ strapi }) => ({
  async list(ctx) {
    const { uid, documentId } = ctx.params || {}
    const locale = ctx.query?.locale || ''
    if (!String(uid).startsWith('api::') || !strapi.contentTypes?.[uid] || !DOCUMENT_ID.test(documentId || '') || (locale && !LOCALE.test(locale))) return ctx.badRequest('Invalid content type, document or locale')
    if (!canRead(strapi, ctx, uid)) return ctx.forbidden()
    // No locale on a localized type: the default one, as the Content Manager opens it.
    const history = strapi.plugin(PLUGIN).service('history')
    ctx.body = { results: await history.list({ uid, documentId, locale: (await history.scope(uid, locale || undefined))[0] }) }
  },
  async find(ctx) {
    const id = Number(ctx.params?.id)
    if (!Number.isInteger(id) || id <= 0) return ctx.badRequest('Invalid event')
    const found = await strapi.plugin(PLUGIN).service('history').find(id)
    if (!found || !canRead(strapi, ctx, found.event.contentType)) return ctx.notFound()
    ctx.body = found
  },
})

module.exports = { EVENT_UID, ACTIONS, CAPTURED, CRON, BATCH, eventContentType, covers, retention, actorOf, refsOf, historyService, registerHistory, registerPurge, historyController }
