import * as React from 'react'
import { useFetchClient, useRBAC } from '@strapi/strapi/admin'
import { unstable_useContentManagerContext as useContentManagerContext } from '@strapi/content-manager/strapi-admin'
import { TextTemplateInput } from './TextTemplateInput'
import { permissions } from './Settings'

export default React.forwardRef(function Input(props: any, _ref: any) {
  const client = useFetchClient()
  const context: any = useContentManagerContext()
  const { allowedActions, isLoading }: any = useRBAC(Object.values(permissions).flat())
  return <TextTemplateInput {...props} {...client} contentTypeUID={context.model} canConfigure={!isLoading && allowedActions.canRead && allowedActions.canUpdate} />
})
