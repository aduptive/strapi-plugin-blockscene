'use strict'

// Version history (Strapi 5): one event row per content change made through the document service, with a snapshot of the
// entry (deduplicated by hash), read by the edit view's History section. Content activity, not a security audit log:
// raw `strapi.db.query` or SQL writes are not seen. See README "Version history".

const { createHash } = require('node:crypto')
const { PLUGIN } = require('./settings')
const { snapshotPopulate, canonical, stable, summarize } = require('./diff')
const { TRASH_UID, restoring } = require('./trash')

const EVENT_UID = `plugin::${PLUGIN}.event`
// `restore`: a document back from the trash; `purge`: a trash entry deleted forever.
const ACTIONS = ['create', 'update', 'publish', 'unpublish', 'discard', 'delete', 'restore', 'purge']
// Document service action -> event action. `clone` makes a new document, so it is a create.
const CAPTURED = { create: 'create', clone: 'create', update: 'update', publish: 'publish', unpublish: 'unpublish', discardDraft: 'discard', delete: 'delete' }
const CRON = 'blocksceneHistoryPurge'
const BATCH = 500
const DAY = 24 * 60 * 60 * 1000
const LIST_LIMIT = 100
const ACTORS_LIMIT = 500
const SEARCH_LIMIT = 200

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
    // { fields: [names], blocks: { added, removed, changed }, initial? } vs the previous snapshot; { missing: true } when the capture failed;
    // restore: + { restoredFrom, trash }; purge: { trash, title }.
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
  // The people (and tokens) in the activity, for its filter: the latest name each one had. ponytail: one GROUP BY over the
  // events table per page load, fine for years of editing; a separate actors table if it ever shows in the query log.
  const actors = async () => {
    const meta = strapi.db.metadata.get(EVENT_UID)
    const column = (name) => meta.attributes[name].columnName || name
    return strapi.db.connection(meta.tableName).select({ actor: column('actor') }).max({ actorName: column('actorName') })
      .groupBy(column('actor')).orderBy(column('actor')).limit(ACTORS_LIMIT)
  }
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
    async record({ uid, documentId, locale = null, action, entry, actor, missing = false, extra = null }) {
      let summary = missing ? { missing: true } : null, snapshot = null, hash = null, size = 0
      if (entry) {
        const content = canonical(entry, schemaOf(uid), schemaOf)
        const text = stable(content)
        hash = hashOf(text)
        const previous = await events().findOne({ select: ['hash', 'snapshot'], where: { contentType: uid, relatedDocumentId: documentId, locale, size: { $gt: 0 } }, orderBy: [{ at: 'desc' }, { id: 'desc' }] })
        summary = summarize(previous?.snapshot || null, content, schemaOf(uid))
        if (previous?.hash !== hash) { snapshot = content; size = Buffer.byteLength(text) }
      }
      if (extra) summary = { ...summary, ...extra }
      return events().create({ data: { contentType: uid, relatedDocumentId: documentId, locale, action, ...actor, at: new Date(), summary, snapshot, hash, size } })
    },
    // After a save or publish: one event per affected entry (drafts, or the published versions after a publish).
    async captureSave({ uid, action, documentId, locales, published, actor }) {
      if (!documentId) return
      for (const entry of await rows(uid, documentId, locales, published)) await self.record({ uid, documentId, locale: entry.locale ?? null, action, entry, actor })
    },
    scope, rows,
    // The Content Manager's main field of a content type when it is a plain value (what list views show), else null.
    async mainField(uid) {
      let name = null
      try { name = (await strapi.plugin('content-manager').service('content-types').findConfiguration(strapi.contentTypes[uid]))?.settings?.mainField } catch { name = null }
      return name && name !== 'id' && schemaOf(uid)?.attributes?.[name] && !['relation', 'media', 'component', 'dynamiczone', 'password', 'json', 'blocks'].includes(schemaOf(uid).attributes[name].type) ? name : null
    },
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
        const mainField = await self.mainField(target), scalar = Boolean(mainField)
        const found = await strapi.db.query(target).findMany({
          select: ['id', 'documentId', 'locale', ...(scalar ? [mainField] : [])],
          where: { documentId: { $in: [...new Set(refs.relations.filter(ref => ref.target === target).map(ref => ref.documentId))] }, ...(draftAndPublish(target) && { publishedAt: { $null: true } }) },
        })
        relations[target] = found.map(row => ({ id: row.id, documentId: row.documentId, locale: row.locale || null, label: scalar && row[mainField] != null ? String(row[mainField]) : undefined, mainField: scalar ? mainField : undefined }))
      }
      return { event: meta, snapshot, media: Object.fromEntries(files.map(file => [file.id, file])), relations }
    },
    // Content activity: one page of events (no snapshots), newest first, with each document's title and whether it still
    // exists (the list links to it). `types`: the content types the user may read. `q`: documents whose main field
    // contains it now, or whose trash entry's title does (at most SEARCH_LIMIT per content type).
    async activity({ actor, contentType, action, from, to, q, page, pageSize, types }) {
      const empty = { results: [], pagination: { page, pageSize, total: 0, pageCount: 0 }, actors: [] }
      if (contentType && !types.includes(contentType)) return empty
      const where = { contentType: contentType || { $in: types }, ...(actor && { actor }), ...(action && { action }),
        ...((from || to) && { at: { ...(from && { $gte: from }), ...(to && { $lte: to }) } }) }
      if (q) {
        const matches = []
        for (const uid of contentType ? [contentType] : types) {
          const main = await self.mainField(uid)
          const found = new Set(main ? (await strapi.db.query(uid).findMany({ select: ['documentId'], where: { [main]: { $containsi: q } }, limit: SEARCH_LIMIT })).map(row => row.documentId) : [])
          for (const row of await strapi.db.query(TRASH_UID).findMany({ select: ['relatedDocumentId'], where: { contentType: uid, title: { $containsi: q } }, limit: SEARCH_LIMIT })) found.add(row.relatedDocumentId)
          if (found.size) matches.push({ contentType: uid, relatedDocumentId: { $in: [...found] } })
        }
        if (!matches.length) return { ...empty, actors: await actors() }
        where.$or = matches
      }
      const [list, total] = await Promise.all([
        events().findMany({ select: ['id', 'contentType', 'relatedDocumentId', 'locale', 'action', 'actor', 'actorName', 'at', 'summary'], where, orderBy: [{ at: 'desc' }, { id: 'desc' }], offset: (page - 1) * pageSize, limit: pageSize }),
        events().count({ where }),
      ])
      // Titles: the document's current rows (the event's locale first), else its latest trash entry.
      const docs = new Map()
      for (const uid of [...new Set(list.map(event => event.contentType))]) {
        const ids = [...new Set(list.filter(event => event.contentType === uid).map(event => event.relatedDocumentId))]
        const main = strapi.contentTypes?.[uid] ? await self.mainField(uid) : null
        const found = strapi.contentTypes?.[uid] ? await strapi.db.query(uid).findMany({ select: ['documentId', 'locale', ...(main ? [main] : [])], where: { documentId: { $in: ids } } }) : []
        for (const row of found) { const key = `${uid}|${row.documentId}`; docs.set(key, [...(docs.get(key) || []), { locale: row.locale ?? null, title: main && row[main] != null ? String(row[main]) : null }]) }
        const gone = ids.filter(id => !docs.has(`${uid}|${id}`))
        if (gone.length) for (const row of await strapi.db.query(TRASH_UID).findMany({ select: ['relatedDocumentId', 'title'], where: { contentType: uid, relatedDocumentId: { $in: gone } }, orderBy: { id: 'desc' } }))
          if (!docs.has(`trash|${uid}|${row.relatedDocumentId}`)) docs.set(`trash|${uid}|${row.relatedDocumentId}`, row.title)
      }
      const results = list.map(event => {
        const rows = docs.get(`${event.contentType}|${event.relatedDocumentId}`) || []
        const own = rows.find(row => row.locale === (event.locale ?? null))
        // A purge names the trash entry it deleted (its own title), not the document's current one.
        if (event.action === 'purge') return { ...event, exists: false, title: event.summary?.title ?? null }
        return { ...event, exists: Boolean(own), title: (own || rows[0])?.title ?? docs.get(`trash|${event.contentType}|${event.relatedDocumentId}`) ?? null }
      })
      return { results, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) }, actors: await actors() }
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
    // A restore's own writes are recorded by the restore (as `restore` events).
    if (!action || !String(ctx.uid || '').startsWith('api::') || strapi.plugin(PLUGIN).config('disabled') === true || restoring.getStore()) return next()
    const history = service()
    const params = ctx.params || {}
    if (action === 'delete') {
      const config = params.documentId ? await history.config() : null
      if (!config || !history.covers(config, ctx.uid)) return next()
      // One transaction around the read, the delete, the events and the trash row: a failed capture rolls the delete back
      // (a caller's transaction, like the Content Manager's bulk delete, is joined and rolled back whole).
      return strapi.db.transaction(async () => {
        const actor = actorOf(strapi), trash = strapi.plugin(PLUGIN).service('trash')
        const published = strapi.getModel(ctx.uid)?.options?.draftAndPublish === true
        let locales, entries, live, incoming
        try {
          locales = await history.scope(ctx.uid, params.locale)
          entries = await history.rows(ctx.uid, params.documentId, locales)
          live = published ? await history.rows(ctx.uid, params.documentId, locales, true) : []
          // Links other documents and blocks have to these rows: the database removes them with the rows.
          incoming = await trash.incoming(ctx.uid, new Map([...entries.map(row => [row.id, { locale: row.locale, published: false }]), ...live.map(row => [row.id, { locale: row.locale, published: true }])]))
        } catch (error) { warn('reading the document before a delete failed', error); fail(`The version history could not record this delete, so nothing was deleted (${error.message}).`) }
        const result = await next()
        try {
          for (const entry of entries) await history.record({ uid: ctx.uid, documentId: params.documentId, locale: entry.locale ?? null, action, entry, actor })
          if (entries.length || live.length) await trash.record({ uid: ctx.uid, documentId: params.documentId, locales, drafts: entries, published: live, incoming, actor, days: config.trashDays })
        } catch (error) { warn('recording a delete failed, the delete was rolled back', error); fail(`The version history could not record this delete, so nothing was deleted (${error.message}).`) }
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
    try { const count = await strapi.plugin(PLUGIN).service('trash').purge(); if (count) strapi.log.info(`[${PLUGIN}] trash purge: ${count} expired entries deleted`) }
    catch (error) { strapi.log.error(`[${PLUGIN}] trash purge failed: ${error?.message || error}`) }
  } } })
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
// Reading a version, the activity or the trash needs the route's permission and read access to the content type in the
// Content Manager (restore: create, delete forever: delete).
const can = (strapi, ctx, uid, action = 'read') => {
  try { return !strapi.plugin('content-manager').service('permission-checker').create({ userAbility: ctx.state.userAbility, model: uid }).cannot[action]() }
  catch { return false }
}
const canRead = (strapi, ctx, uid) => can(strapi, ctx, uid)
const readableTypes = (strapi, ctx) => Object.keys(strapi.contentTypes || {}).filter(uid => uid.startsWith('api::') && canRead(strapi, ctx, uid))
const ACTOR = /^(system|(admin|token|user):\d{1,15})$/
const int = (value, fallback, max) => { if (value === undefined || value === '') return fallback; const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= max ? n : NaN }
const date = (value) => { if (!value) return null; const time = Date.parse(value); return typeof value === 'string' && value.length <= 40 && Number.isFinite(time) ? new Date(time) : NaN }
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
  async activity(ctx) {
    const { actor = '', contentType = '', action = '', q = '' } = ctx.query || {}
    const page = int(ctx.query?.page, 1, 10000), pageSize = int(ctx.query?.pageSize, 25, 100), from = date(ctx.query?.from), to = date(ctx.query?.to)
    if ([actor, contentType, action, q].some(value => typeof value !== 'string') || (actor && !ACTOR.test(actor)) || (contentType && !/^api::[\w-]+\.[\w-]+$/.test(contentType))
      || (action && !ACTIONS.includes(action)) || q.length > 100 || [page, pageSize, from, to].some(value => Number.isNaN(value))) return ctx.badRequest('Invalid filters')
    const history = strapi.plugin(PLUGIN).service('history')
    const types = readableTypes(strapi, ctx)
    ctx.body = { ...await history.activity({ actor, contentType, action, from, to, q: q.trim(), page, pageSize, types }),
      enabled: Boolean((await history.config()).enabled) && strapi.plugin(PLUGIN).config('disabled') !== true,
      types: types.map(uid => ({ uid, displayName: strapi.contentTypes[uid].info?.displayName || uid, kind: strapi.contentTypes[uid].kind, localized: Boolean(strapi.contentTypes[uid].pluginOptions?.i18n?.localized) })) }
  },
})

module.exports = { EVENT_UID, ACTIONS, CAPTURED, CRON, BATCH, eventContentType, covers, retention, actorOf, refsOf, can, readableTypes, historyService, registerHistory, registerPurge, historyController }
