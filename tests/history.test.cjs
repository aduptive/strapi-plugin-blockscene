const assert = require('node:assert/strict')
const { test } = require('node:test')
const { snapshotPopulate, canonical, stable, diffRows, summarize } = require('../server/diff')
const { covers, retention, actorOf, refsOf, collapseVersions, historyService, eventContentType, CAPTURED } = require('../server/history')

// A page with a Dynamic Zone, a nested repeatable component, relations and media (the shapes Strapi 5 schemas use).
const schemas = {
  'api::page.page': { options: { draftAndPublish: true }, pluginOptions: { i18n: { localized: true } }, attributes: {
    title: { type: 'string' }, slug: { type: 'uid' }, cover: { type: 'media', multiple: false }, gallery: { type: 'media', multiple: true },
    author: { type: 'relation', relation: 'manyToOne', target: 'api::person.person' },
    owner: { type: 'relation', relation: 'morphToOne' }, secret: { type: 'password' },
    seo: { type: 'component', component: 'shared.seo' },
    blocks: { type: 'dynamiczone', components: ['blocks.hero', 'blocks.text', 'blocks.close'] },
    createdAt: { type: 'datetime' }, createdBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user', visible: false }, locale: { type: 'string' } } },
  'shared.seo': { attributes: { metaTitle: { type: 'string' }, image: { type: 'media' } } },
  'shared.item': { attributes: { label: { type: 'string' }, link: { type: 'relation', relation: 'oneToOne', target: 'api::page.page' } } },
  'blocks.hero': { attributes: { heading: { type: 'string' }, image: { type: 'media' }, items: { type: 'component', component: 'shared.item', repeatable: true }, bsHidden: { type: 'boolean' } } },
  'blocks.text': { attributes: { body: { type: 'text' } } },
  'blocks.close': { attributes: {} },
}
const schemaOf = (uid) => schemas[uid]
const page = schemas['api::page.page']

test('history: snapshot populate reads components and zones recursively, relations as documentIds, media as ids', () => {
  const populate = snapshotPopulate('api::page.page', schemaOf)
  assert.deepEqual(populate.author, { select: ['documentId', 'locale'] })
  assert.deepEqual(populate.cover, { select: ['id'] })
  assert.equal(populate.owner, undefined, 'morph relations are left out')
  assert.equal(populate.createdBy, undefined, 'bookkeeping is left out')
  assert.deepEqual(populate.seo, { select: ['metaTitle'], populate: { image: { select: ['id'] } } })
  const hero = populate.blocks.on['blocks.hero']
  assert.deepEqual(hero.select, ['heading', 'bsHidden'], 'no component ids')
  assert.deepEqual(hero.populate.items.populate.link, { select: ['documentId', 'locale'] })
  assert.deepEqual(populate.blocks.on['blocks.close'].select, ['id'], 'a component without scalars still selects a column')
  // A component nesting itself does not recurse forever.
  const cyclic = { 'x.a': { attributes: { child: { type: 'component', component: 'x.a' } } }, 'api::c.c': { attributes: { a: { type: 'component', component: 'x.a' } } } }
  assert.deepEqual(snapshotPopulate('api::c.c', uid => cyclic[uid]).a.populate.child.populate, {})
})

const stored = {
  id: 7, documentId: 'doc1', locale: 'en', title: 'Home', slug: 'home', createdAt: '2026-01-01', publishedAt: null, secret: 'x',
  cover: { id: 3 }, gallery: [{ id: 4 }, { id: 5 }], author: { id: 9, documentId: 'p1', locale: 'en' }, seo: { id: 1, metaTitle: 'Home', image: null },
  blocks: [{ id: 11, __component: 'blocks.hero', heading: 'Hi', image: { id: 3 }, items: [{ id: 2, label: 'A', link: { id: 8, documentId: 'doc2', locale: null } }], bsHidden: false },
    { id: 12, __component: 'blocks.text', body: '' }, { id: 13, __component: 'blocks.close' }],
}
const snapshot = {
  title: 'Home', slug: 'home', cover: 3, gallery: [4, 5], author: { documentId: 'p1', locale: 'en' }, seo: { metaTitle: 'Home' },
  blocks: [{ __component: 'blocks.hero', heading: 'Hi', image: 3, items: [{ label: 'A', link: { documentId: 'doc2' } }], bsHidden: false },
    { __component: 'blocks.text' }, { __component: 'blocks.close' }],
}

test('history: canonical snapshot of a stored entry and of the edit form', () => {
  assert.deepEqual(canonical(stored, page, schemaOf), snapshot)
  // The form: ids, temp keys, media objects, relation changes instead of relations, removed nulls.
  const form = { id: 7, title: 'Home', slug: 'home', cover: { id: 3, url: '/u/3.png' }, gallery: [{ id: 4 }, { id: 5 }], author: { connect: [], disconnect: [] }, seo: { id: 1, metaTitle: 'Home' },
    blocks: [{ id: 11, __temp_key__: 'a0', __component: 'blocks.hero', heading: 'Hi', image: { id: 3 }, items: [{ id: 2, __temp_key__: 'a0', label: 'A', link: { connect: [], disconnect: [] } }], bsHidden: false },
      { id: 12, __temp_key__: 'a1', __component: 'blocks.text' }, { __temp_key__: 'a2', __component: 'blocks.close' }] }
  assert.equal(stable(canonical(form, page, schemaOf, { relations: false })), stable(canonical(snapshot, page, schemaOf, { relations: false })))
  assert.equal(stable({ b: 1, a: { d: 2, c: 3 } }), stable({ a: { c: 3, d: 2 }, b: 1 }), 'key order does not change the text (nor the hash)')
})

test('history: block diff pairs identical rows, then changed rows by component', () => {
  const hero = (heading) => ({ __component: 'blocks.hero', heading }), text = (body) => ({ __component: 'blocks.text', body })
  const ops = (before, after) => diffRows(before, after).map(({ op, from, to }) => `${op}:${from ?? ''}>${to ?? ''}`)
  assert.deepEqual(ops([hero('a'), text('b')], [hero('a'), text('b')]), ['same:0>0', 'same:1>1'])
  assert.deepEqual(ops([hero('a'), text('b')], [hero('a'), text('c')]), ['same:0>0', 'changed:1>1'])
  assert.deepEqual(ops([hero('a'), text('b')], [text('b')]), ['removed:0>', 'same:1>0'])
  assert.deepEqual(ops([text('b')], [hero('x'), text('b')]), ['added:>0', 'same:0>1'])
  assert.deepEqual(ops([hero('a'), text('b')], [text('b'), hero('a')]).filter(op => !op.startsWith('same')).length, 2, 'a move is one removal and one addition')
  assert.deepEqual(ops([], []), [])
  const before = { title: 'A', slug: 's', blocks: [hero('a'), text('b')] }
  assert.deepEqual(summarize(null, before, page), { initial: true, fields: [], blocks: { total: 2, added: 2, removed: 0, changed: 0 } })
  assert.deepEqual(summarize(before, { title: 'B', blocks: [hero('z'), text('b'), text('c')] }, page), { fields: ['slug', 'title'], blocks: { total: 3, added: 1, removed: 0, changed: 1 } })
  assert.deepEqual(summarize(before, before, page), { fields: [], blocks: { total: 2, added: 0, removed: 0, changed: 0 } })
})

test('history: media ids and relation targets a snapshot references', () => {
  const refs = refsOf(snapshot, page, schemaOf)
  assert.deepEqual(refs.media.sort(), [3, 4, 5])
  assert.deepEqual(refs.relations, [{ target: 'api::person.person', documentId: 'p1', locale: 'en' }, { target: 'api::page.page', documentId: 'doc2' }])
})

// In-memory event table: enough of `strapi.db.query` for record() (where equality, size > 0, newest first).
function fakeStrapi() {
  const rows = []
  const match = (row, where) => Object.entries(where || {}).every(([key, value]) => value && typeof value === 'object' && '$gt' in value ? row[key] > value.$gt : row[key] === value)
  const events = {
    findMany: async ({ where, offset = 0, limit = Infinity }) => rows.filter(row => match(row, where)).sort((a, b) => b.id - a.id).slice(offset, offset + limit),
    count: async ({ where }) => rows.filter(row => match(row, where)).length,
    findOne: async ({ where }) => rows.filter(row => match(row, where)).sort((a, b) => b.id - a.id)[0] || null,
    create: async ({ data }) => { const row = { id: rows.length + 1, ...data }; rows.push(row); return row },
  }
  return { rows, strapi: { getModel: schemaOf, db: { query: () => events } } }
}

test('history: identical snapshots are stored once (hash dedupe), the event is still written', async () => {
  const { rows, strapi } = fakeStrapi()
  const service = historyService({ strapi })
  const actor = { actor: 'admin:1', actorName: 'Ana' }
  const at = { uid: 'api::page.page', documentId: 'doc1', locale: 'en', actor }
  await service.record({ ...at, action: 'create', entry: stored })
  await service.record({ ...at, action: 'publish', entry: { ...stored, id: 99, publishedAt: '2026-01-02', blocks: stored.blocks.map(row => ({ ...row, id: row.id + 100 })) } })
  await service.record({ ...at, action: 'update', entry: { ...stored, title: 'Home 2' } })
  await service.record({ ...at, locale: 'fr', action: 'create', entry: stored })
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[0].snapshot, snapshot); assert.equal(rows[0].summary.initial, true); assert.ok(rows[0].size > 0)
  assert.equal(rows[1].snapshot, null, 'same content (only ids and timestamps differ): not stored again'); assert.equal(rows[1].size, 0)
  assert.equal(rows[1].hash, rows[0].hash)
  assert.deepEqual(rows[1].summary, { fields: [], blocks: { total: 3, added: 0, removed: 0, changed: 0 } })
  assert.equal(rows[2].snapshot.title, 'Home 2'); assert.deepEqual(rows[2].summary.fields, ['title'])
  assert.ok(rows[3].snapshot, 'another locale has its own versions'); assert.equal(rows[3].actorName, 'Ana')
  await service.record({ ...at, action: 'update', missing: true })
  assert.deepEqual(rows[4].summary, { missing: true }); assert.equal(rows[4].snapshot, null); assert.equal(rows[4].hash, null)
})

test('history: consecutive events with identical content become one version card', () => {
  const events = [
    { id: 5, action: 'publish', hash: 'a' },
    { id: 4, action: 'update', hash: 'a' },
    { id: 3, action: 'update', hash: 'b' },
    { id: 2, action: 'restore', hash: 'a' },
    { id: 1, action: 'update', hash: null },
  ]

  const collapsed = collapseVersions(events)
  assert.deepEqual(collapsed.map(event => event.id), [5, 3, 2, 1])
  assert.deepEqual(collapsed.map(event => event.actions), [
    ['publish', 'update'],
    ['update'],
    ['restore'],
    ['update'],
  ])
})

test('history: server pagination reaches past 100; actor choices and snapshots stay in document/locale scope', async () => {
  const { rows, strapi } = fakeStrapi()
  const service = historyService({ strapi })
  for (let id = 1; id <= 127; id++) rows.push({ id, contentType: 'api::page.page', relatedDocumentId: 'doc1', locale: 'en',
    actor: `admin:${id % 2 + 1}`, actorName: id % 2 ? 'Ana' : 'Bob', hash: `version-${id}`, size: 20 })
  rows.push({ id: 128, contentType: 'api::page.page', relatedDocumentId: 'other', locale: 'en', actor: 'admin:9', actorName: 'Other doc', hash: 'other', size: 20 },
    { id: 129, contentType: 'api::page.page', relatedDocumentId: 'doc1', locale: 'fr', actor: 'admin:8', actorName: 'French', hash: 'fr', size: 20 })
  const scope = { uid: 'api::page.page', documentId: 'doc1', locale: 'en' }
  const first = await service.list(scope)
  assert.equal(first.results.length, 25); assert.equal(first.results[0].id, 127)
  assert.deepEqual(first.pagination, { page: 1, pageSize: 25, total: 127, pageCount: 6 })
  assert.equal(first.results[0].stored, true, 'deduplicated snapshot still available')
  assert.deepEqual(first.actors.map(p => p.actor).sort(), ['admin:1', 'admin:2'])
  const last = await service.list({ ...scope, page: 6 })
  assert.deepEqual(last.results.map(row => row.id), [2, 1], 'no silent cut at 100')
  const filtered = await service.list({ ...scope, actor: 'admin:1' })
  assert.equal(filtered.pagination.total, 63); assert.ok(filtered.results.every(row => row.actor === 'admin:1'))
  assert.equal(filtered.actors.length, 2, 'filter choices remain scoped to this document, not the selected actor')
  const unknown = await service.list({ ...scope, actor: 'admin:9' })
  assert.equal(unknown.results.length, 0); assert.equal(unknown.pagination.total, 0)
})

test('history: list validates pagination/actors and refuses unreadable documents before querying', async () => {
  const { historyController } = require('../server/history')
  let denied = false, calls = 0, received
  const service = { scope: async () => ['en'], list: async args => { calls++; received = args; return { results: [], pagination: { total: 0 } } } }
  const strapi = { contentTypes: { 'api::page.page': page }, plugin: name => name === 'blockscene' ? { service: () => service }
    : { service: () => ({ create: () => ({ cannot: { read: () => denied } }) }) } }
  const controller = historyController({ strapi })
  const ctx = query => ({ params: { uid: 'api::page.page', documentId: 'doc1' }, query, state: {}, badRequest: () => 'bad', forbidden: () => 'denied' })
  for (const query of [{ page: 0 }, { page: '1.5' }, { pageSize: 101 }, { actor: 'admin:abc' }, { actor: ['admin:1'] }, { locale: 'en/other' }])
    assert.equal(await controller.list(ctx(query)), 'bad')
  assert.equal(calls, 0)
  denied = true; assert.equal(await controller.list(ctx({})), 'denied'); assert.equal(calls, 0)
  denied = false; const allowed = ctx({ page: '5', pageSize: '25', actor: 'admin:1' }); await controller.list(allowed)
  assert.deepEqual(received, { uid: 'api::page.page', documentId: 'doc1', locale: 'en', actor: 'admin:1', page: 5, pageSize: 25 })
  assert.deepEqual(allowed.body, { results: [], pagination: { total: 0 } })
})

test('historical preview: protocol gate refuses every edit/focus/hover message and stale channel', async () => {
  const { previewMessageAllowed, PROTOCOL, projectPage } = await import('../admin/preview.mjs')
  const source = {}, origin = 'https://cms.example', channel = 'version-1'
  const event = type => ({ origin, source, data: { protocol: PROTOCOL, channel, type } })
  assert.equal(previewMessageAllowed(event('ready'), origin, source, channel, true), true)
  for (const type of ['insert', 'paste', 'insert-group', 'move-group', 'delete-group', 'edit', 'media', 'media-remove', 'focus', 'select', 'hover', 'unknown']) {
    assert.equal(previewMessageAllowed(event(type), origin, source, channel, true), false, type)
    assert.equal(previewMessageAllowed(event(type), origin, source, channel, false), true, 'live preview keeps its existing validation')
  }
  for (const patch of [{ origin: 'https://evil.example' }, { source: {} }, { data: { protocol: PROTOCOL, channel: 'old', type: 'ready' } }])
    assert.equal(previewMessageAllowed({ ...event('ready'), ...patch }, origin, source, channel, true), false)
  const { loadVersion } = await import('../admin/versions.mjs')
  const draft = { blocks: [{ id: 40, __component: 'blocks.hero', heading: 'Unsaved' }] }, before = structuredClone(draft)
  const version = loadVersion(snapshot, { schema: page, components: schemas, media: { 3: { id: 3, url: '/uploads/picture.png' } }, editable: name => name === 'blocks' })
  const blocks = projectPage(version.values.blocks, schemas, origin)
  assert.equal(blocks[0].data.image.url, 'https://cms.example/uploads/picture.png')
  assert.equal(blocks[0].data.heading, 'Hi'); assert.deepEqual(draft, before, 'hydration/projection never writes the draft')
})

test('history: settings validation, lenient read, coverage and retention', () => {
  const { validateSettings, mergeSaved, DEFAULTS } = require('../server/settings')
  const types = ['api::page.page', 'api::post.post']
  assert.deepEqual(DEFAULTS.history, { enabled: false, contentTypes: 'all', retentionDays: 90, maxSnapshots: 100, eventDays: 365, trashDays: 90 })
  const ok = validateSettings({ history: { enabled: true, contentTypes: ['api::post.post', 'api::post.post'], retentionDays: 30, maxSnapshots: 5, eventDays: 30 } }, [], [], types)
  assert.deepEqual(ok.history, { enabled: true, contentTypes: ['api::post.post'], retentionDays: 30, maxSnapshots: 5, eventDays: 30, trashDays: 90 })
  for (const bad of [{ history: 'on' }, { history: [] }, { history: { enabled: 'yes' } }, { history: { extra: 1 } }, { history: { contentTypes: 'some' } },
    { history: { contentTypes: ['api::gone.gone'] } }, { history: { contentTypes: ['plugin::blockscene.event'] } }, { history: { retentionDays: 0 } },
    { history: { retentionDays: 1.5 } }, { history: { retentionDays: '90' } }, { history: { retentionDays: 3651, eventDays: 3651 } }, { history: { maxSnapshots: 1001 } },
    { history: { eventDays: 30 } }, { history: { retentionDays: 400 } }])
    assert.throws(() => validateSettings(bad, [], [], types), { name: 'ValidationError' }, `rejects ${JSON.stringify(bad)}`)
  const merged = mergeSaved({ history: { enabled: true, contentTypes: ['api::gone.gone', 'api::page.page'], retentionDays: 'x', maxSnapshots: 7, eventDays: 10 } }, [], [], types)
  assert.deepEqual(merged.history, { enabled: true, contentTypes: ['api::page.page'], retentionDays: 90, maxSnapshots: 7, eventDays: 90, trashDays: 90 })
  assert.equal(covers({ enabled: true, contentTypes: 'all' }, 'api::page.page'), true)
  assert.equal(covers({ enabled: true, contentTypes: 'all' }, 'plugin::blockscene.event'), false, 'never the plugin\'s own types')
  assert.equal(covers({ enabled: true, contentTypes: ['api::post.post'] }, 'api::page.page'), false)
  assert.equal(covers({ enabled: false, contentTypes: 'all' }, 'api::page.page'), false)
  const now = Date.UTC(2026, 8, 28)
  const { snapshotsBefore, eventsBefore } = retention({ retentionDays: 90, eventDays: 365 }, now)
  assert.equal(snapshotsBefore.toISOString(), '2026-06-30T00:00:00.000Z'); assert.equal(eventsBefore.toISOString(), '2025-09-28T00:00:00.000Z')
})

test('history: actor from the request context; the event type stays out of the Content Manager', () => {
  const as = (ctx) => actorOf({ requestContext: { get: () => ctx } })
  assert.deepEqual(as({ state: { auth: { strategy: { name: 'admin' } }, user: { id: 4, firstname: 'Ana', lastname: 'Lima' } } }), { actor: 'admin:4', actorName: 'Ana Lima' })
  assert.deepEqual(as({ state: { auth: { strategy: { name: 'api-token' }, credentials: { id: 2, name: 'Importer' } } } }), { actor: 'token:2', actorName: 'Importer' })
  assert.deepEqual(as({ state: { auth: { strategy: { name: 'users-permissions' } }, user: { id: 5, username: 'reader' } } }), { actor: 'user:5', actorName: 'reader' })
  assert.deepEqual(as(undefined), { actor: 'system', actorName: '' })
  assert.deepEqual(actorOf({ requestContext: { get: () => { throw new Error('no store') } } }), { actor: 'system', actorName: '' })
  const { schema } = eventContentType
  assert.equal(schema.pluginOptions['content-manager'].visible, false); assert.equal(schema.pluginOptions['content-type-builder'].visible, false)
  assert.ok(!('documentId' in schema.attributes), 'documentId is reserved by Strapi 5')
  assert.deepEqual(schema.indexes[0].columns, ['content_type', 'related_document_id', 'locale', 'at'])
  assert.deepEqual(Object.keys(CAPTURED).sort(), ['clone', 'create', 'delete', 'discardDraft', 'publish', 'unpublish', 'update'])
})

test('history: a version loads into the form as new rows, relations as changes, missing items reported', async () => {
  const { loadVersion, formDiff } = await import('../admin/versions.mjs')
  const current = { title: 'Now', slug: 'home', extra: 'kept', cover: { id: 9 }, author: { connect: [], disconnect: [] },
    blocks: [{ id: 50, __temp_key__: 'a0', __component: 'blocks.text', body: 'now' }] }
  const version = { ...snapshot, gone: 'x', blocks: [...snapshot.blocks, { __component: 'blocks.removed' }] }
  const { values, report } = loadVersion(version, { schema: page, components: schemas, current,
    media: { 3: { id: 3, url: '/u/3.png' }, 4: { id: 4, url: '/u/4.png' } },
    relations: { 'api::person.person': [{ id: 21, documentId: 'p1', locale: 'en', label: 'Ana' }], 'api::page.page': [] },
    server: { author: [{ id: 20, documentId: 'p0', locale: 'en', status: 'draft' }] }, editable: name => name !== 'slug' })
  assert.equal(values.title, 'Home'); assert.equal(values.extra, 'kept'); assert.equal(values.slug, 'home', 'not editable: left as it is')
  assert.deepEqual(values.cover, { id: 3, url: '/u/3.png' }); assert.deepEqual(values.gallery, [{ id: 4, url: '/u/4.png' }])
  assert.equal(values.author.connect.length, 1); assert.equal(values.author.connect[0].apiData.documentId, 'p1'); assert.equal(values.author.connect[0].label, 'Ana')
  assert.deepEqual(values.author.disconnect, [{ id: 20, status: 'draft', apiData: { id: 20, documentId: 'p0', locale: 'en' } }])
  assert.equal(values.blocks.length, 3, 'a block whose component is no longer allowed is left out')
  assert.ok(values.blocks.every(row => row.id === undefined && typeof row.__temp_key__ === 'string'), 'new rows')
  assert.deepEqual(values.blocks[0].items[0].link, { connect: [], disconnect: [] }, 'a relation target that is gone is left out')
  assert.deepEqual(report, { left: ['slug'], removed: ['gone'], blocks: 1, media: 1, relations: 1 })
  // Relations whose server state could not be read are left as they are and reported.
  assert.deepEqual(loadVersion(snapshot, { schema: page, components: schemas, current, server: {} }).report.left, ['author'])
  // Clearing: an empty value in the version empties a filled form field.
  assert.equal(loadVersion({}, { schema: page, components: schemas, current: { title: 'x' } }).values.title, null)
  const diff = formDiff(snapshot, current, page, schemas)
  assert.deepEqual(diff.fields, ['title', 'cover', 'gallery', 'seo'], 'in schema order')
  assert.deepEqual(diff.zones[0].ops.map(op => op.op), ['added', 'changed', 'added'])
  assert.deepEqual(formDiff(snapshot, values, page, schemas).fields, ['gallery'], 'after loading only the missing media differs')
})
