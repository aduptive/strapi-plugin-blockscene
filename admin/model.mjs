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

// editor.blockPreviewUrl: a plain page per block. Placeholders are URL-encoded; null unless the result is http(s).
export function blockPreviewSrc(template, uid, { variant = "default", locale = "" } = {}) {
  if (!template || !uid) return null;
  const dot = uid.indexOf(".");
  const values = { uid, name: uid.slice(dot + 1), category: dot < 0 ? "" : uid.slice(0, dot), variant, locale };
  try {
    const url = new URL(template.replace(/\{(uid|name|category|variant|locale)\}/g, (_, key) => encodeURIComponent(values[key] || "")));
    url.pathname = url.pathname.replace(/\/{2,}/g, "/"); // an empty {locale} leaves no empty segment
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
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
// Taxonomy computed by the server catalog (server/settings.js): typology order, facet groups of the filter menus.
export const TYPOLOGIES = ["hero", "text", "media", "listing", "cards", "cta", "form", "layout"];
export const FACETS = { media: ["image", "video", "gallery"], content: ["richtext", "list", "dynamic", "form"] };
const typologyRank = (t) => (TYPOLOGIES.indexOf(t) + 1 || 99);

// A configured CLOSE is never offered on its own: it comes with its OPEN, and alone it would leave an unbalanced group.
const pickable = (zone, config) => {
  const closers = Object.values(config.groups || {});
  return zone.components.filter((uid) => !closers.includes(uid));
};
function entryOf(uid, schema, config) {
  const meta = config.components?.[uid] || {};
  return {
    uid,
    label: meta.label || schema.info?.displayName || uid,
    description: meta.description || schema.info?.description || "",
    typology: meta.typology || "text",
    facets: meta.facets || [],
    tags: meta.tags || [],
    keywords: meta.keywords || "",
    fields: fieldsOf(schema),
    candidates: candidatesFor(uid, meta, config),
    template: meta.template || "generic",
  };
}
const allEntries = (zone, components, config) =>
  pickable(zone, config).flatMap((uid) => (components[uid] ? [entryOf(uid, components[uid], config)] : []));

// filter: { typology, uids (recent/starred view), tags, media, content }. Several values of one menu match any of
// them; different menus combine.
export function entriesFor(zone, components, config, query, filter = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const any = (picked, values) => !picked?.length || picked.some((value) => values.includes(value));
  return allEntries(zone, components, config)
    .filter(
      (entry) =>
        (!filter.typology || entry.typology === filter.typology) &&
        (!filter.uids || filter.uids.includes(entry.uid)) &&
        any(filter.tags, entry.tags) &&
        any(filter.media, entry.facets) &&
        any(filter.content, entry.facets) &&
        `${entry.label} ${entry.description} ${entry.typology} ${entry.tags.join(" ")} ${entry.uid} ${entry.keywords}`
          .toLocaleLowerCase()
          .includes(needle),
    )
    .sort((a, b) => typologyRank(a.typology) - typologyRank(b.typology) || a.label.localeCompare(b.label));
}
// value -> count over the whole allowed list (sidebar and menu options never shrink while filtering).
export function optionsFor(zone, components, config) {
  const count = (values) => {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()];
  };
  const entries = allEntries(zone, components, config);
  const facets = entries.flatMap((entry) => entry.facets);
  return {
    total: entries.length,
    uids: entries.map((entry) => entry.uid),
    typologies: count(entries.map((entry) => entry.typology)).sort(([a], [b]) => typologyRank(a) - typologyRank(b)),
    tags: count(entries.flatMap((entry) => entry.tags)).sort(([a], [b]) => a.localeCompare(b)),
    media: count(facets.filter((facet) => FACETS.media.includes(facet))),
    content: count(facets.filter((facet) => FACETS.content.includes(facet))),
  };
}
// Sections in typology order; entries keep the order entriesFor produced.
export function groupEntries(entries) {
  const map = new Map();
  for (const entry of entries)
    map.set(entry.typology, [...(map.get(entry.typology) || []), entry]);
  return [...map.entries()].map(([typology, items]) => ({
    typology,
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

// Friendly field labels (Content Manager edit-layout hook). "mobileColumnsCount" -> "Mobile columns count";
// acronym runs stay upper case ("pageSEO" -> "Page SEO", "ctaURL" -> "Cta URL").
export function humanize(name) {
  const text = String(name || "").replace(/[_\-\s]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim().split(" ").filter(Boolean)
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) && /[A-Z]/.test(word) ? word : word.toLowerCase())).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
// A config text: a string, or { "<locale>": string } resolved as exact locale > its language > same language > en > first.
export function localized(value, locale = "en") {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const keys = Object.keys(value);
  const lang = (key) => key.toLowerCase().split("-")[0];
  const lower = String(locale || "en").toLowerCase();
  const key = keys.find((k) => k.toLowerCase() === lower) ?? keys.find((k) => k.toLowerCase() === lang(lower)) ??
    keys.find((k) => lang(k) === lang(lower)) ?? keys.find((k) => lang(k) === "en") ?? keys[0];
  return key === undefined ? undefined : value[key];
}
// Per field: config text > a label set in "Configure the view" (anything but the raw name) > humanized name (option on).
// Description and placeholder change only when the config has them. null: nothing to change.
function fieldText(fields, owner, name, label, locale, on) {
  const entry = (owner && fields?.[owner]?.[name]) || {};
  const out = {};
  const text = localized(entry.label, locale) ?? (on && label === name ? humanize(name) : undefined);
  if (text !== undefined) out.label = text;
  for (const key of ["description", "placeholder"]) {
    const value = localized(entry[key], locale);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}
// Strapi 5 hands the hook no model uid: the layout is matched to a content type by its display name and field names
// (catalog.types: uid -> [displayName, ...attributes]). null: no match; false: more than one (the layout is left alone).
export function layoutType(layout, types = {}) {
  const names = (layout?.layout || []).flat(2).map((field) => field?.name);
  const found = Object.entries(types || {}).filter(([, [displayName, ...attributes]]) =>
    displayName === layout?.settings?.displayName && names.every((name) => attributes.includes(name)));
  return found.length === 1 ? found[0][0] : found.length ? false : null;
}
const labelsOff = (catalog) => !catalog?.editor?.enabled || (!catalog.editor.friendlyLabels && !Object.keys(catalog.fields || {}).length);
// Strapi 5 edit layout: layout = panels > rows > fields ({ name, label, hint, placeholder }), components[uid].layout = rows.
export function labelEditLayout(layout, catalog, locale) {
  if (labelsOff(catalog) || !Array.isArray(layout?.layout) || !layout.layout.length) return layout;
  const uid = layoutType(layout, catalog.types);
  if (uid === false || (uid && catalog.contentTypes?.[uid]?.enabled === false)) return layout;
  const fix = (owner) => (field) => {
    const text = field && fieldText(catalog.fields, owner, field.name, field.label, locale, catalog.editor.friendlyLabels);
    if (!text) return field;
    const { description, ...rest } = text;
    return { ...field, ...rest, ...(description !== undefined && { hint: description }) };
  };
  return {
    ...layout,
    layout: layout.layout.map((panel) => panel.map((row) => row.map(fix(uid)))),
    components: Object.fromEntries(Object.entries(layout.components || {}).map(([cuid, component]) =>
      [cuid, Array.isArray(component?.layout) ? { ...component, layout: component.layout.map((row) => row.map(fix(cuid))) } : component])),
  };
}
// Strapi 4 edit layout: contentType.layouts.edit and components[uid].layouts.edit are rows of { name, metadatas }.
export function labelEditLayout4(layout, catalog, locale) {
  const uid = layout?.contentType?.uid;
  if (labelsOff(catalog) || !uid || catalog.contentTypes?.[uid]?.enabled === false) return layout;
  const fix = (owner) => (field) => {
    const text = field?.metadatas && fieldText(catalog.fields, owner, field.name, field.metadatas.label, locale, catalog.editor.friendlyLabels);
    return text ? { ...field, metadatas: { ...field.metadatas, ...text } } : field;
  };
  const rows = (target, owner) => Array.isArray(target?.layouts?.edit)
    ? { ...target, layouts: { ...target.layouts, edit: target.layouts.edit.map((row) => row.map(fix(owner))) } } : target;
  return { ...layout, contentType: rows(layout.contentType, uid),
    components: Object.fromEntries(Object.entries(layout.components || {}).map(([cuid, component]) => [cuid, rows(component, cuid)])) };
}
