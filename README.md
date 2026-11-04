# Blockscene for Strapi

Blockscene turns Strapi Dynamic Zones into a visual, safer page-building
workflow. Editors browse only the blocks allowed by the content type, insert
them from a gallery and edit with familiar Strapi fields or against a live
preview of the real frontend.

It does **not** replace Strapi's schemas or render your website. Content remains
ordinary Strapi component data, your frontend remains in control, and removing
the plugin requires no content migration.

**Alpha.** Blockscene is published as a pre-release. APIs, settings and the
preview bridge may change between alphas. See the verified
[compatibility matrix](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/COMPATIBILITY.md).

## What it adds

- **Visual block gallery**: search, filters, thumbnails, favourites and previews
  for the components allowed by each Dynamic Zone. The server validates the
  same allowlist.
- **Three editing modes**: Fields only, Fields + preview, and Visual editor.
  The preview modes render your own frontend beside the form and connect a
  clicked section back to its fields.
- **Editorial structure**: insert variants, starter kits for new entries, safe
  layout groups and grids, clearer field labels and template-driven text.
- **Workflow tools**: copy, paste, row thumbnails and selection on both Strapi
  versions; undo, redo, version history and trash on Strapi 5.

The gallery works without frontend changes. Live page preview is optional and
uses a small message bridge; Blockscene never ships a page renderer.

## Quick start

### 1. Install the distribution that matches Strapi

```sh
# Strapi 5 (plugin major 2)
npm install @aduptive/strapi-blockscene@latest

# Strapi 4 (plugin major 1)
npm install @aduptive/strapi-blockscene@strapi4
```

Both distributions use the same package name. Install only one.

### 2. Enable the plugin

Add it to `config/plugins.js`, or export the equivalent object from
`config/plugins.ts`:

```js
module.exports = {
  blockscene: {
    enabled: true,
  },
}
```

### 3. Rebuild the admin and open a Dynamic Zone

```sh
npm run build
npm run develop
```

Open an entry whose content type has a Dynamic Zone and use its native **Add a
component** button. Blockscene replaces Strapi's category picker with the visual
gallery. Existing entries and components need no migration.

## Add the live frontend preview (optional)

Fields + preview and Visual editor need a preview route in your site and the
Blockscene bridge. The plugin sends the current unsaved entry to that route;
the route renders it with the same blocks and styles as the published page.

Follow the
[whole-page preview guide](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#whole-page-preview)
for the bridge protocol, read-only history previews, click-to-edit fields,
insertion seams, sidebar panels and responsive widths.

## Pick only what your project needs

| Need | Feature |
| --- | --- |
| Make a Dynamic Zone easier to browse | [Gallery, thumbnails and taxonomy](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#gallery) |
| Show the real page while editing fields | [Fields + preview](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#whole-page-preview) |
| Click the page to edit blocks or insert new ones | [Visual editor](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#whole-page-preview) |
| Give new pages or posts a useful starting structure | [Starter kits](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#starter-kits) |
| Offer preset versions of the same block | [Insert variants](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#insert-variants) |
| Keep wrappers and their children together | [Layout groups and grids](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#layout-groups-optional) |
| Guide compact, structured copy without a rich-text editor | [Text template custom field](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#text-template-custom-field-pilot) |
| Review or recover editorial changes on Strapi 5 | [Version history and trash](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md#version-history-strapi-5) |

Advanced features such as frontend preview, starter kits, layout groups and
version history are opt-in. **Settings > Blockscene** tunes the default gallery
and editor enhancements for each installation; project code can provide shared
defaults.

## Supported versions

| Strapi | Blockscene | npm tag |
| --- | --- | --- |
| 5.x | `2.0.0-alpha.15` | `latest` |
| 4.11+ | `1.0.0-alpha.13` | `strapi4` |

These are peer ranges, not a promise that every Strapi minor has been tested.
The
[compatibility matrix](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/COMPATIBILITY.md)
lists the exact versions, Node runtimes and browser-smoke evidence.

## Documentation

- [Complete feature and configuration reference](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/REFERENCE.md)
- [Compatibility and verified Strapi versions](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/COMPATIBILITY.md)
- [Local integration testing](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/LOCAL-TESTING.md)
- [Prioritized roadmap](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/ROADMAP.md)
- [Release checklist](https://github.com/aduptive/strapi-plugin-blockscene/blob/main/docs/RELEASE.md)

## Development

```sh
nvm use
npm ci
npm run check
```

The repository builds independently installable Strapi 4 and Strapi 5 packages
from shared admin and server code. Blockscene does not require the Image
Optimization plugin; both can be installed together.

## License

MIT, copyright 2026 Andrea Scarpello. See [LICENSE](LICENSE).
