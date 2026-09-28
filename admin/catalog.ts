import * as React from 'react'
// One catalog request per edit view. Any failure yields null, which the
// adapters treat as "use the native editor" so a plugin outage never blocks editing.
// The last catalog is also kept for the synchronous edit-layout hook (field labels).
let cached: any = null
let pending: Promise<void> | null = null
const load = (get: any) => get('/blockscene/catalog').then(({ data }: any) => { cached = data; return data })
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
// catalog: until one has loaded (the first edit/list view of a session) the layout is returned untouched and a fetch
// starts; the next layout computed (another document, list -> edit) gets the labels. Any error: layout untouched.
export const labelsHook = (get: () => any, relabel: (layout: any, catalog: any, locale: string) => any) => (args: any) => {
  try {
    if (!cached) {
      pending ||= load(get()).catch(() => {}).finally(() => { pending = null })
      return args
    }
    const layout = relabel(args.layout, cached, adminLocale())
    return layout === args.layout ? args : { ...args, layout }
  } catch (error) {
    console.error('[blockscene] field labels skipped after an error:', error)
    return args
  }
}
