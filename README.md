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
          typology: 'hero', // optional; guessed from the name otherwise
          tags: ['Editorial'],
          keywords: 'heading introduction',
          image: '/block-previews/hero.png',
        },
      },
    },
  },
}
```

Rebuild/restart the admin. Open a content type with a Dynamic Zone. The
editor panel provides one gallery button per editable, non-full zone. Zones
that already have blocks get "Open all blocks" / "Close all blocks" icon
buttons right beside the native zone label ("blocks (3)").

## Gallery

The modal is a block browser (80vw wide):

- **Sidebar** (collapsible to icons; remembered per browser): All, Recently
  used and Starred with counts, then the typologies present in the zone.
- **Top bar**: count (`34 blocks`, or `3 of 34` while filtering), search,
  filter menus Tags, Media and Content (checkboxes; several values in one menu
  match any of them, different menus combine), a "Fields" switch that shows
  each block's attribute list on its card, and a columns slider (1 to 5,
  remembered per browser). Active values show as removable chips with "Clear
  all"; the empty state offers a reset.
- **Cards**, grouped by typology: facet badges (IMAGE, VIDEO, GALLERY, RICH
  TEXT, LIST, DYNAMIC, FORM), a star and a hover "+" that inserts at once.
- A click **magnifies** the block: the card grows into a large panel over the
  grid (sidebar and top bar stay usable, the grid dims underneath) and shrinks
  back into its card on close (close button, Esc or a click on the dimmed
  grid). The animation is transform/opacity only, about 250 ms, and is skipped
  under `prefers-reduced-motion: reduce`. The panel shows a large live preview
  with Fit / Mobile / Tablet / Desktop widths (scaled to fit, as in the page
  preview) and a compact strip: label, uid, description, badges, fields (on
  demand), star and Insert. Double click, "+" or Enter on a focused card
  inserts without it.

The magnified preview shows the card's thumbnail at once and fades the live
page in over it once it has loaded. Live source, first match wins:

1. **Block preview URL** (`editor.blockPreviewUrl`, Settings, both versions):
   a plain page per block in a plain iframe, no bridge. Placeholders, URL
   encoded: `{uid}`, `{name}` (after the dot), `{category}` (before the dot),
   `{variant}` (`default`) and `{locale}` (the entry's locale, empty when the
   type is not localized). Example:
   `http://localhost:3026/{locale}/block-preview/{name}/{variant}`. Such a
   fixtures route is usually dev-only: leave the option empty on production.
2. **Page preview route** (Strapi 5: the preview route base URL, else the
   native Preview origin + `/block-preview/page`): the same bridge as the
   whole-page preview, sent one block made from the schema defaults, mode
   `preview`. Read-only: every message except `ready` is ignored.
3. Otherwise the image only.

If the live page neither loads nor says `ready` within 8 s, the image stays
with a short note. The iframe uses the page preview's sandbox
(`allow-scripts allow-same-origin`) and `referrerpolicy="no-referrer"`.

Stars and recently used blocks are stored per admin user on the server
(`GET`/`PUT /blockscene/me/prefs`, `{ starred, recent }`, at most 200 and 20
existing component uids).

### Taxonomy

Facets are read from each component schema and the components it nests (one
level): media fields (`image`, `video` by allowed types, `gallery` when
multiple), `richtext` (rich text, blocks or a CKEditor custom field), `list`
(repeatable component), `dynamic` (a relation, or a uid with query, archive or
related) and `form` (uid or display name with form or contact).

The typology is one of hero, text, media, listing, cards, cta, form and
layout, guessed from the component name and display name (hero, banner,
cover; text, rich, quote, title; image, media, video, gallery, carousel; list,
query, archive, related, posts, projects; card; cta, button, link; form,
contact; wrapper, column, grid, divider, spacer, section; else text). Override
it, and add up to 10 tags (1 to 24 characters), in Settings, Blockscene, or in
the plugin config: `components[uid].typology` and `components[uid].tags`. A
Settings value wins over the config. The former `category` config key still
works: it becomes the block's tag when no tags are set.

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
restored when Strapi re-renders the list. Turn it off with the editor option
`showRowThumbnails: false`.

## Row actions

Each block header gets a few icons right before Strapi's own delete button
(inserted through the DOM, like the thumbnails; read-only rows get none):

- **Hide on the site** (eye). The block stays in the document and in the
  admin, dimmed with a "Hidden" badge (also in the page preview, which receives
  `hidden: true` for it). What the content API does is the editor option
  `hiddenBlocks`: `strip` (default) removes hidden rows from Dynamic Zones in
  content-API reads (REST and GraphQL, including zones of populated relations
  and components; admin and Content Manager reads always return every row),
  `flag` sends them with the attribute so the frontend decides, `off` removes
  the eye and strips nothing. On a configured group OPEN the eye hides the
  whole group.
- **Duplicate**. A deep copy right below: ids removed from the row and its
  nested components, new row key, media kept, relations kept (Strapi 5 reads
  the source row's relations from the server and adds its unsaved changes).
  A group OPEN duplicates with its whole range. Option `duplicate`.
- **Copy / Paste** across pages. The copy icon copies one block; the select
  icon in the zone label shows a checkbox per row, then "Copy selected". The
  blocks are stored in this browser's localStorage (`blockscene:clipboard:v1`,
  with the source content type and locale). "Paste" appears in the zone label
  (under the gallery button for an empty zone) and in the page preview seams.
  Paste is all or nothing: every block must be allowed in the target zone, fit
  its maximum, and groups must be whole; otherwise a notice explains why and the
  form is not changed. Media and relations are kept by id/documentId, so paste
  within the same install. Option `clipboard`.
- **Confirm delete**. The native delete asks "Delete block …?" first;
  confirming runs Strapi's own removal. On a group marker the dialog says only
  the marker is removed. Option `confirmDelete`.

Everything goes through the form: nothing is saved until Save, and undo/redo
(Strapi 5) covers every action. Strapi 4 supports the same actions; relations
are copied as the form holds them there (the loaded relations of an opened
block).

**The hidden attribute is a database column.** At register time the plugin adds
a boolean attribute (like i18n adds `locale`) to every component used in a
Dynamic Zone: `{ type: 'boolean', default: false, visible: false,
configurable: false }`, so Strapi's schema sync creates a `bs_hidden` column in
each of those component tables on the next start (existing rows read as not
hidden). It is hidden from the edit view. Rename it with the plugin config
`hiddenAttribute: 'myName'`, or set `hiddenAttribute: false` to add nothing (no
eye, nothing stripped). A component that already has an attribute of that name
with another type is skipped with a warning. Removing the plugin (or setting
`false`) leaves the column in place with its data; drop it yourself if you want.

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
  Media Library, "Use automatic image", the wireframe template, the gallery
  typology ("Automatic" shows the guess) and tags (comma separated).
- Editor preferences: enhancements on/off, visibility of each collective
  button, initial accordion state and the initial block mode.
- Version history (Strapi 5): module switch, covered content types, retention
  (see "Version history").
- Content types: every project type with a Dynamic Zone, each with on/off
  (off leaves its edit view fully native) and, on Strapi 5, the mode its edit
  views open in ("Default" follows the global preview mode) and its visual
  editor sidebar (see below).
- "Restore project defaults" (or "Reset to defaults" when the project has no
  code defaults), after a confirmation, deletes what was saved here
  (`DELETE /blockscene/settings`, same permission as saving).

### Project defaults from code

A project can ship its baseline in the plugin config, with the same shape as
the stored settings (every key optional):

```js
// config/plugins.js
module.exports = {
  blockscene: { config: { settings: require('./blockscene.json') } },
}
// config/blockscene.json
{
  "palette": { "accent": "#AA3300" },
  "editor": { "previewMode": "split", "initialState": "open" },
  "components": { "blocks.faq": { "template": "faq", "typology": "text" } },
  "contentTypes": {
    "api::page.page": {
      "sidebarPosition": "right",
      "sidebar": [{ "label": "SEO", "icon": "seo", "open": "drawer", "fields": ["seo"] }]
    }
  }
}
```

The effective settings are the built-in defaults, then the code `settings`,
then what was saved on the page:

- `palette` and `editor`: a saved key wins over the code key by key.
- `components` and `contentTypes`: a saved entry replaces the code entry for
  that uid as a whole (a saved `api::page.page` entry replaces its code
  sidebar too); other uids keep their code values.

Saving stores only what differs from the code defaults, so later changes to the
code reach every key nobody overrode. A document saved before the project had
code defaults holds every palette and editor key, and those keep winning until
"Restore project defaults". The code settings are checked at boot with the same
rules as `PUT`; if they are invalid a warning names the problem and they are
ignored (boot continues). `GET /blockscene/settings` returns them as
`projectDefaults` (null when absent or invalid).

### Editor preferences

| Option | Values | Default |
| --- | --- | --- |
| Editor enhancements enabled | on/off | on |
| Show "Open all blocks" | yes/no | yes |
| Show "Close all blocks" | yes/no | yes |
| Show block thumbnails in the rows (`showRowThumbnails`) | yes/no | yes |
| Initial accordion state | all closed / all open / remember | all closed |
| Load rich-text editors on demand (`lazyEditors`, Strapi 5) | yes/no | yes |
| Custom fields loaded on demand (`lazyFields`, Strapi 5) | up to 20 uids `plugin::x.y` / `global::x` | `["plugin::ckeditor5.CKEditor"]` |
| Preview route base URL (Strapi 5) | full URL or empty | empty: native Preview origin |
| Block preview URL | http(s) URL with placeholders, up to 500 characters, or empty | empty: page preview route, else image |
| Initial preview mode (Strapi 5) | form / side by side / preview | form |
| Confirm before deleting a block (`confirmDelete`) | yes/no | yes |
| Duplicate on each block (`duplicate`) | yes/no | yes |
| Copy and Paste (`clipboard`) | yes/no | yes |
| Blocks hidden on the site (`hiddenBlocks`) | `strip` / `flag` / `off` | `strip` |
| Friendly field labels (`friendlyLabels`, see [Field labels](#field-labels)) | yes/no | yes |

Every edit view opens in its content type's mode, else the initial preview
mode. Editors can switch while they edit; the switch is not remembered.

The initial state is applied once per document/locale after the blocks
render; edits, reorders and newly inserted blocks are not re-applied. Hiding a
button only hides it; native accordion headers keep working.

Lazy editors: a custom field listed in `lazyFields` first shows a read-only
preview of its HTML (same label, hint and error; scripts, frames, styles, event
handlers and `javascript:` URLs removed) and mounts the real editor on click,
Enter/Space or keyboard focus, then puts the caret in it. Once mounted it stays
for that view; closing and reopening the block shows the preview again.
Disabled fields only show the preview. The wrapper is installed on every
registered custom field at boot and passes the others straight through; until
the catalog loads, and when the plugin or the content type is off, every field
is native.

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

Side by side, hovering a zone row in the form (open or closed) outlines its
block in the page, and hovering a block in the page outlines its form row in the
theme's primary color; hovering never scrolls. When that row is outside the
visible form, an arrow at the top or bottom edge of the form scrolls to it. The
divider between form and page drags to resize, takes the arrow keys, Home and
End, and a double click resets it to half.

### Visual editor sidebar

Per content type, a bar of buttons on the left, right or bottom edge of the
visual editor. Each button (label, optional icon) opens some of the document's
own fields in a modal or a drawer: the native form itself, with every other
field hidden, so components, repeatable components, media, relations and custom
fields all keep working. Done, Esc or the backdrop put the form back.

```js
// Settings, Blockscene, Content types (or PUT /blockscene/settings, or the code `settings`):
contentTypes: {
  'api::page.page': {
    sidebarPosition: 'left', // left | right | bottom
    sidebar: [
      { label: 'Title', icon: 'text', open: 'modal', fields: ['title'] },
      { label: 'SEO', icon: 'seo', open: 'drawer', fields: ['pageSeo'] },
    ],
  },
}
```

Icons: text, tag, seo, settings, image, link, palette, list, globe, info (or
none). Fields are the type's own top-level attributes; an item naming a field
removed from the schema is dropped on read. Up to 12 items.

The Settings page edits it under each enabled content type: position, then per
item the label, icon, drawer or modal, the fields (checkboxes), move up/down and
remove. An item without a label or without fields is flagged and blocks Save.
Removing every item removes the override.

The pane toolbar sets the page width: Fit (the pane), Mobile (390 px), Tablet
(834 px) or Desktop (1440 px). A device renders at its own width and scales down
when the pane is narrower, so the desktop layout fits side by side; switching
never reloads the page. The choice is remembered per browser.

Minimal configuration:

1. Serve a page that implements the bridge. `examples/page-preview/index.html`
   is a framework-free reference: it answers `ready`/`ping`, renders
   `update-page`, and sends `select`, `focus`, `edit`, `media`, `media-remove`.
   Hover sync is optional: the page sends `{ type: 'hover', key }` (a block
   key, or `null` off blocks) when it changes, and marks the block of the
   admin's `{ type: 'hover', key }` without scrolling. A page that ignores it
   keeps working.
   Row actions: a block hidden on the site arrives with `hidden: true` (the
   example dims it), and `update-page` carries `clipboard` (the number of copied
   blocks, 0 when none or not editable); while it is positive the page may show
   a Paste button in its seams that sends `{ type: 'paste', after }` (a block
   key, or `null` for the start). Both are optional.
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
(`data-block-field` + `contenteditable="plaintext-only"`) send `edit`. In the
visual editor, a click on any other field or on the block opens the whole block
over the page: its own native form (every field type, CKEditor, media, nested
and repeatable components), with the clicked field focused and outlined. The
page updates while you type; Done, Esc or the backdrop put the block back. Side
by side focuses the field in the form on the left instead. Media
fields open the native Media Library. Everything is validated against the schema
and the zone's edit permission; a published page never receives unsaved values
by itself. Strapi 4 does not have this panel yet (see `docs/BACKLOG.md`).

### Undo and redo

The Blockscene panel and the pane toolbar have Undo and Redo buttons (Strapi 5).
They step through the whole edit view: blocks inserted, removed or moved from the
gallery, the page, groups or the native actions, and any field edit. Changes
within 400 ms of each other are one step, so a burst of typing undoes at once;
up to 100 steps. Shortcuts: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Ctrl+Y, only while
the focus is outside a text field, select or rich text editor (those keep their
own undo).

Limits: the history lives in the open edit view and starts over when the
document, the locale or its loaded values change, so a Save clears it. Shortcuts
pressed inside the preview page are not seen (it is another origin); use the
buttons there. A custom field that reads its value only once on mount keeps
showing the old text after an undo until the view reloads; the CKEditor 5
custom field (@_sh/strapi-plugin-ckeditor) follows the restored value (checked
on Strapi 5.31).

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

## Field labels

The Content Manager shows each field under its "Configure the view" label, which
defaults to the raw attribute name (`mobileColumnsCount`). Blockscene rewrites
the edit view labels, hints and placeholders through the Content Manager's own
`Admin/CM/pages/EditView/mutate-edit-view-layout` hook (Strapi 5 and 4, the
same hook the i18n plugin uses), so nothing in the DOM is patched and the
saved view configuration is never changed. Per field, the first that applies:

1. **Project texts** from the plugin config `fields` (below);
2. **a label set in "Configure the view"** (anything other than the attribute name);
3. **the humanized name** when "Friendly field labels" is on: `mobileColumnsCount`
   reads "Mobile columns count", `page_seo` "Page seo", acronym runs stay
   (`pageSEO` "Page SEO", `ctaURL` "Cta URL").

Description (the hint under the field) and placeholder change only when the
project texts have them. Texts follow the admin user's interface language
(`strapi-admin-language`, else English), resolved as: exact locale, then its
language (`pt-BR` → `pt`), then any variant of that language, then `en`, then
the first value.

```js
// config/plugins.js
blockscene: { config: { fields: {
  'api::page.page': {
    pageSeo: { label: { en: 'Search engine settings', 'pt-BR': 'Configurações de SEO' },
      description: { en: 'Title and description shown on Google', 'pt-BR': 'Título e descrição no Google' } },
  },
  'shared.seo': { metaTitle: { placeholder: 'Up to 60 characters' } },
} } },
```

Keys are content type or component uids, then attribute names; each of
`label` (up to 80 characters), `description` (300) and `placeholder` (120) is a
string or `{ "<locale>": string }`. The map is validated at boot: an unknown
key, an empty or too long text, or a malformed locale code logs a warning
naming it and the whole `fields` config is ignored (labels fall back to the two
other steps). Entries for a uid or attribute the schema no longer has (a
renamed or removed field) are skipped with one warning listing them; the rest
keep working. It is code only, versioned with the
project; the Settings page has the on/off switch but does not edit texts.

To start the file, generate every field of a project with its humanized English
label from a clone of this repository, then keep what you want to change:

```bash
node scripts/fields-skeleton.mjs ../my-project/backend > ../my-project/backend/config/blockscene-fields.json
# config/plugins.js: fields: require('./blockscene-fields.json')
```

Limits: the hook runs synchronously and reads the last catalog the admin
loaded. The first edit or list view of a session starts that request and shows
native labels; the next layout computed (another document, list → edit, a
locale switch) has them. Strapi 5 gives the hook no content type uid, so the
layout is matched by display name and field names; two content types that
share both are left untouched (component fields always work: they are keyed by
uid). The switch "Editor enhancements enabled", `BLOCKSCENE_DISABLED` and a
content type turned off all leave the native labels; any error leaves the
layout untouched. Changing the interface language applies from the next edit
view.

## Version history (Strapi 5)

Off by default. Turn it on in Settings, Blockscene, "Version history" (or from
code, `settings.history`, see below). Strapi Community has no content history
(it is a Growth feature); this module records one event per content change and
keeps a snapshot of the content, so an editor can see what changed and load an
earlier version back into the form.

**What it captures.** Every create, save, publish, unpublish, discard draft and
delete of the covered content types (all `api::` types by default, or a list)
made through Strapi's document service: the admin (single and bulk actions),
the REST and GraphQL APIs, and any plugin or custom code that uses
`strapi.documents`. One event per affected locale, with who (admin user, API
token, Users & Permissions user, or `system`), when, the action and a summary
(blocks added, removed and changed per Dynamic Zone, top-level fields changed)
against the previous snapshot of the same locale. The snapshot is the stored
entry with components and Dynamic Zones in full, relations as documentIds and
media as file ids (a 34-block page is a few KB; the capture adds a few
milliseconds to a save). A snapshot identical to the previous one is not stored
again (the event is, with the same hash).

**What it does not see.** Writes that bypass the document service: raw
`strapi.db.query`, knex or SQL, imports that write the database directly. This
is content activity for editors, not a security audit log.

**Failure policy.** A failed capture never blocks a save or a publish: the
change goes through, the error is logged and the event is marked "Not
recorded". A failed capture fails a delete: the delete runs in one transaction
with its events, so nothing is deleted without its last version (a bulk delete
is rolled back whole). `BLOCKSCENE_DISABLED=true` or the module switch off stop
all capture. The plugin never records its own content types.

**In the edit view.** The Blockscene side panel gets a History section (saved
documents of covered types, also on types without a Dynamic Zone): the
versions of the document in the current locale, newest first. Selecting one
shows a block-level diff against the form (relations are not compared) and
"Load this version", which puts the version into the form the way undo does:
nothing is written until the editor saves, so validation, permissions and
lifecycles apply as for any edit, and undo reverts the load. Components and
blocks come back as new rows; relations become the connect/disconnect change
from what the document has now; fields the editor may not update, fields the
schema no longer has, blocks whose component is no longer allowed, and media or
related entries that no longer exist are left out and listed.

**Permission.** `Blockscene: Read version history` (`history.read`), plus read
access to the content type in the Content Manager. Snapshots hold removed and
unpublished text, so the section is hidden without it. Admin API:
`GET /blockscene/history/:uid/:documentId?locale=` (the latest 100 events, no
snapshots) and `GET /blockscene/history-events/:id` (one event, its snapshot and
the media and relation targets that still exist).

**Retention.** Snapshots are kept `retentionDays` (90) and at most
`maxSnapshots` (100) per document, newest first; events without a snapshot are
kept `eventDays` (365, at least `retentionDays`). A cron job added by the plugin
runs nightly at 03:00 server time, in batches of 500; it only empties snapshots
and deletes events, never media files, and running it on several instances is
harmless.

```js
// config/plugins.js
blockscene: { config: { settings: { history: { enabled: true, contentTypes: ['api::page.page', 'api::post.post'],
  retentionDays: 90, maxSnapshots: 100, eventDays: 365 } } } }
```

Events live in the `blockscene_events` table (content type
`plugin::blockscene.event`, hidden from the Content Manager and the Content-Type
Builder). Removing the plugin, or installing a Blockscene version older than
the one that added history, lets Strapi drop that table and every recorded
version on the next start: back up `blockscene_events` first if you need it.

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
- "Open all" / "Close all" drive the native accordions without touching the
  whole list at once: open all opens the rows in and near the visible area, a
  few per frame, and the others as they approach while scrolling (until Close
  all or leaving the document); close all closes the visible rows at once and
  the rest in idle time. With lazy editors, on a 34-block page with CKEditor
  fields (Strapi 5.31) the longest pause went from about 2.9 s to 0.14 s on
  open all and from 1.6 s to 0.14 s on close all.
- No screenshot server, no hourly job, no in-editor rendered preview.
- Removing the plugin leaves native content intact; remove its config entry and
  rebuild. No plugin data migration is needed. The "hide on the site" column
  (see Row actions) stays in the component tables until you drop it.

Configuration edits require a server restart. Backend URL/prefix deployments
should set `previewBaseUrl` explicitly. HTTP(S) image hosts must also be allowed
by the consuming app's Content Security Policy. Media Library URLs are served as
stored (relative for the local provider), which works when the admin and the
uploads share an origin.

## Development

- `admin/`: shared gallery, settings page, wireframes and version-specific adapters.
- `server/`: settings store, validation, permissions, the catalog endpoint and the layout-group publish guard (`groups.js` is shared with the admin); `history.js` and `diff.js` for version history (`diff.js` is shared with the admin).
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
