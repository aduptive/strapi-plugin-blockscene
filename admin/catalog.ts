import * as React from 'react'
// One catalog request per edit view. Any failure yields null, which the
// adapters treat as "use the native editor" so a plugin outage never blocks editing.
// The last catalog is also kept for the synchronous edit-layout hook (field labels).
let cached: any = null
let pending: Promise<void> | null = null
// The side panel and the injected editor ask at the same time: one request in flight serves both.
let flight: Promise<any> | null = null
const load = (get: any) => (flight ||= get('/blockscene/catalog').then(({ data }: any) => { cached = data; return data }).finally(() => { flight = null }))
export function useCatalog(get: any) {
  const [catalog, setCatalog] = React.useState<any>(null)
  React.useEffect(() => {
    let active = true
    load(get).then((data: any) => { if (active) setCatalog(data) }).catch(() => { if (active) setCatalog(null) })
    return () => { active = false }
  }, [get])
  return catalog
}
// The admin's interface language (Strapi 4 and 5 keep it under this key), else the page's, else English.
const adminLocale = () => {
  try { return localStorage.getItem('strapi-admin-language') || document.documentElement.lang || 'en' } catch { return 'en' }
}
// Content Manager hook 'Admin/CM/pages/EditView/mutate-edit-view-layout'. It runs synchronously, so it uses the last
// catalog: until one has loaded (the first edit/list view of a session) only the hidden-on-site attribute is removed
// (default name) and a fetch starts; the next layout computed (another document, list -> edit) gets the labels.
// The removal runs whatever the editor settings (kill switch included): the attribute exists whenever the server adds it.
// Any error: layout untouched.
export const labelsHook = (get: () => any, relabel: (layout: any, catalog: any, locale: string) => any, drop: (layout: any, name: string | null) => any) => (args: any) => {
  try {
    if (!cached) pending ||= load(get()).catch(() => {}).finally(() => { pending = null })
    const trimmed = drop(args.layout, cached ? cached.hiddenAttribute : 'bsHidden')
    const layout = cached ? relabel(trimmed, cached, adminLocale()) : trimmed
    return layout === args.layout ? args : { ...args, layout }
  } catch (error) {
    console.error('[blockscene] field labels skipped after an error:', error)
    return args
  }
}
