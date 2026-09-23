# Compatibility

| Distribution | Plugin version | dist-tag | Strapi peer range | Verified on | Admin runtime |
| --- | --- | --- | --- | --- | --- |
| `packages/strapi4` | `1.0.0-alpha.2` | `strapi4` | `>=4.11.0 <5` | 4.11.0 and 4.26.1 / Node 20 (local labs) | Design System 1, React 18, styled-components 5 |
| `packages/strapi5` | `2.0.0-alpha.2` | `next` | `>=5.0.0 <6` | 5.0.0 and 5.52.1 / Node 22 (local labs), 5.23.5 and 5.31.0 (real site projects) | Design System 2, React 18, styled-components 6 |

The peer ranges say what installs without overrides; only the listed versions
have runtime evidence (browser smoke: gallery, thumbnails, settings, accordion
preferences, publish guard, page preview on Strapi 5). Do not read them as a
claim for every 4.x / 5.x minor.

Accordion preferences work through the native `aria-expanded` headers of the
Dynamic Zone list. The whole-page preview and the native "Add a component"
interception are DOM-level integrations with the Content Manager and are the
parts most likely to need adjustment on a future Strapi minor; the unit and
browser checks in `scripts/` and `tests/` are the regression net.

Why these floors: Strapi 4.0–4.10 admins run React 17 and do not export
`useFetchClient`; 4.11 is the first with React 18. Every Strapi 5 API the
plugin uses exists in 5.0.0. Two old-version quirks are handled in the code:
older Strapi 4 (4.11; 4.26 accepts both) reads the settings page loader as a module (`{ default }`), and
Strapi < 5.8.1 `addFieldRow(field, value, index)` overwrites the row at `index`
instead of inserting, so the page preview appends and then moves the row.

The packages declare no peer on `@strapi/admin` or `@strapi/content-manager`:
a host project usually does not list them, so npm would install a second,
newer copy at the root and break the admin build (seen with 5.0.0 and 4.11.0).
They come with `@strapi/strapi`.

Testing an old host with today's npm needs what its own lockfile would pin:
Strapi 5.0.0 needs `@strapi/email@5.0.0` at the root, Strapi 4.11 needs
`webpack@5.88.2` (newer webpack rejects its ProgressPlugin options). Both
happen without the plugin installed.

Storage: the labs use SQLite and the local upload provider. Cloud upload
providers are supported for thumbnails (any http(s) media URL) but not
certified by these tests.
