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

test('starter kits: validate content-shaped rows, locale scope and append configured group closers', () => {
  const notes = []
  const out = validateKits({ 'api::page.page': [{ id: 'landing', label: { en: 'Landing', 'pt-BR': 'Página de campanha' }, locales: ['en', 'pt-BR'], zones: { blocks: [
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
  assert.deepEqual(out['api::page.page'][0].locales, ['en', 'pt-BR'])
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
  const { starterKitRows, starterKitsForLocale } = await import('../admin/model.mjs')
  const kit = { zones: { blocks: [{ __component: 'blocks.hero', values: { title: 'Starter' } }] } }
  const zones = [{ name: 'blocks', components: ['blocks.hero'], max: 3 }]
  const form = { rows: () => [], keys: (_rows, _at, n) => Array.from({ length: n }, (_, i) => `k${i}`) }
  assert.deepEqual(starterKitRows(kit, zones, components, form).blocks, [{ __component: 'blocks.hero', __temp_key__: 'k0', title: 'Starter' }])
  assert.equal(starterKitRows(kit, zones, components, { ...form, rows: () => [{}] }), null)
  const kits = [{ id: 'all' }, { id: 'pt', locales: ['pt'] }, { id: 'italian', locales: ['it-IT'] }]
  assert.deepEqual(starterKitsForLocale(kits, 'pt-BR').map(item => item.id), ['all', 'pt'])
  assert.deepEqual(starterKitsForLocale(kits, 'it-IT').map(item => item.id), ['all', 'italian'])
})

test('starter kits: required scalar fields and Dynamic Zone minimums reject incomplete kits', () => {
  const schemas = { ...components, 'blocks.required': { attributes: { title: { type: 'string', required: true } } } }
  const types = { 'api::page.page': { attributes: { blocks: { type: 'dynamiczone', min: 2, components: Object.keys(schemas) } } } }
  const notes = []
  const out = validateKits({ 'api::page.page': [
    { id: 'missing-field', label: 'Missing field', zones: { blocks: [{ __component: 'blocks.required' }, { __component: 'blocks.text' }] } },
    { id: 'too-short', label: 'Too short', zones: { blocks: [{ __component: 'blocks.text' }] } },
  ] }, types, schemas, null, notes)
  assert.deepEqual(out, {})
  assert.match(notes.join('\n'), /title is required/)
  assert.match(notes.join('\n'), /requires at least 2 rows/)
})
