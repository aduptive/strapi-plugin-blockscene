import * as React from 'react'
import styled from 'styled-components'
import { Icon } from './icons'
import { useMessages } from './messages'
import contract from '../server/text-template.js'

const { TAGS, ROLES, MODIFIERS, codePoints, normalizeValue, validateTemplate, demoValue, resolveBinding, createEntryId, applyTextChange } = contract as any

const Field = styled.div`
  position: relative; color: ${({ theme }) => theme.colors.neutral800};
  & > label { display: block; margin-bottom: 6px; font-weight: 600; }
  & > [data-help] { margin-top: 5px; color: ${({ theme }) => theme.colors.neutral600}; font-size: 1.2rem; }
  & > [data-error] { margin-top: 5px; color: ${({ theme }) => theme.colors.danger600}; font-size: 1.2rem; }
`
const Editor = styled.div`
  position: relative; display: grid; gap: 12px; padding: 16px; border: 1px solid ${({ theme }) => theme.colors.neutral200}; border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  &[aria-disabled=true] { background: ${({ theme }) => theme.colors.neutral150}; }
  & > [data-tools] { position: absolute; top: 8px; right: 8px; z-index: 1; }
  & > [data-empty] { color: ${({ theme }) => theme.colors.neutral600}; padding-right: 40px; }
`
const Part = styled.div`
  display: grid; gap: 5px;
  & label { font-size: 1.2rem; color: ${({ theme }) => theme.colors.neutral600}; }
  & textarea { width: 100%; min-height: 54px; resize: vertical; padding: 9px 11px; color: inherit; background: transparent; border: 1px solid ${({ theme }) => theme.colors.neutral200}; border-radius: 4px; font: inherit; }
  & textarea:focus { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 1px; }
  & textarea[aria-invalid=true] { border-color: ${({ theme }) => theme.colors.danger600}; }
  &[data-uppercase=true] textarea { text-transform: uppercase; }
  &[data-lowercase=true] textarea { text-transform: lowercase; }
  &[data-underline=true] textarea { text-decoration: underline; }
  & [data-meta] { display: flex; justify-content: space-between; gap: 8px; color: ${({ theme }) => theme.colors.neutral600}; font-size: 1.1rem; }
  & [data-warning] { color: ${({ theme }) => theme.colors.warning700}; }
`
const Actions = styled.div`display:flex; gap:8px; align-items:center; flex-wrap:wrap;`
const Spacer = styled.span`flex:1;`
const NativeButton = styled.button`
  min-height: 32px; padding: 5px 10px; border: 1px solid ${({ theme }) => theme.colors.neutral200}; border-radius: 4px; background: ${({ theme }) => theme.colors.neutral0}; color: inherit; cursor: pointer;
  &:disabled { opacity:.45; cursor:default; } &:focus-visible { outline:2px solid ${({ theme }) => theme.colors.primary600}; outline-offset:1px; }
`
const Dialog = styled.dialog`
  width: min(920px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 20px; color: ${({ theme }) => theme.colors.neutral800}; background: ${({ theme }) => theme.colors.neutral0}; border: 1px solid ${({ theme }) => theme.colors.neutral200}; border-radius: 8px;
  &::backdrop { background: rgb(0 0 0 / .55); }
  & header, & footer { display:flex; justify-content:space-between; align-items:center; gap:12px; }
  & footer { justify-content:flex-end; margin-top:18px; }
`
const Config = styled.div`
  display:grid; gap:12px; margin-top:16px;
  & > section { display:grid; gap:10px; padding:12px; border:1px solid ${({ theme }) => theme.colors.neutral200}; border-radius:4px; }
  & [data-grid] { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
  & label { display:grid; gap:4px; font-size:1.2rem; }
  & label[data-check] { display:flex; align-items:center; gap:6px; }
  & input, & select, & textarea { min-height:36px; padding:7px 9px; color:inherit; background:${({ theme }) => theme.colors.neutral0}; border:1px solid ${({ theme }) => theme.colors.neutral200}; border-radius:4px; }
`

const fieldName = (name: string) => name.split('.').pop() || name
const safeValue = (value: any) => {
  try { return normalizeValue(value) }
  catch (error: any) {
    if (error?.name !== 'ValidationError') throw error
    return { version: 1, values: {} }
  }
}

function TextPart({ entry, index, name, text, disabled, update, messages }: any) {
  const textarea = React.useRef<HTMLTextAreaElement>(null)
  const compositionStart = React.useRef(text)
  const [overSoftLines, setOverSoftLines] = React.useState(false)
  const measure = React.useCallback(() => {
    const node = textarea.current
    setOverSoftLines(Boolean(entry.softLines && node && node.scrollHeight > node.clientHeight + 1))
  }, [entry.softLines])
  React.useLayoutEffect(() => { measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure) }, [measure, text])
  const count = codePoints(text), missing = entry.required && !text.trim()
  return <Part data-uppercase={entry.modifiers.includes('uppercase')} data-lowercase={entry.modifiers.includes('lowercase')} data-underline={entry.modifiers.includes('underline')}>
    <label htmlFor={`${name}-${index}`}>{entry.label}{entry.required ? ' *' : ''}</label>
    <textarea ref={textarea} id={`${name}-${index}`} value={text} disabled={disabled} rows={entry.softLines || 2} aria-invalid={missing || undefined} aria-required={entry.required}
      placeholder={entry.required ? messages.f('textTemplateRequiredPlaceholder', { label: entry.label }) : entry.label}
      onKeyDown={event => { if (!entry.allowBreaks && event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault() }}
      onCompositionStart={() => { compositionStart.current = text }}
      onCompositionEnd={event => update(entry, event.currentTarget.value, false, compositionStart.current)}
      onChange={event => update(entry, event.target.value, event.nativeEvent.isComposing, event.nativeEvent.isComposing ? compositionStart.current : text)} />
    <div data-meta><span data-warning={overSoftLines || undefined}>{overSoftLines ? messages.f('textTemplateSoftLinesExceeded', { count: entry.softLines }) : entry.softLines ? messages.f('textTemplateSoftLines', { count: entry.softLines }) : entry.allowBreaks ? messages.textTemplateEnter : messages.textTemplateNoBreaks}</span>
      <span data-warning={entry.maxChars && count > entry.maxChars * .9 || undefined}>{entry.maxChars ? messages.f('textTemplateCountLimit', { count, limit: entry.maxChars }) : messages.f('textTemplateCount', { count })}</span></div>
  </Part>
}

export function TextTemplateInput({ name, label, hint, error, required, disabled, value, onChange, contentTypeUID, attribute, get, put, canConfigure }: any) {
  const m = useMessages()
  const key = resolveBinding(attribute, contentTypeUID, fieldName(name))
  const [template, setTemplate] = React.useState<any[]>([])
  const [draft, setDraft] = React.useState<any[]>([])
  const [feedback, setFeedback] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const dialog = React.useRef<HTMLDialogElement>(null)
  const pencil = React.useRef<HTMLButtonElement>(null)
  const current = safeValue(value)
  React.useEffect(() => {
    if (!key) return
    let active = true
    get('/blockscene/catalog').then(({ data }: any) => { if (active) setTemplate(data?.textTemplates?.[key] || []) })
      .catch(() => { if (active) setFeedback(m.textTemplateLoadFailed) })
    return () => { active = false }
  }, [get, key, m.textTemplateLoadFailed])
  const change = (values: Record<string, string>) => onChange({ target: { name, type: 'json', value: { version: 1, values } } })
  const update = (entry: any, text: string, composing = false, started = current.values[entry.id] || '') => {
    const result = applyTextChange(entry, current.values[entry.id] || '', text, { composing, compositionStart: started })
    if (!result.accepted) { setFeedback(m.f('textTemplateLimit', { label: entry.label, count: entry.maxChars })); change({ ...current.values, [entry.id]: result.value }); return }
    setFeedback(''); change({ ...current.values, [entry.id]: result.value })
  }
  const generate = () => {
    if (Object.values(current.values).some(text => String(text).trim()) && !window.confirm(m.textTemplateReplaceDemo)) return
    change(demoValue(template).values); setFeedback(m.textTemplateDemoApplied)
  }
  const open = () => { setDraft(structuredClone(template)); dialog.current?.showModal() }
  const close = () => { dialog.current?.close(); pencil.current?.focus() }
  const edit = (index: number, patch: any) => setDraft(list => list.map((entry, i) => i === index ? { ...entry, ...patch } : entry))
  const add = () => setDraft(list => [...list, { id: createEntryId(list, current.values, globalThis.crypto?.randomUUID?.()), label: m.textTemplateNewPart, role: 'body', tag: 'p', token: '', modifiers: [], required: false, allowBreaks: true, demo: m.textTemplateNewDemo }])
  const save = async () => {
    try { validateTemplate(draft) } catch (caught: any) { setFeedback(caught.message); return }
    setSaving(true)
    try {
      const { data } = await get('/blockscene/settings')
      const next = { ...data.settings, textTemplates: { ...(data.settings.textTemplates || {}), [key]: draft } }
      await put('/blockscene/settings', next); setTemplate(structuredClone(draft)); setFeedback(m.textTemplateUpdated); close()
    } catch { setFeedback(m.textTemplateSaveFailed) }
    finally { setSaving(false) }
  }
  return <Field>
    <label htmlFor={`${name}-0`}>{label}{required ? ' *' : ''}</label>
    <Editor aria-disabled={Boolean(disabled)}>
      {canConfigure && key && <div data-tools><NativeButton ref={pencil} type="button" aria-label={m.textTemplateEdit} title={m.textTemplateEdit} onClick={open}><Icon name="edit" /></NativeButton></div>}
      {!template.length && <div data-empty>{m.textTemplateEmpty}</div>}
      {template.map((entry, index) => <TextPart key={entry.id} entry={entry} index={index} name={name} text={current.values[entry.id] || ''} disabled={disabled} update={update} messages={m} />)}
      <Actions><NativeButton type="button" disabled={disabled || !template.length} onClick={generate}>{m.textTemplateDemo}</NativeButton></Actions>
    </Editor>
    {hint && <div data-help>{hint}</div>}{(error || feedback) && <div data-error role="alert">{error?.defaultMessage || error || feedback}</div>}
    <Dialog ref={dialog} onCancel={event => { event.preventDefault(); close() }} onClose={() => pencil.current?.focus()} aria-labelledby={`${name}-template-title`}>
      <header><h2 id={`${name}-template-title`}>{m.textTemplateTitle}</h2><NativeButton type="button" onClick={close} aria-label={m.close}><Icon name="close" /></NativeButton></header>
      <p>{m.textTemplateScope} <code>{key}</code>. {m.textTemplatePreserved}</p>
      <Config>{draft.map((entry, index) => <section key={entry.id}>
        <Actions><strong>{entry.label || entry.id}</strong><Spacer /><NativeButton type="button" disabled={index === 0} onClick={() => setDraft(list => { const next = [...list]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}>{m.moveUp}</NativeButton><NativeButton type="button" disabled={index === draft.length - 1} onClick={() => setDraft(list => { const next = [...list]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next })}>{m.moveDown}</NativeButton><NativeButton type="button" onClick={() => setDraft(list => list.filter((_, i) => i !== index))}>{m.textTemplateRemove}</NativeButton></Actions>
        <div data-grid>
          <label>{m.textTemplateId}<input value={entry.id} disabled /></label><label>{m.textTemplateFieldLabel}<input value={entry.label} onChange={event => edit(index, { label: event.target.value })} /></label>
          <label>{m.textTemplateRole}<select value={entry.role} onChange={event => edit(index, { role: event.target.value })}>{ROLES.map((role: string) => <option key={role}>{role}</option>)}</select></label>
          <label>{m.textTemplateTag}<select value={entry.tag} onChange={event => edit(index, { tag: event.target.value })}>{TAGS.map((tag: string) => <option key={tag}>{tag}</option>)}</select></label>
          <label>{m.textTemplateToken}<input value={entry.token} onChange={event => edit(index, { token: event.target.value })} /></label>
          <label>{m.textTemplateRecommendedLines}<input type="number" min="1" max="20" value={entry.softLines || ''} onChange={event => edit(index, { softLines: event.target.value ? Number(event.target.value) : undefined })} /></label>
          <label>{m.textTemplateCharacterLimit}<input type="number" min="1" max="50000" value={entry.maxChars || ''} onChange={event => edit(index, { maxChars: event.target.value ? Number(event.target.value) : undefined })} /></label>
        </div>
        <Actions><label data-check><input type="checkbox" checked={entry.required} onChange={event => edit(index, { required: event.target.checked })} />{m.textTemplateRequired}</label><label data-check><input type="checkbox" checked={entry.allowBreaks} onChange={event => edit(index, { allowBreaks: event.target.checked })} />{m.textTemplateAllowEnter}</label>
          {MODIFIERS.map((modifier: string) => <label data-check key={modifier}><input type="checkbox" checked={entry.modifiers.includes(modifier)} onChange={event => { const modifiers = event.target.checked ? [...entry.modifiers.filter((item: string) => !(modifier === 'uppercase' && item === 'lowercase') && !(modifier === 'lowercase' && item === 'uppercase')), modifier] : entry.modifiers.filter((item: string) => item !== modifier); edit(index, { modifiers }) }} />{modifier}</label>)}</Actions>
        <label>{m.textTemplateDemoText}<textarea value={entry.demo} onChange={event => edit(index, { demo: event.target.value })} /></label>
      </section>)}</Config>
      <Actions><NativeButton type="button" onClick={add}>{m.textTemplateAddPart}</NativeButton></Actions>
      <footer><NativeButton type="button" onClick={close}>{m.cancel}</NativeButton><NativeButton type="button" disabled={saving} onClick={save}>{m.textTemplateSave}</NativeButton></footer>
    </Dialog>
  </Field>
}
