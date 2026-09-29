const assert = require('node:assert/strict')
const { test } = require('node:test')
const { validateKits } = require('../server/settings')

const components = {
  'blocks.hero': { attributes: { title: { type: 'string', default: 'Default' }, image: { type: 'media' } } },
  'blocks.text': { attributes: { body: { type: 'text' } } },
  'layout.open': { attributes: {} },
  'layout.close': { attributes: {} },
}
const contentTypes = { 'api::page.page': { attributes: { blocks: { type: 'dynamiczone', max: 6, components: Object.keys(components) } } } }

test('starter kits: validate content-shaped rows and append configured group closers', () => {
  const notes = []
  const out = validateKits({ 'api::page.page': [{ id: 'landing', label: { en: 'Landing', 'pt-BR': 'Página de campanha' }, zones: { blocks: [
    { __component: 'blocks.hero', title: 'Your headline', image: { id: 3 } },
    { __component: 'layout.open' },
    { __component: 'blocks.text', body: 'Replace this text.' },
  ] } }] }, contentTypes, components, { 'layout.open': 'layout.close' }, notes)
  assert.deepEqual(out['api::page.page'][0].zones.blocks, [
    { __component: 'blocks.hero', values: { title: 'Your headline' } },
    { __component: 'layout.open', values: {} },
    { __component: 'layout.close', values: {} },
    { __component: 'blocks.text', values: { body: 'Replace this text.' } },
  ])
  assert.match(notes.join('\n'), /media and relation values are not inserted/)
})

test('starter kits: invalid content types, zones and components are left out', () => {
  const notes = []
  const out = validateKits({
    'api::gone.gone': [],
    'api::page.page': [
      { id: 'bad-zone', label: 'Bad zone', zones: { nope: [{ __component: 'blocks.hero' }] } },
      { id: 'bad-block', label: 'Bad block', zones: { blocks: [{ __component: 'blocks.gone' }] } },
      { id: 'ok', label: 'Empty values', zones: { blocks: [{ __component: 'blocks.hero' }] } },
    ],
  }, contentTypes, components, null, notes)
  assert.deepEqual(out['api::page.page'].map(kit => kit.id), ['ok'])
  assert.match(notes.join('\n'), /unknown content type/)
  assert.match(notes.join('\n'), /unknown Dynamic Zone/)
  assert.match(notes.join('\n'), /is not allowed/)
})

test('starterKitRows builds editable defaults and refuses a non-empty zone', async () => {
  const { starterKitRows } = await import('../admin/model.mjs')
  const kit = { zones: { blocks: [{ __component: 'blocks.hero', values: { title: 'Starter' } }] } }
  const zones = [{ name: 'blocks', components: ['blocks.hero'], max: 3 }]
  const form = { rows: () => [], keys: (_rows, _at, n) => Array.from({ length: n }, (_, i) => `k${i}`) }
  assert.deepEqual(starterKitRows(kit, zones, components, form).blocks, [{ __component: 'blocks.hero', __temp_key__: 'k0', title: 'Starter' }])
  assert.equal(starterKitRows(kit, zones, components, { ...form, rows: () => [{}] }), null)
})
