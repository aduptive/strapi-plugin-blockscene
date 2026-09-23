import * as React from 'react'

export const TEMPLATES = ['generic', 'banner', 'cards', 'imageText', 'faq'] as const
export type Template = typeof TEMPLATES[number]
export type Palette = { background: string; surface: string; text: string; accent: string }
export const DEFAULT_PALETTE: Palette = { background: '#F6F6F9', surface: '#DCDCE4', text: '#32324D', accent: '#4945FF' }

const COLOR = /^#[0-9A-Fa-f]{6}$/
const safe = (value: string | undefined, fallback: string) => value && COLOR.test(value) ? value : fallback

// Text is drawn as bars: structural illustration, not a faithful capture.
type Bar = [x: number, y: number, w: number, h: number, fill: 'text' | 'surface' | 'accent', r?: number]
const lines = (x: number, y: number, w: number, n: number, gap = 10): Bar[] =>
  Array.from({ length: n }, (_, i) => [x, y + i * gap, i === n - 1 ? w * 0.6 : w, 5, 'text'] as Bar)
const shapes: Record<Template, Bar[]> = {
  generic: [[24, 24, 120, 12, 'text'], ...lines(24, 48, 200, 3), [24, 90, 272, 66, 'surface', 6]],
  banner: [[0, 0, 320, 180, 'surface', 0], [32, 52, 160, 14, 'text'], ...lines(32, 80, 150, 2), [32, 116, 70, 20, 'accent', 4]],
  cards: [[24, 20, 140, 10, 'text'], ...[24, 120, 216].flatMap(x => [[x, 44, 80, 56, 'surface', 6], [x, 108, 64, 6, 'text'], [x, 122, 80, 5, 'text'], [x, 132, 50, 5, 'text']] as Bar[])],
  imageText: [[24, 32, 120, 116, 'surface', 6], [168, 40, 110, 12, 'text'], ...lines(168, 64, 128, 4), [168, 116, 60, 18, 'accent', 4]],
  faq: [[24, 20, 140, 12, 'text'], ...[48, 84, 120].flatMap(y => [[24, y, 272, 26, 'surface', 4], [36, y + 10, 140, 6, 'text'], [278, y + 8, 10, 10, 'accent', 5]] as Bar[])],
}

export function Wireframe({ template, palette, className, noPreview }: { template?: string; palette?: Partial<Palette>; className?: string; noPreview?: string }) {
  if (template === 'none') return <div data-wireframe="none" className={className} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: safe(palette?.text, DEFAULT_PALETTE.text), opacity: 0.6, background: safe(palette?.background, DEFAULT_PALETTE.background) }}>{noPreview || 'no preview'}</div>
  const colors = { background: safe(palette?.background, DEFAULT_PALETTE.background), surface: safe(palette?.surface, DEFAULT_PALETTE.surface),
    text: safe(palette?.text, DEFAULT_PALETTE.text), accent: safe(palette?.accent, DEFAULT_PALETTE.accent) }
  const key = (TEMPLATES as readonly string[]).includes(template || '') ? template as Template : 'generic'
  return <svg viewBox="0 0 320 180" role="img" aria-hidden="true" focusable="false" className={className} data-wireframe={key}
    style={{ width: '100%', height: '100%', display: 'block', background: colors.background }}>
    {shapes[key].map(([x, y, w, h, fill, r], i) => <rect key={i} x={x} y={y} width={w} height={h} rx={r ?? 3} fill={colors[fill]} />)}
  </svg>
}
