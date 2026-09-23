import * as React from 'react'
// One catalog request per edit view. Any failure yields null, which the
// adapters treat as "use the native editor" so a plugin outage never blocks editing.
export function useCatalog(get: any) {
  const [catalog, setCatalog] = React.useState<any>(null)
  React.useEffect(() => {
    let active = true
    get('/block-picker/catalog').then(({ data }: any) => { if (active) setCatalog(data) }).catch(() => { if (active) setCatalog(null) })
    return () => { active = false }
  }, [get])
  return catalog
}
