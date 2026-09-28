# Changelog

## Unreleased

- Page preview toolbar (Strapi 5): `editor.previewToolbar` chooses and orders
  the pane toolbar's controls (`modes`, `history`, `devices`, `status`,
  `actions`; missing ones hidden) and `editor.previewDevices` the width menu's
  entries, including custom `{ label, width }` widths (240 to 3840 px, up to 8
  entries; one entry hides the menu). Both can be set per content type, from
  Settings (ordered checklists), `PUT /blockscene/settings` or the code
  `settings`, with strict validation; defaults keep today's full bar (ADU-384).
- Custom sidebar panels (Strapi 5): `app.getPlugin('blockscene').apis.registerPanel({ id,
  label, icon, open, contentTypes, Component })` adds a project's or another
  plugin's own panel to the visual editor sidebar, after the configured field
  items, in a drawer or a modal. The component gets the document, the live form
  values and the form's `onChange`, and runs inside its own error boundary
  (ADU-386).
- Zone bar: the editing tools moved from the Blockscene side panel into the
  form, right after each zone's native label pill. One "Expand all" / "Collapse
  all" button with text replaces the two icons; it follows the rows' real
  `aria-expanded` state (a header toggled by hand counts) and keeps the
  progressive open/close and the remember mode. `showOpenAll` / `showCloseAll`
  are kept: both on, the button toggles; only one on, it offers that action
  alone (disabled when there is nothing to do); both off, no button. On the
  first zone (Strapi 5): Undo and Redo with text, and the editing mode (Fields,
  Fields + page, Visual editor) as a menu with icons when a preview route
  exists. Rarer actions sit in a "…" menu: Select blocks, and Paste N blocks,
  listed only where the copied components are allowed (room and group balance
  are still checked on click, with the same notices). An empty zone gets its
  bar right after its native add button.
- Selection mode is a contextual bar: select all / none (indeterminate while
  some are selected) with the count, Copy (disabled with a reason until a block
  is selected) and Done; Esc leaves. The row checkboxes moved to the start of
  each header.
- The "Add block" gallery button is gone (Strapi 5 and 4): the native "Add a
  component to <zone>" button already opens the gallery. The Blockscene side
  panel (Strapi 5) now only shows version history and layout group problems,
  and is not shown at all when there are none. The zone bars, the gallery
  dialogs and the page preview are mounted from the Entry panel's
  `editView.right-links` injection zone, where they render nothing visible.
- One undo history per edit view (Strapi 5): the zone bar, the pane toolbar
  and the keyboard shortcuts share it, with the editing mode.
- The "No preview URL" hint left the edit view (editors cannot act on it): the
  Settings page explains what happens when the preview route is empty.
- Messages: `expandAll`, `collapseAll`, `moreActions`, `selectBlocks`,
  `selectAll`, `selectNone`, `selectedCount`, `copy`, `copyNothing`,
  `selectDone`, `toggleHelp` and `previewUrlEmpty` added; `add`, `openAll`,
  `closeAll`, `selectMode`, `copySelected`, `previewHelp` and `previewNoUrl`
  removed; `showOpenAll` / `showCloseAll` reworded (8 catalogues).
- Field help (`fields` config, key `help`, up to 500 characters, string or
  per-locale map): on Strapi 5 a long explanation shows as an "i" icon next to
  the field label, with the text in a tooltip on hover and keyboard focus,
  instead of a long hint under the input. It uses the Content Manager's label
  action slot and keeps the i18n globe on localized fields. `description` is
  unchanged. Strapi 4 has no label action on component fields: there the help
  text follows the description under the input.

## 2.0.0-alpha.6 (Strapi 5) and 1.0.0-alpha.6 (Strapi 4) — 2026-09-28

- Page preview toolbar (Strapi 5): the document's state as the edit view header
  shows it (Draft / Modified / Published, same colours and Content Manager
  labels) plus "Unsaved changes" while the form is dirty, replacing the
  "Page preview · unsaved changes" line; Save is the secondary button and
  Publish the primary one, as in the edit view's panel; the four width buttons
  became one menu that keeps their icons (the toolbar stays on one line in a
  narrow pane).
- Fix (Strapi 5.0 to 5.44): the edit view crashed ("Cannot read properties of
  undefined (reading 'type')") on any document with a block whose hidden-on-site
  value had been set. The attribute was `visible: false`, so the Content
  Manager's schema left it out while the data carried it, and Content Managers
  before 5.45 do not tolerate that. It is now a regular attribute removed from
  the components' edit layouts by the layout hook (never an input, Strapi 5 and
  4). The browser smoke reopens a page with a hidden block and checks there is
  no input for it.
- Fix: with friendly labels (or a zone renamed in "Configure the view"), the
  native "Add a component to <zone>" button opened Strapi's picker instead of
  the gallery; it is matched by the zone's rendered label as well as its name.

- Version history (Strapi 5, off by default; ADU-379). A document service
  middleware records one event per create, save, publish, unpublish, discard
  draft and delete of the covered content types (all `api::` types or a list),
  with the actor, a summary against the previous version and a snapshot
  (components and Dynamic Zones in full, relations as documentIds, media as
  ids), deduplicated by hash, in the new hidden content type
  `plugin::blockscene.event` (`blockscene_events`). A failed capture never
  blocks a save or publish (logged, event marked missing) and always fails a
  delete (one transaction; bulk deletes roll back whole). The edit view's
  Blockscene panel gets a History section: versions per locale, a block diff
  against the form and "Load this version" into the form (undo reverts it;
  nothing is saved until the editor saves). New permission `history.read`,
  admin routes `GET /history/:uid/:documentId` and `GET /history-events/:id`,
  Settings and code settings `history` (`enabled`, `contentTypes`,
  `retentionDays` 90, `maxSnapshots` 100, `eventDays` 365, validated) and a
  nightly purge cron (batches of 500, idempotent). Loaded relations show the
  target's Content Manager main field.
- Field labels in the edit view (Strapi 5 and 4), through the Content
  Manager's `mutate-edit-view-layout` hook, no DOM patching: project texts from
  the new plugin config `fields` (label, description, placeholder per content
  type or component attribute, a string or a per-locale map resolved against
  the admin user's interface language), else a label set in "Configure the
  view", else the humanized attribute name (`mobileColumnsCount` → "Mobile
  columns count"). New editor option `friendlyLabels` (default on) with a
  Settings toggle; `fields` is code only and validated at boot (a malformed
  map is ignored, stale entries skipped, with a warning). `scripts/fields-skeleton.mjs`
  generates a starting map from a project's schemas. The catalog now also
  returns `fields` and `types` (display name and attribute names per content
  type, used to identify the Strapi 5 layout).

## 2.0.0-alpha.5 (Strapi 5) and 1.0.0-alpha.5 (Strapi 4) — 2026-09-28

- Row actions in each block header, before the native delete (Strapi 5 and 4):
  hide on the site (eye), duplicate (deep copy right below, groups whole,
  relations and media kept), copy one block or a selection and paste it on any
  page (localStorage `blockscene:clipboard:v1`, all-or-nothing validation
  against the target zone, also from the page preview seams), and a
  confirmation before the native delete. Everything goes through the form, so
  undo/redo covers it. New editor options `confirmDelete`, `duplicate`,
  `clipboard` (default on) and `hiddenBlocks` (`strip` default, `flag`, `off`),
  in Settings and code config.
- Hidden blocks: the plugin adds a boolean attribute (plugin config
  `hiddenAttribute`, default `bsHidden`, `false` to disable) to every Dynamic
  Zone component at register time, hidden from the edit view. This creates a
  column in each of those component tables. In `strip` mode content-API reads
  (Strapi 5 document service middleware, Strapi 4 entity service) drop hidden
  rows; admin reads never do. Page preview blocks carry `hidden: true`; the
  bridge's `update-page` carries `clipboard` and the page may send `paste`.

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
