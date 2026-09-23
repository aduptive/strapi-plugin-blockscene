import * as React from 'react'
import { Form, InputRenderer, useForm, useStrapiApp } from '@strapi/strapi/admin'
import { Button, Flex, Modal, Typography } from '@strapi/design-system'
import { useMessages } from './messages'

// "Edit text" over the preview: an admin modal reusing the field's own native
// input (registered custom field with its options, or the admin text input)
// inside a local Form. Apply pushes the value into the document form, unsaved;
// Cancel discards only what was typed here. Strapi 5 only.
const Actions = ({ onApply, onCancel }: any) => {
  const t = useMessages()
  const value = useForm('BlocksceneFieldEditor', (state: any) => state.values.value)
  return <Flex gap={2} justifyContent="flex-end">
    <Button variant="tertiary" onClick={onCancel}>{t.cancel}</Button>
    <Button onClick={() => onApply(value ?? null)} data-testid="field-editor-apply">{t.apply}</Button>
  </Flex>
}

export function FieldEditorModal({ label, attribute, value, onApply, onCancel }: any) {
  const t = useMessages()
  const customFields: any = useStrapiApp('BlocksceneFieldEditor', (state: any) => state.customFields)
  const [Input, setInput] = React.useState<React.ComponentType<any> | null | undefined>(undefined)
  // In the admin schema a custom field keeps its base type (e.g. richtext) plus `customField`.
  const isCustom = Boolean(attribute?.customField)
  const isText = attribute?.type === 'string' || attribute?.type === 'text'
  React.useEffect(() => {
    let active = true
    if (!isCustom) { setInput(null); return }
    const field = customFields?.get?.(attribute.customField)
    if (!field?.components?.Input) { setInput(null); return }
    Promise.resolve(field.components.Input()).then((mod: any) => { if (active) setInput(() => mod.default || mod) }).catch(() => { if (active) setInput(null) })
    return () => { active = false }
  }, [attribute, customFields, isCustom])
  const supported = isText || (isCustom && Input)
  return <Modal.Root open onOpenChange={(open: boolean) => { if (!open) onCancel() }}>
    <Modal.Content aria-label={`${t.editText} ${label}`}>
      <Modal.Header><Modal.Title>{t.editText} · {label}</Modal.Title></Modal.Header>
      <Form initialValues={{ value: value ?? (isText ? '' : null) }} method="PUT" onSubmit={() => {}}>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4} data-testid="field-editor-modal">
            <Typography variant="pi" textColor="neutral600">{t.editHelp}</Typography>
            {isCustom && Input === undefined && <Typography>{t.loading}</Typography>}
            {isCustom && Input && <Input name="value" attribute={attribute} label={label} type={attribute.type} />}
            {isText && <InputRenderer type={attribute.type === 'text' ? 'text' : 'string'} name="value" label={label} />}
            {((isCustom && Input === null) || (!isCustom && !isText)) && <Typography role="alert" textColor="danger600">{t.editUnsupported}</Typography>}
          </Flex>
        </Modal.Body>
        <Modal.Footer>{supported ? <Actions onApply={onApply} onCancel={onCancel} /> : <Button variant="tertiary" onClick={onCancel}>{t.close}</Button>}</Modal.Footer>
      </Form>
    </Modal.Content>
  </Modal.Root>
}
