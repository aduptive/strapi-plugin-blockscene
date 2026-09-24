import * as React from 'react'
import { Box, Button, Flex, Searchbar, Typography } from '@strapi/design-system'
import styled from 'styled-components'
import { candidatesFor } from './model.mjs'
import { Thumb } from './Gallery'
import { Wireframe, TEMPLATES, DEFAULT_PALETTE } from './wireframes'
import { useMessages } from './messages'

const COLOR = /^#[0-9A-Fa-f]{6}$/
// Components: responsive card grid (several per row, one per row on narrow screens).
const Grid = styled.div` display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 16px; `
const Card = styled.div`
  display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200}; background: ${({ theme }) => theme.colors.neutral0};
`
// Header with the change state and Save. The admin scrolls an inner container behind an `overflow: auto` wrapper, so
// CSS `position: sticky` never reaches the scroller: once the in-flow header leaves the viewport, a fixed bar sized to
// the content area (`#main-content`, as the page preview pane does) takes over with the same controls.
const Bar = styled.div`
  position: fixed; top: 0; z-index: 4; padding: 12px 32px;
  background: ${({ theme }) => theme.colors.neutral100}; border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  box-shadow: 0 1px 4px rgba(33, 33, 52, 0.1);
`
// The content area: `#main-content` where the admin sets it, otherwise the nearest scrolling ancestor of the page.
function useMainRect(anchor: React.RefObject<HTMLElement | null>) {
  const [rect, setRect] = React.useState({ left: 0, width: 0 })
  React.useEffect(() => {
    const read = () => {
      let host: HTMLElement | null = document.getElementById('main-content')
      for (let el = anchor.current?.parentElement; !host && el; el = el.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) host = el
      const r = (host || document.querySelector('main'))?.getBoundingClientRect(); if (r) setRect({ left: Math.round(r.left), width: Math.round(r.width) })
    }
    read(); window.addEventListener('resize', read); return () => window.removeEventListener('resize', read)
  })
  return rect
}
const Swatches = styled.div` display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; `
const Label = styled.label` display: flex; flex-direction: column; gap: 4px; font-size: 12px; `

function ColorField({ name, label, value, onChange, disabled }: any) {
  const valid = COLOR.test(value)
  return <Label>
    <Typography variant="pi" fontWeight="bold" textColor="neutral800">{label}</Typography>
    <Flex gap={2}>
      <input type="color" aria-label={label} value={valid ? value : '#000000'} disabled={disabled} onChange={e => onChange(e.target.value.toUpperCase())} style={{ width: 40, height: 32, padding: 0, border: 0, background: 'none' }} />
      <input name={name} value={value} disabled={disabled} maxLength={7} aria-invalid={!valid} onChange={e => onChange(e.target.value.trim())}
        style={{ width: 96, fontFamily: 'monospace', padding: '6px 8px', border: `1px solid ${valid ? '#dcdce4' : '#d02b20'}`, borderRadius: 4 }} />
    </Flex>
  </Label>
}

export const permissions = { read: [{ action: 'plugin::blockscene.settings.read', subject: null }], update: [{ action: 'plugin::blockscene.settings.update', subject: null }] }

export function Settings({ useClient, usePermissions, MediaPicker, ToggleField, SelectField, TextField, previewSupported = false }: any) {
  const t = useMessages()
  const { get, put } = useClient()
  const { canRead, canUpdate, isLoading } = usePermissions()
  const [data, setData] = React.useState<any>(null)
  const [catalog, setCatalog] = React.useState<any>(null)
  const [settings, setSettings] = React.useState<any>(null)
  const [media, setMedia] = React.useState<any>({})
  const [sources, setSources] = React.useState<Record<string, number>>({})
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [picking, setPicking] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!canRead || isLoading) return
    let active = true
    Promise.all([get('/blockscene/settings'), get('/blockscene/catalog')]).then(([s, c]: any) => {
      if (!active) return
      setData(s.data); setSettings(s.data.settings); setMedia(s.data.media || {}); setCatalog(c.data)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [get, canRead, isLoading])
  const update = (patch: (current: any) => any) => { setSettings((current: any) => patch(structuredClone(current))); setDirty(true); setStatus('') }
  const invalid = settings && (Object.values(settings.palette).some((value: any) => !COLOR.test(value)) ||
    (settings.editor.previewUrl && !/^https?:\/\/\S+$/.test(settings.editor.previewUrl)))
  const save = async () => {
    if (!settings || invalid || !canUpdate) return
    setSaving(true); setStatus('')
    try {
      const { data: saved } = await put('/blockscene/settings', settings)
      setSettings(saved); setDirty(false); setStatus(t.saved)
      const refreshed = await get('/blockscene/settings'); setMedia(refreshed.data.media || {})
    } catch { setStatus(t.saveFailed) }
    finally { setSaving(false) }
  }
  const editor = settings?.editor || {}
  const components = (data?.components || []).filter((c: any) => `${c.displayName} ${c.uid}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  const sourceOf = (uid: string, manual: boolean) => {
    const index = sources[uid]
    if (index === undefined) return '…'
    if (index === -1) return t.wireframe
    return index === 0 && manual ? t.manual : t.automatic
  }
  const ready = !isLoading && canRead && !failed && settings && catalog
  const header = React.useRef<HTMLDivElement>(null)
  const [floating, setFloating] = React.useState(false)
  const main = useMainRect(header)
  React.useEffect(() => {
    const el = header.current; if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setFloating(!entry.isIntersecting && entry.boundingClientRect.top < 0))
    observer.observe(el); return () => observer.disconnect()
  }, [ready])
  const controls = (suffix: string) => ready && <Flex gap={3} alignItems="center" wrap="wrap">
    <Typography role="status" aria-live="polite" textColor={dirty ? 'warning700' : 'neutral600'} data-testid={`${dirty ? 'unsaved-indicator' : 'save-status'}${suffix}`}>
      {dirty ? t.unsaved : status || t.noChanges}</Typography>
    <Button onClick={save} disabled={!canUpdate || invalid || !dirty} loading={saving} data-testid={`save-blockscene-settings${suffix}`}>{t.save}</Button>
  </Flex>
  return <Box padding={8} background="neutral100"><Flex direction="column" alignItems="stretch" gap={5}>
    <div ref={header}>
      <Flex gap={4} alignItems="center" justifyContent="space-between" wrap="wrap">
        <Typography variant="alpha" tag="h1">{t.settingsTitle}</Typography>
        {controls('')}
      </Flex>
    </div>
    {floating && main.width > 0 && <Bar style={{ left: main.left, width: main.width }} data-testid="settings-floating-bar">
      <Flex gap={4} alignItems="center" justifyContent="space-between" wrap="wrap">
        <Typography variant="beta" tag="p">{t.settingsTitle}</Typography>
        {controls('-floating')}
      </Flex>
    </Bar>}
    <Typography textColor="neutral600">{t.settingsIntro}</Typography>
    {isLoading ? <Typography>…</Typography> : !canRead ? <Typography role="alert">{t.denied}</Typography> : failed ?
      <Typography role="alert">{t.loadFailed}</Typography> : !settings || !catalog ? <Typography>{t.loading}</Typography> : <>
      {data.disabled && <Box padding={4} background="warning100" hasRadius><Typography role="alert" textColor="warning700">{t.disabledByServer}</Typography></Box>}
      <Box padding={6} background="neutral0" hasRadius><Flex direction="column" alignItems="stretch" gap={4}>
        <Typography variant="beta" tag="h2">{t.palette}</Typography>
        <Swatches>
          {Object.keys(DEFAULT_PALETTE).map(key => <ColorField key={key} name={`palette-${key}`} label={(t as any)[key]} value={settings.palette[key]} disabled={!canUpdate || saving}
            onChange={(value: string) => update(s => { s.palette[key] = value; return s })} />)}
        </Swatches>
        {invalid && <Typography role="alert" textColor="danger600">{t.invalidColor}</Typography>}
        <Typography variant="pi" textColor="neutral600">{t.previewLabel}</Typography>
        <Swatches data-testid="palette-preview">
          {TEMPLATES.map(template => <Flex key={template} direction="column" gap={1}>
            <Box style={{ aspectRatio: '16 / 9', overflow: 'hidden' }} hasRadius><Wireframe template={template} palette={settings.palette} /></Box>
            <Typography variant="pi" textColor="neutral600">{t.templates[template]}</Typography>
          </Flex>)}
        </Swatches>
        <Flex><Button variant="tertiary" size="S" disabled={!canUpdate} onClick={() => update(s => { s.palette = { ...DEFAULT_PALETTE }; return s })}>{t.resetPalette}</Button></Flex>
      </Flex></Box>
      <Box padding={6} background="neutral0" hasRadius><Flex direction="column" alignItems="stretch" gap={4}>
        <Typography variant="beta" tag="h2">{t.editor}</Typography>
        <ToggleField name="editor-enabled" label={t.enabled} value={editor.enabled} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.enabled = v; return s })} />
        <Typography variant="pi" textColor="neutral600">{t.enabledHelp}</Typography>
        <ToggleField name="editor-showOpenAll" label={t.showOpenAll} value={editor.showOpenAll} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.showOpenAll = v; return s })} />
        <ToggleField name="editor-showCloseAll" label={t.showCloseAll} value={editor.showCloseAll} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.showCloseAll = v; return s })} />
        <SelectField name="editor-initialState" label={t.initialState} value={editor.initialState} disabled={!canUpdate || saving}
          options={['closed', 'open', 'remember'].map(value => ({ value, label: t.states[value] }))} onChange={(v: string) => update(s => { s.editor.initialState = v; return s })} />
        <Typography variant="pi" textColor="neutral600">{t.rememberHelp}</Typography>
        {previewSupported ? <>
          <TextField name="editor-previewUrl" label={t.previewUrl} value={editor.previewUrl || ''} disabled={!canUpdate || saving} placeholder="https://site.test/block-preview/page"
            onChange={(v: string) => update(s => { s.editor.previewUrl = v.trim(); return s })} />
          <Typography variant="pi" textColor="neutral600">{t.previewUrlHelp}</Typography>
          <SelectField name="editor-previewMode" label={t.previewMode} value={editor.previewMode || 'form'} disabled={!canUpdate || saving}
            options={['form', 'split', 'preview'].map(value => ({ value, label: t.modes[value] }))} onChange={(v: string) => update(s => { s.editor.previewMode = v; return s })} />
          <Typography variant="pi" textColor="neutral600">{t.previewModeHelp}</Typography>
          {data.blockPreviewAvailable && <>
            <ToggleField name="editor-blockPreviewInForm" label={t.blockPreviewInForm} value={editor.blockPreviewInForm} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.blockPreviewInForm = v; return s })} />
            <Typography variant="pi" textColor="neutral600">{t.blockPreviewInFormHelp}</Typography>
          </>}
        </> : <Typography variant="pi" textColor="neutral600">{t.previewV4}</Typography>}
      </Flex></Box>
      <Box padding={6} background="neutral0" hasRadius><Flex direction="column" alignItems="stretch" gap={4}>
        <Typography variant="beta" tag="h2">{t.components}</Typography>
        <Searchbar name="component-filter" value={filter} placeholder={t.filter} clearLabel={t.clear} onClear={() => setFilter('')} onChange={(e: any) => setFilter(e.target.value)}>{t.filter}</Searchbar>
        <Typography variant="pi" textColor="neutral600" data-testid="components-count">{t.f('countAll', { count: components.length })}</Typography>
        <Grid data-testid="components-grid">{components.map((component: any) => {
          const entry = settings.components[component.uid] || {}
          const meta = { ...(catalog.components?.[component.uid] || {}), ...(media[component.uid] || {}) }
          const candidates = candidatesFor(component.uid, meta, catalog)
          return <Card key={component.uid} data-testid={`settings-${component.uid}`}>
            <Thumb candidates={candidates} template={entry.template} palette={settings.palette} noPreview={t.noPreview} eager
              onResolved={(index: number) => setSources(current => current[component.uid] === index ? current : { ...current, [component.uid]: index })} />
            <Flex direction="column" alignItems="flex-start" gap={2}>
              <Typography fontWeight="bold" textColor="neutral800">{component.displayName}</Typography>
              <Typography variant="pi" textColor="neutral600">{component.uid} · {component.category}</Typography>
              <Typography variant="pi" data-testid={`source-${component.uid}`}>{t.source}: {sourceOf(component.uid, Boolean(meta.manualImage))}{meta.manualName ? ` (${meta.manualName})` : ''}</Typography>
              {meta.manualMissing && <Typography variant="pi" role="alert" textColor="danger600">{t.brokenMedia}</Typography>}
              <Flex gap={2} wrap="wrap">
                <Button variant="secondary" size="S" disabled={!canUpdate || saving} onClick={() => setPicking(component.uid)}>{entry.mediaId ? t.replace : t.choose}</Button>
                {entry.mediaId && <Button variant="tertiary" size="S" disabled={!canUpdate || saving} onClick={() => {
                  update(s => { delete s.components[component.uid]?.mediaId; if (!Object.keys(s.components[component.uid] || {}).length) delete s.components[component.uid]; return s })
                  setMedia((m: any) => { const next = { ...m }; delete next[component.uid]; return next })
                }}>{t.useAutomatic}</Button>}
              </Flex>
              <SelectField name={`template-${component.uid}`} label={t.template} value={entry.template || 'generic'} disabled={!canUpdate || saving}
                options={TEMPLATES.map(value => ({ value, label: t.templates[value] }))}
                onChange={(v: string) => update(s => { s.components[component.uid] = { ...s.components[component.uid], template: v }; return s })} />
            </Flex>
          </Card>
        })}</Grid>
      </Flex></Box>
      {picking && <MediaPicker onClose={() => setPicking(null)} onSelect={(asset: any) => {
        const uid = picking; setPicking(null)
        if (!asset?.id) return
        update(s => { s.components[uid] = { ...s.components[uid], mediaId: asset.id }; return s })
        setMedia((m: any) => ({ ...m, [uid]: { manualImage: asset.url, manualName: asset.name } }))
      }} />}
    </>}
  </Flex></Box>
}

// `to`: Strapi 4 wants the absolute path, Strapi 5 one relative to /settings (it warns otherwise).
export function register(app: any, Component: any, to: string) {
  app.createSettingSection({ id: 'blockscene', intlLabel: { id: 'blockscene.title', defaultMessage: 'Blockscene' } },
    [{ id: 'blockscene-settings', to, intlLabel: { id: 'blockscene.settings', defaultMessage: 'Gallery' },
      // Module shape: older Strapi 4 (e.g. 4.11) only reads `.default` from the loader result.
      // Not an `async` function: Strapi 5 warns on AsyncFunction loaders.
      Component: () => Promise.resolve({ default: Component }), permissions: permissions.read }])
}
