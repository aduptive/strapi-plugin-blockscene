const assert = require('node:assert/strict')
const { test } = require('node:test')
const { validLayout, layoutFields, parseColumns, layoutColumns } = require('../server/groups')
const { validateSettings, mergeSaved } = require('../server/settings')

// Rows named by id: 'O…' an OPEN, 'C…' a CLOSE, anything else a block (as in groups.test.cjs).
const g = { 'w.grid': 'w.close' }
const uid = name => name.startsWith('O') ? 'w.grid' : name.startsWith('C') ? 'w.close' : 'b.text'
const list = (...names) => names.map(id => ({ id, __component: uid(id) }))
const ids = rows => rows && rows.map(r => r.id)
const grid = { attributes: {
  columns: { type: 'enumeration', enum: ['1', '2', '3'], default: '1' }, columnsMd: { type: 'enumeration', enum: ['1', '2', '3'], default: '2' },
  gap: { type: 'integer', default: 4 }, count: { type: 'string' }, ratio: { type: 'float' },
  margin: { type: 'enumeration', enum: ['none', 'both'] }, dark: { type: 'boolean' }, secret: { type: 'integer', private: true }, body: { type: 'text' },
} }

test('layout validation: the attribute exists and can hold a column count; shape and maxColumns are strict', () => {
  const a = grid.attributes
  assert.deepEqual(layoutFields(grid), ['columns', 'columnsMd', 'gap', 'count', 'ratio'], 'numbers, strings and numeric enumerations only')
  assert.ok(validLayout({ columnsField: 'columnsMd' }, a))
  assert.ok(validLayout({ columnsField: 'columnsMd', mobileColumnsField: 'columns', maxColumns: 3 }, a))
  assert.ok(validLayout({ columnsField: 'gap' }, a) && validLayout({ columnsField: 'count' }, a))
  for (const bad of [null, [], 'columns', {}, { columnsField: 'nope' }, { columnsField: 'margin' }, { columnsField: 'dark' }, { columnsField: 'secret' },
    { columnsField: 'body' }, { columnsField: 'columns', mobileColumnsField: 'margin' }, { columnsField: 'columns', maxColumns: 0 },
    { columnsField: 'columns', maxColumns: 13 }, { columnsField: 'columns', maxColumns: 2.5 }, { columnsField: 'columns', extra: true }])
    assert.equal(validLayout(bad, a), false, JSON.stringify(bad))
  assert.ok(validLayout({ columnsField: 'anything' }, null), 'no schema: shape only')
})

test('layout in settings: PUT validation against the component schema; a stale saved layout is dropped on read', () => {
  const uids = ['w.grid', 'w.close', 'b.text'], schemas = { 'w.grid': grid, 'w.close': { attributes: {} } }
  const out = validateSettings({ components: { 'w.grid': { layout: { columnsField: 'columnsMd', mobileColumnsField: 'columns' } } } }, uids, [], null, schemas)
  assert.deepEqual(out.components['w.grid'], { layout: { columnsField: 'columnsMd', mobileColumnsField: 'columns' } })
  assert.throws(() => validateSettings({ components: { 'w.grid': { layout: { columnsField: 'margin' } } } }, uids, [], null, schemas), /Invalid layout for "w.grid"/)
  assert.throws(() => validateSettings({ components: { 'w.close': { layout: { columnsField: 'columns' } } } }, uids, [], null, schemas), /Invalid layout/)
  const saved = { components: { 'w.grid': { layout: { columnsField: 'removed' }, template: 'generic' }, 'b.text': { layout: { columnsField: 'x' } } } }
  assert.deepEqual(mergeSaved(saved, uids, [], null, schemas).components, { 'w.grid': { template: 'generic' } })
})

test('column parsing: whole numbers and numeric strings; the row value, else the default, else 1, capped at maxColumns', () => {
  assert.deepEqual([3, '2', ' 4 ', '12', 0, -1, 2.5, '2.5', 'two', '', null, undefined, true].map(v => parseColumns(v)), [3, 2, 4, 12, null, null, null, null, null, null, null, null, null])
  const layout = { columnsField: 'columnsMd', mobileColumnsField: 'columns' }
  assert.deepEqual(layoutColumns({ columnsMd: '3', columns: '1' }, layout, grid), { desktop: 3, mobile: 1 })
  assert.deepEqual(layoutColumns({}, layout, grid), { desktop: 2, mobile: 1 }, 'schema defaults')
  assert.deepEqual(layoutColumns({ count: 'x' }, { columnsField: 'count' }, grid), { desktop: 1, mobile: null }, 'nothing usable: 1, no mobile')
  assert.deepEqual(layoutColumns({ gap: 9 }, { columnsField: 'gap', maxColumns: 4 }, grid), { desktop: 4, mobile: null }, 'capped')
  assert.equal(layoutColumns({ gap: 40 }, { columnsField: 'gap' }, grid).desktop, 12, 'default cap 12')
})

test('grid cells ↔ zone order: children in order, a nested group as one cell, the CLOSE never a cell', async () => {
  const { gridCells } = await import('../admin/rows.mjs')
  const rows = list('A', 'O1', 'b', 'O2', 'x', 'y', 'C2', 'c', 'C1', 'D')
  assert.deepEqual(gridCells(rows, 1, g), [[2, 2], [3, 6], [7, 7]])
  assert.deepEqual(gridCells(rows, 3, g), [[4, 4], [5, 5]], 'the nested OPEN has its own cells')
  assert.deepEqual(gridCells(list('O1', 'C1'), 0, g), [], 'empty group')
  assert.equal(gridCells(rows, 0, g), null, 'not an OPEN'); assert.equal(gridCells(list('O1', 'a'), 0, g), null, 'unclosed')
  assert.equal(gridCells(rows, 1, null), null, 'no config')
})

test('move a cell: one new zone array, nested groups travel whole, rows outside the group untouched', async () => {
  const { moveCell } = await import('../admin/rows.mjs')
  const rows = list('A', 'O1', 'b', 'O2', 'x', 'C2', 'c', 'C1', 'D')
  assert.deepEqual(ids(moveCell(rows, 1, g, 0, 2)), ['A', 'O1', 'O2', 'x', 'C2', 'c', 'b', 'C1', 'D'], 'first to last')
  assert.deepEqual(ids(moveCell(rows, 1, g, 1, 0)), ['A', 'O1', 'O2', 'x', 'C2', 'b', 'c', 'C1', 'D'], 'the nested group moves as one cell')
  assert.deepEqual(ids(moveCell(rows, 1, g, 2, 1)), ['A', 'O1', 'b', 'c', 'O2', 'x', 'C2', 'C1', 'D'])
  const moved = moveCell(rows, 1, g, 0, 1)
  assert.ok(moved.every(row => rows.includes(row)), 'the same row objects (keys, unsaved values)')
  assert.equal(moveCell(rows, 1, g, 1, 1), null); assert.equal(moveCell(rows, 1, g, 0, 3), null, 'out of range')
})

test('keeping groups together leaves a grid reorder alone (no OPEN reads as moved)', async () => {
  const { moveCell, keepGroupsTogether } = await import('../admin/rows.mjs')
  const rows = list('O1', 'b', 'O2', 'x', 'C2', 'c', 'C1')
  for (const [from, to] of [[0, 1], [1, 0], [0, 2], [2, 0], [1, 2]]) {
    const next = moveCell(rows, 0, g, from, to)
    assert.equal(keepGroupsTogether(rows, next, g, null), null, `${from} -> ${to}`)
  }
})

test('remove from group: the cell goes right after the CLOSE, nested groups whole', async () => {
  const { removeFromGroup, groupOutline } = await import('../admin/rows.mjs')
  const rows = list('A', 'O1', 'b', 'O2', 'x', 'C2', 'c', 'C1', 'D')
  assert.deepEqual(ids(removeFromGroup(rows, 1, g, 0)), ['A', 'O1', 'O2', 'x', 'C2', 'c', 'C1', 'b', 'D'])
  assert.deepEqual(ids(removeFromGroup(rows, 1, g, 1)), ['A', 'O1', 'b', 'c', 'C1', 'O2', 'x', 'C2', 'D'])
  assert.deepEqual(ids(removeFromGroup(rows, 3, g, 0)), ['A', 'O1', 'b', 'O2', 'C2', 'x', 'c', 'C1', 'D'], 'out of the inner group: still inside the outer one')
  assert.deepEqual(groupOutline(removeFromGroup(rows, 1, g, 0), g).map(r => r.depth), [0, 0, 1, 2, 2, 1, 1, 0, 0], 'the removed block is top level')
  assert.equal(removeFromGroup(rows, 1, g, 5), null)
})

test('text summary: first non-empty text attribute, markup stripped, shortened', async () => {
  const { textSummary } = await import('../admin/rows.mjs')
  const schema = { attributes: { image: { type: 'media' }, title: { type: 'string' }, body: { type: 'richtext' }, n: { type: 'integer' } } }
  assert.equal(textSummary({ title: '  ', body: '<p>Hello&nbsp;<b>world</b></p>' }, schema), 'Hello world')
  assert.equal(textSummary({ title: 'Title', body: 'x' }, schema), 'Title')
  assert.equal(textSummary({ title: 'x'.repeat(100) }, schema, 10), `${'x'.repeat(9)}…`)
  assert.equal(textSummary({ n: 3 }, schema), '')
})
