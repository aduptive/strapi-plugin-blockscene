import * as React from "react";
import { createPortal, unstable_batchedUpdates } from "react-dom";
import {
  Box,
  Button,
  Flex,
  Searchbar,
  Typography,
} from "@strapi/design-system";
import styled from "styled-components";
import {
  entriesFor,
  optionsFor,
  groupEntries,
  TYPOLOGIES,
  memoryKey,
  readMemory,
  writeMemory,
  initialState,
  blockPreviewSrc,
  componentDefaults,
} from "./model.mjs";
import { PROTOCOL, isPreviewMessage, projectPage } from "./preview.mjs";
import { DEVICES, type Device, frameStyle, useStageSize, stageBackground } from "./devices";
import {
  findZoneList,
  setAll,
  stopAll,
  toggles,
  isNativeAddButton,
} from "./accordions.mjs";
import { Wireframe } from "./wireframes";
import { RowPreviews } from "./RowPreviews";
import { RowActions, ZoneRowTools, useRowActions } from "./RowActions";
import { useMessages } from "./messages";
import { Icon, Tool } from "./icons";

// Masonry per typology (CSS columns): tiles keep their thumbnail's real proportions, so a global
// alphabetical order would read as scrambled; grouping by typology is the useful axis.
const Columns = styled.div<{ $columns: number }>`
  column-count: ${({ $columns }) => $columns};
  column-gap: 12px;
  > * {
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    margin-bottom: 12px;
  }
`;
const Tile = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  width: 100%;
  padding: 8px;
  border: 1px solid ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral200)};
  box-shadow: ${({ theme, $active }) => ($active ? `0 0 0 1px ${theme.colors.primary600}` : "none")};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  cursor: pointer;
  &:hover {
    border-color: ${({ theme }) => theme.colors.primary600};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;
const Clamp = styled(Typography)`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;
// Native range input restyled with theme tokens: the design system has no slider.
const Slider = styled.input<{ $percent: number }>`
  appearance: none;
  -webkit-appearance: none;
  width: 8rem;
  height: 0.4rem;
  border-radius: 0.4rem;
  cursor: pointer;
  background: ${({ theme, $percent }) =>
    `linear-gradient(to right, ${theme.colors.primary600} ${$percent}%, ${theme.colors.neutral200} ${$percent}%)`};
  &::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.neutral0};
    border: 0.2rem solid ${({ theme }) => theme.colors.primary600};
    cursor: pointer;
  }
  &::-moz-range-thumb {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.neutral0};
    border: 0.2rem solid ${({ theme }) => theme.colors.primary600};
    cursor: pointer;
  }
  &:focus-visible {
    outline: 0.2rem solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 0.2rem;
  }
`;
const COLUMNS = { key: "blockscene:columns", min: 1, max: 5, initial: 3 };
const SHOW_FIELDS_KEY = "blockscene:show-fields";
const readColumns = () => {
  try {
    const n = Number(window.localStorage.getItem(COLUMNS.key));
    return n >= COLUMNS.min && n <= COLUMNS.max ? n : COLUMNS.initial;
  } catch {
    return COLUMNS.initial;
  }
};
const readShowFields = () => {
  try {
    return window.localStorage.getItem(SHOW_FIELDS_KEY) !== "false";
  } catch {
    return true;
  }
};
const remember = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* blocked storage keeps the session value */
  }
};
const Frame = styled.div<{ $fixed?: boolean }>`
  width: 100%;
  overflow: hidden;
  border-radius: 4px;
  line-height: 0;
  aspect-ratio: ${({ $fixed }) => ($fixed ? "16 / 9" : "auto")};
  background: ${({ theme }) => theme.colors.neutral100};
  img {
    width: 100%;
    height: auto;
    display: block;
  }
`;
// Tries each candidate URL in order; a failure advances without looping and the
// list restarts whenever the candidates change (so a fixed image recovers).
// `blank` renders nothing instead of the wireframe when every candidate failed (accordion rows: no image, no placeholder).
export function Thumb({
  candidates,
  template,
  palette,
  onResolved,
  noPreview,
  eager,
  blank,
}: any) {
  const key = candidates.join("|");
  const [state, setState] = React.useState({ key, index: 0 });
  const index = state.key === key ? state.index : 0;
  const resolved = React.useRef<string>("");
  const report = (value: number) => {
    const tag = `${key}:${value}`;
    if (resolved.current !== tag) {
      resolved.current = tag;
      onResolved?.(value);
    }
  };
  React.useEffect(() => {
    if (index >= candidates.length) report(-1);
  });
  if (index >= candidates.length)
    return blank ? null : (
      <Frame $fixed data-thumb="wireframe">
        <Wireframe
          template={template}
          palette={palette}
          noPreview={noPreview}
        />
      </Frame>
    );
  return (
    <Frame data-thumb={String(index)}>
      <img
        key={candidates[index]}
        src={candidates[index]}
        alt=""
        loading={eager ? "eager" : "lazy"}
        onLoad={() => report(index)}
        onError={() => setState({ key, index: index + 1 })}
      />
    </Frame>
  );
}

// Browser layout: sidebar (views and typologies) · grid. Only the grid scrolls; the magnified block covers it.
const Layout = styled.div`
  display: flex;
  height: min(70vh, 720px);
  min-height: 320px;
`;
const Side = styled.nav<{ $collapsed: boolean }>`
  flex: 0 0 ${({ $collapsed }) => ($collapsed ? "48px" : "200px")};
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 12px;
  margin-right: 12px;
  border-right: 1px solid ${({ theme }) => theme.colors.neutral150};
  overflow-y: auto;
`;
const NavItem = styled.button<{ $active?: boolean; $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: ${({ $collapsed }) => ($collapsed ? "center" : "flex-start")};
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral700)};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : "transparent")};
  &:hover {
    background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral100)};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
  .bs-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bs-count {
    color: ${({ theme }) => theme.colors.neutral500};
    font-size: 12px;
  }
`;
const Main = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
// Filter menu: the design system's selects are single or search-oriented; a small checkbox popover fits both versions.
const Menu = styled.div`
  position: relative;
`;
const MenuButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  border: 1px solid ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral200)};
  color: ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral800)};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral0)};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
`;
const Popover = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  min-width: 180px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  box-shadow: 0 2px 12px rgba(33, 33, 52, 0.15);
  label {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: ${({ theme }) => theme.colors.neutral800};
  }
  label:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  .bs-count {
    margin-left: auto;
    color: ${({ theme }) => theme.colors.neutral500};
  }
`;
const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 12px;
  border: 1px solid ${({ theme }) => theme.colors.primary200};
  color: ${({ theme }) => theme.colors.primary700};
  background: ${({ theme }) => theme.colors.primary100};
`;
const Badge = styled.span`
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.neutral0};
  background: ${({ theme }) => theme.colors.neutral800};
`;
const CardBox = styled.div`
  position: relative;
  &:hover .bs-quick,
  &:focus-within .bs-quick {
    opacity: 1;
  }
`;
const CardBadges = styled.div`
  position: absolute;
  top: 14px;
  left: 14px;
  right: 48px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  pointer-events: none;
`;
const Round = styled.button<{ $on?: boolean; $primary?: boolean }>`
  position: absolute;
  right: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  cursor: pointer;
  border: 1px solid ${({ theme, $primary }) => ($primary ? theme.colors.primary600 : theme.colors.neutral200)};
  color: ${({ theme, $on, $primary }) => ($primary ? theme.colors.neutral0 : $on ? theme.colors.warning500 : theme.colors.neutral600)};
  background: ${({ theme, $primary }) => ($primary ? theme.colors.primary600 : theme.colors.neutral0)};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 1px;
  }
  &.bs-quick {
    opacity: 0;
    transition: opacity 120ms;
  }
`;
const Mono = styled.code`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.neutral600};
`;
const SIDEBAR_KEY = "blockscene:gallery-sidebar";
const readCollapsed = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
};
const TYPE_ICONS: Record<string, string> = { hero: "hero", text: "text", media: "image", listing: "list", cards: "cards", cta: "link", form: "form", layout: "layout" };
const FILTER_MENUS = ["tags", "media", "content"] as const;
const toggled = (list: string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

function FilterMenu({ name, label, options, picked, onChange, labelOf }: any) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const down = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    // Window capture runs before the modal's own Escape handler: Escape closes the menu, not the gallery.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <Menu ref={ref} data-testid={`gallery-filter-${name}`}>
      <MenuButton
        type="button"
        aria-expanded={open}
        $active={picked.length > 0}
        onClick={() => setOpen(!open)}
      >
        {picked.length ? `${label} (${picked.length})` : label}
        <Icon name="chevron" size={14} />
      </MenuButton>
      {open && (
        <Popover role="group" aria-label={label}>
          {options.map(([value, count]: any) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={picked.includes(value)}
                onChange={() => onChange(toggled(picked, value))}
                data-testid={`gallery-option-${name}-${value}`}
              />
              <span>{labelOf(value)}</span>
              <span className="bs-count">{count}</span>
            </label>
          ))}
        </Popover>
      )}
    </Menu>
  );
}

function Badges({ entry, t, tags }: any) {
  return (
    <>
      {entry.facets.map((facet: string) => (
        <Badge key={facet}>{t.facets[facet] || facet}</Badge>
      ))}
      {tags && entry.tags.map((tag: string) => <Badge key={`tag:${tag}`}>{tag}</Badge>)}
    </>
  );
}

// Click magnifies the block; double click, Enter or the "+" inserts at once. A single click waits out the
// double click window, so a double click never starts the magnify animation.
function Card({ entry, palette, showFields, starred, active, onOpen, onInsert, onStar }: any) {
  const t = useMessages();
  const timer = React.useRef<any>(null);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <CardBox title={entry.uid} data-testid={`blockscene-${entry.uid}`}>
      <Tile
        type="button"
        $active={active}
        onClick={(event: React.MouseEvent) => {
          clearTimeout(timer.current);
          if (event.detail === 2) onInsert();
          else if (event.detail === 1) timer.current = setTimeout(onOpen, 220);
          else onOpen();
        }}
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onInsert();
        }}
      >
        <Thumb
          candidates={entry.candidates}
          template={entry.template}
          palette={palette}
          noPreview={t.noPreview}
        />
        <Typography variant="pi" fontWeight="bold" textColor="neutral800" ellipsis>
          {entry.label}
        </Typography>
        {entry.description && (
          <Clamp variant="pi" textColor="neutral600">
            {entry.description}
          </Clamp>
        )}
        {showFields && entry.fields.length > 0 && (
          <Typography
            variant="pi"
            textColor="neutral500"
            style={{ fontStyle: "italic" }}
            data-testid="block-fields"
          >
            {entry.fields.map((f: any) => `${f.name} (${f.type})`).join(", ")}
          </Typography>
        )}
      </Tile>
      <CardBadges>
        <Badges entry={entry} t={t} />
      </CardBadges>
      <Round
        type="button"
        style={{ top: 12 }}
        $on={starred}
        aria-pressed={starred}
        aria-label={starred ? t.unstar : t.star}
        title={starred ? t.unstar : t.star}
        onClick={onStar}
        data-testid={`gallery-star-${entry.uid}`}
      >
        <Icon name="star" size={16} filled={starred} />
      </Round>
      <Round
        type="button"
        className="bs-quick"
        style={{ top: 46 }}
        $primary
        aria-label={t.f("quickInsert", { label: entry.label })}
        title={t.f("quickInsert", { label: entry.label })}
        onClick={onInsert}
        data-testid={`gallery-quick-${entry.uid}`}
      >
        <Icon name="plus" size={16} />
      </Round>
    </CardBox>
  );
}

// Magnified block: a panel over the grid area (sidebar and toolbar stay usable), the grid dimmed underneath.
const Scrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: 4;
  opacity: 0.35;
  background: ${({ theme }) => theme.colors.neutral800};
`;
const Panel = styled.section`
  position: absolute;
  inset: 16px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0};
  box-shadow: ${({ theme }) => theme.shadows?.popupShadow || "0 8px 32px rgba(33, 33, 52, 0.3)"};
  transform-origin: top left;
`;
const Stage = styled.div<{ $device: boolean }>`
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background-color: ${({ theme }) => stageBackground(theme).backgroundColor};
  background-image: ${({ theme }) => stageBackground(theme).backgroundImage};
  background-size: 24px 24px;
`;
// The card's own thumbnail, contained: it shows at once and stays when the live source fails.
const Still = styled.div<{ $covered: boolean }>`
  position: absolute;
  inset: 0;
  /* Hidden once the live page has faded in over it (device widths would show it in the gutters). */
  visibility: ${({ $covered }) => ($covered ? "hidden" : "visible")};
  transition: visibility 0s linear ${({ $covered }) => ($covered ? "200ms" : "0s")};
  > [data-thumb] {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    background: transparent;
  }
  img,
  svg {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;
const Live = styled.iframe<{ $shown: boolean }>`
  position: absolute;
  top: 0;
  border: 0;
  background: white;
  transform-origin: top left;
  opacity: ${({ $shown }) => ($shown ? 1 : 0)};
  transition: opacity 200ms ease-out;
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
const Strip = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
`;
const FieldsButton = styled.button`
  border: 0;
  padding: 0;
  cursor: pointer;
  background: none;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.primary600};
`;
const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
// FLIP: the panel is laid out once at its final place; only transform/opacity animate from (or back to) the card.
const flip = (panel: HTMLElement | null, scrim: HTMLElement | null, card: Element | null, back: boolean) => {
  if (!panel?.animate || reducedMotion()) return null;
  const to = panel.getBoundingClientRect();
  const from = card?.getBoundingClientRect();
  const timing = { duration: 250, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: back ? "forwards" : "none" } as const;
  const frames = [
    from?.width && to.width
      ? { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.6 }
      : { transform: "scale(0.96)", opacity: 0 },
    { transform: "none", opacity: 1 },
  ];
  const dim = [{ opacity: 0 }, { opacity: 0.35 }];
  scrim?.animate(back ? dim.reverse() : dim, timing);
  return panel.animate(back ? frames.reverse() : frames, timing);
};
const newChannel = () => (crypto as any).randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
// Live source: editor.blockPreviewUrl (plain page per block), else the page preview route with the bridge
// (one block of schema defaults, read-only), else none (the image stays).
function useLiveSource(entry: any, config: any, components: any, get: any, contentType?: string, locale?: string) {
  const editor = config?.editor || {};
  const [native, setNative] = React.useState<string | null>(null);
  const plain = editor.blockPreviewUrl ? blockPreviewSrc(editor.blockPreviewUrl, entry.uid, { locale: locale || "" }) : null;
  React.useEffect(() => {
    if (editor.blockPreviewUrl || editor.previewUrl || !contentType || !get) return;
    let active = true;
    // Strapi 5 native Preview only; elsewhere the request fails and the image stays.
    get(`/content-manager/preview/url/${contentType}?${new URLSearchParams({ status: "draft", ...(locale ? { locale } : {}) })}`)
      .then(({ data }: any) => {
        if (active && typeof data?.data?.url === "string") setNative(`${new URL(data.data.url).origin}/block-preview/page`);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [editor.blockPreviewUrl, editor.previewUrl, contentType, locale, get]);
  const channel = React.useMemo(newChannel, []);
  if (editor.blockPreviewUrl) return plain ? { kind: "plain", src: plain, origin: "", channel } : null;
  const base = editor.previewUrl || native;
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set("channel", channel);
    return { kind: "bridge", src: url.href, origin: url.origin, channel };
  } catch {
    return null;
  }
}
const LIVE_TIMEOUT = 8000;
function Magnify({ entry, palette, config, components, get, contentType, locale, starred, onStar, onInsert, onClose, cardOf }: any) {
  const t = useMessages();
  const panel = React.useRef<HTMLElement>(null);
  const scrim = React.useRef<HTMLDivElement>(null);
  const closeButton = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLIFrameElement>(null);
  const closing = React.useRef(false);
  const [stageEl, setStageEl] = React.useState<HTMLDivElement | null>(null);
  const stage = useStageSize(stageEl);
  const [device, setDevice] = React.useState<Device>("fit");
  const [fields, setFields] = React.useState(false);
  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const live = useLiveSource(entry, config, components, get, contentType, locale);
  React.useLayoutEffect(() => {
    flip(panel.current, scrim.current, cardOf(entry.uid), false);
    closeButton.current?.querySelector("button")?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    const card = cardOf(entry.uid);
    const done = () => {
      onClose();
      card?.querySelector("button")?.focus({ preventScroll: true });
    };
    const animation = flip(panel.current, scrim.current, card, true);
    if (animation) animation.onfinish = done;
    else done();
  };
  const closeRef = React.useRef(close);
  closeRef.current = close;
  // Window capture runs before the modal's own Escape handler: Escape closes the magnified block, not the gallery.
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const src = live?.src;
  React.useEffect(() => {
    if (!live) return;
    setState("loading");
    const timer = setTimeout(() => setState((s) => (s === "ready" ? s : "failed")), LIVE_TIMEOUT);
    // Read-only: of everything the bridge page may send, only "ready" is read (answered with the block).
    const receive = (event: MessageEvent) => {
      if (live.kind !== "bridge" || !isPreviewMessage(event, live.origin, frame.current?.contentWindow, live.channel, "ready")) return;
      clearTimeout(timer);
      setState("ready");
      let blocks: any[] = [];
      try {
        const row = { ...componentDefaults(components[entry.uid], components), __component: entry.uid, __temp_key__: "blockscene-magnify" };
        blocks = projectPage([row], components, window.location.origin);
      } catch {
        /* recursive defaults: the page renders nothing */
      }
      frame.current?.contentWindow?.postMessage(
        { protocol: PROTOCOL, channel: live.channel, type: "update-page", blocks, groups: null, locale: t.locale, mode: "preview" },
        live.origin,
      );
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  const onLoad = () => {
    if (live?.kind === "plain") setState("ready");
    else frame.current?.contentWindow?.postMessage({ protocol: PROTOCOL, channel: live!.channel, type: "ping" }, live!.origin);
  };
  return (
    <>
      <Scrim ref={scrim} onClick={close} data-testid="gallery-magnify-scrim" />
      <Panel ref={panel as any} aria-label={entry.label} data-testid="gallery-detail" data-live={live ? state : "none"}>
        <Flex gap={2} padding={2} alignItems="center" justifyContent="space-between">
          <Flex gap={1} role="group" aria-label={t.deviceGroup} data-testid="gallery-magnify-devices">
            {(Object.keys(DEVICES) as Device[]).map((value) => (
              <Tool key={value} icon={value} label={DEVICES[value] ? `${t.device[value]} · ${DEVICES[value]} px` : t.device[value]}
                active={device === value} onClick={() => setDevice(value)} />
            ))}
          </Flex>
          {live && state === "failed" && (
            <Typography variant="pi" textColor="neutral600" data-testid="gallery-magnify-note">
              {t.livePreviewFailed}
            </Typography>
          )}
          <div ref={closeButton}>
            <Tool icon="close" label={t.closeDetail} onClick={close} />
          </div>
        </Flex>
        <Stage ref={setStageEl} $device={device !== "fit"} data-device={device}>
          <Still $covered={Boolean(live) && state === "ready"}>
            <Thumb candidates={entry.candidates} template={entry.template} palette={palette} noPreview={t.noPreview} eager />
          </Still>
          {live && (
            <Live
              ref={frame}
              key={live.src}
              title={t.blockPreview}
              src={live.src}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              onLoad={onLoad}
              $shown={state === "ready"}
              style={frameStyle(device, stage)}
              data-testid="gallery-magnify-frame"
            />
          )}
        </Stage>
        <Strip>
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Typography variant="omega" fontWeight="bold" tag="h3" ellipsis>
              {entry.label}
            </Typography>
            <Mono>{entry.uid}</Mono>
            <Badge>{t.typologies[entry.typology] || entry.typology}</Badge>
            <Badges entry={entry} t={t} tags />
            <Flex gap={2} alignItems="center" style={{ marginLeft: "auto" }}>
              {entry.fields.length > 0 && (
                <FieldsButton type="button" aria-expanded={fields} onClick={() => setFields(!fields)} data-testid="gallery-detail-fields-toggle">
                  {`${t.showFields} (${entry.fields.length})`}
                </FieldsButton>
              )}
              <Tool icon="star" label={starred ? t.unstar : t.star} active={starred} onClick={onStar} data-testid="gallery-detail-star" />
              <Button onClick={onInsert} data-testid="gallery-insert">
                {t.insert}
              </Button>
            </Flex>
          </Flex>
          {entry.description && (
            <Clamp variant="pi" textColor="neutral700">
              {entry.description}
            </Clamp>
          )}
          {fields && (
            <Flex gap={3} wrap="wrap" data-testid="gallery-detail-fields">
              {entry.fields.map((field: any) => (
                <Typography key={field.name} variant="pi" textColor="neutral800">
                  <span>{field.name}</span> <Mono>{field.type}</Mono>
                </Typography>
              ))}
            </Flex>
          )}
        </Strip>
      </Panel>
    </>
  );
}

// The same picker, controlled by a parent (used by the page preview's insertion gaps).
export function PickerModal({
  zone,
  components,
  open,
  onOpenChange,
  onSelect,
  Modal,
  Toggle,
  get,
  put,
  contentType,
  locale,
}: any) {
  return (
    <ZoneGallery
      zone={zone}
      components={components}
      Modal={Modal}
      Toggle={Toggle}
      get={get}
      put={put}
      contentType={contentType}
      locale={locale}
      controlled={{ open, onOpenChange, onSelect }}
    />
  );
}

const NO_FILTERS = { tags: [] as string[], media: [] as string[], content: [] as string[] };
function ZoneGallery({
  zone,
  components,
  add,
  Modal,
  Toggle,
  get,
  put,
  controlled,
  contentType,
  locale,
}: any) {
  const t = useMessages();
  const grid = React.useRef<HTMLDivElement>(null);
  const cardOf = (uid: string) => grid.current?.querySelector(`[data-testid="blockscene-${CSS.escape(uid)}"]`) || null;
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = controlled ? controlled.open : ownOpen;
  const setOpen = controlled ? controlled.onOpenChange : setOwnOpen;
  const [query, setQuery] = React.useState("");
  // "all", "recent", "starred" or a typology.
  const [view, setView] = React.useState("all");
  const [picked, setPicked] = React.useState(NO_FILTERS);
  const [detail, setDetail] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(readCollapsed);
  const [prefs, setPrefs] = React.useState({ starred: [] as string[], recent: [] as string[] });
  const [showFields, setShowFields] = React.useState(readShowFields);
  const [columns, setColumns] = React.useState(readColumns);
  const [config, setConfig] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  // The native "Add a component to <zone>" button of an editable zone opens this gallery instead of Strapi's
  // category picker (capture phase, so the native handler never runs). Zones without the gallery keep the native picker.
  React.useEffect(() => {
    if (controlled) return;
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest?.("button");
      if (!button || !isNativeAddButton(button, zone)) return;
      event.preventDefault();
      event.stopPropagation();
      setOwnOpen(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [controlled, zone.name, zone.label]);
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setError("");
    setConfig(null);
    setDetail(null);
    get("/blockscene/catalog")
      .then(({ data }: any) => {
        if (active) setConfig(data);
      })
      .catch(() => {
        if (active) setError(t.failed);
      });
    // Stars and recents are a convenience: without them the gallery still works.
    get("/blockscene/me/prefs")
      .then(({ data }: any) => {
        if (active && data) setPrefs({ starred: data.starred || [], recent: data.recent || [] });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, get, t.failed]);
  const savePrefs = (next: typeof prefs) => {
    setPrefs(next);
    put?.("/blockscene/me/prefs", next).catch(() => {});
  };
  const star = (uid: string) => savePrefs({ ...prefs, starred: toggled(prefs.starred, uid) });
  const options = config ? optionsFor(zone, components, config) : null;
  const inZone = (list: string[]) => (options ? list.filter((uid) => options.uids.includes(uid)) : []);
  const filter = {
    ...picked,
    typology: TYPOLOGIES.includes(view) ? view : undefined,
    uids: view === "recent" ? prefs.recent : view === "starred" ? prefs.starred : undefined,
  };
  let entries = config ? entriesFor(zone, components, config, query, filter) : [];
  if (view === "recent") entries = [...entries].sort((a: any, b: any) => prefs.recent.indexOf(a.uid) - prefs.recent.indexOf(b.uid));
  const chosen = entries.find((entry: any) => entry.uid === detail);
  const chips = FILTER_MENUS.flatMap((menu) => picked[menu].map((value) => ({ menu, value })));
  const filtering = query.trim() !== "" || view !== "all" || chips.length > 0;
  const reset = () => {
    setQuery("");
    setView("all");
    setPicked(NO_FILTERS);
  };
  const labelOf = (menu: string, value: string) => (menu === "tags" ? value : t.facets[value] || value);
  const select = (uid: string) => {
    try {
      if (controlled ? (controlled.onSelect(uid), true) : add(zone, uid)) {
        savePrefs({ ...prefs, recent: [uid, ...prefs.recent.filter((item) => item !== uid)].slice(0, 20) });
        setOpen(false);
        setQuery("");
        setDetail(null);
      }
    } catch {
      setError(t.insertFailed);
    }
  };
  const changeColumns = (value: number) => {
    setColumns(value);
    remember(COLUMNS.key, String(value));
  };
  const changeShowFields = (value: boolean) => {
    setShowFields(value);
    remember(SHOW_FIELDS_KEY, String(value));
  };
  const toggleSidebar = () => {
    setCollapsed(!collapsed);
    remember(SIDEBAR_KEY, collapsed ? "expanded" : "collapsed");
  };
  const nav = (key: string, icon: string, label: string, count: number) => (
    <NavItem
      key={key}
      type="button"
      $active={view === key}
      $collapsed={collapsed}
      aria-current={view === key ? "true" : undefined}
      aria-label={collapsed ? `${label} (${count})` : undefined}
      title={collapsed ? `${label} (${count})` : undefined}
      onClick={() => setView(key)}
      data-testid={`gallery-nav-${key}`}
    >
      <Icon name={icon} />
      {!collapsed && (
        <>
          <span className="bs-label">{label}</span>
          <span className="bs-count">{count}</span>
        </>
      )}
    </NavItem>
  );
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t.gallery}
      trigger={
        controlled ? null : (
          <Button
            variant="secondary"
            fullWidth
            onClick={() => setOpen(true)}
            data-testid={`open-gallery-${zone.name}`}
          >
            {/* The zone is named by the heading above when there are several; its raw field name never shows. */}
            {t.add}
          </Button>
        )
      }
    >
      <Layout>
        <Side $collapsed={collapsed} aria-label={t.gallery} data-testid={`gallery-sidebar-${zone.name}`} data-collapsed={collapsed}>
          <Flex justifyContent={collapsed ? "center" : "flex-end"} paddingBottom={2}>
            <Tool
              icon="sidebar"
              label={collapsed ? t.expandSidebar : t.collapseSidebar}
              onClick={toggleSidebar}
              data-testid="gallery-sidebar-toggle"
            />
          </Flex>
          {options && (
            <>
              {nav("all", "grid", t.nav.all, options.total)}
              {nav("recent", "clock", t.nav.recent, inZone(prefs.recent).length)}
              {nav("starred", "star", t.nav.starred, inZone(prefs.starred).length)}
              {!collapsed && (
                <Box paddingTop={4} paddingBottom={1} paddingLeft={2}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t.typologiesTitle}
                  </Typography>
                </Box>
              )}
              {options.typologies.map(([name, count]: any) =>
                nav(name, TYPE_ICONS[name] || "text", t.typologies[name] || name, count),
              )}
            </>
          )}
        </Side>
        <Main>
          {/* One compact row: count · search (grows) · filter menus · fields · columns. Only the grid below scrolls. */}
          <Flex gap={3} alignItems="center" wrap="wrap">
            <Typography
              variant="omega"
              fontWeight="bold"
              textColor="neutral800"
              style={{ whiteSpace: "nowrap" }}
              data-testid={`block-count-${zone.name}`}
              aria-live="polite"
            >
              {filtering
                ? t.f("countFiltered", { shown: entries.length, total: options?.total || 0 })
                : t.f("countAll", { count: options?.total || 0 })}
            </Typography>
            <Box style={{ flex: 1, minWidth: "12rem" }}>
              <Searchbar
                name={`block-search-${zone.name}`}
                value={query}
                placeholder={t.search}
                clearLabel={t.clear}
                onClear={() => setQuery("")}
                onChange={(e: any) => setQuery(e.target.value)}
              >
                {t.search}
              </Searchbar>
            </Box>
            {options &&
              FILTER_MENUS.filter((menu) => options[menu].length > 0).map((menu) => (
                <FilterMenu
                  key={menu}
                  name={menu}
                  label={t.filters[menu]}
                  options={options[menu]}
                  picked={picked[menu]}
                  labelOf={(value: string) => labelOf(menu, value)}
                  onChange={(values: string[]) => setPicked({ ...picked, [menu]: values })}
                />
              ))}
            {Toggle && (
              <Toggle
                name={`block-fields-${zone.name}`}
                label={t.showFields}
                hint={t.showFieldsHint}
                value={showFields}
                onChange={changeShowFields}
              />
            )}
            <Flex gap={2} alignItems="center">
              <Typography variant="pi" textColor="neutral600" id={`block-columns-${zone.name}`}>
                {t.columns}
              </Typography>
              <Slider
                type="range"
                min={COLUMNS.min}
                max={COLUMNS.max}
                step={1}
                value={columns}
                aria-labelledby={`block-columns-${zone.name}`}
                $percent={((columns - COLUMNS.min) / (COLUMNS.max - COLUMNS.min)) * 100}
                onChange={(e: any) => changeColumns(Number(e.target.value))}
              />
              <Typography variant="pi" fontWeight="bold">
                {columns}
              </Typography>
            </Flex>
          </Flex>
          {chips.length > 0 && (
            <Flex gap={2} wrap="wrap" data-testid="gallery-chips">
              {chips.map(({ menu, value }) => (
                <Chip
                  key={`${menu}:${value}`}
                  type="button"
                  aria-label={t.f("removeFilter", { name: labelOf(menu, value) })}
                  onClick={() => setPicked({ ...picked, [menu]: picked[menu].filter((item) => item !== value) })}
                >
                  {labelOf(menu, value)}
                  <Icon name="close" size={12} />
                </Chip>
              ))}
              <Button variant="tertiary" size="S" onClick={() => setPicked(NO_FILTERS)} data-testid="gallery-clear-all">
                {t.clearAll}
              </Button>
            </Flex>
          )}
          <Typography variant="pi" textColor="neutral600">
            {t.example}
          </Typography>
          {error ? (
            <Typography role="alert" textColor="danger600">
              {error}
            </Typography>
          ) : !config ? (
            <Typography>{t.loading}</Typography>
          ) : entries.length ? (
            <div ref={grid} style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Flex
              direction="column"
              alignItems="stretch"
              gap={4}
              style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "4px" }}
            >
              {(view === "recent" ? [{ typology: "recent", entries }] : groupEntries(entries)).map(
                ({ typology, entries: items }: any) => (
                  <Flex key={typology} direction="column" alignItems="stretch" gap={2}>
                    <Typography variant="sigma" textColor="neutral600" data-testid={`block-group-${typology}`}>
                      {`${typology === "recent" ? t.nav.recent : t.typologies[typology] || typology} (${items.length})`}
                    </Typography>
                    <Columns $columns={columns}>
                      {items.map((entry: any) => (
                        <div key={entry.uid}>
                          <Card
                            entry={entry}
                            palette={config.palette}
                            showFields={showFields}
                            starred={prefs.starred.includes(entry.uid)}
                            active={detail === entry.uid}
                            onOpen={() => setDetail(entry.uid)}
                            onInsert={() => select(entry.uid)}
                            onStar={() => star(entry.uid)}
                          />
                        </div>
                      ))}
                    </Columns>
                  </Flex>
                ),
              )}
            </Flex>
            {chosen && (
              <Magnify
                key={chosen.uid}
                entry={chosen}
                palette={config.palette}
                config={config}
                components={components}
                get={get}
                contentType={contentType}
                locale={locale}
                cardOf={cardOf}
                starred={prefs.starred.includes(chosen.uid)}
                onStar={() => star(chosen.uid)}
                onInsert={() => select(chosen.uid)}
                onClose={() => setDetail(null)}
              />
            )}
            </div>
          ) : (
            <Flex gap={3} alignItems="center">
              <Typography>{t.empty}</Typography>
              {filtering && (
                <Button variant="tertiary" size="S" onClick={reset}>
                  {t.clear}
                </Button>
              )}
            </Flex>
          )}
        </Main>
      </Layout>
    </Modal>
  );
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const memoryBase = () =>
  `${window.location.origin}${window.location.pathname.split("/content-manager")[0]}`;

// Applies the initial accordion state once per document/locale, after the native
// list has rendered every block. Later renders, edits and inserts are untouched.
function useInitialAccordions({
  zones,
  editor,
  docKey,
  contentType,
  userId,
}: any) {
  const applied = React.useRef<string>("");
  // Refs: zones is a fresh array every render and the user id loads late on
  // Strapi 5; neither may restart (and cancel) the pending application.
  const user = React.useRef(userId);
  user.current = userId;
  const latest = React.useRef(zones);
  latest.current = zones;
  React.useEffect(() => {
    if (!editor?.enabled || !docKey || applied.current === docKey) return;
    // Saving a new entry changes its key; that is the same document, not a new visit.
    if (
      applied.current.startsWith(`${contentType}:new`) &&
      docKey.startsWith(`${contentType}:`)
    ) {
      applied.current = docKey;
      return;
    }
    applied.current = docKey;
    let tries = 0;
    // An explicit click on a header or a collective button before the initial
    // application wins: the pending application is dropped, never undoing the user.
    const cancel = (event: Event) => {
      if (
        (event.target as Element)?.closest?.(
          'button[aria-expanded], [data-testid^="block-accordion-controls-"]',
        )
      )
        stop();
    };
    const stop = () => {
      clearInterval(timer);
      document.removeEventListener("click", cancel, true);
    };
    document.addEventListener("click", cancel, true);
    const timer = setInterval(() => {
      const pending = latest.current.filter((zone: any) => zone.count > 0);
      // In remember mode the user id may load after the blocks (Strapi 5 auth store).
      const ready =
        pending.length > 0 &&
        pending.every((zone: any) => {
          const list = findZoneList(zone.label);
          return list && toggles(list).length >= zone.count;
        }) &&
        (editor.initialState !== "remember" || user.current);
      if (!ready && ++tries < 25) return;
      stop();
      for (const zone of pending) {
        const list = findZoneList(zone.label);
        if (!list) continue;
        const key = memoryKey({
          base: memoryBase(),
          userId: user.current,
          contentType,
          zone: zone.name,
        });
        setAll(
          list,
          initialState(editor, readMemory(storage(), key)) === "open",
          unstable_batchedUpdates,
        );
      }
    }, 200);
    return stop;
  }, [docKey, editor?.enabled, editor?.initialState, contentType]);
}

// Open all / Close all sit right after the native zone label pill ("blocks (2)"): one inert <span> is inserted
// in the label row and the buttons are portalled into it, re-inserted when Strapi re-renders (as RowPreviews does).
// ponytail: DOM injection; drop it if Strapi ever exposes a zone label slot.
const ZONE_ATTR = "data-blockscene-zone-controls";
function useLabelAnchor(zone: any, enabled: boolean) {
  const [el, setEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const sync = () => {
      const list = findZoneList(zone.label);
      // The label row is the first child of the zone box with text (DS1 and DS2 render it before the list).
      const row = list && ([...(list.parentElement?.children || [])] as HTMLElement[]).find((child) => child !== list && child.textContent?.trim());
      let anchor = document.querySelector<HTMLElement>(`[${ZONE_ATTR}="${CSS.escape(zone.name)}"]`);
      if (anchor && anchor.parentElement !== row) { anchor.remove(); anchor = null; }
      if (!anchor && row) {
        anchor = document.createElement("span");
        anchor.setAttribute(ZONE_ATTR, zone.name);
        anchor.style.cssText = "display:inline-flex;align-items:center;margin-left:8px";
        row.appendChild(anchor);
      }
      setEl(anchor);
    };
    sync();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; sync(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.querySelector(`[${ZONE_ATTR}="${CSS.escape(zone.name)}"]`)?.remove();
      setEl(null);
    };
  }, [zone.name, zone.label, enabled]);
  return el;
}
function ZoneControls({ zone, editor, contentType, userId, tools }: any) {
  const t = useMessages();
  const shown = Boolean(zone.count && (editor.showOpenAll || editor.showCloseAll || tools));
  const anchor = useLabelAnchor(zone, shown);
  if (!shown || !anchor) return null;
  const apply = (open: boolean) => {
    const list = findZoneList(zone.label);
    if (list) setAll(list, open, unstable_batchedUpdates);
    writeMemory(
      storage(),
      memoryKey({ base: memoryBase(), userId, contentType, zone: zone.name }),
      open ? "open" : "closed",
    );
  };
  return createPortal(
    <Flex gap={1} data-testid={`block-accordion-controls-${zone.name}`}>
      {editor.showOpenAll && <Tool icon="expand" label={t.openAll} onClick={() => apply(true)} />}
      {editor.showCloseAll && <Tool icon="collapse" label={t.closeAll} onClick={() => apply(false)} />}
      {tools}
    </Flex>,
    anchor,
  );
}

export function Gallery({
  zones,
  editor,
  docKey,
  contentType,
  userId,
  catalog,
  ...props
}: any) {
  useInitialAccordions({ zones, editor, docKey, contentType, userId });
  // Row actions need a form adapter (props.form, from the version adapter); without one the rows stay native.
  const actions = useRowActions({ zones, components: props.components, catalog, form: props.form });
  // A pending open all / close all belongs to the document it was started on.
  React.useEffect(() => stopAll, [docKey]);
  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {editor.showRowThumbnails !== false && (
        <RowPreviews
          zones={zones}
          components={props.components}
          catalog={catalog}
          Modal={props.Modal}
        />
      )}
      <RowActions zones={zones} actions={actions} Modal={props.Modal} />
      {zones.map((zone: any) => (
        <Flex key={zone.name} direction="column" alignItems="stretch" gap={2}>
          {/* Several zones: name each gallery trigger's zone. */}
          {zones.length > 1 && !zone.full && (
            <Typography variant="sigma" textColor="neutral600" tag="h3">{zone.label}</Typography>
          )}
          {/* docKey ends with the content locale (both versions): the {locale} of blockPreviewUrl. */}
          {!zone.full && <ZoneGallery zone={zone} contentType={contentType} locale={String(docKey || "").split(":").pop()} {...props} />}
          {/* An empty zone has no label row to hold the tools: its Paste sits under the gallery button. */}
          {zone.count === 0 && actions?.clip && <Flex><ZoneRowTools zone={zone} actions={actions} /></Flex>}
          <ZoneControls
            zone={zone}
            editor={editor}
            contentType={contentType}
            userId={userId}
            tools={actions && actions.editor.clipboard !== false && <ZoneRowTools zone={zone} actions={actions} />}
          />
        </Flex>
      ))}
    </Flex>
  );
}
