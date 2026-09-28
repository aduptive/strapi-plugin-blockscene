import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { rmSync, copyFileSync, readFileSync, mkdirSync } from 'node:fs'
const major = Number(process.argv[2])
if (![4, 5].includes(major)) throw new Error('Pass 4 or 5')
if (major === 4 && Number(process.versions.node.split('.')[0]) > 20) throw new Error('Use Node 20 to install the Strapi 4 lab')
// Blockscene comes from this repository; Image Pipeline (also installed in the labs) from its sibling repository.
const pipeline = resolve('../strapi-plugin-image-pipeline')
const version = (root) => JSON.parse(readFileSync(`${root}/packages/strapi${major}/package.json`)).version
const packages = [resolve(`artifacts/aduptive-strapi-blockscene-${version('.')}.tgz`), `${pipeline}/artifacts/aduptive-strapi-image-pipeline-${version(pipeline)}.tgz`]
// Same version, new tarball: npm keeps the installed copy unless it is removed first.
// The pre-rename package (`strapi-block-picker`) must not stay installed next to the new one: Strapi would load both.
for (const slug of ['blockscene', 'block-picker', 'image-pipeline']) rmSync(`.local/strapi${major}/node_modules/@aduptive/strapi-${slug}`, { recursive: true, force: true })
try { execFileSync('npm', ['uninstall', '@aduptive/strapi-block-picker', '--no-audit', '--no-fund'], { cwd: `.local/strapi${major}`, stdio: 'ignore' }) } catch { /* not installed */ }
execFileSync('npm', ['install', ...packages, '--force', '--no-audit', '--no-fund'], { cwd: `.local/strapi${major}`, stdio: 'inherit' })
// Both labs serve the page-preview example from their public folder (same origin as the admin); keep it in sync with examples/.
mkdirSync(`.local/strapi${major}/public/block-preview`, { recursive: true })
for (const file of ['index.html', 'preview.js']) copyFileSync(`examples/page-preview/${file}`, `.local/strapi${major}/public/block-preview/${file}`)
