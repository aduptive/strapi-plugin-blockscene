import * as React from 'react'
import styled from 'styled-components'
import { Flex, Tooltip } from '@strapi/design-system'
import { Icon } from './icons'
import { useMessages } from './messages'

// A field's `help` text (plugin config `fields`, Strapi 5): an info button in the Content Manager's labelAction slot,
// next to the label (outside the <label>), whose tooltip opens on hover and on keyboard focus. The action another
// plugin set first (i18n's globe; core plugins register their hooks before app plugins) is kept, before the icon.
// The version history view reads labelAction.props.title.id to reword i18n's message, so the element carries a
// `title` object: the previous action's (handed back to it, reworded or not) or our own.
const HelpButton = styled.button`
  display: inline-flex; padding: 0; border: 0; border-radius: 50%; background: none; cursor: help; color: inherit;
  &:hover, &:focus-visible { color: ${({ theme }) => theme.colors.primary600}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 2px; }
`
function FieldHelp({ text, previous, title }: { text: string; previous?: any; title: any }) {
  const m = useMessages()
  const kept = React.isValidElement<any>(previous) && previous.props.title ? React.cloneElement<any>(previous, { title }) : previous
  return (
    <Flex gap={1} alignItems="center">
      {kept}
      <Tooltip label={text} style={{ maxWidth: 320 }}>
        <HelpButton type="button" aria-label={m.fieldHelp}><Icon name="info" size={14} /></HelpButton>
      </Tooltip>
    </Flex>
  )
}
export const helpAction = (text: string, previous?: any) =>
  <FieldHelp text={text} previous={previous} title={(React.isValidElement<any>(previous) && previous.props.title) || { id: 'blockscene.fieldHelp' }} />
