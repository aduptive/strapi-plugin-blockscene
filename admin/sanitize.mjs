// Read-only previews of rich-text values (lazy editors). The value is the editor's own HTML, but it is still stored
// content: anything that runs code, loads a frame or restyles the admin (inline styles too) is dropped.
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'TEMPLATE', 'NOSCRIPT'])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster', 'background'])
// Browsers ignore whitespace and control characters inside a scheme ("java\tscript:").
const unsafeUrl = (value) => /^(javascript|vbscript|data:text\/html)/i.test(String(value).replace(/[\u0000- ]/g, ''))
// Works on any DOM-shaped tree (tests pass a stub): `children`, `tagName`, `attributes`, `removeAttribute`, `remove`.
export function cleanTree(root) {
  for (const el of [...root.children]) {
    if (DROP.has(String(el.tagName).toUpperCase())) { el.remove(); continue }
    for (const { name, value } of [...el.attributes]) {
      const key = name.toLowerCase()
      if (key.startsWith('on') || key === 'srcdoc' || key === 'style' || (URL_ATTRS.has(key) && unsafeUrl(value))) el.removeAttribute(name)
    }
    cleanTree(el)
  }
  return root
}
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || !html.trim() || typeof DOMParser === 'undefined') return ''
  return cleanTree(new DOMParser().parseFromString(html, 'text/html').body).innerHTML
}
