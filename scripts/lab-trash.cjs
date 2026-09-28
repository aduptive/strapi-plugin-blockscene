// Integration check of the trash and the activity page's API against a real Strapi 5 app and database (the
// FutureBrand lab: localized pages with Draft & Publish, a unidirectional modal -> form relation).
//
//   LAB=/path/to/lab/backend node scripts/lab-trash.cjs
//
// Needs this build in the lab (packages/strapi5/dist copied over node_modules/@aduptive/strapi-blockscene/dist) and the
// lab's `dist` compiled. It WRITES to the lab database (content, settings, admin users, schema additions made in memory
// for the test: a unique slug, a unidirectional page relation on locations and one on the SEO component): dump the
// database before and restore the dump after. The server listens on PORT (default 1491) for the permission checks.
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')

const appDir = process.env.LAB
if (!appDir) throw new Error('Set LAB to the lab backend directory')
process.chdir(appDir)
process.env.PORT = process.env.PORT || '1491'
const { createStrapi } = require(require.resolve('@strapi/strapi', { paths: [appDir] }))

const results = []
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`ok   ${name}`) }
  catch (error) { results.push([false, name]); console.log(`FAIL ${name}\n     ${String(error?.stack || error).split('\n').slice(0, 6).join('\n     ')}`) }
}

;(async () => {
  const strapi = createStrapi({ appDir, distDir: path.join(appDir, 'dist') })
  await strapi.register()
  // Test-only schema additions (in memory): what the lab lacks to exercise unique values and every kind of incoming link.
  strapi.contentTypes['api::page.page'].attributes.slug.unique = true
  strapi.contentTypes['api::location.location'].attributes.featured = { type: 'relation', relation: 'manyToMany', target: 'api::page.page' }
  strapi.components['shared.seo'].attributes.testLink = { type: 'relation', relation: 'oneToOne', target: 'api::page.page' }
  await strapi.bootstrap()
  await strapi.listen()
  const base = `http://127.0.0.1:${process.env.PORT}`
  const PAGE = 'api::page.page', LOCATION = 'api::location.location', FORM = 'api::form.form', MODAL = 'api::modal.modal', TRASH = 'plugin::blockscene.trash', EVENT = 'plugin::blockscene.event'
  const plugin = strapi.plugin('blockscene'), trash = plugin.service('trash'), history = plugin.service('history')
  const settings = plugin.service('settings')
  const current = await settings.get()
  await settings.set({ ...current, history: { ...current.history, enabled: true, trashDays: 30 } })
  const docs = (uid) => strapi.documents(uid)
  const seo = (title, extra = {}) => ({ metaTitle: title, showOnGoogle: true, ...extra })
  const hero = (title) => ({ __component: 'lab.hero', title, items: [{ label: `${title} 1` }, { label: `${title} 2` }] })
  const newPage = async (name, locales = ['en', 'pt-BR'], extra = {}) => {
    const created = await docs(PAGE).create({ locale: locales[0], data: { name, slug: `/${name.toLowerCase().replace(/\W+/g, '-')}`, pageSeo: seo(name), color: { value: 'white' }, blocks: [hero(name), { __component: 'blocks.rich-text', content: `<p>${name}</p>` }], ...extra } })
    for (const locale of locales.slice(1)) await docs(PAGE).update({ documentId: created.documentId, locale, data: { name: `${name} ${locale}`, slug: `/${name.toLowerCase().replace(/\W+/g, '-')}-${locale.toLowerCase()}`, pageSeo: seo(`${name} ${locale}`), color: { value: 'black' }, blocks: [hero(`${name} ${locale}`)] } })
    return created.documentId
  }
  const rowsOf = (uid, documentId) => strapi.db.query(uid).findMany({ where: { documentId }, populate: { blocks: true } })
  const trashOf = (documentId) => strapi.db.query(TRASH).findMany({ where: { relatedDocumentId: documentId }, orderBy: { id: 'desc' } })
  const featured = async (documentId) => (await docs(LOCATION).findOne({ documentId, locale: 'en', populate: { featured: { fields: ['name'] } } })).featured.map(page => page.documentId)

  // Admin users for the HTTP checks: a super admin, a reader (activity + trash read, pages only) and an editor without
  // any Blockscene permission. Access tokens come from Strapi's session manager (no passwords involved).
  const roles = strapi.admin.services.role
  const superRole = await roles.getSuperAdmin()
  const readerRole = await roles.create({ name: 'Blockscene test reader', description: 'lab-trash.cjs' })
  await roles.assignPermissions(readerRole.id, [
    ...['activity.read', 'trash.read'].map(action => ({ action: `plugin::blockscene.${action}`, subject: null, properties: {}, conditions: [] })),
    { action: 'plugin::content-manager.explorer.read', subject: PAGE, properties: { fields: ['name', 'slug'], locales: ['en', 'pt-BR'] }, conditions: [] },
  ])
  const editorRole = await roles.create({ name: 'Blockscene test editor', description: 'lab-trash.cjs' })
  await roles.assignPermissions(editorRole.id, [{ action: 'plugin::content-manager.explorer.read', subject: PAGE, properties: { fields: ['name'], locales: ['en'] }, conditions: [] }])
  const user = (email, role) => strapi.admin.services.user.create({ email, firstname: email.split('@')[0], lastname: 'Test', roles: [role], isActive: true, registrationToken: null })
  const tokenOf = async (u) => { const { token } = await strapi.sessionManager('admin').generateRefreshToken(String(u.id), 'lab-trash', { type: 'session' }); return (await strapi.sessionManager('admin').generateAccessToken(token)).token }
  const admin = await user('bs-admin@lab.test', superRole.id), reader = await user('bs-reader@lab.test', readerRole.id), editor = await user('bs-editor@lab.test', editorRole.id)
  const tokens = { admin: await tokenOf(admin), reader: await tokenOf(reader), editor: await tokenOf(editor) }
  const http = async (who, method, url, body) => {
    const response = await fetch(`${base}${url}`, { method, headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  let p0, p1, p2, p1Trash, location
  await check('delete without a locale trashes the DEFAULT locale only: draft and published rows, incoming links from documents and blocks', async () => {
    p0 = await newPage('Neighbour A'); p2 = await newPage('Neighbour B')
    p1 = await newPage('Trash One')
    await docs(PAGE).publish({ documentId: p1, locale: 'en' })
    await docs(PAGE).update({ documentId: p1, locale: 'en', data: { name: 'Trash One (draft edit)' } })
    location = await docs(LOCATION).create({ locale: 'en', data: { name: 'Lisbon', slug: '/lisbon', pageSeo: seo('Lisbon', { testLink: { documentId: p1, locale: 'en' } }), featured: [p0, p1, p2].map(documentId => ({ documentId, locale: 'en' })) } })
    await docs(LOCATION).publish({ documentId: location.documentId, locale: 'en' })
    assert.deepEqual(await featured(location.documentId), [p0, p1, p2])
    await docs(PAGE).delete({ documentId: p1 })
    const rows = await rowsOf(PAGE, p1)
    assert.ok(rows.length === 1 && rows[0].locale === 'pt-BR', 'pt-BR is still there')
    const [row] = await trashOf(p1)
    p1Trash = row
    assert.deepEqual(row.locales, ['en'])
    assert.equal(row.status, 'trashed'); assert.equal(row.title, 'Trash One (draft edit)')
    assert.deepEqual(row.entries.map(entry => `${entry.locale}:${entry.status}:${entry.snapshot.name}`).sort(), ['en:draft:Trash One (draft edit)', 'en:published:Trash One'])
    assert.equal(row.entries[0].snapshot.blocks.length, 2)
    const kinds = row.incoming.map(link => `${link.owner}.${link.field}:${link.published ? 'published' : 'draft'}`).sort()
    assert.deepEqual(kinds, ['api::location.location.featured:draft', 'api::location.location.featured:published', 'shared.seo.testLink:draft', 'shared.seo.testLink:published'])
    assert.ok(Math.abs(new Date(row.expiresAt) - new Date(row.deletedAt) - 30 * 86400000) < 1000, 'expires after the trash retention')
    assert.deepEqual(await featured(location.documentId), [p0, p2], 'Strapi removed the link with the document')
    const events = await strapi.db.query(EVENT).findMany({ where: { relatedDocumentId: p1, action: 'delete' } })
    assert.equal(events.length, 1)
  })

  await check('restore a locale into the document that still exists: draft content, links back in their place, idempotent', async () => {
    const report = await trash.check(p1Trash)
    assert.deepEqual(report.blocking, []); assert.equal(report.documentId, p1); assert.deepEqual(report.locales, ['en'])
    assert.deepEqual(report.warnings.find(w => w.code === 'published'), { code: 'published', locales: ['en'] })
    assert.deepEqual({ ...report.incoming }, { reconnect: 2, gone: 0, published: 2, replaced: 0 })
    const result = await trash.restore(p1Trash.id, { actor: { actor: 'system', actorName: '' } })
    assert.equal(result.documentId, p1, 'same document'); assert.equal(result.incoming.reconnected, 2)
    const en = await docs(PAGE).findOne({ documentId: p1, locale: 'en', populate: { blocks: { populate: '*' }, pageSeo: true } })
    assert.equal(en.name, 'Trash One (draft edit)', 'the draft content'); assert.equal(en.publishedAt, null, 'restored as a draft')
    assert.deepEqual(en.blocks.map(block => block.__component), ['lab.hero', 'blocks.rich-text']); assert.equal(en.blocks[0].items.length, 2)
    assert.equal((await docs(PAGE).findOne({ documentId: p1, locale: 'en', status: 'published' })), null)
    assert.deepEqual(await featured(location.documentId), [p0, p1, p2], 'back at its position in the list')
    const draft = await docs(LOCATION).findOne({ documentId: location.documentId, locale: 'en', populate: { pageSeo: { populate: { testLink: true } } } })
    assert.equal(draft.pageSeo.testLink?.documentId, p1, 'the block link is back')
    const again = await trash.restore(p1Trash.id, { actor: { actor: 'system', actorName: '' } })
    assert.deepEqual(again, { already: true, documentId: p1 })
    assert.equal((await rowsOf(PAGE, p1)).filter(row => row.locale === 'en').length, 1, 'no second copy')
    const [event] = await strapi.db.query(EVENT).findMany({ where: { relatedDocumentId: p1, action: 'restore' } })
    assert.equal(event.summary.restoredFrom, p1)
    assert.ok(await strapi.db.query(EVENT).findOne({ where: { relatedDocumentId: p1, locale: 'en', hash: event.hash, size: { $gt: 0 } } }), 'the restored version is in the history (deduplicated by hash)')
    assert.equal((await strapi.db.query(EVENT).findMany({ where: { relatedDocumentId: p1, action: 'create' } })).length, 1, 'the restore writes no create event of its own')
  })

  await check("concurrent restores of one entry make one document ('*' delete, every locale under one new documentId)", async () => {
    const p = await newPage('Trash Star')
    await docs(PAGE).delete({ documentId: p, locale: '*' })
    assert.equal((await rowsOf(PAGE, p)).length, 0)
    const [row] = await trashOf(p)
    assert.deepEqual([...row.locales].sort(), ['en', 'pt-BR'])
    const before = await strapi.db.query(PAGE).count()
    const [a, b] = await Promise.all([trash.restore(row.id, { actor: { actor: 'system' } }), trash.restore(row.id, { actor: { actor: 'system' } })])
    const made = [a, b].find(r => !r.already), other = [a, b].find(r => r.already)
    assert.ok(made && other, 'one restores, the other reports it'); assert.equal(other.documentId, made.documentId)
    assert.notEqual(made.documentId, p, 'a new documentId (Strapi does not take one on create)')
    const rows = await rowsOf(PAGE, made.documentId)
    assert.deepEqual(rows.map(r => r.locale).sort(), ['en', 'pt-BR']); assert.ok(rows.every(r => r.publishedAt === null))
    assert.equal(await strapi.db.query(PAGE).count(), before + 2)
    assert.equal(rows.find(r => r.locale === 'pt-BR').name, 'Trash Star pt-BR')
  })

  await check('a failed capture fails the delete: nothing deleted, no trash row', async () => {
    const p = await newPage('Keep Me')
    const record = trash.record
    trash.record = async () => { throw new Error('simulated capture failure') }
    try { await assert.rejects(docs(PAGE).delete({ documentId: p, locale: '*' }), /could not record this delete/) }
    finally { trash.record = record }
    const rows = await rowsOf(PAGE, p)
    assert.deepEqual(rows.map(r => r.locale).sort(), ['en', 'pt-BR']); assert.equal(rows.find(r => r.locale === 'en').blocks.length, 2)
    assert.equal((await trashOf(p)).length, 0)
    assert.equal((await strapi.db.query(EVENT).findMany({ where: { relatedDocumentId: p, action: 'delete' } })).length, 0, 'the delete event rolled back too')
  })

  await check('restore conflicts: a slug taken by another page blocks it and nothing is written; free again, it restores', async () => {
    const p = await newPage('Slug Clash', ['en'])
    await docs(PAGE).delete({ documentId: p, locale: '*' })
    const blocker = await docs(PAGE).create({ locale: 'en', data: { name: 'Blocker', slug: '/slug-clash', pageSeo: seo('B'), color: { value: 'white' } } })
    const [row] = await trashOf(p)
    const report = await trash.check(row)
    assert.deepEqual(report.blocking, [{ code: 'unique', locale: 'en', field: 'slug', value: '/slug-clash' }])
    const count = await strapi.db.query(PAGE).count(), events = await strapi.db.query(EVENT).count()
    const response = await http('admin', 'POST', `/blockscene/trash/${row.id}/restore`)
    assert.equal(response.status, 409); assert.deepEqual(response.body.error.details.blocking, report.blocking)
    assert.equal(await strapi.db.query(PAGE).count(), count, 'nothing written'); assert.equal(await strapi.db.query(EVENT).count(), events)
    assert.equal((await strapi.db.query(TRASH).findOne({ where: { id: row.id } })).status, 'trashed', 'the claim rolled back')
    await docs(PAGE).delete({ documentId: blocker.documentId, locale: '*' })
    const ok = await http('admin', 'POST', `/blockscene/trash/${row.id}/restore`)
    assert.equal(ok.status, 200); assert.ok(ok.body.documentId)
    const [event] = await strapi.db.query(EVENT).findMany({ where: { relatedDocumentId: ok.body.documentId, action: 'restore' } })
    assert.equal(event.actor, `admin:${admin.id}`)
  })

  await check('incoming owners: gone, pointing elsewhere now, and the report for relation targets and media that are gone', async () => {
    const form = async (name) => (await docs(FORM).create({ locale: 'en', data: { name } })).documentId
    const f1 = await form('Form One'), f2 = await form('Form Two'), f3 = await form('Form Three')
    const m1 = (await docs(MODAL).create({ locale: 'en', data: { slug: 'm1', pageSeo: seo('M1'), form: { documentId: f1, locale: 'en' } } })).documentId
    const m2 = (await docs(MODAL).create({ locale: 'en', data: { slug: 'm2', pageSeo: seo('M2'), form: { documentId: f2, locale: 'en' } } })).documentId
    await docs(FORM).delete({ documentId: f1, locale: '*' }); await docs(MODAL).delete({ documentId: m1, locale: '*' })
    await docs(FORM).delete({ documentId: f2, locale: '*' }); await docs(MODAL).update({ documentId: m2, locale: 'en', data: { form: { documentId: f3, locale: 'en' } } })
    const [r1] = await trashOf(f1), [r2] = await trashOf(f2)
    assert.deepEqual(r1.incoming.map(link => [link.owner, link.field, link.ownerDocumentId]), [[MODAL, 'form', m1]])
    assert.deepEqual((await trash.check(r1)).incoming, { gone: 1, published: 0, replaced: 0, reconnect: 0 })
    assert.deepEqual((await trash.check(r2)).incoming, { gone: 0, published: 0, replaced: 1, reconnect: 0 })
    await trash.restore(r2.id, { actor: { actor: 'system' } })
    assert.equal((await docs(MODAL).findOne({ documentId: m2, locale: 'en', populate: ['form'] })).form.documentId, f3, 'a to-one owner that points elsewhere is left alone')
    // A page whose SEO image and parent page are gone by restore time.
    const file = await strapi.db.query('plugin::upload.file').create({ data: { name: 'lab-trash.png', hash: `lab_trash_${Date.now()}`, ext: '.pdf', mime: 'application/pdf', size: 1, url: '/uploads/lab-trash.pdf', provider: 'local' } })
    const parent = await newPage('Parent Gone', ['en'])
    const child = await newPage('Child', ['en'], { pageSeo: seo('Child', { metaImage: file.id }), parent: { documentId: parent, locale: 'en' } })
    await docs(PAGE).delete({ documentId: child, locale: '*' })
    await docs(PAGE).delete({ documentId: parent, locale: '*' })
    await strapi.db.query('plugin::upload.file').delete({ where: { id: file.id } })
    const [row] = await trashOf(child)
    const report = await trash.check(row)
    assert.deepEqual(report.blocking, [])
    assert.deepEqual(report.warnings.filter(w => ['media', 'relations'].includes(w.code)), [{ code: 'media', locale: 'en', count: 1 }, { code: 'relations', locale: 'en', count: 1 }])
    const result = await trash.restore(row.id, { actor: { actor: 'system' } })
    const restored = await docs(PAGE).findOne({ documentId: result.documentId, locale: 'en', populate: { pageSeo: { populate: ['metaImage'] }, parent: true } })
    assert.equal(restored.pageSeo.metaImage, null); assert.equal(restored.parent, null)
  })

  await check('a removed locale is skipped and reported; a locale that exists again blocks', async () => {
    const p = await newPage('Locale Game')
    await docs(PAGE).delete({ documentId: p, locale: 'pt-BR' })
    const [row] = await trashOf(p)
    assert.deepEqual(row.locales, ['pt-BR'])
    await docs(PAGE).update({ documentId: p, locale: 'pt-BR', data: { name: 'Again', slug: '/again-pt', pageSeo: seo('Again'), color: { value: 'white' } } })
    assert.deepEqual((await trash.check(row)).blocking, [{ code: 'localeExists', locale: 'pt-BR' }])
    const plan = await trash.check({ ...row, entries: row.entries.map(entry => ({ ...entry, locale: 'fr' })) })
    assert.deepEqual(plan.blocking, [{ code: 'nothing' }]); assert.deepEqual(plan.warnings.find(w => w.code === 'localeRemoved'), { code: 'localeRemoved', locale: 'fr' })
  })

  await check('admin routes: permissions and Content Manager scope', async () => {
    for (const url of ['/blockscene/activity', '/blockscene/trash', `/blockscene/trash/${p1Trash.id}`]) assert.equal((await http('editor', 'GET', url)).status, 403, `editor ${url}`)
    const list = await http('reader', 'GET', '/blockscene/trash?status=restored')
    assert.equal(list.status, 200); assert.ok(list.body.results.length > 0)
    assert.ok(list.body.results.every(row => row.contentType === PAGE), 'only types the reader may read (forms are hidden)')
    assert.ok(list.body.results.every(row => !('entries' in row) && !('incoming' in row)), 'no snapshots in lists')
    assert.deepEqual(list.body.types.map(type => type.uid), [PAGE])
    const formRow = (await strapi.db.query(TRASH).findMany({ where: { contentType: FORM }, limit: 1 }))[0]
    assert.equal((await http('reader', 'GET', `/blockscene/trash/${formRow.id}`)).status, 404, 'a type the reader cannot read does not exist for them')
    assert.equal((await http('reader', 'GET', `/blockscene/trash/${p1Trash.id}`)).status, 200)
    for (const [method, url] of [['GET', `/blockscene/trash/${p1Trash.id}/check`], ['POST', `/blockscene/trash/${p1Trash.id}/restore`], ['DELETE', `/blockscene/trash/${p1Trash.id}`]])
      assert.equal((await http('reader', method, url)).status, 403, `reader ${method} ${url}`)
    const activity = await http('reader', 'GET', '/blockscene/activity?pageSize=100')
    assert.equal(activity.status, 200); assert.ok(activity.body.results.every(event => event.contentType === PAGE) && activity.body.results.length > 0)
    assert.ok(activity.body.results.every(event => !('snapshot' in event)))
    for (const bad of ['page=0', 'pageSize=101', 'action=nope', 'actor=admin', 'from=yesterday', 'contentType=plugin::x.y', `q=${'x'.repeat(101)}`, 'status=purged'])
      assert.equal((await http('admin', 'GET', `/blockscene/${bad.startsWith('status') ? 'trash' : 'activity'}?${bad}`)).status, 400, bad)
    assert.equal((await http('admin', 'GET', '/blockscene/trash/abc')).status, 400)
    assert.equal((await http('admin', 'GET', '/blockscene/trash/999999')).status, 404)
  })

  await check('activity: filters, titles and links', async () => {
    const all = await http('admin', 'GET', '/blockscene/activity?pageSize=100')
    assert.ok(all.body.enabled); assert.ok(all.body.actors.some(a => a.actor === `admin:${admin.id}`))
    const mine = await http('admin', 'GET', `/blockscene/activity?actor=admin:${admin.id}`)
    assert.ok(mine.body.results.length > 0 && mine.body.results.every(event => event.actor === `admin:${admin.id}`))
    const restores = await http('admin', 'GET', `/blockscene/activity?action=restore&contentType=${PAGE}`)
    assert.ok(restores.body.results.every(event => event.action === 'restore' && event.contentType === PAGE))
    const found = await http('admin', 'GET', '/blockscene/activity?q=draft%20edit')
    assert.ok(found.body.results.length > 0 && found.body.results.every(event => event.relatedDocumentId === p1), 'title search')
    const bad = found.body.results.filter(event => !event.title || event.exists !== ['en', 'pt-BR'].includes(event.locale))
    assert.deepEqual(bad.map(({ action, locale, title, exists }) => ({ action, locale, title, exists })), [], 'titles, and links while the locale exists')
    const gone = await http('admin', 'GET', '/blockscene/activity?q=Parent%20Gone')
    assert.ok(gone.body.results.length > 0 && gone.body.results.every(event => event.exists === false && event.title === 'Parent Gone'), 'deleted documents keep their title from the trash')
    const future = await http('admin', 'GET', `/blockscene/activity?from=${new Date(Date.now() + 86400000).toISOString()}`)
    assert.equal(future.body.pagination.total, 0)
    const paged = await http('admin', 'GET', '/blockscene/activity?pageSize=2&page=2')
    assert.equal(paged.body.results.length, 2); assert.equal(paged.body.pagination.page, 2)
  })

  await check('delete forever (one entry) and the nightly purge in batches, idempotent, media untouched', async () => {
    const [row] = await trashOf(p1)
    const files = await strapi.db.query('plugin::upload.file').count()
    const response = await http('admin', 'DELETE', `/blockscene/trash/${row.id}`)
    assert.equal(response.status, 200); assert.deepEqual(response.body, { deleted: 1 })
    assert.equal(await strapi.db.query(TRASH).findOne({ where: { id: row.id } }), null)
    const [purged] = await strapi.db.query(EVENT).findMany({ where: { relatedDocumentId: p1, action: 'purge' } })
    assert.equal(purged.actor, `admin:${admin.id}`); assert.equal(purged.summary.trash, row.id)
    assert.equal((await http('admin', 'DELETE', `/blockscene/trash/${row.id}`)).status, 404)
    const old = new Date('2020-01-01')
    await strapi.db.query(TRASH).createMany({ data: Array.from({ length: 1234 }, (_, i) => ({ contentType: PAGE, relatedDocumentId: `synthetic${i}`, actor: 'system', deletedAt: old, expiresAt: old, status: 'trashed', entries: [], incoming: [], locales: ['en'] })) })
    const keep = await strapi.db.query(TRASH).count({ where: { expiresAt: { $gte: new Date() } } })
    assert.equal(await trash.purge(), 1234)
    assert.equal(await trash.purge(), 0)
    assert.equal(await strapi.db.query(TRASH).count(), keep, 'entries within their retention stay')
    assert.equal(await strapi.db.query('plugin::upload.file').count(), files)
  })

  await check('module off: deletes are not trashed; restore still works for existing entries', async () => {
    await settings.set({ ...(await settings.get()), history: { ...(await settings.get()).history, enabled: false } })
    const p = await newPage('Off Delete', ['en'])
    await docs(PAGE).delete({ documentId: p, locale: '*' })
    assert.equal((await trashOf(p)).length, 0)
    assert.equal((await http('admin', 'GET', '/blockscene/activity')).body.enabled, false)
    const [row] = (await strapi.db.query(TRASH).findMany({ where: { contentType: PAGE, status: 'trashed', title: 'Parent Gone' } }))
    const restored = await http('admin', 'POST', `/blockscene/trash/${row.id}/restore`)
    assert.equal(restored.status, 200); assert.ok((await rowsOf(PAGE, restored.body.documentId)).length)
  })

  await check('Content Manager bulk delete (one request, several documents): one trash entry each, with the admin as actor', async () => {
    await settings.set({ ...(await settings.get()), history: { ...(await settings.get()).history, enabled: true } })
    const a = await newPage('Bulk A', ['en']), b = await newPage('Bulk B', ['en'])
    const response = await http('admin', 'POST', `/content-manager/collection-types/${PAGE}/actions/bulkDelete?locale=en`, { documentIds: [a, b] })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    for (const id of [a, b]) { const [row] = await trashOf(id); assert.equal(row?.actor, `admin:${admin.id}`); assert.equal(row.actorName, 'bs-admin Test') }
  })

  await strapi.destroy()
  const failed = results.filter(([ok]) => !ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(error => { console.error(error); process.exit(1) })
