'use strict'

// Trash (Strapi 5, part of the version history module): one row per document delete made through the document service,
// with every deleted locale (draft and published rows) and the relations other documents and blocks had to it (Strapi
// removes those with the document). Restore checks first and reports, then recreates the document as a DRAFT through the
// document service. Content activity, not a backup: raw `strapi.db.query` or SQL deletes are not seen. See README "Trash".

const { AsyncLocalStorage } = require('node:async_hooks')
const { PLUGIN } = require('./settings')
const { kept, canonical, stable } = require('./diff')
// ./history requires this file (for `restoring`): read lazily, once both are loaded.
const history = () => require('./history')

const TRASH_UID = `plugin::${PLUGIN}.trash`
const STATUSES = ['trashed', 'restored']
const DAY = 24 * 60 * 60 * 1000
const BATCH = 500
// Writes made by a restore: the history middleware leaves them to the restore, which records `restore` events itself.
const restoring = new AsyncLocalStorage()

const trashContentType = { schema: {
  kind: 'collectionType', collectionName: 'blockscene_trash',
  info: { singularName: 'trash', pluralName: 'trashes', displayName: 'Blockscene trash' },
  options: { draftAndPublish: false },
  pluginOptions: { 'content-manager': { visible: false }, 'content-type-builder': { visible: false }, i18n: { localized: false } },
  attributes: {
    contentType: { type: 'string', required: true },
    relatedDocumentId: { type: 'string', required: true },
    // The document's main field (Content Manager setting) at delete time, for the list and the search.
    title: { type: 'string' },
    // The locales the delete removed ([null] for a type without i18n).
    locales: { type: 'json' },
    // [{ locale, status: 'draft' | 'published' | null (no Draft & Publish), snapshot }]: canonical snapshots (server/diff.js).
    entries: { type: 'json' },
    // Links other documents' and blocks' unidirectional relations had to the deleted rows (see `incomingRows`).
    incoming: { type: 'json' },
    actor: { type: 'string', required: true },
    actorName: { type: 'string' },
    deletedAt: { type: 'datetime', required: true },
    // deletedAt + trash retention at delete time; the nightly purge deletes the row after it.
    expiresAt: { type: 'datetime', required: true },
    status: { type: 'enumeration', enum: STATUSES, required: true, default: 'trashed' },
    restoredAs: { type: 'string' },
    restoredAt: { type: 'datetime' },
    size: { type: 'integer' },
  },
  indexes: [{ name: 'blockscene_trash_list', columns: ['status', 'content_type', 'deleted_at'] }, { name: 'blockscene_trash_expiry', columns: ['expires_at'] }],
} }

const expiresAt = (deletedAt, days) => new Date(new Date(deletedAt).getTime() + days * DAY)
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const blank = (value) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
const toMany = (attr) => /ToMany$|^manyWay$/.test(String(attr?.relation || ''))
const toOne = (attr) => ['oneToOne', 'manyToOne'].includes(attr?.relation)
// Top-level attributes Strapi (or the site) treats as unique: `unique: true` and uid fields.
const uniqueFields = (schema) => Object.entries(schema?.attributes || {}).filter(([name, attr]) => kept(name, attr) && (attr.unique === true || attr.type === 'uid')).map(([name]) => name)

// One entry per locale to restore: the DRAFT when the delete had one (the latest work), else the published row.
function chooseEntries(entries) {
  const chosen = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const locale = entry?.locale ?? null, current = chosen.get(locale)
    if (!current || (current.status === 'published' && entry.status !== 'published')) chosen.set(locale, entry)
  }
  return chosen
}

// Document service data for one snapshot under the CURRENT schema: components and blocks as new rows (no ids), relations as
// { documentId, locale } of targets that still exist (`relation(target, ref)`), media ids that still exist (`media`).
// Reported, not written: fields the schema no longer has (or whose value it no longer accepts), blocks whose component the
// zone no longer allows, missing media and relation targets.
function restorePayload(snapshot, schema, schemaOf, { media = new Set(), relation = () => false } = {}) {
  const report = { removed: [], media: 0, relations: 0, blocks: 0 }
  const ref = (item) => ({ documentId: item.documentId, ...(item.locale && { locale: item.locale }) })
  const build = (data, schema, top, depth) => {
    const out = {}
    if (!isObject(data) || depth > 20) return out
    for (const [name, value] of Object.entries(data)) {
      if (name === '__component') continue
      const attr = schema?.attributes?.[name]
      const drop = () => { if (top) report.removed.push(name) }
      if (!kept(name, attr)) { drop(); continue }
      const list = Array.isArray(value) ? value : value == null ? [] : [value]
      if (attr.type === 'relation') {
        const refs = list.filter(item => isObject(item) && typeof item.documentId === 'string')
        const found = refs.filter(item => relation(attr.target, item))
        report.relations += refs.length - found.length
        out[name] = toMany(attr) ? found.map(ref) : found[0] ? ref(found[0]) : null
      } else if (attr.type === 'media') {
        const ids = list.filter(Number.isInteger), found = ids.filter(id => media.has(id))
        report.media += ids.length - found.length
        out[name] = attr.multiple ? found : found[0] ?? null
      } else if (attr.type === 'component') {
        const child = schemaOf(attr.component)
        if (!child) { drop(); continue }
        out[name] = attr.repeatable ? list.filter(isObject).map(item => build(item, child, false, depth + 1)) : isObject(value) ? build(value, child, false, depth + 1) : null
      } else if (attr.type === 'dynamiczone') {
        const rows = list.filter(row => isObject(row) && typeof row.__component === 'string')
        const allowed = rows.filter(row => (attr.components || []).includes(row.__component) && schemaOf(row.__component))
        report.blocks += rows.length - allowed.length
        out[name] = allowed.map(row => ({ __component: row.__component, ...build(row, schemaOf(row.__component), false, depth + 1) }))
      } else if (attr.type === 'enumeration' && !(attr.enum || []).includes(value)) drop()
      else out[name] = value
    }
    return out
  }
  return { data: build(snapshot, schema, true, 0), report }
}

// What a restore would do, from lookups made beforehand (pure). `locales`: the configured locales (null: type without
// i18n); `existing`: the locales the document has now (null: the document is gone, a new one is made); `taken(field,
// locale, value)`: another document holds that unique value; `singleTaken`: a single type that has a document again.
// Blocking problems stop the restore before anything is written; warnings are reported and the restore goes on.
function planRestore(entries, { schema, schemaOf, locales = null, defaultLocale = null, existing = null, singleTaken = false, taken = () => false, media, relation }) {
  const blocking = [], warnings = [], steps = []
  const published = (Array.isArray(entries) ? entries : []).filter(entry => entry?.status === 'published').map(entry => entry.locale ?? null)
  if (published.length) warnings.push({ code: 'published', locales: published })
  if (singleTaken && !existing) blocking.push({ code: 'singleExists' })
  for (const [locale, entry] of chooseEntries(entries)) {
    if (locales && !locales.includes(locale)) { warnings.push({ code: 'localeRemoved', locale }); continue }
    if (existing?.includes(locale)) { blocking.push({ code: 'localeExists', locale }); continue }
    const { data, report } = restorePayload(entry.snapshot, schema, schemaOf, { media, relation })
    for (const field of uniqueFields(schema)) if (!blank(data[field]) && taken(field, locale, data[field])) blocking.push({ code: 'unique', locale, field, value: String(data[field]).slice(0, 100) })
    // Drafts may miss required fields (Strapi validates them on publish): restored, reported.
    const required = Object.entries(schema?.attributes || {}).filter(([name, attr]) => attr?.required && kept(name, attr) && blank(data[name])).map(([name]) => name)
    if (required.length) warnings.push({ code: 'required', locale, fields: required })
    if (report.removed.length) warnings.push({ code: 'fieldsRemoved', locale, fields: report.removed })
    for (const code of ['media', 'relations', 'blocks']) if (report[code]) warnings.push({ code, locale, count: report[code] })
    steps.push({ locale, data })
  }
  if (!steps.length && !blocking.length) blocking.push({ code: 'nothing' })
  // The default locale first: a new document is created in it, the others are added to it.
  steps.sort((a, b) => (b.locale === defaultLocale) - (a.locale === defaultLocale))
  return { blocking, warnings, steps }
}

// Unidirectional relations (the target side does not see them, so the deleted document's snapshot does not hold them)
// from any content type or component to `uid`, through a join table: what Strapi itself re-points on publish.
// `models`: [{ uid, kind: 'contentType' | 'component', attributes }] with database metadata attributes.
const incomingSources = (uid, models) => models.flatMap(model => Object.entries(model.attributes || {})
  .filter(([, attr]) => attr?.type === 'relation' && attr.target === uid && !attr.inversedBy && !attr.mappedBy && attr.joinTable)
  .map(([field, attr]) => ({ owner: model.uid, kind: model.kind, field, joinTable: attr.joinTable, single: toOne(attr) })))
// The stored shape of the links found in one source's join table. `deleted`: id -> { locale, published } of the deleted
// rows; `owners`: id -> { documentId, locale } of content type owners. A document's links to itself are in its snapshot.
function incomingRows(source, links, deleted, owners = new Map()) {
  const { joinColumn, inverseJoinColumn, orderColumnName } = source.joinTable
  return links.filter(link => deleted.has(link[inverseJoinColumn.name]) && !(source.kind === 'contentType' && source.owner === source.target && deleted.has(link[joinColumn.name])))
    .map(link => {
      const target = deleted.get(link[inverseJoinColumn.name]), owner = owners.get(link[joinColumn.name])
      return { owner: source.owner, kind: source.kind, field: source.field, ownerId: link[joinColumn.name],
        ...(source.kind === 'contentType' && { ownerDocumentId: owner?.documentId ?? null, ownerLocale: owner?.locale ?? null }),
        locale: target.locale ?? null, published: Boolean(target.published), order: orderColumnName ? link[orderColumnName] ?? null : null }
    })
}

// Read-only summary of one snapshot for the trash preview: scalar fields (shortened), counts for the rest, blocks in order.
function previewOf(snapshot, schema, schemaOf) {
  const fields = [], blocks = []
  const text = (value) => { const s = typeof value === 'string' ? value : stable(value); return s.length > 200 ? `${s.slice(0, 199)}…` : s }
  for (const [name, value] of Object.entries(isObject(snapshot) ? snapshot : {})) {
    const attr = schema?.attributes?.[name]
    if (attr?.type === 'dynamiczone') { for (const row of Array.isArray(value) ? value : []) blocks.push({ zone: name, uid: row?.__component, name: schemaOf(row?.__component)?.info?.displayName || row?.__component }); continue }
    const count = Array.isArray(value) ? value.length : 1
    fields.push({ name, type: attr?.type || 'removed', ...(['relation', 'media', 'component'].includes(attr?.type) ? { count } : { value: text(value) }) })
  }
  return { fields, blocks }
}

function trashService({ strapi }) {
  const events = () => strapi.plugin(PLUGIN).service('history')
  const rows = () => strapi.db.query(TRASH_UID)
  const schemaOf = (uid) => uid && (strapi.getModel?.(uid) || strapi.components?.[uid] || strapi.contentTypes?.[uid])
  const localized = (uid) => Boolean(schemaOf(uid)?.pluginOptions?.i18n?.localized)
  const draftAndPublish = (uid) => schemaOf(uid)?.options?.draftAndPublish === true
  const models = () => [...Object.values(strapi.contentTypes || {}).map(model => ({ uid: model.uid, kind: 'contentType' })), ...Object.values(strapi.components || {}).map(model => ({ uid: model.uid, kind: 'component' }))]
    .map(model => ({ ...model, attributes: strapi.db.metadata.get(model.uid)?.attributes })).filter(model => model.attributes)
  // A join table row insert/read inside the current transaction (the middleware's, or the restore's).
  const table = (trx, name) => strapi.db.getConnection(name).transacting(trx)

  // Relation targets and media a set of snapshots references, that exist now: the `media` and `relation` of planRestore.
  const lookups = async (uid, snapshots) => {
    const ids = new Set(), refs = []
    for (const snapshot of snapshots) { const found = history().refsOf(snapshot, schemaOf(uid), schemaOf); found.media.forEach(id => ids.add(id)); refs.push(...found.relations) }
    const files = ids.size ? await strapi.db.query('plugin::upload.file').findMany({ select: ['id'], where: { id: { $in: [...ids] } } }) : []
    const present = new Set()
    for (const target of [...new Set(refs.map(ref => ref.target))]) {
      if (!strapi.contentTypes?.[target]) continue
      const found = await strapi.db.query(target).findMany({ select: ['documentId', 'locale'], where: { documentId: { $in: [...new Set(refs.filter(ref => ref.target === target).map(ref => ref.documentId))] },
        ...(draftAndPublish(target) && { publishedAt: { $null: true } }) } })
      for (const row of found) { present.add(`${target}|${row.documentId}|${row.locale || ''}`); present.add(`${target}|${row.documentId}|*`) }
    }
    return { media: new Set(files.map(file => file.id)), relation: (target, ref) => present.has(`${target}|${ref.documentId}|${localized(target) && ref.locale ? ref.locale : '*'}`) }
  }

  // Where each captured link can go back: owners that still exist (draft rows; component rows by id) and still have the field.
  // Links to the deleted PUBLISHED rows are not reconnected (a restore makes a draft): they come back when the owners are
  // published again after this document is. A to-one relation whose owner points elsewhere now is left as it is.
  const resolveIncoming = async (uid, incoming, locales, trx) => {
    const out = { links: [], gone: 0, published: 0, replaced: 0 }
    for (const link of Array.isArray(incoming) ? incoming : []) {
      if (!locales.includes(link.locale)) continue
      if (link.published) { out.published++; continue }
      const attr = strapi.db.metadata.get(link.owner)?.attributes?.[link.field]
      if (!attr?.joinTable || attr.target !== uid) { out.gone++; continue }
      let ownerId = null
      if (link.kind === 'component') ownerId = (await strapi.db.query(link.owner).findOne({ select: ['id'], where: { id: link.ownerId } }))?.id ?? null
      else if (strapi.contentTypes?.[link.owner] && link.ownerDocumentId) ownerId = (await strapi.db.query(link.owner).findOne({ select: ['id'], where: { documentId: link.ownerDocumentId,
        ...(localized(link.owner) && { locale: link.ownerLocale }), ...(draftAndPublish(link.owner) && { publishedAt: { $null: true } }) } }))?.id ?? null
      if (!ownerId) { out.gone++; continue }
      const { joinTable } = attr
      if (toOne(attr) && await table(trx, joinTable.name).where(joinTable.joinColumn.name, ownerId).first()) { out.replaced++; continue }
      out.links.push({ ...link, ownerRowId: ownerId, joinTable })
    }
    return out
  }

  const self = {
    TRASH_UID,
    // Before the delete, in its transaction: the links other documents and blocks have to the rows about to be deleted.
    async incoming(uid, deleted) {
      if (!deleted.size) return []
      return strapi.db.transaction(async ({ trx }) => {
        const out = []
        for (const source of incomingSources(uid, models())) {
          const links = await table(trx, source.joinTable.name).select('*').whereIn(source.joinTable.inverseJoinColumn.name, [...deleted.keys()])
          if (!links.length) continue
          const owners = source.kind === 'contentType' && strapi.contentTypes?.[source.owner] ? new Map((await strapi.db.query(source.owner).findMany({ select: ['id', 'documentId', 'locale'],
            where: { id: { $in: [...new Set(links.map(link => link[source.joinTable.joinColumn.name]))] } } })).map(row => [row.id, row])) : new Map()
          out.push(...incomingRows({ ...source, target: uid }, links, deleted, owners))
        }
        return out
      })
    },
    // After the delete, in its transaction: the trash row. drafts/published: the stored rows read before the delete.
    async record({ uid, documentId, locales, drafts, published, incoming, actor, days }) {
      const dp = draftAndPublish(uid)
      const entries = [...drafts.map(row => [row, dp ? 'draft' : null]), ...published.map(row => [row, 'published'])]
        .map(([row, status]) => ({ locale: row.locale ?? null, status, snapshot: canonical(row, schemaOf(uid), schemaOf) }))
      const main = await events().mainField(uid)
      const first = chooseEntries(entries)
      const source = first.get(await events().scope(uid).then(list => list?.[0] ?? null).catch(() => null)) || [...first.values()][0]
      const title = main && source?.snapshot?.[main] != null ? String(source.snapshot[main]).slice(0, 255) : null
      const deletedAt = new Date()
      return rows().create({ data: { contentType: uid, relatedDocumentId: documentId, title, locales: locales || [...new Set(entries.map(entry => entry.locale))], entries, incoming,
        ...actor, deletedAt, expiresAt: expiresAt(deletedAt, days), status: 'trashed', size: Buffer.byteLength(stable({ entries, incoming })) } })
    },
    // One page of trash rows, without their snapshots. `types`: the content types the user may read.
    async list({ contentType, status = 'trashed', page = 1, pageSize = 20, types }) {
      const where = { status, contentType: contentType ? contentType : { $in: types } }
      if (contentType && !types.includes(contentType)) return { results: [], pagination: { page, pageSize, total: 0, pageCount: 0 } }
      const [results, total] = await Promise.all([
        rows().findMany({ select: ['id', 'contentType', 'relatedDocumentId', 'title', 'locales', 'actor', 'actorName', 'deletedAt', 'expiresAt', 'status', 'restoredAs', 'restoredAt'],
          where, orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }], offset: (page - 1) * pageSize, limit: pageSize }),
        rows().count({ where }),
      ])
      return { results, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } }
    },
    async find(id) { return rows().findOne({ where: { id } }) },
    // One row for the preview: fields and blocks of each entry, and how many links it held.
    preview(row) {
      const schema = schemaOf(row.contentType)
      const { entries, incoming, ...meta } = row
      return { ...meta, incoming: (incoming || []).length,
        entries: (entries || []).map(entry => ({ locale: entry.locale ?? null, status: entry.status ?? null, ...previewOf(entry.snapshot, schema, schemaOf) })) }
    },
    // The pre-check: every lookup a restore needs, then planRestore. Read-only; the restore runs it again in its transaction.
    async plan(row) {
      const uid = row.contentType, schema = schemaOf(uid)
      if (!schema || !strapi.contentTypes?.[uid]) return { blocking: [{ code: 'typeGone' }], warnings: [], steps: [], incoming: { links: [], gone: 0, published: 0, replaced: 0 } }
      const i18n = localized(uid)
      const locales = i18n ? (await strapi.plugin('i18n').service('locales').find()).map(locale => locale.code) : null
      const defaultLocale = i18n ? await strapi.plugin('i18n').service('locales').getDefaultLocale() : null
      const current = await strapi.db.query(uid).findMany({ select: ['locale'], where: { documentId: row.relatedDocumentId } })
      const existing = current.length ? [...new Set(current.map(entry => i18n ? entry.locale : null))] : null
      const singleTaken = schema.kind === 'singleType' && !existing && Boolean(await strapi.db.query(uid).findOne({ select: ['id'] }))
      const chosen = [...chooseEntries(row.entries).values()]
      const { media, relation } = await lookups(uid, chosen.map(entry => entry.snapshot))
      const taken = new Set()
      for (const entry of chosen) for (const field of uniqueFields(schema)) {
        const value = entry.snapshot?.[field]
        if (blank(value) || typeof value === 'object') continue
        const other = await strapi.db.query(uid).findOne({ select: ['id'], where: { [field]: value, ...(i18n && { locale: entry.locale }), ...(existing && { documentId: { $ne: row.relatedDocumentId } }) } })
        if (other) taken.add(stable([field, entry.locale ?? null, value]))
      }
      const plan = planRestore(row.entries, { schema, schemaOf, locales, defaultLocale, existing, singleTaken, media, relation, taken: (field, locale, value) => taken.has(stable([field, locale ?? null, value])) })
      const incoming = await strapi.db.transaction(({ trx }) => resolveIncoming(uid, row.incoming, plan.steps.map(step => step.locale), trx))
      return { ...plan, documentId: existing ? row.relatedDocumentId : null, incoming }
    },
    // What the pre-check endpoint returns: the plan without the data it would write.
    async check(row) {
      if (row.status !== 'trashed') return { status: row.status, restoredAs: row.restoredAs, blocking: [{ code: 'restored' }], warnings: [] }
      const { steps, incoming: { links, ...incoming }, ...plan } = await self.plan(row)
      return { ...plan, locales: steps.map(step => step.locale), incoming: { ...incoming, reconnect: links.length } }
    },
    // Restore as a draft, in one transaction: claim the row (a second restore of the same row, concurrent or later, gets
    // `already` with the first one's document), check again, recreate (default locale first, the others under the same
    // documentId), put the links back, record `restore` events. A blocking problem throws `conflict` and nothing is written.
    async restore(id, { actor, userId }) {
      return restoring.run(true, () => strapi.db.transaction(async ({ trx }) => {
        const claimed = await rows().updateMany({ where: { id, status: 'trashed' }, data: { status: 'restored', restoredAt: new Date() } })
        const row = await rows().findOne({ where: { id } })
        if (!row) return null
        if (!claimed?.count) return { already: true, documentId: row.restoredAs || null }
        const plan = await self.plan(row)
        if (plan.blocking.length) { const error = new Error('conflict'); error.conflict = { blocking: plan.blocking, warnings: plan.warnings }; throw error }
        const uid = row.contentType, documents = strapi.documents(uid)
        const creator = userId ? { createdBy: userId, updatedBy: userId } : {}
        let documentId = plan.documentId
        for (const { locale, data } of plan.steps) {
          const params = { ...(locale && { locale }), data: { ...data, ...creator } }
          if (documentId) await documents.update({ documentId, ...params })
          else documentId = (await documents.create(params)).documentId
        }
        const restored = await events().rows(uid, documentId, localized(uid) ? plan.steps.map(step => step.locale) : null)
        const rowOf = new Map(restored.map(entry => [entry.locale ?? null, entry]))
        for (const link of plan.incoming.links) {
          const target = rowOf.get(link.locale)
          if (!target) continue
          const { joinColumn, inverseJoinColumn, orderColumnName } = link.joinTable
          await table(trx, link.joinTable.name).insert({ [joinColumn.name]: link.ownerRowId, [inverseJoinColumn.name]: target.id, ...(orderColumnName && link.order != null && { [orderColumnName]: link.order }) })
        }
        for (const entry of restored) await events().record({ uid, documentId, locale: entry.locale ?? null, action: 'restore', entry, actor, extra: { restoredFrom: row.relatedDocumentId, trash: row.id } })
        await rows().update({ where: { id }, data: { restoredAs: documentId } })
        const { links, ...incoming } = plan.incoming
        return { documentId, locales: plan.steps.map(step => step.locale), warnings: plan.warnings, incoming: { ...incoming, reconnected: links.length } }
      }))
    },
    // Delete forever (one row), recorded as a `purge` event. Never touches media files.
    async remove(row, actor) {
      return strapi.db.transaction(async () => {
        const { count } = await rows().deleteMany({ where: { id: row.id } })
        if (count) await events().record({ uid: row.contentType, documentId: row.relatedDocumentId, action: 'purge', actor, extra: { trash: row.id, title: row.title } })
        return count
      })
    },
    // Nightly, in batches, idempotent: rows past expiresAt are deleted (restored ones too). Never touches media files.
    async purge(now = Date.now()) {
      let count = 0
      for (;;) {
        const ids = (await rows().findMany({ select: ['id'], where: { expiresAt: { $lt: new Date(now) } }, orderBy: { id: 'asc' }, limit: BATCH })).map(row => row.id)
        if (ids.length) await rows().deleteMany({ where: { id: { $in: ids } } })
        count += ids.length
        if (ids.length < BATCH) return count
      }
    },
  }
  return self
}

const ID = /^[1-9]\d{0,15}$/
const API_UID = /^api::[\w-]+\.[\w-]+$/
const int = (value, fallback, max) => { if (value === undefined || value === '') return fallback; const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= max ? n : NaN }
const trashController = ({ strapi }) => {
  const service = () => strapi.plugin(PLUGIN).service('trash')
  const { can, readableTypes, actorOf } = history()
  // The row, if the user may read its content type in the Content Manager (else it does not exist for them).
  const load = async (ctx, action = 'read') => {
    if (!ID.test(String(ctx.params?.id || ''))) { ctx.badRequest('Invalid trash entry'); return null }
    const row = await service().find(Number(ctx.params.id))
    if (!row || !can(strapi, ctx, row.contentType, 'read') || (action !== 'read' && !can(strapi, ctx, row.contentType, action))) { ctx.notFound(); return null }
    return row
  }
  return {
    async list(ctx) {
      const { contentType = '', status = 'trashed' } = ctx.query || {}
      const page = int(ctx.query?.page, 1, 10000), pageSize = int(ctx.query?.pageSize, 20, 100)
      if (typeof contentType !== 'string' || (contentType && !API_UID.test(contentType)) || !STATUSES.includes(status) || Number.isNaN(page) || Number.isNaN(pageSize)) return ctx.badRequest('Invalid filters')
      const types = readableTypes(strapi, ctx)
      ctx.body = { ...await service().list({ contentType, status, page, pageSize, types }),
        types: types.map(uid => ({ uid, displayName: strapi.contentTypes[uid].info?.displayName || uid, kind: strapi.contentTypes[uid].kind, localized: Boolean(strapi.contentTypes[uid].pluginOptions?.i18n?.localized) })) }
    },
    async find(ctx) { const row = await load(ctx); if (row) ctx.body = service().preview(row) },
    async check(ctx) { const row = await load(ctx, 'create'); if (row) ctx.body = await service().check(row) },
    async restore(ctx) {
      const row = await load(ctx, 'create')
      if (!row) return
      try {
        const result = await service().restore(row.id, { actor: actorOf(strapi), userId: ctx.state?.user?.id })
        if (!result) return ctx.notFound()
        ctx.body = result
      } catch (error) {
        if (!error?.conflict) throw error
        ctx.status = 409
        ctx.body = { data: null, error: { status: 409, name: 'ConflictError', message: 'The document cannot be restored as it is: nothing was written.', details: error.conflict } }
      }
    },
    async remove(ctx) {
      const row = await load(ctx, 'delete')
      if (!row) return
      ctx.body = { deleted: await service().remove(row, actorOf(strapi)) }
    },
  }
}

module.exports = { TRASH_UID, STATUSES, restoring, trashContentType, expiresAt, uniqueFields, chooseEntries, restorePayload, planRestore, incomingSources, incomingRows, previewOf, trashService, trashController }
