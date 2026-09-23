import * as React from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { Box, Button, Flex, Searchbar, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system'
import styled from 'styled-components'
import { entriesFor, categoriesFor, groupEntries, memoryKey, readMemory, writeMemory, initialState } from './model.mjs'
import { findZoneList, setAll, toggles, isNativeAddButton } from './accordions.mjs'
import { Wireframe } from './wireframes'
import { useMessages } from './messages'

// Masonry per category (CSS columns): tiles keep their thumbnail's real proportions, so a global
// alphabetical order would read as scrambled; grouping by category is the useful axis.
const Columns = styled.div<{ $columns: number }>`
  column-count: ${({ $columns }) => $columns}; column-gap: 12px;
  > * { break-inside: avoid; -webkit-column-break-inside: avoid; margin-bottom: 12px; }
`
const Tile = styled.button`
  display: flex; flex-direction: column; gap: 8px; text-align: left; width: 100%;
  padding: 8px; border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px; background: ${({ theme }) => theme.colors.neutral0}; cursor: pointer;
  &:hover { border-color: ${({ theme }) => theme.colors.primary600}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 2px; }
`
const Clamp = styled(Typography)` display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; `
// Native range input restyled with theme tokens: the design system has no slider.
const Slider = styled.input<{ $percent: number }>`
  appearance: none; -webkit-appearance: none; width: 8rem; height: 0.4rem; border-radius: 0.4rem; cursor: pointer;
  background: ${({ theme, $percent }) => `linear-gradient(to right, ${theme.colors.primary600} ${$percent}%, ${theme.colors.neutral200} ${$percent}%)`};
  &::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 1.6rem; height: 1.6rem; border-radius: 50%; background: ${({ theme }) => theme.colors.neutral0}; border: 0.2rem solid ${({ theme }) => theme.colors.primary600}; cursor: pointer; }
  &::-moz-range-thumb { width: 1.6rem; height: 1.6rem; border-radius: 50%; background: ${({ theme }) => theme.colors.neutral0}; border: 0.2rem solid ${({ theme }) => theme.colors.primary600}; cursor: pointer; }
  &:focus-visible { outline: 0.2rem solid ${({ theme }) => theme.colors.primary600}; outline-offset: 0.2rem; }
`
const COLUMNS = { key: 'blockscene:columns', min: 1, max: 5, initial: 3 }
const SHOW_FIELDS_KEY = 'blockscene:show-fields'
const readColumns = () => { try { const n = Number(window.localStorage.getItem(COLUMNS.key)); return n >= COLUMNS.min && n <= COLUMNS.max ? n : COLUMNS.initial } catch { return COLUMNS.initial } }
const readShowFields = () => { try { return window.localStorage.getItem(SHOW_FIELDS_KEY) !== 'false' } catch { return true } }
const remember = (key: string, value: string) => { try { window.localStorage.setItem(key, value) } catch { /* blocked storage keeps the session value */ } }
const Frame = styled.div<{ $fixed?: boolean }>`
  width: 100%; overflow: hidden; border-radius: 4px; line-height: 0;
  aspect-ratio: ${({ $fixed }) => ($fixed ? '16 / 9' : 'auto')};
  background: ${({ theme }) => theme.colors.neutral100};
  img { width: 100%; height: auto; display: block; }
`
// Tries each candidate URL in order; a failure advances without looping and the
// list restarts whenever the candidates change (so a fixed image recovers).
export function Thumb({ candidates, template, palette, onResolved, noPreview, eager }: any) {
  const key = candidates.join('|')
  const [state, setState] = React.useState({ key, index: 0 })
  const index = state.key === key ? state.index : 0
  const resolved = React.useRef<string>('')
  const report = (value: number) => { const tag = `${key}:${value}`; if (resolved.current !== tag) { resolved.current = tag; onResolved?.(value) } }
  React.useEffect(() => { if (index >= candidates.length) report(-1) })
  if (index >= candidates.length) return <Frame $fixed data-thumb="wireframe"><Wireframe template={template} palette={palette} noPreview={noPreview} /></Frame>
  return <Frame data-thumb={String(index)}><img key={candidates[index]} src={candidates[index]} alt="" loading={eager ? "eager" : "lazy"}
    onLoad={() => report(index)} onError={() => setState({ key, index: index + 1 })} /></Frame>
}

function Card({ entry, palette, showFields, onSelect }: any) {
  const t = useMessages()
  return <Tile type="button" onClick={onSelect} title={entry.uid} data-testid={`blockscene-${entry.uid}`}>
    <Thumb candidates={entry.candidates} template={entry.template} palette={palette} noPreview={t.noPreview} />
    <Typography variant="pi" fontWeight="bold" textColor="neutral800" ellipsis>{entry.label}</Typography>
    {entry.description && <Clamp variant="pi" textColor="neutral600">{entry.description}</Clamp>}
    {showFields && entry.fields.length > 0 && <Typography variant="pi" textColor="neutral500" style={{ fontStyle: 'italic' }} data-testid="block-fields">
      {entry.fields.map((f: any) => `${f.name} (${f.type})`).join(', ')}</Typography>}
  </Tile>
}

// The same picker, controlled by a parent (used by the page preview's insertion gaps).
export function PickerModal({ zone, components, open, onOpenChange, onSelect, Modal, Toggle, get }: any) {
  return <ZoneGallery zone={zone} components={components} Modal={Modal} Toggle={Toggle} get={get} controlled={{ open, onOpenChange, onSelect }} />
}

function ZoneGallery({ zone, components, add, Modal, Toggle, get, controlled }: any) {
  const t = useMessages()
  const [ownOpen, setOwnOpen] = React.useState(false)
  const open = controlled ? controlled.open : ownOpen
  const setOpen = controlled ? controlled.onOpenChange : setOwnOpen
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [showFields, setShowFields] = React.useState(readShowFields)
  const [columns, setColumns] = React.useState(readColumns)
  const [config, setConfig] = React.useState<any>(null)
  const [error, setError] = React.useState('')
  // The native "Add a component to <zone>" button of an editable zone opens this gallery instead of Strapi's
  // category picker (capture phase, so the native handler never runs). Zones without the gallery keep the native picker.
  React.useEffect(() => {
    if (controlled) return
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest?.('button')
      if (!button || !isNativeAddButton(button, zone)) return
      event.preventDefault(); event.stopPropagation()
      setOwnOpen(true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [controlled, zone.name, zone.label])
  React.useEffect(() => {
    if (!open) return
    let active = true
    setError(''); setConfig(null)
    get('/blockscene/catalog').then(({ data }: any) => { if (active) setConfig(data) })
      .catch(() => { if (active) setError(t.failed) })
    return () => { active = false }
  }, [open, get, t.failed])
  const entries = config ? entriesFor(zone, components, config, query, category) : []
  const categories = config ? categoriesFor(zone, components, config) : []
  const total = categories.reduce((sum: number, [, count]: any) => sum + count, 0)
  const filtering = query.trim() !== '' || category !== 'all'
  const reset = () => { setQuery(''); setCategory('all') }
  const select = (uid: string) => {
    try { if (controlled ? (controlled.onSelect(uid), true) : add(zone, uid)) { setOpen(false); setQuery('') } }
    catch { setError(t.insertFailed) }
  }
  const changeColumns = (value: number) => { setColumns(value); remember(COLUMNS.key, String(value)) }
  const changeShowFields = (value: boolean) => { setShowFields(value); remember(SHOW_FIELDS_KEY, String(value)) }
  return <Modal open={open} onOpenChange={setOpen} title={t.gallery}
    trigger={controlled ? null : <Button variant="secondary" fullWidth onClick={() => setOpen(true)} data-testid={`open-gallery-${zone.name}`}>{t.add}: {zone.name}</Button>}>
    <Flex direction="column" alignItems="stretch" gap={3}>
      {/* One compact row: count · search (grows) · category · fields · columns. Only the list below scrolls. */}
      <Flex gap={3} alignItems="center" wrap="wrap">
        <Typography variant="omega" fontWeight="bold" textColor="neutral800" style={{ whiteSpace: 'nowrap' }} data-testid={`block-count-${zone.name}`} aria-live="polite">
          {filtering ? t.f('countFiltered', { shown: entries.length, total }) : t.f('countAll', { count: total })}</Typography>
        <Box style={{ flex: 1, minWidth: '12rem' }}>
          <Searchbar name={`block-search-${zone.name}`} value={query} placeholder={t.search} clearLabel={t.clear}
            onClear={() => setQuery('')} onChange={(e: any) => setQuery(e.target.value)}>{t.search}</Searchbar>
        </Box>
        {categories.length > 1 && <Box style={{ width: '14rem' }} data-testid={`block-category-${zone.name}`}>
          <SingleSelect aria-label={t.filterCategory} size="S" value={category} onChange={(value: any) => setCategory(String(value))}>
            <SingleSelectOption value="all">{t.allCategories}</SingleSelectOption>
            {categories.map(([name, count]: any) => <SingleSelectOption key={name} value={name}>{`${name} (${count})`}</SingleSelectOption>)}
          </SingleSelect>
        </Box>}
        {Toggle && <Toggle name={`block-fields-${zone.name}`} label={t.showFields} hint={t.showFieldsHint} value={showFields} onChange={changeShowFields} />}
        <Flex gap={2} alignItems="center">
          <Typography variant="pi" textColor="neutral600" id={`block-columns-${zone.name}`}>{t.columns}</Typography>
          <Slider type="range" min={COLUMNS.min} max={COLUMNS.max} step={1} value={columns} aria-labelledby={`block-columns-${zone.name}`}
            $percent={((columns - COLUMNS.min) / (COLUMNS.max - COLUMNS.min)) * 100} onChange={(e: any) => changeColumns(Number(e.target.value))} />
          <Typography variant="pi" fontWeight="bold">{columns}</Typography>
        </Flex>
      </Flex>
      <Typography variant="pi" textColor="neutral600">{t.example}</Typography>
      {error ? <Typography role="alert" textColor="danger600">{error}</Typography> : !config ?
        <Typography>{t.loading}</Typography> : entries.length ? <Flex direction="column" alignItems="stretch" gap={4} style={{ overflowY: 'auto', maxHeight: '60vh', padding: '4px' }}>
          {groupEntries(entries).map(({ category: name, entries: items }: any) => <Flex key={name} direction="column" alignItems="stretch" gap={2}>
            <Typography variant="sigma" textColor="neutral600" data-testid={`block-group-${name}`}>{`${name} (${items.length})`}</Typography>
            <Columns $columns={columns}>
              {items.map((entry: any) => <div key={entry.uid}><Card entry={entry} palette={config.palette} showFields={showFields} onSelect={() => select(entry.uid)} /></div>)}
            </Columns>
          </Flex>)}
        </Flex> : <Flex gap={3} alignItems="center"><Typography>{t.empty}</Typography>{filtering && <Button variant="tertiary" size="S" onClick={reset}>{t.clear}</Button>}</Flex>}
    </Flex>
  </Modal>
}

const storage = () => { try { return window.localStorage } catch { return null } }
const memoryBase = () => `${window.location.origin}${window.location.pathname.split('/content-manager')[0]}`

// Applies the initial accordion state once per document/locale, after the native
// list has rendered every block. Later renders, edits and inserts are untouched.
function useInitialAccordions({ zones, editor, docKey, contentType, userId }: any) {
  const applied = React.useRef<string>('')
  // Refs: zones is a fresh array every render and the user id loads late on
  // Strapi 5; neither may restart (and cancel) the pending application.
  const user = React.useRef(userId); user.current = userId
  const latest = React.useRef(zones); latest.current = zones
  React.useEffect(() => {
    if (!editor?.enabled || !docKey || applied.current === docKey) return
    // Saving a new entry changes its key; that is the same document, not a new visit.
    if (applied.current.startsWith(`${contentType}:new`) && docKey.startsWith(`${contentType}:`)) { applied.current = docKey; return }
    applied.current = docKey
    let tries = 0
    // An explicit click on a header or a collective button before the initial
    // application wins: the pending application is dropped, never undoing the user.
    const cancel = (event: Event) => {
      if ((event.target as Element)?.closest?.('button[aria-expanded], [data-testid^="block-accordion-controls-"]')) stop()
    }
    const stop = () => { clearInterval(timer); document.removeEventListener('click', cancel, true) }
    document.addEventListener('click', cancel, true)
    const timer = setInterval(() => {
      const pending = latest.current.filter((zone: any) => zone.count > 0)
      // In remember mode the user id may load after the blocks (Strapi 5 auth store).
      const ready = pending.length > 0 && pending.every((zone: any) => { const list = findZoneList(zone.label); return list && toggles(list).length >= zone.count }) &&
        (editor.initialState !== 'remember' || user.current)
      if (!ready && ++tries < 25) return
      stop()
      for (const zone of pending) {
        const list = findZoneList(zone.label)
        if (!list) continue
        const key = memoryKey({ base: memoryBase(), userId: user.current, contentType, zone: zone.name })
        setAll(list, initialState(editor, readMemory(storage(), key)) === 'open', unstable_batchedUpdates)
      }
    }, 200)
    return stop
  }, [docKey, editor?.enabled, editor?.initialState, contentType])
}

function ZoneControls({ zone, editor, contentType, userId }: any) {
  const t = useMessages()
  if (!zone.count || !(editor.showOpenAll || editor.showCloseAll)) return null
  const apply = (open: boolean) => {
    const list = findZoneList(zone.label)
    if (list) setAll(list, open, unstable_batchedUpdates)
    writeMemory(storage(), memoryKey({ base: memoryBase(), userId, contentType, zone: zone.name }), open ? 'open' : 'closed')
  }
  return <Flex gap={2} wrap="wrap" data-testid={`block-accordion-controls-${zone.name}`}>
    {editor.showOpenAll && <Button type="button" variant="tertiary" size="S" onClick={() => apply(true)}>{t.openAll}</Button>}
    {editor.showCloseAll && <Button type="button" variant="tertiary" size="S" onClick={() => apply(false)}>{t.closeAll}</Button>}
  </Flex>
}

export function Gallery({ zones, editor, docKey, contentType, userId, ...props }: any) {
  useInitialAccordions({ zones, editor, docKey, contentType, userId })
  return <Flex direction="column" alignItems="stretch" gap={3}>
    {zones.map((zone: any) => <Flex key={zone.name} direction="column" alignItems="stretch" gap={2}>
      {!zone.full && <ZoneGallery zone={zone} {...props} />}
      <ZoneControls zone={zone} editor={editor} contentType={contentType} userId={userId} />
    </Flex>)}
  </Flex>
}
