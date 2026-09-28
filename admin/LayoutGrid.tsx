import * as React from "react";
import styled from "styled-components";
import { blockKey } from "./preview.mjs";
import { gridCells, groupOutline, layoutColumns, moveCell, removeFromGroup, textSummary } from "./rows.mjs";
import { useMessages } from "./messages";
import { Icon } from "./icons";

// Layout grid (README "Layout grid"): the children of an OPEN configured with `layout` shown inside the OPEN's row as a
// grid of the OPEN's own column count, read live from its form. The real rows stay mounted (hidden by GroupRows): the
// form, validation and the row tools keep owning them. Every change here is one zone write through the form: a
// reorder (drag or Alt+Arrow), "Remove from group" (the cell goes right after the CLOSE). A cell opens its block's
// native form in the preview core's block dialog; "+" opens the gallery to insert at the end of the group.
const TYPE_ICONS: Record<string, string> = { hero: "hero", text: "text", media: "image", listing: "list", cards: "cards", cta: "link", form: "form", layout: "layout" };
const DRAG_TYPE = "application/x-blockscene-cell"; // not a native type: Strapi's react-dnd backend ignores the drag
const Box = styled.div`
  margin: 8px 12px 12px; padding: 8px; border: 1px dashed ${({ theme }) => theme.colors.primary200}; border-radius: 4px;
  background: ${({ theme }) => theme.colors.primary100};
`;
const Grid = styled.div`display: grid; gap: 8px; margin-top: 6px;`;
const Cell = styled.div<{ $error: boolean; $over: boolean; $dragged: boolean }>`
  position: relative; min-width: 0; opacity: ${({ $dragged }) => ($dragged ? 0.4 : 1)};
  > button { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; min-height: 64px; padding: 8px 28px 8px 10px;
    border-radius: 4px; cursor: pointer; text-align: left; font: inherit; background: ${({ theme }) => theme.colors.neutral0};
    color: ${({ theme }) => theme.colors.neutral800};
    border: ${({ theme, $error, $over }) => ($over ? `2px solid ${theme.colors.primary600}` : $error ? `2px solid ${theme.colors.danger600}` : `1px solid ${theme.colors.neutral200}`)}; }
  > button:hover { border-color: ${({ theme, $error }) => ($error ? theme.colors.danger600 : theme.colors.primary600)}; }
  > button:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 1px; }
`;
const Name = styled.span`display: flex; align-items: center; gap: 6px; max-width: 100%; font-size: 12px; font-weight: 600;
  > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;
const Summary = styled.span<{ $error?: boolean }>`max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px;
  color: ${({ theme, $error }) => ($error ? theme.colors.danger600 : theme.colors.neutral600)};`;
const More = styled.span`
  position: absolute; top: 4px; right: 4px; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border-radius: 4px; cursor: pointer; color: ${({ theme }) => theme.colors.neutral600};
  &:hover { background: ${({ theme }) => theme.colors.neutral100}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; }
`;
const Pop = styled.div`
  position: absolute; top: 30px; right: 4px; z-index: 3; padding: 4px; border-radius: 4px; white-space: nowrap;
  background: ${({ theme }) => theme.colors.neutral0}; box-shadow: ${({ theme }) => theme.shadows.filterShadow};
  > button { display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 4px; background: none; cursor: pointer; font: inherit; font-size: 12px;
    color: ${({ theme }) => theme.colors.neutral800}; text-align: left; }
  > button:hover, > button:focus-visible { background: ${({ theme }) => theme.colors.primary100}; outline: none; }
`;
const Add = styled.button`
  display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 64px; padding: 8px; border-radius: 4px; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 600; color: ${({ theme }) => theme.colors.primary600}; background: ${({ theme }) => theme.colors.neutral0};
  border: 1px dashed ${({ theme }) => theme.colors.primary600};
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 1px; }
`;
const Caption = styled.span`font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: ${({ theme }) => theme.colors.primary700};`;

export function LayoutGrid({ zone, open, form, groups, layout, components, catalog, labelOf, openBlock, openInsert }: any) {
  const t = useMessages();
  const [menu, setMenu] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const [over, setOver] = React.useState<number | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const focusKey = React.useRef<{ key: string; until: number } | null>(null);
  // A moved cell keeps the focus: moving a node drops it, and the zone write lands a render or two later.
  React.useEffect(() => {
    const want = focusKey.current;
    if (!want) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-cell-key="${CSS.escape(want.key)}"]`);
    el?.focus();
    if (document.activeElement === el || Date.now() > want.until) focusKey.current = null;
  });
  React.useEffect(() => {
    if (menu === null) return;
    const close = (event: Event) => {
      if (event.type === "keydown" ? (event as KeyboardEvent).key === "Escape" : !(event.target as Element)?.closest?.("[data-cell-menu]")) setMenu(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [menu]);
  const rows = form.rows(zone.name);
  const cells = gridCells(rows, open, groups);
  if (!cells || !rows[open]) return null;
  const { desktop, mobile } = layoutColumns(rows[open], layout, components?.[rows[open].__component]);
  const outline = groupOutline(rows, groups);
  const errors = new Set(form.errorRows?.(zone.name) || []);
  const move = (from: number, to: number) => {
    const next = moveCell(rows, open, groups, from, Math.max(0, Math.min(cells.length - 1, to)));
    if (!next) return;
    focusKey.current = { key: blockKey(rows[cells[from][0]]) || "", until: Date.now() + 1000 };
    form.setRows(zone.name, next);
  };
  const remove = (cell: number) => {
    setMenu(null);
    const next = removeFromGroup(rows, open, groups, cell);
    if (next) form.setRows(zone.name, next);
  };
  const full = rows.length >= (zone.max ?? Infinity);
  const last = blockKey(rows[cells.length ? cells[cells.length - 1][1] : open]);
  const iconOf = (uid: string) => TYPE_ICONS[catalog?.components?.[uid]?.typology] || "text";
  const id = `${zone.name}-${open}`;
  return (
    <Box ref={box} data-testid={`layout-grid-${id}`} data-columns={desktop} role="group" aria-label={t.f("gridLabel", { label: labelOf(rows[open]) })}>
      <Caption data-testid={`layout-grid-caption-${id}`}>
        {mobile ? t.f("gridColumnsMobile", { count: desktop, mobile }) : t.f("gridColumns", { count: desktop })}
      </Caption>
      <Grid style={{ gridTemplateColumns: `repeat(${desktop}, minmax(0, 1fr))` }}>
        {cells.map(([start, end], i) => {
          const row = rows[start];
          const key = blockKey(row) || String(start);
          const nested = end > start;
          const error = [...errors].some((n) => n >= start && n <= end);
          const label = labelOf(row);
          const summary = nested ? t.f("groupBlocks", { count: outline[start].count || 0 }) : textSummary(row, components?.[row.__component]);
          return (
            <Cell key={key} $error={error} $over={over === i && drag !== null && drag !== i} $dragged={drag === i} data-testid={`grid-cell-${id}-${i}`} data-error={error || undefined}
              onDragOver={(event) => {
                if (drag === null) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                if (over !== i) setOver(i);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (drag !== null) move(drag, i);
                setDrag(null);
                setOver(null);
              }}>
              <button type="button" draggable data-cell-key={key} title={t.gridCellHint}
                aria-label={`${label}${summary ? `: ${summary}` : ""}${error ? ` (${t.gridCellError})` : ""}`}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
                onClick={() => openBlock?.(zone.name, start)}
                onKeyDown={(event) => {
                  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -desktop, ArrowDown: desktop };
                  if (!event.altKey || !(event.key in step)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  move(i, i + step[event.key]);
                }}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(DRAG_TYPE, key);
                  setDrag(i);
                }}
                onDragEnd={(event) => {
                  event.stopPropagation();
                  setDrag(null);
                  setOver(null);
                }}>
                <Name><Icon name={nested ? "layout" : iconOf(row.__component)} size={14} /><span>{label}</span></Name>
                {(summary || error) && <Summary $error={error}>{error ? t.gridCellError : summary}</Summary>}
              </button>
              <More role="button" tabIndex={0} data-cell-menu="" aria-haspopup="menu" aria-label={t.f("gridCellMenu", { label })} title={t.f("gridCellMenu", { label })}
                data-testid={`grid-cell-menu-${id}-${i}`}
                onClick={() => setMenu(menu === i ? null : i)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setMenu(menu === i ? null : i);
                }}>
                <Icon name="more" size={16} />
              </More>
              {menu === i && (
                <Pop role="menu" data-cell-menu="">
                  <button type="button" role="menuitem" autoFocus data-testid={`grid-cell-remove-${id}-${i}`} onClick={() => remove(i)}>{t.removeFromGroup}</button>
                </Pop>
              )}
            </Cell>
          );
        })}
        <Add type="button" disabled={full} title={full ? t.zoneFull : undefined} data-testid={`grid-add-${id}`} onClick={() => openInsert?.(zone.name, last)}>
          <Icon name="plus" size={14} />{t.gridAdd}
        </Add>
      </Grid>
    </Box>
  );
}
