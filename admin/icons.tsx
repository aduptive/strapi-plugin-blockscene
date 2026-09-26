import * as React from 'react'
import styled from 'styled-components'

// Sidebar icons, drawn inline: no icon package dependency (a peer on @strapi/icons would add a second copy to hosts).
// Names match ICONS in server/settings.js.
const PATHS: Record<string, string> = {
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
  seo: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.5-1-2.5s.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5zM7.5 11h.01M10 7h.01M15 7h.01',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  // Toolbar icons (not offered for sidebar items).
  split: 'M3 4h18v16H3zM12 4v16',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  mobile: 'M8 3h8v18H8zM11.5 18h1',
  tablet: 'M5 3h14v18H5zM11.5 18h1',
  desktop: 'M3 4h18v12H3zM8 20h8M12 16v4',
  expand: 'M7 7l5 5 5-5M7 13l5 5 5-5',
  collapse: 'M7 17l5-5 5 5M7 11l5-5 5 5',
}
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const d = PATHS[name]
  if (!d) return null
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
}

// Square icon button: the label is its accessible name and its tooltip (Strapi 4 and 5 themes).
export const ToolButton = styled.button<{ $active?: boolean }>`
  display: inline-flex; align-items: center; justify-content: center; width: 3.2rem; height: 3.2rem; padding: 0;
  border: 1px solid ${({ theme }) => theme.colors.neutral200}; border-radius: 4px; cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral700)};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral0)};
  &:hover:not(:disabled) { background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral100)}; }
  &:disabled { opacity: 0.4; cursor: default; }
  &:focus-visible { outline: 2px solid ${({ theme }) => theme.colors.primary600}; outline-offset: 1px; }
`
export const Tool = ({ icon, label, active, ...rest }: { icon: string; label: string; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <ToolButton type="button" aria-label={label} title={label} $active={active} {...(active !== undefined ? { 'aria-pressed': active } : {})} {...(rest as any)}>
    <Icon name={icon} />
  </ToolButton>
)
