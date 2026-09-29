# Local integration laboratory

The two repositories are siblings: `strapi-plugin-blockscene` and
`strapi-plugin-image-optimization`. The original `strapi-block-picker`
experiment is untouched. No client database or frontend is used here.

## Package checks

In each repository, with Node 22:

```sh
npm ci
npm run check
```

The check runs unit tests, builds both distributions, packs them and checks
that npm ships only the distribution, entrypoints, README and manifest.
Server exports intentionally use a `.js` wrapper: Strapi 5.52.1's config
loader ignores `.cjs` as a direct server export.

## First installation

Run from this repository after both plugins have been packed:

```sh
nvm use 20
npm run lab:setup -- 4
npm install --prefix .local/strapi4
npm run build --prefix .local/strapi4
npm start --prefix .local/strapi4
```

In another terminal:

```sh
nvm use 22
npm run lab:setup -- 5
npm install --prefix .local/strapi5
npm run build --prefix .local/strapi5
npm start --prefix .local/strapi5
```

The setup command refuses to overwrite an existing lab. Database, upload
files, generated secrets and credentials stay under ignored `.local/`.
Credentials are in `.local/strapi4/lab-access.json` and
`.local/strapi5/lab-access.json`; they are generated per installation.

| Host | Admin URL | Database |
| --- | --- | --- |
| Strapi 4.26.1, Node 20.11.0 | http://127.0.0.1:1444/admin | `.local/strapi4/.tmp/data.db` |
| Strapi 5.52.1, Node 22.22.1 | http://127.0.0.1:1445/admin | `.local/strapi5/.tmp/data.db` |

Hosts bind to loopback. Stop their terminals before reinstalling a package.
Do not substitute environment files or database configuration from a client.
The fixture contains only a synthetic Page collection, two Dynamic Zones,
nested defaults and an illustrative SVG preview.

## Update an existing installation

Re-run `npm run check` in both plugin repositories. Stop the lab servers, then:

```sh
nvm use 20
npm run lab:refresh -- 4
npm run build --prefix .local/strapi4
# Restart npm start --prefix .local/strapi4

nvm use 22
npm run lab:refresh -- 5
npm run build --prefix .local/strapi5
# Restart npm start --prefix .local/strapi5
```

`lab:refresh` explicitly reinstalls the tarballs, avoiding a stale package
when a local alpha is repacked under the same version. It preserves the DB.
Never reuse a version this way after publishing it to npm.

## Browser and HTTP checks

Keep both hosts running. Browser checks use an installed Google Chrome:

```sh
npm run test:browser -- 4
npm run test:browser -- 5
cd ../strapi-plugin-image-optimization
node scripts/http-smoke.mjs 4
node scripts/http-smoke.mjs 5
```

Browser checks create synthetic drafts; they verify gallery search, schema
defaults, nested components, zone allowlists/max, save/reload, thumbnail
priority (configured image, wireframe fallback, Media Library override, deleted
media, local capture output), the Blockscene settings page (palette, unsaved
indicator, persistence, permissions and validation over HTTP), the accordion
controls (default closed, open/close all, remember mode with a per-user key,
hidden buttons) and the panel bypass. They reuse the API login in the browser
to avoid the login rate limiter, reset Blockscene settings to defaults and
remove the uploaded fixture and the captured `blocks.text.webp` at the end.
HTTP checks verify protected settings, real raster upload/resize/WebP bytes,
SVG sanitization, file limits and replacement behavior. They restore settings
and remove media created after a successful upload response was parsed.

Both smokes also exercise the whole-page preview: `lab:setup` and `lab:refresh`
copy `examples/page-preview/` into `.local/strapi<4|5>/public/block-preview/`
(same origin as the admin, so the bridge script must be an external file to
pass the admin CSP), the smoke sets `editor.previewUrl` through the settings
API, opens side by side, edits a title inline, edits a text field through the
block dialog, picks an image from the Media Library and asserts that nothing
was written before Save.

`SMOKE_PORT=<port>` points the smoke at a lab copy on another port (for example
a copy of `.local/` in a worktree, its `config/server.js` port changed, while
another checkout's lab holds 1444 or 1445).

The capture command can be exercised without Strapi:

```sh
node scripts/capture-previews.mjs --manifest examples/static-preview/manifest.json --out /tmp/previews
```

It must report three captures and one timeout (`blocks.missing`), keeping any
previous `blocks.missing.webp`.

Receipts/screenshots are in each repository's ignored `artifacts/`. Failed
browser runs preserve a screenshot and text summary. They never save login
tokens, browser storage or passwords in public artifacts.

## Verified matrix — 2026-09-21

| Check | Strapi 4.26.1 | Strapi 5.52.1 |
| --- | --- | --- |
| Install both tarballs with normal peer resolution | Passed | Passed |
| Build complete admin | Passed | Passed |
| Gallery, search, nested defaults, save/reload | Passed | Passed |
| Settings UI load/save | Passed | Passed |
| HTTP image/settings suite | Passed | Passed |

Strapi 5's loose transitive ranges initially installed admin 5.54.0 beside
5.52.1, leaving Content Manager loading indefinitely. The fixture pins
matching Strapi modules; consumers should keep core/admin/plugin versions
aligned. Plugin peers deliberately leave admin out (see COMPATIBILITY.md). This finding is based on this
installation, not a claim about every combination of Strapi versions.

Not yet certified: 4.17.1/4.19.1/4.25.x, 5.23.5, limited-role UI, i18n content,
single types, all animation formats and remote upload providers. See
`RELEASE.md` before broadening compatibility or publishing. GitHub workflow
runs package checks only; it does not claim these local host tests ran in CI.

## Layout groups and locales in the labs

Both labs ship generic group components (`group.section` opens, `group.end`
closes) allowed in the page zone (max 12) and `config/plugins.js` maps them:

- default: `groups: { 'group.section': 'group.end' }`;
- `BLOCK_PICKER_GROUPS=0 npm start --prefix .local/strapi5`: no config, every
  component is an ordinary block (the smoke asserts the fallback);
- `BLOCK_PICKER_GROUPS=bad …`: malformed map, ignored with a warning in the
  server log.

`src/admin/app.js` offers pt-BR, pt, fr, es, de, it, nl and ja (ja has no
plugin catalogue: the smoke uses it to assert the English fallback). Run the
smoke with `BLOCK_PICKER_GROUPS` set to the same value as the running lab.

Note (2026-09-22): the companion image plugin is now packaged as
`@aduptive/strapi-image-pipeline` (Strapi plugin id `image-pipeline`) although
its repository folder is still `strapi-plugin-image-optimization`; the lab
scripts map the folder to the new artifact name. `lab:refresh` removes the
installed copies and installs with `--force`, because npm keeps an installed
package when the tarball carries the same version.

## Schema metadata

The smoke step "schema metadata" runs only when the served lab's `blocks.text`
carries schema metadata (the catalog has field texts for `blocks.text.body`).
It is a temporary lab edit, reverted after the run, in both labs:

- `src/components/blocks/text.json`: `info.description` "Paragraphs of text.",
  `pluginOptions.blockscene` `{ "tags": ["Long read"] }` (before `attributes`),
  and on `body` `pluginOptions.blockscene`
  `{ "label": "Body text", "help": "Plain paragraphs, no markup." }`;
- `config/plugins.js`, blockscene config: `translations: { 'pt-BR': {
  'blocks.text': 'Texto', 'blocks.text.description': 'Parágrafos de texto.',
  'blocks.text.body': 'Texto do corpo', 'blocks.text.body.help': 'Parágrafos simples, sem marcação.' } }`.

Restart the lab, then run the smoke as usual. Verified 2026-09-28 on 5.52.1 and
4.26.1 (lab copies in `strapi develop`): Strapi keeps `pluginOptions.blockscene`
on components and attributes at runtime, and editing a field of that component
in the Content-Type Builder and saving keeps it (block and attribute level) and
`info.description` in the JSON file. The same save also writes the plugin's
injected `bsHidden` attribute into the file (both majors).
