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
export const frameStyle = (device: Device, stage: { width: number; height: number }) => {
  const width = DEVICES[device];
  if (!width || !stage.width) return { left: 0, width: "100%", height: "100%" };
  const scale = Math.min(1, stage.width / width);
  return { left: Math.max(0, (stage.width - width * scale) / 2), width, height: stage.height / scale, transform: `scale(${scale})` };
};
