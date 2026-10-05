import * as React from "react";
import {
  Button,
  MenuItem,
  SimpleMenu,
  ModalLayout,
  ModalHeader,
  ModalBody,
  Typography,
  Status,
  Switch,
  Flex,
  SingleSelect,
  SingleSelectOption,
  TextInput,
} from "@strapi/design-system";
import {
  useCMEditViewDataManager,
  useFetchClient,
  useLibrary,
  useRBAC,
  useNotification,
  auth,
  getFetchClient,
} from "@strapi/helper-plugin";
import { useIntl } from "react-intl";
import { Gallery } from "./Gallery";
import { PagePreview, ZoneBarTools, useEditorState, type PreviewHost } from "./PagePreview";
import { registerPanel } from "./pane.mjs";
import { useMessages } from "./messages";
import { Settings, permissions, register } from "./Settings";
import { editableZones, canInsert, variantRow, labelEditLayout4, dropField4 } from "./model.mjs";
import { cloneRow, errorRows, integerKeys } from "./rows.mjs";
import { useCatalog, labelsHook } from "./catalog";
import { registerTrads } from "./messages";
import { Guard } from "./Guard";
import { Icon, ICON_NAMES } from "./icons";
import { StarterKits } from "./StarterKits";

function Modal({ open, onOpenChange, trigger, title, children, width = "80vw" }: any) {
  const id = React.useId();
  return (
    <>
      {trigger}
      {open && (
        <ModalLayout onClose={() => onOpenChange(false)} labelledBy={id} width={width}>
          <ModalHeader>
            <Typography id={id} variant="beta">
              {title}
            </Typography>
          </ModalHeader>
          <ModalBody>{children}</ModalBody>
        </ModalLayout>
      )}
    </>
  );
}
// "…" menus of the zone bars (Design System 1: items act on click, the caret is dropped).
const Menu = ({ label, testid, items }: any) => (
  <div data-testid={testid}>
    <SimpleMenu variant="tertiary" size="S" aria-label={label} title={label} endIcon={null} label={<Icon name="more" size={16} />}>
      {items.map((item: any) => (
        <MenuItem key={item.testid} onClick={item.onSelect} data-testid={item.testid}>
          <Flex as="span" gap={2} alignItems="center"><Icon name={item.icon} size={16} />{item.label}</Flex>
        </MenuItem>
      ))}
    </SimpleMenu>
  </div>
);
// An insert variant on Strapi 4: addComponentToDynamicZone builds the row from its own defaults, then each variant field
// is set on it through the reducer (ON_CHANGE; nested lists get integer keys).
function overlayVariant(c: any, components: any, zone: string, at: number, uid: string, values: any) {
  const row = variantRow(components[uid], components, values, (n: number) => [...Array(n).keys()]);
  for (const name of Object.keys(values)) if (name in row) c.onChange({ target: { name: `${zone}.${at}.${name}`, value: row[name] } });
}
// Row actions write whole zone arrays through the edit view reducer (ON_CHANGE); new rows get integer keys. Relations
// are copied as the form holds them (the loaded pages of each relation list).
function useRowForm(c: any, components: any) {
  const toggleNotification = useNotification();
  const latest = React.useRef(c.modifiedData);
  latest.current = c.modifiedData;
  if (typeof c.onChange !== "function") return null;
  return {
    model: c.slug,
    locale: c.initialData?.locale || undefined,
    rows: (zone: string) => (Array.isArray(latest.current?.[zone]) ? latest.current[zone] : []),
    setRows: (zone: string, rows: any[]) => c.onChange({ target: { name: zone, value: rows } }),
    errorRows: (zone: string) => errorRows(c.formErrors, zone),
    keys: (rows: any[], _at: number, n: number) => integerKeys(rows, n),
    notify: (type: string, message: string) => toggleNotification({ type, message }),
    prepare: async (rows: any[]) => rows.map((row) => cloneRow(row, components)),
  };
}
function Picker() {
  const c: any = useCMEditViewDataManager();
  const { get, put } = useFetchClient();
  const catalog = useCatalog(get);
  const components = c.allLayoutData?.components || {};
  const form = useRowForm(c, components);
  const schema = c.layout || c.allLayoutData?.contentType;
  const allowed =
    (c.isCreatingEntry
      ? c.createActionAllowedFields
      : c.updateActionAllowedFields) || [];
  const zones = editableZones(
    schema,
    c.modifiedData,
    (name: string) =>
      allowed.includes(name) &&
      schema?.metadatas?.[name]?.edit?.editable !== false,
    !c.addComponentToDynamicZone,
  ).map((zone) => ({ ...zone, label: zoneLabel(schema, zone.name) }));

  const add = (zone: any, uid: string, values?: any) => {
    const close = catalog?.groups?.[uid];
    if (
      !canInsert(zone, uid, c.modifiedData, components, close ? 2 : 1) ||
      (close && !zone.components.includes(close))
    )
      return false;
    const at = Array.isArray(c.modifiedData?.[zone.name]) ? c.modifiedData[zone.name].length : 0;
    c.addComponentToDynamicZone(
      zone.name,
      components[uid],
      components,
      Boolean(c.formErrors?.[zone.name]),
    );
    if (values) overlayVariant(c, components, zone.name, at, uid, values);
    // A configured OPEN always brings its CLOSE in the same unsaved change: an empty group, never a lone marker.
    if (close)
      c.addComponentToDynamicZone(
        zone.name,
        components[close],
        components,
        Boolean(c.formErrors?.[zone.name]),
      );
    return true;
  };
  // Bypass: no catalog (server flag, error) or enhancements off renders nothing, leaving the native editor.
  if (!catalog?.editor?.enabled || catalog.contentTypes?.[c.slug]?.enabled === false) return null;
  const docKey = `${c.slug}:${c.isCreatingEntry ? "new" : c.initialData?.id}:${c.initialData?.locale || ""}`;
  // Nothing shows here: the zone bars and row tools are portalled into the form, the gallery opens from the native add
  // button, the page preview into its pane. Its anchor still sits in the side column, which split mode uses to find the
  // edit view's grid.
  return (
    <div hidden data-blockscene-editor="">
      <Workspace c={c} schema={schema} zones={zones} components={components} add={add} catalog={catalog} docKey={docKey} form={form} get={get} put={put} />
    </div>
  );
}
// One per edit view once the catalog is known, so the configured mode is the first one.
function Workspace({ c, schema, zones, components, add, catalog, docKey, form, get, put }: any) {
  const typeSettings = catalog.contentTypes?.[c.slug] || {};
  const editor = { ...catalog.editor, previewMode: typeSettings.previewMode || catalog.editor.previewMode,
    sidebar: typeSettings.sidebar || [], sidebarPosition: typeSettings.sidebarPosition || "left",
    previewToolbar: typeSettings.previewToolbar || catalog.editor.previewToolbar, previewDevices: typeSettings.previewDevices || catalog.editor.previewDevices };
  const host = usePreviewHost4(c, schema, components, get, put);
  const state = useEditorState(editor, host);
  return (
    <>
      <StarterKits creating={c.isCreatingEntry} kits={catalog.kits?.[c.slug]} zones={zones} components={components} form={form} Modal={Modal} docKey={docKey} />
      <Gallery
        zones={zones}
        components={components}
        add={add}
        Modal={Modal}
        Toggle={ToggleField}
        get={get}
        put={put}
        editor={catalog.editor}
        catalog={catalog}
        docKey={docKey}
        contentType={c.slug}
        userId={auth.getUserInfo?.()?.id}
        form={form}
        Menu={Menu}
        // No undo here: without a preview route there is nothing to add, and a zone bar with nothing else in it goes away.
        zoneTools={state.preview.base ? <ZoneBarTools state={state} /> : null}
        // The layout grid opens its cells in the preview core's block dialog and inserts through its picker (any mode).
        openBlock={state.openBlock}
        openInsert={state.openInsert}
      />
      <PagePreview
        editor={editor}
        state={state}
        host={host}
        groups={catalog.groups || null}
        hiddenAttribute={catalog.editor.hiddenBlocks !== "off" ? catalog.hiddenAttribute : null}
        form={form}
        Modal={Modal}
        Toggle={ToggleField}
      />
    </>
  );
}
// The page preview's view of a Strapi 4 edit view: the edit view data manager (useCMEditViewDataManager). Strapi 4 has
// no setValues, so no undo/redo here (see README); no native Preview either, so the route is the settings URL only.
function usePreviewHost4(c: any, schema: any, components: any, get: any, put: any): PreviewHost {
  const toggleNotification = useNotification();
  const { components: library }: any = useLibrary();
  const creating = Boolean(c.isCreatingEntry);
  const readable = React.useCallback(
    (name: string) => creating || (c.readActionAllowedFields || []).includes(name),
    [creating, c.readActionAllowedFields],
  );
  return {
    ds: 1,
    model: c.slug,
    documentId: creating ? undefined : c.initialData?.id,
    locale: c.initialData?.locale || undefined,
    creating,
    loading: false,
    disabled: false,
    contentType: schema,
    components,
    values: c.modifiedData,
    history: null,
    readable,
    editable: (name: string) =>
      ((creating ? c.createActionAllowedFields : c.updateActionAllowedFields) || []).includes(name) &&
      schema?.metadatas?.[name]?.edit?.editable !== false &&
      typeof c.addComponentToDynamicZone === "function" &&
      typeof c.onChange === "function",
    fieldLabel: (name: string) => zoneLabel(schema, name),
    onChange: (name: string, value: any) => c.onChange({ target: { name, value } }),
    // Native insertion at a position (4.11+): the edit view's own default data structure, relations emptied.
    // An insert variant's values are overlaid on the first row as in the gallery insert (Picker `add`).
    insertRows: (zone: string, at: number, items: any[], values?: any) => {
      items.forEach((item, i) =>
        c.addComponentToDynamicZone(zone, components[item.__component], components, Boolean(c.formErrors?.[zone]), at + i));
      if (values && items[0]) overlayVariant(c, components, zone, at, items[0].__component, values);
    },
    get,
    put,
    notify: (type: string, message: string) => toggleNotification({ type, message }),
    MediaLibrary: library?.["media-library"],
    useNativeBase: () => null,
    Actions: Actions4,
  };
}
// The rendered label: the edit layout's (field labels may have rewritten it), else the stored metadata.
const zoneLabel = (schema: any, name: string) =>
  schema?.layouts?.edit?.flat().find((field: any) => field?.name === name)?.metadatas?.label ||
  schema?.metadatas?.[name]?.edit?.label || name;
// Status and Save / Publish of the pane toolbar. Strapi 4 keeps them in the edit view header: each button mirrors the
// header's rule (Save needs a change, Publish none) and a click delegates to the header button, so its validation,
// confirmation dialogs and notifications are reused. A button the header does not show (permissions) is not shown.
function Actions4({ parts }: { parts: string[] }) {
  const c: any = useCMEditViewDataManager();
  const t = useMessages();
  const { formatMessage } = useIntl();
  // The header compares with lodash isEqual; the serialised values agree since the form keeps key order.
  const dirty = React.useMemo(
    () => (c.isCreatingEntry ? Object.keys(c.modifiedData || {}).length > 0 : JSON.stringify(c.initialData) !== JSON.stringify(c.modifiedData)),
    [c.initialData, c.modifiedData, c.isCreatingEntry],
  );
  const published = typeof c.initialData?.publishedAt === "string";
  const status = c.hasDraftAndPublish && !c.isCreatingEntry ? (published ? "published" : "draft") : undefined;
  const save = formatMessage({ id: "content-manager.containers.Edit.submit", defaultMessage: "Save" });
  const publish = formatMessage(published ? { id: "app.utils.unpublish", defaultMessage: "Unpublish" } : { id: "app.utils.publish", defaultMessage: "Publish" });
  const native = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("#main-content button")].find((b) => b.textContent?.trim() === label);
  const actions = [
    // Publish is the primary action, Save the secondary one (as in the Strapi 5 pane toolbar).
    { label: save, variant: "secondary", disabled: !dirty, loading: c.status === "submit-pending", reason: t.saveDisabledHint },
    ...(c.hasDraftAndPublish && !c.isCreatingEntry
      ? [{ label: publish, variant: "default", disabled: dirty, loading: c.status === (published ? "unpublish-pending" : "publish-pending"), reason: t.publishDisabledHint }]
      : []),
  ].filter((action) => native(action.label));
  return (
    <Flex gap={2} alignItems="center" data-testid="page-preview-actions">
      {parts.includes("status") && (status || dirty) && (
        <Flex gap={2} alignItems="center" style={{ order: parts.indexOf("status") }}>
          {status && (
            <Status size="S" showBullet={false} role="status" data-testid="page-preview-status" variant={published ? "success" : "secondary"}>
              <Typography as="span" variant="omega" fontWeight="bold">
                {formatMessage({ id: `content-manager.containers.List.${status}`, defaultMessage: status === "published" ? "Published" : "Draft" })}
              </Typography>
            </Status>
          )}
          {dirty && <Typography variant="pi" textColor="neutral600">{t.unsaved}</Typography>}
        </Flex>
      )}
      {parts.includes("actions") && actions.map((action) => (
        <span key={action.label} title={action.disabled ? action.reason : undefined} style={{ order: parts.indexOf("actions") }}>
          <Button size="S" variant={action.variant} disabled={action.disabled} loading={action.loading}
            aria-description={action.disabled ? action.reason : undefined} onClick={() => native(action.label)?.click()}>
            {action.label}
          </Button>
        </span>
      ))}
    </Flex>
  );
}
const ToggleField = ({ name, label, value, onChange, disabled }: any) => (
  <Flex gap={3}>
    <Switch
      name={name}
      aria-label={label}
      selected={Boolean(value)}
      disabled={disabled}
      onChange={() => onChange(!value)}
    />
    <Typography>{label}</Typography>
  </Flex>
);
const TextField = ({ name, label, value, onChange, disabled, placeholder }: any) => (
  <TextInput name={name} label={label} value={value} disabled={disabled} placeholder={placeholder} onChange={(e: any) => onChange(e.target.value)} />
);
const SelectField = ({
  name,
  label,
  value,
  onChange,
  disabled,
  options,
}: any) => (
  <SingleSelect
    name={name}
    label={label}
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
);
function MediaPicker({ onClose, onSelect }: any) {
  const { components }: any = useLibrary();
  const Dialog = components?.["media-library"];
  if (!Dialog) {
    onClose();
    return null;
  }
  return (
    <Dialog
      onClose={onClose}
      allowedTypes={["images"]}
      onSelectAssets={(assets: any[]) => onSelect(assets?.[0])}
    />
  );
}
function usePermissions() {
  const { allowedActions, isLoading }: any = useRBAC(permissions);
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
  />
  </Guard>
);
export default {
  register(app: any) {
    register(app, SettingsPage, "/settings/blockscene");
    // Public admin API (README "Custom sidebar panels"), as on Strapi 5.
    app.registerPlugin({ id: "blockscene", name: "Blockscene", apis: { registerPanel: (panel: any) => registerPanel(panel, ICON_NAMES) } });
  },
  registerTrads,
  bootstrap(app: any) {
    app.registerHook("Admin/CM/pages/EditView/mutate-edit-view-layout", labelsHook(() => getFetchClient().get, labelEditLayout4, dropField4));
    app.injectContentManagerComponent("editView", "right-links", {
      name: "blockscene",
      Component: () => (
        <Guard>
          <Picker />
        </Guard>
      ),
    });
  },
};
