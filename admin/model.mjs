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

// A gallery insert variant: its values (validated by the server) over the schema defaults. A nested component merges
// over its own defaults; a list replaces the default list, each item over the item defaults with a new key. `keys(n)`
// gives the row keys of a list (Strapi 5 fractional indexes; Strapi 4 passes integers). No values: plain defaults.
const fractional = (n) => generateNKeysBetween(null, null, n);
export function variantRow(schema, components, values, keys = fractional) {
  const row = componentDefaults(schema, components);
  for (const [name, value] of Object.entries(values || {})) {
    const attr = schema.attributes?.[name];
    if (!attr) continue;
    const nested = attr.type === "component" && value !== null ? components[attr.component] : null;
    if (!nested) row[name] = structuredClone(value);
    else if (!attr.repeatable) row[name] = variantRow(nested, components, value, keys);
    else {
      const ids = keys(value.length);
      row[name] = value.map((item, index) => ({ ...variantRow(nested, components, item, keys), __temp_key__: ids[index] }));
    }
  }
  return row;
}

// Materialize a validated starter kit into form rows. null means the entry is no longer empty or its live schema no
// longer fits the catalog built at boot.
export function starterKitRows(kit, zones, components, form) {
  const out = {};
  for (const [name, items] of Object.entries(kit?.zones || {})) {
    const zone = zones.find((entry) => entry.name === name);
    const current = form.rows(name);
    if (!zone || current.length || current.length + items.length > (zone.max ?? Infinity) ||
      items.some((item) => !zone.components.includes(item.__component) || !components[item.__component])) return null;
    const keys = form.keys(current, current.length, items.length);
    out[name] = items.map((item, index) => ({ ...variantRow(components[item.__component], components, item.values), __component: item.__component, __temp_key__: keys[index] }));
  }
  return out;
}

// A kit without locales is universal. Locale-specific kits use exact Strapi locale codes, with a language-only entry
// (for example "pt") also matching regional locales ("pt-BR").
export function starterKitsForLocale(kits, locale) {
  if (!Array.isArray(kits)) return [];
  const current = String(locale || "").toLowerCase();
  const language = current.split("-")[0];
  return kits.filter((kit) => !Array.isArray(kit.locales) || kit.locales.some((entry) => {
    const wanted = String(entry).toLowerCase();
    return wanted === current || (!wanted.includes("-") && wanted === language);
  }));
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
    // Insert variants from the code config ({ id, label, values }); the first is what a quick insert uses.
    variants: Array.isArray(meta.variants) ? meta.variants : [],
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

// The hidden-on-site attribute (server/hidden.js) is known to the Content Manager but never an input: removed from every
// component's edit layout, empty rows dropped. Strapi 5 shape (components[uid].layout = rows) and Strapi 4 shape
// (components[uid].layouts.edit = rows). Only components carry it.
const withoutField = (rows, name) => rows.map((row) => row.filter((field) => field?.name !== name)).filter((row) => row.length);
export function dropField(layout, name) {
  if (!name || !layout?.components) return layout;
  return { ...layout, components: Object.fromEntries(Object.entries(layout.components).map(([uid, component]) =>
    [uid, Array.isArray(component?.layout) ? { ...component, layout: withoutField(component.layout, name) } : component])) };
}
export function dropField4(layout, name) {
  if (!name || !layout?.components) return layout;
  return { ...layout, components: Object.fromEntries(Object.entries(layout.components).map(([uid, component]) =>
    [uid, Array.isArray(component?.layouts?.edit) ? { ...component, layouts: { ...component.layouts, edit: withoutField(component.layouts.edit, name) } } : component])) };
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
// Block label and description from the schema metadata may come as { "<locale>": text } (server schemaMetadata; a null
// source text means "Strapi's own"): resolved once per catalog load, so every consumer reads plain strings.
export function localizeBlocks(catalog, locale) {
  if (!catalog?.components) return catalog;
  const text = (value) => localized(value, locale) ?? undefined;
  return { ...catalog, components: Object.fromEntries(Object.entries(catalog.components).map(([uid, entry]) =>
    [uid, entry && (typeof entry.label === "object" || typeof entry.description === "object") ? { ...entry, label: text(entry.label), description: text(entry.description) } : entry])) };
}
// Per field: config text > schema metadata (merged into catalog.fields by the server, the config winning per text) >
// a label set in "Configure the view" (anything but the raw name) > humanized name (option on).
// Description, placeholder and help change only when the config has them. null: nothing to change.
function fieldText(fields, owner, name, label, locale, on) {
  const entry = (owner && fields?.[owner]?.[name]) || {};
  const out = {};
  const text = localized(entry.label, locale) ?? (on && label === name ? humanize(name) : undefined);
  if (text !== undefined) out.label = text;
  for (const key of ["description", "placeholder", "help"]) {
    const value = localized(entry[key], locale);
    if (value != null) out[key] = value;
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
// Where the icon cannot go, the help text follows the description under the input.
const withHelp = (description, help) => (description ? `${description} ${help}` : help);
// Strapi 5 edit layout: layout = panels > rows > fields ({ name, label, hint, placeholder, labelAction }),
// components[uid].layout = rows. `help` becomes the field's labelAction through `helpAction(text, labelAction)` (an info
// icon next to the label, kept with the action another plugin set, i18n's globe); without it, it joins the hint.
export function labelEditLayout(layout, catalog, locale, helpAction) {
  if (labelsOff(catalog) || !Array.isArray(layout?.layout) || !layout.layout.length) return layout;
  const uid = layoutType(layout, catalog.types);
  if (uid === false || (uid && catalog.contentTypes?.[uid]?.enabled === false)) return layout;
  const fix = (owner) => (field) => {
    const text = field && fieldText(catalog.fields, owner, field.name, field.label, locale, catalog.editor.friendlyLabels);
    if (!text) return field;
    const { description, help, ...rest } = text;
    const hint = description ?? field.hint;
    return { ...field, ...rest, ...(description !== undefined && { hint }),
      ...(help !== undefined && (helpAction ? { labelAction: helpAction(help, field.labelAction) } : { hint: withHelp(hint, help) })) };
  };
  return {
    ...layout,
    layout: layout.layout.map((panel) => panel.map((row) => row.map(fix(uid)))),
    components: Object.fromEntries(Object.entries(layout.components || {}).map(([cuid, component]) =>
      [cuid, Array.isArray(component?.layout) ? { ...component, layout: component.layout.map((row) => row.map(fix(cuid))) } : component])),
  };
}
// Strapi 4 edit layout: contentType.layouts.edit and components[uid].layouts.edit are rows of { name, metadatas }.
// Strapi 4 passes a labelAction to top-level fields only (never to component fields, where blocks live): help joins
// the description under the input.
export function labelEditLayout4(layout, catalog, locale) {
  const uid = layout?.contentType?.uid;
  if (labelsOff(catalog) || !uid || catalog.contentTypes?.[uid]?.enabled === false) return layout;
  const fix = (owner) => (field) => {
    const text = field?.metadatas && fieldText(catalog.fields, owner, field.name, field.metadatas.label, locale, catalog.editor.friendlyLabels);
    if (!text) return field;
    const { help, ...rest } = text;
    const metadatas = { ...field.metadatas, ...rest };
    return { ...field, metadatas: help === undefined ? metadatas : { ...metadatas, description: withHelp(metadatas.description, help) } };
  };
  const rows = (target, owner) => Array.isArray(target?.layouts?.edit)
    ? { ...target, layouts: { ...target.layouts, edit: target.layouts.edit.map((row) => row.map(fix(owner))) } } : target;
  return { ...layout, contentType: rows(layout.contentType, uid),
    components: Object.fromEntries(Object.entries(layout.components || {}).map(([cuid, component]) => [cuid, rows(component, cuid)])) };
}
