import * as React from 'react'
import { Box, Typography } from '@strapi/design-system'
import { useMessages } from './messages'

const Notice = () => {
  const t = useMessages()
  return <Box padding={3} background="warning100" hasRadius><Typography variant="pi" textColor="warning700" role="alert">{t.crashed}</Typography></Box>
}
// Any render error inside the plugin unmounts only the plugin (its effects clean up the page) and leaves the native
// editor working. Event-handler errors never reach here; they cannot break the edit view either.
export class Guard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error('[blockscene] disabled for this view after an error:', error) }
  render() { return this.state.failed ? <Notice /> : this.props.children }
}
