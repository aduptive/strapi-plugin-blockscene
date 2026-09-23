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
  assert.equal(isNativeAddButton(button('Add a component to sidebar'), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Add a component to sub blocks'), { name: 'blocks' }), true, 'suffix rule: documented limit for zone names that end another zone name')
  assert.equal(isNativeAddButton(button('Add a component to blocks', { 'aria-expanded': 'false' }), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Add a component to blocks', { inside: 'ol[aria-describedby] > li' }), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Add a component to blocks', { inside: '[role="dialog"]' }), { name: 'blocks' }), false)
  assert.equal(isNativeAddButton(button('Open all blocks', { inside: '[data-testid^="block-"]' }), { name: 'blocks' }), false, 'the plugin\'s own accordion controls are not the native button')
})
