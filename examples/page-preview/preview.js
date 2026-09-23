// Blockscene page preview bridge: reference implementation (framework-free).
(() => {
  const PROTOCOL = 'blockscene:page-preview:v1'
  const params = new URLSearchParams(location.search)
  const channel = params.get('channel') || ''
  // Only the admin origin may talk to this page. Configure it per environment.
  const ADMIN_ORIGIN = params.get('admin') || location.origin
  if (!channel || window.parent === window) return
  const post = (message) => window.parent.postMessage({ protocol: PROTOCOL, channel, ...message }, ADMIN_ORIGIN)
  const ok = (event, type) => event.origin === ADMIN_ORIGIN && event.source === window.parent && event.data?.protocol === PROTOCOL && event.data?.channel === channel && event.data?.type === type
  let editing = null, pending = null, selected = null
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // Example renderer: title (inline plain text, explicitly mapped), body (rich, opens the admin editor), image (Media Library).
  // Groups (only when the admin sends a `groups` map, OPEN uid -> CLOSE uid): an OPEN row … its CLOSE,
  // rendered as a nested box with move/remove controls. A stray CLOSE stays visible as an ordinary block.
  let groups = null
  const groupOf = (blocks) => {
    const out = []; let i = 0
    while (i < blocks.length) {
      const b = blocks[i]
      if (groups && Object.prototype.hasOwnProperty.call(groups, b.uid)) {
        const stack = [groups[b.uid]]; let end = blocks.length - 1, closed = false
        for (let j = i + 1; j < blocks.length; j++) {
          if (Object.prototype.hasOwnProperty.call(groups, blocks[j].uid)) stack.push(groups[blocks[j].uid])
          else if (blocks[j].uid === stack[stack.length - 1]) { stack.pop(); if (!stack.length) { end = j; closed = true; break } }
        }
        out.push({ type: 'group', block: b, closeKey: closed ? blocks[end].key : null, children: blocks.slice(i + 1, closed ? end : end + 1) })
        i = end + 1; continue
      }
      out.push({ type: 'block', block: b }); i++
    }
    return out
  }
  const render = (blocks) => {
    const page = document.getElementById('page')
    page.innerHTML = blocks.length ? '' : '<p class="status">No blocks in the zone yet.</p>'
    // Insertion gaps: before the first block, between blocks and after the last one.
    const gap = (after, label, inner = false) => { const g = document.createElement('div'); g.className = 'bp-gap'; g.dataset.testid = `bp-gap-${after ?? 'start'}`; const opener = groups && Object.keys(groups)[0]; g.innerHTML = `<button type="button" class="bp-insert" data-after="${esc(after ?? '')}" aria-label="${esc(label)}">+ Insert block</button>${opener && !inner ? `<button type="button" class="bp-insert bp-insert--group" data-insert-group="${esc(opener)}" data-after="${esc(after ?? '')}" aria-label="Add group: ${esc(label)}">+ Group</button>` : ''}`; return g }
    page.appendChild(gap(null, blocks.length ? 'Insert block at the start' : 'Insert the first block'))
    const renderBlock = (block, parent) => {
      const section = document.createElement('section')
      section.className = 'bp-block'; section.dataset.blockKey = block.key; section.dataset.blockUid = block.uid
      if (selected === block.key) section.dataset.selected = ''
      const d = block.data || {}
      const options = (block.fields || []).map(f => `<option value="${esc(f.name)}">${esc(f.label)}</option>`).join('')
      const mediaTools = Object.entries(block.media || {}).map(([field, meta]) => `<button type="button" data-media="${esc(field)}">${meta.present ? 'Replace image' : 'Add image'}</button>${meta.present && !meta.required ? `<button type="button" data-media-remove="${esc(field)}">Remove image</button>` : ''}`).join('')
      section.innerHTML = `<div class="bp-tools"><span class="bp-label">${esc(block.label)}</span>${mediaTools}${options ? `<select aria-label="Edit field" data-fields><option value="">Edit field…</option>${options}</select>` : ''}</div>`
      if ('title' in d) section.insertAdjacentHTML('beforeend', `<h2 data-block-field="title" contenteditable="plaintext-only" aria-label="Edit title">${esc(d.title)}</h2>`)
      if ('body' in d) section.insertAdjacentHTML('beforeend', `<div data-block-field="body" data-field-kind="rich" role="button" tabindex="0" aria-label="Edit text">${d.body ? esc(d.body).replace(/\n/g, '<br>') : '<em>Empty text. Click to edit.</em>'}</div>`)
      if (d.image?.url) section.insertAdjacentHTML('beforeend', `<img src="${esc(d.image.url)}" alt="${esc(d.image.alternativeText)}" data-media-field="image">`)
      for (const [name, value] of Object.entries(d)) if (!['title', 'body', 'image'].includes(name) && typeof value !== 'object') section.insertAdjacentHTML('beforeend', `<p><strong>${esc(name)}:</strong> ${esc(String(value))}</p>`)
      parent.appendChild(section)
      parent.appendChild(gap(block.key, `Insert block after ${block.label}`, parent !== page))
    }
    // Groups nest: children are rendered with the same walk, so a pair inside a group gets its own box.
    const renderNodes = (nodes, parent) => {
      for (const node of nodes) {
        if (node.type === 'block') { renderBlock(node.block, parent); continue }
        const box = document.createElement('div'); box.className = 'bp-group'; box.dataset.groupKey = node.block.key
        box.innerHTML = `<div class="bp-tools" style="position:static;opacity:1;margin-bottom:8px"><span class="bp-label">Group · ${esc(node.block.label)}</span><button type="button" data-move="up">↑ Group</button><button type="button" data-move="down">↓ Group</button><button type="button" data-remove-group aria-label="Remove group">✕ Group</button></div>`
        box.appendChild(gap(node.block.key, `Insert block at the start of group ${node.block.label}`, true))
        renderNodes(groupOf(node.children), box)
        parent.appendChild(box)
        parent.appendChild(gap(node.closeKey ?? (node.children.at(-1)?.key ?? node.block.key), 'Insert block after the group', parent !== page))
      }
    }
    renderNodes(groupOf(blocks), page)
    for (const title of page.querySelectorAll('[data-block-field="title"]')) {
      const key = title.closest('[data-block-key]').dataset.blockKey
      let timer
      const send = () => post({ type: 'edit', key, field: 'title', value: title.textContent.slice(0, 500) })
      title.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(send, 250) })
      title.addEventListener('focus', () => { editing = key })
      title.addEventListener('blur', () => { clearTimeout(timer); send(); editing = null; if (pending) { render(pending); pending = null } })
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur() } })
    }
  }
  document.addEventListener('click', (event) => {
    const insertGroup = event.target.closest('[data-insert-group]')
    if (insertGroup) { post({ type: 'insert-group', after: insertGroup.dataset.after || null, uid: insertGroup.dataset.insertGroup }); return }
    const insert = event.target.closest('.bp-insert')
    if (insert) { post({ type: 'insert', after: insert.dataset.after || null }); return }
    const move = event.target.closest('[data-move]')
    if (move) { post({ type: 'move-group', key: move.closest('[data-group-key]').dataset.groupKey, direction: move.dataset.move }); return }
    const removeGroup = event.target.closest('[data-remove-group]')
    if (removeGroup) { post({ type: 'delete-group', key: removeGroup.closest('[data-group-key]').dataset.groupKey }); return }
    const section = event.target.closest('[data-block-key]'); if (!section) return
    const key = section.dataset.blockKey
    if (event.target.closest('[contenteditable]')) return
    const media = event.target.closest('[data-media], [data-media-field]')
    if (media) { post({ type: 'media', key, field: media.dataset.media || media.dataset.mediaField }); return }
    const remove = event.target.closest('[data-media-remove]')
    if (remove) { post({ type: 'media-remove', key, field: remove.dataset.mediaRemove }); return }
    const rich = event.target.closest('[data-field-kind="rich"]')
    if (rich) { selected = key; post({ type: 'focus', key, field: rich.dataset.blockField }); return }
    if (event.target.closest('select')) return
    selected = key; post({ type: 'select', key })
  })
  document.addEventListener('change', (event) => { const select = event.target.closest('select[data-fields]'); if (select && select.value) { const key = select.closest('[data-block-key]').dataset.blockKey; selected = key; post({ type: 'focus', key, field: select.value }); select.value = '' } })
  document.addEventListener('keydown', (event) => { const rich = event.target.closest?.('[data-field-kind="rich"]'); if (rich && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); post({ type: 'focus', key: rich.closest('[data-block-key]').dataset.blockKey, field: rich.dataset.blockField }) } })
  window.addEventListener('message', (event) => {
    if (ok(event, 'ping')) post({ type: 'ready' })
    if (ok(event, 'update-page') && Array.isArray(event.data.blocks)) { clearInterval(retry); groups = event.data.groups || null; if (editing) pending = event.data.blocks; else render(event.data.blocks) }
    if (ok(event, 'highlight') && typeof event.data.key === 'string') { selected = event.data.key; document.querySelectorAll('[data-block-key]').forEach(s => { if (s.dataset.blockKey === selected) s.dataset.selected = ''; else delete s.dataset.selected }); document.querySelector(`[data-block-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'center' }) }
  })
  const notify = () => post({ type: 'ready' })
  notify()
  const retry = setInterval(notify, 2000)
})()
