# Blockscene for Strapi

A visual gallery for the components already allowed in a native Dynamic Zone,
with configurable thumbnails, SVG wireframes, editor preferences and, on
Strapi 5, a whole-page preview that edits the form through your own frontend.
No renderer, framework or content migration is required.

**Alpha.** Published as pre-releases; APIs, settings and the preview bridge may
still change between alphas. See [compatibility](docs/COMPATIBILITY.md).

## Installation

One npm package, two distributions selected by dist-tag:

```sh
# Strapi 5 (plugin major 2)
npm install @aduptive/strapi-blockscene@next
# Strapi 4 (plugin major 1)
npm install @aduptive/strapi-blockscene@strapi4
```

Install only the matching distribution, then enable it in `config/plugins.js` (or
export the equivalent object in TypeScript):

```js
module.exports = {
  'blockscene': {
    enabled: true,
    config: {
      previewBaseUrl: '/block-previews',
      previewVersion: '2026-09-22', // optional cache buster appended as ?v=
      components: {
        'blocks.hero': {
          label: 'Hero banner',
          description: 'Introduce a page with a prominent title and image.',
          category: 'Editorial',
          keywords: 'heading introduction',
          image: '/block-previews/hero.png',
        },
      },
    },
  },
}
```

Rebuild/restart the admin. Open a content type with a Dynamic Zone. The
editor panel provides one gallery button per editable, non-full zone plus
"Open all blocks" / "Close all blocks" for zones that already have blocks.

## Gallery

The modal has one header row: block count (`34 blocks`, or `3 of 34` while
filtering), search, a category filter (only when the zone spans more than one
category, with counts), a "Fields" switch that shows each block's attribute
list on its card, and a columns slider (1 to 5, remembered per browser). Blocks
are grouped by category, system-like categories (`admin`) last; search and the
category filter combine, and the empty state offers a reset. Categories come
from `config.components[uid].category`, else the component's `category` in its
schema. The modal is 80vw wide.

The native "Add a component to <zone>" button of an editable zone opens this
gallery as well (the click is intercepted in the capture phase; Strapi's
category picker never opens). Zones without the gallery, or with the editor
enhancements off, keep the native picker. The button is recognised by its
label ending with the raw zone name, which Strapi's message carries in every
locale; a zone whose name ends another zone's name (`blocks` and `sub blocks`)
is the documented limit.

## Row thumbnails

Each added block shows its thumbnail at the left of the native accordion
header, and clicking it opens the image full size in a modal instead of
opening or closing the row. The sources are the same as the gallery cards,
minus the wireframe: a block with no image shows nothing, so nothing new is
invented for blocks that were never captured. The thumbnail is inserted into
Strapi's own header through the DOM (no Content Manager patch) and is
restored when Strapi re-renders the list.

## Thumbnail priority

Each card tries these sources in order and moves on when one fails to load.
A failure never blocks selecting the block.

1. **Custom image** chosen in Settings, Blockscene (Media Library file).
2. **Automatic image**: `components[uid].image` from the config, then
   `<previewBaseUrl>/<uid>.webp` (with `?v=<previewVersion>` when set).
3. **Wireframe**: an inline SVG drawn with the configurable palette and the
   template chosen per component (generic, banner, cards, image and text, FAQ),
   or "No preview" (`none`) when no faithful image exists and a wireframe
   would mislead. Without a template, generic is used. Layouts are never
   guessed from the schema.

Generating new automatic images never overwrites a custom image. "Use automatic
image" only removes the override; the Media Library file is kept. If the chosen
file is deleted, the settings page warns and the next source is used.

## Settings page

The page keeps its title, change state ("Unsaved changes", "Saved", "No
unsaved changes") and Save button in a bar that floats over the content area
once the header scrolls out. Components are a responsive card grid. `PUT
/blockscene/settings` replaces the whole document; send the full object.

Settings, Blockscene. Stored in the plugin store; no rebuild or restart is
needed for the gallery to pick them up. Reading requires the
`Blockscene: Read gallery settings` permission and saving requires
`Change gallery settings`; anonymous or unauthorized requests are rejected.

- Wireframe palette (background, surfaces, text, accent) with a live preview
  and "Restore default colors". Colors must be `#RRGGBB`.
- Component list with the effective source, choose/replace image from the
  Media Library, "Use automatic image" and the wireframe template.
- Editor preferences: enhancements on/off, visibility of each collective
  button, initial accordion state and the initial block mode.
- Content types: every project type with a Dynamic Zone, each with on/off
  (off leaves its edit view fully native) and, on Strapi 5, the mode its edit
  views open in ("Default" follows the global preview mode).

### Editor preferences

| Option | Values | Default |
| --- | --- | --- |
| Editor enhancements enabled | on/off | on |
| Show "Open all blocks" | yes/no | yes |
| Show "Close all blocks" | yes/no | yes |
| Initial accordion state | all closed / all open / remember | all closed |
| Preview route base URL (Strapi 5) | full URL or empty | empty: native Preview origin |
| Initial preview mode (Strapi 5) | form / side by side / preview | form |

Every edit view opens in its content type's mode, else the initial preview
mode. Editors can switch while they edit; the switch is not remembered.

The initial state is applied once per document/locale after the blocks
render; edits, reorders and newly inserted blocks are not re-applied. Hiding a
button only hides it; native accordion headers keep working.

"Remember" stores only the last explicit open all / close all click, as
`open`/`closed` in the browser's localStorage, keyed by admin URL, user id,
content type and zone. Another user in the same browser does not inherit it.
Blocked storage or an invalid value falls back to all closed. No sync between
devices.

The accordion controls drive the native Dynamic Zone accordions through their
`aria-expanded` headers, so no Strapi source is patched. They are validated on
the two supported versions only.

## Whole-page preview (Strapi 5)

The Strapi 5 distribution adds a "Page preview" panel with three modes: form,
side by side (resizable pane, native actions moved to a bar above the form) and
preview. The panel posts the live values of the first Dynamic Zone to a page
your frontend serves; the page renders them with its own components and styles
and can ask the admin to open a block, edit a field or pick media. Nothing is
saved or published by the preview.

The pane toolbar sets the page width: Fit (the pane), Mobile (390 px), Tablet
(834 px) or Desktop (1440 px). A device renders at its own width and scales down
when the pane is narrower, so the desktop layout fits side by side; switching
never reloads the page. The choice is remembered per browser.

Minimal configuration:

1. Serve a page that implements the bridge. `examples/page-preview/index.html`
   is a framework-free reference: it answers `ready`/`ping`, renders
   `update-page`, and sends `select`, `focus`, `edit`, `media`, `media-remove`.
   Keep the origin check (`admin` query parameter or your own constant).
2. Allow the admin origin to embed it (`Content-Security-Policy: frame-ancestors`)
   and allow the page origin in the Strapi admin CSP (`frame-src`).
3. Set the full route URL in Settings, Blockscene ("Preview route base URL"),
   or leave it empty to reuse the origin of Strapi's native Preview (when
   configured for the content type) with `/block-preview/page` appended.
   Use the same host name the frontend dev server was started for
   (`localhost` vs `127.0.0.1`): Next 16 refuses its dev WebSocket for the
   other one and the page then never hydrates, so `ready` never arrives and
   the panel reports the preview as unavailable with no error in either console.

The bridge only exposes what the schema allows: attributes marked `private`
are never projected, focused or edited; media URLs are passed through for any
http(s) host (S3/CDN providers included) and same-origin paths; the zone shown
is the first Dynamic Zone the user may read, and editing additionally needs the
update permission on it. Pending dialogs are dropped when the document or
locale changes.

Editing from the page: plain-text areas the page explicitly maps
(`data-block-field` + `contenteditable="plaintext-only"`) send `edit`; any other
editable field opens an admin modal with the field's own native input (custom
fields such as CKEditor keep their options; string/text use the admin input).
Apply updates the form and the preview; Cancel discards only the modal. Media
fields open the native Media Library. Everything is validated against the schema
and the zone's edit permission; a published page never receives unsaved values
by itself. Strapi 4 does not have this panel yet (see `docs/BACKLOG.md`).

## Layout groups (optional)

Some sites keep "wrappers" in the flat Dynamic Zone: an OPEN component, the
blocks it wraps, then a CLOSE marker component. The plugin has no built-in idea
of such components: with no configuration every component is an ordinary block,
and a wrapper-like component without a renderer on your preview page gets the
same localized "no preview renderer" fallback as any other block, with its
native form untouched. Opt in per site by mapping each OPEN uid to its CLOSE uid
in the plugin config (code config, validated at boot; there is no UI for it):

```js
// config/plugins.js
'blockscene': { config: { groups: { 'wrappers.join': 'wrappers.close', 'wrappers.background': 'wrappers.close' } } }
```

Rules: keys and values must be existing component uids, an OPEN cannot be its
own CLOSE, and a CLOSE cannot also be an OPEN. Anything malformed is ignored
with a warning in the server log and the site falls back to ordinary blocks;
pairs naming unknown components are dropped. Several OPENs may share one CLOSE.

With a valid map:

- The gallery (form mode) and the page preview insert OPEN and its CLOSE in the
  same unsaved change: an empty group, never a lone marker. A CLOSE is not
  offered on its own in the gallery or the preview picker. When the CLOSE is
  not allowed in that zone, or the zone has no room for two rows, nothing is
  inserted and a notice explains why (two form dispatches in one React batch;
  no partial state is rendered or saved). Children are added
  through the group's own insertion seam; "+ Group" appears in top-level seams
  of the preview page (reference implementation in `examples/page-preview`).
- Move up/down and remove act on the whole OPEN…CLOSE range, keeping child
  order, ids and unsaved values. The native per-row controls are untouched.
- Structural policy: an OPEN starts a group that ends at its configured CLOSE;
  groups may nest; a CLOSE right after its OPEN is a valid empty group. Errors
  are `closeBeforeOpen` (CLOSE with no open group), `mismatch` (CLOSE is not the
  one expected by the innermost open group) and `unclosed` (OPEN never closed).
- Nothing is repaired on read: the panel lists the problems (row, marker) and
  the stray rows stay visible so the editor can fix them. Drafts save normally.
- Publishing is refused server-side while a configured pair is unbalanced.
  Strapi 5: a document-service middleware intercepts every facade path that
  publishes: `publish`, and `create`/`update` with `status: 'published'` (the
  repository then runs its internal publish, which never re-enters the
  facade, so it is caught at the facade call). Admin Publish, bulk publish,
  REST and custom `strapi.documents` code pass through it. The rows checked are
  the ones the request publishes: the data being written, or the stored draft
  of the exact target locale (requested locale; every locale for `'*'`; the
  default locale when none is given, as the repository resolves it). The check
  runs before the repository's own work, not inside its transaction: a draft
  written by a concurrent request between the check and the publish is not
  covered, and neither are direct `strapi.db.query` writes. Strapi 4: database
  lifecycles (`beforeCreate`/`beforeUpdate` with `publishedAt`,
  `beforeUpdateMany` for bulk publish). The error is a 400 ValidationError whose
  `details.errors[]` carry Strapi's `{ path, message }` shape (the admin shows
  them on the rows) plus `code`, `uid`, `expected`. Documents without Dynamic
  Zones and ordinary blocks are never affected. Verified in the local labs with
  the admin API (publish, bulk publish, create with published status).

Configured groups are stored exactly as before: the flat list of components in
the zone. Removing the config only removes the group tools and the guard.

## Languages

All plugin chrome (gallery, settings, page preview, editor dialogs, diagnostics)
follows the admin user's UI locale through Strapi's `registerTrads`, with stable
message ids (`blockscene.<key>`) and English as the fallback for any missing
key or locale. Shipped catalogues: en, pt-BR, pt, fr, es, de, it, nl (same
files for Strapi 4 and 5). Every other locale the admin offers shows English
for the plugin's texts. The reference preview page receives the same locale in
`update-page` (`locale`) so its editor chrome can follow it; page content and
component display names are never translated by the plugin.

## Turning the editor enhancements off

- **From the panel**: switch "Editor enhancements enabled" off. The gallery
  button, controls and initial-state logic disappear and the native picker and
  accordions remain. Content, config, media and unsaved edits are preserved; the
  form is not reloaded. The settings page stays available to turn it back on.
- **Emergency, outside the panel**: start the server with
  `BLOCKSCENE_DISABLED=true` (or set `config.disabled: true`). It is read at
  boot and reported by the catalog, wins over the saved settings and cannot be
  undone from the client. Changing it requires a restart.
- **If the catalog request fails**, the panel renders nothing and the native
  editor is used, so a plugin outage does not block editing.
- **Completely**: set `'blockscene': { enabled: false }` in `config/plugins.js`
  and rebuild/restart. This is the only way out of an import/build failure; a
  runtime toggle cannot recover an admin that fails to load. Native content is
  intact after uninstalling.

## Automatic images: local capture command

Development-only tool; Playwright never runs on the Strapi server or in the
admin bundle. Your project exposes one page per block with a capturable root
element; any framework or static HTML works. See `examples/static-preview/`.

```sh
node scripts/capture-previews.mjs --manifest examples/static-preview/manifest.json \
  --out /path/to/strapi/public/block-previews [--viewport 1280x720] [--timeout 15000] [--only blocks.hero]
```

Manifest contract:

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "selector": "[data-block-preview]",
  "blocks": { "blocks.hero": { "url": "/preview/blocks.hero", "selector": "[data-block-preview]" } }
}
```

Without `baseUrl`, relative URLs resolve next to the manifest file. The page
sets `data-preview-ready="true"` on the root element (or `<html>`) when it has
finished rendering; the command also waits for fonts and images inside the
element, disables animations, captures only the element and encodes WebP in
the browser. Each capture is written to a temporary file and renamed, so a
timeout or error keeps the previous file and is listed in
`capture-report.json`. Files not produced by the command are untouched.

Demo data belongs to those pages, never to the insertion payload: clicking a
card inserts schema defaults only. Set `previewVersion` after regenerating so
browsers fetch the new files. Deploy the folder with the project or copy it to
the configured static base.

## Guarantees and limits

Tested versions: Strapi 4.11.0 and 4.26.1 (Node 20), 5.0.0 and 5.52.1
(Node 22) in the local labs of this repository, and 5.23.5 and 5.31.0 in two
real site projects. The peer ranges (`>=5.0.0 <6`, `>=4.11.0 <5`) express what
installs without overrides, not a promise for every minor in between. Strapi
4.0–4.10 is out of reach: those admins run React 17 and lack `useFetchClient`.


- Native component payloads and ordinary Strapi save/publish flow.
- Only configured allowed components; zone limits and edit permissions checked.
- v4 uses native component insertion. v5 builds schema defaults and nested row
  keys because Strapi does not export the native default-form helper.
- Interface in the admin user's locale (8 catalogues, English fallback); theme tokens and keyboard-operable cards.
- Authenticated admin catalog endpoint exposes only supported metadata, resolved
  override URLs, palette and editor preferences; never the whole config.
- Top-level Dynamic Zones only. Conditional fields are omitted conservatively.
- "Open all" / "Close all" drive the native accordions: opening is batched into
  one render; closing yields a frame per block so the admin stays responsive.
  On a page with about 34 blocks whose fields include CKEditor, closing still
  takes a few seconds with pauses up to about 1.7 s: that is the editors being
  torn down by the host, not the plugin's loop.
- No screenshot server, no hourly job, no in-editor rendered preview.
- Removing the plugin leaves native content intact; remove its config entry and
  rebuild. No plugin data migration is needed.

Configuration edits require a server restart. Backend URL/prefix deployments
should set `previewBaseUrl` explicitly. HTTP(S) image hosts must also be allowed
by the consuming app's Content Security Policy. Media Library URLs are served as
stored (relative for the local provider), which works when the admin and the
uploads share an origin.

## Development

- `admin/`: shared gallery, settings page, wireframes and version-specific adapters.
- `server/`: settings store, validation, permissions, the catalog endpoint and the layout-group publish guard (`groups.js` is shared with the admin).
- `admin/translations/`: one flat catalogue per admin locale (English is the source of truth).
- `scripts/capture-previews.mjs`: local thumbnail capture.
- `packages/strapi4`, `packages/strapi5`: independently installable distributions.
- `tests/`: runnable regression checks.
- [Local integration tests](docs/LOCAL-TESTING.md).
- [Release checklist](docs/RELEASE.md).

This plugin does not require Image Optimization; both can be installed together.

## License

MIT, copyright 2026 Andrea Scarpello (personal project, authored outside any
employer's work). See `LICENSE`.
