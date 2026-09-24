# Changelog

## 2.0.0-alpha.4 (Strapi 5) and 1.0.0-alpha.4 (Strapi 4) — 2026-09-24

- Row thumbnails: each added block shows its image in the native accordion
  header; a click opens it full size without toggling the row (#1).
- With layout groups configured, the gallery and the preview picker no longer
  offer a CLOSE component on its own (it is inserted with its OPEN; alone it
  left an unbalanced group that the publish guard then refused).
- Verified on Strapi 5.54.0 with MySQL 8.4 and i18n (en, pt-BR) in a lab of
  the futurebrand-site-global backend, besides 5.52.1 and 4.26.1.

## 2.0.0-alpha.3 (Strapi 5) and 1.0.0-alpha.3 (Strapi 4) — 2026-09-24

- Strapi 5 admin console is quiet: the settings link uses a relative `to` and a
  non-async loader, and `useRBAC` gets a flat permission array (no deprecation
  warnings from the plugin).
- The browser smoke now records console errors and warnings in its report.
- 2.0.0-alpha.2 / 1.0.0-alpha.2 were tagged but never published to npm.

## 2.0.0-alpha.2 (Strapi 5) and 1.0.0-alpha.2 (Strapi 4) — 2026-09-23

- Wider Strapi support: peers are now `>=5.0.0 <6` and `>=4.11.0 <5`, verified
  with the browser smoke on 5.0.0 and 4.11.0 besides 5.52.1 and 4.26.1.
- Dropped the `@strapi/admin` and `@strapi/content-manager` peers: npm
  installed a second, newer copy beside the host's own and broke its admin build.
- Page preview: inserting between blocks no longer overwrites the next block on
  Strapi < 5.8.1 (append, then move).
- Settings page loads on older Strapi 4 such as 4.11 (loader returns a module).

## 2.0.0-alpha.1 (Strapi 5) and 1.0.0-alpha.1 (Strapi 4) — 2026-09-23

Renamed to Blockscene for Strapi before the first npm release: package
`@aduptive/strapi-blockscene`, plugin id `blockscene` (config key, routes
`/blockscene/*`, permissions `plugin::blockscene.*`, env `BLOCKSCENE_DISABLED`,
bridge protocol `blockscene:page-preview:v1`). Settings saved under the
previous id are migrated on first read.

First public pre-releases. Both distributions share the gallery, thumbnails,
wireframes, settings page, accordion preferences, layout groups (optional
OPEN -> CLOSE pairs with a server-side publish guard) and eight UI locales.
The whole-page preview (side-by-side and visual editor modes, editing through
the site's own preview route via a postMessage bridge) is Strapi 5 only.
Alpha: settings, config keys and the bridge protocol may change.

## Earlier — local alpha

- Extract standalone packages with separate Strapi 4 and 5 admin entrypoints.
- Bundle distribution files and validate the npm tarball allowlist.
- Add local regression checks and isolated installation documentation.
- Thumbnail priority: Media Library override > configured image > automatic
  `<previewBaseUrl>/<uid>.webp` (optional `previewVersion`) > SVG wireframe.
- Settings page (both versions): wireframe palette with preview, per-component
  image and template, editor preferences; protected by plugin permissions.
- Accordion controls (open/close all, initial state, remember per user/zone),
  panel bypass and `BLOCKSCENE_DISABLED` emergency bypass.
- Local capture command `scripts/capture-previews.mjs` with a static example.
