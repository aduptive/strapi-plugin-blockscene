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
// Rows near the viewport first. `rects` are the rows' {top, bottom}, `view` the visible {top, bottom} of the scroller
// and `margin` how far around it still counts as near. `now` keeps list order; `later` is nearest first.
export function planRows(rects, view, margin = 0) {
  const now = [], later = []
  const gap = (r) => Math.max(view.top - margin - r.bottom, r.top - view.bottom - margin, 0)
  rects.forEach((r, i) => (gap(r) === 0 ? now : later).push(i))
  later.sort((a, b) => gap(rects[a]) - gap(rects[b]))
  return { now, later }
}
// The nearest ancestor that scrolls vertically (the admin scrolls an inner container), else null for the viewport.
export function scroller(el) {
  for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return null
}
// One pending open/close all per list: a new one (or navigation, see stopAll) replaces it.
const jobs = new Map()
export function stopAll() { for (const stop of jobs.values()) stop(); jobs.clear() }
const PER_FRAME = 3
const idle = (run) => typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 300 }) : setTimeout(() => run({ timeRemaining: () => 8 }), 16)
const frame = (run) => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16)
// Measured on a 34-block page with CKEditor fields (Strapi 5.31): opening every row in one React batch is one
// long task of about 3 s, and closing them all about 1.6 s, so neither touches the whole list at once.
// - open: rows in or within one viewport of the visible area open a few per frame (one `batch` each: the host's
//   unstable_batchedUpdates, passed by the admin so this module stays Node-testable), top first, until they fill
//   that area; the others open when an IntersectionObserver sees them approach while scrolling. The intent lasts
//   until Close all, another open all or navigation (stopAll).
// - close: the visible rows close in one batch, the rest a few per idle slice (off-screen, so nobody waits).
// Headers are re-read before each click, so a re-render or a user click never gets toggled back.
export function setAll(list, open, batch = (run) => run()) {
  jobs.get(list)?.(); jobs.delete(list)
  const header = (li) => li.querySelector('button[aria-expanded]')
  const differs = (li) => { const b = li.isConnected && header(li); return b && (b.getAttribute('aria-expanded') === 'true') !== open ? b : null }
  const click = (rows) => { const buttons = rows.map(differs).filter(Boolean); if (buttons.length) batch(() => { for (const b of buttons) b.click() }); return buttons.length }
  const rows = [...list.querySelectorAll(':scope > li')].filter(differs)
  if (!rows.length) return 0
  const root = scroller(list)
  const view = () => root ? root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
  const height = view().bottom - view().top
  const { now, later } = planRows(rows.map(li => li.getBoundingClientRect()), view(), open ? height : 0)
  let stopped = false, handle = 0
  if (open) {
    if (typeof IntersectionObserver === 'undefined') return click(rows)
    // Rows are measured again before each click: the rows opened just before push the next ones away, and a row that
    // left the margin waits for the observer instead of opening off-screen.
    const near = (li) => planRows([li.getBoundingClientRect()], view(), height).now.length > 0
    const queue = new Set(now.map(i => rows[i]))
    let changed = 0
    const flush = () => {
      handle = 0
      if (stopped) return
      const next = []
      for (const li of queue) {
        if (next.length === PER_FRAME) break
        queue.delete(li)
        if (near(li)) next.push(li); else observer.observe(li)
      }
      changed += click(next)
      if (queue.size) handle = frame(flush)
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); queue.add(entry.target) }
      if (queue.size && !handle && !stopped) handle = frame(flush)
    }, { root, rootMargin: `${Math.round(height)}px 0px` })
    later.forEach(i => observer.observe(rows[i]))
    jobs.set(list, () => { stopped = true; observer.disconnect() })
    flush()
    return changed
  }
  const changed = click(now.map(i => rows[i]))
  if (!later.length) return changed
  const pending = later.map(i => rows[i])
  const slice = (deadline) => {
    if (stopped) return
    click(pending.splice(0, deadline.timeRemaining() > 10 ? PER_FRAME : 1))
    if (pending.length) idle(slice); else jobs.delete(list)
  }
  idle(slice)
  jobs.set(list, () => { stopped = true })
  return changed
}
// The native "Add a component to <name>" button of a zone: a plain button (no accordion header, no block row, not
// inside a dialog or our own gallery button) whose label ends with the zone's label as the edit view renders it (the raw
// name unless "Configure the view" or the field labels hook renamed it), which Strapi's message carries in every locale.
// An empty zone renders nothing but this button, so the zone is identified by its name or label only; Dynamic Zones
// cannot nest, so a button inside a block row is never one.
export function isNativeAddButton(button, zone) {
  // Our own controls ("Open all blocks", "Paste 2 blocks", the gallery trigger, the preview toolbar) also end with the zone name.
  if (!button || button.getAttribute('aria-expanded') || button.closest('ol[aria-describedby] > li, [role="dialog"], [data-testid^="open-gallery-"], [data-testid^="block-"], [data-testid^="page-preview"], [data-testid^="bp-"], [data-testid^="zone-"], [data-blockscene-row-actions]')) return false
  const text = (button.textContent || '').trim()
  const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = [...new Set([zone.name, zone.label].filter(Boolean))].map(escape).join('|')
  return Boolean(text) && new RegExp(`(^|\\s)(${names})$`).test(text)
}
