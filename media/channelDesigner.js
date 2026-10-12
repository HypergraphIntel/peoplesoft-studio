// Message Channel window (src/editors/channelDesignerPanel.ts): App Designer's. The panel owns the document; this
// script draws it and sends operations (model/channelDocument.ts ChannelOp) and requests.
(function () {
  'use strict';
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage() {}, getState() {}, setState() {} };
  const config = JSON.parse(document.getElementById('config').textContent);
  const $ = (id) => document.getElementById(id);
  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'dataset') Object.assign(e.dataset, v); else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'list') e.setAttribute('list', v);
      else if (v !== undefined && v !== null && v !== false) e[k] = v;
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  };

  let state = null;            // the panel's last 'state' message
  let propsTab = 'general';    // Message Channel Properties: General / Use
  let selField = null;         // the selected partition field
  let selMessage = null;
  let adding = null;           // the Add Partition Field dialog: { value, error }
  const send = (m) => vscode.postMessage(m);
  const op = (o) => { if (!state || !state.editable) return; send({ type: 'op', op: o }); };

  // ---------------------------------------------------------------- choices (lists the dialogs offer)
  let choiceSeq = 0; const pending = new Map(); const cache = new Map();
  function choices(what, arg) {
    const k = what + '|' + (arg || '');
    if (cache.has(k)) return Promise.resolve(cache.get(k));
    const id = ++choiceSeq; send({ type: 'choices', id, what, arg: arg || '' });
    return new Promise((resolve) => pending.set(id, (items) => { cache.set(k, items); resolve(items); }));
  }

  // ---------------------------------------------------------------- toolbar
  function toolbar() {
    const t = $('toolbar'); t.replaceChildren();
    const ed = state.editable;
    const b = (label, type, opts = {}) => el('button', { textContent: label, title: opts.title || '', class: opts.primary ? 'primary' : '', disabled: !!opts.disabled, onclick: () => send({ type }) });
    t.append(
      b('Save', 'save', { primary: true, disabled: !ed || (!state.dirty && !state.isNew), title: 'Save the message channel as App Designer saves it (Ctrl+S)' }),
      b('Undo', 'undo', { disabled: !ed || !state.canUndo }), b('Redo', 'redo', { disabled: !ed || !state.canRedo }),
      el('span', { class: 'sep' }),
      b('Validate', 'validate', { title: 'App Designer\'s checks, the partition fields and Owner ID looked up' }),
      b('Preview Save', 'preview', { disabled: !ed, title: 'The rows and counters a save would write' }),
      b('Reload', 'reload', { disabled: state.isNew }),
      el('span', { class: 'sep' }),
      b('Save As…', 'saveAs', { disabled: !ed }), b('Rename…', 'rename', { disabled: !ed || state.isNew }), b('Delete Channel', 'deleteChannel', { disabled: !ed }),
      el('span', { class: 'status' + (state.statusError ? ' error' : ''), textContent: (state.dirty ? '● ' : '') + (state.status || `Message channel on ${state.connection}${ed ? '' : ' (read-only)'}`) })
    );
  }

  // ---------------------------------------------------------------- the window: its Messages tab
  function view() {
    const v = $('view'); v.replaceChildren();
    const d = state.doc;
    const tabs = el('div', { class: 'ctabs' }, el('span', { class: 'on' }, 'Messages'));
    const messages = el('div', { class: 'clist', tabIndex: 0 },
      d.messages.map((m) => el('div', { class: 'citem' + (selMessage === m ? ' sel' : ''), title: `${m} -- double-click to open the message`,
        onclick: () => { selMessage = m; view(); }, ondblclick: () => send({ type: 'openMessage', message: m }) }, m)));
    const parts = el('div', { class: 'clist', tabIndex: 0, oncontextmenu: (e) => { e.preventDefault(); contextMenu(e); } },
      d.partitions.map((p) => el('div', { class: 'citem check' + (selField === p.field ? ' sel' : ''), title: p.added ? `${p.field} -- added with Add Partition Field` : p.field,
        onclick: () => { selField = p.field; }, oncontextmenu: (e) => { e.preventDefault(); selField = p.field; view(); contextMenu(e); } },
        el('input', { type: 'checkbox', checked: p.checked, disabled: !state.editable, onchange: (e) => op({ kind: 'setPartition', field: p.field, checked: e.target.checked }) }),
        el('span', null, p.field))));
    const grid = el('div', { class: 'cgrid' },
      el('div', null, el('div', { class: 'clabel' }, el('u', null, 'M'), 'essages:'), messages),
      el('div', null, el('div', { class: 'clabel' }, 'Use These Fields to ', el('u', null, 'P'), 'artition:'), parts));
    v.append(el('div', { class: 'cwin' }, tabs, el('div', { class: 'cpage' }, grid,
      d.messages.length ? null : el('div', { class: 'hint' }, 'No message names this channel: App Designer lists no fields to partition by. Fields you add are saved, and dropped the next time it opens the channel.'),
      d.dropped.length ? el('div', { class: 'hint warn' }, `Stored but not listed: ${d.dropped.join(', ')} -- App Designer drops these when it opens the channel; the next save deletes them.`) : null)));
    if (adding) v.append(addDialog());
  }

  // Add Partition Field: Field name, OK / Cancel; the name must be a field (78,1) [chn12].
  function addDialog() {
    const input = el('input', { type: 'text', value: adding.value, maxLength: config.max.field, list: 'fieldnames',
      oninput: (e) => { adding.value = e.target.value; refreshFields(e.target.value); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { adding = null; view(); } } });
    const dl = el('datalist', { id: 'fieldnames' });
    function refreshFields(prefix) {
      if (!prefix || prefix.length < 2) return;
      choices('fields', prefix.toUpperCase()).then((items) => dl.replaceChildren(...items.map((x) => el('option', { value: x.value }))));
    }
    function ok() {
      const f = (adding.value || '').trim();
      if (!f) return;
      adding.error = null;
      op({ kind: 'addPartition', field: f });
    }
    const box = el('div', { class: 'cdialog' },
      el('div', { class: 'ctitle' }, 'Add Partition Field'),
      el('label', { class: 'row' }, el('span', null, 'Field name:'), input), dl,
      adding.error ? el('div', { class: 'diag error' }, adding.error) : null,
      el('div', { class: 'cbuttons' }, el('button', { textContent: 'OK', class: 'primary', onclick: ok }), el('button', { textContent: 'Cancel', onclick: () => { adding = null; view(); } })));
    setTimeout(() => input.focus(), 0);
    return box;
  }

  function contextMenu(e) {
    const m = $('menu'); m.replaceChildren();
    const add = (label, enabled, fn) => m.append(el('div', { class: 'mi' + (enabled ? '' : ' off'), textContent: label, onclick: () => { hide(); fn(); } }));
    add('Add Partition Field', state.editable, () => { adding = { value: '', error: null }; view(); });
    m.hidden = false;
    m.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px'; m.style.top = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 8) + 'px';
    function hide() { m.hidden = true; }
    setTimeout(() => document.addEventListener('click', hide, { once: true }), 0);
  }

  // App Designer's Last Updated: 10/12/26  8:25:16AM.
  function stamp(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    const h = Number(m[4]);
    return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}  ${h % 12 || 12}:${m[5]}:${m[6]}${h < 12 ? 'AM' : 'PM'}`;
  }

  // ---------------------------------------------------------------- Message Channel Properties: General and Use [chn02-chn04, chn09-chn11]
  const field = (label, control, hint) => el('label', { class: 'row', title: hint || '' }, el('span', null, label), control);
  const check = (label, on, onchange) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!on, disabled: !state.editable, onchange: (e) => onchange(e.target.checked) }), label);
  function props() {
    const p = $('props'); p.replaceChildren();
    const d = state.doc;
    const set = (patch) => op({ kind: 'setChannel', patch });
    p.append(el('h2', null, 'Message Channel Properties'), el('div', { class: 'sub' }, d.name));
    const tabs = el('div', { class: 'ptabs' });
    for (const [k, l] of [['general', 'General'], ['use', 'Use']]) tabs.append(el('button', { class: propsTab === k ? 'on' : '', textContent: l, onclick: () => { propsTab = k; props(); } }));
    p.append(tabs);
    if (propsTab === 'general') {
      p.append(field('Description', el('input', { type: 'text', value: d.descr, maxLength: config.max.descr, disabled: !state.editable, onchange: (e) => set({ descr: e.target.value }) })));
      p.append(el('div', null, 'Comments'), el('textarea', { rows: 6, value: d.descrlong || '', disabled: !state.editable, onchange: (e) => set({ descrlong: e.target.value }) }));
      const owners = el('select', { disabled: !state.editable, onchange: (e) => set({ owner: e.target.value }) }, el('option', { value: '', textContent: '' }));
      choices('owners').then((items) => { for (const x of items) owners.append(el('option', { value: x.value, textContent: x.label || x.value, selected: x.value === d.owner })); });
      p.append(field('Owner ID', owners));
      p.append(el('fieldset', null, el('legend', null, 'Last Updated'),
        field('Date/Time', el('span', null, stamp(d.lastUpdated))), field('By User', el('span', null, d.lastUpdatedBy || ''))));
    } else {
      // Run is also what a never-set status (0) shows; any change here writes the status and ordering explicitly, as the dialog's OK does.
      const status = el('fieldset', null, el('legend', null, 'Message Channel Status'),
        el('label', { class: 'check' }, el('input', { type: 'radio', name: 'status', checked: d.status !== 2, disabled: !state.editable, onchange: () => set({ status: 'run' }) }), 'Run'),
        el('label', { class: 'check' }, el('input', { type: 'radio', name: 'status', checked: d.status === 2, disabled: !state.editable, onchange: () => set({ status: 'pause' }) }), 'Pause'));
      p.append(status, check('Archive Messages?', d.archive, (on) => set({ archive: on })), check('Unordered?', d.thruput === 1, (on) => set({ unordered: on })));
      if (d.status === 0 || d.thruput === 0) p.append(el('div', { class: 'hint' }, 'Status and ordering were never set (stored 0): App Designer shows Run and ordered, and writes them on its properties\' OK.'));
      p.append(el('div', { class: 'hint' }, `Not in App Designer's window, kept as stored: publish / subscribe timeout ${d.pubTimeoutMin} / ${d.subTimeoutMin} min, retry ${d.pubRetrySec} / ${d.subRetrySec} s, error threshold ${d.errorThreshold}, quality of service ${d.qualityOfService}.`));
    }
    const list = (state.diagnostics || []).filter((x) => !x.field);
    if (list.length) p.append(el('div', { class: 'diags' }, list.map((x) => el('div', { class: 'diag ' + x.severity }, `${x.severity}: ${x.message}`))));
  }

  // ---------------------------------------------------------------- output: every diagnostic
  function output() {
    const o = $('output'); o.replaceChildren();
    const list = state.diagnostics || [];
    if (!list.length) return;
    o.append(el('div', { class: 'head' }, `${list.filter((d) => d.severity === 'error').length} errors, ${list.filter((d) => d.severity === 'warning').length} warnings`));
    for (const d of list) o.append(el('div', { class: 'diag ' + d.severity, onclick: () => { if (d.field) { selField = d.field; view(); } } }, el('span', { class: 'sev' }, d.severity), `${d.path}: ${d.message}`));
  }

  function render() { if (!state) return; toolbar(); view(); props(); output(); }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      // A partition just added closes the dialog.
      if (adding && m.doc.partitions.some((p) => p.field === (adding.value || '').trim().toUpperCase() && p.checked)) adding = null;
      state = { ...m, statusError: false };
      render();
    } else if (m.type === 'choices') {
      const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m.items); }
    } else if (m.type === 'addFailed') {
      // App Designer clears the box and keeps the dialog open.
      if (adding) { adding = { value: '', error: m.message }; view(); }
    } else if (m.type === 'error') {
      if (state) { state.status = m.message; state.statusError = true; toolbar(); }
    } else if (m.type === 'preview') {
      if (!state) return;
      const inc = Object.entries(m.increments).filter(([, d]) => d).map(([n, d]) => `${n} +${d}`).join(', ');
      state.status = m.empty ? 'Nothing to save.' : `A save writes: ${m.summary.changes.join('; ') || 'the channel row'}${inc ? ' -- ' + inc : ''}`;
      state.statusError = false; toolbar();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.target.blur(); setTimeout(() => send({ type: 'save' }), 0); }
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); send({ type: 'save' }); }
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); send({ type: e.shiftKey ? 'redo' : 'undo' }); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); send({ type: 'redo' }); }
    else if (e.altKey && k === 'enter') { e.preventDefault(); propsTab = 'general'; props(); }
  });

  // The splitter between the window and its properties.
  (() => {
    const sp = $('splitter'), pr = $('props'); let x0 = 0, w0 = 0;
    const move = (e) => { pr.style.width = Math.max(240, Math.min(window.innerWidth - 200, w0 - (e.clientX - x0))) + 'px'; };
    sp.addEventListener('mousedown', (e) => { x0 = e.clientX; w0 = pr.offsetWidth; document.addEventListener('mousemove', move); document.addEventListener('mouseup', () => document.removeEventListener('mousemove', move), { once: true }); });
  })();

  send({ type: 'ready' });
})();
