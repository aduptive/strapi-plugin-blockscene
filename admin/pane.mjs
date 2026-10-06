// Page preview pane configuration (Strapi 5): toolbar layout, width menu entries and the sidebar panels that a project
// or another plugin registers through `app.getPlugin('blockscene').apis.registerPanel`. Same rules as server/settings.js.
export const TOOLBAR = ['modes', 'history', 'versions', 'devices', 'status', 'actions']
const RIGHT = ['status', 'actions']

// Strapi 5.27+ turns its primary navigation into a full-width sticky header below the desktop breakpoint.
// Older Strapi versions and desktop layouts keep a vertical navigation, so they naturally resolve to zero.
export function topNavigationInset(navs, viewportWidth) {
  return Math.round(Math.max(0, ...(Array.isArray(navs) ? navs : []).flatMap(nav => {
    const rect = nav?.rect || {}
    return ['fixed', 'sticky'].includes(nav?.position) &&
      Math.abs(Number(rect.top) || 0) <= 1 &&
      (Number(rect.left) || 0) <= 1 &&
      Number(rect.right) >= viewportWidth - 1 &&
      Number(rect.height) > 0 && Number(rect.height) <= 128
      ? [Number(rect.bottom) || Number(rect.height)] : []
  })))
}

// Known ids in the configured order (unknown or repeated ones ignored). Status and actions stay one right-aligned group,
// placed where the first of them is listed; the preview loading notice lives in that group whatever the list says.
export function toolbarLayout(list) {
  const ids = Array.isArray(list) ? list.filter((id, i) => TOOLBAR.includes(id) && list.indexOf(id) === i) : TOOLBAR
  const at = ids.findIndex(id => RIGHT.includes(id))
  return at < 0 ? { before: ids, right: [], after: [] }
    : { before: ids.slice(0, at), right: ids.filter(id => RIGHT.includes(id)), after: ids.slice(at).filter(id => !RIGHT.includes(id)) }
}

// Width menu: built-in names keep their width and icon; a custom { label, width } gets the icon of its size class.
// `devices`: the built-in name -> width map (admin/devices.ts). Anything malformed falls back to the built-in list.
export function deviceEntries(list, devices) {
  const valid = Array.isArray(list) && list.length > 0 && list.every(item => item in devices ||
    (item && typeof item === 'object' && typeof item.label === 'string' && Number.isInteger(item.width) && item.width > 0))
  return (valid ? list : Object.keys(devices)).map(item => typeof item === 'string'
    ? { id: item, name: item, width: devices[item], icon: item }
    : { id: `px-${item.width}`, label: item.label, width: item.width, icon: item.width < 600 ? 'mobile' : item.width < 1100 ? 'tablet' : 'desktop' })
}

// Registered panels, in registration order. A panel with an id already registered replaces it (hot reload, re-bootstrap).
export const panels = []
const PANEL_ID = /^[A-Za-z0-9][\w-]{0,39}$/
const LABEL = /^[^<>]{1,40}$/
const TYPE_UID = /^[\w-]+::[\w.-]+$/
const element = value => Boolean(value) && typeof value === 'object' && '$$typeof' in value
// Returns the reason a panel is refused, or null. `icons`: the icon names the plugin draws.
export function panelProblem(panel, icons = []) {
  if (!panel || typeof panel !== 'object') return 'the panel must be an object'
  const unknown = Object.keys(panel).find(key => !['id', 'label', 'icon', 'open', 'Component', 'contentTypes'].includes(key))
  if (unknown) return `unknown key "${unknown}"`
  if (typeof panel.id !== 'string' || !PANEL_ID.test(panel.id)) return 'id: 1 to 40 letters, digits, _ or -'
  if (typeof panel.label !== 'string' || !LABEL.test(panel.label.trim())) return 'label: 1 to 40 characters, no < or >'
  if (panel.icon !== undefined && !(typeof panel.icon === 'string' ? icons.includes(panel.icon) : element(panel.icon))) return 'icon: a Blockscene icon name or a React element'
  if (panel.open !== undefined && !['drawer', 'modal'].includes(panel.open)) return 'open: "drawer" or "modal"'
  if (!(typeof panel.Component === 'function' || element(panel.Component))) return 'Component: a React component'
  if (panel.contentTypes !== undefined && !(Array.isArray(panel.contentTypes) && panel.contentTypes.every(uid => typeof uid === 'string' && TYPE_UID.test(uid)))) return 'contentTypes: a list of content type uids'
  return null
}
// A refused panel is logged and skipped: a mistake in a host's bootstrap must not stop the admin from starting.
export function registerPanel(panel, icons) {
  const problem = panelProblem(panel, icons)
  if (problem) {
    console.error(`[blockscene] registerPanel: ${problem}; panel ignored.`)
    return false
  }
  const entry = { id: panel.id, label: panel.label.trim(), icon: panel.icon, open: panel.open || 'drawer', Component: panel.Component,
    contentTypes: panel.contentTypes ? [...panel.contentTypes] : null, custom: true }
  const at = panels.findIndex(item => item.id === entry.id)
  if (at >= 0) panels[at] = entry; else panels.push(entry)
  return true
}
export const panelsFor = model => panels.filter(panel => !panel.contentTypes || panel.contentTypes.includes(model))
