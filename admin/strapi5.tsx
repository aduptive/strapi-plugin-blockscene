import * as React from "react";
import {
  Modal as Dialog,
  Switch,
  Flex,
  Typography,
  Field,
  SingleSelect,
  SingleSelectOption,
  TextInput,
} from "@strapi/design-system";
import {
  useFetchClient,
  useRBAC,
  useStrapiApp,
  useAuth,
  useForm,
} from "@strapi/strapi/admin";
import {
  unstable_useContentManagerContext as useContext,
  useDocumentRBAC,
} from "@strapi/content-manager/strapi-admin";
import { Gallery } from "./Gallery";
import { PagePreview } from "./PagePreview";
import { Settings, permissions, register } from "./Settings";
import { editableZones, canInsert, componentDefaults } from "./model.mjs";
import { useMessages } from "./messages";
import { useCatalog } from "./catalog";
import { registerTrads } from "./messages";

function Modal({ open, onOpenChange, trigger, title, children }: any) {
  // Controlled callers (row previews, insertion gaps) pass no trigger: Dialog.Trigger requires a single element child.
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger>{trigger}</Dialog.Trigger>}
      <Dialog.Content style={{ width: "80vw", maxWidth: "80vw" }}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>{children}</Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
function Panel() {
  const c: any = useContext();
  const rbac: any = useDocumentRBAC("Blockscene", (state: any) => state);
  const { get } = useFetchClient();
  const t = useMessages();
  const user: any = useAuth("Blockscene", (state: any) => state.user);
  // Live form values: the context's `form.values` snapshot can lag behind edits made through the preview, which misplaces insertions.
  const formValues: any = useForm("Blockscene", (state: any) => state.values);
  const catalog = useCatalog(get);
  const creating =
    !c.id && !c.form?.initialValues?.id && !c.form?.initialValues?.documentId;
  const allowed =
    (creating ? rbac.canCreateFields : rbac.canUpdateFields) || [];
  const fields = c.layout?.edit?.layout?.flat(3) || [];
  const zones = editableZones(
    c.contentType,
    formValues ?? c.form?.values,
    (name: string) =>
      allowed.includes(name) &&
      (creating || (rbac.canReadFields || []).includes(name)) &&
      fields.find((field: any) => field.name === name)?.disabled !== true,
    c.isLoading || c.form?.disabled || !c.form?.addFieldRow,
  ).map((zone) => ({
    ...zone,
    label:
      fields.find((field: any) => field.name === zone.name)?.label || zone.name,
  }));
  const add = (zone: any, uid: string) => {
    const values = formValues ?? c.form.values;
    const close = catalog?.groups?.[uid];
    if (
      c.form.disabled ||
      !canInsert(zone, uid, values, c.components, close ? 2 : 1) ||
      (close && !zone.components.includes(close))
    )
      return false;
    // Explicit indexes: two appends in one tick would both target the same stale length and land reversed.
    const at = Array.isArray(values?.[zone.name])
      ? values[zone.name].length
      : 0;
    c.form.addFieldRow(
      zone.name,
      {
        ...componentDefaults(c.components[uid], c.components),
        __component: uid,
      },
      at,
    );
    // A configured OPEN always brings its CLOSE in the same unsaved change: an empty group, never a lone marker.
    if (close) c.form.addFieldRow(zone.name, { __component: close }, at + 1);
    return true;
  };
  if (!zones.length || !catalog?.editor?.enabled) return null;
  const docKey = `${c.model}:${creating ? "new" : c.id}:${c.form?.initialValues?.locale || ""}`;
  return {
    title: t.gallery,
    content: (
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Gallery
          zones={zones}
          components={c.components}
          add={add}
          Modal={Modal}
          Toggle={ToggleField}
          get={get}
          editor={catalog.editor}
          catalog={catalog}
          docKey={docKey}
          contentType={c.model}
          userId={user?.id}
        />
        <PagePreview
          editor={catalog.editor}
          groups={catalog.groups || null}
          Modal={Modal}
          Toggle={ToggleField}
        />
      </Flex>
    ),
  };
}
const ToggleField = ({ name, label, value, onChange, disabled }: any) => (
  <Flex gap={3}>
    <Switch
      name={name}
      aria-label={label}
      checked={Boolean(value)}
      disabled={disabled}
      onCheckedChange={onChange}
    />
    <Typography>{label}</Typography>
  </Flex>
);
const TextField = ({
  name,
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: any) => (
  <Field.Root name={name}>
    <Field.Label>{label}</Field.Label>
    <TextInput
      name={name}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e: any) => onChange(e.target.value)}
    />
  </Field.Root>
);
const SelectField = ({
  name,
  label,
  value,
  onChange,
  disabled,
  options,
}: any) => (
  <Field.Root name={name}>
    <Field.Label>{label}</Field.Label>
    <SingleSelect
      value={value}
      disabled={disabled}
      onChange={(v: any) => onChange(String(v))}
    >
      {options.map((o: any) => (
        <SingleSelectOption key={o.value} value={o.value}>
          {o.label}
        </SingleSelectOption>
      ))}
    </SingleSelect>
  </Field.Root>
);
function MediaPicker({ onClose, onSelect }: any) {
  const components: any = useStrapiApp(
    "Blockscene",
    (state: any) => state.components,
  );
  const Dialog = components?.["media-library"];
  React.useEffect(() => {
    if (!Dialog) onClose();
  }, [Dialog, onClose]);
  if (!Dialog) return null;
  return (
    <Dialog
      onClose={onClose}
      allowedTypes={["images"]}
      multiple={false}
      onSelectAssets={(assets: any[]) => onSelect(assets?.[0])}
    />
  );
}
function usePermissions() {
  // Strapi 5 wants a flat array; the object form logs a deprecation warning.
  const { allowedActions, isLoading }: any = useRBAC(
    Object.values(permissions).flat(),
  );
  return {
    canRead: allowedActions.canRead,
    canUpdate: allowedActions.canUpdate,
    isLoading,
  };
}
const SettingsPage = () => (
  <Settings
    useClient={useFetchClient}
    usePermissions={usePermissions}
    MediaPicker={MediaPicker}
    ToggleField={ToggleField}
    SelectField={SelectField}
    TextField={TextField}
    previewSupported
  />
);
export default {
  register(app: any) {
    register(app, SettingsPage, "blockscene");
    app.registerPlugin({ id: "blockscene", name: "Blockscene" });
  },
  registerTrads,
  bootstrap(app: any) {
    app.getPlugin("content-manager").apis.addEditViewSidePanel([Panel]);
  },
};
