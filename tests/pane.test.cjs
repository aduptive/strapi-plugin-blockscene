const assert = require('node:assert/strict')
const { test } = require('node:test')
const { validateSettings, mergeSaved, DEFAULTS } = require('../server/settings.js')

const types = { 'api::page.page': ['title'] }
const rejects = (input) => assert.throws(() => validateSettings(input, [], types), { name: 'ValidationError' }, JSON.stringify(input))

test('page preview toolbar and widths: strict on write, global and per content type', () => {
  assert.deepEqual(DEFAULTS.editor.previewToolbar, ['modes', 'history', 'devices', 'status', 'actions'])
  assert.deepEqual(DEFAULTS.editor.previewDevices, ['fit', 'mobile', 'tablet', 'desktop'])
  const ok = validateSettings({ editor: { previewToolbar: ['actions', 'modes'], previewDevices: ['fit', { label: ' Wide ', width: 1920 }, 'mobile'] },
    contentTypes: { 'api::page.page': { previewToolbar: [], previewDevices: ['desktop'] } } }, [], types)
  assert.deepEqual(ok.editor.previewToolbar, ['actions', 'modes'])
  assert.deepEqual(ok.editor.previewDevices, ['fit', { label: 'Wide', width: 1920 }, 'mobile'], 'custom labels are trimmed')
  assert.deepEqual(ok.contentTypes['api::page.page'], { previewToolbar: [], previewDevices: ['desktop'] })
  for (const editor of [{ previewToolbar: ['modes', 'modes'] }, { previewToolbar: ['zoom'] }, { previewToolbar: 'modes' },
    { previewDevices: [] }, { previewDevices: ['watch'] }, { previewDevices: ['fit', 'fit'] }, { previewDevices: Array(9).fill(0).map((_, i) => ({ label: 'W', width: 300 + i })) },
    { previewDevices: [{ label: 'A', width: 800 }, { label: 'B', width: 800 }] }, { previewDevices: [{ label: 'Tiny', width: 239 }] },
    { previewDevices: [{ label: 'Huge', width: 3841 }] }, { previewDevices: [{ label: 'Half', width: 400.5 }] }, { previewDevices: [{ label: '<b>', width: 400 }] },
    { previewDevices: [{ label: '', width: 400 }] }, { previewDevices: [{ label: 'X', width: 400, icon: 'mobile' }] }]) rejects({ editor })
  rejects({ contentTypes: { 'api::page.page': { previewToolbar: ['modes', 'nope'] } } })
})

test('page preview toolbar and widths: a saved value that no longer validates falls back to the default', () => {
  const merged = mergeSaved({ editor: { previewToolbar: ['modes', 'bogus'], previewDevices: [{ label: 'Wide', width: 1920 }] },
    contentTypes: { 'api::page.page': { previewToolbar: ['status'], previewDevices: ['fit', 'fit'] } } }, [], types)
  assert.deepEqual(merged.editor.previewToolbar, DEFAULTS.editor.previewToolbar)
  assert.deepEqual(merged.editor.previewDevices, [{ label: 'Wide', width: 1920 }])
  assert.deepEqual(merged.contentTypes['api::page.page'], { previewToolbar: ['status'] })
})

test('toolbar layout keeps the configured order; status and actions are one right group at the first of them', async () => {
  const { toolbarLayout, TOOLBAR } = await import('../admin/pane.mjs')
  assert.deepEqual(toolbarLayout(undefined), { before: ['modes', 'history', 'devices'], right: ['status', 'actions'], after: [] })
  assert.deepEqual(toolbarLayout(TOOLBAR), toolbarLayout(undefined))
  assert.deepEqual(toolbarLayout(['devices', 'actions', 'modes', 'status']), { before: ['devices'], right: ['actions', 'status'], after: ['modes'] })
  assert.deepEqual(toolbarLayout(['history', 'modes']), { before: ['history', 'modes'], right: [], after: [] })
  assert.deepEqual(toolbarLayout([]), { before: [], right: [], after: [] })
  assert.deepEqual(toolbarLayout(['modes', 'x', 'modes']), { before: ['modes'], right: [], after: [] }, 'unknown and repeated ids are ignored')
})

test('width menu entries: built-in names, custom widths with a size icon, fallback to the built-in list', async () => {
  const { deviceEntries } = await import('../admin/pane.mjs')
  const devices = { fit: 0, mobile: 390, tablet: 834, desktop: 1440 }
  assert.deepEqual(deviceEntries(['mobile', { label: 'Phablet', width: 480 }, { label: 'Laptop', width: 1024 }, { label: 'TV', width: 1920 }], devices), [
    { id: 'mobile', name: 'mobile', width: 390, icon: 'mobile' },
    { id: 'px-480', label: 'Phablet', width: 480, icon: 'mobile' },
    { id: 'px-1024', label: 'Laptop', width: 1024, icon: 'tablet' },
    { id: 'px-1920', label: 'TV', width: 1920, icon: 'desktop' }])
  for (const bad of [undefined, [], ['watch'], [{ width: 400 }]]) assert.deepEqual(deviceEntries(bad, devices).map(entry => entry.id), ['fit', 'mobile', 'tablet', 'desktop'])
})

test('registerPanel: validated, replaced by id, filtered by content type; a bad panel is logged and ignored', async () => {
  const { registerPanel, panelProblem, panelsFor, panels } = await import('../admin/pane.mjs')
  const icons = ['seo', 'info']
  const Component = () => null
  const element = { $$typeof: Symbol.for('react.element') }
  assert.equal(panelProblem({ id: 'notes', label: 'Notes', Component }, icons), null)
  assert.equal(panelProblem({ id: 'notes', label: 'Notes', icon: element, open: 'modal', Component: { $$typeof: Symbol.for('react.memo') }, contentTypes: ['api::page.page'] }, icons), null)
  for (const bad of [null, { id: 'a b', label: 'X', Component }, { id: 'a', label: '', Component }, { id: 'a', label: '<i>', Component },
    { id: 'a', label: 'X', icon: 'rocket', Component }, { id: 'a', label: 'X', open: 'popover', Component }, { id: 'a', label: 'X', Component: 'div' },
    { id: 'a', label: 'X', Component, contentTypes: 'api::page.page' }, { id: 'a', label: 'X', Component, extra: 1 }]) assert.ok(panelProblem(bad, icons), JSON.stringify(bad))
  const error = console.error
  const logged = []
  console.error = (...args) => logged.push(args.join(' '))
  try {
    assert.equal(registerPanel({ id: 'a', label: 'X', icon: 'rocket', Component }, icons), false)
  } finally { console.error = error }
  assert.match(logged[0], /registerPanel: icon/)
  assert.equal(registerPanel({ id: 'notes', label: ' Notes ', icon: 'info', Component }, icons), true)
  assert.equal(registerPanel({ id: 'seo-check', label: 'SEO check', open: 'modal', Component, contentTypes: ['api::page.page'] }, icons), true)
  assert.equal(registerPanel({ id: 'notes', label: 'Notes v2', Component }, icons), true)
  assert.deepEqual(panels.map(panel => [panel.id, panel.label, panel.open]), [['notes', 'Notes v2', 'drawer'], ['seo-check', 'SEO check', 'modal']])
  assert.deepEqual(panelsFor('api::page.page').map(panel => panel.id), ['notes', 'seo-check'])
  assert.deepEqual(panelsFor('api::article.article').map(panel => panel.id), ['notes'])
})
