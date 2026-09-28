const assert = require('node:assert/strict')
const { test } = require('node:test')

test('native defaults preserve false/zero and initialize independent nested rows', async () => {
  const { componentDefaults } = await import('../admin/model.mjs')
  const components = { item: { attributes: { title: { type: 'string', default: 'Nested' } } } }
  const schema = { attributes: { enabled: { type: 'boolean', default: false }, count: { type: 'integer', default: 0 },
    hidden: { type: 'password', default: 'never-copy' }, relation: { type: 'relation', default: [1] },
    items: { type: 'component', component: 'item', repeatable: true, required: true, min: 2 } } }
  const result = componentDefaults(schema, components)
  assert.equal(result.enabled, false); assert.equal(result.count, 0); assert.equal(result.hidden, '')
  assert.deepEqual(result.relation, { connect: [], disconnect: [] })
  assert.equal(result.items.length, 2)
  assert.notEqual(result.items[0].__temp_key__, result.items[1].__temp_key__)
  result.items[0].title = 'Changed'
  assert.equal(result.items[1].title, 'Nested')
  assert.equal(components.item.attributes.title.default, 'Nested')
  const cycle = { attributes: { child: { type: 'component', component: 'self', required: true } } }
  assert.throws(() => componentDefaults(cycle, { self: cycle }), /recursive/)
})

test('zone permissions, limits, allowed UIDs and disabled state fail closed', async () => {
  const { editableZones, canInsert } = await import('../admin/model.mjs')
  const schema = { attributes: { blocks: { type: 'dynamiczone', components: ['blocks.hero'], max: 1 } } }
  assert.equal(editableZones(schema, {}, () => false).length, 0)
  assert.equal(editableZones(schema, {}, () => true, true).length, 0)
  const full = editableZones(schema, { blocks: [{}] }, () => true)[0]
  assert.equal(full.full, true); assert.equal(full.count, 1)
  const zone = editableZones(schema, {}, () => true)[0]
  assert.equal(zone.full, false)
  assert.equal(canInsert(zone, 'blocks.other', {}, { 'blocks.other': {} }), false)
  assert.equal(canInsert(zone, 'blocks.hero', { blocks: [{}] }, { 'blocks.hero': {} }), false)
  assert.equal(canInsert(zone, 'blocks.hero', {}, { 'blocks.hero': {} }), true)
})

test('thumbnail candidates follow manual > configured > automatic, then wireframe template', async () => {
  const { entriesFor, candidatesFor } = await import('../admin/model.mjs')
  const zone = { components: ['blocks.hero', 'not.allowed'] }
  const schema = { 'blocks.hero': { info: { displayName: 'Hero' } } }
  const config = { previewBaseUrl: '/cms/previews/', previewVersion: 'v2', components: { 'blocks.hero': { label: 'Banner', keywords: 'campaign', image: '/cfg.png', manualImage: '/uploads/manual.png', template: 'banner' } } }
  const entries = entriesFor(zone, schema, config, 'campaign')
  assert.equal(entries.length, 1); assert.equal(entries[0].label, 'Banner')
  assert.deepEqual(entries[0].candidates, ['/uploads/manual.png', '/cfg.png', '/cms/previews/blocks.hero.webp?v=v2'])
  assert.equal(entries[0].template, 'banner')
  assert.equal(entriesFor(zone, schema, config, 'missing').length, 0)
  assert.deepEqual(candidatesFor('blocks.text', {}, {}), ['/block-previews/blocks.text.webp'])
  assert.equal(entriesFor(zone, schema, { components: {} }, '')[0].template, 'generic')
})

test('gallery never offers a configured CLOSE on its own; the OPEN stays', async () => {
  const { entriesFor, optionsFor } = await import('../admin/model.mjs')
  const zone = { components: ['blocks.text', 'wrappers.mutate', 'wrappers.close'] }
  const schema = Object.fromEntries(zone.components.map(uid => [uid, { info: { displayName: uid } }]))
  const uids = config => entriesFor(zone, schema, config, '').map(e => e.uid)
  assert.deepEqual(uids({ components: {}, groups: { 'wrappers.mutate': 'wrappers.close' } }), ['blocks.text', 'wrappers.mutate'])
  assert.equal(optionsFor(zone, schema, { components: {}, groups: { 'wrappers.mutate': 'wrappers.close' } }).total, 2)
  assert.deepEqual(uids({ components: {}, groups: null }).sort(), [...zone.components].sort(), 'no groups config: every allowed component')
})

test('accordion memory is scoped per user and zone, tolerates blocked or invalid storage', async () => {
  const { memoryKey, readMemory, writeMemory, initialState } = await import('../admin/model.mjs')
  const key = memoryKey({ base: 'http://cms/admin', userId: 7, contentType: 'api::page.page', zone: 'blocks' })
  assert.equal(key, 'blockscene:v1:http://cms/admin:7:api::page.page:blocks')
  assert.equal(memoryKey({ base: 'x', contentType: 'a', zone: 'b' }), null, 'no user id means no memory')
  const store = new Map(); const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  writeMemory(storage, key, 'open'); assert.equal(readMemory(storage, key), 'open')
  writeMemory(storage, key, 'weird'); assert.equal(readMemory(storage, key), 'open')
  store.set(key, 'garbage'); assert.equal(readMemory(storage, key), null)
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(readMemory(blocked, key), null); assert.doesNotThrow(() => writeMemory(blocked, key, 'closed'))
  assert.equal(initialState({ initialState: 'open' }, 'closed'), 'open')
  assert.equal(initialState({ initialState: 'remember' }, 'open'), 'open')
  assert.equal(initialState({ initialState: 'remember' }, null), 'closed')
  assert.equal(initialState({ initialState: 'closed' }, 'open'), 'closed')
})

test('settings validation rejects invalid colors, templates, UIDs, media and unknown keys', () => {
  const { validateSettings, mergeSaved, DEFAULTS, TEMPLATES } = require('../server/settings')
  const uids = ['blocks.hero']
  const ok = validateSettings({ palette: { accent: '#ff0000' }, components: { 'blocks.hero': { mediaId: 3, template: 'cards' } }, editor: { enabled: false, initialState: 'remember' } }, uids)
  assert.equal(ok.palette.accent, '#FF0000'); assert.equal(ok.palette.text, DEFAULTS.palette.text)
  assert.deepEqual(ok.components['blocks.hero'], { mediaId: 3, template: 'cards' })
  assert.equal(ok.editor.enabled, false); assert.equal(ok.editor.showOpenAll, true)
  for (const bad of [
    { palette: { accent: 'red' } }, { palette: { border: '#000000' } }, { components: { 'blocks.hero': { template: 'fancy' } } },
    { components: { 'blocks.other': { template: 'generic' } } }, { components: { 'blocks.hero': { mediaId: '3' } } },
    { components: { 'blocks.hero': { svg: '<svg/>' } } }, { editor: { initialState: 'sometimes' } }, { editor: { enabled: 'yes' } },
    { extra: true }, [], 'x', { components: { 'blocks.hero': { template: 'x'.repeat(70000) } } },
    { editor: { blockMode: 'form' } }, { editor: { previewMode: 'sideways' } }, { editor: { previewUrl: 'javascript:alert(1)' } }, { editor: { previewUrl: '/relative' } },
  ]) assert.throws(() => validateSettings(bad, uids), { name: 'ValidationError' }, `rejects ${JSON.stringify(bad).slice(0, 40)}`)
  const preview = validateSettings({ editor: { previewUrl: 'https://site.test/preview/', previewMode: 'split' } }, uids).editor
  assert.equal(preview.previewUrl, 'https://site.test/preview'); assert.equal(preview.previewMode, 'split')
  assert.equal(validateSettings({ editor: { previewUrl: '' } }, uids).editor.previewUrl, '', 'empty means native preview origin')
  assert.equal(validateSettings({ editor: { blockPreviewInForm: true } }, uids).editor.blockPreviewInForm, true)
  assert.equal(validateSettings({}, uids).editor.blockPreviewInForm, false, 'compact block preview is off by default')
  assert.throws(() => validateSettings({ editor: { blockPreviewInForm: 'yes' } }, uids), { name: 'ValidationError' })
  assert.equal(TEMPLATES.length, 6)
  const merged = mergeSaved({ palette: { accent: 'bad' }, components: { 'blocks.gone': { mediaId: 1 }, 'blocks.hero': { mediaId: 2 } }, editor: { initialState: 'open', enabled: 'no', previewMode: 'weird', previewUrl: 'ftp://x' } }, uids)
  assert.equal(merged.palette.accent, DEFAULTS.palette.accent)
  assert.deepEqual(Object.keys(merged.components), ['blocks.hero'])
  assert.equal(merged.editor.initialState, 'open'); assert.equal(merged.editor.enabled, true)
  assert.equal(merged.editor.previewMode, 'form'); assert.equal(merged.editor.previewUrl, '')
})

test('blockPreviewUrl: placeholders validated on save, expanded and encoded in the admin', async () => {
  const { validateSettings, mergeSaved } = require('../server/settings')
  const { blockPreviewSrc } = await import('../admin/model.mjs')
  const uids = ['blocks.hero']
  const url = 'http://localhost:3026/{locale}/block-preview/{name}/{variant}?c={category}&u={uid}'
  assert.equal(validateSettings({ editor: { blockPreviewUrl: url } }, uids).editor.blockPreviewUrl, url, 'stored as typed (braces kept)')
  assert.equal(validateSettings({}, uids).editor.blockPreviewUrl, '', 'off by default')
  for (const bad of ['javascript:alert(1)', '/block-preview/{name}', 'https://site.test/{nope}', 'https://site.test/{name', 'https://x.test/' + 'a'.repeat(500), 'https://site.test/"{name}"', 3])
    assert.throws(() => validateSettings({ editor: { blockPreviewUrl: bad } }, uids), { name: 'ValidationError' }, `rejects ${String(bad).slice(0, 40)}`)
  assert.equal(mergeSaved({ editor: { blockPreviewUrl: 'ftp://x/{uid}' } }, uids).editor.blockPreviewUrl, '')
  assert.equal(mergeSaved({ editor: { blockPreviewUrl: url } }, uids).editor.blockPreviewUrl, url)
  assert.equal(blockPreviewSrc(url, 'blocks.hero', { locale: 'pt-BR' }), 'http://localhost:3026/pt-BR/block-preview/hero/default?c=blocks&u=blocks.hero')
  assert.equal(blockPreviewSrc(url, 'blocks.hero', { variant: 'dark' }), 'http://localhost:3026/block-preview/hero/dark?c=blocks&u=blocks.hero', 'empty locale')
  assert.equal(blockPreviewSrc('https://s.test/{name}', 'a.b/../c?x'), 'https://s.test/b%2F..%2Fc%3Fx', 'values cannot add path segments or queries')
  assert.equal(blockPreviewSrc('{uid}', 'javascript:alert(1)'), null)
  assert.equal(blockPreviewSrc('', 'blocks.hero'), null)
})

test('admin catalog only exposes declared safe metadata plus resolved overrides', async () => {
  const plugin = require('../server')
  const values = { components: { 'blocks.hero': { label: 'Hero', image: 'javascript:alert(1)', secret: 'must-not-leak' } }, previewBaseUrl: '/cms/previews', previewVersion: 'bad version!', disabled: false }
  const saved = { components: { 'blocks.hero': { mediaId: 9, template: 'faq' } }, editor: { enabled: true, initialState: 'open' } }
  const strapi = { components: { 'blocks.hero': {} },
    plugin: () => ({ config: key => values[key], service: () => plugin.services.settings({ strapi }) }),
    store: () => ({ get: async () => saved }),
    db: { query: () => ({ findOne: async ({ where }) => where.id === 9 ? { id: 9, url: '/uploads/hero.png', mime: 'image/png', name: 'hero.png' } : null }) } }
  const ctx = {}
  await plugin.controllers.catalog({ strapi }).find(ctx)
  assert.equal(ctx.body.previewBaseUrl, '/cms/previews'); assert.equal(ctx.body.previewVersion, undefined)
  assert.equal(ctx.body.components['blocks.hero'].label, 'Hero')
  assert.equal(ctx.body.components['blocks.hero'].image, undefined)
  assert.equal(ctx.body.components['blocks.hero'].secret, undefined)
  assert.equal(ctx.body.components['blocks.hero'].manualImage, '/uploads/hero.png')
  assert.equal(ctx.body.components['blocks.hero'].template, 'faq')
  assert.equal(ctx.body.editor.enabled, true); assert.equal(ctx.body.editor.initialState, 'open')
  values.disabled = true
  await plugin.controllers.catalog({ strapi }).find(ctx)
  assert.equal(ctx.body.editor.enabled, false, 'server flag wins over settings')
  saved.components['blocks.hero'].mediaId = 404
  await plugin.controllers.catalog({ strapi }).find(ctx)
  assert.equal(ctx.body.components['blocks.hero'].manualImage, undefined)
  assert.equal(ctx.body.components['blocks.hero'].manualMissing, true)
  const routes = plugin.routes.admin.routes
  assert.ok(routes.find(r => r.method === 'PUT' && r.path === '/settings').config.policies.some(p => p.config?.actions?.includes('plugin::blockscene.settings.update')))
})

test('layout groups: OPEN/CLOSE map, tree, whole-group moves/removal, gap resolution, validation policy', async () => {
  const { groupRows, moveGroup, removeGroup, topLevelRanges, insertIndex, blockKey, validateGroups, safeGroups } = await import('../admin/preview.mjs')
  const g = { 'wrappers.columns': 'wrappers.close', 'wrappers.join': 'wrappers.close' }
  const flat = [{ id: 1, __component: 'blocks.a' }, { id: 2, __component: 'wrappers.columns' }, { id: 3, __component: 'blocks.b' }, { id: 4, __component: 'blocks.c' }, { id: 5, __component: 'wrappers.close' }, { id: 6, __component: 'blocks.d' }]
  const tree = groupRows(flat, g)
  assert.deepEqual(tree.map(n => n.type), ['block', 'group', 'block'])
  assert.deepEqual(tree[1].children.map(c => c.key), ['blocks.b#3', 'blocks.c#4']); assert.equal(tree[1].closeKey, 'wrappers.close#5')
  assert.deepEqual(topLevelRanges(flat, g), [[0, 0], [1, 4], [5, 5]])
  assert.deepEqual(moveGroup(flat, 'wrappers.columns#2', 'up', g).map(r => r.id), [2, 3, 4, 5, 1, 6])
  assert.deepEqual(moveGroup(flat, 'wrappers.columns#2', 'down', g).map(r => r.id), [1, 6, 2, 3, 4, 5])
  assert.equal(moveGroup(flat, 'blocks.a#1', 'up', g), null); assert.equal(moveGroup(flat, 'wrappers.columns#2', 'up', null), null, 'no groups config, no moves')
  assert.deepEqual(removeGroup(flat, 'wrappers.columns#2', g).map(r => r.id), [1, 6], 'removing a group drops OPEN, children and CLOSE together')
  assert.equal(removeGroup(flat, 'blocks.a#1', g), null)
  assert.deepEqual(groupRows(flat, null).map(n => n.type), ['block', 'block', 'block', 'block', 'block', 'block'], 'without config every row is an ordinary block')
  assert.equal(insertIndex(flat, 'wrappers.columns#2'), 2, 'gap after the opener inserts inside the group')
  assert.equal(insertIndex(flat, 'wrappers.close#5'), 5, 'gap after the close inserts after the group')
  assert.equal(blockKey({ __component: 'x.y', id: 9, __temp_key__: 'a0' }), 'x.y#9', 'saved rows keep uid#id across reorders')
  assert.equal(blockKey({ __temp_key__: 'a0' }), 'a0')
  // Validation policy: balanced (empty, multiple, nested) passes; close-before-open, orphan open and mismatch are reported with positions.
  const row = uid => ({ __component: uid })
  assert.deepEqual(validateGroups([row('wrappers.join'), row('wrappers.close')], g), [], 'empty pair is valid')
  assert.deepEqual(validateGroups([row('wrappers.join'), row('blocks.a'), row('wrappers.close'), row('wrappers.columns'), row('wrappers.close')], g), [], 'multiple groups')
  assert.deepEqual(validateGroups([row('wrappers.join'), row('wrappers.columns'), row('blocks.a'), row('wrappers.close'), row('wrappers.close')], g), [], 'nested groups close innermost first')
  assert.deepEqual(validateGroups([row('wrappers.close'), row('blocks.a')], g).map(e => [e.code, e.index]), [['closeBeforeOpen', 0]])
  assert.deepEqual(validateGroups([row('blocks.a'), row('wrappers.join')], g).map(e => [e.code, e.index, e.expected]), [['unclosed', 1, 'wrappers.close']])
  const two = { 'g.a': 'g.end-a', 'g.b': 'g.end-b' }
  assert.deepEqual(validateGroups([row('g.a'), row('g.end-b')], two).map(e => [e.code, e.index, e.expected]), [['mismatch', 1, 'g.end-a'], ['unclosed', 0, 'g.end-a']])
  assert.deepEqual(validateGroups([row('blocks.a'), row('blocks.b')], null), [], 'no config, nothing to validate')
  assert.deepEqual(validateGroups([row('wrappers.close'), row('wrappers.join')], null), [], 'no config: markers are ordinary blocks and never block publishing')
  // Config validation degrades to null (ordinary blocks) instead of guessing.
  assert.deepEqual(safeGroups({ 'wrappers.join': 'wrappers.close' }), { 'wrappers.join': 'wrappers.close' })
  assert.equal(safeGroups({ 'wrappers.join': 'wrappers.join' }), null, 'open must differ from close')
  assert.equal(safeGroups({ 'a.b': 'a.c', 'a.c': 'a.d' }), null, 'a close cannot also be an open')
  assert.equal(safeGroups('wrappers.'), null); assert.equal(safeGroups(['a.b']), null); assert.equal(safeGroups({}), null); assert.equal(safeGroups({ 'bad uid': 'a.b' }), null)
  assert.deepEqual(safeGroups({ 'a.b': 'a.c', 'x.y': 'x.z' }, ['a.b', 'a.c']), { 'a.b': 'a.c' }, 'pairs naming unknown components are dropped')
})

test('bridge projection: external media URLs kept, unsafe schemes dropped, private attributes never exposed, dotted reads', async () => {
  const { projectMedia, resolveField, editableFields, mediaFields, getIn } = await import('../admin/preview.mjs')
  const origin = 'http://cms.test'
  assert.equal(projectMedia({ url: '/uploads/a.png' }, origin).url, 'http://cms.test/uploads/a.png')
  assert.equal(projectMedia({ url: 'https://cdn.example.com/bucket/a.png' }, origin).url, 'https://cdn.example.com/bucket/a.png', 'S3/CDN providers render in the preview')
  assert.equal(projectMedia({ url: 'javascript:alert(1)' }, origin), null)
  assert.equal(projectMedia({ url: 'data:image/png;base64,AAAA' }, origin), null)
  const components = { 'blocks.a': { attributes: { title: { type: 'string' }, secret: { type: 'string', private: true }, image: { type: 'media' }, hidden: { type: 'media', private: true } } } }
  assert.equal(resolveField('blocks.a', 'secret', components), null, 'private fields cannot be focused, edited or read through the bridge')
  assert.equal(resolveField('blocks.a', 'title', components).type, 'string')
  assert.deepEqual(editableFields('blocks.a', {}, components).map(f => f.name), ['title'])
  assert.deepEqual(Object.keys(mediaFields('blocks.a', {}, components)), ['image'])
  assert.equal(getIn({ items: [{ image: { id: 7 } }] }, 'items.0.image').id, 7); assert.equal(getIn({}, 'items.0.image'), undefined)
})

test('native "Add a component" button is matched by its zone name only, never another zone, a header or a block row', async () => {
  const { isNativeAddButton } = await import('../admin/accordions.mjs')
  const button = (text, extra = {}) => ({ textContent: text, getAttribute: (k) => extra[k] || null, closest: (sel) => (extra.inside && sel.includes(extra.inside) ? {} : null) })
  assert.equal(isNativeAddButton(button('Add a component to blocks'), { name: 'blocks' }), true)
  assert.equal(isNativeAddButton(button('Adicionar um componente a blocks'), { name: 'blocks' }), true)
  assert.equal(isNativeAddButton(button('Add a component to Page blocks'), { name: 'blocks', label: 'Page blocks' }), true, 'renamed zone label')
  assert.equal(isNativeAddButton(button('Add a component to Blocks'), { name: 'blocks', label: 'Blocks' }), true, 'humanized label')
  assert.equal(isNativeAddButton(button('Add a component to sidebar'), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Add a component to sub blocks'), { name: 'blocks' }), true, 'suffix rule: documented limit for zone names that end another zone name')
  assert.equal(isNativeAddButton(button('Add a component to blocks', { 'aria-expanded': 'false' }), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Add a component to blocks', { inside: 'ol[aria-describedby] > li' }), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Add a component to blocks', { inside: '[role="dialog"]' }), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Open all blocks', { inside: '[data-testid^="block-"]' }), { name: 'blocks' }), false, 'the plugin\'s own accordion controls are not the native button')
  assert.equal(isNativeAddButton(button('Paste 2 blocks', { inside: '[role="menu"]' }), { name: 'blocks' }), false, 'the zone bar menu (portalled out of the bar) is not the native button')
})

test('zone bar toggle: one button, the action follows the rows, a single option offers only its action', async () => {
  const { accordionToggle } = await import('../admin/accordions.mjs')
  const both = { showOpenAll: true, showCloseAll: true }
  assert.deepEqual(accordionToggle(true, true, both), { action: 'open', disabled: false }, 'some collapsed: expand')
  assert.deepEqual(accordionToggle(false, true, both), { action: 'close', disabled: false }, 'all expanded: collapse')
  assert.deepEqual(accordionToggle(true, false, both), { action: 'open', disabled: false })
  assert.deepEqual(accordionToggle(false, true, { showOpenAll: true, showCloseAll: false }), { action: 'open', disabled: true }, 'only expand: nothing to do')
  assert.deepEqual(accordionToggle(true, false, { showOpenAll: false, showCloseAll: true }), { action: 'close', disabled: true }, 'only collapse: nothing to do')
  assert.deepEqual(accordionToggle(true, true, { showOpenAll: false, showCloseAll: true }), { action: 'close', disabled: false })
  assert.equal(accordionToggle(true, true, { showOpenAll: false, showCloseAll: false }), null, 'both off: no button')
})

test('per content type settings: only types with a zone, only known keys; stale types dropped on read', () => {
  const { validateSettings, mergeSaved } = require('../server/settings')
  const types = ['api::page.page', 'api::post.post']
  const ok = validateSettings({ contentTypes: { 'api::page.page': { enabled: false }, 'api::post.post': { previewMode: 'split' } } }, [], types)
  assert.deepEqual(ok.contentTypes, { 'api::page.page': { enabled: false }, 'api::post.post': { previewMode: 'split' } })
  assert.deepEqual(validateSettings({}, [], types).contentTypes, {}, 'nothing stored means global behaviour')
  for (const bad of [{ contentTypes: { 'api::form.form': { enabled: false } } }, { contentTypes: { 'api::page.page': { enabled: 'no' } } },
    { contentTypes: { 'api::page.page': { previewMode: 'sideways' } } }, { contentTypes: { 'api::page.page': { hidden: true } } }, { contentTypes: [] }])
    assert.throws(() => validateSettings(bad, [], types), { name: 'ValidationError' }, `rejects ${JSON.stringify(bad)}`)
  const merged = mergeSaved({ contentTypes: { 'api::gone.gone': { enabled: false }, 'api::page.page': { enabled: false, previewMode: 'weird' } } }, [], types)
  assert.deepEqual(merged.contentTypes, { 'api::page.page': { enabled: false } })
})

test('visual editor sidebar: items name their own type fields, known icons, modal or drawer; stale items dropped on read', () => {
  const { validateSettings, mergeSaved } = require('../server/settings')
  const types = { 'api::page.page': ['title', 'name', 'pageSeo', 'blocks'] }
  const sidebar = [{ label: 'SEO', icon: 'seo', open: 'drawer', fields: ['pageSeo'] }, { label: 'Title', open: 'modal', fields: ['title', 'name'] }]
  const ok = validateSettings({ contentTypes: { 'api::page.page': { sidebar, sidebarPosition: 'right' } } }, [], types)
  assert.deepEqual(ok.contentTypes['api::page.page'], { sidebar, sidebarPosition: 'right' })
  const item = (patch) => ({ contentTypes: { 'api::page.page': { sidebar: [{ label: 'X', open: 'modal', fields: ['title'], ...patch }] } } })
  for (const bad of [item({ fields: ['password'] }), item({ fields: [] }), item({ icon: 'rocket' }), item({ open: 'popup' }), item({ label: '<b>' }), item({ label: '' }),
    item({ extra: 1 }), { contentTypes: { 'api::page.page': { sidebarPosition: 'top' } } },
    { contentTypes: { 'api::page.page': { sidebar: Array.from({ length: 13 }, () => ({ label: 'X', open: 'modal', fields: ['title'] })) } } }])
    assert.throws(() => validateSettings(bad, [], types), { name: 'ValidationError' }, `rejects ${JSON.stringify(bad).slice(0, 80)}`)
  const merged = mergeSaved({ contentTypes: { 'api::page.page': { sidebar: [...sidebar, { label: 'Gone', open: 'modal', fields: ['removedField'] }] } } }, [], types)
  assert.deepEqual(merged.contentTypes['api::page.page'].sidebar, sidebar, 'an item naming a removed field is dropped, the rest kept')
})

test('project defaults from code: under the saved document, per key and per uid; invalid code ignored; DELETE restores', async () => {
  const plugin = require('../server')
  const { DEFAULTS } = require('../server/settings')
  const code = { palette: { accent: '#112233', text: '#445566' }, editor: { previewMode: 'split', initialState: 'open' },
    components: { 'blocks.hero': { template: 'banner' }, 'blocks.text': { template: 'faq' } },
    contentTypes: { 'api::page.page': { sidebarPosition: 'right', sidebar: [{ label: 'SEO', open: 'drawer', fields: ['title'] }] } } }
  const make = (config) => {
    const db = { settings: null }; const warnings = []
    const store = { get: async ({ key }) => key === 'settings' ? db.settings : null, set: async ({ value }) => { db.settings = value }, delete: async () => { db.settings = null } }
    const strapi = { components: { 'blocks.hero': {}, 'blocks.text': {} }, contentTypes: { 'api::page.page': { attributes: { title: {}, blocks: { type: 'dynamiczone' } } } },
      log: { warn: m => warnings.push(m) }, store: () => store, db: { query: () => ({ findOne: async () => null }) },
      plugin: () => ({ config: key => config[key], service: () => service }) }
    const service = plugin.services.settings({ strapi })
    return { strapi, db, warnings, service }
  }
  const { strapi, db, service } = make({ settings: code })
  let s = await service.get()
  assert.equal(s.palette.accent, '#112233'); assert.equal(s.palette.background, DEFAULTS.palette.background)
  assert.equal(s.editor.previewMode, 'split'); assert.equal(s.contentTypes['api::page.page'].sidebarPosition, 'right')
  // The admin saves the page as shown, changing one color, one component and the page type: only those are stored.
  const next = structuredClone(s); next.palette.accent = '#AA0000'; next.components['blocks.hero'] = { template: 'cards' }
  next.contentTypes['api::page.page'] = { previewMode: 'preview' }; delete next.components['blocks.text']
  await service.set(next)
  assert.deepEqual(db.settings.palette, { accent: '#AA0000' }); assert.deepEqual(db.settings.editor, {})
  assert.deepEqual(db.settings.components, { 'blocks.hero': { template: 'cards' }, 'blocks.text': {} })
  s = await service.get()
  assert.equal(s.palette.accent, '#AA0000', 'saved key wins'); assert.equal(s.palette.text, '#445566', 'other keys keep code values')
  assert.equal(s.editor.initialState, 'open')
  assert.deepEqual(s.components, { 'blocks.hero': { template: 'cards' } }, 'a saved uid entry replaces the code one; a removed code entry stays removed')
  assert.deepEqual(s.contentTypes['api::page.page'], { previewMode: 'preview' }, 'the whole type entry is replaced, sidebar included')
  // A legacy full document (every key) still works: it wins everywhere it speaks.
  db.settings = { palette: { ...DEFAULTS.palette }, components: {}, contentTypes: {} }
  assert.equal((await service.get()).palette.accent, DEFAULTS.palette.accent); assert.equal((await service.get()).editor.previewMode, 'split')
  // GET exposes the validated code settings; DELETE removes the saved document (and the legacy copy).
  const ctx = {}
  await plugin.controllers.settings({ strapi }).find(ctx)
  assert.equal(ctx.body.projectDefaults.palette.accent, '#112233')
  await plugin.controllers.settings({ strapi }).reset(ctx)
  assert.equal(db.settings, null); assert.equal(ctx.body.palette.accent, '#112233'); assert.equal(ctx.body.components['blocks.text'].template, 'faq')
  const route = plugin.routes.admin.routes.find(r => r.method === 'DELETE' && r.path === '/settings')
  assert.equal(route.handler, 'settings.reset')
  assert.ok(route.config.policies.some(p => p.config?.actions?.includes('plugin::blockscene.settings.update')), 'DELETE needs the update permission')
  // Invalid code settings: a warning naming the problem, then the built-in defaults.
  const bad = make({ settings: { palette: { accent: 'red' } } })
  assert.equal(bad.service.projectDefaults(), null)
  assert.match(bad.warnings[0], /"settings" config ignored: Color "accent" must use #RRGGBB/)
  assert.equal((await bad.service.get()).palette.accent, DEFAULTS.palette.accent)
  const none = make({})
  assert.equal(none.service.projectDefaults(), null); assert.equal(none.warnings.length, 0)
  await none.service.set({ palette: { accent: '#000000' } })
  assert.equal(none.db.settings.editor.previewMode, 'form', 'without code settings the full document is stored, as before')
})

test('gallery taxonomy: facets from the schema one level deep, typology guess, overrides and legacy category as tag', () => {
  const { facetsOf, guessTypology, catalog } = require('../server/settings')
  const schemas = {
    'blocks.hero-banner': { info: { displayName: 'Hero' }, attributes: { image: { type: 'media', allowedTypes: ['images'] }, body: { type: 'richtext' } } },
    'blocks.media': { info: { displayName: 'Media' }, attributes: { files: { type: 'media', multiple: true, allowedTypes: ['images', 'videos'] } } },
    'blocks.cards': { info: { displayName: 'Cards' }, attributes: { items: { type: 'component', component: 'shared.card', repeatable: true } } },
    'shared.card': { attributes: { text: { type: 'customField', customField: 'plugin::ckeditor5.CKEditor' }, deep: { type: 'component', component: 'shared.deep' } } },
    'shared.deep': { attributes: { post: { type: 'relation' } } },
    'blocks.related-posts': { info: { displayName: 'Posts' }, attributes: {} },
    'blocks.newsletter': { info: { displayName: 'Contact us' }, attributes: { any: { type: 'media' } } },
  }
  const facets = uid => facetsOf(uid, schemas[uid], schemas).sort()
  assert.deepEqual(facets('blocks.hero-banner'), ['image', 'richtext'])
  assert.deepEqual(facets('blocks.media'), ['gallery', 'image', 'video'])
  assert.deepEqual(facets('blocks.cards'), ['list', 'richtext'], 'nested one level: the relation two levels down is not read')
  assert.deepEqual(facets('blocks.related-posts'), ['dynamic'])
  assert.deepEqual(facets('blocks.newsletter'), ['form', 'image', 'video'], 'no allowedTypes means every media type')
  for (const [uid, name, typology] of [['blocks.hero', '', 'hero'], ['x.cover', '', 'hero'], ['x.quote', '', 'text'], ['x.carousel', '', 'media'],
    ['x.archive', '', 'listing'], ['x.card-grid', '', 'cards'], ['x.button', '', 'cta'], ['x.contact', '', 'form'], ['x.spacer', '', 'layout'],
    ['x.faq', '', 'text'], ['sections.faq', 'FAQ', 'text'], ['x.thing', 'Two columns', 'layout']]) assert.equal(guessTypology(uid, name), typology, uid)
  const base = catalog({ components: { 'blocks.media': { typology: 'hero', tags: [' Home ', 'Home', 'x'.repeat(30)] }, 'blocks.cards': { category: 'Editorial' },
    'blocks.hero-banner': { typology: 'nope' } }, schemas })
  assert.equal(base.components['blocks.media'].typology, 'hero'); assert.deepEqual(base.components['blocks.media'].tags, ['Home'])
  assert.deepEqual(base.components['blocks.cards'].tags, ['Editorial'], 'legacy category filters as a tag')
  assert.equal(base.components['blocks.hero-banner'].typology, 'hero', 'invalid code typology falls back to the guess')
  assert.deepEqual(base.components['blocks.related-posts'], { facets: ['dynamic'], typology: 'listing', tags: [] })
})

test('settings: per component typology and tags are validated strictly, read leniently', () => {
  const { validateSettings, mergeSaved } = require('../server/settings')
  const uids = ['blocks.hero']
  const ok = validateSettings({ components: { 'blocks.hero': { typology: 'cta', tags: [' Home ', 'Landing'] } } }, uids)
  assert.deepEqual(ok.components['blocks.hero'], { typology: 'cta', tags: ['Home', 'Landing'] })
  for (const bad of [{ typology: 'banner' }, { typology: 1 }, { tags: 'home' }, { tags: [''] }, { tags: ['  '] }, { tags: ['x'.repeat(25)] },
    { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, { tags: [3] }, { tags: ['<b>'] }])
    assert.throws(() => validateSettings({ components: { 'blocks.hero': bad } }, uids), { name: 'ValidationError' }, JSON.stringify(bad))
  const merged = mergeSaved({ components: { 'blocks.hero': { typology: 'weird', tags: ['ok', '', 5, 'x'.repeat(40)], template: 'faq' } } }, uids)
  assert.deepEqual(merged.components['blocks.hero'], { tags: ['ok'], template: 'faq' })
  assert.deepEqual(mergeSaved({ components: { 'blocks.hero': { typology: 'form', tags: [] } } }, uids).components['blocks.hero'], { typology: 'form' })
})

test('gallery filters: typology, recent/starred uids, menus any-of within, all-of across; options count the whole zone', async () => {
  const { entriesFor, optionsFor, groupEntries } = await import('../admin/model.mjs')
  const zone = { components: ['a.hero', 'a.text', 'a.video'] }
  const schema = Object.fromEntries(zone.components.map(uid => [uid, { info: { displayName: uid } }]))
  const config = { components: { 'a.hero': { typology: 'hero', facets: ['image'], tags: ['Home'] }, 'a.text': { typology: 'text', facets: ['richtext'] },
    'a.video': { typology: 'media', facets: ['video', 'list'], tags: ['Home'] } } }
  const uids = filter => entriesFor(zone, schema, config, '', filter).map(e => e.uid)
  assert.deepEqual(uids(), ['a.hero', 'a.text', 'a.video'], 'typology order')
  assert.deepEqual(uids({ typology: 'text' }), ['a.text'])
  assert.deepEqual(uids({ uids: ['a.video'] }), ['a.video'])
  assert.deepEqual(uids({ media: ['image', 'video'] }), ['a.hero', 'a.video'])
  assert.deepEqual(uids({ media: ['video'], content: ['richtext'] }), [])
  assert.deepEqual(uids({ tags: ['Home'], content: ['list'] }), ['a.video'])
  assert.deepEqual(entriesFor(zone, schema, config, 'home').map(e => e.uid), ['a.hero', 'a.video'], 'search reads tags')
  const options = optionsFor(zone, schema, config)
  assert.equal(options.total, 3)
  assert.deepEqual(options.typologies, [['hero', 1], ['text', 1], ['media', 1]])
  assert.deepEqual(options.tags, [['Home', 2]]); assert.deepEqual(options.media, [['image', 1], ['video', 1]]); assert.deepEqual(options.content, [['richtext', 1], ['list', 1]])
  assert.deepEqual(groupEntries(entriesFor(zone, schema, config, '')).map(g => g.typology), ['hero', 'text', 'media'])
})

test('per user prefs: starred and recent hold existing uids only, bounded; stale uids dropped on read', async () => {
  const { validatePrefs, mergePrefs } = require('../server/settings')
  const uids = ['a.one', 'a.two']
  assert.deepEqual(validatePrefs({ starred: ['a.one', 'a.one'], recent: ['a.two', 'a.one'] }, uids), { starred: ['a.one'], recent: ['a.two', 'a.one'] })
  assert.deepEqual(validatePrefs({}, uids), { starred: [], recent: [] })
  for (const bad of [null, [], 'x', { starred: ['a.gone'] }, { recent: 'a.one' }, { recent: [1] }, { other: [] },
    { recent: Array.from({ length: 21 }, () => 'a.one') }, { starred: Array.from({ length: 201 }, () => 'a.one') }])
    assert.throws(() => validatePrefs(bad, uids), { name: 'ValidationError' }, JSON.stringify(bad))
  assert.deepEqual(mergePrefs({ starred: ['a.gone', 'a.two'], recent: 'bad' }, uids), { starred: ['a.two'], recent: [] })
  assert.deepEqual(mergePrefs(null, uids), { starred: [], recent: [] })
  const plugin = require('../server')
  const stored = new Map()
  const strapi = { components: { 'a.one': {}, 'a.two': {} }, store: () => ({ get: async ({ key }) => stored.get(key), set: async ({ key, value }) => stored.set(key, value) }) }
  const prefs = plugin.controllers.prefs({ strapi })
  await prefs.update({ state: { user: { id: 7 } }, request: { body: { starred: ['a.two'] } } })
  assert.deepEqual(stored.get('prefs:7'), { starred: ['a.two'], recent: [] })
  const ctx = { state: { user: { id: 8 } } }; await prefs.find(ctx); assert.deepEqual(ctx.body, { starred: [], recent: [] }, 'per user')
  let denied = false; await prefs.find({ state: {}, unauthorized: () => { denied = true } }); assert.ok(denied)
  const routes = plugin.routes.admin.routes.filter(r => r.path === '/me/prefs')
  assert.deepEqual(routes.map(r => r.method).sort(), ['GET', 'PUT']); assert.ok(routes.every(r => r.config.policies.includes('admin::isAuthenticatedAdmin')))
})

test('history: record, coalesce, undo, redo, cap and shortcuts', async () => {
  const { createHistory, record, undo, redo, historyKey } = await import('../admin/history.mjs')
  let h = createHistory('a')
  assert.equal(record(h, 'b', true).past.length, 1, 'coalescing never swallows the base state')
  h = record(record(record(h, 'b'), 'bc', true), 'bcd', true)
  assert.deepEqual([h.past, h.present], [['a'], 'bcd'], 'continuous typing is one step')
  h = record(h, 'x')
  h = undo(h); assert.equal(h.present, 'bcd'); h = undo(h); assert.equal(h.present, 'a')
  assert.equal(undo(h), h, 'nothing to undo')
  h = redo(h); assert.equal(h.present, 'bcd'); assert.deepEqual(h.future, ['x'])
  h = record(h, 'y'); assert.deepEqual(h.future, [], 'a new change drops the redo branch')
  assert.equal(redo(h), h, 'nothing to redo')
  let capped = createHistory(0, 3)
  for (let i = 1; i <= 5; i++) capped = record(capped, i)
  assert.deepEqual([capped.past, capped.present], [[2, 3, 4], 5])
  const k = (key, mods = {}) => historyKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods })
  assert.equal(k('z', { metaKey: true }), 'undo'); assert.equal(k('z', { ctrlKey: true }), 'undo')
  assert.equal(k('Z', { metaKey: true, shiftKey: true }), 'redo'); assert.equal(k('y', { ctrlKey: true }), 'redo')
  assert.equal(k('z'), null); assert.equal(k('y', { metaKey: true }), null); assert.equal(k('z', { ctrlKey: true, altKey: true }), null)
})

test('row thumbnails option: boolean, on by default, strict and lenient', () => {
  const { validateSettings, mergeSaved } = require('../server/settings')
  assert.equal(validateSettings({}, []).editor.showRowThumbnails, true)
  assert.equal(validateSettings({ editor: { showRowThumbnails: false } }, []).editor.showRowThumbnails, false)
  assert.throws(() => validateSettings({ editor: { showRowThumbnails: 'no' } }, []), { name: 'ValidationError' })
  assert.equal(mergeSaved({ editor: { showRowThumbnails: 'no' } }, []).editor.showRowThumbnails, true, 'bad saved value falls back')
  assert.equal(mergeSaved({ editor: { showRowThumbnails: false } }, []).editor.showRowThumbnails, false)
})

test('hover messages: null clears, only keys of current rows pass', async () => {
  const { hoverKey } = await import('../admin/preview.mjs')
  const rows = [{ __component: 'blocks.hero', id: 3 }, { __component: 'blocks.text', __temp_key__: 'a0' }]
  assert.equal(hoverKey(null, rows), null)
  assert.equal(hoverKey('blocks.hero#3', rows), 'blocks.hero#3')
  assert.equal(hoverKey('a0', rows), 'a0')
  for (const bad of ['blocks.hero#4', 3, undefined, {}, 'x'.repeat(201), '']) assert.equal(hoverKey(bad, rows), undefined, `ignores ${String(bad).slice(0, 20)}`)
  assert.equal(hoverKey('a0', null), undefined)
})

test('open/close all planner: rows in or near the visible area now, the rest later, nearest first', async () => {
  const { planRows } = await import('../admin/accordions.mjs')
  const rows = [[-900, -700], [-100, 50], [100, 300], [950, 1100], [1500, 1700], [2100, 2300], [3200, 3400]].map(([top, bottom]) => ({ top, bottom }))
  const view = { top: 0, bottom: 1000 }
  assert.deepEqual(planRows(rows, view), { now: [1, 2, 3], later: [4, 0, 5, 6] }, 'close: visible only')
  assert.deepEqual(planRows(rows, view, 1000), { now: [0, 1, 2, 3, 4], later: [5, 6] }, 'open: one viewport of margin each way')
  assert.deepEqual(planRows([], view), { now: [], later: [] })
})

test('lazyFields: strict PUT validation, lenient read, code defaults', () => {
  const { validateSettings, mergeSaved, DEFAULTS } = require('../server/settings')
  assert.equal(DEFAULTS.editor.lazyEditors, true)
  assert.deepEqual(DEFAULTS.editor.lazyFields, ['plugin::ckeditor5.CKEditor'])
  const ok = validateSettings({ editor: { lazyEditors: false, lazyFields: ['global::rich', 'plugin::ckeditor5.CKEditor', 'global::rich'] } }, [])
  assert.equal(ok.editor.lazyEditors, false)
  assert.deepEqual(ok.editor.lazyFields, ['global::rich', 'plugin::ckeditor5.CKEditor'], 'deduplicated')
  assert.deepEqual(validateSettings({ editor: { lazyFields: [] } }, []).editor.lazyFields, [])
  for (const bad of ['plugin::ckeditor5.CKEditor', [1], ['api::page.page'], ['plugin::x y'], ['plugin::<b>'], Array.from({ length: 21 }, (_, i) => `global::f${i}`)])
    assert.throws(() => validateSettings({ editor: { lazyFields: bad } }, []), { name: 'ValidationError' }, JSON.stringify(bad))
  assert.throws(() => validateSettings({ editor: { lazyEditors: 'yes' } }, []), { name: 'ValidationError' })
  assert.deepEqual(mergeSaved({ editor: { lazyFields: ['global::ok', 'nope', 42] } }, []).editor.lazyFields, ['global::ok'], 'bad entries dropped, good kept')
  assert.deepEqual(mergeSaved({ editor: { lazyFields: 'plugin::ckeditor5.CKEditor' } }, []).editor.lazyFields, ['plugin::ckeditor5.CKEditor'], 'not a list: default')
  assert.equal(mergeSaved({ editor: { lazyEditors: 'no' } }, []).editor.lazyEditors, true)
})

test('rich-text preview sanitizer drops scripts, frames, handlers, script URLs and non-text styles', async () => {
  const { cleanTree } = await import('../admin/sanitize.mjs')
  // Minimal DOM stub: enough of Element for cleanTree.
  const el = (tagName, attrs = {}, children = []) => {
    const node = { tagName, children, attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })) }
    node.removeAttribute = (name) => { node.attributes = node.attributes.filter(a => a.name !== name) }
    node.setAttribute = (name, value) => { node.attributes = node.attributes.map(a => a.name === name ? { name, value } : a) }
    node.remove = () => { node.parent.children = node.parent.children.filter(c => c !== node) }
    children.forEach(c => { c.parent = node })
    return node
  }
  const root = el('BODY', {}, [
    el('P', { class: 'x', onclick: 'steal()', style: 'position:fixed' }, [el('A', { href: ' JaVa\tScRiPt:alert(1)', title: 't' }), el('A', { href: 'https://ok.test/' })]),
    el('SCRIPT'), el('style'), el('IFRAME', { src: 'https://x' }), el('OBJECT'), el('EMBED'), el('LINK'),
    el('IMG', { src: 'https://cdn.test/a.png', onerror: 'x()', srcset: 'javascript:1' }),
    el('DIV', {}, [el('FORM', {}, [el('INPUT')]), el('SPAN', { OnMouseOver: 'x()' })]),
    el('H2', { style: 'text-align:center; color: #e30613; position:fixed; background-color: url(https://x); font-size:32px' }),
  ])
  cleanTree(root)
  const tags = (n) => n.children.flatMap(c => [c.tagName, ...tags(c)])
  assert.deepEqual(tags(root), ['P', 'A', 'A', 'IMG', 'DIV', 'SPAN', 'H2'])
  const attrs = (n) => n.children.flatMap(c => [...c.attributes.map(a => `${c.tagName}.${a.name}=${a.value}`), ...attrs(c)])
  assert.deepEqual(attrs(root), ['P.class=x', 'A.title=t', 'A.href=https://ok.test/', 'IMG.src=https://cdn.test/a.png', 'H2.style=text-align: center; color: #e30613; font-size: 32px'],
    'text formatting kept; positioning and url() values dropped')
})

test('hidden blocks: attribute injected into zone components only, strip removes hidden rows through components and relations', () => {
  const { hiddenName, injectHidden, stripHidden } = require('../server/hidden.js')
  assert.equal(hiddenName(undefined), 'bsHidden'); assert.equal(hiddenName(false), false); assert.equal(hiddenName('isHidden'), 'isHidden')
  for (const bad of ['1x', 'a-b', '', 42, true, 'x'.repeat(41)]) assert.equal(hiddenName(bad), null, String(bad))
  const components = { 'b.hero': { attributes: { title: { type: 'string' } } }, 'b.text': { attributes: { bsHidden: { type: 'string' } } }, 'b.item': { attributes: {} } }
  const contentTypes = { 'api::page.page': { attributes: { blocks: { type: 'dynamiczone', components: ['b.hero', 'b.text'] }, other: { type: 'component', component: 'b.item' } } } }
  assert.deepEqual(injectHidden(components, contentTypes, 'bsHidden'), { added: ['b.hero'], skipped: ['b.text'] })
  assert.deepEqual(components['b.hero'].attributes.bsHidden, { type: 'boolean', default: false, configurable: false })
  assert.equal(components['b.item'].attributes.bsHidden, undefined, 'components outside a zone are untouched')
  const schemas = { 'api::page.page': { attributes: { blocks: { type: 'dynamiczone' }, seo: { type: 'component', component: 'shared.seo' }, related: { type: 'relation', target: 'api::page.page' } } },
    'shared.seo': { attributes: { zone: { type: 'dynamiczone' } } }, 'b.hero': { attributes: { items: { type: 'component', component: 'b.item', repeatable: true } } }, 'b.item': { attributes: {} } }
  const page = { title: 'x', blocks: [{ __component: 'b.hero', bsHidden: true }, { __component: 'b.hero', bsHidden: false, items: [{ bsHidden: true }] }, { __component: 'b.hero' }],
    seo: { zone: [{ __component: 'b.item', bsHidden: true }, { __component: 'b.item' }] },
    related: [{ blocks: [{ __component: 'b.hero', bsHidden: true }, { __component: 'b.hero', bsHidden: null }] }] }
  const out = stripHidden([page], schemas['api::page.page'], uid => schemas[uid], 'bsHidden')[0]
  assert.equal(out.blocks.length, 2); assert.equal(out.blocks[0].items.length, 1, 'only Dynamic Zone rows are removed')
  assert.equal(out.seo.zone.length, 1); assert.equal(out.related[0].blocks.length, 1, 'populated relations are stripped too')
  assert.equal(stripHidden(null, schemas['api::page.page'], uid => schemas[uid], 'bsHidden'), null)
})

test('row clone: ids stripped from the row and nested components, media and relation targets kept, relations to connect', async () => {
  const { cloneRow, relationSlots, currentRelations, toConnect } = await import('../admin/rows.mjs')
  const components = { 'b.hero': { attributes: { title: { type: 'string' }, image: { type: 'media' }, items: { type: 'component', component: 'b.item', repeatable: true },
    link: { type: 'relation', relation: 'oneToMany', target: 'api::page.page' } } }, 'b.item': { attributes: { label: { type: 'string' }, page: { type: 'relation', target: 'api::page.page' } } } }
  const row = { id: 7, documentId: 'x', __component: 'b.hero', __temp_key__: 'a0', title: 'T', bsHidden: true, image: { id: 3, url: '/u.png' },
    items: [{ id: 11, __temp_key__: 'a0', label: 'L', page: { connect: [], disconnect: [] } }, { __temp_key__: 'a1', label: 'M', page: { connect: [{ id: 9, apiData: { id: 9, documentId: 'd9', locale: null } }], disconnect: [] } }],
    link: { connect: [{ id: 5, apiData: { id: 5, documentId: 'd5', locale: 'en' } }], disconnect: [{ id: 2, apiData: { id: 2, documentId: 'd2' } }] } }
  const plain = cloneRow(row, components)
  assert.equal(plain.id, undefined); assert.equal(plain.documentId, undefined); assert.equal(plain.items[0].id, undefined)
  assert.equal(plain.image.id, 3, 'media keeps its id'); assert.equal(plain.bsHidden, true); assert.equal(plain.items[1].__temp_key__, 'a1')
  plain.items[0].label = 'changed'; assert.equal(row.items[0].label, 'L', 'deep copy')
  assert.deepEqual(relationSlots(row, components).map(s => `${s.path}@${s.uid}#${s.id}`), ['items.0.page@b.item#11', 'link@b.hero#7'])
  const server = { link: [{ id: 1, documentId: 'd1', locale: 'en' }, { id: 2, documentId: 'd2', locale: 'en' }], 'items.0.page': [{ id: 4, documentId: 'd4' }] }
  const out = cloneRow(row, components, { relation: (value, attr, path) => toConnect(currentRelations(server[path.join('.')] || [], value), attr.target) })
  assert.deepEqual(out.link.connect.map(r => r.apiData.documentId), ['d1', 'd5'], 'server minus disconnected plus connected')
  assert.equal(out.link.connect[0].apiData.isTemporary, true); assert.deepEqual(out.link.disconnect, [])
  assert.equal(out.link.connect[0].href, '../collection-types/api::page.page/d1?plugins[i18n][locale]=en')
  assert.deepEqual(out.items.map(i => i.page.connect.map(r => r.id)), [[4], [9]])
})

test('row actions: group ranges, keys, hide range, clipboard storage and all-or-nothing paste validation', async () => {
  const { actionRange, expandSelection, canAct, fractionalKeys, integerKeys, insertRows, setHidden, readClip, writeClip, pasteProblem, CLIPBOARD_KEY } = await import('../admin/rows.mjs')
  const g = { 'w.open': 'w.close' }
  const rows = [{ __component: 'b.text', __temp_key__: 'a0' }, { __component: 'w.open', __temp_key__: 'a1' }, { __component: 'b.text', __temp_key__: 'a2' }, { __component: 'w.close', __temp_key__: 'a3' }]
  assert.deepEqual(actionRange(rows, 1, g), [1, 3]); assert.deepEqual(actionRange(rows, 2, g), [2, 2]); assert.deepEqual(actionRange(rows, 1, null), [1, 1])
  assert.deepEqual(expandSelection(rows, [2, 1, -1], g), [1, 2, 3])
  assert.equal(canAct(rows[3], g), false); assert.equal(canAct(rows[3], null), true)
  const keys = fractionalKeys(rows, 2, 2); assert.ok(keys[0] > 'a1' && keys[1] < 'a2' && keys[0] < keys[1])
  assert.equal(fractionalKeys([{ __temp_key__: 'a5' }, { __temp_key__: 'a0' }], 1, 1)[0] > 'a5', true, 'unordered neighbours: after the largest')
  assert.deepEqual(integerKeys([{ __temp_key__: 3 }, { __temp_key__: 1 }], 2), [4, 5])
  assert.deepEqual(insertRows(rows, 1, [{ __component: 'x' }], ['k']).map(r => r.__temp_key__), ['a0', 'k', 'a1', 'a2', 'a3'])
  assert.deepEqual(setHidden(rows, 1, g, 'bsHidden', true).map(r => Boolean(r.bsHidden)), [false, true, true, true])
  assert.equal(rows[1].bsHidden, undefined, 'no mutation')
  const store = new Map(); const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  assert.equal(readClip(storage), null)
  assert.equal(writeClip(storage, { rows: rows.slice(1), model: 'api::page.page', locale: 'en', zone: 'blocks' }), true)
  const clip = readClip(storage); assert.equal(clip.v, 1); assert.equal(clip.rows.length, 3); assert.equal(clip.model, 'api::page.page')
  assert.equal(writeClip({ setItem() { throw new Error('quota') } }, { rows: [rows[0]] }), false)
  store.set(CLIPBOARD_KEY, '{"v":2,"rows":[{"__component":"b.text"}]}'); assert.equal(readClip(storage), null, 'other versions ignored')
  store.set(CLIPBOARD_KEY, 'not json'); assert.equal(readClip(storage), null)
  const components = { 'b.text': {}, 'w.open': {}, 'w.close': {} }
  const zone = { components: ['b.text', 'w.open', 'w.close'], max: 7 }
  assert.equal(pasteProblem(clip, zone, rows, components, g), null)
  assert.deepEqual(pasteProblem(clip, { ...zone, components: ['b.text'] }, rows, components, g), { code: 'notAllowed', uid: 'w.open' })
  assert.deepEqual(pasteProblem(clip, { ...zone, max: 6 }, rows, components, g), { code: 'full' })
  assert.deepEqual(pasteProblem({ rows: rows.slice(2) }, zone, [], components, g), { code: 'unbalanced' })
  assert.equal(pasteProblem({ rows: rows.slice(2) }, zone, [], components, null), null, 'no groups config: markers are ordinary blocks')
  assert.deepEqual(pasteProblem(null, zone, [], components, g), { code: 'empty' })
  assert.deepEqual(pasteProblem({ rows: [{ __component: 'b.gone' }] }, { components: ['b.gone'] }, [], components, g), { code: 'notAllowed', uid: 'b.gone' })
})

test('row action options: strict validation, lenient read, defaults on', () => {
  const { validateSettings, mergeSaved, DEFAULTS } = require('../server/settings.js')
  assert.deepEqual([DEFAULTS.editor.confirmDelete, DEFAULTS.editor.hiddenBlocks, DEFAULTS.editor.duplicate, DEFAULTS.editor.clipboard], [true, 'strip', true, true])
  const ok = validateSettings({ editor: { confirmDelete: false, hiddenBlocks: 'flag', duplicate: false, clipboard: false } }, [])
  assert.deepEqual([ok.editor.confirmDelete, ok.editor.hiddenBlocks, ok.editor.duplicate, ok.editor.clipboard], [false, 'flag', false, false])
  for (const bad of [{ hiddenBlocks: 'hide' }, { hiddenBlocks: true }, { confirmDelete: 'yes' }, { duplicate: 1 }, { clipboard: null }])
    assert.throws(() => validateSettings({ editor: bad }, []), /editor option/, JSON.stringify(bad))
  const read = mergeSaved({ editor: { hiddenBlocks: 'hide', clipboard: 'no', duplicate: false } }, [])
  assert.deepEqual([read.editor.hiddenBlocks, read.editor.clipboard, read.editor.duplicate], ['strip', true, false])
})

test('page projection marks hidden rows only when the attribute is given', async () => {
  const { projectPage } = await import('../admin/preview.mjs')
  const components = { 'b.text': { attributes: { body: { type: 'text' } } } }
  const rows = [{ __component: 'b.text', __temp_key__: 'a0', body: 'x', bsHidden: true }, { __component: 'b.text', __temp_key__: 'a1', body: 'y' }]
  assert.deepEqual(projectPage(rows, components, 'http://cms.test', 'bsHidden').map(b => b.hidden), [true, undefined])
  assert.equal(projectPage(rows, components, 'http://cms.test')[0].hidden, undefined)
})
