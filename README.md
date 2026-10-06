# Blockscene for Strapi

A visual gallery for the components already allowed in a native Dynamic Zone,
with configurable thumbnails, SVG wireframes, editor preferences and a
whole-page preview that edits the form through your own frontend.
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
      // Optional: only these Strapi component folders get cards in Settings > Block gallery.
      // Dynamic Zone insertion still follows each content type's own schema.
      settingsComponentCategories: ['blocks'],
      components: {
        'blocks.hero': {
          label: 'Hero banner',
          description: 'Introduce a page with a prominent title and image.',
          typology: 'hero', // optional; guessed from the name otherwise
          tags: ['Editorial'],
          keywords: 'heading introduction',
          image: '/block-previews/hero.png',
          showRowThumbnail: false, // optional per-component row thumbnail
        },
      },
    },
  },
}
```

Rebuild/restart the admin. Open a content type with a Dynamic Zone. The
native "Add a component to <zone>" button of each editable, non-full zone opens
the gallery instead of Strapi's category picker; a full zone keeps its native
button.

### Zone bar

Right beside the native zone label ("blocks (3)") each zone gets a short bar:

- **Expand all / Collapse all**: one button with text. It reads the rows' own
  state: "Expand all" while any block of the zone is collapsed, "Collapse all"
  when every block is open (a header opened or closed by hand counts too), and
  exposes it as `aria-expanded`. Blocks open or close a few at a time around the
  viewport first (long pages stay responsive). Rows of a folded layout group
  are left alone (see [Groups in the form](#groups-in-the-form)). Options `showOpenAll` /
  `showCloseAll`: with both on (the default) the button toggles; with only one
  on it offers that action alone, disabled while there is nothing to do; with
  both off there is no button.
- **Undo and Redo** (Strapi 5, first zone only): icon and text, the shortcut in
  the tooltip. See [Undo and redo](#undo-and-redo).
- **Editing mode** (first zone only, when a preview route exists): a
  menu with Fields only, Fields + preview and Visual editor. Without a preview route the
  menu is not shown; Settings, Blockscene says why.
- **"…" (More actions)**: Select blocks, and "Paste N blocks" while the
  clipboard holds blocks this zone allows (see [Row actions](#row-actions)).
  No entries, no menu.

"Select blocks" swaps the bar for a selection bar: a select-all box with the
count ("2 selected"; indeterminate while only some are selected, a click then
selects none), Copy (disabled until a block is selected) and Done; Esc leaves
too. Each row gets a checkbox at the start of its header.

An empty zone has no label row: its bar (Paste, and on the first zone Undo,
Redo and the mode) sits right after its native add button.

The plugin adds no side panel of its own for any of this. The Blockscene side
panel appears only for what has no place in the form: version history (when
enabled) and layout group problems. With neither, there is no panel.

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
  TEXT, LIST, DYNAMIC, FORM), a star and an always-visible magnifying glass.
  Clicking the card, or focusing it and pressing Enter, inserts it immediately;
  the magnifying glass opens its preview.
- The preview **magnifies** the block: the card grows into a large panel over the
  grid (sidebar and top bar stay usable, the grid dims underneath) and shrinks
  back into its card on close (close button, Esc or a click on the dimmed
  grid). The animation is transform/opacity only, about 250 ms, and is skipped
  under `prefers-reduced-motion: reduce`. The panel shows a large live preview
  with Fit / Mobile / Tablet / Desktop widths (scaled to fit, as in the page
  preview) and a compact strip: label, uid, description, badges, fields (on
  demand), the variant choice (see [Insert variants](#insert-variants)), star
  and Insert. A direct card insert uses the first variant, when the block has variants.

The magnified preview shows the card's thumbnail at once and fades the live
page in over it once it has loaded. Live source, first match wins:

1. **Block preview URL** (`editor.blockPreviewUrl`, Settings, both versions):
   a plain page per block in a plain iframe, no bridge. Placeholders, URL
   encoded: `{uid}`, `{name}` (after the dot), `{category}` (before the dot),
   `{variant}` (the chosen [insert variant](#insert-variants)'s id, else
   `default`) and `{locale}` (the entry's locale, empty when the type is not
   localized). Example:
   `http://localhost:3026/{locale}/block-preview/{name}/{variant}`. Such a
   fixtures route is usually dev-only: leave the option empty on production.
2. **Page preview route** (the preview route base URL, else on Strapi 5 the
   native Preview origin + `/block-preview/page`): the same bridge as the
   whole-page preview, sent one block made from the chosen variant over the
   schema defaults, mode `preview`. Read-only: every message except `ready`
   is ignored.
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
it, and add up to 10 tags (1 to 24 characters), in Settings, Blockscene, in
the plugin config (`components[uid].typology` and `components[uid].tags`) or in
the component schema ([`pluginOptions.blockscene`](#describing-blocks-and-fields-in-the-schema)).
A Settings value wins over the config, the config over the schema. The former `category` config key still
works: it becomes the block's tag when no tags are set.

The native "Add a component to <zone>" button of an editable zone opens this
gallery as well (the click is intercepted in the capture phase; Strapi's
category picker never opens). Zones without the gallery, or with the editor
enhancements off, keep the native picker. The button is recognised by its
label ending with the raw zone name, which Strapi's message carries in every
locale; a zone whose name ends another zone's name (`blocks` and `sub blocks`)
is the documented limit.

### Insert variants

A block can offer named presets of its field values, so the editor inserts
"Hero, dark" instead of the bare schema defaults. Variants come from the
project's code, never from the Settings page: the plugin config
`components[uid].variants`, a list of `{ id, label, values }`.

```js
// config/plugins.js
components: {
  'blocks.hero': {
    variants: [
      { id: 'default', label: 'Default', values: {} },
      { id: 'dark', label: { en: 'Dark', 'pt-BR': 'Escuro' }, values: {
        title: 'Big launch', theme: 'dark',
        link: { text: 'Read more', url: '/news' },
        items: [{ label: 'One' }, { label: 'Two' }],
      } },
      // A frontend fixture works as is: ids, __component, media and relations are dropped.
      { id: 'cases', label: 'Cases', values: require('../fixtures/hero/cases.json').data },
    ],
  },
},
```

- **Choosing**: with two or more variants the magnified block shows them as a
  row of buttons; the live preview follows the choice (`{variant}` in the
  block preview URL, or the variant's block sent through the bridge) and
  Insert inserts it. Clicking the card or pressing Enter inserts the first variant.
  The picker opened from a page preview insertion seam offers the same
  choice. A block without variants behaves as before; Settings, Blockscene
  lists each block's variants read-only.
- **Merge**: `values` is a partial field map over the schema defaults. A
  nested component merges over its own defaults; a repeatable list replaces
  the default list, each item over the item's defaults. The row goes through
  the same form path as any gallery insert (Strapi 5 `addFieldRow`, Strapi 4
  `addComponentToDynamicZone` then the fields' `onChange`), so nothing is
  saved until Save and undo/redo covers it.
- **Supported values**, checked against the schema once at boot: text-like
  fields (strings, rich text, email, uid, dates as strings), numbers
  (integers, big integers, floats, decimals), booleans, enumerations (one of
  their values), JSON, blocks (an array) and `null`; nested components,
  single or repeatable (up to the attribute's `max`, and 100), each validated
  against its own schema. Media and relation values are dropped with a boot
  warning: their ids belong to one install and are not checked here. `id` and
  `__component` keys are ignored, so a content-API shaped block works.
  Unknown attributes, passwords and Dynamic Zones reject the variant.
- **Bounds**: `id` is 1 to 40 of `a-z 0-9 - _`, unique per block (it is the
  `{variant}` URL segment); `label` a string of 1 to 60 characters or
  `{ "<locale>": string }`; at most 12 variants per block, 16 KB of values
  per variant and 256 KB for all of them. An invalid variant is left out with
  a warning naming the problem; the block keeps its valid ones.

### Starter kits

New entries can start from a named set of blocks instead of an empty Dynamic
Zone. Kits live in project code, per content type. When every editable zone is
empty, Blockscene opens the kit chooser once; choosing one only changes the
unsaved form, so every placeholder remains editable and **Start blank** keeps
the current behaviour.

```js
// config/plugins.js
blockscene: { config: {
  kits: {
    'api::page.page': [{
      id: 'landing',
      label: { en: 'Landing page', 'pt-BR': 'Página de campanha' },
      // Optional. A language code such as "pt" also matches "pt-BR".
      locales: ['en', 'pt-BR'],
      zones: { blocks: [
        { __component: 'blocks.hero', title: 'Replace this headline' },
        { __component: 'blocks.rich-text', text: 'Replace this text.' },
      ] },
    }],
  },
} }
```

Rows use the Content API shape and the same validated values as [insert
variants](#insert-variants). Schema defaults are merged in, nested components
work, and configured layout OPEN blocks receive their CLOSE automatically.
Media and relations are omitted because their ids are installation-specific;
required ones are called out in the server log and must be completed before
publishing. Invalid kits, missing required scalar values and kits below or
above a Dynamic Zone's bounds are ignored with a server warning. The chooser
is remembered for the current new-entry browser history item, so re-rendering
or reloading it does not apply or prompt twice.

## Row thumbnails

Each added block shows its thumbnail at the left of the native accordion
header, and clicking it opens the image full size in a modal instead of
opening or closing the row. The sources are the same as the gallery cards,
minus the wireframe: a block with no image shows nothing, so nothing new is
invented for blocks that were never captured. The thumbnail is inserted into
Strapi's own header through the DOM (no Content Manager patch) and is
restored when Strapi re-renders the list. Configured OPEN and CLOSE group
markers hide it by default. Override any component with
`components[uid].showRowThumbnail` in code or on the Settings page, or turn all
row thumbnails off with the editor option `showRowThumbnails: false`.

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
- **Copy / Paste** across pages. The copy icon copies one block; "Select
  blocks" in the zone bar's "…" menu shows a checkbox per row, then Copy. The
  blocks are stored in this browser's localStorage (`blockscene:clipboard:v1`,
  with the source content type and locale). "Paste N blocks" appears in the
  zone bar's "…" menu of every zone that allows all the copied components, and
  in the page preview seams. Paste is all or nothing: every block must be
  allowed in the target zone, fit its maximum, and groups must be whole;
  otherwise a notice explains why and the form is not changed. Media and relations are kept by id/documentId, so paste
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
Dynamic Zone: `{ type: 'boolean', default: false, configurable: false }`, so
Strapi's schema sync creates a `bs_hidden` column in each of those component
tables on the next start (existing rows read as not hidden). It is never shown
as an input: the plugin removes it from the components' edit layouts through
the Content Manager's layout hook (it may be listed in "Configure the view" of
a component; leave it out of the layout). It is not marked `visible: false`,
because before Strapi 5.45 the edit view crashes on a value whose attribute the
admin does not know. It is kept out of the Content-Type Builder instead (the
plugin wraps the builder's component reads), so saving a component there in
`strapi develop` never writes it to the component's JSON file. With earlier
versions (up to 2.0.0-alpha.8, and 1.0.0-alpha.8 on Strapi 4) the builder did
write it (`"bsHidden": { "type": "boolean", "configurable": false, "default": false }`);
a file that has it keeps working, and the builder keeps it there on later saves.
To clean it up, delete that entry from the component JSON by hand (the plugin
still adds the attribute at startup, so the column and its data stay). To check,
edit a Dynamic Zone component in the builder (for example its display name),
save, and diff its JSON file: only your change is there. Rename it with the plugin config
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
  typology ("Automatic" shows the guess) and tags (comma separated); a group
  OPEN also has its layout grid fields (see [Layout grid](#layout-grid)).
- Editor preferences: enhancements on/off, visibility of each collective
  button, initial accordion state and the initial block mode.
- Version history (Strapi 5): module switch, covered content types, retention
  (see "Version history").
- Content types: every project type with a Dynamic Zone, each with on/off
  (off leaves its edit view fully native), the mode its edit
  views open in ("Default" follows the global preview mode), its visual
  editor sidebar and optionally its own page preview toolbar (see below).
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

- `palette` and `editor`: a saved key wins over the code key by key, except
  an empty `previewUrl` or `blockPreviewUrl`, which means "not set": the code
  value applies. Clearing either field on the page therefore falls back to the
  project default (there is no saved "off" for a URL the code provides; remove
  it from the code settings, or set `previewMode` per content type, to keep a
  type out of the page preview).
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
| Show "Expand all" (`showOpenAll`) | yes/no | yes |
| Show "Collapse all" (`showCloseAll`) | yes/no | yes |
| Show block thumbnails in the rows (`showRowThumbnails`) | yes/no | yes |
| Initial accordion state | all closed / all open / remember | all closed |
| Load rich-text editors on demand (`lazyEditors`, Strapi 5) | yes/no | yes |
| Custom fields loaded on demand (`lazyFields`, Strapi 5) | up to 20 uids `plugin::x.y` / `global::x` | `["plugin::ckeditor5.CKEditor"]` |
| Preview route base URL | full URL or empty | empty: native Preview origin (Strapi 5; none on Strapi 4) |
| Block preview URL | http(s) URL with placeholders, up to 500 characters, or empty | empty: page preview route, else image |
| Initial preview mode | form / side by side / preview | form |
| Confirm before deleting a block (`confirmDelete`) | yes/no | yes |
| Duplicate on each block (`duplicate`) | yes/no | yes |
| Copy and Paste (`clipboard`) | yes/no | yes |
| Blocks hidden on the site (`hiddenBlocks`) | `strip` / `flag` / `off` | `strip` |
| Friendly field labels (`friendlyLabels`, see [Field labels](#field-labels)) | yes/no | yes |
| Page preview toolbar (`previewToolbar`, see [Pane toolbar](#pane-toolbar)) | ordered list of `modes`, `history`, `versions`, `devices`, `status`, `actions` | all six (`versions`: Strapi 5) |
| Page widths (`previewDevices`) | 1 to 8 of `fit`, `mobile`, `tablet`, `desktop`, `{ label, width }` | the four built-in |

Every edit view opens in its content type's mode, else the initial preview
mode. Editors can switch while they edit; the switch is not remembered.

The initial state is applied once per document/locale after the blocks
render; edits, reorders and newly inserted blocks are not re-applied.
`showOpenAll` and `showCloseAll` shape the zone bar's single toggle (both: it
toggles; one: only that action; none: no button). Hiding it only hides it;
native accordion headers keep working.

Lazy editors: a custom field listed in `lazyFields` first shows a read-only
preview of its HTML (same label, hint and error; scripts, frames, styles, event
handlers and `javascript:` URLs removed) and mounts the real editor on click,
Enter/Space or keyboard focus, then puts the caret in it. Once mounted it stays
for that view; closing and reopening the block shows the preview again.
Disabled fields only show the preview. The wrapper is installed on every
registered custom field at boot and passes the others straight through; until
the catalog loads, and when the plugin or the content type is off, every field
is native.

"Remember" stores only the last explicit Expand all / Collapse all click, as
`open`/`closed` in the browser's localStorage, keyed by admin URL, user id,
content type and zone. Another user in the same browser does not inherit it.
Blocked storage or an invalid value falls back to all closed. No sync between
devices.

The accordion controls drive the native Dynamic Zone accordions through their
`aria-expanded` headers, so no Strapi source is patched. They are validated on
the two supported versions only.

## Whole-page preview

Both distributions add a page preview with three modes, chosen from the
first zone's bar and from the pane toolbar: Fields only (form), Fields + preview (side
by side: resizable pane, native actions moved to a bar above the form) and
Visual editor. It posts the live values of the first Dynamic Zone to a page
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
   `update-page` also carries the complete live `entry`, including unsaved
   values, plus `contentType` metadata and the projected zone name. New schema
   fields therefore reach the frontend automatically; the frontend decides how
   each field affects its page. The normalized `blocks` array remains alongside
   it for visual editing and block-level actions.
   Keep the origin check (`admin` query parameter or your own constant).
2. Allow the admin origin to embed it (`Content-Security-Policy: frame-ancestors`)
   and allow the page origin in the Strapi admin CSP (`frame-src`).
3. Set the full route URL in Settings, Blockscene ("Preview route base URL"),
   or leave it empty to reuse the origin of Strapi's native Preview (when
   configured for the content type) with `/block-preview/page` appended.
   Use the same host name the frontend dev server was started for
   (`localhost` vs `127.0.0.1`): Next 16 refuses its dev WebSocket for the
   other one and the page then never hydrates, so `ready` never arrives and
   the pane reports the preview as unavailable with no error in either console.

The bridge only exposes what the schema and the current user's read permissions
allow. Attributes marked with Strapi's `private: true`, passwords, and
attributes with `pluginOptions.blockscene.private: true` are never projected,
focused or edited; the Blockscene option is useful for keeping a field out of
the preview without changing its public API behavior. This privacy rule also
applies inside components. Media URLs are passed through for any http(s) host
(S3/CDN providers included) and same-origin paths; the zone shown is the first
Dynamic Zone the user may read, and editing additionally needs the update
permission on it. Pending dialogs are dropped when the document or locale
changes.

Editing from the page: plain-text areas the page explicitly maps
(`data-block-field` + `contenteditable="plaintext-only"`) send `edit`. In the
visual editor, a click on any other field or on the block opens the whole block
over the page: its own native form (every field type, CKEditor, media, nested
and repeatable components), with the clicked field focused and outlined. The
page updates while you type; Done, Esc or the backdrop put the block back. Side
by side focuses the field in the form on the left instead. Media
fields open the native Media Library. Everything is validated against the schema
and the zone's edit permission; a published page never receives unsaved values
by itself.

On Strapi 4 (run on 4.26.1; the edit view APIs it uses are the same in 4.11.0)
the page preview is the same: the three modes, the same bridge
(`blockscene:page-preview:v1`, so one frontend route serves both), widths,
hover sync, the block dialog, the visual editor sidebar, custom panels,
insertion, groups and paste from the page, and the per content type settings.
It reads and writes the edit view's own data (`useCMEditViewDataManager`); new
blocks use the native insertion at a position. Differences:

- No undo and redo (no History buttons, no shortcuts). Strapi 4's form has no
  way to set all values at once, and restoring each field would also undo the
  relations it loads lazily, which Save would then disconnect.
- No native Preview to fall back on: set the preview route base URL.
- The toolbar's status shows Draft or Published (Strapi 4 has no Modified
  state) and the unsaved hint; its Save and Publish (or Unpublish) click the
  edit view header's own buttons, so their checks and dialogs are Strapi's.
- The browser smoke covers split mode, select, inline and live edits, widths,
  hover, the block dialog, a sidebar item, media, insertion and toolbar Save
  on 4.26.1; group tools, paste and custom panels from the page share the
  Strapi 5 code and are checked there only.
- With Strapi 4's two navigation columns the content area is narrower: the
  form keeps at least 520 px, so side by side the page gets less than half on
  a 1440 px screen.

### Pane toolbar

Which controls the toolbar shows, and in which order, is `previewToolbar`:
`modes` (Fields only, Fields + preview, Visual editor), `history` (Undo, Redo),
`versions` (the version history drawer, Strapi 5),
`devices` (the width menu), `status` (Draft/Modified/Published and the unsaved
hint) and `actions` (Save, Publish). A missing id is hidden; `status` and
`actions` stay one group on the right, placed where the first of them is
listed. The preview's loading or error notice always shows. Without `modes` the
pane stays in the mode the edit view opened in (for example a visual editor
only view with `previewMode: 'preview'`); the form's zone bar keeps its own
Undo, Redo and mode menu.

`previewDevices` lists the width menu's entries in order; the first is used
until an editor picks another. Besides the four names, `{ label, width }` adds
a custom width (label up to 24 characters, width a whole number from 240 to
3840 px; no name or width twice; up to 8 entries). With a single entry the menu
is hidden.

```js
// Settings, Blockscene (Editor preferences, or per content type), PUT /blockscene/settings, or the code `settings`:
editor: {
  previewToolbar: ['modes', 'devices', 'actions'],
  previewDevices: ['fit', 'mobile', { label: 'Laptop', width: 1280 }, 'desktop'],
},
contentTypes: {
  'api::landing.landing': { previewToolbar: ['actions'], previewDevices: ['desktop'] },
}
```

A content type's value replaces the global one. The Settings page edits both as
checklists (check to show, arrows to order, "Add a width" for custom widths);
"Own page preview toolbar" under a content type starts as a copy of the global
choice, and turning it off goes back to the global one.

### Custom sidebar panels

A project (in its `src/admin/app.tsx`) or another plugin can add its own panel
to the visual editor sidebar. Registered panels come after the configured field
items, in registration order; the rail shows in the Visual editor mode as soon
as there is one item.

```tsx
// src/admin/app.tsx
const Notes = ({ values, onChange, disabled, close }) => (
  <textarea value={values.notes ?? ''} disabled={disabled}
    onChange={(e) => onChange('notes', e.target.value)} />
)
export default {
  bootstrap(app) {
    app.getPlugin('blockscene')?.apis.registerPanel({
      id: 'notes', // 1 to 40 letters, digits, _ or -; the same id again replaces the panel
      label: 'Notes', // 1 to 40 characters
      icon: 'info', // optional: an icon name (the sidebar icons above, for example) or a React element
      open: 'drawer', // 'drawer' (default) or 'modal'
      contentTypes: ['api::page.page'], // optional: only these types (default: every type)
      Component: Notes,
    })
  },
}
```

`Component` receives `model` (content type uid), `documentId` (undefined while
creating), `locale`, `values` (the live form values), `onChange(name, value)`
(the form's own setter: the change is unsaved, goes through undo and redo, and
Save or Publish store it with the usual permission checks), `disabled` (the form
is read-only) and `close()`. It renders inside the Content Manager edit view, so
it can also use the admin's hooks (`useForm`, `useFetchClient`...). Strapi runs
every plugin's `register` before any `bootstrap`, then the host's `bootstrap`:
calling `registerPanel` from either bootstrap works. An invalid panel is logged
(`[blockscene] registerPanel: ...`) and ignored; `registerPanel` returns `true`
or `false`. A panel that throws while rendering shows the plugin's error notice
in its drawer; the editor keeps working. On Strapi 4 the same call works (its
`values` and `onChange` are the edit view data manager's); the lab smoke covers
panels on Strapi 5 only.

### Undo and redo

The first zone's bar and the pane toolbar have Undo and Redo buttons (Strapi 5),
on one shared history (the shortcuts use it too).
They step through the whole edit view: blocks inserted, removed or moved from the
gallery, the page, groups or the native actions, and any field edit. Changes
within 400 ms of each other are one step, so a burst of typing undoes at once;
a block dragged with the mouse is one step however long the drag lasts; up to
100 steps. Shortcuts: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Ctrl+Y, only while
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
- Nothing is repaired on read: the Blockscene side panel lists the problems (row, marker) and
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

### Groups in the form

The edit view draws the same structure over Strapi's native rows (Strapi 5 and
4; data attributes on the rows, nothing of the Content Manager is patched):

- The rows between an OPEN and its CLOSE are indented under it with a guide line
  in the admin's primary colour, one level (and one line) per nested group.
- The CLOSE row reads as the group's end: compact, dimmed, without a drag handle
  (it cannot be dragged on its own; its delete stays, with the marker notice).
- Each closed group's OPEN header gets a chevron before its title. It folds the
  group: its rows and CLOSE are hidden and the header shows "N blocks" (every
  row inside, nested ones too, CLOSE markers excluded). Folding is kept in memory
  for the session, per document, zone and group; a reload shows every group open.
  A validation error inside a folded group (on Save or Publish) unfolds it.
  Expand all / Collapse all act on the visible block accordions only: they never
  open the forms of a folded group's rows, and a group keeps its own chevron.
- Moving an OPEN moves its group. Nothing intercepts Strapi's drag and drop:
  after any change of the zone, if the only thing that changed is one OPEN
  moving, its members as they were (children and CLOSE) are put back right after
  it, in the same unsaved form change. This covers the mouse (settled on drop:
  Strapi moves the row on every hover), the keyboard (Space, arrows, Space on the
  drag handle) and the move arrows of small screens. An OPEN dropped among its
  own rows (a single keyboard or arrow step down) moves the group one row down
  instead. The whole drag and the correction are one undo step (Strapi 5).
- Everything else keeps the flat-list meaning: a child dragged out of the range
  is an ordinary block from then on, a block dropped inside becomes a child, and
  an OPEN dropped inside another group is nested there with its rows. A CLOSE
  moved by other means (the small-screen arrows) ends the group where it lands.
  Unclosed groups and stray markers are indented as the page preview shows them
  but have no chevron and are never moved (the diagnostics list them).

### Layout grid

An OPEN whose component lays its children out in columns (a "grid columns"
wrapper) can show them that way in the form. Name the OPEN attribute that holds
its desktop column count, per component, in Settings (the OPEN's card, "Layout
grid") or in the code `settings`:

```json
{ "components": { "wrappers.grid-columns": { "layout": { "columnsField": "columnsMd", "mobileColumnsField": "columns", "maxColumns": 3 } } } }
```

- `columnsField` (required) and `mobileColumnsField` (optional) must be
  attributes of that component that can hold a count: `integer`, `biginteger`,
  `float`, `decimal`, `string`, or an `enumeration` whose every value is a whole
  number (`["1", "2", "3"]`). `maxColumns` is 1 to 12 (default 12). Checked on
  `PUT` and on the code settings at boot; a saved layout whose attribute was
  removed is dropped on read. A layout on a component that is not a configured
  OPEN does nothing.
- The count is read live from the OPEN's form: its value, else the attribute's
  default, else 1, capped at `maxColumns` (a value that is not a whole number
  from 1 counts as missing). The grid shows the desktop count; the mobile one is
  named in its caption.
- Each child is a cell under the OPEN's header (its name and the first text of
  its fields); a nested group is one cell ("N blocks"); the CLOSE stays a row
  below. The children's own rows are hidden but stay mounted, so the form,
  validation, Save and the row tools keep working on them; Expand all skips
  them as it skips a folded group.
- A cell opens its block's native form in the block dialog (the one of the
  visual editor), in any mode, with every field type. A validation error inside
  a child gives its cell a red border; the dialog shows the field.
- Reorder by dragging a cell onto another, or with Alt+Arrow keys on a focused
  cell (left/right one cell, up/down one row of the grid); nested groups move
  whole. "Remove from group" in a cell's "…" menu moves the block right after
  the CLOSE. "Add a block" opens the gallery (the zone's allowed components) and
  inserts at the end of the group; an OPEN brings its CLOSE. Each of these is
  one form change: one undo step on Strapi 5, nothing saved before Save.
- The icon on the OPEN's header switches that group between grid and list (the
  native rows) for the session, per document and group. A folded group shows no
  grid.
- Dragging a cell out of the grid onto the list is not supported (it would need
  Strapi's own drag and drop): use "Remove from group", or the list view.

Strapi 5 and 4 (the block dialog is shared by both since the page preview core).

## Field labels

The Content Manager shows each field under its "Configure the view" label, which
defaults to the raw attribute name (`mobileColumnsCount`). Blockscene rewrites
the edit view labels, hints and placeholders through the Content Manager's own
`Admin/CM/pages/EditView/mutate-edit-view-layout` hook (Strapi 5 and 4, the
same hook the i18n plugin uses), so nothing in the DOM is patched and the
saved view configuration is never changed. Per field, the first that applies:

1. **Project texts** from the plugin config `fields` (below);
2. **schema metadata**: `pluginOptions.blockscene` on the attribute, with its
   translations (see [Describing blocks and fields in the schema](#describing-blocks-and-fields-in-the-schema));
3. **a label set in "Configure the view"** (anything other than the attribute name);
4. **the humanized name** when "Friendly field labels" is on: `mobileColumnsCount`
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
  'shared.seo': { metaTitle: { placeholder: 'Up to 60 characters' },
    metaDescription: { help: { en: 'Shown under the title in search results. Google cuts it around 155 characters; write for people, not keywords.' } } },
} } },
```

Keys are content type or component uids, then attribute names; each of
`label` (up to 80 characters), `description` (300), `placeholder` (120) and
`help` (500) is a string or `{ "<locale>": string }`.

`description` stays the line under the input. `help` is for the longer
explanation that would stretch the form: on Strapi 5 it becomes an "i" icon next
to the label, in the Content Manager's own label action slot (where the i18n
plugin puts its globe; both icons show on localized fields), with the text in a
tooltip on hover and on keyboard focus (the button is reachable with Tab and
named "More information"). A field can have both. On Strapi 4 the Content
Manager gives component fields, where blocks live, no label action, so `help`
is appended to the description under the input instead. The map is validated at boot: an unknown
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

## Describing blocks and fields in the schema

The same texts can live in the component and content type JSON files, next to
what they describe, instead of the long `components` and `fields` config maps:

```jsonc
// src/components/sections/rich-text.json
{
  "collectionName": "components_sections_rich_texts",
  "info": { "displayName": "Rich text", "description": "Formatted text with an optional title and anchor." },
  "pluginOptions": { "blockscene": { "tags": ["Editorial"] } },
  "attributes": {
    "anchor": { "type": "string", "pluginOptions": { "blockscene": { "help": "Id for links to this block (#id), without the \"#\"." } } },
    "text": { "type": "richtext" }
  }
}
// src/components/shared/tag.json, attribute "label"
"label": { "type": "string", "pluginOptions": { "blockscene": { "label": "Tag text", "help": "One or two words." } } }
```

- **Block**: the native `info.description` is the gallery description;
  `pluginOptions.blockscene` takes `label`, `typology`, `tags`, `keywords` and
  `image`, with the same rules as the `components` config entries.
- **Field** (any content type or component attribute): `pluginOptions.blockscene`
  takes `label` (up to 80 characters), `description` (300), `placeholder` (120)
  and `help` (500), each a plain string in the source language, English.

Other languages go in one flat file per locale, given to the plugin config:

```js
// config/plugins.js
blockscene: { config: { translations: { 'pt-BR': require('./blockscene/pt-BR.json') } } },
```

```json
{
  "sections.rich-text": "Texto formatado",
  "sections.rich-text.description": "Texto formatado com título e âncora opcionais.",
  "sections.rich-text.anchor": "Âncora",
  "sections.rich-text.anchor.help": "Id para links a este bloco (#id), sem o \"#\".",
  "shared.tag.label": "Texto da tag"
}
```

Keys are `<uid>` (block label, else the `displayName`), `<uid>.description`
(block description), `<uid>.<attribute>` (field label) and
`<uid>.<attribute>.<description|placeholder|help>`. A component attribute named
`description` takes its label as `<uid>.description.label`. The admin picks the
language as for the field labels above; a missing key shows the schema's
English text, and a translated field label with no English one in the schema
shows Strapi's own label in English.

Precedence, per text: the plugin config (`components`, `fields`, and Settings
for typology and tags) > schema metadata > native Strapi ("Configure the view"
labels, `displayName`) > automatic (humanized names, guessed typology). The
existing config keeps working unchanged. Everything is read once at boot:
invalid values (a typology outside the list, a label over 80 characters, an
unknown key) and translation keys naming no known block or field are left out,
with one warning listing them by uid.

**Content-Type Builder.** Tested on Strapi 5.52.1 and 4.26.1 in development
mode: editing and saving a component in the Content-Type Builder keeps
`pluginOptions.blockscene` (block and attributes) and `info.description`. It
has no field for them, so add and change them in the JSON files.

To move an existing config, from a clone of this repository (idempotent; each
schema file keeps its indentation and key order; labels equal to what the
plugin would show anyway, the humanized name or the `displayName`, are dropped):

```bash
node scripts/schema-metadata.mjs ../my-project/backend --fields fields.json --components components.json [--out dir] [--source en] [--dry-run]
```

`fields.json` and `components.json` hold the two config maps as JSON. The
translation files go to `config/blockscene/<locale>.json`; the script lists
what it could not place and the `components` keys that stay in the config
(`variants`, `template`). Remove the migrated entries from the config
afterwards: the config wins.

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

**Visual editor history (Phase 1).** The preview toolbar's `versions` control
opens a drawer on the right. It is separate from `history` (Undo/Redo). If
you already configured `previewToolbar`, add `versions` to that list or enable
it in Settings. Versions are grouped by local calendar day, with local date
and time, actor, action, and captured counts: total top-level Dynamic Zone rows
(including group markers), added, removed and changed against the preceding
snapshot in that locale. Older or unrecorded events show counts as unavailable;
they are not retroactively counted as zero. The actor filter includes only
people/tokens recorded for this document and locale. Lists use server pagination
(25 per page) and mark events whose snapshots are no longer available.

Selecting an event hydrates its retained snapshot into a separate, read-only
preview. It never calls the form's `setValues`, saves, publishes or restores
anything. The banner identifies the version and returns to the current draft,
including unsaved changes. Fast selections, returning while a load is pending,
and document/locale/permission changes invalidate old responses. The pre-existing
side-panel "Load this version" action remains available; restoration and visual
diff enhancements are separate phases.

The parent rejects every mutation, selection, focus and hover message while
viewing a version. Each version changes the iframe channel, so delayed messages
cannot target the current draft after returning. The `update-page` message adds
`readOnly: true`, sends no editable field/media descriptors and no clipboard.
The reference bridge in `examples/page-preview` supports this flag, removes
editing/insertion controls, and announces `capabilities: ['readOnly']` in `ready`.
Custom bridges should do the same and refuse to queue or send edits when
read-only. An older bridge can still render the snapshot, but the admin disables
iframe interaction (including in-frame scrolling) and explains that it needs an
update. Parent-side protection applies regardless of bridge support. The existing
`hover` protocol highlights; it does not promise scroll-to-block behavior.

The drawer button also explains whether history is disabled/not configured for
the type, the entry needs its first save, or `history.read` is missing. Permission
changes require an administrator; this control cannot grant access.

**Permission.** `Blockscene: Read version history` (`history.read`), plus read
access to the content type in the Content Manager. Snapshots hold removed and
unpublished text, so the section is hidden without it. Admin API:
`GET /blockscene/history/:uid/:documentId?locale=&page=1&pageSize=25&actor=`
(no snapshots; `results`, `pagination`, scoped `actors` and resolved `locale`)
and `GET /blockscene/history-events/:id` (one event, its snapshot and
the media and relation targets that still exist).

**Retention.** Snapshots are kept `retentionDays` (90) and at most
`maxSnapshots` (100) per document, newest first; events without a snapshot are
kept `eventDays` (365, at least `retentionDays`). A cron job added by the plugin
runs nightly at 03:00 server time, in batches of 500; it only empties snapshots
and deletes events, never media files, and running it on several instances is
harmless.
These are configurable limits, not a guarantee that a version from a week ago
still exists: frequent changes can exceed `maxSnapshots` earlier. The snapshot
cap is per document across locales; event metadata may outlive its snapshot.
Naming versions and protecting them from purge are not implemented in Phase 1.

```js
// config/plugins.js
blockscene: { config: { settings: { history: { enabled: true, contentTypes: ['api::page.page', 'api::post.post'],
  retentionDays: 90, maxSnapshots: 100, eventDays: 365, trashDays: 90 } } } }
```

Events live in the `blockscene_events` table (content type
`plugin::blockscene.event`, hidden from the Content Manager and the Content-Type
Builder). Removing the plugin, or installing a Blockscene version older than
the one that added history, lets Strapi drop that table and every recorded
version on the next start: back up `blockscene_events` first if you need it.

### Trash (Strapi 5)

Part of the version history module: on with it, for the same content types.
Strapi has no trash in any plan; here a delete made through the document service
(the admin's Delete, bulk delete and "Delete locale", the APIs, plugins) also
writes one trash entry per document, in the same transaction as the delete.

**What an entry keeps.** Every deleted locale, draft and published rows (they
can differ), as snapshots like the history's; the document's title (its Content
Manager main field); who deleted it and when; and the links other documents and
blocks had to it. Strapi removes those links with the document, and the
document's own snapshot does not hold them when the relation is unidirectional
(declared only on the other side, like a menu listing pages or a block linking
to a page), so they are captured before the delete: owner, field, locale and the
position in the owner's list. A delete without a locale removes the default
locale only (Strapi's rule), `'*'` every locale; the entry has exactly what was
deleted. If the capture fails, nothing is deleted.

**Restore.** From the Trash page, which first shows what the restore would do
and writes nothing if something blocks it:

- Blocking: the content type is gone; a unique field (`unique: true` or a uid
  field, such as a slug) is now used by another document in that locale; the
  document has that locale again; a single type has a document again; none of
  its locales is configured any more.
- Reported, then restored anyway: a published version existed (see below);
  required fields are empty under the current schema (drafts may be, Strapi
  checks them on publish); fields the schema no longer has, blocks whose
  component the zone no longer allows, media files and related documents that no
  longer exist (left out); locales no longer configured (skipped); links whose
  owner is gone or now points elsewhere.

The document comes back as a **draft with its draft content**: the draft is the
latest work, and publishing is the editor's decision (the site may have moved
on). The published snapshot stays in the entry and in the preview. Every locale
is restored under one documentId, the default locale first, through the
document service (validation and the project's lifecycles run). A document that
is gone gets a new documentId, since Strapi's create does not take one; a locale
deleted from a document that still exists goes back into that document. The
captured links are put back where they were (same position in the owner's
list) when the owner still exists; links from published versions come back
when those owners are published again after this document is. A restore is one
transaction and is idempotent: the entry is claimed first, so a second restore
(a double click, another editor, another instance) returns the first one's
document. The history gets a `restore` event per locale.

**Delete forever** removes one entry (recorded as a `purge` event in the
activity). The nightly job deletes entries past their expiry, restored ones too,
in batches; neither ever deletes media files.

**Retention.** `trashDays` (90, 1 to 3650) in the same settings; each entry's
expiry is fixed when the document is deleted, so a later change applies to later
deletes.

```js
blockscene: { config: { settings: { history: { enabled: true, trashDays: 30 } } } }
```

Entries live in `blockscene_trash` (`plugin::blockscene.trash`, hidden from the
Content Manager and the Content-Type Builder); the same backup note as for
`blockscene_events` applies.

### Activity and Trash pages (Strapi 5)

A main menu link, "Activity and trash", opens one page with a tab each (the
pages are tools for editors, not configuration, so they are not under
Settings). **Activity** lists every recorded event, newest first, 25 per page,
filtered by person, content type, action, date range and title (documents whose
main field contains the text now, or whose trash entry's title does); each row
links to the document's edit view while that locale exists and shows the
summary. **Trash** lists the entries (title, type, locales, who, when, when it
is deleted for good), filtered by content type, with restored entries on a
switch; Preview shows the fields and blocks of each deleted locale, read-only;
Restore shows the pre-check report and asks to confirm; Delete forever asks
first.

**Permissions.** `Read content activity` (`activity.read`), `Read the trash`
(`trash.read`), `Restore from the trash` (`trash.restore`), `Delete from the
trash forever` (`trash.purge`), none granted to non-super-admin roles by
default. On top of them, every list shows only content types the user may read
in the Content Manager (an entry of another type answers 404), restoring needs
create there and deleting forever needs delete. Admin API: `GET /blockscene/activity`
(`actor`, `contentType`, `action`, `from`, `to` as ISO dates, `q`, `page`,
`pageSize` up to 100), `GET /blockscene/trash` (`contentType`, `status`
trashed or restored, `page`, `pageSize`), `GET /blockscene/trash/:id` (the
preview), `GET /blockscene/trash/:id/check` (the pre-check),
`POST /blockscene/trash/:id/restore` (409 with the report when blocked) and
`DELETE /blockscene/trash/:id`. Lists never load snapshots.

**Coverage boundary**, the same as the history's: the document service only.
A raw `strapi.db.query` delete, SQL or a database restore leaves no trash
entry; deleting a content type (Content-Type Builder) drops its data without
one. The trash is a safety net for editors, not a backup: keep database backups.

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

- **From the settings page**: switch "Editor enhancements enabled" off. The
  gallery, the zone bars and the initial-state logic disappear and the native picker and
  accordions remain. Content, config, media and unsaved edits are preserved; the
  form is not reloaded. The settings page stays available to turn it back on.
- **Emergency, outside the admin**: start the server with
  `BLOCKSCENE_DISABLED=true` (or set `config.disabled: true`). It is read at
  boot and reported by the catalog, wins over the saved settings and cannot be
  undone from the client. Changing it requires a restart.
- **If the catalog request fails**, the plugin renders nothing and the native
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
- "Expand all" / "Collapse all" drive the native accordions without touching the
  whole list at once: expanding opens the rows in and near the visible area, a
  few per frame, and the others as they approach while scrolling (until Collapse
  all or leaving the document); collapsing closes the visible rows at once and
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
- [Prioritized roadmap](docs/ROADMAP.md).

This plugin does not require Image Optimization; both can be installed together.

## License

MIT, copyright 2026 Andrea Scarpello (personal project, authored outside any
employer's work). See `LICENSE`.
