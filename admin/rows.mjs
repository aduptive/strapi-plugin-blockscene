import { generateNKeysBetween } from "fractional-indexing";
import { groupRange, isOpener, isClose, validateGroups } from "../server/groups.js";

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
// ... as the `connect` list of a new row (the shape the relation input itself writes when an item is picked).
export function toConnect(relations, target) {
  const keys = relations.length ? generateNKeysBetween(null, null, relations.length) : [];
  return {
    connect: relations.map((r, i) => ({
      id: r.id,
      apiData: { id: r.id, documentId: r.documentId, locale: r.locale, isTemporary: true },
      status: r.status,
      label: r.documentId,
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
