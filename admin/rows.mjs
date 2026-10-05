import { generateNKeysBetween } from "fractional-indexing";
import { blockKey, groupRange, isOpener, isClose, removeGroup, unwrapGroup, validateGroups } from "../server/groups.js";
export { layoutColumns } from "../server/groups.js";
export { removeGroup, unwrapGroup };

// Row actions (duplicate, copy/paste, hide): pure helpers shared by the Strapi 4 and 5 adapters and the unit tests.
// Every change is a new zone array written through the form, so undo/redo and Save see it like any native edit.

// Rows an action covers: a configured OPEN brings its whole group (OPEN … CLOSE); anything else is itself.
export const actionRange = (rows, index, groups) =>
  groups && isOpener(rows[index], groups) ? groupRange(rows, index, groups) : [index, index];
// Selected row indexes, each OPEN expanded to its group; sorted and unique.
export function expandSelection(rows, indexes, groups) {
  const out = new Set();
  for (const index of indexes) {
    if (!rows[index]) continue;
    const [start, end] = actionRange(rows, index, groups);
    for (let i = start; i <= end; i++) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}
export const canAct = (row, groups) => !(groups && isClose(row, groups));
export const isGroupMarker = (row, groups) => Boolean(groups) && (isOpener(row, groups) || isClose(row, groups));

const copy = (value) => {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};
// Deep copy for a new row: `id`/`documentId` removed from the row and every nested component (media files and
// relation targets keep theirs), nested __temp_key__s kept (unique within their own new list). `relation(value, attr,
// path)` converts a relation value to what the form holds for a new row; without it the value is copied as is.
export function cloneRow(row, components, { relation } = {}) {
  const walk = (value, schema, path) => {
    const out = {};
    for (const [key, item] of Object.entries(value || {})) {
      if (key === "id" || key === "documentId") continue;
      const attr = schema?.attributes?.[key];
      if (attr?.type === "component" && item) {
        const child = components?.[attr.component];
        out[key] = attr.repeatable
          ? (Array.isArray(item) ? item : []).map((entry, i) => walk(entry, child, [...path, key, i]))
          : walk(item, child, [...path, key]);
      } else if (attr?.type === "relation" && relation) out[key] = relation(item, attr, [...path, key]);
      else out[key] = copy(item);
    }
    return out;
  };
  return walk(row, components?.[row?.__component], []);
}
// Saved components (they have an id) whose relations live on the server: { path, uid, id, field, target } per relation.
export function relationSlots(row, components) {
  const slots = [];
  const walk = (value, uid, path) => {
    const schema = components?.[uid];
    if (!value || !schema) return;
    for (const [key, attr] of Object.entries(schema.attributes || {})) {
      if (attr?.type === "relation" && value.id != null)
        slots.push({ path: [...path, key].join("."), uid, id: value.id, field: key, target: attr.targetModel || attr.target });
      else if (attr?.type === "component" && value[key]) {
        if (attr.repeatable) (Array.isArray(value[key]) ? value[key] : []).forEach((entry, i) => walk(entry, attr.component, [...path, key, i]));
        else walk(value[key], attr.component, [...path, key]);
      }
    }
  };
  walk(row, row?.__component, []);
  return slots;
}
// Strapi 5 form relation value ({ connect, disconnect }) over what the server holds: the relations the row shows now.
const plain = (r) => ({ id: r.id ?? r.apiData?.id, documentId: r.documentId ?? r.apiData?.documentId, locale: r.locale ?? r.apiData?.locale ?? null, status: r.status });
export function currentRelations(server, value) {
  const gone = new Set((value?.disconnect || []).map((r) => plain(r).id));
  const out = (server || []).map(plain).filter((r) => !gone.has(r.id));
  for (const r of (value?.connect || []).map(plain)) if (!out.some((o) => o.id === r.id)) out.push(r);
  return out;
}
// ... as the `connect` list of a new row (the shape the relation input itself writes when an item is picked); the label
// is the target's main field when known, else its documentId.
export function toConnect(relations, target) {
  const keys = relations.length ? generateNKeysBetween(null, null, relations.length) : [];
  return {
    connect: relations.map((r, i) => ({
      id: r.id,
      apiData: { id: r.id, documentId: r.documentId, locale: r.locale, isTemporary: true },
      status: r.status,
      label: r.label ?? r.documentId,
      href: `../collection-types/${target}/${r.documentId}${r.locale ? `?plugins[i18n][locale]=${r.locale}` : ""}`,
      __temp_key__: keys[i],
    })),
    disconnect: [],
  };
}

// Keys for `n` new rows inserted at `at`. Strapi 5: fractional keys between the neighbours (after the largest key when
// the list is not ordered); Strapi 4: integers after the largest one.
export function fractionalKeys(rows, at, n) {
  const key = (row) => (typeof row?.__temp_key__ === "string" ? row.__temp_key__ : null);
  try {
    return generateNKeysBetween(key(rows[at - 1]), key(rows[at]), n);
  } catch {
    const max = rows.map(key).filter(Boolean).sort().pop() ?? null;
    return generateNKeysBetween(max, null, n);
  }
}
export function integerKeys(rows, n) {
  const max = Math.max(-1, ...rows.map((row) => Number(row?.__temp_key__)).filter(Number.isFinite));
  return Array.from({ length: n }, (_, i) => max + 1 + i);
}
export const insertRows = (rows, at, items, keys) => [
  ...rows.slice(0, at),
  ...items.map((item, i) => ({ ...item, __temp_key__: keys[i] })),
  ...rows.slice(at),
];

// Hide on the site: the whole range gets the same value (a hidden OPEN hides its group).
export function setHidden(rows, index, groups, name, value) {
  const [start, end] = actionRange(rows, index, groups);
  return rows.map((row, i) => (i >= start && i <= end ? { ...row, [name]: value } : row));
}

// Clipboard: one versioned localStorage entry per browser, shared by every tab and page of the install.
export const CLIPBOARD_KEY = "blockscene:clipboard:v1";
const MAX_ROWS = 200;
export function readClip(storage) {
  try {
    const clip = JSON.parse(storage?.getItem(CLIPBOARD_KEY) || "null");
    return clip && clip.v === 1 && Array.isArray(clip.rows) && clip.rows.length > 0 && clip.rows.length <= MAX_ROWS &&
      clip.rows.every((row) => row && typeof row.__component === "string")
      ? clip
      : null;
  } catch {
    return null;
  }
}
export function writeClip(storage, { rows, model, locale, zone }) {
  try {
    if (!rows.length || rows.length > MAX_ROWS) return false;
    storage.setItem(CLIPBOARD_KEY, JSON.stringify({ v: 1, model, locale: locale || "", zone, at: Date.now(), rows }));
    return true;
  } catch {
    return false; // blocked or full storage
  }
}
// All or nothing: every component allowed in the target zone, room for all rows, groups whole. null when it fits.
export function pasteProblem(clip, zone, rows, components, groups) {
  if (!clip?.rows?.length) return { code: "empty" };
  const bad = clip.rows.find((row) => !zone?.components?.includes(row.__component) || !components?.[row.__component]);
  if (bad) return { code: "notAllowed", uid: bad.__component };
  if ((rows?.length || 0) + clip.rows.length > (zone.max ?? Infinity)) return { code: "full" };
  if (groups && validateGroups(clip.rows, groups).length) return { code: "unbalanced" };
  return null;
}

// Layout groups in the form (indentation, folding, keeping a dragged group together). Pure: indexes of one zone's rows.
// Per row: `depth` (0 at the top), `kind` ('open' | 'close' | 'block'), `parents` (indexes of the OPENs around it,
// outermost first; a CLOSE counts its own OPEN), and on a closed OPEN its `end` (CLOSE index) and `count` (rows between
// the pair, CLOSE markers excluded). Lenient like groupRows: an unclosed OPEN wraps the rest of the list, a CLOSE that is
// not the innermost group's own is an ordinary row (the diagnostics report both).
export function groupOutline(rows, groups) {
  const out = rows.map(() => ({ depth: 0, kind: "block", parents: [] }));
  if (!groups) return out;
  const stack = [];
  rows.forEach((row, i) => {
    const parents = stack.map((s) => s.index);
    const top = stack[stack.length - 1];
    if (top && isClose(row, groups) && row.__component === top.close) {
      stack.pop();
      out[top.index].end = i;
      out[top.index].count = out.slice(top.index + 1, i).filter((r) => r.kind !== "close").length;
      out[i] = { depth: parents.length, kind: "close", parents };
      return;
    }
    const open = isOpener(row, groups);
    out[i] = { depth: parents.length, kind: open ? "open" : "block", parents };
    if (open) stack.push({ index: i, close: groups[row.__component] });
  });
  return out;
}
// The one row that moved between two versions of a zone, as { from, to } (its index before and after), or null when
// the change is anything else (insert, delete, several rows, a whole range). An adjacent swap reads both ways (A went
// down or B went up): `actor`, the key of the row the user acted on, decides, else null. Strapi versions that give a
// moved unsaved row a new __temp_key__ are matched by component.
export function movedRow(prev, next, actor) {
  const n = prev.length;
  if (n !== next.length || n < 2) return null;
  const k = prev.map(blockKey), m = next.map(blockKey);
  let i = 0;
  while (i < n && k[i] === m[i]) i++;
  if (i === n) return null;
  let j = n - 1;
  while (k[j] === m[j]) j--;
  const same = (a, b) => blockKey(a) === blockKey(b) || (a?.id == null && b?.id == null && a?.__component === b?.__component);
  const shifted = (from, to, by) => {
    for (let x = from; x <= to; x++) if (m[x] !== k[x + by]) return false;
    return true;
  };
  const down = same(prev[i], next[j]) && shifted(i, j - 1, 1); // prev[i] went to j
  const up = same(prev[j], next[i]) && shifted(i + 1, j, -1); // prev[j] went to i
  if (down && up) return actor === k[i] ? { from: i, to: j } : actor === k[j] ? { from: j, to: i } : null;
  return down ? { from: i, to: j } : up ? { from: j, to: i } : null;
}
// A moved OPEN takes its group along. When the only change from `prev` to `next` is one OPEN of a closed group moving,
// its members (children and CLOSE, as they were) are put back right after it; dropped among its own members (keyboard
// and arrow moves go one row at a time) the whole group moves one row down instead. Returns the new list, or null when
// there is nothing to do: a child moved alone leaves the group (it is independent now), a moved CLOSE ends the group
// where it lands, and inserts, deletes and whole-range moves stay as they are.
export function keepGroupsTogether(prev, next, groups, actor) {
  if (!groups) return null;
  const move = movedRow(prev, next, actor);
  if (!move || !isOpener(prev[move.from], groups)) return null;
  const start = move.from, end = groupOutline(prev, groups)[start].end;
  if (end == null) return null; // unclosed: no members to keep
  const members = new Set(prev.slice(start + 1, end + 1).map(blockKey));
  const at = move.to;
  if (at > 0 && members.has(blockKey(next[at - 1]))) {
    // One row down: the row below the CLOSE goes above the group. Already the last one: the move is undone.
    if (end + 1 >= prev.length) return prev.slice();
    const rest = [...prev.slice(0, start), ...prev.slice(end + 1)];
    return [...rest.slice(0, start + 1), ...prev.slice(start, end + 1), ...rest.slice(start + 1)];
  }
  const others = next.filter((row) => !members.has(blockKey(row)));
  const o = others.indexOf(next[at]);
  return [...others.slice(0, o + 1), ...next.filter((row) => members.has(blockKey(row))), ...others.slice(o + 1)];
}
// Indexes of a zone's rows with a validation error: Strapi 5 nests errors (errors[zone][index]), Strapi 4 keys them flat
// ("zone.3.title").
export function errorRows(errors, zone) {
  const out = new Set();
  const nested = errors?.[zone];
  if (nested && typeof nested === "object") for (const [key, value] of Object.entries(nested)) if (value && /^\d+$/.test(key)) out.add(Number(key));
  for (const key of Object.keys(errors || {})) {
    const hit = key.startsWith(`${zone}.`) && /^(\d+)(\.|$)/.exec(key.slice(zone.length + 1));
    if (hit) out.add(Number(hit[1]));
  }
  return [...out];
}

// Layout grid of the closed group whose OPEN is at `open`: its cells in zone order, [start, end] each. A child block is
// one row; a nested group is one cell from its OPEN to its CLOSE. The group's own CLOSE is not a cell. null when the
// row is not the OPEN of a closed group.
export function gridCells(rows, open, groups) {
  const outline = groupOutline(rows, groups);
  const end = outline[open]?.kind === "open" ? outline[open].end : null;
  if (end == null) return null;
  const cells = [];
  for (let i = open + 1; i < end; ) {
    const stop = outline[i].kind === "open" && outline[i].end != null ? Math.min(outline[i].end, end - 1) : i;
    cells.push([i, stop]);
    i = stop + 1;
  }
  return cells;
}
// Cell `from` moved to position `to` (cell positions, as the grid shows them): the new zone rows, same row objects, for
// one form change; null when nothing moves.
export function moveCell(rows, open, groups, from, to) {
  const cells = gridCells(rows, open, groups);
  if (!cells || from === to || !cells[from] || !cells[to]) return null;
  const order = cells.map((_, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]);
  const start = cells[0][0], end = cells[cells.length - 1][1];
  return [...rows.slice(0, start), ...order.flatMap((i) => rows.slice(cells[i][0], cells[i][1] + 1)), ...rows.slice(end + 1)];
}
// "Remove from group": the cell's rows go right after the group's CLOSE (a sibling of the group from then on).
export function removeFromGroup(rows, open, groups, cell) {
  const cells = gridCells(rows, open, groups);
  if (!cells?.[cell]) return null;
  const [start, end] = cells[cell], close = groupOutline(rows, groups)[open].end;
  return [...rows.slice(0, start), ...rows.slice(end + 1, close + 1), ...rows.slice(start, end + 1), ...rows.slice(close + 1)];
}
// A cell's one-line summary: the first non-empty text attribute in schema order (markup stripped), else "".
const TEXTY = ["string", "text", "richtext", "email", "uid", "customField"];
export function textSummary(row, schema, max = 80) {
  for (const [name, attr] of Object.entries(schema?.attributes || {})) {
    const value = row?.[name];
    if (!TEXTY.includes(attr?.type) || typeof value !== "string") continue;
    const text = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, "").replace(/\s+/g, " ").trim();
    if (text) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  return "";
}
