// Starting point for the plugin config `fields`: every attribute of a project's content types and components, with its
// humanized English label. Usage: node scripts/fields-skeleton.mjs <strapi project dir> > config/blockscene-fields.json
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { humanize } from '../admin/model.mjs'

const root = process.argv[2]
if (!root) { console.error('Usage: node scripts/fields-skeleton.mjs <strapi project dir>'); process.exit(1) }
const files = (dir) => { try { return readdirSync(dir, { recursive: true }).filter(file => file.endsWith('.json')) } catch { return [] } }
const out = {}
const add = (uid, file) => {
  const attributes = JSON.parse(readFileSync(file, 'utf8')).attributes || {}
  out[uid] = Object.fromEntries(Object.keys(attributes).map(name => [name, { label: { en: humanize(name) } }]))
}
// src/api/<api>/content-types/<type>/schema.json -> api::<api>.<type>
const api = join(root, 'src', 'api')
for (const file of files(api)) {
  const [name, folder, type, schema] = file.split(sep)
  if (folder === 'content-types' && schema === 'schema.json') add(`api::${name}.${type}`, join(api, file))
}
// src/components/<category>/<name>.json -> <category>.<name>
const components = join(root, 'src', 'components')
for (const file of files(components)) {
  const parts = file.split(sep)
  if (parts.length === 2) add(`${parts[0]}.${parts[1].replace(/\.json$/, '')}`, join(components, file))
}
console.log(JSON.stringify(out, null, 2))
