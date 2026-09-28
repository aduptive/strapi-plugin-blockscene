# Release checklist

Repository: https://github.com/aduptive/strapi-plugin-blockscene
Package: `@aduptive/strapi-blockscene` (one name, two distributions).

1. `npm ci && npm run check` (unit tests, build, both tarballs, allowlist).
2. Run the browser smoke against both local labs
   (`node scripts/browser-smoke.mjs 4` with Node 20, `... 5` with Node 22,
   see `docs/LOCAL-TESTING.md`).
3. Bump the version in `packages/strapi4/package.json` and/or
   `packages/strapi5/package.json`; add a `CHANGELOG.md` entry.
4. `npm pack --dry-run` in each package and read the file list (only `dist`,
   the two entry files, README and LICENSE).
5. Commit the bump through a PR and merge it. Then tag the merge commit and
   push the tag; `.github/workflows/release.yml` publishes from GitHub Actions
   with npm trusted publishing (no token, provenance attached), after checking
   the tag matches the package version, the CHANGELOG has the version and
   `npm run check` passes:

   ```sh
   git tag v2.0.0-alpha.7 && git push origin v2.0.0-alpha.7   # Strapi 5, dist-tag latest
   git tag v1.0.0-alpha.7 && git push origin v1.0.0-alpha.7   # Strapi 4, dist-tag strapi4
   ```

   Never publish from a laptop. One-time setup (done once for the
   package): npmjs.com, `@aduptive/strapi-blockscene`, Settings, Trusted
   publisher, GitHub Actions, repository `aduptive/strapi-plugin-blockscene`,
   workflow `release.yml`.
6. Check the run in the repository's Actions tab and `npm view
   @aduptive/strapi-blockscene dist-tags`.
7. Marketplace / Community Hub submission is a separate, later step:
   https://docs.strapi.io/cms/plugins/installing-plugins-via-marketplace
