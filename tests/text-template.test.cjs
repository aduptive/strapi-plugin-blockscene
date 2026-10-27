const assert = require('node:assert/strict')
const { test } = require('node:test')
const { CUSTOM_FIELD, codePoints, validateTemplate, validateValue, demoValue, renderTextTemplate, resolveBinding, validateDocument, textTemplatePopulate } = require('../server/text-template')
const { validateSettings, mergeSaved } = require('../server/settings')

const entries = [
  { id: 'eyebrow', label: 'Eyebrow', role: 'eyebrow', tag: 'p', token: 'label', modifiers: ['uppercase'], required: true, allowBreaks: false, maxChars: 20, demo: 'Example' },
  { id: 'title', label: 'Title', role: 'title', tag: 'h2', token: 'title-l', modifiers: [], required: true, allowBreaks: true, softLines: 2, maxChars: 80, demo: 'First line\nSecond line' },
  { id: 'description', label: 'Description', role: 'description', tag: 'p', token: '', modifiers: ['underline'], required: false, allowBreaks: true, demo: '' },
]

test('template entries are dynamic, ordered and strictly allowlisted; empty template is valid', () => {
  assert.deepEqual(validateTemplate([]), [])
  assert.deepEqual(validateTemplate(entries).map(entry => entry.id), ['eyebrow', 'title', 'description'])
  assert.deepEqual(validateTemplate([entries[2], entries[0]]).map(entry => entry.id), ['description', 'eyebrow'])
  assert.throws(() => validateTemplate([...entries, { ...entries[0] }]), /duplicate/)
  assert.throws(() => validateTemplate([{ ...entries[0], tag: 'script' }]), /Tag HTML/)
  assert.throws(() => validateTemplate([{ ...entries[0], modifiers: ['uppercase', 'lowercase'] }]), /modifiers/)
  assert.throws(() => validateTemplate([{ ...entries[0], demo: 'two\nlines' }]), /line breaks/)
})

test('admin binding prefers explicit component metadata and only falls back with a real content type uid', () => {
  assert.equal(resolveBinding({ options: { blockscene: { textTemplate: 'blocks.text.copy' } } }, undefined, 'blocks.0.copy'), 'blocks.text.copy')
  assert.equal(resolveBinding({}, 'api::page.page', 'copy'), 'api::page.page.copy')
  assert.equal(resolveBinding({}, undefined, 'blocks.0.copy'), '')
})

test('content validation distinguishes required, manual breaks and Unicode character limits without truncating', () => {
  assert.equal(codePoints('A😀B'), 3)
  const bad = validateValue(entries, { version: 1, values: { eyebrow: '', title: 'x'.repeat(81), description: '' } })
  assert.deepEqual(bad.errors.map(error => error.code), ['required', 'maxChars'])
  const newline = validateValue(entries, { version: 1, values: { eyebrow: 'one\ntwo', title: 'ok' } })
  assert.equal(newline.errors[0].code, 'lineBreak')
  assert.equal(newline.value.values.eyebrow, 'one\ntwo', 'server reports instead of silently rewriting existing content')
})

test('demo/reset and frontend projection share the active template and preserve hidden values', () => {
  const demo = demoValue(entries)
  assert.equal(demo.values.title, 'First line\nSecond line')
  const value = { version: 1, values: { ...demo.values, removed: 'preserved', description: '' } }
  assert.deepEqual(renderTextTemplate(entries, value), [
    { id: 'eyebrow', tag: 'p', text: 'Example', className: 'label uppercase' },
    { id: 'title', tag: 'h2', text: 'First line\nSecond line', className: 'title-l' },
  ])
  assert.equal(value.values.removed, 'preserved')
})

test('recursive document validation finds custom fields in Dynamic Zone components', () => {
  const schemas = {
    'api::page.page': { attributes: { blocks: { type: 'dynamiczone', components: ['blocks.text'] } } },
    'blocks.text': { attributes: { copy: { type: 'customField', customField: CUSTOM_FIELD } } },
  }
  const templates = { 'blocks.text.copy': entries }
  const errors = validateDocument(schemas, 'api::page.page', { blocks: [{ __component: 'blocks.text', copy: { version: 1, values: { eyebrow: '', title: 'ok' } } }] }, templates)
  assert.deepEqual(errors[0].path, ['blocks', 0, 'copy', 'eyebrow'])
  assert.deepEqual(validateDocument(schemas, 'api::page.page', { blocks: [{ __component: 'blocks.text' }] }, templates).map(error => error.code), ['required', 'required'])
  assert.deepEqual(textTemplatePopulate(schemas, 'api::page.page', templates), { blocks: true })
  assert.equal(textTemplatePopulate(schemas, 'api::page.page', {}), null, 'unconfigured fields add no read/populate cost')
})

test('settings persist templates separately and reject bindings that are not Blockscene text fields', () => {
  const schemas = { 'blocks.text': { attributes: { copy: { type: 'json', customField: CUSTOM_FIELD }, other: { type: 'json' } } } }
  const ok = validateSettings({ textTemplates: { 'blocks.text.copy': entries } }, ['blocks.text'], [], null, schemas)
  assert.equal(ok.textTemplates['blocks.text.copy'][1].tag, 'h2')
  assert.throws(() => validateSettings({ textTemplates: { 'blocks.text.other': entries } }, ['blocks.text'], [], null, schemas), /Unknown text template field/)
  assert.deepEqual(mergeSaved({ textTemplates: { 'blocks.text.gone': entries } }, ['blocks.text'], [], null, schemas).textTemplates, {})
})
