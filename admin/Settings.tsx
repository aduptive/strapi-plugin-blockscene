import * as React from 'react'
import { Box, Button, Flex, Searchbar, Typography } from '@strapi/design-system'
import styled from 'styled-components'
import { candidatesFor, localized } from './model.mjs'
import { Thumb } from './Gallery'
import { Wireframe, TEMPLATES, DEFAULT_PALETTE } from './wireframes'
import { useMessages } from './messages'
import { Icon, Tool } from './icons'

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

// Comma separated tags; the text is kept while typing so a trailing comma or space does not vanish.
function TagsField({ name, label, hint, value, onChange, disabled }: any) {
  const [text, setText] = React.useState(value.join(', '))
  return <Label>
    <Typography variant="pi" fontWeight="bold" textColor="neutral800">{label}</Typography>
    <input name={name} value={text} disabled={disabled} onChange={e => {
      setText(e.target.value)
      onChange([...new Set(e.target.value.split(',').map(tag => tag.replace(/[<>]/g, '').trim().slice(0, 24)).filter(Boolean))].slice(0, 10))
    }} style={{ padding: '6px 8px', border: '1px solid #dcdce4', borderRadius: 4, fontSize: 13 }} />
    <Typography variant="pi" textColor="neutral600">{hint}</Typography>
  </Label>
}

// Custom field uids, comma or space separated; same rule as server/settings.js (lazyFields).
const FIELD_UID = /^(plugin|global)::[\w.-]+$/
const LAZY_MAX = 20
const parseUids = (text: string) => [...new Set(text.split(/[\s,]+/).filter(Boolean))]
const badUids = (uids: string[] = []) => uids.length > LAZY_MAX || uids.some(uid => !FIELD_UID.test(uid))
function UidListField({ TextField, value, onChange, ...props }: any) {
  const [text, setText] = React.useState(value.join(', '))
  // Save or restore replaced the list: show it, unless it is what is being typed.
  React.useEffect(() => { if (parseUids(text).join() !== value.join()) setText(value.join(', ')) }, [value.join()])
  return <TextField {...props} value={text} onChange={(v: string) => { setText(v); onChange(parseUids(v)) }} />
}

// Visual editor sidebar, same rules as server/settings.js (ICONS, sidebarItem, 12 items).
const SIDEBAR_ICONS = ['text', 'tag', 'seo', 'settings', 'image', 'link', 'palette', 'list', 'globe', 'info']
const SIDEBAR_MAX = 12
const ITEM_LABEL = /^[^<>]{1,40}$/
const badItem = (item: any) => !ITEM_LABEL.test(String(item.label || '').trim()) || !item.fields?.length
// Timestamps, authors and i18n bookkeeping have no editable input in the form.
const SYSTEM_FIELDS = ['createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'locale', 'localizations']
const Item = styled.div`
  display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200}; background: ${({ theme }) => theme.colors.neutral100};
`
const Checks = styled.fieldset`
  display: flex; flex-wrap: wrap; gap: 4px 16px; border: 0; padding: 0; margin: 0; font-size: 13px; color: ${({ theme }) => theme.colors.neutral800};
  legend { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  label { display: inline-flex; align-items: center; gap: 6px; }
`

// Page preview toolbar and widths, same rules as server/settings.js (previewToolbar, previewDevices).
const TOOLBAR = ['modes', 'history', 'devices', 'status', 'actions']
const DEVICE_NAMES = ['fit', 'mobile', 'tablet', 'desktop']
const DEVICE_LABEL = /^[^<>]{1,24}$/
const badDevices = (list: any[] = []) => list.length < 1 || list.length > 8 ||
  list.some(item => typeof item !== 'string' && (!DEVICE_LABEL.test(String(item.label || '').trim()) || !(Number.isInteger(item.width) && item.width >= 240 && item.width <= 3840))) ||
  new Set(list.map(item => typeof item === 'string' ? item : item.width)).size !== list.length
const Row = styled.div` display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13px; color: ${({ theme }) => theme.colors.neutral800}; `
// Ordered checklists: checked entries first, in their order (up/down), the unchecked ones after them.
function PaneEditor({ id, toolbar, devices, set, t, disabled, TextField }: any) {
  const move = (list: any[], index: number, by: number) => { const next = [...list]; [next[index], next[index + by]] = [next[index + by], next[index]]; return next }
  const arrows = (list: any[], index: number, key: string) => <>
    <Tool icon="up" label={t.moveUp} disabled={disabled || index < 0 || index === 0} onClick={() => set(key, move(list, index, -1))} />
    <Tool icon="down" label={t.moveDown} disabled={disabled || index < 0 || index === list.length - 1} onClick={() => set(key, move(list, index, 1))} />
  </>
  const check = (list: any[], item: string, key: string) => <input type="checkbox" name={`${id}-${key}-${item}`} checked={list.includes(item)} disabled={disabled}
    onChange={e => set(key, e.target.checked ? [...list, item] : list.filter(entry => entry !== item))} />
  const width = (index: number, patch: any) => set('previewDevices', devices.map((item: any, i: number) => i === index ? { ...item, ...patch } : item))
  return <Flex direction="column" alignItems="stretch" gap={3} data-testid={`pane-editor-${id}`}>
    <Typography variant="pi" textColor="neutral600">{t.paneHelp}</Typography>
    <Box>{[...toolbar, ...TOOLBAR.filter(item => !toolbar.includes(item))].map(item => <Row key={item} data-testid={`${id}-toolbar-${item}`}>
      {arrows(toolbar, toolbar.indexOf(item), 'previewToolbar')}<label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{check(toolbar, item, 'previewToolbar')}{t.toolbar[item]}</label>
    </Row>)}</Box>
    <Typography variant="delta" tag="h3">{t.paneDevices}</Typography>
    <Typography variant="pi" textColor="neutral600">{t.paneDevicesHelp}</Typography>
    <Box>{[...devices, ...DEVICE_NAMES.filter(item => !devices.includes(item))].map((item: any) => {
      const index = devices.indexOf(item)
      return <Row key={typeof item === 'string' ? item : `px-${index}`} data-testid={`${id}-device-${typeof item === 'string' ? item : index}`}>
        {arrows(devices, index, 'previewDevices')}
        {typeof item === 'string' ? <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{check(devices, item, 'previewDevices')}{t.device[item]}</label> : <>
          <Box style={{ flex: '1 1 160px' }}><TextField name={`${id}-device-label-${index}`} label={t.paneWidthLabel} value={item.label} disabled={disabled} onChange={(v: string) => width(index, { label: v })} /></Box>
          <Box style={{ width: 140 }}><TextField name={`${id}-device-width-${index}`} label={t.paneWidth} value={Number.isFinite(item.width) ? String(item.width) : ''} disabled={disabled}
            onChange={(v: string) => width(index, { width: /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN })} /></Box>
          <Tool icon="close" label={t.paneRemoveWidth} disabled={disabled} onClick={() => set('previewDevices', devices.filter((_: any, i: number) => i !== index))} />
        </>}
      </Row>
    })}</Box>
    <Flex><Button variant="secondary" size="S" disabled={disabled || devices.length >= 8} data-testid={`${id}-add-width`}
      onClick={() => set('previewDevices', [...devices, { label: '', width: 1280 }])}>{t.paneAddWidth}</Button></Flex>
    {badDevices(devices) && <Typography role="alert" variant="pi" textColor="danger600">{t.paneInvalid}</Typography>}
  </Flex>
}

// Version history (Strapi 5), same rules as server/settings.js (HISTORY_KEYS).
const DAYS = (n: any) => Number.isInteger(n) && n >= 1 && n <= 3650
const badRetention = (h: any) => !h || !DAYS(h.retentionDays) || !DAYS(h.eventDays) || !DAYS(h.trashDays) || h.eventDays < h.retentionDays || !(Number.isInteger(h.maxSnapshots) && h.maxSnapshots >= 1 && h.maxSnapshots <= 1000)
function HistorySettings({ types, history, set, t, disabled, ToggleField, TextField }: any) {
  const all = history.contentTypes === 'all'
  const list: string[] = all ? [] : history.contentTypes
  const number = (key: string) => <Box style={{ minWidth: 200 }}><TextField name={`history-${key}`} label={t[{ retentionDays: 'historyRetention', maxSnapshots: 'historyMax', eventDays: 'historyEventDays', trashDays: 'trashDays' }[key] as string]}
    value={Number.isFinite(history[key]) ? String(history[key]) : ''} disabled={disabled} onChange={(v: string) => set(key, /^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : NaN)} /></Box>
  return <Box padding={6} background="neutral0" hasRadius><Flex direction="column" alignItems="stretch" gap={4} data-testid="history-settings">
    <Typography variant="beta" tag="h2">{t.historySettings}</Typography>
    <Typography variant="pi" textColor="neutral600">{t.historySettingsHelp}</Typography>
    <ToggleField name="history-enabled" label={t.historyEnabled} value={history.enabled} disabled={disabled} onChange={(v: boolean) => set('enabled', v)} />
    <ToggleField name="history-all" label={t.historyAll} value={all} disabled={disabled || !history.enabled} onChange={(v: boolean) => set('contentTypes', v ? 'all' : types.map((type: any) => type.uid))} />
    {!all && <Checks disabled={disabled || !history.enabled}><legend>{t.historyTypes}</legend>
      {types.map((type: any) => <label key={type.uid}><input type="checkbox" name={`history-type-${type.uid}`} checked={list.includes(type.uid)}
        onChange={e => set('contentTypes', e.target.checked ? [...list, type.uid] : list.filter(uid => uid !== type.uid))} />{type.displayName}</label>)}
    </Checks>}
    <Flex gap={4} wrap="wrap" alignItems="flex-end">{number('retentionDays')}{number('maxSnapshots')}{number('eventDays')}{number('trashDays')}</Flex>
    <Typography variant="pi" textColor={badRetention(history) ? 'danger600' : 'neutral600'} role={badRetention(history) ? 'alert' : undefined}>{badRetention(history) ? t.historyInvalid : `${t.historyRetentionHelp} ${t.trashDaysHelp}`}</Typography>
  </Flex></Box>
}

// Only overrides are stored: no items removes the key (via `set`).
function SidebarEditor({ type, entry, set, t, disabled, SelectField, TextField }: any) {
  const items: any[] = entry.sidebar || []
  const save = (next: any[]) => set('sidebar', next.length ? next : undefined, undefined)
  const edit = (index: number, patch: any) => save(items.map((item, i) => i === index ? { ...item, ...patch } : item))
  const move = (index: number, by: number) => { const next = [...items]; [next[index], next[index + by]] = [next[index + by], next[index]]; save(next) }
  const fields = (type.attributes || []).filter((attr: any) => !SYSTEM_FIELDS.includes(attr.name))
  const id = (name: string, index?: number) => `sidebar-${name}-${type.uid}${index === undefined ? '' : `-${index}`}`
  return <Flex direction="column" alignItems="stretch" gap={3} paddingLeft={4} data-testid={`sidebar-editor-${type.uid}`}>
    <Typography variant="delta" tag="h3">{t.f('sidebarTitle', { name: type.displayName })}</Typography>
    <Typography variant="pi" textColor="neutral600">{t.sidebarHelp}</Typography>
    <Box style={{ maxWidth: 240 }}><SelectField name={id('position')} label={t.sidebarPosition} value={entry.sidebarPosition || 'left'} disabled={disabled}
      options={['left', 'right', 'bottom'].map(value => ({ value, label: t.positions[value] }))} onChange={(v: string) => set('sidebarPosition', v, 'left')} /></Box>
    {items.map((item, index) => <Item key={index} data-testid={id('item', index)}>
      <Flex gap={4} alignItems="flex-end" wrap="wrap">
        <Box style={{ flex: '1 1 200px' }}><TextField name={id('label', index)} label={t.sidebarItemLabel} value={item.label} disabled={disabled} onChange={(v: string) => edit(index, { label: v })} /></Box>
        <Box style={{ minWidth: 180 }}><SelectField name={id('icon', index)} label={t.sidebarIcon} value={item.icon || 'none'} disabled={disabled}
          options={[{ value: 'none', label: t.noIcon }, ...SIDEBAR_ICONS.map(value => ({ value, label: t.icons[value], icon: <Icon name={value} size={16} /> }))]}
          onChange={(v: string) => edit(index, { icon: v === 'none' ? undefined : v })} /></Box>
        <Box style={{ minWidth: 160 }}><SelectField name={id('open', index)} label={t.sidebarOpens} value={item.open} disabled={disabled}
          options={['drawer', 'modal'].map(value => ({ value, label: t.opens[value] }))} onChange={(v: string) => edit(index, { open: v })} /></Box>
        <Flex gap={1} paddingBottom={1}>
          <Tool icon="up" label={t.moveUp} disabled={disabled || index === 0} onClick={() => move(index, -1)} />
          <Tool icon="down" label={t.moveDown} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)} />
          <Tool icon="close" label={t.sidebarRemove} disabled={disabled} onClick={() => save(items.filter((_, i) => i !== index))} />
        </Flex>
      </Flex>
      <Checks disabled={disabled}><legend>{t.sidebarFields}</legend>
        {fields.map((attr: any) => <label key={attr.name}><input type="checkbox" name={id(`field-${attr.name}`, index)} checked={item.fields.includes(attr.name)}
          onChange={e => edit(index, { fields: e.target.checked ? [...item.fields, attr.name] : item.fields.filter((name: string) => name !== attr.name) })} />{attr.name}</label>)}
      </Checks>
      {badItem(item) && <Typography role="alert" variant="pi" textColor="danger600">{t.sidebarInvalid}</Typography>}
    </Item>)}
    <Flex gap={2} alignItems="center">
      <Button variant="secondary" size="S" disabled={disabled || items.length >= SIDEBAR_MAX} data-testid={id('add')}
        onClick={() => save([...items, { label: '', open: 'drawer', fields: [] }])}>{t.sidebarAdd}</Button>
      {items.length >= SIDEBAR_MAX && <Typography variant="pi" textColor="neutral600">{t.f('sidebarLimit', { max: SIDEBAR_MAX })}</Typography>}
    </Flex>
  </Flex>
}

export const permissions = { read: [{ action: 'plugin::blockscene.settings.read', subject: null }], update: [{ action: 'plugin::blockscene.settings.update', subject: null }] }

// `lazyEditors`: the distribution has lazy rich-text editors (Strapi 5); their options show only there.
export function Settings({ useClient, usePermissions, MediaPicker, ToggleField, SelectField, TextField, lazyEditors = false }: any) {
  const t = useMessages()
  const { get, put, del } = useClient()
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
  const badColor = settings && (Object.values(settings.palette).some((value: any) => !COLOR.test(value)) ||
    [settings.editor.previewUrl, settings.editor.blockPreviewUrl].some((url: string) => url && !/^https?:\/\/\S+$/.test(url)))
  const badSidebar = settings && Object.values(settings.contentTypes || {}).some((entry: any) => (entry.sidebar || []).some(badItem))
  const badLazy = settings && badUids(settings.editor.lazyFields)
  const badHistory = settings && data?.historyTypes && badRetention(settings.history)
  const badPane = settings && [settings.editor, ...Object.values(settings.contentTypes || {})].some((entry: any) => entry.previewDevices && badDevices(entry.previewDevices))
  const invalid = badColor || badSidebar || badLazy || badHistory || badPane
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
  // Removes the saved document: back to the project defaults (plugin config `settings`) or the built-in ones.
  const restore = async () => {
    if (!canUpdate || !window.confirm(data.projectDefaults ? t.restoreProjectConfirm : t.resetAllConfirm)) return
    setSaving(true); setStatus('')
    try {
      const { data: fresh } = await del('/blockscene/settings')
      setSettings(fresh); setDirty(false); setStatus(t.restored)
      const refreshed = await get('/blockscene/settings'); setMedia(refreshed.data.media || {})
    } catch { setStatus(t.saveFailed) }
    finally { setSaving(false) }
  }
  // Only overrides are stored: undefined removes the key, and an empty entry disappears.
  const setComponent = (uid: string, key: string, value: unknown) => update(s => {
    const next = { ...s.components[uid] }
    if (value === undefined) delete next[key]; else next[key] = value
    if (Object.keys(next).length) s.components[uid] = next; else delete s.components[uid]
    return s
  })
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
    {!suffix && <Button variant="tertiary" onClick={restore} disabled={!canUpdate || saving} data-testid="restore-blockscene-settings">
      {data.projectDefaults ? t.restoreProject : t.resetAll}</Button>}
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
        {badColor && <Typography role="alert" textColor="danger600">{t.invalidColor}</Typography>}
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
        <Typography variant="pi" textColor="neutral600">{t.toggleHelp}</Typography>
        <ToggleField name="editor-showRowThumbnails" label={t.showRowThumbnails} value={editor.showRowThumbnails !== false} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.showRowThumbnails = v; return s })} />
        <ToggleField name="editor-friendlyLabels" label={t.friendlyLabels} value={editor.friendlyLabels !== false} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.friendlyLabels = v; return s })} />
        <Typography variant="pi" textColor="neutral600">{t.friendlyLabelsHelp}</Typography>
        <SelectField name="editor-initialState" label={t.initialState} value={editor.initialState} disabled={!canUpdate || saving}
          options={['closed', 'open', 'remember'].map(value => ({ value, label: t.states[value] }))} onChange={(v: string) => update(s => { s.editor.initialState = v; return s })} />
        <Typography variant="pi" textColor="neutral600">{t.rememberHelp}</Typography>
        <TextField name="editor-blockPreviewUrl" label={t.blockPreviewUrl} value={editor.blockPreviewUrl || ''} disabled={!canUpdate || saving}
          placeholder="http://localhost:3000/block-preview/{name}/{variant}" onChange={(v: string) => update(s => { s.editor.blockPreviewUrl = v.trim(); return s })} />
        <Typography variant="pi" textColor="neutral600">{t.blockPreviewUrlHelp}</Typography>
        <TextField name="editor-previewUrl" label={t.previewUrl} value={editor.previewUrl || ''} disabled={!canUpdate || saving} placeholder="https://site.test/block-preview/page"
            onChange={(v: string) => update(s => { s.editor.previewUrl = v.trim(); return s })} />
          <Typography variant="pi" textColor="neutral600">{t.previewUrlHelp}</Typography>
          {/* Editors get no hint in the edit view: the missing route is explained here, where it can be set. */}
          {!editor.previewUrl && <Typography variant="pi" textColor="warning700" data-testid="preview-url-empty">{t.previewUrlEmpty}</Typography>}
          <SelectField name="editor-previewMode" label={t.previewMode} value={editor.previewMode || 'form'} disabled={!canUpdate || saving}
            options={['form', 'split', 'preview'].map(value => ({ value, label: t.modes[value] }))} onChange={(v: string) => update(s => { s.editor.previewMode = v; return s })} />
          <Typography variant="pi" textColor="neutral600">{t.previewModeHelp}</Typography>
          <Typography variant="delta" tag="h3">{t.paneTitle}</Typography>
          <PaneEditor id="editor" toolbar={editor.previewToolbar || TOOLBAR} devices={editor.previewDevices || DEVICE_NAMES} t={t} disabled={!canUpdate || saving} TextField={TextField}
            set={(key: string, value: unknown) => update(s => { s.editor[key] = value; return s })} />
          {lazyEditors && <>
          <ToggleField name="editor-lazyEditors" label={t.lazyEditors} value={editor.lazyEditors !== false} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.lazyEditors = v; return s })} />
          <UidListField TextField={TextField} name="editor-lazyFields" label={t.lazyFields} value={editor.lazyFields || []} disabled={!canUpdate || saving || editor.lazyEditors === false}
            placeholder="plugin::ckeditor5.CKEditor" onChange={(uids: string[]) => update(s => { s.editor.lazyFields = uids; return s })} />
          <Typography variant="pi" textColor={badLazy ? 'danger600' : 'neutral600'} role={badLazy ? 'alert' : undefined}>{badLazy ? t.f('lazyFieldsInvalid', { max: LAZY_MAX }) : t.lazyEditorsHelp}</Typography>
          {data.blockPreviewAvailable && <>
            <ToggleField name="editor-blockPreviewInForm" label={t.blockPreviewInForm} value={editor.blockPreviewInForm} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.blockPreviewInForm = v; return s })} />
            <Typography variant="pi" textColor="neutral600">{t.blockPreviewInFormHelp}</Typography>
          </>}
          </>}
      </Flex></Box>
      <Box padding={6} background="neutral0" hasRadius><Flex direction="column" alignItems="stretch" gap={4} data-testid="row-actions-settings">
        <Typography variant="beta" tag="h2">{t.rowActionsTitle}</Typography>
        <ToggleField name="editor-confirmDelete" label={t.confirmDeleteOption} value={editor.confirmDelete !== false} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.confirmDelete = v; return s })} />
        <ToggleField name="editor-duplicate" label={t.duplicateOption} value={editor.duplicate !== false} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.duplicate = v; return s })} />
        <ToggleField name="editor-clipboard" label={t.clipboardOption} value={editor.clipboard !== false} disabled={!canUpdate || saving} onChange={(v: boolean) => update(s => { s.editor.clipboard = v; return s })} />
        <SelectField name="editor-hiddenBlocks" label={t.hiddenBlocks} value={editor.hiddenBlocks || 'strip'} disabled={!canUpdate || saving || !data.hiddenAttribute}
          options={['strip', 'flag', 'off'].map(value => ({ value, label: t.hiddenModes[value] }))} onChange={(v: string) => update(s => { s.editor.hiddenBlocks = v; return s })} />
        <Typography variant="pi" textColor="neutral600">{data.hiddenAttribute ? t.hiddenBlocksHelp : t.hiddenAttributeOff}</Typography>
      </Flex></Box>
      {data.historyTypes && settings.history && <HistorySettings types={data.historyTypes} history={settings.history} t={t} disabled={!canUpdate || saving} ToggleField={ToggleField} TextField={TextField}
        set={(key: string, value: unknown) => update(s => { s.history = { ...s.history, [key]: value }; return s })} />}
      {(data.contentTypes || []).length > 0 && <Box padding={6} background="neutral0" hasRadius><Flex direction="column" alignItems="stretch" gap={4} data-testid="content-types">
        <Typography variant="beta" tag="h2">{t.contentTypes}</Typography>
        <Typography variant="pi" textColor="neutral600">{t.contentTypesHelp}</Typography>
        {data.contentTypes.map((type: any) => {
          const entry = settings.contentTypes?.[type.uid] || {}
          // Only overrides are stored: back to the default removes the key.
          const set = (key: string, value: unknown, fallback: unknown) => update(s => {
            const next = { ...(s.contentTypes?.[type.uid] || {}) }
            if (value === fallback) delete next[key]; else next[key] = value
            s.contentTypes = { ...(s.contentTypes || {}) }
            if (Object.keys(next).length) s.contentTypes[type.uid] = next; else delete s.contentTypes[type.uid]
            return s
          })
          return <Flex key={type.uid} direction="column" alignItems="stretch" gap={4}>
          <Flex gap={6} alignItems="flex-end" wrap="wrap" data-testid={`content-type-${type.uid}`}>
            <Box style={{ minWidth: 220 }}><ToggleField name={`type-enabled-${type.uid}`} label={type.displayName} value={entry.enabled !== false} disabled={!canUpdate || saving}
              onChange={(v: boolean) => set('enabled', v, true)} /></Box>
            <Box style={{ minWidth: 240 }}><SelectField name={`type-mode-${type.uid}`} label={t.typeMode} value={entry.previewMode || 'default'} disabled={!canUpdate || saving || entry.enabled === false}
              options={[{ value: 'default', label: t.f('modeDefault', { mode: t.modes[editor.previewMode || 'form'] }) }, ...['form', 'split', 'preview'].map(value => ({ value, label: t.modes[value] }))]}
              onChange={(v: string) => set('previewMode', v, 'default')} /></Box>
          </Flex>
          {entry.enabled !== false && <SidebarEditor type={type} entry={entry} set={set} t={t} disabled={!canUpdate || saving} SelectField={SelectField} TextField={TextField} />}
          {/* Own toolbar: starts as a copy of the global one; off removes both keys (the global ones apply again). */}
          {entry.enabled !== false && <Flex direction="column" alignItems="stretch" gap={3} paddingLeft={4}>
            <ToggleField name={`type-pane-${type.uid}`} label={t.f('paneTypeOverride', { name: type.displayName })} value={Boolean(entry.previewToolbar || entry.previewDevices)} disabled={!canUpdate || saving}
              onChange={(v: boolean) => { set('previewToolbar', v ? [...(editor.previewToolbar || TOOLBAR)] : undefined, undefined); set('previewDevices', v ? structuredClone(editor.previewDevices || DEVICE_NAMES) : undefined, undefined) }} />
            {(entry.previewToolbar || entry.previewDevices) && <PaneEditor id={`type-${type.uid}`} toolbar={entry.previewToolbar || editor.previewToolbar || TOOLBAR} devices={entry.previewDevices || editor.previewDevices || DEVICE_NAMES}
              t={t} disabled={!canUpdate || saving} TextField={TextField} set={(key: string, value: unknown) => set(key, value, undefined)} />}
          </Flex>}
          </Flex>
        })}
        {badSidebar && <Typography role="alert" textColor="danger600">{t.sidebarInvalidSave}</Typography>}
      </Flex></Box>}
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
              <SelectField name={`typology-${component.uid}`} label={t.typology} value={entry.typology || 'auto'} disabled={!canUpdate || saving}
                options={[{ value: 'auto', label: t.f('typologyAuto', { name: t.typologies[component.typology] || component.typology }) }, ...(data.typologies || []).map((value: string) => ({ value, label: t.typologies[value] }))]}
                onChange={(v: string) => setComponent(component.uid, 'typology', v === 'auto' ? undefined : v)} />
              <TagsField name={`tags-${component.uid}`} label={t.tags} hint={t.tagsHelp} value={entry.tags || []} disabled={!canUpdate || saving}
                onChange={(tags: string[]) => setComponent(component.uid, 'tags', tags.length ? tags : undefined)} />
              {meta.variants?.length > 0 && <Typography variant="pi" textColor="neutral600" data-testid={`variants-${component.uid}`}>
                {t.variantsFromCode}: {meta.variants.map((item: any) => localized(item.label, t.locale) || item.id).join(', ')}</Typography>}
              {catalog.groups?.[component.uid] && <LayoutFields component={component} layout={entry.layout} t={t} disabled={!canUpdate || saving} SelectField={SelectField}
                set={(layout: any) => setComponent(component.uid, 'layout', layout)} />}
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

// Layout grid of a group OPEN (README "Layout grid"): the attribute with its desktop column count (none: no grid), an
// optional mobile one and a cap. Only attributes that can hold a count are offered (the server's layoutFields).
function LayoutFields({ component, layout, set, t, disabled, SelectField }: any) {
  const fields = (component.layoutFields || []).map((name: string) => ({ value: name, label: name }))
  const change = (key: string, value: any) => set(key === 'columnsField' && value === 'none' ? undefined
    : Object.fromEntries(Object.entries({ ...layout, [key]: value }).filter(([, v]) => v !== 'none' && v !== undefined)))
  return <Flex direction="column" alignItems="stretch" gap={2} data-testid={`layout-${component.uid}`} style={{ width: '100%' }}>
    <SelectField name={`layout-columns-${component.uid}`} label={t.layoutColumnsField} value={layout?.columnsField || 'none'} disabled={disabled || !fields.length}
      options={[{ value: 'none', label: t.layoutOff }, ...fields]} onChange={(v: string) => change('columnsField', v)} />
    {layout?.columnsField && <>
      <SelectField name={`layout-mobile-${component.uid}`} label={t.layoutMobileField} value={layout.mobileColumnsField || 'none'} disabled={disabled}
        options={[{ value: 'none', label: t.layoutNoMobile }, ...fields]} onChange={(v: string) => change('mobileColumnsField', v)} />
      <SelectField name={`layout-max-${component.uid}`} label={t.layoutMaxColumns} value={String(layout.maxColumns || 'none')} disabled={disabled}
        options={[{ value: 'none', label: '12' }, ...Array.from({ length: 11 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]}
        onChange={(v: string) => change('maxColumns', v === 'none' ? undefined : Number(v))} />
    </>}
    <Typography variant="pi" textColor="neutral600">{fields.length ? t.layoutHelp : t.layoutNoFields}</Typography>
  </Flex>
}

// `to`: Strapi 4 wants the absolute path, Strapi 5 one relative to /settings (it warns otherwise).
export function register(app: any, Component: any, to: string) {
  app.createSettingSection({ id: 'blockscene', intlLabel: { id: 'blockscene.title', defaultMessage: 'Blockscene' } },
    [{ id: 'blockscene-settings', to, intlLabel: { id: 'blockscene.settings', defaultMessage: 'Gallery' },
      // Module shape: older Strapi 4 (e.g. 4.11) only reads `.default` from the loader result.
      // Not an `async` function: Strapi 5 warns on AsyncFunction loaders.
      Component: () => Promise.resolve({ default: Component }), permissions: permissions.read }])
}
