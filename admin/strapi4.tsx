import * as React from "react";
import {
  MenuItem,
  SimpleMenu,
  ModalLayout,
  ModalHeader,
  ModalBody,
  Typography,
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
import { Gallery } from "./Gallery";
import { Settings, permissions, register } from "./Settings";
import { editableZones, canInsert, labelEditLayout4, dropField4 } from "./model.mjs";
import { cloneRow, errorRows, integerKeys } from "./rows.mjs";
import { useCatalog, labelsHook } from "./catalog";
import { registerTrads } from "./messages";
import { Guard } from "./Guard";
import { Icon } from "./icons";

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
  ).map((zone) => ({
    ...zone,
    // The rendered label: the edit layout's (field labels may have rewritten it), else the stored metadata.
    label: schema?.layouts?.edit?.flat().find((field: any) => field?.name === zone.name)?.metadatas?.label ||
      schema?.metadatas?.[zone.name]?.edit?.label || zone.name,
  }));
  const add = (zone: any, uid: string) => {
    const close = catalog?.groups?.[uid];
    if (
      !canInsert(zone, uid, c.modifiedData, components, close ? 2 : 1) ||
      (close && !zone.components.includes(close))
    )
      return false;
    c.addComponentToDynamicZone(
      zone.name,
      components[uid],
      components,
      Boolean(c.formErrors?.[zone.name]),
    );
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
  // Nothing shows here: the zone bars and row tools are portalled into the form, the gallery opens from the native add button.
  return (
    <div hidden data-blockscene-editor="">
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
    />
    </div>
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
    previewSupported={false}
  />
  </Guard>
);
export default {
  register(app: any) {
    register(app, SettingsPage, "/settings/blockscene");
    app.registerPlugin({ id: "blockscene", name: "Blockscene" });
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
