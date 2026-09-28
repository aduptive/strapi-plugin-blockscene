import * as React from "react";
import {
  Box, Button, Dialog, Field, Flex, Link, Modal, SingleSelect, SingleSelectOption, Switch, Table, Tabs, Tbody, Td, TextInput, Th, Thead, Tr, Typography,
} from "@strapi/design-system";
import { Layouts, Page, useFetchClient, useNotification, useRBAC } from "@strapi/strapi/admin";
import { useMessages } from "./messages";
import { Icon } from "./icons";
import { summaryText } from "./History";

// Content activity and trash (Strapi 5, version history module): one plugin page in the main menu, a tab each. Operational
// tools for editors (who changed what, bring a deleted page back), not configuration, so not under Settings. The server
// limits every list to the content types the user may read in the Content Manager; restore needs create, delete forever
// needs delete there too.
const ACTIVITY = [{ action: "plugin::blockscene.activity.read", subject: null }];
// useRBAC names each action by its last segment: trash.read, trash.restore, trash.purge -> canRead, canRestore, canPurge.
const TRASH = ["read", "restore", "purge"].map((name) => ({ action: `plugin::blockscene.trash.${name}`, subject: null }));
const ACTIONS = ["create", "update", "publish", "unpublish", "discard", "delete", "restore", "purge"];
const DAY = 24 * 60 * 60 * 1000;

export const contentMenuLink = (Component: React.ComponentType) => ({
  to: "plugins/blockscene",
  icon: () => <Icon name="clock" size={20} />,
  intlLabel: { id: "blockscene.contentMenu", defaultMessage: "Activity and trash" },
  permissions: [...ACTIVITY, TRASH[0]],
  // Not an `async` function: Strapi 5 warns on AsyncFunction loaders.
  Component: () => Promise.resolve({ default: Component }),
});

const when = (t: any, at: string) => { try { return new Date(at).toLocaleString(t.locale, { dateStyle: "medium", timeStyle: "short" }); } catch { return at; } };
// The Content Manager edit view of a document (a full page load: the plugin does not depend on the admin's router).
const editUrl = (type: any, documentId: string, locale: string | null) => {
  const base = window.location.pathname.split("/plugins/blockscene")[0];
  const kind = type?.kind === "singleType" ? "single-types" : "collection-types";
  return `${base}/content-manager/${kind}/${type.uid}${kind === "single-types" ? "" : `/${encodeURIComponent(documentId)}`}${locale ? `?plugins[i18n][locale]=${encodeURIComponent(locale)}` : ""}`;
};
const query = (params: Record<string, any>) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, String(v)])).toString();

const Select = ({ label, value, onChange, options, name }: any) => (
  <Box style={{ minWidth: 180 }}>
    <Field.Root name={name}><Field.Label>{label}</Field.Label>
      <SingleSelect value={value} onChange={(v: any) => onChange(String(v))}>
        {options.map((o: any) => <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>)}
      </SingleSelect>
    </Field.Root>
  </Box>
);
const Input = ({ label, value, onChange, name, type = "text" }: any) => (
  <Box style={{ minWidth: 160 }}>
    <Field.Root name={name}><Field.Label>{label}</Field.Label><TextInput name={name} type={type} value={value} onChange={(e: any) => onChange(e.target.value)} /></Field.Root>
  </Box>
);
function Pager({ t, pagination, setPage }: any) {
  if (!pagination?.total) return null;
  const { page, pageCount, total } = pagination;
  return <Flex justifyContent="space-between" alignItems="center" paddingTop={4}>
    <Typography variant="pi" textColor="neutral600">{t.f("contentPage", { page, pages: Math.max(pageCount, 1), total })}</Typography>
    <Flex gap={2}>
      <Button variant="tertiary" size="S" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.contentPrevious}</Button>
      <Button variant="tertiary" size="S" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>{t.contentNext}</Button>
    </Flex>
  </Flex>;
}
// A list endpoint read on every change of its query; `data` is null while loading, `failed` on error.
function useList(get: any, path: string, params: Record<string, any>, refresh = 0) {
  const [state, setState] = React.useState<any>({ data: null, failed: false });
  const key = `${path}?${query(params)}`;
  React.useEffect(() => {
    let active = true;
    setState((s: any) => ({ data: s.data, failed: false, loading: true }));
    get(`/blockscene${key}`).then(({ data }: any) => active && setState({ data, failed: false })).catch(() => active && setState({ data: null, failed: true }));
    return () => { active = false; };
  }, [get, key, refresh]);
  return state;
}
const Doc = ({ t, type, row, documentId, locale }: any) => {
  const title = row.title || t.contentUntitled;
  return <Flex direction="column" alignItems="flex-start" gap={1}>
    {row.exists && type ? <Link href={editUrl(type, documentId, locale)}>{title}</Link> : <Typography fontWeight="bold">{title}</Typography>}
    <Typography variant="pi" textColor="neutral600">{type?.displayName || row.contentType}{locale ? ` · ${locale}` : ""}{row.exists === false ? ` · ${t.contentGone}` : ""}</Typography>
  </Flex>;
};

function ActivityTab({ t, get }: any) {
  const [filters, setFilters] = React.useState({ actor: "", contentType: "", action: "", from: "", to: "", q: "" });
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const set = (key: string, value: string) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  // Dates are whole local days.
  const day = (value: string, end: boolean) => { if (!value) return ""; const d = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`); return Number.isFinite(d.getTime()) ? d.toISOString() : ""; };
  const { data, failed } = useList(get, "/activity", { ...filters, from: day(filters.from, false), to: day(filters.to, true), page, pageSize: 25 });
  const types = new Map<string, any>((data?.types || []).map((type: any) => [type.uid, type]));
  return <Flex direction="column" alignItems="stretch" gap={4}>
    {data && !data.enabled && <Box padding={3} background="warning100" hasRadius><Typography variant="pi" textColor="warning700">{t.contentOff}</Typography></Box>}
    <Flex tag="form" gap={3} wrap="wrap" alignItems="flex-end" onSubmit={(e: any) => { e.preventDefault(); set("q", search.trim()); }}>
      <Select name="actor" label={t.activityPerson} value={filters.actor} onChange={(v: string) => set("actor", v)}
        options={[{ value: "", label: t.activityAnyone }, ...(data?.actors || []).map((a: any) => ({ value: a.actor, label: a.actorName || (a.actor === "system" ? t.historySystem : a.actor) }))]} />
      <Select name="contentType" label={t.activityType} value={filters.contentType} onChange={(v: string) => set("contentType", v)}
        options={[{ value: "", label: t.activityAnyType }, ...(data?.types || []).map((type: any) => ({ value: type.uid, label: type.displayName }))]} />
      <Select name="action" label={t.activityAction} value={filters.action} onChange={(v: string) => set("action", v)}
        options={[{ value: "", label: t.activityAnyAction }, ...ACTIONS.map((a) => ({ value: a, label: (t.historyActions as any)[a] || a }))]} />
      <Input name="from" type="date" label={t.activityFrom} value={filters.from} onChange={(v: string) => set("from", v)} />
      <Input name="to" type="date" label={t.activityTo} value={filters.to} onChange={(v: string) => set("to", v)} />
      <Input name="q" label={t.activitySearch} value={search} onChange={setSearch} />
      <Button type="submit" variant="secondary">{t.activitySearchButton}</Button>
      <Button type="button" variant="tertiary" onClick={() => { setSearch(""); setFilters({ actor: "", contentType: "", action: "", from: "", to: "", q: "" }); setPage(1); }}>{t.contentClear}</Button>
    </Flex>
    {failed ? <Typography role="alert" textColor="danger600">{t.activityFailed}</Typography>
      : !data ? <Typography textColor="neutral600">{t.contentLoading}</Typography>
      : !data.results.length ? <Typography textColor="neutral600">{t.activityEmpty}</Typography>
      : <Box>
        <Table colCount={4} rowCount={data.results.length + 1} data-testid="blockscene-activity">
          <Thead><Tr><Th><Typography variant="sigma">{t.activityWhen}</Typography></Th><Th><Typography variant="sigma">{t.activityDocument}</Typography></Th>
            <Th><Typography variant="sigma">{t.activityWho}</Typography></Th><Th><Typography variant="sigma">{t.activityWhat}</Typography></Th></Tr></Thead>
          <Tbody>{data.results.map((event: any) => <Tr key={event.id} data-testid={`activity-${event.id}`}>
            <Td><Typography variant="pi">{when(t, event.at)}</Typography></Td>
            <Td><Doc t={t} type={types.get(event.contentType)} row={event} documentId={event.relatedDocumentId} locale={event.locale} /></Td>
            <Td><Typography variant="pi">{event.actorName || (event.actor === "system" ? t.historySystem : event.actor)}</Typography></Td>
            <Td><Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography variant="omega" fontWeight="bold">{(t.historyActions as any)[event.action] || event.action}</Typography>
              <Typography variant="pi" textColor={event.summary?.missing ? "warning700" : "neutral700"}>
                {["delete", "purge"].includes(event.action) ? "" : [event.summary?.restoredFrom ? t.activityRestoredFrom : "", summaryText(t, event.summary)].filter(Boolean).join(" · ")}</Typography>
            </Flex></Td>
          </Tr>)}</Tbody>
        </Table>
        <Pager t={t} pagination={data.pagination} setPage={setPage} />
      </Box>}
  </Flex>;
}

// The pre-check report (and a 409's): blocking problems, then the differences a restore accepts.
function Report({ t, report }: any) {
  const locale = (value: any) => value ?? t.contentNone;
  const line = (item: any) => item.code === "incoming" ? t.f("report.incoming", item)
    : t.f(`report.${item.code}` as any, { ...item, locale: locale(item.locale), locales: (item.locales || []).map(locale).join(", "), fields: (item.fields || []).join(", ") });
  const incoming = report.incoming && (report.incoming.reconnect || report.incoming.gone || report.incoming.replaced || report.incoming.published) ? [{ code: "incoming", ...report.incoming }] : [];
  const warnings = [...(report.warnings || []), ...incoming];
  return <Flex direction="column" alignItems="stretch" gap={2} data-testid="restore-report">
    {report.blocking?.length > 0 && <Box padding={3} background="danger100" hasRadius><Typography variant="pi" fontWeight="bold" textColor="danger700">{t.restoreBlocked}</Typography>
      <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{report.blocking.map((item: any, i: number) => <li key={i}><Typography variant="pi" textColor="danger700">{line(item)}</Typography></li>)}</ul></Box>}
    {warnings.length > 0 && <Box padding={3} background="warning100" hasRadius><Typography variant="pi" fontWeight="bold" textColor="warning700">{t.restoreWarnings}</Typography>
      <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>{warnings.map((item: any, i: number) => <li key={i}><Typography variant="pi" textColor="warning700">{line(item)}</Typography></li>)}</ul></Box>}
  </Flex>;
}

function Preview({ t, id, get, onClose }: any) {
  const [row, setRow] = React.useState<any>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { get(`/blockscene/trash/${id}`).then(({ data }: any) => setRow(data)).catch(() => setFailed(true)); }, [get, id]);
  return <Modal.Root open onOpenChange={(open: boolean) => !open && onClose()}>
    <Modal.Content style={{ width: "min(900px, 92vw)" }}>
      <Modal.Header><Modal.Title>{row?.title || t.trashPreview}</Modal.Title></Modal.Header>
      <Modal.Body>
        {failed ? <Typography role="alert" textColor="danger600">{t.trashFailed}</Typography> : !row ? <Typography>{t.contentLoading}</Typography>
          : <Flex direction="column" alignItems="stretch" gap={5} data-testid="trash-preview">
            {row.incoming > 0 && <Typography variant="pi" textColor="neutral600">{t.f("trashIncoming", { count: row.incoming })}</Typography>}
            {row.entries.map((entry: any, i: number) => <Flex key={i} direction="column" alignItems="stretch" gap={2}>
              <Typography variant="delta" tag="h3">{entry.locale || t.contentNone}{entry.status ? ` · ${entry.status === "published" ? t.trashPublished : t.trashDraft}` : ""}</Typography>
              <Typography variant="sigma" textColor="neutral600">{t.trashFields}</Typography>
              <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, max-content) 1fr", gap: "4px 16px", margin: 0 }}>
                {entry.fields.map((field: any) => <React.Fragment key={field.name}>
                  <dt><Typography variant="pi" fontWeight="bold">{field.name}</Typography></dt>
                  <dd style={{ margin: 0, wordBreak: "break-word" }}><Typography variant="pi">{field.count !== undefined ? t.f("trashItems", { count: field.count }) : field.value}</Typography></dd>
                </React.Fragment>)}
              </dl>
              {entry.blocks.length > 0 && <><Typography variant="sigma" textColor="neutral600">{t.trashBlocks}</Typography>
                <ol style={{ margin: 0, paddingLeft: 20 }}>{entry.blocks.map((block: any, j: number) => <li key={j}><Typography variant="pi">{block.name}</Typography></li>)}</ol></>}
            </Flex>)}
          </Flex>}
      </Modal.Body>
      <Modal.Footer><Modal.Close><Button variant="tertiary">{t.trashClose}</Button></Modal.Close></Modal.Footer>
    </Modal.Content>
  </Modal.Root>;
}

function TrashTab({ t, get, post, del, can }: any) {
  const { toggleNotification } = useNotification();
  const [contentType, setType] = React.useState("");
  const [restored, setRestored] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [refresh, reload] = React.useReducer((n: number) => n + 1, 0);
  const { data, failed } = useList(get, "/trash", { contentType, status: restored ? "restored" : "trashed", page, pageSize: 20 }, refresh);
  const [preview, setPreview] = React.useState<number | null>(null);
  const [restore, setRestore] = React.useState<any>(null);
  const [remove, setRemove] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const types = new Map<string, any>((data?.types || []).map((type: any) => [type.uid, type]));
  const title = (row: any) => row.title || t.contentUntitled;
  const check = async (row: any) => {
    setRestore({ row, report: null });
    try { const { data } = await get(`/blockscene/trash/${row.id}/check`); setRestore({ row, report: data }); }
    catch { setRestore({ row, report: { blocking: [], warnings: [] }, failed: true }); }
  };
  const confirmRestore = async () => {
    setBusy(true);
    try {
      const { data: result } = await post(`/blockscene/trash/${restore.row.id}/restore`, {});
      setRestore({ ...restore, done: result });
      reload();
    } catch (error: any) {
      // 409: the server found a blocking problem on its own check (something changed since the pre-check); nothing was written.
      const details = error?.response?.data?.error?.details;
      if (details) setRestore({ ...restore, report: details });
      else { setRestore(null); toggleNotification({ type: "danger", message: t.restoreFailed }); }
    } finally { setBusy(false); }
  };
  const confirmRemove = async () => {
    setBusy(true);
    try { await del(`/blockscene/trash/${remove.id}`); toggleNotification({ type: "success", message: t.trashDeleted }); reload(); }
    catch { toggleNotification({ type: "danger", message: t.trashDeleteFailed }); }
    finally { setBusy(false); setRemove(null); }
  };
  const expires = (at: string) => { const days = Math.floor((new Date(at).getTime() - Date.now()) / DAY); return days < 1 ? t.trashExpiresToday : t.f("trashExpiresIn", { days }); };
  return <Flex direction="column" alignItems="stretch" gap={4}>
    <Flex gap={4} wrap="wrap" alignItems="flex-end">
      <Select name="trash-type" label={t.activityType} value={contentType} onChange={(v: string) => { setType(v); setPage(1); }}
        options={[{ value: "", label: t.activityAnyType }, ...(data?.types || []).map((type: any) => ({ value: type.uid, label: type.displayName }))]} />
      <Flex gap={2} paddingBottom={2}><Switch aria-label={t.trashShowRestored} checked={restored} onCheckedChange={(v: boolean) => { setRestored(v); setPage(1); }} /><Typography variant="pi">{t.trashShowRestored}</Typography></Flex>
    </Flex>
    {failed ? <Typography role="alert" textColor="danger600">{t.trashFailed}</Typography>
      : !data ? <Typography textColor="neutral600">{t.contentLoading}</Typography>
      : !data.results.length ? <Typography textColor="neutral600">{t.trashEmpty}</Typography>
      : <Box>
        <Table colCount={5} rowCount={data.results.length + 1} data-testid="blockscene-trash">
          <Thead><Tr><Th><Typography variant="sigma">{t.activityDocument}</Typography></Th><Th><Typography variant="sigma">{t.trashLocales}</Typography></Th>
            <Th><Typography variant="sigma">{t.trashDeletedBy}</Typography></Th><Th><Typography variant="sigma">{restored ? t.trashRestoredAs : t.trashExpires}</Typography></Th><Th><Typography variant="sigma"> </Typography></Th></Tr></Thead>
          <Tbody>{data.results.map((row: any) => <Tr key={row.id} data-testid={`trash-${row.id}`}>
            <Td><Doc t={t} type={types.get(row.contentType)} row={{ ...row, exists: undefined }} documentId={row.relatedDocumentId} locale={null} /></Td>
            <Td><Typography variant="pi">{(row.locales || []).map((l: any) => l ?? t.contentNone).join(", ")}</Typography></Td>
            <Td><Flex direction="column" alignItems="flex-start"><Typography variant="pi">{row.actorName || (row.actor === "system" ? t.historySystem : row.actor)}</Typography>
              <Typography variant="pi" textColor="neutral600">{when(t, row.deletedAt)}</Typography></Flex></Td>
            <Td><Typography variant="pi">{restored ? (row.restoredAt ? when(t, row.restoredAt) : "") : expires(row.expiresAt)}</Typography>
              {restored && row.restoredAs && types.get(row.contentType) && <Box><Link href={editUrl(types.get(row.contentType), row.restoredAs, null)}>{t.contentOpen}</Link></Box>}</Td>
            <Td><Flex gap={2} justifyContent="flex-end">
              <Button variant="tertiary" size="S" onClick={() => setPreview(row.id)}>{t.trashPreview}</Button>
              {!restored && can.canRestore && <Button variant="secondary" size="S" onClick={() => check(row)} data-testid={`trash-restore-${row.id}`}>{t.trashRestore}</Button>}
              {can.canPurge && <Button variant="danger-light" size="S" onClick={() => setRemove(row)} data-testid={`trash-delete-${row.id}`}>{t.trashDelete}</Button>}
            </Flex></Td>
          </Tr>)}</Tbody>
        </Table>
        <Pager t={t} pagination={data.pagination} setPage={setPage} />
      </Box>}
    {preview !== null && <Preview t={t} id={preview} get={get} onClose={() => setPreview(null)} />}
    {restore && <Dialog.Root open onOpenChange={(open: boolean) => !open && !busy && setRestore(null)}>
      <Dialog.Content>
        <Dialog.Header>{t.f("restoreTitle", { title: title(restore.row) })}</Dialog.Header>
        <Dialog.Body><Flex direction="column" alignItems="stretch" gap={3} width="100%">
          {restore.done ? <Flex direction="column" alignItems="flex-start" gap={2} role="status" data-testid="restore-done">
            <Typography textColor="success700">{restore.done.already ? t.restoreAlready : t.restoreDone}</Typography>
            {restore.done.documentId && types.get(restore.row.contentType) && <Link href={editUrl(types.get(restore.row.contentType), restore.done.documentId, restore.done.locales?.[0] ?? null)}>{t.restoreOpen}</Link>}
            {!restore.done.already && <Report t={t} report={{ warnings: restore.done.warnings, incoming: restore.done.incoming && { ...restore.done.incoming, reconnect: restore.done.incoming.reconnected } }} />}
          </Flex>
          : !restore.report ? <Typography>{t.restoreChecking}</Typography> : restore.failed ? <Typography role="alert" textColor="danger600">{t.restoreFailed}</Typography> : <>
            <Typography variant="pi">{t.restoreIntro} {restore.report.documentId ? t.restoreInto : t.restoreNew}</Typography>
            {restore.report.locales?.length > 0 && restore.report.locales[0] !== null && <Typography variant="pi">{t.f("restoreLocales", { locales: restore.report.locales.join(", ") })}</Typography>}
            <Report t={t} report={restore.report} />
          </>}
        </Flex></Dialog.Body>
        <Dialog.Footer>
          <Dialog.Cancel><Button variant="tertiary" disabled={busy}>{restore.done ? t.trashClose : t.restoreCancel}</Button></Dialog.Cancel>
          {!restore.done && <Button onClick={confirmRestore} loading={busy} disabled={busy || !restore.report || restore.failed || restore.report.blocking?.length > 0} data-testid="restore-confirm">{t.restoreConfirm}</Button>}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>}
    {remove && <Dialog.Root open onOpenChange={(open: boolean) => !open && !busy && setRemove(null)}>
      <Dialog.Content>
        <Dialog.Header>{t.trashDeleteTitle}</Dialog.Header>
        <Dialog.Body><Typography>{t.f("trashDeleteConfirm", { title: title(remove) })}</Typography></Dialog.Body>
        <Dialog.Footer>
          <Dialog.Cancel><Button variant="tertiary" disabled={busy}>{t.restoreCancel}</Button></Dialog.Cancel>
          <Button variant="danger" onClick={confirmRemove} loading={busy} disabled={busy} data-testid="delete-confirm">{t.trashDelete}</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>}
  </Flex>;
}

export function ContentPage() {
  const t = useMessages();
  const { get, post, del } = useFetchClient();
  const activity: any = useRBAC(ACTIVITY);
  const trash: any = useRBAC(TRASH);
  const [tab, setTab] = React.useState<string | null>(null);
  if (activity.isLoading || trash.isLoading) return <Page.Loading />;
  const canActivity = Boolean(activity.allowedActions?.canRead), canTrash = Boolean(trash.allowedActions?.canRead);
  if (!canActivity && !canTrash) return <Page.NoPermissions />;
  const current = tab || (canActivity ? "activity" : "trash");
  return <Page.Main>
    <Page.Title>{t.contentTitle}</Page.Title>
    <Layouts.Header title={t.contentTitle} subtitle={t.contentSubtitle} />
    <Layouts.Content>
      <Tabs.Root value={current} onValueChange={setTab}>
        <Tabs.List aria-label={t.contentTitle}>
          {canActivity && <Tabs.Trigger value="activity">{t.activityTab}</Tabs.Trigger>}
          {canTrash && <Tabs.Trigger value="trash">{t.trashTab}</Tabs.Trigger>}
        </Tabs.List>
        <Box paddingTop={6} paddingBottom={6} background="neutral0" hasRadius paddingLeft={6} paddingRight={6} marginTop={4}>
          {canActivity && <Tabs.Content value="activity"><ActivityTab t={t} get={get} /></Tabs.Content>}
          {canTrash && <Tabs.Content value="trash"><TrashTab t={t} get={get} post={post} del={del} can={trash.allowedActions} /></Tabs.Content>}
        </Box>
      </Tabs.Root>
    </Layouts.Content>
  </Page.Main>;
}
