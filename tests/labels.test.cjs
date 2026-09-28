const assert = require('node:assert/strict')
const { test } = require('node:test')

test('field labels: humanize names, keep acronym runs', async () => {
  const { humanize } = await import('../admin/model.mjs')
  const cases = { mobileColumnsCount: 'Mobile columns count', page_seo: 'Page seo', pageSEO: 'Page SEO', ctaURL: 'Cta URL',
    URLPath: 'URL path', 'hero-title': 'Hero title', h1Title: 'H1 title', title: 'Title', SEO: 'SEO', bsHidden: 'Bs hidden', '': '' }
  for (const [name, label] of Object.entries(cases)) assert.equal(humanize(name), label, name)
})

test('field labels: locale fallback exact > language > same language > en > first', async () => {
  const { localized } = await import('../admin/model.mjs')
  const text = { en: 'Title', 'pt-BR': 'Título', fr: 'Titre' }
  assert.equal(localized('Plain', 'fr'), 'Plain')
  assert.equal(localized(text, 'pt-BR'), 'Título'); assert.equal(localized(text, 'pt-br'), 'Título')
  assert.equal(localized(text, 'pt'), 'Título', 'same language'); assert.equal(localized(text, 'fr-CA'), 'Titre', 'language prefix')
  assert.equal(localized(text, 'de'), 'Title', 'en'); assert.equal(localized({ es: 'Título', it: 'Titolo' }, 'de'), 'Título', 'first')
  assert.equal(localized({ fr: 'Titre', 'fr-CA': 'Titre CA' }, 'fr-CA'), 'Titre CA'); assert.equal(localized(undefined, 'en'), undefined)
})

test('field labels: config > "Configure the view" > humanized; kill switches and ambiguity leave the layout alone', async () => {
  const { labelEditLayout, labelEditLayout4, layoutType } = await import('../admin/model.mjs')
  const f = (name, label = name) => ({ name, label, hint: '', placeholder: '' })
  const layout = { settings: { displayName: 'Page' }, layout: [[[f('pageTitle'), f('seoURL', 'Custom')]], [[f('blocks')]]],
    components: { 'b.hero': { layout: [[f('ctaURL'), f('mobileColumnsCount')]] } } }
  const catalog = { editor: { enabled: true, friendlyLabels: true }, contentTypes: {},
    types: { 'api::page.page': ['Page', 'pageTitle', 'seoURL', 'blocks', 'other'], 'api::post.post': ['Post', 'pageTitle'] },
    fields: { 'api::page.page': { seoURL: { label: { en: 'SEO address', 'pt-BR': 'Endereço SEO' }, description: 'Used by search engines' } },
      'b.hero': { mobileColumnsCount: { label: 'Columns (mobile)', placeholder: { en: 'e.g. 2', pt: 'ex. 2' } } } } }
  const labels = (out) => [...out.layout.flat(2), ...out.components['b.hero'].layout.flat()].map(x => x.label)
  let out = labelEditLayout(layout, catalog, 'pt-BR')
  assert.deepEqual(labels(out), ['Page title', 'Endereço SEO', 'Blocks', 'Cta URL', 'Columns (mobile)'])
  assert.equal(out.layout[0][0][1].hint, 'Used by search engines'); assert.equal(out.components['b.hero'].layout[0][1].placeholder, 'ex. 2')
  assert.equal(out.layout[0][0][0].hint, '', 'no config: native description kept')
  assert.equal(layout.layout[0][0][0].label, 'pageTitle', 'input not mutated')
  // Option off: config texts still apply, raw names stay raw.
  out = labelEditLayout(layout, { ...catalog, editor: { enabled: true, friendlyLabels: false } }, 'en')
  assert.deepEqual(labels(out), ['pageTitle', 'SEO address', 'blocks', 'ctaURL', 'Columns (mobile)'])
  out = labelEditLayout(layout, { ...catalog, fields: {} }, 'en')
  assert.equal(out.layout[0][0][1].label, 'Custom', 'a label set in "Configure the view" wins over humanizing')
  // Kill switches, ambiguous types, empty (loading) layouts: the same object comes back.
  assert.equal(labelEditLayout(layout, { ...catalog, editor: { enabled: false, friendlyLabels: true } }, 'en'), layout)
  assert.equal(labelEditLayout(layout, { ...catalog, contentTypes: { 'api::page.page': { enabled: false } } }, 'en'), layout)
  assert.equal(labelEditLayout(layout, { ...catalog, editor: { enabled: true, friendlyLabels: false }, fields: {} }, 'en'), layout)
  const empty = { layout: [], components: {}, settings: {} }
  assert.equal(labelEditLayout(empty, catalog, 'en'), empty)
  assert.equal(layoutType(layout, catalog.types), 'api::page.page')
  assert.equal(layoutType({ ...layout, settings: { displayName: 'Other' } }, catalog.types), null)
  const twin = { ...catalog.types, 'api::copy.copy': ['Page', 'pageTitle', 'seoURL', 'blocks'] }
  assert.equal(layoutType(layout, twin), false); assert.equal(labelEditLayout(layout, { ...catalog, types: twin }, 'en'), layout)
  out = labelEditLayout({ ...layout, settings: { displayName: 'Unknown' } }, catalog, 'en')
  assert.equal(out.layout[0][0][1].label, 'Custom', 'unknown type: no type config')
  assert.equal(out.components['b.hero'].layout[0][1].label, 'Columns (mobile)', 'components are keyed by uid, always known')
  // Strapi 4 shape: metadatas carry the texts; the uid comes with the layout.
  const m = (name, label = name) => ({ name, metadatas: { label, description: '', placeholder: '' } })
  const v4 = { contentType: { uid: 'api::page.page', layouts: { edit: [[m('pageTitle'), m('seoURL')]] } },
    components: { 'b.hero': { uid: 'b.hero', layouts: { edit: [[m('mobileColumnsCount')]] } } } }
  const out4 = labelEditLayout4(v4, catalog, 'en')
  assert.deepEqual(out4.contentType.layouts.edit[0].map(x => x.metadatas.label), ['Page title', 'SEO address'])
  assert.equal(out4.contentType.layouts.edit[0][1].metadatas.description, 'Used by search engines')
  assert.equal(out4.components['b.hero'].layouts.edit[0][0].metadatas.placeholder, 'e.g. 2')
  assert.equal(labelEditLayout4(v4, { ...catalog, contentTypes: { 'api::page.page': { enabled: false } } }, 'en'), v4)
})

test('field labels: code config validated strictly; invalid config ignored with a warning; catalog exposes it', async () => {
  const { validateFields, DEFAULTS, validateSettings } = require('../server/settings')
  const schemas = { 'api::page.page': ['title', 'blocks'], 'b.hero': ['ctaURL'] }
  const ok = { 'api::page.page': { title: { label: { en: 'Title', 'pt-BR': 'Título' }, description: 'Main heading', placeholder: 'Hello' } }, 'b.hero': { ctaURL: { label: 'Button link' } } }
  assert.deepEqual(validateFields(ok, schemas), ok); assert.deepEqual(validateFields(undefined, schemas), {})
  for (const [bad, message] of [[[], /must be an object/], [{ 'api::x.x': {} }, /Unknown content type or component "api::x.x"/],
    [{ 'b.hero': { nope: { label: 'x' } } }, /Unknown field "nope"/], [{ 'b.hero': { ctaURL: { hint: 'x' } } }, /Unknown field setting "hint"/],
    [{ 'b.hero': { ctaURL: { label: ' ' } } }, /Invalid label/], [{ 'b.hero': { ctaURL: { label: 'x'.repeat(81) } } }, /1 to 80/],
    [{ 'b.hero': { ctaURL: { label: { EN: 'x' } } } }, /Invalid label/], [{ 'b.hero': { ctaURL: { label: {} } } }, /Invalid label/],
    [{ 'b.hero': { ctaURL: { description: { en: 7 } } } }, /Invalid description/], [{ 'b.hero': { ctaURL: 'Link' } }, /Invalid entry/]])
    assert.throws(() => validateFields(bad, schemas), message)
  assert.equal(DEFAULTS.editor.friendlyLabels, true)
  assert.equal(validateSettings({ editor: { friendlyLabels: false } }, []).editor.friendlyLabels, false)
  assert.throws(() => validateSettings({ editor: { friendlyLabels: 'yes' } }, []), /friendlyLabels/)
  const plugin = require('../server')
  const make = (fields) => {
    const warnings = []; const store = { get: async () => null }
    const strapi = { components: { 'b.hero': { attributes: { ctaURL: {} } } },
      contentTypes: { 'api::page.page': { info: { displayName: 'Page' }, attributes: { title: {}, blocks: { type: 'dynamiczone', components: ['b.hero'] } } }, 'admin::user': { attributes: { email: {} } } },
      log: { warn: m => warnings.push(m) }, store: () => store, db: { query: () => ({ findOne: async () => null }) },
      plugin: () => ({ config: key => ({ fields, components: {} })[key], service: () => service }) }
    const service = plugin.services.settings({ strapi })
    return { strapi, warnings }
  }
  let { strapi, warnings } = make(ok)
  const ctx = {}
  await plugin.controllers.catalog({ strapi }).find(ctx)
  assert.deepEqual(ctx.body.fields, ok); assert.deepEqual(ctx.body.types, { 'api::page.page': ['Page', 'title', 'blocks'] })
  assert.equal(ctx.body.editor.friendlyLabels, true); assert.equal(warnings.length, 0)
  ;({ strapi, warnings } = make({ 'b.hero': { gone: { label: 'x' } } }))
  await plugin.controllers.catalog({ strapi }).find(ctx)
  assert.deepEqual(ctx.body.fields, {}); assert.match(warnings[0], /"fields" config ignored: Unknown field "gone" of "b.hero"/)
})
