import { generateNKeysBetween } from "fractional-indexing";

// Strapi's default-form helpers are private. Keep this small, schema-driven
// equivalent covered by nested-component and persistence checks on each version.
export function componentDefaults(schema, components, stack = []) {
  if (!schema || stack.includes(schema))
    throw new Error("Invalid recursive component defaults");
  const row = {};
  for (const [name, attr] of Object.entries(schema.attributes || {})) {
    if (Object.hasOwn(attr, "default")) {
      const value = structuredClone(attr.default);
      if (attr.type === "password") row[name] = "";
      else if (attr.type === "relation")
        row[name] = { connect: [], disconnect: [] };
      else if (value !== null || attr.type === "boolean") row[name] = value;
    } else if (attr.type === "component" && attr.required) {
      const create = () =>
        componentDefaults(components[attr.component], components, [
          ...stack,
          schema,
        ]);
      if (attr.repeatable) {
        const keys = generateNKeysBetween(null, null, attr.min || 0);
        row[name] = keys.map((key) => ({ ...create(), __temp_key__: key }));
      } else row[name] = create();
    } else if (attr.type === "dynamiczone" && attr.required) row[name] = [];
  }
  return row;
}

// Every editable top-level Dynamic Zone. `full` zones keep their accordion
// controls but hide the gallery button.
export function editableZones(schema, values, canEdit, disabled = false) {
  if (disabled) return [];
  return Object.entries(schema?.attributes || {})
    .filter(
      ([name, attr]) =>
        attr.type === "dynamiczone" && !attr.conditions && canEdit(name),
    )
    .map(([name, attr]) => {
      const rows = Array.isArray(values?.[name]) ? values[name] : [];
      // `uids` keeps the stored order: the row thumbnails match a native accordion header by its position in the list.
      return {
        name,
        components: attr.components || [],
        max: attr.max,
        count: rows.length,
        uids: rows.map((row) =>
          row && typeof row.__component === "string" ? row.__component : "",
        ),
        full: rows.length >= (attr.max ?? Infinity),
      };
    });
}

export function canInsert(zone, uid, values, components, count = 1) {
  return Boolean(
    zone?.components.includes(uid) &&
    components[uid] &&
    (Array.isArray(values?.[zone.name]) ? values[zone.name].length : 0) +
      count <=
      (zone.max ?? Infinity),
  );
}

// Thumbnail priority: panel override > configured image > <previewBaseUrl>/<uid>.webp > wireframe.
// The wireframe is not a URL: the card renders it when every candidate failed.
export function candidatesFor(uid, meta = {}, config = {}) {
  const version = config.previewVersion
    ? `?v=${encodeURIComponent(config.previewVersion)}`
    : "";
  const base = (config.previewBaseUrl || "/block-previews").replace(/\/$/, "");
  return [
    meta.manualImage,
    meta.image,
    `${base}/${encodeURIComponent(uid)}.webp${version}`,
  ].filter(Boolean);
}

// Strapi-managed attributes the editor never fills; CKEditor custom fields are rich text under the hood.
const SYSTEM_FIELDS = [
  "id",
  "documentId",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "createdBy",
  "updatedBy",
  "locale",
  "localizations",
];
const fieldType = (attr) =>
  attr?.type === "customField"
    ? String(attr.customField || "").includes("CKEditor")
      ? "richtext"
      : "customField"
    : attr?.type || "unknown";
export const fieldsOf = (schema) =>
  Object.entries(schema?.attributes || {})
    .filter(([name]) => !SYSTEM_FIELDS.includes(name))
    .map(([name, attr]) => ({ name, type: fieldType(attr) }));
export const categoryOf = (uid, schema, meta = {}) =>
  meta.category || schema?.category || uid.split(".")[0];
// System-ish categories ("admin") sort after everything else; the rest alphabetical (section order and filter options).
export const byCategory = (a, b) =>
  (a === "admin" ? 1 : 0) - (b === "admin" ? 1 : 0) || a.localeCompare(b);

// A configured CLOSE is never offered on its own: it comes with its OPEN, and alone it would leave an unbalanced group.
const pickable = (zone, config) => {
  const closers = Object.values(config.groups || {});
  return zone.components.filter((uid) => !closers.includes(uid));
};

export function entriesFor(zone, components, config, query, category = "all") {
  const needle = query.trim().toLocaleLowerCase();
  return pickable(zone, config)
    .flatMap((uid) => {
      const schema = components[uid];
      if (!schema) return [];
      const meta = config.components?.[uid] || {};
      const entry = {
        uid,
        label: meta.label || schema.info?.displayName || uid,
        description: meta.description || schema.info?.description || "",
        category: categoryOf(uid, schema, meta),
        fields: fieldsOf(schema),
        candidates: candidatesFor(uid, meta, config),
        template: meta.template || "generic",
      };
      if (category !== "all" && entry.category !== category) return [];
      return `${entry.label} ${entry.description} ${entry.category} ${uid} ${meta.keywords || ""}`
        .toLocaleLowerCase()
        .includes(needle)
        ? [entry]
        : [];
    })
    .sort(
      (a, b) =>
        byCategory(a.category, b.category) || a.label.localeCompare(b.label),
    );
}
// Category -> count over the whole allowed list (the filter options never shrink while searching).
export function categoriesFor(zone, components, config) {
  const counts = new Map();
  for (const uid of pickable(zone, config)) {
    const schema = components[uid];
    if (!schema) continue;
    const c = categoryOf(uid, schema, config.components?.[uid] || {});
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => byCategory(a, b));
}
// Sections in category order; entries keep the order entriesFor produced.
export function groupEntries(entries) {
  const map = new Map();
  for (const entry of entries)
    map.set(entry.category, [...(map.get(entry.category) || []), entry]);
  return [...map.entries()].map(([category, items]) => ({
    category,
    entries: items,
  }));
}

// "Remember last choice" only stores open/closed per install, user, content type and zone.
export function memoryKey({ base = "", userId, contentType, zone }) {
  if (!userId || !contentType || !zone) return null;
  return `blockscene:v1:${base}:${userId}:${contentType}:${zone}`;
}
export function readMemory(storage, key) {
  try {
    const value = key && storage?.getItem(key);
    return value === "open" || value === "closed" ? value : null;
  } catch {
    return null;
  }
}
export function writeMemory(storage, key, value) {
  try {
    if (key && (value === "open" || value === "closed"))
      storage?.setItem(key, value);
  } catch {
    /* blocked storage keeps the default */
  }
}
// Initial state for a zone: explicit setting, or the remembered choice, else closed.
export function initialState(editor, remembered) {
  if (editor?.initialState === "open") return "open";
  if (editor?.initialState === "remember") return remembered || "closed";
  return "closed";
}
