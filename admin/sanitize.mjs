// Read-only previews of rich-text values (lazy editors). The value is the editor's own HTML, but it is still stored
// content: anything that runs code or loads a frame is dropped; inline styles keep only text formatting properties
// (the editor's colours, sizes, alignment), never positioning or anything that could load a URL.
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'TEMPLATE', 'NOSCRIPT'])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster', 'background'])
// Browsers ignore whitespace and control characters inside a scheme ("java\tscript:").
const unsafeUrl = (value) => /^(javascript|vbscript|data:text\/html)/i.test(String(value).replace(/[\u0000- ]/g, ''))
const STYLE_PROPS = new Set(['color', 'background-color', 'text-align', 'font-size', 'font-weight', 'font-style', 'font-family',
  'text-decoration', 'text-transform', 'line-height', 'letter-spacing', 'vertical-align', 'width', 'height', 'border-color'])
export function safeStyle(value) {
  return String(value).split(';').map(part => part.split(':')).filter(([prop, ...rest]) => {
    const name = prop?.trim().toLowerCase(); const val = rest.join(':').trim()
    return STYLE_PROPS.has(name) && val && !/url\s*\(|expression|[\\<>]|@import/i.test(val)
  }).map(([prop, ...rest]) => `${prop.trim().toLowerCase()}: ${rest.join(':').trim()}`).join('; ')
}
// Works on any DOM-shaped tree (tests pass a stub): `children`, `tagName`, `attributes`, `setAttribute`, `removeAttribute`, `remove`.
export function cleanTree(root) {
  for (const el of [...root.children]) {
    if (DROP.has(String(el.tagName).toUpperCase())) { el.remove(); continue }
    for (const { name, value } of [...el.attributes]) {
      const key = name.toLowerCase()
      if (key === 'style') { const kept = safeStyle(value); if (kept) el.setAttribute(name, kept); else el.removeAttribute(name) }
      else if (key.startsWith('on') || key === 'srcdoc' || (URL_ATTRS.has(key) && unsafeUrl(value))) el.removeAttribute(name)
    }
    cleanTree(el)
  }
  return root
}
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || !html.trim() || typeof DOMParser === 'undefined') return ''
  return cleanTree(new DOMParser().parseFromString(html, 'text/html').body).innerHTML
}
