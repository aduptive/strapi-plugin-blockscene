import * as React from "react";
import { createPortal } from "react-dom";
import styled, { useTheme } from "styled-components";
import { Box, Button, Flex, Typography } from "@strapi/design-system";
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
import { PickerModal } from "./Gallery";
import { componentDefaults, editableZones } from "./model.mjs";
import { findZoneList, toggles } from "./accordions.mjs";
import {
  PROTOCOL,
  blockKey,
  insertIndex,
  isPreviewMessage,
  mediaAttribute,
  moveGroup,
  removeGroup,
  validateGroups,
  groupRange,
  getIn,
  projectPage,
  validateEdit,
  validateFocus,
} from "./preview.mjs";
import { useMessages } from "./messages";

// Whole-page preview of the first Dynamic Zone in one iframe, docked beside
// (split) or over (preview) the native form, which stays mounted. Works with
// public Strapi 5 APIs only: no patch of the Content Manager. The frontend
// owns the page it renders; the admin validates every request from it.
type Mode = "form" | "split" | "preview";
const RATIO_KEY = "blockscene:page-split-ratio",
  DEVICE_KEY = "blockscene:page-device";
// Preview widths (CSS px). "fit" fills the pane; a device renders at its own width, scaled down when the pane is narrower.
const DEVICES = { fit: 0, mobile: 390, tablet: 834, desktop: 1440 } as const;
type Device = keyof typeof DEVICES;
const MIN_PANE = 360,
  MIN_FORM = 520,
  NARROW = 960,
  KEY_STEP = 32;
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* per-browser convenience */
  }
};
const clampWidth = (width: number, vw: number) =>
  Math.round(
    Math.min(Math.max(width, MIN_PANE), Math.max(MIN_PANE, vw - MIN_FORM)),
  );

// Positioned on the native editor content container (<main id="main-content">):
// preview mode covers exactly that area, split mode docks inside it, and both
// navigation menus stay visible whatever their width. No sidebar widths assumed.
const Pane = styled.aside`
  position: fixed;
  top: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.neutral0};
  border-left: 1px solid ${({ theme }) => theme.colors.neutral200};
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
`;
function useMainRect() {
  const [rect, setRect] = React.useState(() => ({
    left: 0,
    width: window.innerWidth,
  }));
  React.useEffect(() => {
    const main = document.getElementById("main-content");
    const measure = () => {
      const r = main?.getBoundingClientRect();
      setRect(
        r && r.width > 0
          ? { left: Math.round(r.left), width: Math.round(r.width) }
          : { left: 0, width: window.innerWidth },
      );
    };
    measure();
    const observer =
      main && "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    if (main) observer?.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return rect;
}
const Handle = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: -5px;
  width: 10px;
  cursor: col-resize;
  z-index: 3;
  touch-action: none;
  &::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 2px;
  }
  &:hover::after,
  &[data-dragging="true"]::after,
  &:focus-visible::after {
    background: ${({ theme }) => theme.colors.primary600};
  }
  &:focus-visible {
    outline: none;
  }
`;
const Frame = styled.iframe`
  position: absolute;
  top: 0;
  border: 0;
  background: white;
  transform-origin: top left;
`;
// The iframe keeps one element whatever the device: switching only changes its size and scale, never reloads the page.
function useStageSize(el: HTMLDivElement | null) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [el]);
  return size;
}
const frameStyle = (device: Device, stage: { width: number; height: number }) => {
  const width = DEVICES[device];
  if (!width || !stage.width) return { left: 0, width: "100%", height: "100%" };
  const scale = Math.min(1, stage.width / width);
  return { left: Math.max(0, (stage.width - width * scale) / 2), width, height: stage.height / scale, transform: `scale(${scale})` };
};
const SPLIT_STYLE = `
body.bp-split #main-content { padding-right: calc(var(--bp-pane, 50vw) + 1.6rem) !important; }
body.bp-split [data-bp-grid] { display: flex !important; flex-direction: column-reverse; gap: 1.6rem; }
body.bp-split [data-bp-panels] { width: 100%; }
body.bp-split [data-bp-panels] > div { flex-direction: row; flex-wrap: wrap; align-items: flex-start; gap: 1.2rem; }
body.bp-split [data-bp-panels] > div > * { flex: 1 1 24rem; }`;
// Visual editor: the block's own native form item, lifted over the preview (every field type keeps working).
const BLOCK_TOP = "calc(6vh + 5.6rem)";
const blockModalStyle = (background: string) => `
body.bp-block-modal [data-bp-block-modal] { position: fixed !important; top: ${BLOCK_TOP}; left: 50%; transform: translateX(-50%);
  width: min(96rem, 92vw); max-height: calc(88vh - 5.6rem); overflow: auto; z-index: 1001; margin: 0 !important;
  background: ${background}; border-radius: 0 0 8px 8px; box-shadow: 0 8px 32px rgba(33, 33, 52, 0.3); }
body.bp-block-modal [data-bp-block-modal]::before, body.bp-block-modal [data-bp-block-modal]::after { display: none !important; }
body.bp-block-modal [data-bp-block-modal] > div { margin: 0 !important; padding-top: 0 !important; }`;
const markLayout = (anchor: HTMLElement | null) => {
  let item: HTMLElement | null = anchor;
  while (
    item?.parentElement &&
    getComputedStyle(item.parentElement).display !== "grid"
  )
    item = item.parentElement;
  if (!item?.parentElement) return;
  item.dataset.bpPanels = "";
  item.parentElement.dataset.bpGrid = "";
};

// Preview base: the settings URL wins; otherwise Strapi's native Preview origin
// (when configured for this type) with `/block-preview` appended. A published
// page never receives unsaved values by itself: the bridge stays mandatory.
function usePreviewBase(
  override: string,
  model: string,
  documentId?: string,
  locale?: string,
) {
  const { get } = useFetchClient();
  const [native, setNative] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (override || !model) return;
    let active = true;
    const query = new URLSearchParams({
      status: "draft",
      ...(documentId ? { documentId } : {}),
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
  }, [get, model, documentId, locale, override]);
  return override
    ? { base: override, source: "custom" }
    : native
      ? { base: native, source: "native" }
      : { base: null, source: "none" };
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
function ToolbarActions({ model, collectionType, documentId, locale }: any) {
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
        <Flex gap={1} data-testid="page-preview-actions">
          {[...actions]
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
                <span key={action.id} title={reason}>
                  <Button
                    size="S"
                    variant={action.variant || "default"}
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

export function PagePreview({
  editor,
  groups = null,
  Modal,
  Toggle,
}: {
  editor: any;
  groups?: Record<string, string> | null;
  Modal: React.ComponentType<any>;
  Toggle?: React.ComponentType<any>;
}) {
  const t = useMessages();
  const c: any = useContext();
  const rbac: any = useDocumentRBAC(
    "BlockscenePagePreview",
    (state: any) => state,
  );
  const values = useForm("BlockscenePagePreview", (state: any) => state.values);
  const onChange = useForm(
    "BlockscenePagePreview",
    (state: any) => state.onChange,
  );
  const components: any = useStrapiApp(
    "BlockscenePagePreview",
    (state: any) => state.components,
  );
  const MediaLibraryDialog = components?.["media-library"];
  const addFieldRow = useForm(
    "BlockscenePagePreview",
    (state: any) => state.addFieldRow,
  );
  const moveFieldRow = useForm(
    "BlockscenePagePreview",
    (state: any) => state.moveFieldRow,
  );
  const fields = c.layout?.edit?.layout?.flat(3) || [];
  // Same zone rules as the gallery panel: the first Dynamic Zone the user may read (create: any), never a conditional one;
  // editing additionally needs the update/create permission on the field and an enabled, non-disabled form.
  const readable = (name: string) =>
    c.isCreatingEntry || (rbac.canReadFields || []).includes(name);
  const zone = React.useMemo(
    () => editableZones(c.contentType, values, readable, c.isLoading)[0]?.name,
    [c.contentType, values, c.isLoading, rbac.canReadFields, c.isCreatingEntry],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneLabel =
    fields.find((field: any) => field.name === zone)?.label || zone || "";
  const canEdit = Boolean(
    zone &&
    (
      (c.isCreatingEntry ? rbac.canCreateFields : rbac.canUpdateFields) || []
    ).includes(zone) &&
    fields.find((field: any) => field.name === zone)?.disabled !== true &&
    !c.form?.disabled &&
    typeof addFieldRow === "function",
  );
  // Every edit view opens in the configured mode (per content type, else global); a switch lasts for this view only.
  const [mode, setMode] = React.useState<Mode>(() => editor?.previewMode || "form");
  const [device, setDeviceState] = React.useState<Device>(() => {
    const v = read(DEVICE_KEY);
    return v && v in DEVICES ? (v as Device) : "fit";
  });
  const setDevice = (next: Device) => {
    setDeviceState(next);
    write(DEVICE_KEY, next);
  };
  // Callback ref: the pane mounts only while the preview is active.
  const [stage, setStage] = React.useState<HTMLDivElement | null>(null);
  const stageSize = useStageSize(stage);
  const [ratio, setRatio] = React.useState<number>(() => {
    const v = Number(read(RATIO_KEY));
    return v > 0 && v < 1 ? v : 0.5;
  });
  const main = useMainRect();
  const vw = main.width; // editor content area, not the viewport
  const [dragging, setDragging] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [attempt, retry] = React.useReducer((n: number) => n + 1, 0);
  const [picking, setPicking] = React.useState<any>(null);
  // Another document or locale: every pending dialog of the previous one is dropped (a stale modal must never write into the new form).
  React.useEffect(() => {
    setPicking(null);
    setInserting(null);
    setBlockModal(null);
  }, [c.id, c.form?.initialValues?.locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const [blockModal, setBlockModal] = React.useState<{ index: number; field?: string } | null>(null);
  const theme: any = useTheme();
  const [inserting, setInserting] = React.useState<{
    after: string | null;
  } | null>(null);
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const zoneAttr: any = zone ? c.contentType?.attributes?.[zone] : null;
  const iframe = React.useRef<HTMLIFrameElement>(null);
  const loaded = React.useRef(false);
  const anchor = React.useRef<HTMLDivElement>(null);
  const channel = React.useMemo(() => crypto.randomUUID(), []);
  const { base, source } = usePreviewBase(
    editor?.previewUrl || "",
    c.model,
    c.isCreatingEntry ? undefined : c.id,
    c.form?.initialValues?.locale,
  );
  // The settings URL is the full page-preview route; only the channel is appended.
  const url = base ? new URL(base) : null;
  url?.searchParams.set("channel", channel);
  const origin = url?.origin || "";
  const narrow = vw < NARROW;
  const paneWidth = clampWidth(ratio * vw, vw);
  const resizable = mode === "split" && !narrow;
  const active = mode !== "form" && Boolean(url) && Boolean(zone);
  const rows: any[] = zone && Array.isArray(values?.[zone]) ? values[zone] : [];
  const latest = React.useRef(rows);
  latest.current = rows;
  // Append then move: Strapi < 5.8.1 addFieldRow(field, value, index) overwrites the row at index instead of inserting.
  const insertRows = (at: number, ...items: any[]) =>
    items.forEach((item, i) => {
      const from = latest.current.length + i;
      addFieldRow(zone, item);
      if (at + i < from) moveFieldRow(zone, from, at + i);
    });
  // Refs keep the message listener tied to one iframe instance: mode changes and late loads never reset readiness.
  const live = React.useRef({
    mode,
    canEdit,
    zoneLabel,
    components: c.components,
    setMode,
    onChange,
  });
  live.current = {
    mode,
    canEdit,
    zoneLabel,
    components: c.components,
    setMode,
    onChange,
  };

  const send = React.useCallback(() => {
    iframe.current?.contentWindow?.postMessage(
      {
        protocol: PROTOCOL,
        channel,
        type: "update-page",
        blocks: projectPage(
          latest.current,
          live.current.components,
          window.location.origin,
        ),
        groups,
        locale: t.locale,
        mode: live.current.mode,
      },
      origin,
    );
  }, [channel, origin]);
  const indexOf = (key: string) =>
    latest.current.findIndex((row) => blockKey(row) === key);
  const path = (key: string, field: string) =>
    `${zone}.${indexOf(key)}.${field}`;

  React.useEffect(() => {
    if (resizable) markLayout(anchor.current);
    document.body.classList.toggle("bp-split", resizable);
    document.documentElement.style.setProperty("--bp-pane", `${paneWidth}px`);
    return () => document.body.classList.remove("bp-split");
  }, [resizable, paneWidth]);
  const applyWidth = (width: number, persist: boolean) => {
    const next = clampWidth(width, vw) / vw;
    setRatio(next);
    if (persist) write(RATIO_KEY, String(next));
  };

  // Reveal a field in the native form (used for types the modal cannot edit).
  const focusField = (index: number, field: string) => {
    const item = findZoneList(live.current.zoneLabel)?.querySelectorAll(
      ":scope > li",
    )[index] as HTMLElement | undefined;
    if (!item) return;
    const header = toggles(item.parentElement as HTMLElement)[index];
    if (header?.getAttribute("aria-expanded") === "false") header.click();
    const parts = field.split(".");
    const escaped = CSS.escape(`${zone}.${index}.${field}`);
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 40) return clearInterval(timer);
      let scope: HTMLElement = item;
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const nested = [
          ...scope.querySelectorAll<HTMLButtonElement>(
            "button[aria-expanded][data-radix-collection-item]",
          ),
        ].filter((b) => b !== header);
        const row = nested[Number(parts[i + 1])];
        if (!row) return;
        if (row.getAttribute("aria-expanded") === "false") row.click();
        scope = (row.closest("li, div") as HTMLElement) || scope;
      }
      // Native inputs carry name=path; custom fields (CKEditor) only expose label[for=path], and the editable is a
      // sibling subtree a few levels up (its depth differs between plugin versions), created asynchronously.
      const target = document.querySelector<HTMLElement>(
        `[name="${escaped}"], label[for="${escaped}"]`,
      );
      if (!target) return;
      const INPUT =
        '.ck-editor__editable, textarea, input:not([type="hidden"]), select';
      let container: HTMLElement | null = target.matches(INPUT)
        ? target
        : target.parentElement;
      for (
        let depth = 0;
        container &&
        depth < 4 &&
        !container.matches(INPUT) &&
        !container.querySelector(INPUT);
        depth++
      )
        container = container.parentElement;
      // CKEditor also renders a hidden helper input (.ck-hidden): prefer its editable, and never a field that is not rendered.
      const editable = container?.matches(INPUT)
        ? container
        : container?.querySelector<HTMLElement>(".ck-editor__editable") ||
          [...(container?.querySelectorAll<HTMLElement>(INPUT) || [])].find((el) => el.getClientRects().length > 0);
      if (!editable) return;
      if (
        editable.classList.contains("ck-editor__editable") &&
        !editable.isContentEditable
      )
        return;
      editable.focus();
      if (document.activeElement !== editable) return;
      clearInterval(timer);
      editable.scrollIntoView({ block: "center", behavior: "smooth" });
      // The field clicked in the page stays marked for a moment so it is found at a glance.
      const mark = (container && container !== editable ? container : editable) as HTMLElement;
      mark.style.outline = "2px solid #4945ff";
      mark.style.outlineOffset = "4px";
      setTimeout(() => {
        mark.style.outline = "";
        mark.style.outlineOffset = "";
      }, 2500);
    }, 150);
  };

  const blockLabel = (index: number) => {
    const uid = latest.current[index]?.__component;
    return c.components?.[uid]?.info?.displayName || uid || "";
  };
  // Lift the block's native form item over the preview; the field clicked in the page gets focus. Esc, the backdrop
  // or Done put it back. Escape is left to any dialog opened from inside the block (Media Library, CKEditor).
  React.useEffect(() => {
    if (mode !== "preview" || !active) setBlockModal(null);
  }, [mode, active]);
  React.useEffect(() => {
    if (!blockModal) return;
    const item = findZoneList(live.current.zoneLabel)?.querySelectorAll(":scope > li")[blockModal.index] as HTMLElement | undefined;
    if (!item) {
      setBlockModal(null);
      return;
    }
    const header = toggles(item.parentElement as HTMLElement)[blockModal.index];
    if (header?.getAttribute("aria-expanded") === "false") header.click();
    item.setAttribute("data-bp-block-modal", "");
    document.body.classList.add("bp-block-modal");
    // Focus leaves the iframe either way, so Escape reaches this document. Deferred: the page still owns focus while
    // its click finishes (a site adapter may place the caret there), and would take it back from an immediate focus().
    const later = setTimeout(() => {
      if (blockModal.field) focusField(blockModal.index, blockModal.field);
      else document.querySelector<HTMLElement>('[data-testid="block-modal-done"]')?.focus();
    }, 250);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]:not([data-testid="block-modal-bar"])')) setBlockModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(later);
      item.removeAttribute("data-bp-block-modal");
      document.body.classList.remove("bp-block-modal");
      document.removeEventListener("keydown", onKey);
    };
  }, [blockModal]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!active) return;
    setReady(false);
    setFailed(false);
    const timeout = setTimeout(() => setFailed(true), 15000);
    const receive = (event: MessageEvent) => {
      const is = (type: string) =>
        isPreviewMessage(
          event,
          origin,
          iframe.current?.contentWindow,
          channel,
          type,
        );
      const { mode, canEdit, zoneLabel, components, setMode, onChange } =
        live.current;
      if (is("ready")) {
        clearTimeout(timeout);
        setReady(true);
        setFailed(false);
        send();
        return;
      }
      if (is("insert") && canEdit) {
        const after =
          event.data.after === null || event.data.after === undefined
            ? null
            : String(event.data.after);
        if (after !== null && insertIndex(latest.current, after) < 0) return;
        if (latest.current.length >= (zoneAttr?.max ?? Infinity)) {
          toggleNotification({ type: "info", message: t.zoneFull });
          return;
        }
        setInserting({ after });
        return;
      }
      if (is("move-group") && canEdit && groups) {
        // The whole OPEN…CLOSE range swaps with its top-level neighbour: same rows, same keys, unsaved values kept.
        const next = moveGroup(
          latest.current,
          String(event.data.key),
          event.data.direction === "up" ? "up" : "down",
          groups,
        );
        if (next) onChange(zone!, next);
        return;
      }
      if (is("delete-group") && canEdit && groups) {
        const next = removeGroup(
          latest.current,
          String(event.data.key),
          groups,
        );
        if (next) onChange(zone!, next);
        return;
      }
      if (is("insert-group") && canEdit && groups) {
        // OPEN and its CLOSE land together in the same unsaved form change (an empty group); children go between them.
        const after =
          event.data.after === null || event.data.after === undefined
            ? null
            : String(event.data.after);
        const index = insertIndex(latest.current, after);
        const uid = String(event.data.uid || "");
        const close = groups[uid];
        const allowed = zoneAttr?.components || [];
        if (
          index < 0 ||
          !close ||
          !allowed.includes(uid) ||
          !allowed.includes(close)
        )
          return;
        if (latest.current.length + 2 > (zoneAttr?.max ?? Infinity)) {
          toggleNotification({ type: "info", message: t.zoneFull });
          return;
        }
        insertRows(
          index,
          {
            ...componentDefaults(components[uid], components),
            __component: uid,
          },
          { __component: close },
        );
        return;
      }
      const key = typeof event.data?.key === "string" ? event.data.key : "";
      const index = key ? indexOf(key) : -1;
      const uid = index >= 0 ? latest.current[index]?.__component : "";
      if (index < 0) return;
      if (is("select")) {
        const list = findZoneList(zoneLabel);
        const item = list?.querySelectorAll(":scope > li")[index] as
          | HTMLElement
          | undefined;
        const header = list ? toggles(list)[index] : null;
        if (header?.getAttribute("aria-expanded") === "false") header.click();
        item?.scrollIntoView({ block: "center", behavior: "smooth" });
        if (item) {
          item.style.outline = "2px solid #4945ff";
          setTimeout(() => {
            item.style.outline = "";
          }, 1500);
        }
        if (mode === "preview" && canEdit) setBlockModal({ index });
        else if (mode === "preview") setMode("split");
        iframe.current?.contentWindow?.postMessage(
          { protocol: PROTOCOL, channel, type: "highlight", key },
          origin,
        );
      } else if (is("focus")) {
        const attr = validateFocus(uid, event.data.field, components);
        if (!attr) return;
        // Mode-aware: the visual editor opens the whole block with this field focused; side by side focuses it on the left.
        if (mode === "preview" && canEdit) setBlockModal({ index, field: event.data.field });
        else focusField(index, event.data.field);
      } else if (is("media") && canEdit) {
        const attr = mediaAttribute(uid, event.data.field, components);
        if (attr) setPicking({ key, field: event.data.field, attr });
      } else if (is("media-remove") && canEdit) {
        const attr = mediaAttribute(uid, event.data.field, components);
        if (attr && !attr.required) onChange(path(key, event.data.field), null);
      } else if (is("edit") && canEdit) {
        const value = validateEdit(
          uid,
          event.data.field,
          event.data.value,
          components,
        );
        if (value !== null) onChange(path(key, event.data.field), value);
      }
    };
    window.addEventListener("message", receive);
    if (loaded.current)
      iframe.current?.contentWindow?.postMessage(
        { protocol: PROTOCOL, channel, type: "ping" },
        origin,
      );
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [active, attempt, channel, origin, groups]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!ready || !active) return;
    const timer = setTimeout(send, 120);
    return () => clearTimeout(timer);
  }, [values, c.components, ready, active, send, mode]); // mode travels with the update

  if (!zone) return null;
  const modes: Array<[Mode, string]> = [
    ["form", t.modeForm],
    ["split", t.modeSplit],
    ["preview", t.modePreview],
  ];
  const switcher = (
    <Flex
      gap={1}
      wrap="wrap"
      data-testid="page-preview-modes"
      role="group"
      aria-label={t.modeGroup}
    >
      {modes.map(([value, label]) => (
        <Button
          key={value}
          type="button"
          size="S"
          variant={mode === value ? "default" : "tertiary"}
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
          disabled={!url && value !== "form"}
        >
          {label}
        </Button>
      ))}
    </Flex>
  );
  const devices = (
    <Flex gap={1} wrap="wrap" data-testid="page-preview-devices" role="group" aria-label={t.deviceGroup}>
      {(Object.keys(DEVICES) as Device[]).map((value) => (
        <Button
          key={value}
          type="button"
          size="S"
          variant={device === value ? "secondary" : "tertiary"}
          aria-pressed={device === value}
          onClick={() => setDevice(value)}
          title={DEVICES[value] ? `${DEVICES[value]} px` : undefined}
        >
          {t.device[value]}
        </Button>
      ))}
    </Flex>
  );
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = {
      ArrowLeft: paneWidth + KEY_STEP,
      ArrowRight: paneWidth - KEY_STEP,
      Home: MIN_PANE,
      End: vw - MIN_FORM,
    };
    if (event.key in map) {
      event.preventDefault();
      applyWidth(map[event.key], true);
    }
  };
  // Configured pairs are only diagnosed here (never repaired on load); the server refuses publishing while they exist.
  // Compact: one summary line always visible, details on demand, and an explicit repair action for a missing close.
  const problems = groups ? validateGroups(rows, groups) : [];
  const insertClose = (error: any) => {
    const end = groupRange(latest.current, error.index, groups!)[1];
    insertRows(end + 1, { __component: error.expected });
  };
  const diagnostics = problems.length > 0 && (
    <Box
      role="alert"
      data-testid="page-preview-diagnostics"
      padding={2}
      background="danger100"
      hasRadius
    >
      <details>
        <summary style={{ cursor: "pointer" }}>
          <Typography variant="pi" fontWeight="bold" textColor="danger700">
            {t.f("diagSummary", { count: problems.length })}
          </Typography>
        </summary>
        <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
          {problems.map((error: any) => (
            <li
              key={`${error.code}-${error.index}`}
              style={{ marginBottom: 6 }}
            >
              <Typography variant="pi" textColor="danger700">
                {t.f(
                  error.code === "closeBeforeOpen"
                    ? "diagCloseBeforeOpen"
                    : error.code === "mismatch"
                      ? "diagMismatch"
                      : "diagUnclosed",
                  {
                    n: error.index + 1,
                    uid: error.uid,
                    open: error.open || "",
                    expected: error.expected || "",
                  },
                )}
              </Typography>
              {error.code === "unclosed" && canEdit && (
                <Box paddingTop={1}>
                  <Button
                    size="S"
                    variant="danger-light"
                    data-testid={`diag-insert-close-${error.index}`}
                    onClick={() => insertClose(error)}
                  >
                    {t.f("diagInsertClose", {
                      n: error.index + 1,
                      expected: error.expected,
                    })}
                  </Button>
                </Box>
              )}
              {error.code === "closeBeforeOpen" && (
                <Typography variant="pi" textColor="neutral600">
                  {t.diagStrayHint}
                </Typography>
              )}
            </li>
          ))}
        </ul>
      </details>
    </Box>
  );
  return (
    <Flex direction="column" alignItems="stretch" gap={2} ref={anchor}>
      {switcher}
      {diagnostics}
      <Typography variant="pi" textColor="neutral600">
        {url ? t.previewHelp : t.previewNoUrl}
      </Typography>
      {active &&
        createPortal(
          <Pane
            data-testid="page-preview-pane"
            aria-label={t.previewPane}
            style={{
              left:
                mode === "preview" || narrow
                  ? main.left
                  : main.left + main.width - paneWidth,
              width: mode === "preview" || narrow ? main.width : paneWidth,
              userSelect: dragging ? "none" : undefined,
            }}
          >
            <style>{SPLIT_STYLE}</style>
            {resizable && (
              <Handle
                role="separator"
                aria-orientation="vertical"
                aria-label={t.resize}
                tabIndex={0}
                aria-valuemin={MIN_PANE}
                aria-valuemax={Math.max(MIN_PANE, vw - MIN_FORM)}
                aria-valuenow={paneWidth}
                data-testid="page-preview-resizer"
                data-dragging={dragging}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(true);
                }}
                onPointerMove={(e) => {
                  if (dragging)
                    applyWidth(main.left + main.width - e.clientX, false);
                }}
                onPointerUp={(e) => {
                  if (!dragging) return;
                  setDragging(false);
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  applyWidth(main.left + main.width - e.clientX, true);
                }}
                onPointerCancel={() => setDragging(false)}
                onKeyDown={onKey}
              />
            )}
            {/* Compact sticky header: mode control left; status, then native Save and Publish grouped right. */}
            <Flex
              padding={2}
              gap={2}
              justifyContent="space-between"
              alignItems="center"
              background="neutral100"
              wrap="wrap"
              style={{ position: "sticky", top: 0, zIndex: 2 }}
            >
              {switcher}
              {devices}
              <Flex
                gap={2}
                alignItems="center"
                wrap="wrap"
                style={{ marginLeft: "auto" }}
              >
                <Typography variant="pi" role="status" textColor="neutral600">
                  {failed
                    ? t.previewFailed
                    : ready
                      ? t.previewReady
                      : t.previewLoading}
                </Typography>
                {failed && (
                  <Button size="S" variant="secondary" onClick={retry}>
                    {t.retry}
                  </Button>
                )}
                <ToolbarActions
                  model={c.model}
                  collectionType={c.collectionType}
                  documentId={c.isCreatingEntry ? undefined : c.id}
                  locale={c.form?.initialValues?.locale}
                />
              </Flex>
            </Flex>
            <div ref={setStage} data-testid="page-preview-stage" data-device={device}
              style={{ position: "relative", flex: 1, overflow: "hidden", background: device === "fit" ? undefined : "#eaeaef" }}>
              <Frame
                key={attempt}
                ref={iframe}
                title={t.previewPane}
                src={url!.href}
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  loaded.current = true;
                }}
                style={{ ...frameStyle(device, stageSize), ...(dragging ? { pointerEvents: "none" } : {}) }}
              />
            </div>
          </Pane>,
          document.body,
        )}
      {inserting && zoneAttr && (
        <PickerModal
          zone={{
            name: zone,
            components: zoneAttr.components || [],
            max: zoneAttr.max,
          }}
          components={c.components}
          Modal={Modal}
          Toggle={Toggle}
          get={get}
          open
          onOpenChange={(open: boolean) => {
            if (!open) setInserting(null);
          }}
          onSelect={(uid: string) => {
            // Resolved now, not when the gap was clicked: reorders in between are respected.
            const index = insertIndex(latest.current, inserting.after);
            setInserting(null);
            const close = groups?.[uid];
            // Zero mutation unless the whole operation fits: position still valid, uid (and its CLOSE) allowed, room for both rows.
            if (
              index < 0 ||
              !(zoneAttr.components || []).includes(uid) ||
              (close && !(zoneAttr.components || []).includes(close)) ||
              latest.current.length + (close ? 2 : 1) >
                (zoneAttr.max ?? Infinity)
            ) {
              toggleNotification({
                type: "warning",
                message: close ? t.zoneFull : t.insertMoved,
              });
              return;
            }
            // A configured OPEN chosen from the seam picker brings its CLOSE too (same rule as the gallery and "+ Group").
            insertRows(
              index,
              {
                ...componentDefaults(c.components[uid], c.components),
                __component: uid,
              },
              ...(close ? [{ __component: close }] : []),
            );
          }}
        />
      )}
      {blockModal &&
        createPortal(
          <>
            <style>{blockModalStyle(theme?.colors?.neutral0 || "#fff")}</style>
            <div data-testid="block-modal-backdrop" onClick={() => setBlockModal(null)}
              style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(33, 33, 52, 0.45)" }} />
            <Flex data-testid="block-modal-bar" role="dialog" aria-label={blockLabel(blockModal.index)} background="neutral100"
              paddingLeft={4} paddingRight={4} justifyContent="space-between" alignItems="center"
              style={{ position: "fixed", top: "6vh", left: "50%", transform: "translateX(-50%)", width: "min(96rem, 92vw)",
                height: "5.6rem", zIndex: 1001, borderRadius: "8px 8px 0 0", boxShadow: "0 8px 32px rgba(33, 33, 52, 0.3)" }}>
              <Typography variant="delta" tag="h2">{blockLabel(blockModal.index)}</Typography>
              <Button size="S" onClick={() => setBlockModal(null)} data-testid="block-modal-done">{t.blockModalDone}</Button>
            </Flex>
          </>,
          document.body,
        )}
      {picking && MediaLibraryDialog && (
        <MediaLibraryDialog
          allowedTypes={picking.attr.allowedTypes || ["images"]}
          multiple={picking.attr.multiple === true}
          onClose={() => setPicking(null)}
          onSelectAssets={(assets: any[]) => {
            const index = indexOf(picking.key);
            setPicking(null);
            if (index < 0 || !assets?.length) return;
            const current = getIn(latest.current[index], picking.field);
            onChange(
              `${zone}.${index}.${picking.field}`,
              picking.attr.multiple
                ? [...(Array.isArray(current) ? current : []), ...assets]
                : assets[0],
            );
          }}
        />
      )}
      <Box
        hidden
        data-testid="page-preview-state"
        data-mode={mode}
        data-ready={ready}
        data-failed={failed}
        data-preview-source={source}
      />
    </Flex>
  );
}
