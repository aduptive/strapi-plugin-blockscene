import { generateNKeysBetween } from "fractional-indexing";
import { canonical, diffRows, kept, same } from "../server/diff.js";
import { toConnect } from "./rows.mjs";

// Version history in the Strapi 5 edit view: pure helpers for the History section (diff against the form, load a
// version into the form). A snapshot is canonical (server/diff.js): media as ids, relations as { documentId, locale }.

const targetOf = (attr) => attr.targetModel || attr.target;
const list = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const withKeys = (rows) => {
  const keys = rows.length ? generateNKeysBetween(null, null, rows.length) : [];
  return rows.map((row, i) => ({ ...row, __temp_key__: keys[i] }));
};

// What loading `snapshot` would change in the form: top-level fields that differ and, per Dynamic Zone, the block diff
// (before: the form, after: the version). Relations are left out: the form holds relation changes, not relations.
export function formDiff(snapshot, formValues, schema, components) {
  const schemaOf = (uid) => components?.[uid];
  const version = canonical(snapshot, schema, schemaOf, { relations: false });
  const form = canonical(formValues, schema, schemaOf, { relations: false });
  const zones = [];
  const fields = [];
  for (const [name, attr] of Object.entries(schema?.attributes || {})) {
    if (!kept(name, attr) || attr.type === "relation") continue;
    if (attr.type === "dynamiczone") {
      const ops = diffRows(form[name] || [], version[name] || []).filter((op) => op.op !== "same");
      if (ops.length) zones.push({ name, ops });
    } else if (!same(form[name], version[name])) fields.push(name);
  }
  return { fields, zones };
}

// Form values with `snapshot` loaded, for `setValues` (the mechanism undo uses: nothing is saved until the editor saves,
// and undo reverts it). Components and blocks become new rows (no ids; Strapi recreates them on save, as its own
// history restore does), their relations `connect` lists. Top-level relations become the connect/disconnect change from
// what the server holds (`server[field]`: the relations the document has now; missing: the field is left as it is).
// `media`: id -> file, `relations`: target uid -> [{ id, documentId, locale, label }], both the ones that still exist.
// `editable(name)`: top-level fields the user may update; the others are left as they are. The report lists what was
// not loaded: fields left as they are, fields the version has that the schema no longer has, blocks whose component is
// no longer allowed, media files and relation targets that no longer exist.
export function loadVersion(snapshot, { schema, components, current = {}, media = {}, relations = {}, server = {}, editable = () => true }) {
  const schemaOf = (uid) => components?.[uid];
  const report = { left: [], removed: [], blocks: 0, media: 0, relations: 0 };
  const file = (id) => media[id] || (report.media++, null);
  const resolve = (attr, refs) => {
    const targets = relations[targetOf(attr)] || [];
    const found = [];
    for (const ref of refs) {
      const hit = targets.find((r) => r.documentId === ref.documentId && (r.locale || null) === (ref.locale || null)) || targets.find((r) => r.documentId === ref.documentId);
      if (hit) found.push(hit);
      else report.relations++;
    }
    return found;
  };
  // A new component row (or a component value) from its snapshot.
  const build = (data, schema) => {
    const out = {};
    for (const [name, attr] of Object.entries(schema?.attributes || {})) {
      const value = data?.[name];
      if (!kept(name, attr)) continue;
      if (attr.type === "relation") out[name] = toConnect(resolve(attr, list(value)), targetOf(attr));
      else if (value === undefined || value === null) continue;
      else if (attr.type === "media") {
        if (attr.multiple) out[name] = list(value).map(file).filter(Boolean);
        else out[name] = file(value);
      } else if (attr.type === "component") {
        const child = schemaOf(attr.component);
        out[name] = attr.repeatable ? withKeys(list(value).map((item) => build(item, child))) : build(value, child);
      } else if (attr.type === "dynamiczone") out[name] = zone(attr, value);
      else out[name] = structuredClone(value);
    }
    return out;
  };
  const zone = (attr, rows) =>
    withKeys(list(rows).filter((row) => {
      const ok = row && attr.components?.includes(row.__component) && schemaOf(row.__component);
      if (!ok) report.blocks++;
      return ok;
    }).map((row) => ({ ...build(row, schemaOf(row.__component)), __component: row.__component })));
  const values = { ...current };
  for (const name of Object.keys(snapshot || {})) if (!schema?.attributes?.[name]) report.removed.push(name);
  for (const [name, attr] of Object.entries(schema?.attributes || {})) {
    if (!kept(name, attr)) continue;
    const value = snapshot?.[name];
    const empty = value === undefined || value === null;
    if (!editable(name)) {
      if (!empty || current[name] != null) report.left.push(name);
      continue;
    }
    if (attr.type === "relation") {
      if (!Array.isArray(server[name])) { report.left.push(name); continue; }
      const wanted = resolve(attr, list(value));
      const has = new Set(server[name].map((r) => r.documentId));
      const keep = new Set(wanted.map((r) => r.documentId));
      values[name] = {
        connect: toConnect(wanted.filter((r) => !has.has(r.documentId)), targetOf(attr)).connect,
        disconnect: server[name].filter((r) => !keep.has(r.documentId)).map((r) => ({ id: r.id, status: r.status, apiData: { id: r.id, documentId: r.documentId, locale: r.locale } })),
      };
    } else if (attr.type === "component" || attr.type === "dynamiczone") {
      if (attr.type === "dynamiczone") values[name] = zone(attr, value);
      else if (attr.repeatable) values[name] = withKeys(list(value).map((item) => build(item, schemaOf(attr.component))));
      else values[name] = empty ? null : build(value, schemaOf(attr.component));
    } else if (attr.type === "media") {
      values[name] = attr.multiple ? list(value).map(file).filter(Boolean) : empty ? null : file(value);
    } else if (!empty) values[name] = structuredClone(value);
    // Empty in the version: cleared, but only when the form has something (the form keeps absent values undefined).
    else if (current[name] != null && current[name] !== "") values[name] = null;
  }
  return { values, report };
}
