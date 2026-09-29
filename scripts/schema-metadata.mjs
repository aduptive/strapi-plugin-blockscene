// Moves a project's plugin config `fields` and `components` maps into schema metadata (README "Describing blocks and
// fields in the schema"): source-language texts go to pluginOptions.blockscene (and a block description to the native
// info.description) in the schema files, the other languages to one flat <locale>.json per locale. Labels equal to what
// the plugin shows anyway (the humanized attribute name, the component's displayName) are dropped. Idempotent: a file
// is rewritten only when its content changes, with its own indentation and key order.
// Usage: node scripts/schema-metadata.mjs <strapi project dir> [--fields fields.json] [--components components.json]
//          [--out <dir for the translation files, default <project>/config/blockscene>] [--source en] [--dry-run]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { humanize } from '../admin/model.mjs'

const args = process.argv.slice(2)
const flag = (name) => { const index = args.indexOf(`--${name}`); return index === -1 ? undefined : args[index + 1] }
const root = args[0]
if (!root || root.startsWith('--') || (!flag('fields') && !flag('components'))) {
  console.error('Usage: node scripts/schema-metadata.mjs <strapi project dir> [--fields fields.json] [--components components.json] [--out dir] [--source en] [--dry-run]')
  process.exit(1)
}
const source = flag('source') || 'en', dry = args.includes('--dry-run'), outDir = flag('out') || join(root, 'config', 'blockscene')
const readJson = (file) => file ? JSON.parse(readFileSync(file, 'utf8')) : {}
const fieldsMap = readJson(flag('fields')), componentsMap = readJson(flag('components'))

// uid -> schema file (same layout as scripts/fields-skeleton.mjs)
const schemaFiles = {}
const list = (dir) => { try { return readdirSync(dir, { recursive: true }).filter(file => file.endsWith('.json')) } catch { return [] } }
for (const file of list(join(root, 'src', 'api'))) {
  const [name, folder, type, schema] = file.split(sep)
  if (folder === 'content-types' && schema === 'schema.json') schemaFiles[`api::${name}.${type}`] = join(root, 'src', 'api', file)
}
for (const file of list(join(root, 'src', 'components'))) {
  const parts = file.split(sep)
  if (parts.length === 2) schemaFiles[`${parts[0]}.${parts[1].replace(/\.json$/, '')}`] = join(root, 'src', 'components', file)
}
const docs = {}
const load = (uid) => {
  if (docs[uid] || !schemaFiles[uid]) return docs[uid]
  const text = readFileSync(schemaFiles[uid], 'utf8'), json = JSON.parse(text)
  return (docs[uid] = { file: schemaFiles[uid], text, json, before: JSON.stringify(json) })
}
// pluginOptions.blockscene of a schema or attribute, created on demand (before `before` when given, as Strapi orders it).
const options = (holder, before) => {
  if (!holder.pluginOptions && before in holder) {
    const entries = Object.entries(holder)
    for (const key of Object.keys(holder)) delete holder[key]
    for (const [key, value] of entries) { if (key === before) holder.pluginOptions = {}; holder[key] = value }
  }
  return ((holder.pluginOptions ||= {}).blockscene ||= {})
}
// A config text (string or { "<locale>": text }) as the source-language text and the other locales.
const lang = (key) => key.toLowerCase().split('-')[0]
const split = (value) => {
  if (typeof value === 'string') return { text: value, others: {} }
  if (!value || typeof value !== 'object') return { others: {} }
  const keys = Object.keys(value)
  const key = keys.find(k => k.toLowerCase() === source.toLowerCase()) ?? keys.find(k => lang(k) === lang(source))
  return { text: key === undefined ? undefined : value[key], others: Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) }
}
const translations = {}
const translate = (key, others) => { for (const [locale, text] of Object.entries(others)) (translations[locale] ||= {})[key] = text }
const skipped = [], remaining = []

for (const [uid, attributes] of Object.entries(fieldsMap)) {
  const doc = load(uid)
  if (!doc) { skipped.push(uid); continue }
  for (const [name, entry] of Object.entries(attributes || {})) {
    const attr = doc.json.attributes?.[name]
    if (!attr) { skipped.push(`${uid}.${name}`); continue }
    for (const key of ['label', 'description', 'placeholder', 'help']) {
      if (entry?.[key] === undefined) continue
      const { text, others } = split(entry[key])
      if (text !== undefined && !(key === 'label' && text === humanize(name))) options(attr)[key] = text
      // "<uid>.description" is a block's own description: a component attribute named so takes the explicit ".label".
      translate(key !== 'label' ? `${uid}.${name}.${key}` : !uid.includes('::') && name === 'description' ? `${uid}.description.label` : `${uid}.${name}`, others)
    }
  }
}
const BLOCK_KEYS = ['label', 'description', 'category', 'typology', 'tags', 'keywords', 'image']
for (const [uid, entry] of Object.entries(componentsMap)) {
  const doc = !uid.includes('::') && load(uid)
  if (!doc || !entry || typeof entry !== 'object') { skipped.push(uid); continue }
  const { json } = doc
  const kept = Object.keys(entry).filter(key => !BLOCK_KEYS.includes(key))
  if (kept.length) remaining.push(`${uid}: ${kept.join(', ')}`)
  const label = split(entry.label)
  if (label.text !== undefined && label.text !== json.info?.displayName) options(json, 'attributes').label = label.text
  translate(uid, label.others)
  const description = split(entry.description)
  if (description.text !== undefined) (json.info ||= {}).description = description.text
  translate(`${uid}.description`, description.others)
  for (const key of ['typology', 'keywords', 'image']) if (entry[key] !== undefined) options(json, 'attributes')[key] = entry[key]
  // The legacy `category` filters as a tag when there are no tags (server catalog).
  const tags = Array.isArray(entry.tags) && entry.tags.length ? entry.tags : typeof entry.category === 'string' ? [entry.category] : undefined
  if (tags) options(json, 'attributes').tags = tags
}

const write = (file, text) => { if (!dry) writeFileSync(file, text) }
const changed = []
for (const doc of Object.values(docs)) {
  if (JSON.stringify(doc.json) === doc.before) continue
  const indent = doc.text.match(/^[ \t]+(?=")/m)?.[0] || '  '
  write(doc.file, JSON.stringify(doc.json, null, indent) + (doc.text.endsWith('\n') ? '\n' : ''))
  changed.push(doc.file)
}
if (Object.keys(translations).length && !dry) mkdirSync(outDir, { recursive: true })
for (const [locale, entries] of Object.entries(translations)) {
  const file = join(outDir, `${locale}.json`)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const merged = { ...(current ? JSON.parse(current) : {}), ...entries }
  const text = JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map(key => [key, merged[key]])), null, 2) + '\n'
  if (text !== current) { write(file, text); changed.push(file) }
}
console.log(`${dry ? '[dry run] ' : ''}${changed.length} file(s) ${dry ? 'would change' : 'changed'}${changed.map(file => `\n  ${file}`).join('')}`)
if (Object.keys(translations).length) console.log(`Plugin config: translations: { ${Object.keys(translations).map(locale => `'${locale}': require('./blockscene/${locale}.json')`).join(', ')} } (paths relative to config/plugins.js when --out is the default)`)
if (skipped.length) console.log(`Not found in the schema files (left in the config, or stale): ${skipped.join(', ')}`)
if (remaining.length) console.log(`Keys that stay in the plugin config \`components\`:\n  ${remaining.join('\n  ')}`)
console.log('Once checked, remove the migrated `fields` map and the migrated `components` keys (not the ones listed above) from the plugin config: the config wins over the schema.')
