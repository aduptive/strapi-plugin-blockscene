import * as React from 'react'
import { ModalLayout, ModalHeader, ModalBody, Typography, Switch, Flex, SingleSelect, SingleSelectOption } from '@strapi/design-system'
import { useCMEditViewDataManager, useFetchClient, useLibrary, useRBAC, auth } from '@strapi/helper-plugin'
import { Gallery } from './Gallery'
import { Settings, permissions, register } from './Settings'
import { editableZones, canInsert } from './model.mjs'
import { useCatalog } from './catalog'
import { registerTrads } from './messages'

function Modal({ open, onOpenChange, trigger, title, children }: any) {
  const id = React.useId()
  return <>{trigger}{open && <ModalLayout onClose={() => onOpenChange(false)} labelledBy={id}>
    <ModalHeader><Typography id={id} variant="beta">{title}</Typography></ModalHeader>
    <ModalBody>{children}</ModalBody></ModalLayout>}</>
}
function Picker() {
  const c: any = useCMEditViewDataManager()
  const { get } = useFetchClient()
  const catalog = useCatalog(get)
  const components = c.allLayoutData?.components || {}
  const schema = c.layout || c.allLayoutData?.contentType
  const allowed = (c.isCreatingEntry ? c.createActionAllowedFields : c.updateActionAllowedFields) || []
  const zones = editableZones(schema, c.modifiedData, (name: string) => allowed.includes(name) &&
    schema?.metadatas?.[name]?.edit?.editable !== false, !c.addComponentToDynamicZone)
    .map(zone => ({ ...zone, label: schema?.metadatas?.[zone.name]?.edit?.label || zone.name }))
  const add = (zone: any, uid: string) => {
    const close = catalog?.groups?.[uid]
    if (!canInsert(zone, uid, c.modifiedData, components, close ? 2 : 1) || (close && !zone.components.includes(close))) return false
    c.addComponentToDynamicZone(zone.name, components[uid], components, Boolean(c.formErrors?.[zone.name]))
    // A configured OPEN always brings its CLOSE in the same unsaved change: an empty group, never a lone marker.
    if (close) c.addComponentToDynamicZone(zone.name, components[close], components, Boolean(c.formErrors?.[zone.name]))
    return true
  }
  // Bypass: no catalog (server flag, error) or enhancements off renders nothing, leaving the native editor.
  if (!catalog?.editor?.enabled) return null
  const docKey = `${c.slug}:${c.isCreatingEntry ? 'new' : c.initialData?.id}:${c.initialData?.locale || ''}`
  return <Gallery zones={zones} components={components} add={add} Modal={Modal} Toggle={ToggleField} get={get} editor={catalog.editor}
    docKey={docKey} contentType={c.slug} userId={auth.getUserInfo?.()?.id} />
}
const ToggleField = ({ name, label, value, onChange, disabled }: any) =>
  <Flex gap={3}><Switch name={name} aria-label={label} selected={Boolean(value)} disabled={disabled} onChange={() => onChange(!value)} /><Typography>{label}</Typography></Flex>
const SelectField = ({ name, label, value, onChange, disabled, options }: any) =>
  <SingleSelect name={name} label={label} value={value} disabled={disabled} onChange={(v: any) => onChange(String(v))}>
    {options.map((o: any) => <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>)}
  </SingleSelect>
function MediaPicker({ onClose, onSelect }: any) {
  const { components }: any = useLibrary()
  const Dialog = components?.['media-library']
  if (!Dialog) { onClose(); return null }
  return <Dialog onClose={onClose} allowedTypes={['images']} onSelectAssets={(assets: any[]) => onSelect(assets?.[0])} />
}
function usePermissions() {
  const { allowedActions, isLoading }: any = useRBAC(permissions)
  return { canRead: allowedActions.canRead, canUpdate: allowedActions.canUpdate, isLoading }
}
const SettingsPage = () => <Settings useClient={useFetchClient} usePermissions={usePermissions} MediaPicker={MediaPicker} ToggleField={ToggleField} SelectField={SelectField} previewSupported={false} />
export default {
  register(app: any) { register(app, SettingsPage); app.registerPlugin({ id: 'block-picker', name: 'Block Picker' }) },
  registerTrads,
  bootstrap(app: any) { app.injectContentManagerComponent('editView', 'right-links', { name: 'block-picker', Component: Picker }) },
}
