const assert = require('node:assert/strict')
const { test } = require('node:test')
const { canonical } = require('../server/diff')
const { expiresAt, uniqueFields, chooseEntries, restorePayload, planRestore, incomingSources, incomingRows, previewOf, trashContentType, trashService } = require('../server/trash')

// A localized page with a unique slug, a required title, a Dynamic Zone, a nested repeatable component, relations and media.
const schemas = {
  'api::page.page': { kind: 'collectionType', options: { draftAndPublish: true }, pluginOptions: { i18n: { localized: true } }, attributes: {
    title: { type: 'string', required: true }, slug: { type: 'uid' }, code: { type: 'string', unique: true }, kind: { type: 'enumeration', enum: ['a', 'b'] },
    cover: { type: 'media', multiple: false }, gallery: { type: 'media', multiple: true },
    author: { type: 'relation', relation: 'manyToOne', target: 'api::person.person' },
    related: { type: 'relation', relation: 'manyToMany', target: 'api::page.page' },
    seo: { type: 'component', component: 'shared.seo', required: true },
    blocks: { type: 'dynamiczone', components: ['blocks.hero', 'blocks.text'] } } },
  'api::person.person': { kind: 'collectionType', attributes: { name: { type: 'string' } } },
  'shared.seo': { info: { displayName: 'SEO' }, attributes: { metaTitle: { type: 'string' }, image: { type: 'media' } } },
  'shared.item': { attributes: { label: { type: 'string' }, link: { type: 'relation', relation: 'oneToOne', target: 'api::page.page' } } },
  'blocks.hero': { info: { displayName: 'Hero' }, attributes: { heading: { type: 'string' }, image: { type: 'media' }, items: { type: 'component', component: 'shared.item', repeatable: true } } },
  'blocks.text': { info: { displayName: 'Text' }, attributes: { body: { type: 'text' } } },
  'blocks.old': { info: { displayName: 'Old' }, attributes: { x: { type: 'string' } } },
}
const schemaOf = (uid) => schemas[uid]
const page = schemas['api::page.page']
// A stored draft row (ids everywhere, as the database returns it) and its snapshot.
const row = {
  id: 7, documentId: 'doc1', locale: 'en', title: 'Home', slug: 'home', code: 'H1', kind: 'a', publishedAt: null,
  cover: { id: 3 }, gallery: [{ id: 4 }, { id: 5 }], author: { id: 9, documentId: 'p1', locale: null }, related: [{ id: 2, documentId: 'doc2', locale: 'en' }, { id: 8, documentId: 'gone', locale: 'en' }],
  seo: { id: 1, metaTitle: 'Home', image: { id: 6 } },
  blocks: [{ id: 11, __component: 'blocks.hero', heading: 'Hi', image: { id: 3 }, items: [{ id: 2, label: 'A', link: { id: 8, documentId: 'doc2', locale: 'en' } }, { id: 3, label: 'B', link: { documentId: 'gone', locale: 'en' } }] },
    { id: 12, __component: 'blocks.old', x: 'y' }, { id: 13, __component: 'blocks.text', body: 'Text' }],
}
const snapshot = canonical(row, page, (uid) => uid === 'blocks.old' ? schemas['blocks.old'] : schemaOf(uid))
const exists = { media: new Set([3, 4, 6]), relation: (target, ref) => ref.documentId !== 'gone' }

test('trash: restore payload builds new rows (no ids), keeps what exists, reports the rest', () => {
  const { data, report } = restorePayload(snapshot, page, schemaOf, exists)
  assert.equal(JSON.stringify(data).includes('"id"'), false, 'components and blocks become new rows')
  assert.deepEqual(data.author, { documentId: 'p1' }, 'to-one: one reference, no locale for a target without one')
  assert.deepEqual(data.related, [{ documentId: 'doc2', locale: 'en' }], 'to-many: the targets that still exist, with their locale')
  assert.equal(data.cover, 3); assert.deepEqual(data.gallery, [4], 'media ids that still exist')
  assert.deepEqual(data.seo, { metaTitle: 'Home', image: 6 })
  assert.deepEqual(data.blocks.map(block => block.__component), ['blocks.hero', 'blocks.text'], 'a component the zone no longer allows is left out')
  assert.deepEqual(data.blocks[0].items, [{ label: 'A', link: { documentId: 'doc2', locale: 'en' } }, { label: 'B', link: null }])
  assert.deepEqual(report, { removed: [], media: 1, relations: 2, blocks: 1 })
  // Schema changes since the delete: a removed field, an enum value no longer allowed, a component that no longer exists.
  const changed = { ...page, attributes: { ...page.attributes, kind: { type: 'enumeration', enum: ['b'] }, seo: { type: 'component', component: 'shared.gone' } } }
  const again = restorePayload({ ...snapshot, removedField: 'x' }, changed, schemaOf, exists)
  assert.deepEqual(again.report.removed.sort(), ['kind', 'removedField', 'seo'])
  assert.equal('kind' in again.data || 'removedField' in again.data || 'seo' in again.data, false)
  // Garbage in a snapshot never throws.
  assert.deepEqual(restorePayload(null, page, schemaOf).data, {})
  assert.deepEqual(restorePayload({ blocks: 'x', related: [null, 3], cover: 'x' }, page, schemaOf).data, { blocks: [], related: [], cover: null })
})

test('trash: the plan restores the draft of each locale, default locale first, and stops on conflicts', () => {
  const entries = [
    { locale: 'fr', status: 'draft', snapshot: { ...snapshot, slug: 'accueil', code: 'F1' } },
    { locale: 'en', status: 'published', snapshot: { ...snapshot, title: 'Live' } },
    { locale: 'en', status: 'draft', snapshot },
    { locale: 'de', status: 'draft', snapshot: { ...snapshot, title: '' } },
  ]
  assert.equal(chooseEntries(entries).get('en').snapshot.title, 'Home', 'the draft wins over the published row')
  assert.equal(chooseEntries([{ locale: null, status: 'published', snapshot: { title: 'P' } }]).get(null).snapshot.title, 'P', 'a published row alone is restored')
  const base = { schema: page, schemaOf, locales: ['en', 'fr'], defaultLocale: 'en', ...exists }
  const plan = planRestore(entries, base)
  assert.deepEqual(plan.blocking, [])
  assert.deepEqual(plan.steps.map(step => step.locale), ['en', 'fr'], 'default locale first; a locale no longer configured is skipped')
  assert.deepEqual(plan.warnings.find(w => w.code === 'published'), { code: 'published', locales: ['en'] })
  assert.deepEqual(plan.warnings.find(w => w.code === 'localeRemoved'), { code: 'localeRemoved', locale: 'de' })
  assert.deepEqual(plan.warnings.filter(w => w.code === 'media').map(w => w.locale), ['fr', 'en'])
  // Unique values taken by another document block the restore; so does a locale the document has again, and a single type.
  const taken = planRestore(entries, { ...base, taken: (field, locale, value) => field === 'slug' && locale === 'fr' && value === 'accueil' })
  assert.deepEqual(taken.blocking, [{ code: 'unique', locale: 'fr', field: 'slug', value: 'accueil' }])
  assert.deepEqual(planRestore(entries, { ...base, existing: ['fr'] }).blocking, [{ code: 'localeExists', locale: 'fr' }])
  assert.deepEqual(planRestore(entries, { ...base, singleTaken: true }).blocking[0], { code: 'singleExists' })
  assert.deepEqual(planRestore(entries, { ...base, singleTaken: true, existing: ['de'] }).blocking, [], 'restoring into the existing single type document')
  assert.deepEqual(planRestore(entries, { ...base, locales: ['it'] }).blocking, [{ code: 'nothing' }])
  // Drafts may miss required fields: reported, not blocking. Non-localized types: one step, locale null.
  const empty = planRestore([{ locale: null, status: null, snapshot: { slug: 'x' } }], { ...base, locales: null, defaultLocale: null })
  assert.deepEqual(empty.blocking, []); assert.deepEqual(empty.steps.map(step => step.locale), [null])
  assert.deepEqual(empty.warnings, [{ code: 'required', locale: null, fields: ['title', 'seo'] }])
  assert.deepEqual(uniqueFields(page), ['slug', 'code'])
})

test('trash: incoming links are the unidirectional relations to the type, with owner, field, locale and order', () => {
  const joinTable = (name, order) => ({ name, joinColumn: { name: 'owner_id' }, inverseJoinColumn: { name: 'page_id' }, ...(order && { orderColumnName: 'page_ord' }) })
  const models = [
    { uid: 'api::menu.menu', kind: 'contentType', attributes: { pages: { type: 'relation', relation: 'manyToMany', target: 'api::page.page', joinTable: joinTable('menus_pages_lnk', true) },
      home: { type: 'relation', relation: 'oneToOne', target: 'api::page.page', joinTable: joinTable('menus_home_lnk') },
      back: { type: 'relation', relation: 'oneToMany', target: 'api::page.page', mappedBy: 'menu', joinTable: joinTable('x') }, title: { type: 'string' } } },
    { uid: 'shared.item', kind: 'component', attributes: { link: { type: 'relation', relation: 'oneToOne', target: 'api::page.page', joinTable: joinTable('components_item_link_lnk') } } },
    { uid: 'api::page.page', kind: 'contentType', attributes: { related: { type: 'relation', relation: 'manyToMany', target: 'api::page.page', joinTable: joinTable('pages_related_lnk', true) },
      morph: { type: 'relation', relation: 'morphToMany', joinTable: joinTable('m') } } },
  ]
  const sources = incomingSources('api::page.page', models)
  assert.deepEqual(sources.map(s => `${s.owner}.${s.field}:${s.single}`), ['api::menu.menu.pages:false', 'api::menu.menu.home:true', 'shared.item.link:true', 'api::page.page.related:false'], 'bidirectional relations are in the snapshot')
  const deleted = new Map([[7, { locale: 'en', published: false }], [70, { locale: 'en', published: true }]])
  const menu = incomingRows({ ...sources[0], target: 'api::page.page' }, [{ id: 1, owner_id: 3, page_id: 7, page_ord: 2 }, { id: 2, owner_id: 30, page_id: 70, page_ord: 1 }, { id: 3, owner_id: 3, page_id: 99 }],
    deleted, new Map([[3, { documentId: 'm1', locale: 'en' }], [30, { documentId: 'm1', locale: 'en' }]]))
  assert.deepEqual(menu, [
    { owner: 'api::menu.menu', kind: 'contentType', field: 'pages', ownerId: 3, ownerDocumentId: 'm1', ownerLocale: 'en', locale: 'en', published: false, order: 2 },
    { owner: 'api::menu.menu', kind: 'contentType', field: 'pages', ownerId: 30, ownerDocumentId: 'm1', ownerLocale: 'en', locale: 'en', published: true, order: 1 },
  ])
  assert.deepEqual(incomingRows({ ...sources[2], target: 'api::page.page' }, [{ owner_id: 5, page_id: 7 }], deleted),
    [{ owner: 'shared.item', kind: 'component', field: 'link', ownerId: 5, locale: 'en', published: false, order: null }], 'a block: its component row id')
  assert.deepEqual(incomingRows({ ...sources[3], target: 'api::page.page' }, [{ owner_id: 70, page_id: 7 }, { owner_id: 4, page_id: 7 }], deleted, new Map([[4, { documentId: 'd4', locale: 'en' }]])).map(r => r.ownerId), [4],
    'links between the deleted rows themselves are left to the snapshot')
})

test('trash: retention, preview and the content type', () => {
  assert.equal(expiresAt('2026-09-28T10:00:00.000Z', 90).toISOString(), '2026-12-27T10:00:00.000Z')
  const { validateSettings, mergeSaved } = require('../server/settings')
  assert.equal(validateSettings({ history: { trashDays: 7 } }, []).history.trashDays, 7)
  for (const trashDays of [0, 3651, 1.5, '30', null]) assert.throws(() => validateSettings({ history: { trashDays } }, []), { name: 'ValidationError' }, `rejects ${trashDays}`)
  assert.equal(mergeSaved({ history: { trashDays: -1 } }, []).history.trashDays, 90, 'a bad saved value falls back to the default')
  const preview = previewOf(snapshot, page, schemaOf)
  assert.deepEqual(preview.blocks.map(block => block.name), ['Hero', 'Old', 'Text'])
  assert.deepEqual(preview.fields.find(field => field.name === 'gallery'), { name: 'gallery', type: 'media', count: 2 })
  assert.deepEqual(preview.fields.find(field => field.name === 'title'), { name: 'title', type: 'string', value: 'Home' })
  assert.equal(previewOf({ body: 'x'.repeat(500) }, { attributes: { body: { type: 'text' } } }, schemaOf).fields[0].value.length, 200)
  const { schema } = trashContentType
  assert.equal(schema.collectionName, 'blockscene_trash')
  assert.equal(schema.pluginOptions['content-manager'].visible, false); assert.equal(schema.pluginOptions['content-type-builder'].visible, false)
  assert.ok(!('documentId' in schema.attributes))
})

test('trash: the nightly purge deletes expired rows in batches and is idempotent', async () => {
  let rows = Array.from({ length: 1203 }, (_, i) => ({ id: i + 1, expiresAt: new Date(i < 1100 ? '2026-01-01' : '2027-01-01') }))
  const deletes = []
  const query = {
    findMany: async ({ where, limit }) => rows.filter(row => row.expiresAt < where.expiresAt.$lt).slice(0, limit),
    deleteMany: async ({ where }) => { deletes.push(where.id.$in.length); rows = rows.filter(row => !where.id.$in.includes(row.id)); return { count: where.id.$in.length } },
  }
  const service = trashService({ strapi: { db: { query: () => query } } })
  assert.equal(await service.purge(Date.parse('2026-09-28')), 1100)
  assert.deepEqual(deletes, [500, 500, 100])
  assert.equal(rows.length, 103)
  assert.equal(await service.purge(Date.parse('2026-09-28')), 0, 'a second run finds nothing')
})
