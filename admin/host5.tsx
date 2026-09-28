import * as React from "react";
import { Button, Flex, Status, Typography } from "@strapi/design-system";
import { useIntl } from "react-intl";
import {
  DescriptionComponentRenderer,
  useFetchClient,
  useForm,
  useNotification,
  useQueryParams,
  useStrapiApp,
} from "@strapi/strapi/admin";
import {
  unstable_useContentManagerContext as useContext,
  unstable_useDocument as useDocument,
  useDocumentRBAC,
} from "@strapi/content-manager/strapi-admin";
import type { PreviewHost } from "./PagePreview";
import { useMessages } from "./messages";

// The page preview's view of a Strapi 5 edit view (public admin APIs only): the form store (useForm), the document
// RBAC and the Content Manager context.
export function usePreviewHost5(): PreviewHost {
  const c: any = useContext();
  const rbac: any = useDocumentRBAC("BlockscenePagePreview", (state: any) => state);
  const values = useForm("BlockscenePagePreview", (state: any) => state.values);
  const initialValues = useForm("BlockscenePagePreview", (state: any) => state.initialValues);
  const setValues = useForm("BlockscenePagePreview", (state: any) => state.setValues);
  const onChange = useForm("BlockscenePagePreview", (state: any) => state.onChange);
  const addFieldRow = useForm("BlockscenePagePreview", (state: any) => state.addFieldRow);
  const moveFieldRow = useForm("BlockscenePagePreview", (state: any) => state.moveFieldRow);
  const { get, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const components: any = useStrapiApp("BlockscenePagePreview", (state: any) => state.components);
  const fields = c.layout?.edit?.layout?.flat(3) || [];
  const latest = React.useRef(values);
  latest.current = values;
  const readable = React.useCallback(
    (name: string) => c.isCreatingEntry || (rbac.canReadFields || []).includes(name),
    [c.isCreatingEntry, rbac.canReadFields],
  );
  return {
    ds: 2,
    model: c.model,
    documentId: c.id,
    locale: c.form?.initialValues?.locale,
    creating: Boolean(c.isCreatingEntry),
    loading: Boolean(c.isLoading),
    disabled: Boolean(c.form?.disabled),
    contentType: c.contentType,
    components: c.components,
    values,
    history: typeof setValues === "function" ? { epoch: initialValues, setValues } : null,
    readable,
    editable: (name: string) =>
      ((c.isCreatingEntry ? rbac.canCreateFields : rbac.canUpdateFields) || []).includes(name) &&
      fields.find((f: any) => f.name === name)?.disabled !== true &&
      typeof addFieldRow === "function",
    fieldLabel: (name: string) => fields.find((f: any) => f.name === name)?.label || name,
    onChange,
    // Append then move: Strapi < 5.8.1 addFieldRow(field, value, index) overwrites the row at index instead of inserting.
    insertRows: (zone: string, at: number, items: any[]) => {
      const length = Array.isArray(latest.current?.[zone]) ? latest.current[zone].length : 0;
      items.forEach((item, i) => {
        addFieldRow(zone, item);
        if (at + i < length + i) moveFieldRow(zone, length + i, at + i);
      });
    },
    get,
    put,
    notify: (type: string, message: string) => toggleNotification({ type, message }),
    MediaLibrary: components?.["media-library"],
    useNativeBase,
    Actions,
  };
}

// Strapi's native Preview origin (when configured for this type) with `/block-preview/page` appended.
function useNativeBase(skip: boolean, model: string, documentId?: string | number, locale?: string) {
  const { get } = useFetchClient();
  const [native, setNative] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (skip || !model) return;
    let active = true;
    const query = new URLSearchParams({
      status: "draft",
      ...(documentId ? { documentId: String(documentId) } : {}),
      ...(locale ? { locale } : {}),
    });
    get(`/content-manager/preview/url/${model}?${query}`)
      .then(({ data }: any) => {
        if (active && typeof data?.data?.url === "string")
          setNative(`${new URL(data.data.url).origin}/block-preview/page`);
      })
      .catch(() => {
        if (active) setNative(null);
      });
    return () => {
      active = false;
    };
  }, [get, model, documentId, locale, skip]);
  return skip ? null : native;
}

function Actions({ parts }: { parts: string[] }) {
  const c: any = useContext();
  return (
    <ToolbarActions
      model={c.model}
      collectionType={c.collectionType}
      documentId={c.isCreatingEntry ? undefined : c.id}
      locale={c.form?.initialValues?.locale}
      parts={parts}
    />
  );
}

// Compact Save / Publish on the pane toolbar: the native document actions are
// resolved as the Entry panel resolves them (permissions, validation, dirty,
// loading, publishing) and rendered as small buttons; a click delegates to the
// native button so its dialogs and notifications are reused. No second save API.
const ACTION_TYPES = ["update", "publish"];
const nativeButtons = () =>
  document.querySelectorAll<HTMLButtonElement>(
    '#main-content button:not([data-testid="page-preview-pane"] button)',
  );
// `parts`: "status" (document state and the unsaved hint) and "actions" (Save, Publish), in the order they show.
function ToolbarActions({ model, collectionType, documentId, locale, parts }: any) {
  const plugins: any = useStrapiApp(
    "BlocksceneToolbar",
    (state: any) => state.plugins,
  );
  const [{ query }] = useQueryParams<{ status?: string }>();
  const { document: doc, meta } = useDocument(
    { model, collectionType, documentId, params: { locale } } as any,
    { skip: !documentId },
  );
  const { toggleNotification } = useNotification();
  const t = useMessages();
  const { formatMessage } = useIntl();
  const modified = useForm("BlocksceneToolbar", (state: any) => state.modified);
  // The document's state as the edit view header shows it (Draft / Modified / Published), with the same colours and
  // Content Manager labels; unsaved form changes are a separate hint.
  const status: string | undefined = documentId ? doc?.status : undefined;
  const descriptions = (
    plugins["content-manager"]?.apis?.getDocumentActions?.("panel") || []
  ).filter((d: any) => ACTION_TYPES.includes(d.type));
  const props = {
    activeTab: query.status || "draft",
    model,
    documentId,
    document: doc,
    meta,
    collectionType,
  };
  const run = async (action: any, event: React.MouseEvent) => {
    const native = [...nativeButtons()].find(
      (b) => b.textContent?.trim() === action.label,
    );
    if (native) {
      native.click();
      return;
    }
    const mute = await action.onClick?.(event);
    if (action.dialog && !mute && action.dialog.type === "notification")
      toggleNotification({
        title: action.dialog.title,
        message: action.dialog.content,
        type: action.dialog.status,
      });
  };
  // The rendered description carries no `type` on every Strapi 5 minor (5.31 omits it; its id is `<ComponentName>-<n>`),
  // so the type comes from the description component that produced it.
  const typeOf = (action: any) =>
    action.type ||
    descriptions.find(
      (d: any) =>
        typeof action.id === "string" &&
        action.id.startsWith(`${d.name || d.displayName}-`),
    )?.type;
  return (
    <DescriptionComponentRenderer props={props} descriptions={descriptions}>
      {(actions: any[]) => (
        <Flex gap={2} alignItems="center" data-testid="page-preview-actions">
          {parts.includes("status") && (status || modified) && <Flex gap={2} alignItems="center" style={{ order: parts.indexOf("status") }}>
          {status && (
            <Status size="S" role="status" data-testid="page-preview-status"
              variant={status === "draft" ? "secondary" : status === "published" ? "success" : "alternative"}>
              <Typography tag="span" variant="omega" fontWeight="bold">
                {formatMessage({ id: `content-manager.containers.List.${status}`, defaultMessage: status.charAt(0).toUpperCase() + status.slice(1) })}
              </Typography>
            </Status>
          )}
          {modified && <Typography variant="pi" textColor="neutral600">{t.unsaved}</Typography>}
          </Flex>}
          {parts.includes("actions") && [...actions]
            .sort(
              (a, b) =>
                ACTION_TYPES.indexOf(typeOf(a)) -
                ACTION_TYPES.indexOf(typeOf(b)),
            )
            .map((action) => {
              // Native semantics untouched: same disabled state as the panel button, plus an accessible reason.
              const reason = action.disabled
                ? typeOf(action) === "publish"
                  ? t.publishDisabledHint
                  : t.saveDisabledHint
                : undefined;
              return (
                <span key={action.id} title={reason} style={{ order: parts.indexOf("actions") }}>
                  <Button
                    size="S"
                    // Publish is the primary action, Save the secondary one (as in the edit view's panel).
                    variant={typeOf(action) === "publish" ? "default" : "secondary"}
                    disabled={action.disabled}
                    loading={action.loading}
                    aria-description={reason}
                    onClick={(e: React.MouseEvent) => run(action, e)}
                  >
                    {action.label}
                  </Button>
                </span>
              );
            })}
        </Flex>
      )}
    </DescriptionComponentRenderer>
  );
}

