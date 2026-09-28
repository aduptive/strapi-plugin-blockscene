import * as React from "react";
import { createPortal } from "react-dom";
import styled, { useTheme } from "styled-components";
import { FOLDED, findZoneList } from "./accordions.mjs";
import { blockKey } from "./preview.mjs";
import { groupOutline, keepGroupsTogether, movedRow } from "./rows.mjs";
import { endDrag, startDrag } from "./history.mjs";
import { useMessages } from "./messages";
import { Icon } from "./icons";

// Layout groups in the form: the rows between an OPEN and its CLOSE are indented under it with a guide line per level,
// the CLOSE reads as the group's end (compact, no drag handle), each OPEN gets a chevron that folds its group, and an
// OPEN dragged or moved takes its group along. The same DOM approach as the row thumbnails and actions: data attributes
// on the native <li>s, one portal per OPEN header. Keeping a group together reads only the form state (the rows before
// and after a change, see keepGroupsTogether); events only name the row the user acted on and say when a mouse drag
// ends (Strapi moves the row on every hover, so the group is settled on drop, as one undo step).
// ponytail: DOM decoration; drop it if Strapi ever exposes row slots.
const DEPTH = "data-blockscene-depth";
const KIND = "data-blockscene-group";
const FOLD = "data-blockscene-fold";
const COUNT = "data-blockscene-fold-count";
const STEP = "2.4rem";
// Folded groups, for the session: per document, zone and OPEN key (memory only, like the rest of the edit view state).
const folded = new Set<string>();
type Anchor = { el: HTMLElement; countEl: HTMLElement | null; zone: string; index: number; id: string; count: number; open: boolean; label: string };
const set = (el: HTMLElement, name: string, value: string | null) => {
  if (value === null) el.hasAttribute(name) && el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
};
const items = (list: Element) => [...list.querySelectorAll<HTMLElement>(":scope > li")];
// A span with the button role, not a <button>: every row's first button[aria-expanded] must stay Strapi's header toggle
// (the accordions, row thumbnails and row actions find it that way), and the header's next sibling its actions.
const Fold = styled.span<{ $open: boolean }>`
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 28px; height: 28px; margin-left: 8px;
  border-radius: 4px; cursor: pointer; color: ${({ theme }) => theme.colors.primary600};
  background: ${({ theme, $open }) => ($open ? "transparent" : theme.colors.primary100)};
  &:hover { background: ${({ theme }) => theme.colors.primary100}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: -2px; }
  > span { display: inline-flex; transition: transform 120ms; transform: rotate(${({ $open }) => ($open ? "0" : "-90deg")}); }
`;
const Count = styled.span`
  margin-right: 4px; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; line-height: 16px; white-space: nowrap;
  color: ${({ theme }) => theme.colors.primary700}; background: ${({ theme }) => theme.colors.primary100};
`;

export function GroupRows({ zones, form, groups, docKey, labelOf }: any) {
  const t = useMessages();
  const theme: any = useTheme();
  const on = Boolean(groups && form);
  const [anchors, setAnchors] = React.useState<Anchor[]>([]);
  const [, settle] = React.useReducer((n: number) => n + 1, 0);
  // Per zone, the rows as last seen outside a mouse drag: what a change is compared with.
  const settled = React.useRef(new Map<string, any[]>());
  const actor = React.useRef<string | null>(null);
  const landed = React.useRef<{ zone: string; key: string | null } | null>(null);
  const dragging = React.useRef(false);
  const previewed = React.useRef(false);
  const end = React.useRef(() => {
    if (!dragging.current) return;
    dragging.current = previewed.current = false;
    endDrag();
    settle();
  }).current;
  const latest = React.useRef({ zones, form, docKey, labelOf });
  latest.current = { zones, form, docKey, labelOf };
  React.useEffect(() => settled.current.clear(), [docKey]);
  // After every change of a zone (drag, keyboard, arrows, undo, the plugin's own writes), one form change when a moved
  // OPEN left its members behind. A mouse drag is compared once, on drop, with the rows from before it started.
  React.useEffect(() => {
    if (!on || dragging.current) return;
    for (const zone of zones) {
      const rows = form.rows(zone.name);
      const prev = settled.current.get(zone.name);
      settled.current.set(zone.name, rows);
      if (!prev || prev === rows) continue;
      // A row moved into a folded group unfolds it (below), so the moved row stays in sight.
      const move = movedRow(prev, rows, actor.current);
      if (move) landed.current = { zone: zone.name, key: blockKey(rows[move.to]) };
      const next = keepGroupsTogether(prev, rows, groups, actor.current);
      if (next) {
        settled.current.set(zone.name, next);
        form.setRows(zone.name, next);
      }
    }
  });
  React.useEffect(() => {
    if (!on) return;
    // The row a pointer or key acts on (Strapi's drag handle, its arrows): it tells a swap of two rows apart.
    const rowKey = (target: any) => {
      const li = target?.closest?.("ol[aria-describedby] > li");
      if (!li) return null;
      for (const zone of latest.current.zones) {
        const list = findZoneList(zone.label);
        if (li.parentElement === list) return blockKey(latest.current.form.rows(zone.name)[items(list).indexOf(li)]) || null;
      }
      return null;
    };
    const act = (event: any) => {
      actor.current = event.metaKey || event.ctrlKey || event.altKey ? null : rowKey(event.target);
    };
    const start = (event: DragEvent) => {
      if (!rowKey(event.target)) return;
      dragging.current = true;
      startDrag();
    };
    // The drag ends on drop or dragend; Strapi unmounts the dragged handle (the row shows a placeholder), so neither may
    // reach the window (a drop outside the list): then when the placeholder goes (sync below) or on the first mouse move
    // (no mouse events fire while a native drag lasts; react-dnd's HTML5 backend uses the same fallback).
    const ends = ["drop", "dragend", "mousemove", "pointerdown", "keydown"];
    document.addEventListener("pointerdown", act, true);
    document.addEventListener("keydown", act, true);
    document.addEventListener("dragstart", start, true);
    for (const type of ends) window.addEventListener(type, end, true);
    return () => {
      document.removeEventListener("pointerdown", act, true);
      document.removeEventListener("keydown", act, true);
      document.removeEventListener("dragstart", start, true);
      for (const type of ends) window.removeEventListener(type, end, true);
    };
  }, [on]);
  // Decoration: depth, kind and folded state on each <li>, a chevron anchor before each closed OPEN's header toggle.
  // Frozen while a mouse drag lasts (the rows are mid-move).
  const sync = React.useRef(() => {});
  sync.current = () => {
    const { zones, form, docKey, labelOf } = latest.current;
    if (dragging.current) {
      const placeholder = zones.some((zone: any) => {
        const list = findZoneList(zone.label);
        return list && items(list).some((li) => !li.querySelector("button[aria-expanded]"));
      });
      if (placeholder) previewed.current = true;
      else if (previewed.current) end();
      return;
    }
    const next: Anchor[] = [];
    const seen = new Set<HTMLElement>();
    if (on)
      for (const zone of zones) {
        const list = zone.count ? findZoneList(zone.label) : null;
        const rows = form.rows(zone.name);
        const lis = list ? items(list) : [];
        if (!list || lis.length !== rows.length) continue;
        const outline = groupOutline(rows, groups);
        const idOf = (i: number) => `${docKey}|${zone.name}|${blockKey(rows[i])}`;
        // A validation error inside a folded group unfolds it and every group around it; so does a row moved in.
        const unfold = [...(form.errorRows?.(zone.name) || [])];
        if (landed.current?.zone === zone.name) unfold.push(rows.findIndex((row: any) => blockKey(row) === landed.current?.key));
        for (const index of unfold) for (const p of outline[index]?.parents || []) folded.delete(idOf(p));
        const isFolded = (i: number) => outline[i].end != null && folded.has(idOf(i));
        lis.forEach((li, i) => {
          const o = outline[i];
          seen.add(li);
          set(li, DEPTH, o.depth ? String(o.depth) : null);
          if (o.depth) li.style.setProperty("--bs-depth", String(o.depth));
          set(li, KIND, o.kind === "block" ? null : o.kind);
          set(li, FOLDED, o.parents.some(isFolded) ? "" : null);
          const toggle = li.querySelector<HTMLElement>("button[aria-expanded]");
          if (o.kind !== "open" || o.end == null || !toggle?.parentElement) return;
          let el = toggle.parentElement.querySelector<HTMLElement>(`:scope > [${FOLD}]`);
          if (!el) {
            el = document.createElement("span");
            el.setAttribute(FOLD, "");
            el.style.cssText = "display:inline-flex;align-items:center";
            toggle.parentElement.insertBefore(el, toggle);
          }
          // The folded count sits at the start of the header actions (a span: the row actions look for the first button
          // there), so a long title is not pushed under them (Design System 1 does not shrink it).
          const actions = toggle.nextElementSibling as HTMLElement | null;
          let countEl = actions?.querySelector<HTMLElement>(`:scope > [${COUNT}]`) || null;
          if (actions && !countEl) {
            countEl = document.createElement("span");
            countEl.setAttribute(COUNT, "");
            countEl.style.cssText = "display:inline-flex;align-items:center";
            actions.insertBefore(countEl, actions.firstChild);
          }
          next.push({ el, countEl, zone: zone.name, index: i, id: idOf(i), count: o.count || 0, open: !isFolded(i), label: labelOf(rows[i]) });
        });
      }
    landed.current = null;
    for (const li of document.querySelectorAll<HTMLElement>(`li[${DEPTH}], li[${KIND}], li[${FOLDED}]`))
      if (!seen.has(li)) for (const name of [DEPTH, KIND, FOLDED]) li.removeAttribute(name);
    for (const el of document.querySelectorAll<HTMLElement>(`[${FOLD}], [${COUNT}]`)) if (!next.some((a) => a.el === el || a.countEl === el)) el.remove();
    setAnchors((prev) =>
      prev.length === next.length && prev.every((a, i) => (["el", "countEl", "id", "index", "count", "open", "label"] as const).every((k) => a[k] === next[i][k])) ? prev : next,
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
      for (const el of document.querySelectorAll(`[${FOLD}], [${COUNT}]`)) el.remove();
      for (const li of document.querySelectorAll(`li[${DEPTH}], li[${KIND}], li[${FOLDED}]`)) for (const name of [DEPTH, KIND, FOLDED]) li.removeAttribute(name);
    };
  }, []);
  if (!on) return null;
  const flip = (id: string) => {
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
    sync.current();
  };
  const line = theme?.colors?.primary600 || "#4945ff";
  const list = "ol[aria-describedby] > li";
  return (
    <>
      <style>{`
${list}[${DEPTH}] { padding-left: calc(var(--bs-depth) * ${STEP}); background: repeating-linear-gradient(to right, ${line} 0 2px, transparent 2px ${STEP}) 1.1rem 0 / calc(var(--bs-depth) * ${STEP}) 100% no-repeat; }
${list}[${FOLDED}] { display: none !important; }
${list}[${KIND}="close"] [data-handler-id] { display: none !important; }
${list}[${KIND}="close"] button[aria-expanded]:first-of-type { min-height: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; opacity: 0.7; }
${list}[${KIND}="close"] button[aria-expanded]:first-of-type + * { padding-top: 0 !important; padding-bottom: 0 !important; }
${list}[${KIND}="close"] button[aria-expanded] [data-blockscene-row-thumb] { display: none; }`}</style>
      {anchors.map((a) =>
        createPortal(
          <Fold role="button" tabIndex={0} $open={a.open} aria-expanded={a.open} data-testid={`group-fold-${a.zone}-${a.index}`}
            title={t.f(a.open ? "groupCollapse" : "groupExpand", { label: a.label })} aria-label={t.f(a.open ? "groupCollapse" : "groupExpand", { label: a.label })}
            onClick={() => flip(a.id)}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              flip(a.id);
            }}>
            <span><Icon name="chevron" size={16} /></span>
          </Fold>,
          a.el,
          `fold:${a.zone}:${a.index}`,
        ),
      )}
      {anchors.map((a) =>
        !a.open && a.countEl
          ? createPortal(<Count data-testid={`group-count-${a.zone}-${a.index}`}>{t.f("groupBlocks", { count: a.count })}</Count>, a.countEl, `count:${a.zone}:${a.index}`)
          : null,
      )}
    </>
  );
}
