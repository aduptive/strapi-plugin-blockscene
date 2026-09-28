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
  useNotification,
  getFetchClient,
} from "@strapi/strapi/admin";
import {
  unstable_useContentManagerContext as useContext,
  useDocumentRBAC,
} from "@strapi/content-manager/strapi-admin";
import { Gallery } from "./Gallery";
import { PagePreview } from "./PagePreview";
import { History } from "./History";
import { Settings, permissions, register } from "./Settings";
import { editableZones, canInsert, componentDefaults, labelEditLayout } from "./model.mjs";
import { cloneRow, currentRelations, fractionalKeys, relationSlots, toConnect } from "./rows.mjs";
import { Guard } from "./Guard";
import { useCatalog, labelsHook } from "./catalog";
import { registerTrads } from "./messages";
import { setLazyConfig, wrapCustomFields } from "./LazyInput";

function Modal({ open, onOpenChange, trigger, title, children, width = "80vw" }: any) {
  // Controlled callers (row previews, insertion gaps) pass no trigger: Dialog.Trigger requires a single element child.
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger>{trigger}</Dialog.Trigger>}
      <Dialog.Content style={{ width, maxWidth: "92vw" }}>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>{children}</Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
// Relations of a saved component, read the way the relation input reads them (newest first, so reversed).
async function relationsOf(get: any, { uid, id, field }: any, locale?: string) {
  const out: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ page: String(page), pageSize: "100", ...(locale ? { locale } : {}) });
    const { data }: any = await get(`/content-manager/relations/${uid}/${id}/${field}?${query}`);
    out.push(...(data?.results || []));
    if (page >= (data?.pagination?.pageCount || 1)) break;
  }
  return out.reverse();
}
// Row actions write whole zone arrays through the form (undo/redo sees them); new rows get fractional keys and their
// relations as the `connect` list a new row holds (what the server has for the source row, plus its unsaved changes).
function useRowForm(c: any, values: any, get: any) {
  const onChange = useForm("Blockscene", (state: any) => state.onChange);
  const { toggleNotification } = useNotification();
  const latest = React.useRef(values);
  latest.current = values;
  const locale = c.form?.initialValues?.locale || undefined;
  if (typeof onChange !== "function") return null;
  return {
    model: c.model,
    locale,
    rows: (zone: string) => (Array.isArray(latest.current?.[zone]) ? latest.current[zone] : []),
    setRows: (zone: string, rows: any[]) => onChange(zone, rows),
    keys: fractionalKeys,
    notify: (type: string, message: string) => toggleNotification({ type, message }),
    prepare: (rows: any[]) =>
      Promise.all(rows.map(async (row) => {
        const server = new Map<string, any[]>();
        for (const slot of relationSlots(row, c.components)) server.set(slot.path, await relationsOf(get, slot, locale));
        return cloneRow(row, c.components, {
          relation: (value: any, attr: any, path: any[]) => toConnect(currentRelations(server.get(path.join(".")) || [], value), attr.targetModel || attr.target),
        });
      })),
  };
}
function Panel() {
  const c: any = useContext();
  const rbac: any = useDocumentRBAC("Blockscene", (state: any) => state);
  const { get, put } = useFetchClient();
  const user: any = useAuth("Blockscene", (state: any) => state.user);
  // Live form values: the context's `form.values` snapshot can lag behind edits made through the preview, which misplaces insertions.
  const formValues: any = useForm("Blockscene", (state: any) => state.values);
  const catalog = useCatalog(get);
  const form = useRowForm(c, formValues ?? c.form?.values, get);
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
  const typeSettings = catalog?.contentTypes?.[c.model] || {};
  const lazy = Boolean(catalog?.editor?.enabled && catalog.editor.lazyEditors !== false && typeSettings.enabled !== false);
  const lazyFields = (catalog?.editor?.lazyFields || []).join(",");
  React.useEffect(() => {
    if (catalog) setLazyConfig({ on: lazy, fields: lazyFields ? lazyFields.split(",") : [] });
  }, [catalog, lazy, lazyFields]);
  const gallery = zones.length > 0 && catalog?.editor?.enabled && typeSettings.enabled !== false;
  // Version history: saved documents of covered types, whether or not the gallery applies to them.
  const history = !creating && Boolean(c.id) && Boolean(catalog?.history?.contentTypes?.includes(c.model));
  if (!gallery && !history) return null;
  const docKey = `${c.model}:${creating ? "new" : c.id}:${c.form?.initialValues?.locale || ""}`;
  return {
    // The panel is the plugin (gallery, accordions, preview modes), so it carries the plugin's name; the dialog stays "Block gallery".
    title: "Blockscene",
    content: (
      <Guard>
      <Flex direction="column" alignItems="stretch" gap={4}>
        {gallery && <>
        <Gallery
          zones={zones}
          components={c.components}
          add={add}
          Modal={Modal}
          Toggle={ToggleField}
          get={get}
          put={put}
          editor={catalog.editor}
          catalog={catalog}
          docKey={docKey}
          contentType={c.model}
          userId={user?.id}
          form={form}
        />
        <PagePreview
          editor={{ ...catalog.editor, previewMode: typeSettings.previewMode || catalog.editor.previewMode,
            sidebar: typeSettings.sidebar || [], sidebarPosition: typeSettings.sidebarPosition || "left" }}
          groups={catalog.groups || null}
          hiddenAttribute={catalog.editor.hiddenBlocks !== "off" ? catalog.hiddenAttribute : null}
          form={form}
          Modal={Modal}
          Toggle={ToggleField}
        />
        </>}
        {history && (
          <History
            model={c.model}
            documentId={c.id}
            schema={c.contentType}
            components={c.components}
            // Component permissions are listed per nested path ("seo.metaTitle"): any of them makes the field editable.
            editable={(name: string) => (rbac.canUpdateFields || []).some((field: string) => field === name || field.startsWith(`${name}.`))}
            disabled={Boolean(c.form?.disabled)}
            get={get}
            relationsOf={relationsOf}
          />
        )}
      </Flex>
      </Guard>
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
      startIcon={options.find((o: any) => o.value === value)?.icon}
      onChange={(v: any) => onChange(String(v))}
    >
      {options.map((o: any) => (
        <SingleSelectOption key={o.value} value={o.value} startIcon={o.icon}>
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
  <Guard>
  <Settings
    useClient={useFetchClient}
    usePermissions={usePermissions}
    MediaPicker={MediaPicker}
    ToggleField={ToggleField}
    SelectField={SelectField}
    TextField={TextField}
    previewSupported
  />
  </Guard>
);
// bootstrap() only receives a few helpers; the custom fields registry lives on the app that register() gets.
let strapiApp: any = null;
export default {
  register(app: any) {
    strapiApp = app;
    register(app, SettingsPage, "blockscene");
    app.registerPlugin({ id: "blockscene", name: "Blockscene" });
  },
  registerTrads,
  bootstrap(app: any) {
    app.getPlugin("content-manager").apis.addEditViewSidePanel([Panel]);
    app.registerHook("Admin/CM/pages/EditView/mutate-edit-view-layout", labelsHook(() => getFetchClient().get, labelEditLayout));
    // Every plugin has registered its custom fields by now.
    wrapCustomFields(strapiApp);
  },
};
