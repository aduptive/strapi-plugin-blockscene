import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { rmSync } from 'node:fs'
const major = Number(process.argv[2])
if (![4, 5].includes(major)) throw new Error('Pass 4 or 5')
if (major === 4 && Number(process.versions.node.split('.')[0]) > 20) throw new Error('Use Node 20 to install the Strapi 4 lab')
const version = `${major === 4 ? 1 : 2}.0.0-alpha.1`
// The image plugin repository folder kept its old name; its package and artifacts are `image-pipeline`.
const packages = [['block-picker', 'block-picker'], ['image-optimization', 'image-pipeline']].map(([dir, slug]) => resolve(`../strapi-plugin-${dir}/artifacts/aduptive-strapi-${slug}-${version}.tgz`))
// Same version, new tarball: npm keeps the installed copy unless it is removed first.
for (const slug of ['block-picker', 'image-pipeline']) rmSync(`.local/strapi${major}/node_modules/@aduptive/strapi-${slug}`, { recursive: true, force: true })
execFileSync('npm', ['install', ...packages, '--force', '--no-audit', '--no-fund'], { cwd: `.local/strapi${major}`, stdio: 'inherit' })
