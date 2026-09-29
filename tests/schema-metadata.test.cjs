const assert = require('node:assert/strict')
const { test } = require('node:test')
const { schemaMetadata, catalog } = require('../server/settings')

const schemas = () => ({
  'api::page.page': { info: { displayName: 'Page' }, attributes: { title: { type: 'string', pluginOptions: { blockscene: { label: 'Page title' } } }, blocks: { type: 'dynamiczone' } } },
  'sections.rich-text': { info: { displayName: 'Rich text', description: 'Formatted text with an optional title.' },
    pluginOptions: { blockscene: { typology: 'text', tags: [' Editorial ', 'Editorial'], keywords: 'paragraph copy' } },
    attributes: { anchor: { type: 'string', pluginOptions: { blockscene: { help: 'Id for links to this block, without "#".' } } },
      description: { type: 'text' }, text: { type: 'richtext' } } },
  'sections.tag': { info: { displayName: 'Tag' }, attributes: { label: { type: 'string', pluginOptions: { blockscene: { label: 'Tag text', placeholder: 'e.g. New' } } } } },
})

test('schema metadata: block and field texts from pluginOptions.blockscene and info.description', () => {
  const notes = []
  const { blocks, fields } = schemaMetadata(schemas(), null, notes)
  assert.deepEqual(blocks, { 'sections.rich-text': { typology: 'text', tags: ['Editorial'], keywords: 'paragraph copy', description: 'Formatted text with an optional title.' } })
  assert.deepEqual(fields, { 'api::page.page': { title: { label: 'Page title' } }, 'sections.rich-text': { anchor: { help: 'Id for links to this block, without "#".' } },
    'sections.tag': { label: { label: 'Tag text', placeholder: 'e.g. New' } } })
  assert.deepEqual(notes, [])
  assert.deepEqual(schemaMetadata({}, undefined), { blocks: {}, fields: {} })
})

test('schema metadata: invalid values are left out with a note naming the uid, the rest kept', () => {
  const s = schemas()
  s['sections.tag'].pluginOptions = { blockscene: { typology: 'banner', tags: 'x', image: 'javascript:alert(1)', label: 'x'.repeat(81), color: 'red', keywords: 'ok' } }
  s['sections.tag'].attributes.label.pluginOptions.blockscene = { label: { en: 'Tag' }, help: 'x'.repeat(501), hint: 'x', placeholder: 'e.g. New' }
  s['sections.rich-text'].attributes.text.pluginOptions = { blockscene: 'Body' }
  const notes = []
  const { blocks, fields } = schemaMetadata(s, null, notes)
  assert.deepEqual(blocks['sections.tag'], { keywords: 'ok' })
  assert.deepEqual(fields['sections.tag'], { label: { placeholder: 'e.g. New' } })
  assert.deepEqual([...notes].sort(), ['sections.tag: invalid typology', 'sections.tag: invalid tags', 'sections.tag: invalid image', 'sections.tag: invalid label', 'sections.tag: unknown key "color"',
    'sections.rich-text.text: pluginOptions.blockscene must be an object',
    'sections.tag.label: label must be a string of 1 to 80 characters', 'sections.tag.label: help must be a string of 1 to 500 characters', 'sections.tag.label: unknown key "hint"'].sort())
})

test('schema metadata: translations per locale, English source fallback, stale keys and invalid values skipped', () => {
  const notes = []
  const translations = { 'pt-BR': {
    'sections.rich-text': 'Texto formatado', 'sections.rich-text.description': 'Texto com título opcional.',
    'sections.rich-text.anchor': 'Âncora', 'sections.rich-text.anchor.help': 'Id para links a este bloco, sem "#".',
    'sections.rich-text.description.label': 'Descrição', 'sections.tag.label': 'Texto da tag', 'sections.tag.label.help': 'Curto.',
    'api::page.page.title': 'Título', 'sections.gone': 'x', 'sections.tag.gone': 'x', 'sections.tag.label.hint': 'x', 'sections.tag.label.help.x': 'x', 'api::page.page': 'Página',
    'sections.tag.label.placeholder': 'x'.repeat(121) },
  fr: { 'sections.tag.label': 'Libellé' }, 'not a locale': { 'sections.tag': 'x' }, de: 'x' }
  const { blocks, fields } = schemaMetadata(schemas(), translations, notes)
  assert.deepEqual(blocks['sections.rich-text'].label, { en: 'Rich text', 'pt-BR': 'Texto formatado' }, 'block label: displayName is the source')
  assert.deepEqual(blocks['sections.rich-text'].description, { en: 'Formatted text with an optional title.', 'pt-BR': 'Texto com título opcional.' })
  assert.equal(blocks['sections.tag'], undefined, 'no key for the block: nothing added')
  assert.deepEqual(fields['sections.rich-text'].anchor, { label: { en: null, 'pt-BR': 'Âncora' }, help: { en: 'Id for links to this block, without "#".', 'pt-BR': 'Id para links a este bloco, sem "#".' } },
    'no English label in the schema: null source (the admin keeps Strapi\'s own)')
  assert.deepEqual(fields['sections.rich-text'].description, { label: { en: null, 'pt-BR': 'Descrição' } }, '"<uid>.<attr>.label" names the attribute "description"')
  assert.deepEqual(fields['sections.tag'].label, { label: { en: 'Tag text', 'pt-BR': 'Texto da tag', fr: 'Libellé' }, placeholder: 'e.g. New', help: { en: null, 'pt-BR': 'Curto.' } })
  assert.deepEqual(fields['api::page.page'].title, { label: { en: 'Page title', 'pt-BR': 'Título' } })
  assert.equal(notes.length, 4)
  assert.match(notes[0], /pt-BR "sections\.tag\.label\.placeholder": a string of 1 to 120 characters/)
  assert.match(notes[1], /translations "not a locale" ignored/); assert.match(notes[2], /translations "de" ignored/)
  assert.equal(notes[3], 'translation keys naming no block or field were skipped: pt-BR "sections.gone", pt-BR "sections.tag.gone", pt-BR "sections.tag.label.hint", pt-BR "sections.tag.label.help.x", pt-BR "api::page.page"')
  const other = []
  schemaMetadata(schemas(), ['x'], other); assert.match(other[0], /translations must be/)
})

test('schema metadata: precedence code config > schema > native > automatic in the gallery catalog', async () => {
  const s = schemas()
  const { blocks } = schemaMetadata(s, { 'pt-BR': { 'sections.tag': 'Etiqueta' } })
  const out = catalog({ schemas: s, blocks, components: { 'sections.rich-text': { description: 'From code', tags: ['Code'] } } }).components
  assert.equal(out['sections.rich-text'].description, 'From code', 'code config wins')
  assert.deepEqual(out['sections.rich-text'].tags, ['Code'])
  assert.equal(out['sections.rich-text'].typology, 'text'); assert.equal(out['sections.rich-text'].keywords, 'paragraph copy', 'schema fills what the code leaves unset')
  assert.deepEqual(out['sections.tag'].label, { en: 'Tag', 'pt-BR': 'Etiqueta' }); assert.equal(out['sections.tag'].typology, 'text', 'automatic guess when neither sets it')
  assert.deepEqual(out['sections.tag'].tags, [])
  // The admin resolves the localized texts once per load; a null source falls back to the native text.
  const { localizeBlocks } = await import('../admin/model.mjs')
  const shown = localizeBlocks({ components: { ...out, 'sections.x': { description: { en: null, 'pt-BR': 'Só em português' } } } }, 'en').components
  assert.equal(shown['sections.tag'].label, 'Tag'); assert.equal(shown['sections.x'].description, undefined)
  assert.equal(shown['sections.rich-text'], out['sections.rich-text'], 'plain entries are passed through')
  assert.equal(localizeBlocks({ components: out }, 'pt-BR').components['sections.tag'].label, 'Etiqueta')
})

test('schema metadata: field texts, code config per text key > schema > "Configure the view" > humanized', async () => {
  const plugin = require('../server')
  const s = schemas()
  const warnings = []
  const config = { fields: { 'sections.tag': { label: { placeholder: 'From code', help: { en: 'Code help', 'pt-BR': 'Ajuda do código' } } } },
    translations: { 'pt-BR': { 'sections.tag.label': 'Texto da tag', 'sections.rich-text.anchor.help': 'Ajuda', 'sections.nope.x': 'x' } }, components: {} }
  const store = { get: async () => null }
  const strapi = { components: { 'sections.rich-text': s['sections.rich-text'], 'sections.tag': s['sections.tag'] }, contentTypes: { 'api::page.page': s['api::page.page'] },
    log: { warn: m => warnings.push(m) }, store: () => store, db: { query: () => ({ findOne: async () => null }) },
    plugin: () => ({ config: key => config[key], service: () => service }) }
  const service = plugin.services.settings({ strapi })
  const ctx = {}
  await plugin.controllers.catalog({ strapi }).find(ctx)
  const fields = ctx.body.fields
  assert.deepEqual(fields['sections.tag'].label, { label: { en: 'Tag text', 'pt-BR': 'Texto da tag' }, placeholder: 'From code', help: { en: 'Code help', 'pt-BR': 'Ajuda do código' } })
  assert.equal(ctx.body.components['sections.rich-text'].description, 'Formatted text with an optional title.')
  assert.deepEqual(ctx.body.components['sections.rich-text'].tags, ['Editorial'])
  assert.equal(warnings.length, 1); assert.match(warnings[0], /schema metadata left out: translation keys naming no block or field were skipped: pt-BR "sections\.nope\.x"/)
  service.fields(); assert.equal(warnings.length, 1, 'read and warned once')
  const { labelEditLayout } = await import('../admin/model.mjs')
  const f = (name, label = name) => ({ name, label, hint: '', placeholder: '' })
  const layout = { settings: { displayName: 'Page' }, layout: [[[f('title'), f('blocks')]]], components: { 'sections.rich-text': { layout: [[f('anchor', 'Anchor id'), f('text')]] },
    'sections.tag': { layout: [[f('label')]] } } }
  const cat = { editor: { enabled: true, friendlyLabels: true }, contentTypes: {}, types: ctx.body.types, fields }
  const labels = (locale) => { const out = labelEditLayout(layout, cat, locale); return [...out.layout.flat(2), ...Object.values(out.components).flatMap(c => c.layout.flat())].map(x => [x.label, x.hint, x.placeholder]) }
  assert.deepEqual(labels('en'), [['Page title', '', ''], ['Blocks', '', ''], ['Anchor id', 'Id for links to this block, without "#".', ''], ['Text', '', ''], ['Tag text', 'Code help', 'From code']])
  assert.deepEqual(labels('pt-BR'), [['Page title', '', ''], ['Blocks', '', ''], ['Anchor id', 'Ajuda', ''], ['Text', '', ''], ['Texto da tag', 'Ajuda do código', 'From code']])
})

test('migration script: config maps into schema files and per-locale translations, idempotent, formatting kept', () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs')
  const { join } = require('node:path')
  const { execFileSync } = require('node:child_process')
  const dir = mkdtempSync(join(require('node:os').tmpdir(), 'blockscene-meta-'))
  const write = (file, value, indent = 2) => { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), JSON.stringify(value, null, indent) + '\n') }
  write('src/components/sections/rich-text.json', { collectionName: 'c', info: { displayName: 'Rich text', icon: 'text' }, options: {},
    attributes: { anchor: { type: 'string' }, description: { type: 'text', pluginOptions: { i18n: { localized: true } } }, mobileColumns: { type: 'integer' } } })
  write('src/api/page/content-types/page/schema.json', { kind: 'collectionType', info: { displayName: 'Page' }, attributes: { title: { type: 'string' } } }, 4)
  write('fields.json', { 'sections.rich-text': { anchor: { help: { en: 'Id for links', 'pt-BR': 'Id para links' } }, description: { label: { 'pt-BR': 'Descrição' } },
    mobileColumns: { label: { en: 'Mobile columns', 'pt-BR': 'Colunas no celular' } } }, 'api::page.page': { title: { label: 'Page title' } }, 'api::gone.gone': { x: { label: 'x' } } })
  write('components.json', { 'sections.rich-text': { label: 'Rich text', description: 'Formatted text.', category: 'Editorial', typology: 'text', variants: [] } })
  const run = () => execFileSync(process.execPath, [join(__dirname, '..', 'scripts', 'schema-metadata.mjs'), dir, '--fields', join(dir, 'fields.json'), '--components', join(dir, 'components.json')], { encoding: 'utf8' })
  assert.match(run(), /3 file\(s\) changed[\s\S]*Not found in the schema files .*: api::gone\.gone[\s\S]*sections\.rich-text: variants/)
  const component = readFileSync(join(dir, 'src/components/sections/rich-text.json'), 'utf8')
  assert.deepEqual(Object.keys(JSON.parse(component)), ['collectionName', 'info', 'options', 'pluginOptions', 'attributes'], 'pluginOptions before attributes')
  assert.deepEqual(JSON.parse(component), { collectionName: 'c', info: { displayName: 'Rich text', icon: 'text', description: 'Formatted text.' }, options: {},
    pluginOptions: { blockscene: { typology: 'text', tags: ['Editorial'] } },
    attributes: { anchor: { type: 'string', pluginOptions: { blockscene: { help: 'Id for links' } } }, description: { type: 'text', pluginOptions: { i18n: { localized: true } } },
      mobileColumns: { type: 'integer' } } }, 'a label equal to the displayName or the humanized name is dropped')
  assert.match(readFileSync(join(dir, 'src/api/page/content-types/page/schema.json'), 'utf8'), /^ {20}"label": "Page title"$/m, 'the file keeps its 4-space indent')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'config/blockscene/pt-BR.json'), 'utf8')),
    { 'sections.rich-text.anchor.help': 'Id para links', 'sections.rich-text.description.label': 'Descrição', 'sections.rich-text.mobileColumns': 'Colunas no celular' })
  assert.match(run(), /^0 file\(s\) changed/, 'a second run changes nothing')
  assert.equal(readFileSync(join(dir, 'src/components/sections/rich-text.json'), 'utf8'), component)
})
