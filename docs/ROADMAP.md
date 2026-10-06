# Roadmap

Priorities reflect the order agreed after the `2.0.0-alpha.13` refinement
round. Completed work belongs in the changelog, not in this list.

## P1 — Required-field starter values

Allow a project to configure starter values for required fields when a block is
inserted, including text, rich text, components and media. Values must be
schema-validated, locale-aware and opt-in; media must reference an existing
asset instead of inventing an upload. The editor must distinguish starter
content that will be saved from a visual-only placeholder, and nothing may be
published automatically.

Acceptance criteria:

- project configuration can provide defaults per component, field and locale;
- the same validation path is used by gallery insertion, variants and kits;
- required nested components and minimum repeatable counts are supported;
- missing or unauthorized media fails safely with a useful editor message;
- Strapi 4 and 5 browser smokes cover text and media cases.

## P1 — Precise editing inside repeaters

Extend the page-preview protocol so a rendered repeated card can open the exact
component item and field that was clicked, including an image inside that item.
The mapping must use stable form paths or keys rather than a visual array index
alone, and fall back to the containing block dialog when a site has not added
the finer annotations.

Acceptance criteria:

- text and media targets can include nested component paths and stable row keys;
- reordered and newly inserted repeater items still open the correct row;
- a missing or stale target never edits another item;
- the reference bridge and both host adapters share the same protocol tests.

## P2 — Version history phase 2

Add deliberate version management on top of the existing read-only history:
optional names, comparison, restore with a confirmation summary, and retention
or purge controls. Unsaved form state must never be lost implicitly.

Acceptance criteria:

- editors can name retained versions and compare block-level changes;
- restore is explicit, permission checked and undoable before Save;
- retention and purge explain their scope by content type, locale and actor;
- concurrency and stale-response guards remain covered by browser smoke.

## P2 — Stable release and Marketplace readiness

Move from alpha to a stable major only after the supported Strapi matrix,
permissions, accessibility, upgrade notes and Marketplace metadata are
complete. Do not broaden peer ranges beyond versions exercised in the labs.

Acceptance criteria:

- clean-install and upgrade smokes pass on every documented Strapi version;
- keyboard, focus, reduced-motion and narrow-screen checks are recorded;
- migration and rollback notes cover every persisted setting and database table;
- package provenance, documentation and Marketplace assets are ready together.

## P3 — Reusable frontend preview adapter

Extract the reference bridge helpers used by site previews into a small,
versioned adapter so projects do not copy message validation, selection
geometry and target annotations. Keep renderers site-owned: the adapter defines
the protocol and editor chrome, not the site's block UI.

Acceptance criteria:

- one compatibility-tested adapter supports the current protocol version;
- selection bounds include rendered margin boxes without changing page layout;
- projects can extend field targeting without forking the transport layer;
- a migration guide covers existing hand-written preview routes.
