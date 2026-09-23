# Release checklist

Repository: https://github.com/aduptive/strapi-plugin-block-picker
Package: `@aduptive/strapi-block-picker` (one name, two distributions).

1. `npm ci && npm run check` (unit tests, build, both tarballs, allowlist).
2. Run the browser smoke against both local labs
   (`node scripts/browser-smoke.mjs 4` with Node 20, `... 5` with Node 22,
   see `docs/LOCAL-TESTING.md`).
3. Bump the version in `packages/strapi4/package.json` and/or
   `packages/strapi5/package.json`; add a `CHANGELOG.md` entry.
4. `npm pack --dry-run` in each package and read the file list (only `dist`,
   the two entry files, README and LICENSE).
5. Publish with explicit dist-tags, never a bare `npm publish`:

   ```sh
   cd packages/strapi4 && npm publish --access public --tag strapi4
   cd packages/strapi5 && npm publish --access public --tag next
   ```

   `latest` is set to the Strapi 5 distribution once a stable 2.x exists;
   while only alphas are published, `latest` points at the newest 2.x alpha so
   `npm install @aduptive/strapi-block-picker` installs the Strapi 5 build.
6. Tag the commit (`v1.0.0-alpha.1`, `v2.0.0-alpha.1`) and push.
7. Marketplace / Community Hub submission is a separate, later step:
   https://docs.strapi.io/cms/plugins/installing-plugins-via-marketplace
