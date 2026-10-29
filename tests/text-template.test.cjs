const assert = require('node:assert/strict')
const { test } = require('node:test')
const { CUSTOM_FIELD, codePoints, validateTemplate, validateValue, demoValue, renderTextTemplate, renderTextTemplateElement, textTemplateClassName, resolveBinding, createEntryId, applyTextChange, mergePartialDocument, draftReadPlan, validateBulkUpdates, validateDocument, textTemplatePopulate } = require('../server/text-template')
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
  assert.equal(resolveBinding({ options: { blockscene: { textTemplate: 'api::article.article.headline' } } }, undefined, 'headline'), 'api::article.article.headline')
  assert.equal(resolveBinding({}, 'api::page.page', 'copy'), 'api::page.page.copy')
  assert.equal(resolveBinding({}, undefined, 'blocks.0.copy'), '')
})

test('new ids include preserved hidden values and IME composition is only rejected after it finishes', () => {
  assert.equal(createEntryId([], { 'text-fixed': 'old hidden copy' }, 'fixed'), 'text-fixed-2')
  assert.equal(createEntryId([{ id: 'text-fixed' }], {}, 'fixed'), 'text-fixed-2')
  const entry = { allowBreaks: true, maxChars: 3 }
  assert.deepEqual(applyTextChange(entry, 'abc', 'abcd', { composing: true, compositionStart: 'abc' }), { accepted: true, value: 'abcd' })
  assert.deepEqual(applyTextChange(entry, 'abcd', 'abcd', { composing: false, compositionStart: 'abc' }), { accepted: false, value: 'abc', code: 'maxChars' })
})

test('admin classes use only the validated token and modifiers', () => {
  assert.equal(textTemplateClassName(entries[0]), 'label uppercase')
  assert.equal(textTemplateClassName({ token: 'unsafe class', modifiers: ['underline'] }), '')
  assert.equal(textTemplateClassName({ token: 'safe-token', modifiers: ['script'] }), '')
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
    { id: 'eyebrow', tag: 'p', text: 'Example', lines: ['Example'], className: 'label uppercase' },
    { id: 'title', tag: 'h2', text: 'First line\nSecond line', lines: ['First line', 'Second line'], className: 'title-l' },
  ])
  assert.equal(value.values.removed, 'preserved')
  const element = renderTextTemplateElement(renderTextTemplate(entries, value)[1], (tag, props, ...children) => ({ tag, props, children }))
  assert.equal(element.tag, 'h2', 'line breaks stay inside one semantic heading')
  assert.deepEqual(element.children, ['First line', { tag: 'br', props: { key: 'title-break-1' }, children: [] }, 'Second line'])
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
  assert.deepEqual(textTemplatePopulate(schemas, 'api::page.page', templates), { blocks: { on: { 'blocks.text': {} } } })
  assert.equal(textTemplatePopulate(schemas, 'api::page.page', {}), null, 'unconfigured fields add no read/populate cost')
})

test('populate follows configured fields through nested components and partial updates retain stored content', () => {
  const schemas = {
    'api::page.page': { attributes: { blocks: { type: 'dynamiczone', components: ['blocks.text', 'blocks.other'] } } },
    'blocks.text': { attributes: { content: { type: 'component', component: 'shared.copy' } } },
    'blocks.other': { attributes: { title: { type: 'string' } } },
    'shared.copy': { attributes: { copy: { type: 'customField', customField: CUSTOM_FIELD, options: { blockscene: { textTemplate: 'shared.copy.copy' } } } } },
  }
  assert.deepEqual(textTemplatePopulate(schemas, 'api::page.page', { 'shared.copy.copy': entries }), {
    blocks: { on: { 'blocks.text': { populate: { content: true } } } },
  })
  const stored = { title: 'Stored', copy: { version: 1, values: { title: 'Kept' } } }
  assert.deepEqual(mergePartialDocument(stored, { title: 'Changed' }), { title: 'Changed', copy: stored.copy })
})

test('draft read plans expand every locale and keep ordinary publish reads scoped', () => {
  const populate = { blocks: { on: { 'blocks.text': {} } } }
  assert.deepEqual(draftReadPlan(true, { documentId: 'doc', locale: '*' }, populate, 'en'), {
    many: true, query: { filters: { documentId: 'doc' }, locale: '*', status: 'draft', populate },
  })
  assert.deepEqual(draftReadPlan(true, { documentId: 'doc' }, populate, 'en'), {
    many: false, query: { documentId: 'doc', locale: 'en', status: 'draft', populate },
  })
  assert.deepEqual(draftReadPlan(false, { documentId: 'doc', locale: '*' }, {}, 'en'), {
    many: false, query: { documentId: 'doc', status: 'draft' },
  })
})

test('Strapi 4 bulk updates validate every stored row after applying the partial patch', async () => {
  const seen = []
  const query = { findMany: async options => {
    assert.deepEqual(options, { where: { publishedAt: null }, populate: { blocks: true } })
    return [{ id: 1, title: 'One', copy: 'kept' }, { id: 2, title: 'Two', copy: 'kept too' }]
  } }
  assert.equal(await validateBulkUpdates(query, { publishedAt: null }, { blocks: true }, { publishedAt: 'now' }, entry => seen.push(entry)), 2)
  assert.deepEqual(seen, [
    { id: 1, title: 'One', copy: 'kept', publishedAt: 'now' },
    { id: 2, title: 'Two', copy: 'kept too', publishedAt: 'now' },
  ])
})

test('settings persist templates separately and reject bindings that are not Blockscene text fields', () => {
  const schemas = { 'blocks.text': { attributes: { copy: { type: 'json', customField: CUSTOM_FIELD }, other: { type: 'json' } } } }
  const ok = validateSettings({ textTemplates: { 'blocks.text.copy': entries } }, ['blocks.text'], [], null, schemas)
  assert.equal(ok.textTemplates['blocks.text.copy'][1].tag, 'h2')
  assert.throws(() => validateSettings({ textTemplates: { 'blocks.text.other': entries } }, ['blocks.text'], [], null, schemas), /Unknown text template field/)
  assert.deepEqual(mergeSaved({ textTemplates: { 'blocks.text.gone': entries } }, ['blocks.text'], [], null, schemas).textTemplates, {})
})

test('an explicit content-type binding is the single key used by settings and server validation', () => {
  const schemas = { 'api::article.article': { attributes: { headline: { type: 'json', customField: CUSTOM_FIELD, options: { blockscene: { textTemplate: 'api::article.article.headline-template' } } } } } }
  const templates = { 'api::article.article.headline-template': entries }
  assert.equal(validateSettings({ textTemplates: templates }, [], ['api::article.article'], null, schemas).textTemplates['api::article.article.headline-template'][0].id, 'eyebrow')
  assert.equal(validateDocument(schemas, 'api::article.article', { headline: { version: 1, values: { eyebrow: '', title: 'ok' } } }, templates)[0].path.join('.'), 'headline.eyebrow')
})

test('fallback bindings accept Strapi camelCase attribute names', () => {
  const schemas = { 'api::page.page': { attributes: { fallbackCopy: { type: 'json', customField: CUSTOM_FIELD } } } }
  const template = [{ id: 'title', label: 'Title', role: 'title', tag: 'h2', token: '', modifiers: [], required: true, allowBreaks: true, demo: 'Demo' }]
  assert.equal(resolveBinding(schemas['api::page.page'].attributes.fallbackCopy, 'api::page.page', 'fallbackCopy'), 'api::page.page.fallbackCopy')
  assert.doesNotThrow(() => validateSettings({ textTemplates: { 'api::page.page.fallbackCopy': template } }, [], [], null, schemas))
})
