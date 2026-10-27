import * as React from 'react'
import { useFetchClient, useRBAC } from '@strapi/helper-plugin'
import { TextTemplateInput } from './TextTemplateInput'
import { permissions } from './Settings'

export default React.forwardRef(function Input(props: any, _ref: any) {
  const client = useFetchClient()
  const { allowedActions, isLoading }: any = useRBAC(permissions)
  return <TextTemplateInput {...props} {...client} canConfigure={!isLoading && allowedActions.canRead && allowedActions.canUpdate} />
})
