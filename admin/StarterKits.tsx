import * as React from "react";
import { Box, Button, Flex, Typography } from "@strapi/design-system";
import { localized, starterKitRows, starterKitsForLocale } from "./model.mjs";
import { useMessages } from "./messages";

const marker = (docKey: string) => {
  try {
    const entry = window.history.state?.key ?? window.history.state?.idx ?? "route";
    return `blockscene:starter-kit:${entry}:${docKey}`;
  } catch {
    return `blockscene:starter-kit:${docKey}`;
  }
};
const wasHandled = (key: string) => {
  try { return window.sessionStorage.getItem(key) === "handled"; } catch { return false; }
};
const remember = (key: string) => {
  try { window.sessionStorage.setItem(key, "handled"); } catch { /* Private browsing may block storage. */ }
};

export function StarterKits({ creating, kits, zones, components, form, Modal, docKey }: any) {
  const t = useMessages();
  const key = marker(docKey);
  const handled = React.useRef({ key, value: wasHandled(key) });
  if (handled.current.key !== key) handled.current = { key, value: wasHandled(key) };
  const usable = starterKitsForLocale(kits, form?.locale).filter((kit: any) => Object.keys(kit.zones || {}).every((name) => zones.some((zone: any) => zone.name === name)));
  const available = creating && form && !handled.current.value && usable.length > 0 && zones.length > 0 && zones.every((zone: any) => form.rows(zone.name).length === 0);
  const [open, setOpen] = React.useState(available);
  React.useEffect(() => { if (available) setOpen(true); }, [available, key]);
  if (!available) return null;
  const finish = () => { handled.current.value = true; remember(key); setOpen(false); };
  const apply = (kit: any) => {
    const rows = starterKitRows(kit, zones, components, form);
    if (!rows) return;
    for (const [zone, value] of Object.entries(rows)) form.setRows(zone, value);
    finish();
  };
  return (
    <Modal open={open} onOpenChange={(next: boolean) => next ? setOpen(true) : finish()} title={t.starterKits} width="560px">
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography textColor="neutral600">{t.starterKitsHelp}</Typography>
        {usable.map((kit: any) => (
          <Button key={kit.id} variant="secondary" fullWidth onClick={() => apply(kit)} data-testid={`starter-kit-${kit.id}`}>
            {localized(kit.label, t.locale)}
          </Button>
        ))}
        <Box paddingTop={1}><Button variant="tertiary" onClick={finish}>{t.startBlank}</Button></Box>
      </Flex>
    </Modal>
  );
}
