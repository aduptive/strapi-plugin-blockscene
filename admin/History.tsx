import * as React from "react";
import { Box, Button, Flex, Typography } from "@strapi/design-system";
import { useForm, useQueryParams, useRBAC } from "@strapi/strapi/admin";
import { useMessages } from "./messages";
import { formDiff, loadVersion } from "./versions.mjs";

// History section of the Blockscene side panel (Strapi 5): the versions of this document and locale, a block diff of
// one against the form, and "Load this version" through `setValues` (what undo uses): nothing is written until the
// editor saves, so validation, permissions and lifecycles apply as for any edit. Needs `plugin::blockscene.history.read`.
export const HISTORY_READ = [{ action: "plugin::blockscene.history.read", subject: null }];
const PAGE = 10;

export function History({ model, documentId, schema, components, editable, disabled, get, relationsOf }: any) {
  const t = useMessages();
  const { allowedActions, isLoading }: any = useRBAC(HISTORY_READ);
  // The edit view's locale is in the URL (the form values do not carry it); none: the server uses the default locale.
  const [{ query }]: any = useQueryParams();
  const locale = typeof query?.plugins?.i18n?.locale === "string" ? query.plugins.i18n.locale : "";
  const values = useForm("BlocksceneVersions", (state: any) => state.values);
  const initialValues = useForm("BlocksceneVersions", (state: any) => state.initialValues);
  const setValues = useForm("BlocksceneVersions", (state: any) => state.setValues);
  const [events, setEvents] = React.useState<any[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [shown, setShown] = React.useState(PAGE);
  const [open, setOpen] = React.useState<any>(null);
  const [report, setReport] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [refresh, reload] = React.useReducer((n: number) => n + 1, 0);
  const allowed = Boolean(allowedActions?.canRead);
  // A save re-initialises the form: the list is read again (the save made a new version).
  React.useEffect(() => {
    if (!allowed || !documentId) return;
    let active = true;
    setFailed(false);
    get(`/blockscene/history/${encodeURIComponent(model)}/${encodeURIComponent(documentId)}${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`)
      .then(({ data }: any) => active && setEvents(Array.isArray(data?.results) ? data.results : []))
      .catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [allowed, get, model, documentId, locale, initialValues, refresh]);
  // Another document or locale: nothing of the previous one stays open.
  React.useEffect(() => { setOpen(null); setReport(null); setShown(PAGE); }, [model, documentId, locale]);
  if (isLoading || !allowed || !documentId) return null;
  const name = (uid: string) => components?.[uid]?.info?.displayName || uid;
  const when = (at: string) => { try { return new Date(at).toLocaleString(t.locale, { dateStyle: "medium", timeStyle: "short" }); } catch { return at; } };
  const summary = (s: any) => {
    if (!s) return "";
    if (s.missing) return t.historyMissing;
    if (s.initial) return t.historyInitial;
    const parts = [];
    const b = s.blocks || {};
    if (b.added || b.removed || b.changed) parts.push(t.f("historyBlocksSummary", { added: b.added || 0, removed: b.removed || 0, changed: b.changed || 0 }));
    if (s.fields?.length) parts.push(t.f("historyFieldsSummary", { fields: s.fields.join(", ") }));
    return parts.join(" · ") || t.historyNoChange;
  };
  const select = async (event: any) => {
    setReport(null);
    if (open?.event?.id === event.id) return setOpen(null);
    setOpen({ event, loading: true });
    try { const { data }: any = await get(`/blockscene/history-events/${event.id}`); setOpen({ event, ...data }); }
    catch { setOpen({ event, failed: true }); }
  };
  const load = async () => {
    if (!open?.snapshot || typeof setValues !== "function" || disabled) return;
    setLoading(true);
    setReport(null);
    try {
      // The relations the document has on the server now, per top-level relation field (a failed read leaves the field as it is).
      const server: Record<string, any[]> = {};
      for (const [field, attr] of Object.entries<any>(schema?.attributes || {}))
        if (attr?.type === "relation" && editable(field)) server[field] = await relationsOf(get, { uid: model, id: documentId, field }, locale).catch(() => undefined);
      const { values: next, report } = loadVersion(open.snapshot, { schema, components, current: values, media: open.media, relations: open.relations, server, editable });
      setValues(next);
      setReport(report);
    } catch { setReport({ failed: true }); }
    finally { setLoading(false); }
  };
  const diff = open?.snapshot ? formDiff(open.snapshot, values, schema, components) : null;
  const same = diff && !diff.fields.length && !diff.zones.length;
  return (
    <Flex direction="column" alignItems="stretch" gap={2} data-testid="blockscene-versions">
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="sigma" tag="h3" textColor="neutral600">{t.historyTitle}</Typography>
        <Button variant="tertiary" size="S" onClick={reload}>{t.historyRefresh}</Button>
      </Flex>
      {failed ? <Typography variant="pi" role="alert" textColor="danger600">{t.historyFailed}</Typography>
        : !events ? <Typography variant="pi" textColor="neutral600">{t.historyLoading}</Typography>
        : !events.length ? <Typography variant="pi" textColor="neutral600">{t.historyEmpty}</Typography>
        : <Flex tag="ol" direction="column" alignItems="stretch" gap={1} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {events.slice(0, shown).map((event: any) => {
            const active = open?.event?.id === event.id;
            return <li key={event.id} data-testid={`history-event-${event.id}`}>
              <Box tag="button" type="button" onClick={() => select(event)} aria-expanded={active} padding={2} hasRadius width="100%"
                background={active ? "primary100" : "neutral0"} borderColor={active ? "primary200" : "neutral150"} style={{ textAlign: "left", cursor: "pointer", borderStyle: "solid", borderWidth: 1 }}>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Typography variant="omega" fontWeight="bold">{(t.historyActions as any)[event.action] || event.action}</Typography>
                  <Typography variant="pi" textColor="neutral600">{event.actorName || (event.actor === "system" ? t.historySystem : event.actor)} · {when(event.at)}</Typography>
                  <Typography variant="pi" textColor={event.summary?.missing ? "warning700" : "neutral700"}>{summary(event.summary)}</Typography>
                </Flex>
              </Box>
              {active && <Box padding={3} background="neutral100" hasRadius marginTop={1}>
                {open.loading ? <Typography variant="pi">{t.historyLoading}</Typography>
                  : open.failed ? <Typography variant="pi" role="alert" textColor="danger600">{t.historyLoadFailed}</Typography>
                  : !open.snapshot ? <Typography variant="pi" textColor="neutral600">{t.historyNotKept}</Typography>
                  : <Flex direction="column" alignItems="stretch" gap={2}>
                    <Typography variant="pi" fontWeight="bold">{t.historyCompare}</Typography>
                    {same ? <Typography variant="pi" textColor="neutral600">{t.historySame}</Typography> : <>
                      {diff.fields.length > 0 && <Typography variant="pi">{t.f("historyDiffFields", { fields: diff.fields.join(", ") })}</Typography>}
                      {diff.zones.map((zone: any) => <Flex key={zone.name} tag="ul" direction="column" alignItems="stretch" gap={1} style={{ margin: 0, paddingLeft: 16 }} data-testid={`history-diff-${zone.name}`}>
                        {zone.ops.map((op: any, i: number) => <li key={i}><Typography variant="pi" textColor={op.op === "added" ? "success700" : op.op === "removed" ? "danger700" : "warning700"}>
                          {(t.diffOps as any)[op.op]}: {name(op.uid)}{op.to !== undefined ? ` (#${op.to + 1})` : op.from !== undefined ? ` (#${op.from + 1})` : ""}</Typography></li>)}
                      </Flex>)}
                    </>}
                    <Typography variant="pi" textColor="neutral600">{t.historyDiffNote}</Typography>
                    <Flex><Button size="S" onClick={load} loading={loading} disabled={disabled || loading} data-testid="history-load">{t.historyLoad}</Button></Flex>
                    {report && <Box role="status" padding={2} background={report.failed ? "danger100" : "success100"} hasRadius>
                      {report.failed ? <Typography variant="pi" textColor="danger700">{t.historyLoadFailed}</Typography> : <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Typography variant="pi" textColor="success700">{t.historyLoaded}</Typography>
                        {report.left.length > 0 && <Typography variant="pi" textColor="warning700" data-testid="history-left">{t.f("historyLeft", { fields: report.left.join(", ") })}</Typography>}
                        {report.removed.length > 0 && <Typography variant="pi" textColor="warning700">{t.f("historyRemovedFields", { fields: report.removed.join(", ") })}</Typography>}
                        {(report.media || report.relations || report.blocks) > 0 && <Typography variant="pi" textColor="warning700">{t.f("historyMissingItems", { media: report.media, relations: report.relations, blocks: report.blocks })}</Typography>}
                      </Flex>}
                    </Box>}
                  </Flex>}
              </Box>}
            </li>;
          })}
          {events.length > shown && <Flex><Button variant="tertiary" size="S" onClick={() => setShown(shown + PAGE)}>{t.historyShowMore}</Button></Flex>}
        </Flex>}
    </Flex>
  );
}
