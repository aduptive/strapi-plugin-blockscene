const assert = require('node:assert/strict')
const { test } = require('node:test')

// Rows named by id: 'A' is an ordinary block, 'O…' an OPEN, 'C…' a CLOSE (uids per the map below).
const g = { 'w.grid': 'w.close', 'w.mutate': 'w.close' }
const uid = name => name.startsWith('Om') ? 'w.mutate' : name.startsWith('O') ? 'w.grid' : name.startsWith('C') ? 'w.close' : 'b.text'
const list = (...names) => names.map(id => ({ id, __component: uid(id) }))
const ids = rows => rows && rows.map(r => r.id)

test('dynamic zones reject component UIDs outside their schema allowlist', () => {
  const { invalidComponents } = require('../server/groups')
  const rows = [{ __component: 'blocks.hero' }, { __component: 'blocks.text' }, {}, null]
  assert.deepEqual(invalidComponents(rows, ['blocks.text']), [{ index: 0, uid: 'blocks.hero' }])
  assert.deepEqual(invalidComponents([], ['blocks.text']), [])
})

test('group outline: depth, kinds, parents, end and count; nested, shared CLOSE, stray and unclosed markers', async () => {
  const { groupOutline } = await import('../admin/rows.mjs')
  const out = groupOutline(list('A', 'O1', 'b', 'O2', 'c', 'C2', 'C1', 'D'), g)
  assert.deepEqual(out.map(r => r.depth), [0, 0, 1, 1, 2, 2, 1, 0])
  assert.deepEqual(out.map(r => r.kind), ['block', 'open', 'block', 'open', 'block', 'close', 'close', 'block'])
  assert.deepEqual([out[1].end, out[1].count, out[3].end, out[3].count], [6, 3, 5, 1], 'counts every row inside but CLOSE markers')
  assert.deepEqual(out[4].parents, [1, 3]); assert.deepEqual(out[5].parents, [1, 3], 'a CLOSE is inside its own group')
  const shared = groupOutline(list('O1', 'Om', 'x', 'Cm', 'C1'), g)
  assert.deepEqual([shared[0].end, shared[1].end], [4, 3], 'several OPENs share one CLOSE: innermost first')
  const stray = groupOutline(list('C0', 'A'), g)
  assert.deepEqual(stray.map(r => [r.kind, r.depth]), [['block', 0], ['block', 0]], 'a stray CLOSE is an ordinary row')
  const unclosed = groupOutline(list('O1', 'A', 'B'), g)
  assert.equal(unclosed[0].end, undefined); assert.deepEqual(unclosed.map(r => r.depth), [0, 1, 1], 'an unclosed OPEN wraps the rest')
  assert.deepEqual(groupOutline(list('O1', 'A', 'C1'), null).map(r => r.kind), ['block', 'block', 'block'], 'no config: no groups')
})

test('moved row: one relocation from the form state, adjacent swaps need the actor, anything else is null', async () => {
  const { movedRow } = await import('../admin/rows.mjs')
  const prev = list('A', 'B', 'C', 'D')
  assert.deepEqual(movedRow(prev, list('B', 'C', 'A', 'D')), { from: 0, to: 2 })
  assert.deepEqual(movedRow(prev, list('D', 'A', 'B', 'C')), { from: 3, to: 0 })
  assert.equal(movedRow(prev, list('B', 'A', 'C', 'D')), null, 'swap without actor: ambiguous')
  assert.deepEqual(movedRow(prev, list('B', 'A', 'C', 'D'), 'b.text#A'), { from: 0, to: 1 })
  assert.deepEqual(movedRow(prev, list('B', 'A', 'C', 'D'), 'b.text#B'), { from: 1, to: 0 })
  assert.equal(movedRow(prev, list('B', 'A', 'D', 'C')), null, 'two moves')
  assert.equal(movedRow(prev, list('A', 'B', 'C')), null, 'delete'); assert.equal(movedRow(prev, prev.slice()), null, 'no change')
  // A moved unsaved row that comes back with a new __temp_key__ (older Strapi) is still found.
  const temp = [{ __component: 'w.grid', __temp_key__: 'a1' }, { __component: 'b.text', __temp_key__: 'a2' }, { __component: 'b.text', __temp_key__: 'a3' }]
  assert.deepEqual(movedRow(temp, [temp[1], temp[2], { ...temp[0], __temp_key__: 'a4' }]), { from: 0, to: 2 })
})

test('keep groups together: a moved OPEN takes its members; own range, nesting, shared CLOSE, children, CLOSE, strays', async () => {
  const { keepGroupsTogether } = await import('../admin/rows.mjs')
  const K = keepGroupsTogether
  const key = id => `${uid(id)}#${id}`
  // Dragged down past B (mouse, settled on drop) and up past A (keyboard: one row, the actor says who moved).
  assert.deepEqual(ids(K(list('A', 'O1', 'c', 'C1', 'B'), list('A', 'c', 'C1', 'B', 'O1'), g)), ['A', 'B', 'O1', 'c', 'C1'])
  assert.deepEqual(ids(K(list('A', 'O1', 'c', 'C1'), list('O1', 'A', 'c', 'C1'), g, key('O1'))), ['O1', 'c', 'C1', 'A'])
  assert.equal(K(list('A', 'O1', 'c', 'C1'), list('O1', 'A', 'c', 'C1'), g, key('A')), null, 'A moved down: it joins the group')
  // Dropped among its own members: the group moves one row down; already last, the move is undone.
  assert.deepEqual(ids(K(list('A', 'O1', 'c', 'C1', 'B'), list('A', 'c', 'O1', 'C1', 'B'), g, key('O1'))), ['A', 'B', 'O1', 'c', 'C1'])
  assert.deepEqual(ids(K(list('A', 'O1', 'c', 'd', 'C1', 'B'), list('A', 'c', 'd', 'C1', 'O1', 'B'), g)), ['A', 'B', 'O1', 'c', 'd', 'C1'], 'right after its CLOSE counts too')
  assert.deepEqual(ids(K(list('A', 'O1', 'c', 'C1'), list('A', 'c', 'O1', 'C1'), g, key('O1'))), ['A', 'O1', 'c', 'C1'])
  assert.deepEqual(ids(K(list('O1', 'C1', 'B'), list('C1', 'O1', 'B'), g, key('O1'))), ['B', 'O1', 'C1'], 'empty group, one row down')
  // Nested: the outer group carries the inner one; the inner one leaves the outer one with its own members only.
  const nested = list('A', 'O1', 'b', 'O2', 'c', 'C2', 'C1', 'D')
  assert.deepEqual(ids(K(nested, list('A', 'b', 'O2', 'c', 'C2', 'C1', 'D', 'O1'), g)), ['A', 'D', 'O1', 'b', 'O2', 'c', 'C2', 'C1'])
  assert.deepEqual(ids(K(nested, list('O2', 'A', 'O1', 'b', 'c', 'C2', 'C1', 'D'), g)), ['O2', 'c', 'C2', 'A', 'O1', 'b', 'C1', 'D'])
  // An OPEN moved into another group lands nested there with its members.
  assert.deepEqual(ids(K(list('O1', 'x', 'C1', 'O2', 'y', 'C2'), list('O1', 'O2', 'x', 'C1', 'y', 'C2'), g)), ['O1', 'O2', 'y', 'C2', 'x', 'C1'])
  // Two OPEN components sharing one CLOSE uid: each group keeps its own CLOSE row.
  assert.deepEqual(ids(K(list('O1', 'a', 'C1', 'Om', 'b', 'Cm'), list('Om', 'O1', 'a', 'C1', 'b', 'Cm'), g)), ['Om', 'b', 'Cm', 'O1', 'a', 'C1'])
  // Left alone: a child moved out (independent now), a CLOSE moved (the group ends there), strays, unclosed, no config.
  assert.equal(K(list('O1', 'c', 'd', 'C1', 'B'), list('O1', 'd', 'C1', 'c', 'B'), g), null, 'child moved out')
  assert.equal(K(list('O1', 'c', 'C1', 'B'), list('O1', 'c', 'B', 'C1'), g, key('C1')), null, 'CLOSE moved')
  assert.equal(K(list('C0', 'A', 'B'), list('A', 'B', 'C0'), g), null, 'stray CLOSE')
  assert.equal(K(list('O1', 'A', 'B'), list('A', 'B', 'O1'), g), null, 'unclosed OPEN')
  assert.equal(K(list('A', 'O1', 'c', 'C1', 'B'), list('A', 'c', 'C1', 'B', 'O1'), null), null, 'no config')
  assert.equal(K(list('A', 'O1', 'c', 'C1'), list('A', 'O1', 'c', 'C1', 'B'), g), null, 'insert')
  // Idempotent: the settled list compared with itself, or a whole-range move made by the plugin, needs nothing.
  const settled = K(list('A', 'O1', 'c', 'C1', 'B'), list('A', 'c', 'C1', 'B', 'O1'), g)
  assert.equal(K(settled, settled.slice(), g), null)
  assert.equal(K(list('A', 'O1', 'c', 'C1', 'B'), settled, g), null)
})

test('dragging an OPEN upward keeps its members when adjacent hover steps have no actor', async () => {
  const { keepGroupsTogether } = await import('../admin/rows.mjs')
  const before = list('A', 'X', 'Y', 'O1', 'L', 'R', 'C1')
  const firstHover = list('A', 'X', 'O1', 'Y', 'L', 'R', 'C1')
  const firstSettled = keepGroupsTogether(before, firstHover, g, null)
  assert.deepEqual(ids(firstSettled), ['A', 'X', 'O1', 'L', 'R', 'C1', 'Y'])
  const secondHover = list('A', 'O1', 'X', 'L', 'R', 'C1', 'Y')
  assert.deepEqual(ids(keepGroupsTogether(firstSettled, secondHover, g, null)), ['A', 'O1', 'L', 'R', 'C1', 'X', 'Y'])
})

test('error rows: nested (Strapi 5) and flat (Strapi 4) error shapes', async () => {
  const { errorRows } = await import('../admin/rows.mjs')
  assert.deepEqual(errorRows({ blocks: [undefined, undefined, { title: 'Required' }] }, 'blocks'), [2])
  assert.deepEqual(errorRows({ blocks: { 4: { title: 'x' } }, other: [{ a: 1 }] }, 'blocks'), [4])
  assert.deepEqual(errorRows({ 'blocks.3.title': { id: 'x' }, 'blocks.10': 'x', 'blocksy.1.a': 'x', blocks: 'Too many' }, 'blocks').sort((a, b) => a - b), [3, 10])
  assert.deepEqual(errorRows(null, 'blocks'), [])
})

test('drag step: one id while a mouse drag lasts and briefly after it ends', async () => {
  const { startDrag, endDrag, dragStep } = await import('../admin/history.mjs')
  assert.equal(dragStep(0), 0)
  startDrag(); const id = dragStep(1000); assert.ok(id > 0)
  endDrag(5000, 400); assert.equal(dragStep(5399), id, 'the settling write joins the drag'); assert.equal(dragStep(5400), 0)
})
