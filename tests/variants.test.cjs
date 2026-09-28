const assert = require('node:assert/strict')
const { test } = require('node:test')
const { validateVariants } = require('../server/settings')

const schemas = {
  'blocks.hero': { attributes: { title: { type: 'string', default: 'Hello' }, visible: { type: 'boolean', default: false },
    size: { type: 'enumeration', enum: ['s', 'l'], default: 's' }, count: { type: 'integer' }, data: { type: 'json' },
    image: { type: 'media' }, pages: { type: 'relation', target: 'api::page.page' }, secret: { type: 'password' },
    link: { type: 'component', component: 'shared.link' },
    items: { type: 'component', component: 'shared.item', repeatable: true, required: true, min: 2, max: 3 } } },
  'shared.item': { attributes: { label: { type: 'string', default: 'Nested default' }, icon: { type: 'media' } } },
  'shared.link': { attributes: { text: { type: 'string', default: 'More' }, url: { type: 'string' }, blank: { type: 'boolean', default: false } } },
}
const one = (values, extra = {}) => ({ 'blocks.hero': { label: 'Hero', variants: [{ id: 'dark', label: 'Dark', values, ...extra }] } })

test('variants: scalars, JSON and nested components are kept; a fixture shape is accepted', () => {
  const notes = []
  const values = { title: 'Variant', visible: true, size: 'l', count: 3, data: { any: [1] }, link: { id: 7, __component: 'shared.link', url: '/x' },
    items: [{ label: 'One', icon: { id: 3 } }, { id: 9, label: 'Two' }] }
  const out = validateVariants(one(values), schemas, notes)
  assert.deepEqual(out['blocks.hero'], [{ id: 'dark', label: 'Dark', values: { title: 'Variant', visible: true, size: 'l', count: 3, data: { any: [1] },
    link: { url: '/x' }, items: [{ label: 'One' }, { label: 'Two' }] } }])
  assert.match(notes.join('\n'), /media and relation values are not inserted \(values\.items\[0\]\.icon\)/)
  assert.deepEqual(validateVariants({ 'blocks.hero': { label: 'No variants' } }, schemas), {})
  assert.deepEqual(validateVariants(undefined, schemas), {})
  assert.deepEqual(validateVariants(one({}, { label: { en: 'Dark', 'pt-BR': 'Escuro' } }), schemas)['blocks.hero'][0].label, { en: 'Dark', 'pt-BR': 'Escuro' })
})

test('variants: unknown keys, wrong types and unsupported fields reject that variant only', () => {
  const bad = [
    [{ nope: 1 }, /values\.nope is not an attribute/],
    [{ link: { nope: 1 } }, /values\.link\.nope is not an attribute/],
    [{ items: [{ label: 'a', nope: 1 }] }, /values\.items\[0\]\.nope/],
    [{ title: 3 }, /not a valid string/],
    [{ size: 'xl' }, /not a valid enumeration/],
    [{ count: 1.5 }, /not a valid integer/],
    [{ secret: 'x' }, /password values are not supported/],
    [{ items: { label: 'a' } }, /must be a list of at most 3/],
    [{ items: [{}, {}, {}, {}] }, /at most 3/],
    [{ link: 'x' }, /values\.link must be an object/],
    [[], /values must be an object/],
  ]
  for (const [values, message] of bad) {
    const notes = []
    assert.deepEqual(validateVariants(one(values), schemas, notes), {}, JSON.stringify(values))
    assert.match(notes.join('\n'), message)
  }
  const notes = []
  const out = validateVariants({ 'blocks.hero': { variants: [{ id: 'ok', label: 'Ok', values: {} }, { id: 'ok', label: 'Again' }, { id: 'Bad Id', label: 'x' },
    { id: 'x', label: '' }, { id: 'y', label: 'y', extra: 1 }] }, 'blocks.gone': { variants: [] } }, schemas, notes)
  assert.deepEqual(out['blocks.hero'].map((variant) => variant.id), ['ok'])
  assert.equal(notes.length, 5)
  assert.match(notes.join('\n'), /blocks\.gone: unknown component/)
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `v${i}`, label: 'v' }))
  assert.deepEqual(validateVariants({ 'blocks.hero': { variants: many } }, schemas, []), {})
  assert.deepEqual(validateVariants(one({ data: 'x'.repeat(17 * 1024) }), schemas, []), {}, 'over 16 KB')
})

test('variantRow merges values over the schema defaults, nested components and lists included', async () => {
  const { variantRow, componentDefaults } = await import('../admin/model.mjs')
  assert.deepEqual(variantRow(schemas['blocks.hero'], schemas, undefined), componentDefaults(schemas['blocks.hero'], schemas))
  const row = variantRow(schemas['blocks.hero'], schemas, { title: 'Variant', link: { url: '/x' }, items: [{ label: 'One' }, {}, { label: 'Three' }] })
  assert.equal(row.title, 'Variant'); assert.equal(row.visible, false); assert.equal(row.size, 's')
  assert.deepEqual(row.link, { text: 'More', url: '/x', blank: false }, 'a nested component merges over its own defaults')
  assert.deepEqual(row.items.map((item) => item.label), ['One', 'Nested default', 'Three'], 'a list replaces the default list')
  assert.equal(new Set(row.items.map((item) => item.__temp_key__)).size, 3)
  const four = variantRow(schemas['blocks.hero'], schemas, { items: [{}, {}] }, (n) => [...Array(n).keys()])
  assert.deepEqual(four.items.map((item) => item.__temp_key__), [0, 1], 'Strapi 4 integer keys')
  const values = { data: { deep: [1] } }
  const copy = variantRow(schemas['blocks.hero'], schemas, values)
  copy.data.deep.push(2)
  assert.deepEqual(values.data.deep, [1], 'the config values are never shared with the form')
  assert.equal(variantRow(schemas['blocks.hero'], schemas, { link: null }).link, null)
})

test('the gallery entry carries the variants of its component', async () => {
  const { entriesFor } = await import('../admin/model.mjs')
  const zone = { name: 'blocks', components: ['blocks.hero', 'shared.link'] }
  const variants = [{ id: 'dark', label: 'Dark', values: {} }]
  const [hero, link] = entriesFor(zone, schemas, { components: { 'blocks.hero': { variants } } }, '')
    .sort((a, b) => a.uid.localeCompare(b.uid))
  assert.deepEqual(hero.variants, variants)
  assert.deepEqual(link.variants, [])
})
