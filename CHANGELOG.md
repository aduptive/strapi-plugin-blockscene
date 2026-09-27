# Changelog

## Unreleased

- Lazy rich-text editors (Strapi 5): fields listed in the new editor option
  `lazyFields` (default `["plugin::ckeditor5.CKEditor"]`, up to 20 custom field
  uids) render a sanitized read-only preview and mount the real editor on click,
  Enter/Space or focus. New option `lazyEditors` (default on) with a Settings
  toggle and uid list. The page preview's field focus activates it first.
- Open all opens the rows near the viewport a few per frame and the rest as
  they approach while scrolling; Close all closes the visible rows first and
  the rest in idle callbacks. On a 34-block CKEditor page (Strapi 5.31) the
  longest long task went from 2.9 s to 0.14 s (open all) and 1.6 s to 0.14 s
  (close all).
- Hover sync (Strapi 5, side by side): a hovered form row outlines its block in
  the page and a hovered block outlines its form row (primary color, no
  scroll); an edge arrow scrolls the form to a row out of view. New bridge
  message `hover` in both directions (`key` or `null`, sent on change,
  validated against the current rows); pages that ignore it keep working.
- Open all / Close all moved from the side panel to beside each zone's native
  label pill, injected like the row thumbnails.
- New editor option `showRowThumbnails` (default on) with a Settings toggle.
- Split divider: always visible, neutral with a grip, primary on hover or drag,
  12 px hit area; a double click resets it to half.

- Preview canvas: the admin's page background with a faint 24 px grid, both from
  the theme (a customised admin carries over), behind the page (whole-page pane
  and the gallery's magnified block).
- Sidebar drawer/modal: the edit view's cards around the shown fields lose their
  border and padding; the drawer is the frame.

- Gallery: the detail pane became a magnified block. A click grows the card
  into a large panel over the grid (FLIP, ~250 ms, none with reduced motion)
  with a live preview at Fit/Mobile/Tablet/Desktop widths over the instant
  thumbnail, and a compact strip with Insert. Live source: the new
  `editor.blockPreviewUrl` (plain page per block, placeholders `{uid}`,
  `{name}`, `{category}`, `{variant}`, `{locale}`), else the page preview
  route through the bridge (one block of schema defaults, read-only), else the
  image. 8 s timeout keeps the image with a note. `DEVICES`/`frameStyle` moved
  to `admin/devices.ts`, shared with the page preview.

- Block dialog (visual editor): the block's own accordion header and the zone's
  connector line are hidden while it is open; the dialog bar names the block.

- Undo and redo of the whole edit view (Strapi 5): buttons in the Blockscene
  panel and the pane toolbar, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Ctrl+Y outside
  text fields. Steps coalesce within 400 ms, up to 100; the history starts over
  on another document, locale or after a Save.
- Project defaults from code: the plugin config `settings` (same shape as the
  stored settings) is the baseline under what the Settings page saves. Saved
  palette/editor keys win key by key, saved components/contentTypes entries
  per uid; only the differences are stored. Invalid code settings are ignored
  with a warning. `GET /blockscene/settings` returns `projectDefaults`;
  `DELETE /blockscene/settings` and the "Restore project defaults" / "Reset to
  defaults" button remove the saved document.
- Settings: visual editor sidebar editor per content type (Strapi 5): position,
  items with label, icon, drawer or modal, fields, reorder and remove, up to 12.
  Invalid items block Save.

- Gallery as a block browser: collapsible sidebar (All, Recently used,
  Starred, typologies), Tags/Media/Content filter menus with chips, facet
  badges, stars, hover quick insert and a detail pane. Facets come from the
  schema; typology is guessed and overridable, with tags, in Settings or the
  config. Stars and recents are stored per admin user (`/blockscene/me/prefs`).
  The category select is gone; `category` in the config now acts as a tag.

- Icon buttons with tooltips for the tools: open/close all, the three preview
  modes and the four widths (accessible names unchanged). Add block, Save and
  Publish keep their text.

- Visual editor sidebar (per content type, left/right/bottom): buttons that open
  some of the document's own fields (native inputs, components and repeatables
  included) in a modal or a drawer. Configured through the settings API for now.

- Page preview widths: Fit, Mobile (390), Tablet (834), Desktop (1440). The
  page renders at the device width and scales down to fit the pane.
- Settings, Content types: turn the plugin off per content type (its edit view
  stays native) and choose the mode each type opens in (Strapi 5).
- The configured opening mode now applies every time; switching modes while
  editing is no longer remembered by the browser.
- Visual editor: a click on a field or block opens the whole block (its native
  form) over the page, the clicked field focused and outlined, instead of a
  one-field dialog. Done, Esc or the backdrop close it.
- Fix: focusing a CKEditor field from the page picked CKEditor's hidden helper
  input and never focused (side by side and visual editor).
- Kill switch: "Blockscene enabled" off in Settings now stops the whole plugin at
  once, the server publish check for layout groups included (before, only the
  editor UI); a content type turned off skips the check too. No restart.
- A render error inside the plugin now unmounts only the plugin and shows a
  notice; the native edit view keeps working.
- Several zones: each group of Open all / Close all carries its zone name.
- No preview route configured: the mode buttons are hidden (only the hint).
- The edit view panel is titled "Blockscene" (it holds more than the gallery), and
  the gallery button reads "Add block" instead of "Add block: <field name>".
- Group diagnostics: readable detail text (dark theme), hints on their own
  line, the repair button wraps left-aligned.

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
