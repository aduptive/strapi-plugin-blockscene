import * as React from "react";

// Preview widths (CSS px) shared by the page preview and the gallery's magnified block. "fit" fills the stage;
// a device renders at its own width, scaled down when the stage is narrower.
export const DEVICES = { fit: 0, mobile: 390, tablet: 834, desktop: 1440 } as const;
export type Device = keyof typeof DEVICES;
export function useStageSize(el: HTMLElement | null) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [el]);
  return size;
}
// `device`: a built-in name or a width in px (custom widths from editor.previewDevices).
export const frameStyle = (device: Device | number, stage: { width: number; height: number }) => {
  const width = typeof device === "number" ? device : DEVICES[device];
  if (!width || !stage.width) return { left: 0, width: "100%", height: "100%" };
  const scale = Math.min(1, stage.width / width);
  return { left: Math.max(0, (stage.width - width * scale) / 2), width, height: stage.height / scale, transform: `scale(${scale})` };
};

// Canvas behind the previewed page (whole-page pane and the gallery's magnified block): the admin's own page
// background with a 24 px grid in its faintest border tone, taken from the theme so a customised admin (light or dark) carries over.
export const stageBackground = (theme: any) => {
  const line = theme?.colors?.neutral150 || "#eaeaef";
  return {
    backgroundColor: theme?.colors?.neutral100 || "#f6f6f9",
    backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
    backgroundSize: "24px 24px",
  };
};
