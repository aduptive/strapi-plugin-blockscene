import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const major of [4, 5]) {
 const manifest = JSON.parse(readFileSync(`packages/strapi${major}/package.json`));
 assert.equal(manifest.exports['./strapi-server'].require, './strapi-server.js', 'Strapi config loader needs a .js entrypoint');
 const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: `packages/strapi${major}`, encoding: 'utf8' }));
 const files = pack.files.map(file => file.path);
 assert.ok(files.includes('dist/admin.mjs') && files.includes('dist/admin.cjs') && files.includes('dist/server.cjs'));
 assert.ok(files.every(file => /^(dist\/|strapi-(admin|server)\.js$|package\.json$|README\.md$|LICENSE$)/.test(file)), 'Unexpected package contents');
 assert.ok(!files.some(file => /(?:\.env|sqlite|lab-access|node_modules)/.test(file)));
 // The shared admin code (page preview, gallery) must not pull the other major's admin packages into the bundle.
 const admin = readFileSync(`packages/strapi${major}/dist/admin.mjs`, 'utf8');
 const foreign = major === 4 ? /from\s+["']@strapi\/(?:strapi\/admin|content-manager\/strapi-admin)["']/ : /from\s+["']@strapi\/helper-plugin["']/;
 assert.ok(!foreign.test(admin), `Strapi ${major} admin bundle imports the other major's admin packages`);
 console.log(`Strapi ${major}: tarball allowlist OK (${files.length} files)`);
}
