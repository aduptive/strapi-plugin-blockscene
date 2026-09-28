const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DEFAULTS, layer, overrides, mergeSaved } = require('../server/settings')

const code = (editor) => ({ ...structuredClone(DEFAULTS), editor: { ...DEFAULTS.editor, ...editor } })
const read = (base, saved) => mergeSaved(layer(base, saved), [], []).editor

test('settings layers: an empty saved preview URL never hides the code one', () => {
  const base = code({ previewUrl: 'https://site.example/block-preview/page', blockPreviewUrl: 'https://site.example/b/{name}' })
  // A Settings page saved before the code default existed stored the empty strings.
  assert.equal(read(base, { editor: { previewUrl: '', blockPreviewUrl: '' } }).previewUrl, 'https://site.example/block-preview/page')
  assert.equal(read(base, { editor: { previewUrl: '', blockPreviewUrl: '' } }).blockPreviewUrl, 'https://site.example/b/{name}')
  // A saved URL still wins over the code one.
  assert.equal(read(base, { editor: { previewUrl: 'https://other.example/p' } }).previewUrl, 'https://other.example/p')
  // Other saved values are untouched (an empty-looking value that is not an optional URL keeps overriding).
  assert.equal(read(base, { editor: { previewUrl: '', previewMode: 'split' } }).previewMode, 'split')
})

test('settings layers: without a code default an empty saved URL reads as empty', () => {
  assert.equal(read(null, { editor: { previewUrl: '' } }).previewUrl, '')
  assert.equal(read(code({}), { editor: { previewUrl: '' } }).previewUrl, '')
})

test('settings layers: clearing the URL in Settings stores nothing for it', () => {
  const base = code({ previewUrl: 'https://site.example/block-preview/page' })
  const next = { ...structuredClone(base), editor: { ...base.editor, previewUrl: '', previewMode: 'split' } }
  const stored = overrides(next, base)
  assert.deepEqual(stored.editor, { previewMode: 'split' })
  assert.equal(read(base, stored).previewUrl, 'https://site.example/block-preview/page', 'the code value applies again')
})
