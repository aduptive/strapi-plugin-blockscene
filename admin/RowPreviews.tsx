import * as React from "react";
import { createPortal } from "react-dom";
import { candidatesFor } from "./model.mjs";
import { findZoneList, toggles } from "./accordions.mjs";
import { Thumb } from "./Gallery";
import { useMessages } from "./messages";

// The thumbnail of each added block, inside its native accordion header, plus the
// full-size modal it opens. Strapi owns that header, so one inert <span> is inserted
// per row and React portals the thumbnail into it — the same DOM approach as the
// accordion controls, so no patch of the Content Manager is needed.
// ponytail: DOM injection; drop it if Strapi ever exposes a row slot.
const ATTR = "data-blockscene-row-thumb";
type Anchor = { el: HTMLElement; uid: string; zone: string; index: number };

// Rows are matched to headers by position: `zone.uids` is the stored order of the same list.
function useAnchors(zones: any[], onOpen: (uid: string) => void) {
  const [anchors, setAnchors] = React.useState<Anchor[]>([]);
  const open = React.useRef(onOpen);
  open.current = onOpen;
  const latest = React.useRef(zones);
  latest.current = zones;
  const sync = React.useRef(() => {});
  sync.current = () => {
    const next: Anchor[] = [];
    for (const zone of latest.current) {
      const list = zone.uids?.length ? findZoneList(zone.label) : null;
      if (!list) continue;
      toggles(list).forEach((button: HTMLElement, index: number) => {
        const uid = zone.uids[index];
        if (!uid) return;
        let el = button.querySelector(
          `:scope > [${ATTR}]`,
        ) as HTMLElement | null;
        if (!el) {
          el = document.createElement("span");
          el.setAttribute(ATTR, "");
          el.style.cssText = "display:inline-flex;align-items:center";
          // Capture phase: the click never reaches Strapi's trigger, so opening the
          // preview does not also expand or collapse the row.
          const activate = (event: Event) => {
            if (!(event.currentTarget as HTMLElement).getAttribute("role"))
              return;
            event.preventDefault();
            event.stopPropagation();
            open.current(
              String((event.currentTarget as HTMLElement).dataset.uid || ""),
            );
          };
          el.addEventListener("click", activate, true);
          el.addEventListener(
            "keydown",
            (event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") activate(event);
            },
            true,
          );
          button.insertBefore(el, button.firstChild);
        }
        el.dataset.uid = uid;
        next.push({ el, uid, zone: zone.name, index });
      });
    }
    // A row removed while its anchor survived (React kept the header) leaves no orphan behind.
    for (const el of document.querySelectorAll<HTMLElement>(`[${ATTR}]`))
      if (!next.some((a) => a.el === el)) el.remove();
    setAnchors((prev) =>
      prev.length === next.length &&
      prev.every((a, i) => a.el === next[i].el && a.uid === next[i].uid)
        ? prev
        : next,
    );
  };
  // Every render: inserts, deletes and reorders all reach here through the form values.
  React.useEffect(() => {
    sync.current();
  });
  // Strapi re-renders the list on its own (drag, validation, mainField edits); a
  // wiped anchor is re-inserted on the next frame, batched so typing stays cheap.
  React.useEffect(() => {
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync.current();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const el of document.querySelectorAll(`[${ATTR}]`)) el.remove();
    };
  }, []);
  return anchors;
}

export function RowPreviews({ zones, components, catalog, Modal }: any) {
  const t = useMessages();
  // Which candidate answered, per component: the modal shows the image the row shows (-1: none did).
  const [resolved, setResolved] = React.useState<Record<string, number>>({});
  const [open, setOpen] = React.useState<string | null>(null);
  const anchors = useAnchors(zones, (uid) => setOpen(uid));
  const candidates = (uid: string) =>
    candidatesFor(uid, catalog?.components?.[uid] || {}, catalog || {});
  const label = (uid: string) =>
    catalog?.components?.[uid]?.label ||
    components?.[uid]?.info?.displayName ||
    uid;
  const srcOf = (uid: string) => candidates(uid)[resolved[uid] ?? -1] || "";
  // Only a row with a working image is a control: an empty anchor must not take focus.
  React.useEffect(() => {
    for (const { el, uid } of anchors) {
      if (srcOf(uid)) {
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute("aria-label", t.f("rowPreview", { label: label(uid) }));
        el.style.cursor = "zoom-in";
      } else
        for (const name of ["role", "tabindex", "aria-label"])
          el.removeAttribute(name);
    }
  });
  return (
    <>
      {anchors.map((a) =>
        createPortal(
          <span
            style={{
              display: "block",
              width: "6.4rem",
              marginRight: "8px",
              flex: "0 0 auto",
            }}
          >
            <Thumb
              candidates={candidates(a.uid)}
              blank
              onResolved={(index: number) =>
                setResolved((prev) =>
                  prev[a.uid] === index ? prev : { ...prev, [a.uid]: index },
                )
              }
            />
          </span>,
          a.el,
          `${a.zone}:${a.index}`,
        ),
      )}
      {open && srcOf(open) && (
        <Modal
          open
          onOpenChange={(value: boolean) => {
            if (!value) setOpen(null);
          }}
          trigger={null}
          title={label(open)}
        >
          <img
            src={srcOf(open)}
            alt=""
            style={{
              display: "block",
              margin: "0 auto",
              maxWidth: "100%",
              maxHeight: "75vh",
              objectFit: "contain",
            }}
          />
        </Modal>
      )}
    </>
  );
}
