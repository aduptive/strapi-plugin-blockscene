import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
for (const major of [4, 5]) {
 const out = `packages/strapi${major}`;
 for (const [format, ext] of [['esm', 'mjs'], ['cjs', 'cjs']]) {
  await build({ entryPoints: [`admin/strapi${major}.tsx`], bundle: true, packages: 'external', format, platform: 'browser', target: 'es2020', outfile: `${out}/dist/admin.${ext}`, jsx: 'automatic' });
 }
 await build({ entryPoints: ['server/index.js'], bundle: true, packages: 'external', format: 'cjs', platform: 'node', target: 'node18', outfile: `${out}/dist/server.cjs`,
  // Strapi 4 or 5 package: server features that exist on one major only (version history) are chosen here.
  define: { 'process.env.BLOCKSCENE_STRAPI_MAJOR': JSON.stringify(String(major)) } });
 await copyFile('README.md', `${out}/README.md`);
 await copyFile('LICENSE', `${out}/LICENSE`);
}
