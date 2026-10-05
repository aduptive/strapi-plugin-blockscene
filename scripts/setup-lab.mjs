import { mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomBytes } from 'node:crypto'
const major = Number(process.argv[2])
if (![4, 5].includes(major)) throw new Error('Usage: node scripts/setup-lab.mjs 4|5')
const version = major === 4 ? '4.26.1' : '5.52.1'
// LAB_DIR: generate somewhere else (e.g. a throwaway directory to check this script) instead of .local.
const root = resolve(process.env.LAB_DIR || '.local', `strapi${major}`)
if (existsSync(root)) throw new Error('Lab already exists; refusing to overwrite its database or credentials')
const write = (path, content) => { if (path.endsWith('.js') && !/^export /m.test(content)) new Function(content); const full = join(root, path); mkdirSync(resolve(full, '..'), { recursive: true }); writeFileSync(full, content) }
const json = (path, value) => write(path, JSON.stringify(value, null, 2) + '\n')
const dependencies = { '@strapi/strapi': version, '@strapi/admin': version, 'better-sqlite3': major === 4 ? '9.6.0' : '12.8.0', react: '18.3.1', 'react-dom': '18.3.1', 'react-router-dom': major === 4 ? '5.3.4' : '6.30.3', 'styled-components': major === 4 ? '5.3.11' : '6.1.19' }
// Latest packed alpha of each plugin: this repository's artifacts and the sibling image-pipeline repository.
for (const [directory, slug] of [[resolve('artifacts'), 'blockscene'], [resolve('../strapi-plugin-image-pipeline/artifacts'), 'image-pipeline']]) {
 const name = readdirSync(directory).filter(file => file.startsWith(`aduptive-strapi-${slug}-${major === 4 ? 1 : 2}.0.0-`) && file.endsWith('.tgz')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop()
 if (!name) throw new Error(`Build and pack ${slug} first`)
 dependencies[`@aduptive/strapi-${slug}`] = `file:${join(directory, name)}`
}
json('package.json', { name: `strapi${major}-plugin-lab`, private: true, scripts: { build: 'strapi build', start: 'strapi start', develop: 'strapi develop' }, dependencies, overrides: Object.fromEntries(['admin', 'data-transfer', 'logger', 'permissions', 'types', 'typescript-utils'].map(name => [`@strapi/${name}`, version])) })
write('config/server.js', `module.exports = { host: '127.0.0.1', port: ${major === 4 ? 1444 : 1445}, app: { keys: ${JSON.stringify([randomBytes(24).toString('hex'), randomBytes(24).toString('hex')])} } }\n`)
write('config/admin.js', `module.exports = { auth: { secret: '${randomBytes(32).toString('hex')}' }, apiToken: { salt: '${randomBytes(32).toString('hex')}' }, transfer: { token: { salt: '${randomBytes(32).toString('hex')}' } }, secrets: { encryptionKey: '${randomBytes(32).toString('hex')}' } }\n`)
write('config/database.js', `const path = require('node:path'); module.exports = { connection: { client: 'sqlite', connection: { filename: path.join(__dirname, '../.tmp/data.db') }, useNullAsDefault: true } }\n`)
write('config/middlewares.js', `module.exports = ['strapi::logger', 'strapi::errors', 'strapi::security', 'strapi::cors', 'strapi::poweredBy', 'strapi::query', 'strapi::body', 'strapi::session', 'strapi::favicon', 'strapi::public']\n`)
write('config/plugins.js', `// Lab switch: BLOCK_PICKER_GROUPS unset/1 = generic group pair configured; 0 = no config (every block ordinary); bad = malformed config (ignored with a warning).
const groups = process.env.BLOCK_PICKER_GROUPS === '0' ? null : process.env.BLOCK_PICKER_GROUPS === 'bad' ? { 'group.section': 'group.section' } : { 'group.section': 'group.end' }
module.exports = { 'blockscene': { enabled: true, config: { groups,
  kits: { 'api::page.page': [{ id: 'landing', label: 'Landing page', zones: { blocks: [{ __component: 'blocks.hero', title: 'Starter headline' }] } }] },
  components: { 'blocks.hero': { label: 'Hero example', description: 'A heading with nested defaults.', category: 'Editorial', keywords: 'banner', image: '/block-previews/hero.svg' } }
} }, 'image-pipeline': { enabled: true } }

if (process.env.IMAGE_HOOK_SMOKE === '1') module.exports['image-pipeline'].config = { hooks: require(${JSON.stringify(resolve('../strapi-plugin-image-pipeline/tests/fixtures/image-hooks.cjs'))}), hookTimeoutMs: 250 };\n`)
write('src/admin/app.js', `// Lab host only: offer the admin UI locales the plugin ships, so locale switching can be tested.
export default {
  config: { locales: ['pt-BR', 'pt', 'fr', 'es', 'de', 'it', 'nl', 'ja'] },
  bootstrap() {},
}
`)
json('src/components/shared/item.json', { collectionName: 'components_shared_items', info: { displayName: 'Item' }, attributes: { label: { type: 'string', default: 'Nested default' } } })
json('src/components/blocks/hero.json', { collectionName: 'components_blocks_heroes', info: { displayName: 'Hero' }, attributes: { title: { type: 'string', default: 'Hello from Strapi', required: true }, visible: { type: 'boolean', default: false }, items: { type: 'component', component: 'shared.item', repeatable: true, required: true, min: 2 }, image: { type: 'media', multiple: false, allowedTypes: ['images'] } } })
// Strapi 5: a relation in a block, so duplicate and copy/paste are checked to keep relations.
json('src/components/blocks/text.json', { collectionName: 'components_blocks_texts', info: { displayName: 'Text' }, attributes: { body: { type: 'text' }, ...(major === 5 && { pages: { type: 'relation', relation: 'oneToMany', target: 'api::page.page' } }) } })
// Layout group pair (plugin config `groups`).
json('src/components/group/section.json', { collectionName: 'components_group_sections', info: { displayName: 'Section (group open)', description: 'Lab group: opens a section that ends at Section end.' }, options: {}, attributes: { note: { type: 'string' } } })
json('src/components/group/end.json', { collectionName: 'components_group_ends', info: { displayName: 'Section end (group close)', description: '' }, options: {}, attributes: {} })
json('src/api/page/content-types/page/schema.json', { kind: 'collectionType', collectionName: 'pages', info: { singularName: 'page', pluralName: 'pages', displayName: 'Page' }, options: { draftAndPublish: true }, attributes: { title: { type: 'string', required: true }, blocks: { type: 'dynamiczone', components: ['blocks.hero', 'blocks.text', 'group.section', 'group.end'], max: 12 }, sidebar: { type: 'dynamiczone', components: ['blocks.text'], max: 1 } } })
// Core REST API: the smoke reads /api/pages to check hidden blocks in the content API.
for (const [kind, factory] of [['routes', 'createCoreRouter'], ['controllers', 'createCoreController'], ['services', 'createCoreService']])
 write(`src/api/page/${kind}/page.js`, `'use strict'\nmodule.exports = require('@strapi/strapi').factories.${factory}('api::page.page')\n`)
if (major === 5) {
 // Lab-only route (never in the plugin): the document service called directly, to prove the publish guard also
 // intercepts create/update with status 'published'.
 write('src/api/page/routes/lab-direct.js', `'use strict'
module.exports = { routes: [
  { method: 'POST', path: '/lab-direct/create-published', handler: 'lab-direct.createPublished', config: { auth: false, policies: [] } },
  { method: 'POST', path: '/lab-direct/update-published/:documentId', handler: 'lab-direct.updatePublished', config: { auth: false, policies: [] } },
] }
`)
 write('src/api/page/controllers/lab-direct.js', `'use strict'
const run = async (ctx, fn) => {
  try { const doc = await fn(); ctx.body = { ok: true, documentId: doc?.documentId, publishedAt: doc?.publishedAt ?? null } }
  catch (error) { ctx.status = error?.name === 'ValidationError' ? 400 : 500; ctx.body = { ok: false, name: error?.name, message: error?.message, details: error?.details } }
}
module.exports = {
  createPublished: (ctx) => run(ctx, () => strapi.documents('api::page.page').create({ data: ctx.request.body?.data || {}, status: 'published' })),
  updatePublished: (ctx) => run(ctx, () => strapi.documents('api::page.page').update({ documentId: ctx.params.documentId, data: ctx.request.body?.data || {}, status: 'published' })),
}
`)
}
// The page-preview example the smoke uses as the preview route (refresh-lab keeps it in sync).
mkdirSync(join(root, 'public/block-preview'), { recursive: true })
for (const file of ['index.html', 'preview.js']) copyFileSync(`examples/page-preview/${file}`, join(root, 'public/block-preview', file))
const access = { email: 'editor@example.test', password: randomBytes(18).toString('base64url') + 'aA1!' }
json('lab-access.json', access)
write('src/index.js', `module.exports = { async bootstrap({ strapi }) { const access = require('../lab-access.json'); const existing = await strapi.db.query('admin::user').findOne({ where: { email: access.email } }); if (!existing) { const role = await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } }); await strapi.admin.services.user.create({ ...access, firstname: 'Local', lastname: 'Tester', isActive: true, roles: [role.id] }); } } }\n`)
write('public/uploads/.gitkeep', '')
write('public/block-previews/hero.svg', "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"360\" viewBox=\"0 0 640 360\"><rect width=\"640\" height=\"360\" fill=\"#f1f0ff\"/><rect x=\"40\" y=\"52\" width=\"64\" height=\"8\" rx=\"4\" fill=\"#7b79a8\"/><rect x=\"40\" y=\"110\" width=\"240\" height=\"24\" rx=\"4\" fill=\"#32324d\"/><rect x=\"40\" y=\"152\" width=\"200\" height=\"10\" rx=\"4\" fill=\"#8e8ea9\"/><rect x=\"40\" y=\"174\" width=\"224\" height=\"10\" rx=\"4\" fill=\"#8e8ea9\"/><rect x=\"40\" y=\"220\" width=\"120\" height=\"36\" rx=\"5\" fill=\"#4945ff\"/><rect x=\"340\" y=\"60\" width=\"250\" height=\"240\" rx=\"16\" fill=\"#c9c7ff\"/><circle cx=\"465\" cy=\"180\" r=\"65\" fill=\"#a5a1ff\"/></svg>")
write('favicon.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=', 'base64'))
console.log(`Created isolated Strapi ${version} in ${root}`)
