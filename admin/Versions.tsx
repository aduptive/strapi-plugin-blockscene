import * as React from "react";
import styled from "styled-components";
import { Box, Button, Flex, SingleSelect, SingleSelectOption, Typography } from "@strapi/design-system";
import { useQueryParams, useRBAC } from "@strapi/strapi/admin";
import { HISTORY_READ } from "./History";
import { Icon } from "./icons";
import { useMessages } from "./messages";
import { loadVersion } from "./versions.mjs";
import type { PreviewHost } from "./PagePreview";

const Drawer = styled.aside`
  width: min(36rem, 55%); flex: 0 0 auto; overflow: auto;
  border-left: 1px solid ${({ theme }) => theme.colors.neutral200};
  background: ${({ theme }) => theme.colors.neutral0};
`;
const Entry = styled.button`
  display: block; width: 100%; text-align: left; padding: 12px; margin: 4px 0;
  border: 1px solid ${({ theme }) => theme.colors.neutral200}; border-radius: 4px;
  background: ${({ theme }) => theme.colors.neutral0}; color: ${({ theme }) => theme.colors.neutral800}; cursor: pointer;
  &[aria-pressed="true"] { background: ${({ theme }) => theme.colors.primary100}; border-color: ${({ theme }) => theme.colors.primary600}; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 2px; }
  &:disabled { cursor: default; opacity: .65; }
  overflow-wrap: anywhere;
`;
const PAGE_SIZE = 25;

// Snapshot state is separate from the form store. Scope + request serials protect rapid clicks, navigation and RBAC changes.
export function useVersions(host: PreviewHost, config: any) {
  const t = useMessages();
  const [{ query }]: any = useQueryParams();
  const locale = typeof query?.plugins?.i18n?.locale === "string" ? query.plugins.i18n.locale : host.locale || "";
  const rbac: any = useRBAC(HISTORY_READ);
  const allowed = !rbac.isLoading && Boolean(rbac.allowedActions?.canRead);
  const enabled = Boolean(config?.contentTypes?.includes(host.model));
  const scope = `${host.model}:${host.documentId || ""}:${locale}:${allowed}:${enabled}`;
  const currentScope = React.useRef(scope);
  currentScope.current = scope;
  const requests = React.useRef(0);
  const [open, setOpen] = React.useState(false);
  const [actor, setActor] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [list, setList] = React.useState<any>(null);
  const [people, setPeople] = React.useState<any>(null);
  const [selection, setSelection] = React.useState<any>(null);
  const [failed, setFailed] = React.useState(false);
  const [refresh, retry] = React.useReducer(n => n + 1, 0);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId(), drawerId = React.useId();
  const available = allowed && enabled && Boolean(host.documentId) && !host.creating;
  const reason = rbac.isLoading ? t.historyLoading : !allowed ? t.versionsDenied : !enabled ? t.versionsDisabled : !host.documentId || host.creating ? t.versionsNew : "";
  const view = selection?.scope === scope ? selection : null;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const back = () => { requests.current++; setSelection(null); setFailed(false); trigger.current?.focus(); };
  React.useEffect(() => {
    requests.current++;
    setSelection(null); setList(null); setPeople(null); setActor(""); setPage(1); setFailed(false);
    return () => { requests.current++; };
  }, [scope]);
  React.useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);
  React.useEffect(() => {
    if (!open || !available) return;
    let active = true;
    setList(null); setFailed(false);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...(locale && { locale }), ...(actor && { actor }) });
    host.get(`/blockscene/history/${encodeURIComponent(host.model)}/${encodeURIComponent(String(host.documentId))}?${params}`)
      .then(({ data }: any) => { if (active && currentScope.current === scope) { setList({ ...data, scope }); setPeople({ scope, actors: data.actors || [] }); } })
      .catch(() => { if (active && currentScope.current === scope) setFailed(true); });
    return () => { active = false; };
  }, [scope, open, page, actor, refresh, host.get, host.history?.epoch]);
  const select = async (event: any) => {
    if (!available || !event.stored) return;
    const request = ++requests.current;
    setSelection({ scope, event, pending: true, values: view?.values }); setFailed(false);
    try {
      const { data } = await host.get(`/blockscene/history-events/${event.id}`);
      if (requests.current !== request || currentScope.current !== scope) return;
      // Never display a response belonging to another document/locale, even if a consumer/proxy mixes requests.
      const localized = host.contentType?.pluginOptions?.i18n?.localized;
      if (!data?.snapshot || data.event?.contentType !== host.model || data.event?.relatedDocumentId !== String(host.documentId) ||
        (localized && (data.event?.locale || "") !== (locale || list?.locale || ""))) throw new Error("Unavailable version");
      const loaded = loadVersion(data.snapshot, { schema: host.contentType, components: host.components,
        media: data.media, relations: data.relations, editable: host.readable });
      // Keys cannot collide with live form rows (or a different snapshot), including queued messages from old bridges.
      for (const [name, attr] of Object.entries(host.contentType?.attributes || {}) as any)
        if (attr.type === "dynamiczone") loaded.values[name]?.forEach((row: any, i: number) => { row.__temp_key__ = `version:${event.id}:${i}`; });
      setSelection({ scope, event, values: loaded.values, report: loaded.report, pending: false });
    } catch {
      if (requests.current === request && currentScope.current === scope) { setFailed(true); setSelection(null); }
    }
  };
  const when = (at: string, day = false) => new Date(at).toLocaleString(t.locale, { dateStyle: "medium", ...(!day && { timeStyle: "short" as const }) });
  const events = list?.scope === scope ? list.results || [] : [];
  let previousDay = "";
  const drawer = open && (
    <Drawer id={drawerId} role="region" aria-labelledby={titleId} data-testid="versions-drawer"
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <Box padding={4}>
        <Flex gap={2} justifyContent="space-between">
          <Typography id={titleId} tag="h2" variant="delta">{t.historyTitle}</Typography>
          <Button ref={closeButton} size="S" variant="tertiary" aria-label={t.close} onClick={close}><Icon name="close" /></Button>
        </Flex>
        {reason ? <Typography tag="p" textColor="neutral600">{reason}</Typography> : <>
          <Box paddingTop={3} paddingBottom={3}>
            <SingleSelect aria-label={t.versionsPerson} value={actor} onChange={(value: string) => { setActor(value); setPage(1); }}>
              <SingleSelectOption value="">{t.versionsEveryone}</SingleSelectOption>
              {(people?.scope === scope ? people.actors : []).map((person: any) => <SingleSelectOption key={person.actor} value={person.actor}>{person.actorName || person.actor}</SingleSelectOption>)}
            </SingleSelect>
          </Box>
          {!list && !failed && <Typography role="status">{t.historyLoading}</Typography>}
          {list && !events.length && <Typography>{t.historyEmpty}</Typography>}
          {events.map((event: any) => {
            const day = when(event.at, true), heading = day !== previousDay;
            previousDay = day;
            const blocks = event.summary?.blocks;
            const actions = (Array.isArray(event.actions) && event.actions.length ? event.actions : [event.action])
              .map((action: string) => t.historyActions[action] || action).join(" · ");
            const counted = ["total", "added", "removed", "changed"].every(key => Number.isInteger(blocks?.[key]));
            return <React.Fragment key={event.id}>
              {heading && <Typography tag="h3" variant="omega" fontWeight="bold" style={{ marginTop: 12 }}>{day}</Typography>}
              <Entry aria-pressed={view?.event.id === event.id} disabled={!event.stored} title={!event.stored ? t.historyExpired : undefined}
                data-testid={`version-${event.id}`} onClick={() => select(event)}>
                <Typography tag="span" fontWeight="bold">{event.actorName || event.actor}</Typography>
                <Typography tag="p" variant="pi">{when(event.at)} · {actions}</Typography>
                {counted ? <>
                  <Typography tag="p" variant="pi" textColor="neutral600">{t.f("versionsCounts", blocks)}</Typography>
                  <Flex gap={2} wrap="wrap">
                    <Typography variant="pi" textColor="success700">+{blocks.added} {t.diffOps.added}</Typography>
                    <Typography variant="pi" textColor="danger700">−{blocks.removed} {t.diffOps.removed}</Typography>
                    <Typography variant="pi" textColor="warning700">~{blocks.changed} {t.diffOps.changed}</Typography>
                  </Flex>
                </> : <Typography tag="p" variant="pi" textColor="neutral600">{t.versionsCountsMissing}</Typography>}
                {!event.stored && <Typography tag="p" variant="pi">{t.historyExpired}</Typography>}
              </Entry>
            </React.Fragment>;
          })}
          {list && <Flex gap={2} paddingTop={3} justifyContent="space-between">
            <Button size="S" variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.versionsPrevious}</Button>
            <Typography variant="pi">{t.f("versionsPage", { page, count: Math.max(1, list.pagination?.pageCount || 0) })}</Typography>
            <Button size="S" variant="tertiary" disabled={page >= (list.pagination?.pageCount || 0)} onClick={() => setPage(page + 1)}>{t.versionsNext}</Button>
          </Flex>}
        </>}
        {failed && <Box paddingTop={3}><Typography role="alert" textColor="danger600">{t.historyFailed}</Typography><Button size="S" variant="tertiary" onClick={retry}>{t.retry}</Button></Box>}
      </Box>
    </Drawer>
  );
  return {
    view, drawer,
    button: <Button ref={trigger} size="S" variant="tertiary" startIcon={<Icon name="clock" />} data-testid="versions-toggle"
      aria-expanded={open} aria-controls={open ? drawerId : undefined} title={reason || t.historyTitle} onClick={() => setOpen(!open)}>{t.historyTitle}</Button>,
    banner: view && <Flex padding={3} gap={3} wrap="wrap" background="primary100" data-testid="versions-banner">
      <Typography role="status">{view.pending ? t.historyLoading : t.f("versionsViewing", { date: when(view.event.at), person: view.event.actorName || view.event.actor })}</Typography>
      <Button size="S" variant="secondary" onClick={back}>{t.versionsCurrent}</Button>
      {!view.pending && (view.report?.blocks || view.report?.media || view.report?.relations || view.report?.removed.length) > 0 && <Typography variant="pi">{t.versionsMissing}</Typography>}
    </Flex>,
  };
}
