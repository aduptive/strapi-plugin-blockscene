# Compatibility

| Distribution | Plugin version | dist-tag | Strapi peer range | Verified on | Admin runtime |
| --- | --- | --- | --- | --- | --- |
| `packages/strapi4` | `1.0.0-alpha.1` | `strapi4` | `>=4.20.0 <5` | 4.26.1 / Node 20.11 (local lab) | Design System 1, React 18, styled-components 5 |
| `packages/strapi5` | `2.0.0-alpha.1` | `next` | `>=5.23.0 <6` | 5.52.1 / Node 22.22 (local lab), 5.23.5 and 5.31.0 (real site projects) | Design System 2, React 18, styled-components 6 |

The peer ranges say what installs without overrides; only the listed versions
have runtime evidence (browser smoke: gallery, thumbnails, settings, accordion
preferences, publish guard, page preview on Strapi 5). Do not read them as a
claim for every 4.x / 5.x minor.

Accordion preferences work through the native `aria-expanded` headers of the
Dynamic Zone list. The whole-page preview and the native "Add a component"
interception are DOM-level integrations with the Content Manager and are the
parts most likely to need adjustment on a future Strapi minor; the unit and
browser checks in `scripts/` and `tests/` are the regression net.

Storage: the labs use SQLite and the local upload provider. Cloud upload
providers are supported for thumbnails (any http(s) media URL) but not
certified by these tests.
