import * as React from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { Button, Flex, Typography } from "@strapi/design-system";
import { findZoneList, toggles } from "./accordions.mjs";
import { blockKey } from "./preview.mjs";
import {
  CLIPBOARD_KEY,
  actionRange,
  canAct,
  expandSelection,
  insertRows,
  isGroupMarker,
  pasteProblem,
  readClip,
  setHidden,
  writeClip,
} from "./rows.mjs";
import { useMessages } from "./messages";
import { Icon } from "./icons";

// Row actions in each native block header, right before Strapi's own delete button: hide on the site, duplicate,
// copy, and a confirmation in front of the native delete; in selection mode a checkbox opens the header. The same DOM
// approach as the row thumbnails: inert <span>s in the header, React portals into them. Every change goes through the form.
// ponytail: DOM injection; drop it if Strapi ever exposes a row actions slot.
export type RowForm = {
  rows: (zone: string) => any[];
  setRows: (zone: string, rows: any[]) => void;
  // Indexes of the zone's rows with a validation error (a folded layout group around one unfolds).
  errorRows?: (zone: string) => number[];
  keys: (rows: any[], at: number, n: number) => any[];
  // Deep copies ready to be inserted as new rows (ids stripped, relations in the new-row shape).
  prepare: (rows: any[]) => Promise<any[]>;
  notify: (type: "success" | "info" | "warning", message: string) => void;
  model: string;
  locale?: string;
};
const ATTR = "data-blockscene-row-actions";
const SELECT_ATTR = "data-blockscene-row-select";
const HIDDEN_ATTR = "data-blockscene-hidden";
const CLIP_EVENT = "blockscene:clipboard";
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
// The clipboard as React state: other tabs through the storage event, this tab through a custom one.
export function useClipboard() {
  const [clip, setClip] = React.useState(() => readClip(storage()));
  React.useEffect(() => {
    const sync = (event: any) => {
      if (!event?.key || event.key === CLIPBOARD_KEY) setClip(readClip(storage()));
    };
    window.addEventListener("storage", sync);
    window.addEventListener(CLIP_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CLIP_EVENT, sync);
    };
  }, []);
  return clip;
}
const storeClip = (data: any) => {
  const ok = writeClip(storage(), data);
  if (ok) window.dispatchEvent(new Event(CLIP_EVENT));
  return ok;
};
// All or nothing, with a notice naming why nothing was pasted. `at` defaults to the end of the zone.
export function pasteInto(form: RowForm, zone: any, clip: any, components: any, groups: any, t: any, at?: number) {
  const rows = form.rows(zone.name);
  const problem = pasteProblem(clip, zone, rows, components, groups);
  if (problem) {
    form.notify("warning", t.f(problem.code === "notAllowed" ? "pasteNotAllowed" : problem.code === "full" ? "pasteFull" : "pasteUnbalanced",
      { uid: problem.uid || "", count: clip?.rows?.length || 0 }));
    return false;
  }
  const index = at ?? rows.length;
  form.setRows(zone.name, insertRows(rows, index, clip.rows, form.keys(rows, index, clip.rows.length)));
  form.notify("success", t.f("pasted", { count: clip.rows.length }));
  return true;
}

// The native delete of a row: the first button of the actions next to its accordion trigger (DS1 and DS2).
const actionsOf = (toggle: HTMLElement) => toggle.nextElementSibling as HTMLElement | null;
const trashOf = (toggle: HTMLElement) =>
  [...(actionsOf(toggle)?.querySelectorAll<HTMLElement>("button") || [])].find((b) => !b.closest(`[${ATTR}]`)) || null;
// In selection mode each row of that zone also gets a checkbox holder at the start of its header, before the toggle.
type Anchor = { el: HTMLElement; select: HTMLElement | null; zone: string; index: number };
function useAnchors(zones: any[], enabled: boolean, selecting: string | null) {
  const [anchors, setAnchors] = React.useState<Anchor[]>([]);
  const latest = React.useRef({ zones, selecting });
  latest.current = { zones, selecting };
  const sync = React.useRef(() => {});
  sync.current = () => {
    const next: Anchor[] = [];
    if (enabled)
      for (const zone of latest.current.zones) {
        const list = zone.count ? findZoneList(zone.label) : null;
        if (!list) continue;
        toggles(list).forEach((toggle: HTMLElement, index: number) => {
          const trash = trashOf(toggle);
          if (!trash || index >= zone.count) return; // read-only rows have no actions
          // DS1 wraps each action in its own <span>: insert before that wrapper, inside the flex row.
          const holder = trash.parentElement !== actionsOf(toggle) && trash.parentElement?.children.length === 1 ? trash.parentElement : trash;
          let el = holder.parentElement?.querySelector(`:scope > [${ATTR}]`) as HTMLElement | null;
          if (!el) {
            el = document.createElement("span");
            el.setAttribute(ATTR, "");
            el.style.cssText = "display:inline-flex;align-items:center";
            holder.parentElement?.insertBefore(el, holder);
          }
          let select: HTMLElement | null = null;
          if (latest.current.selecting === zone.name && toggle.parentElement) {
            select = toggle.parentElement.querySelector(`:scope > [${SELECT_ATTR}]`);
            if (!select) {
              select = document.createElement("span");
              select.setAttribute(SELECT_ATTR, "");
              select.style.cssText = "display:inline-flex;align-items:center;padding-left:12px";
              toggle.parentElement.insertBefore(select, toggle);
            }
          }
          next.push({ el, select, zone: zone.name, index });
        });
      }
    for (const attr of [ATTR, SELECT_ATTR])
      for (const el of document.querySelectorAll<HTMLElement>(`[${attr}]`)) if (!next.some((a) => a.el === el || a.select === el)) el.remove();
    setAnchors((prev) =>
      prev.length === next.length && prev.every((a, i) => a.el === next[i].el && a.select === next[i].select && a.zone === next[i].zone && a.index === next[i].index) ? prev : next,
    );
  };
  React.useEffect(() => {
    sync.current();
  });
  React.useEffect(() => {
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync.current(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const el of document.querySelectorAll(`[${ATTR}], [${SELECT_ATTR}]`)) el.remove();
      for (const el of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) el.removeAttribute(HIDDEN_ATTR);
    };
  }, []);
  return anchors;
}

// State and actions shared by the header tools and the zone label tools. null without a form adapter.
export function useRowActions({ zones, components, catalog, form }: any) {
  const t = useMessages();
  const clip = useClipboard();
  const [selection, setSelection] = React.useState<{ zone: string; keys: string[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Escape leaves selection mode (a dialog open over the form keeps its own Escape).
  React.useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) setSelection(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [Boolean(selection)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!form) return null;
  const editor = catalog?.editor || {};
  const groups = catalog?.groups || null;
  const hiddenName: string | null = editor.hiddenBlocks !== "off" ? catalog?.hiddenAttribute || null : null;
  const zoneOf = (name: string) => zones.find((z: any) => z.name === name);
  const labelOf = (row: any) => catalog?.components?.[row?.__component]?.label || components?.[row?.__component]?.info?.displayName || row?.__component || "";
  // Async copies (relations are read from the server) re-resolve the row by its key afterwards: the list may have moved.
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch {
      form.notify("warning", t.rowActionFailed);
    } finally {
      setBusy(false);
    }
  };
  const duplicate = (zoneName: string, index: number) => run(async () => {
    const zone = zoneOf(zoneName);
    const rows = form.rows(zoneName);
    const key = blockKey(rows[index]);
    const [start, end] = actionRange(rows, index, groups);
    if (rows.length + end - start + 1 > (zone?.max ?? Infinity)) return form.notify("warning", t.zoneFull);
    const items = await form.prepare(rows.slice(start, end + 1));
    const now = form.rows(zoneName);
    const at = now.findIndex((row: any) => blockKey(row) === key);
    if (at < 0) return;
    const after = actionRange(now, at, groups)[1] + 1;
    form.setRows(zoneName, insertRows(now, after, items, form.keys(now, after, items.length)));
  });
  const copy = (zoneName: string, keys: string[]) => run(async () => {
    const rows = form.rows(zoneName);
    const indexes = expandSelection(rows, keys.map((key) => rows.findIndex((row: any) => blockKey(row) === key)), groups);
    if (!indexes.length) return;
    const items = await form.prepare(indexes.map((i) => rows[i]));
    if (!storeClip({ rows: items, model: form.model, locale: form.locale, zone: zoneName })) return form.notify("warning", t.copyFailed);
    setSelection(null);
    form.notify("success", t.f("copied", { count: items.length }));
  });
  const toggleHidden = (zoneName: string, index: number) => {
    const rows = form.rows(zoneName);
    if (hiddenName) form.setRows(zoneName, setHidden(rows, index, groups, hiddenName, rows[index]?.[hiddenName] !== true));
  };
  const paste = (zoneName: string, at?: number) => pasteInto(form, zoneOf(zoneName), clip, components, groups, t, at);
  // Paste is offered where the copied components are allowed; room and group balance are still checked on click, with feedback.
  const pastable = (zoneName: string) => !["empty", "notAllowed"].includes(pasteProblem(clip, zoneOf(zoneName), form.rows(zoneName), components, groups)?.code);
  const selectable = (zoneName: string): string[] => form.rows(zoneName).filter((row: any) => canAct(row, groups)).map((row: any) => blockKey(row)).filter(Boolean);
  return { t, editor, groups, hiddenName, clip, selection, setSelection, busy, form, labelOf, duplicate, copy, toggleHidden, paste, pastable, selectable, isMarker: (row: any) => isGroupMarker(row, groups) };
}

const RowButton = styled.button<{ $on?: boolean }>`
  display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0;
  border-radius: 4px; cursor: pointer; background: transparent;
  color: ${({ theme, $on }) => ($on ? theme.colors.warning600 : theme.colors.neutral500)};
  &:hover:not(:disabled) { background: ${({ theme }) => theme.colors.neutral100}; color: ${({ theme }) => theme.colors.neutral800}; }
  &:disabled { opacity: 0.4; cursor: default; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: -2px; }
`;
const HiddenBadge = styled.span`
  margin-right: 4px; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; line-height: 16px;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.warning700}; background: ${({ theme }) => theme.colors.warning100};
`;

export function RowActions({ zones, actions, Modal }: any) {
  const a = actions;
  const e = a?.editor || {};
  const anchors = useAnchors(zones, Boolean(a) && Boolean(a.hiddenName || e.duplicate !== false || e.clipboard !== false || a.selection), a?.selection?.zone || null);
  const [confirm, setConfirm] = React.useState<{ button: HTMLElement; label: string; marker: boolean } | null>(null);
  const bypass = React.useRef(false);
  const latest = React.useRef({ zones, a });
  latest.current = { zones, a };
  // Capture phase on the document: the native handler (React's root listener) never sees the first click.
  React.useEffect(() => {
    if (!a || e.confirmDelete === false) return;
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest?.("button");
      if (!button || bypass.current) return;
      for (const zone of latest.current.zones) {
        const list = findZoneList(zone.label);
        if (!list?.contains(button)) continue;
        const headers = toggles(list) as HTMLElement[];
        const index = headers.findIndex((toggle) => trashOf(toggle) === button);
        if (index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const row = latest.current.a?.form.rows(zone.name)[index];
        setConfirm({ button, label: headers[index].textContent?.trim() || latest.current.a?.labelOf(row), marker: Boolean(latest.current.a?.isMarker(row)) });
        return;
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [Boolean(a), e.confirmDelete]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hidden rows are dimmed in the form (their header), with a badge next to the eye.
  React.useEffect(() => {
    if (!a) return;
    for (const { el, zone, index } of anchors) {
      const li = el.closest("li");
      const hidden = Boolean(a.hiddenName) && a.form.rows(zone)[index]?.[a.hiddenName] === true;
      if (li) hidden ? li.setAttribute(HIDDEN_ATTR, "") : li.removeAttribute(HIDDEN_ATTR);
    }
  });
  if (!a) return null;
  const { t } = a;
  const confirmDelete = () => {
    const target = confirm?.button;
    setConfirm(null);
    if (!target?.isConnected) return;
    bypass.current = true;
    try {
      target.click();
    } finally {
      bypass.current = false;
    }
  };
  return (
    <>
      {/* DS1 (Strapi 4) row headers: the toggle shrinks but its content does not, so in a narrow form (split mode) the
          thumbnail and title ran under these tools. The toggle now clips, the row thumbnail gives way first and the title
          keeps its own ellipsis. */}
      <style>{`li[${HIDDEN_ATTR}] button[aria-expanded] { opacity: 0.5; }
ol[aria-describedby] > li button[data-strapi-accordion-toggle] { overflow: hidden; }
ol[aria-describedby] > li button[data-strapi-accordion-toggle] > [data-blockscene-row-thumb] { flex-shrink: 100; min-width: 0; overflow: hidden; }
ol[aria-describedby] > li button[data-strapi-accordion-toggle] > span:last-child,
ol[aria-describedby] > li button[data-strapi-accordion-toggle] > span:last-child span { min-width: 0; }`}</style>
      {anchors.map(({ select, zone, index }) => {
        const row = a.form.rows(zone)[index];
        const key = blockKey(row) || "";
        if (!select || !row || !canAct(row, a.groups) || a.selection?.zone !== zone) return null;
        const label = a.labelOf(row);
        return createPortal(
          <input type="checkbox" aria-label={t.f("selectBlock", { label })} data-testid={`row-select-${zone}-${index}`} style={{ margin: 0, width: 16, height: 16, cursor: "pointer" }}
            checked={a.selection.keys.includes(key)}
            onChange={(event) => a.setSelection({ zone, keys: event.target.checked ? [...a.selection.keys, key] : a.selection.keys.filter((k: string) => k !== key) })} />,
          select,
          `select:${zone}:${index}`,
        );
      })}
      {anchors.map(({ el, zone, index }) => {
        const row = a.form.rows(zone)[index];
        if (!row) return null;
        const label = a.labelOf(row);
        const acts = canAct(row, a.groups);
        const hidden = Boolean(a.hiddenName) && row[a.hiddenName] === true;
        const key = blockKey(row) || "";
        return createPortal(
          <Flex gap={0} alignItems="center" data-testid={`row-actions-${zone}-${index}`} role="group" aria-label={t.f("rowActions", { label })}>
            {hidden && <HiddenBadge data-testid={`row-hidden-${zone}-${index}`}>{t.hiddenBadge}</HiddenBadge>}
            {a.hiddenName && (acts || hidden) && (
              <RowButton type="button" $on={hidden} aria-pressed={hidden} title={t.f(hidden ? "showBlock" : "hideBlock", { label })}
                aria-label={t.f(hidden ? "showBlock" : "hideBlock", { label })} data-testid={`row-hide-${zone}-${index}`} onClick={() => a.toggleHidden(zone, index)}>
                <Icon name={hidden ? "eyeOff" : "eye"} />
              </RowButton>
            )}
            {e.duplicate !== false && acts && (
              <RowButton type="button" disabled={a.busy} title={t.f("duplicateBlock", { label })} aria-label={t.f("duplicateBlock", { label })}
                data-testid={`row-duplicate-${zone}-${index}`} onClick={() => a.duplicate(zone, index)}>
                <Icon name="duplicate" />
              </RowButton>
            )}
            {e.clipboard !== false && acts && (
              <RowButton type="button" disabled={a.busy} title={t.f("copyBlock", { label })} aria-label={t.f("copyBlock", { label })}
                data-testid={`row-copy-${zone}-${index}`} onClick={() => a.copy(zone, [key])}>
                <Icon name="clipboard" />
              </RowButton>
            )}
          </Flex>,
          el,
          `${zone}:${index}`,
        );
      })}
      {confirm && (
        <Modal open width="48rem" onOpenChange={(open: boolean) => !open && setConfirm(null)} trigger={null} title={t.confirmDeleteTitle}>
          <Flex direction="column" alignItems="stretch" gap={4} data-testid="row-confirm-delete">
            <Typography>{t.f("confirmDelete", { name: confirm.label })}</Typography>
            {confirm.marker && <Typography variant="pi" textColor="neutral600">{t.confirmDeleteMarker}</Typography>}
            <Flex gap={2} justifyContent="flex-end">
              <Button variant="tertiary" onClick={() => setConfirm(null)} data-testid="row-confirm-cancel">{t.cancel}</Button>
              <Button variant="danger" onClick={confirmDelete} data-testid="row-confirm-ok">{t.delete}</Button>
            </Flex>
          </Flex>
        </Modal>
      )}
    </>
  );
}

// The zone's "…" menu entries: select mode (for copying) and Paste at the end of the zone. None: no menu.
export function zoneMenuItems(zone: any, a: any) {
  if (!a || a.editor.clipboard === false) return [];
  const { t } = a;
  return [
    zone.count > 0 && { label: t.selectBlocks, icon: "select", testid: `zone-select-${zone.name}`, onSelect: () => a.setSelection({ zone: zone.name, keys: [] }) },
    a.clip && !zone.full && a.pastable(zone.name) &&
      { label: t.f("paste", { count: a.clip.rows.length }), icon: "paste", testid: `zone-paste-${zone.name}`, onSelect: () => a.paste(zone.name) },
  ].filter(Boolean);
}

// Selection mode swaps the zone bar for this one: select all or none (indeterminate while some are), the count, Copy
// and Done. Escape leaves too (useRowActions).
export function SelectionBar({ zone, actions: a }: any) {
  const { t } = a;
  const box = React.useRef<HTMLInputElement>(null);
  const keys: string[] = a.selectable(zone.name);
  const chosen = a.selection.keys.filter((key: string) => keys.includes(key));
  const all = keys.length > 0 && chosen.length === keys.length;
  React.useEffect(() => {
    if (box.current) box.current.indeterminate = chosen.length > 0 && !all;
  });
  const reason = chosen.length ? undefined : t.copyNothing;
  return (
    <Flex gap={2} alignItems="center" data-testid={`zone-selection-${zone.name}`}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input ref={box} type="checkbox" checked={all} aria-label={chosen.length ? t.selectNone : t.selectAll} data-testid={`zone-select-all-${zone.name}`}
          style={{ margin: 0, width: 16, height: 16, cursor: "pointer" }}
          onChange={() => a.setSelection({ zone: zone.name, keys: chosen.length ? [] : keys })} />
        <Typography variant="pi" fontWeight="bold" aria-live="polite" data-testid={`zone-selected-${zone.name}`}>
          {chosen.length ? t.f("selectedCount", { count: chosen.length }) : t.selectAll}
        </Typography>
      </label>
      <span title={reason}>
        <Button size="S" variant="secondary" startIcon={<Icon name="clipboard" size={14} />} disabled={!chosen.length || a.busy} aria-description={reason}
          onClick={() => a.copy(zone.name, chosen)} data-testid={`zone-copy-${zone.name}`}>
          {t.copy}
        </Button>
      </span>
      <Button size="S" variant="tertiary" onClick={() => a.setSelection(null)} data-testid={`zone-select-done-${zone.name}`}>{t.selectDone}</Button>
    </Flex>
  );
}
