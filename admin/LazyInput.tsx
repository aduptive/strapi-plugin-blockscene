import * as React from 'react'
import { Field, Flex, Typography } from '@strapi/design-system'
import styled from 'styled-components'
import { sanitizeHtml } from './sanitize.mjs'
import { useMessages } from './messages'

// Lazy rich-text editors (Strapi 5). Opening a block with several CKEditor fields costs about 100 ms per editor, so a
// field listed in `editor.lazyFields` first renders a read-only preview of its HTML and mounts the real Input on click,
// Enter/Space or keyboard focus. The Content Manager resolves `customField.components.Input()` at render time, and the
// registry hands out the plugin's own object, so bootstrap swaps that loader for one returning a wrapper.
// Until the catalog says otherwise (loading, failed, kill switch, type disabled) every field renders natively.
type Config = { on: boolean; fields: string[] }
let config: Config = { on: false, fields: [] }
const listeners = new Set<() => void>()
export function setLazyConfig(next: Config) {
  if (next.on === config.on && next.fields.join() === config.fields.join()) return
  config = next
  listeners.forEach((run) => run())
}
const subscribe = (run: () => void) => { listeners.add(run); return () => { listeners.delete(run) } }
const read = () => config
const lazyFor = (uid: string) => config.on && config.fields.includes(uid)

const Preview = styled.div<{ $disabled: boolean }>`
  min-height: 240px; border: 1px solid ${({ theme }) => theme.colors.neutral200}; border-radius: 4px; overflow: hidden;
  background: ${({ theme, $disabled }) => ($disabled ? theme.colors.neutral150 : theme.colors.neutral0)};
  color: ${({ theme }) => theme.colors.neutral800}; font-size: 1.4rem; line-height: 1.5;
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'text')};
  &:hover { border-color: ${({ theme, $disabled }) => ($disabled ? theme.colors.neutral200 : theme.colors.primary600)}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 2px; }
  /* Stands in for the editor toolbar, so mounting the editor barely moves the page. */
  & > [data-bar] { height: 40px; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200}; }
  & > [data-body] { padding: 8px 12px; overflow-wrap: anywhere; }
  & [data-body] img { max-width: 100%; height: auto; }
  & [data-body] :is(ul, ol) { padding-left: 2.4rem; list-style: revert; }
  & [data-body] :is(h1, h2, h3, h4, h5, h6) { font-weight: 600; margin: 0.6em 0 0.3em; }
  & [data-body] h1 { font-size: 2.4rem; } & [data-body] h2 { font-size: 2rem; } & [data-body] h3 { font-size: 1.8rem; } & [data-body] h4 { font-size: 1.6rem; }
  & [data-body] p { margin: 0.4em 0; }
  & [data-body] a { color: ${({ theme }) => theme.colors.primary600}; text-decoration: underline; }
`

function Placeholder({ name, label, hint, error, required, labelAction, placeholder, value, disabled, onActivate }: any) {
  const t = useMessages()
  const html = React.useMemo(() => (typeof value === 'string' ? sanitizeHtml(value) : value == null ? '' : null), [value])
  const activate = disabled ? undefined : (event: React.SyntheticEvent) => { event.preventDefault(); onActivate() }
  return (
    <Field.Root id={name} name={name} error={error} hint={hint} required={required}>
      <Flex direction="column" alignItems="stretch" gap={1}>
        <Field.Label action={labelAction}>{label}</Field.Label>
        {/* id = the label's `for`: a click on the label focuses (and so activates) the preview, like the editor. */}
        <Preview id={name} data-blockscene-lazy={name} $disabled={Boolean(disabled)} role={disabled ? undefined : 'button'}
          tabIndex={disabled ? undefined : 0} aria-disabled={disabled || undefined} aria-label={disabled ? undefined : `${label || name}: ${t.lazyEdit}`}
          onClick={activate} onFocus={activate}
          onKeyDown={disabled ? undefined : (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') activate?.(e) }}>
          <div data-bar><Typography variant="pi" textColor="neutral500">{disabled ? '' : t.lazyEdit}</Typography></div>
          {html === null ? <div data-body>{JSON.stringify(value)}</div>
            : html ? <div data-body dangerouslySetInnerHTML={{ __html: html }} />
            : <div data-body><Typography textColor="neutral500">{placeholder || ''}</Typography></div>}
        </Preview>
        <Field.Hint />
        <Field.Error />
      </Flex>
    </Field.Root>
  )
}

function lazyInput(uid: string, Real: any) {
  const Lazy = React.forwardRef((props: any, ref) => {
    React.useSyncExternalStore(subscribe, read)
    // Decided at mount: a field that rendered natively stays native, and an activated one stays mounted for the view.
    const [active, setActive] = React.useState(() => !lazyFor(uid))
    const box = React.useRef<HTMLDivElement>(null)
    const focus = React.useRef(false)
    React.useEffect(() => {
      if (!active || !focus.current) return
      focus.current = false
      // The editor is created asynchronously (preset, language): wait for its editable, then put the caret in it.
      let frame = 0; const started = performance.now()
      const poll = () => {
        const editable = box.current?.querySelector<HTMLElement>('.ck-editor__editable')
        if (editable?.isContentEditable) return editable.focus()
        if (performance.now() - started < 5000) frame = requestAnimationFrame(poll)
      }
      poll()
      return () => cancelAnimationFrame(frame)
    }, [active])
    // One stable wrapper (display: contents, no layout of its own) so switching never remounts the editor.
    return (
      <div ref={box} style={{ display: 'contents' }}>
        {active || !lazyFor(uid) ? <Real {...props} ref={ref} />
          : <Placeholder {...props} onActivate={() => { focus.current = true; setActive(true) }} />}
      </div>
    )
  })
  Lazy.displayName = `BlocksceneLazy(${uid})`
  return Lazy
}

// Decorate every loader because the configured list arrives after bootstrap, but leave modules outside `lazyFields`
// untouched. Besides avoiding needless wrappers, this keeps third-party custom fields in their own React runtime.
export function wrapCustomFields(app: any) {
  const all = app?.customFields?.getAll?.() || {}
  for (const [uid, field] of Object.entries<any>(all)) {
    const load = field?.components?.Input
    if (typeof load !== 'function' || load.blockscene) continue
    const wrapped: any = () => Promise.resolve(load()).then((mod: any) => lazyFor(uid) ? ({ ...mod, default: lazyInput(uid, mod?.default ?? mod) }) : mod)
    wrapped.blockscene = true
    field.components.Input = wrapped
  }
}
