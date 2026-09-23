// Native Dynamic Zone accordions, driven through the DOM: no patch of Strapi's
// Content Manager is needed. Each zone renders `<ol aria-describedby>` with one
// `<li>` per block whose header is a `button[aria-expanded]` (Design System 1
// and 2). The zone is matched by its visible label, which precedes the list.
// ponytail: label matching; switch to a native slot if Strapi ever exposes one.
export function zoneLists(root = document) {
  return [...root.querySelectorAll('ol[aria-describedby]')].filter(list => list.querySelector(':scope > li button[aria-expanded]'))
}
export function findZoneList(label, root = document) {
  const lists = zoneLists(root)
  const text = (list) => (list.parentElement?.textContent || '').trim().toLocaleLowerCase()
  return lists.find(list => text(list).startsWith(String(label).toLocaleLowerCase())) || (lists.length === 1 ? lists[0] : null)
}
export function toggles(list) {
  return [...list.querySelectorAll(':scope > li')].map(item => item.querySelector('button[aria-expanded]')).filter(Boolean)
}
// Clicks only the headers that differ from the target state. Measured on a 34-block page (Strapi 5.31):
// - opening: one React batch mounts every block's fields in a single render (1.3 s); one click per frame
//   re-renders the whole list 34 times (5.6 s).
// - closing: one batch tears every editor down in one 4 s long task (8 s until the last header settles);
//   one click per frame stays responsive and finishes in about 3 s.
// So opening is batched (`batch` = the host's unstable_batchedUpdates, passed by the admin so this module stays
// Node-testable) and closing yields a frame between clicks; headers are re-read so a re-render never repeats a
// click. Resolves with how many headers changed.
export function setAll(list, open, batch = (run) => run()) {
  const pending = toggles(list).filter(button => (button.getAttribute('aria-expanded') === 'true') !== open)
  if (open) { batch(() => { for (const button of pending) button.click() }); return Promise.resolve(pending.length) }
  const frame = () => new Promise(resolve => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16)))
  return (async () => {
    let changed = 0
    for (const button of pending) {
      if (!button.isConnected || button.getAttribute('aria-expanded') !== 'true') continue
      button.click(); changed++
      await frame()
    }
    return changed
  })()
}
// The native "Add a component to <name>" button of a zone: a plain button (no accordion header, no block row, not
// inside a dialog or our own gallery button) whose label ends with the raw zone name, which Strapi's message carries in
// every locale. An empty zone renders nothing but this button, so the zone is identified by the name only; Dynamic
// Zones cannot nest, so a button inside a block row is never one.
export function isNativeAddButton(button, zone) {
  // Our own controls ("Open all blocks", the gallery trigger, the preview toolbar) also end with the zone name.
  if (!button || button.getAttribute('aria-expanded') || button.closest('ol[aria-describedby] > li, [role="dialog"], [data-testid^="open-gallery-"], [data-testid^="block-"], [data-testid^="page-preview"], [data-testid^="bp-"]')) return false
  const text = (button.textContent || '').trim()
  return Boolean(text) && new RegExp(`(^|\\s)${String(zone.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(text)
}
