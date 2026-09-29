import * as React from "react";
import { Box, Button, Flex, Typography } from "@strapi/design-system";
import { localized, starterKitRows } from "./model.mjs";
import { useMessages } from "./messages";

export function StarterKits({ creating, kits, zones, components, form, Modal }: any) {
  const t = useMessages();
  const usable = Array.isArray(kits) ? kits.filter((kit: any) => Object.keys(kit.zones || {}).every((name) => zones.some((zone: any) => zone.name === name))) : [];
  const available = creating && form && usable.length > 0 && zones.length > 0 && zones.every((zone: any) => form.rows(zone.name).length === 0);
  const [open, setOpen] = React.useState(available);
  if (!available) return null;
  const apply = (kit: any) => {
    const rows = starterKitRows(kit, zones, components, form);
    if (!rows) return;
    for (const [zone, value] of Object.entries(rows)) form.setRows(zone, value);
    setOpen(false);
  };
  return (
    <Modal open={open} onOpenChange={setOpen} title={t.starterKits} width="560px">
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography textColor="neutral600">{t.starterKitsHelp}</Typography>
        {usable.map((kit: any) => (
          <Button key={kit.id} variant="secondary" fullWidth onClick={() => apply(kit)} data-testid={`starter-kit-${kit.id}`}>
            {localized(kit.label, t.locale)}
          </Button>
        ))}
        <Box paddingTop={1}><Button variant="tertiary" onClick={() => setOpen(false)}>{t.startBlank}</Button></Box>
      </Flex>
    </Modal>
  );
}
