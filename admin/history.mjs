// Undo/redo stack of whole-form snapshots (pure: every call returns a new history).
// `present` is the value on screen; `coalesce` folds a change into the current step (continuous typing),
// never into the base state of an empty history.
export const createHistory = (present, cap = 100) => ({ past: [], present, future: [], cap })
export const record = (h, value, coalesce = false) =>
  coalesce && h.past.length
    ? { ...h, present: value, future: [] }
    : { ...h, past: [...h.past, h.present].slice(-h.cap), present: value, future: [] }
export const undo = h => h.past.length ? { ...h, past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h
export const redo = h => h.future.length ? { ...h, past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h
// Shortcuts: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z or Ctrl+Y redo; null for anything else.
export const historyKey = e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
  const key = String(e.key).toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  return key === 'y' && e.ctrlKey && !e.shiftKey ? 'redo' : null
}
