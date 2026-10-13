// The Configure Event Mapping grid (src/editors/eventMappingPanel.ts): rows shown from the
// panel's state; every edit posts the rows back, and the panel validates and re-renders.
(function () {
  const vscode = acquireVsCodeApi();
  const config = JSON.parse(document.getElementById('config').textContent);
  const app = document.getElementById('app');
  let state;
  const fields = new Map(); // record -> { onComponent, all }

  const h = (tag, attrs, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  };

  const edit = (rows) => vscode.postMessage({ type: 'edit', rows });
  const update = (i, patch) => edit(state.rows.map((r, j) => (j === i ? clean({ ...r, ...patch }) : r)));
  const clean = (r) => {
    const out = { ...r };
    if (out.level !== 'R') delete out.page;
    if (out.level !== 'P' && out.level !== 'F') delete out.record;
    if (out.level !== 'F') delete out.field;
    if (!(config.events[out.level] || []).some((e) => e.code === out.event)) out.event = (config.events[out.level] || [])[0]?.code || '';
    return out;
  };

  const datalist = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));
  const select = (value, options, onchange, disabled) =>
    h('select', { onchange: (e) => onchange(e.target.value), disabled }, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
  const text = (value, onchange, attrs = {}) => h('input', { type: 'text', value: value || '', onchange: (e) => onchange(e.target.value), ...attrs });

  function fieldsFor(record) {
    if (!record) return [];
    if (!fields.has(record)) { fields.set(record, { onComponent: [], all: [] }); vscode.postMessage({ type: 'fields', record }); }
    const f = fields.get(record);
    return f.onComponent.length ? f.onComponent : f.all;
  }

  function row(r, i) {
    const ro = !state.editable;
    const saved = !!r.instanceId; // the page locks a saved row's level and service
    const target = [];
    if (r.level === 'R') target.push(text(r.page, (v) => update(i, { page: v.toUpperCase() }), { list: 'pages', placeholder: 'Page', disabled: ro }));
    if (r.level === 'P' || r.level === 'F') target.push(text(r.record, (v) => update(i, { record: v.toUpperCase() }), { list: 'records', placeholder: 'Record', disabled: ro }));
    if (r.level === 'F') {
      const id = `fields-${i}`;
      target.push(text(r.field, (v) => update(i, { field: v.toUpperCase() }), { list: id, placeholder: 'Field', disabled: ro }), datalist(id, fieldsFor(r.record)));
    }
    const svc = state.choices.services.find((s) => s.id === r.serviceId);
    return h('tr', { class: r.enabled ? '' : 'disabled-row' },
      h('td', { class: 'num' }, i + 1),
      h('td', {}, select(r.level, Object.entries(config.levels), (v) => update(i, { level: v }), ro || saved)),
      h('td', { class: 'target' }, target.length ? target : h('span', { class: 'muted' }, '—')),
      h('td', {}, select(r.event, (config.events[r.level] || []).map((e) => [e.code, e.label]), (v) => update(i, { event: v }), ro)),
      h('td', { class: 'service' },
        text(r.serviceId, (v) => update(i, { serviceId: v.toUpperCase() }), { list: 'services', placeholder: 'Service ID', disabled: ro || saved }),
        svc ? h('a', { href: '#', class: 'cls', title: 'Open the class', onclick: (e) => { e.preventDefault(); vscode.postMessage({ type: 'openClass', serviceId: r.serviceId }); } }, svc.appClass)
          : r.serviceId ? h('span', { class: 'bad' }, 'not an Application Class service') : null),
      h('td', {}, select(r.processing, Object.entries(config.processing), (v) => update(i, { processing: v }), ro)),
      h('td', {}, text(r.parameter, (v) => update(i, { parameter: v.toUpperCase() || undefined }), { placeholder: '', disabled: ro, maxlength: 254 })),
      h('td', {}, h('input', { type: 'number', min: 0, max: 999, value: r.sequence, disabled: ro, onchange: (e) => update(i, { sequence: Number(e.target.value) }) })),
      h('td', { class: 'center' }, h('input', { type: 'checkbox', checked: r.enabled, disabled: ro, onchange: (e) => update(i, { enabled: e.target.checked }) })),
      h('td', { class: 'center' },
        h('button', { title: 'Insert a row below', disabled: ro, onclick: () => edit([...state.rows.slice(0, i + 1), blankRow(), ...state.rows.slice(i + 1)]) }, '+'),
        h('button', { title: 'Delete this row (on Save)', disabled: ro, onclick: () => edit(state.rows.filter((_, j) => j !== i)) }, '−')));
  }

  const blankRow = () => ({ level: 'C', event: 'POST', serviceId: '', processing: 'POST', sequence: 1, enabled: true });

  function render() {
    if (!state) return;
    const s = state;
    app.replaceChildren(...[
      h('header', {},
        h('h1', {}, s.label),
        h('div', { class: 'sub' }, `Content reference ${s.cref} · component ${s.component.name}.${s.component.market} · ${s.connection}`,
          s.exists ? '' : ' · not configured yet')),
      h('div', { class: 'toolbar' },
        h('button', { class: 'primary', disabled: !s.editable || !s.dirty || s.problems.length > 0, onclick: () => vscode.postMessage({ type: 'save' }) }, 'Save…'),
        h('button', { disabled: !s.dirty, onclick: () => vscode.postMessage({ type: 'revert' }) }, 'Revert'),
        h('button', { disabled: !s.editable, onclick: () => edit([...s.rows, blankRow()]) }, 'Add Row'),
        h('button', { disabled: !s.editable, onclick: () => vscode.postMessage({ type: 'newService' }) }, 'New Service…'),
        h('span', { class: 'spacer' }),
        h('button', { disabled: !s.editable || !s.exists, onclick: () => vscode.postMessage({ type: 'remove' }) }, 'Remove Configuration…')),
      s.editable ? null : h('div', { class: 'note' }, 'Read only: saving needs a Writable connection with an Operator ID.'),
      h('table', {},
        h('thead', {}, h('tr', {}, ['#', 'Event Level', 'Page or Record / Field', 'Event', 'Service · Application Class', 'Processing', 'Event Map Parameter', 'Sequence', 'Enabled', ''].map((c) => h('th', {}, c)))),
        h('tbody', {}, s.rows.length ? s.rows.map(row) : h('tr', {}, h('td', { colspan: 10, class: 'muted center' }, 'No configuration rows. Add Row maps an event to a service.')))),
      datalist('pages', s.choices.pages), datalist('records', s.choices.records), datalist('services', s.choices.services.map((x) => x.id)),
      s.problems.length ? h('ul', { class: 'problems' }, s.problems.map((p) => h('li', {}, p))) : null,
      s.warnings.length ? h('ul', { class: 'warnings' }, s.warnings.map((p) => h('li', {}, p))) : null,
      h('div', { class: 'status' }, s.status),
      h('details', {}, h('summary', {}, 'How this saves'),
        h('p', {}, 'As PeopleTools\' Configure Event Mapping page: every row is re-saved on Save (Oracle\'s too, restamped with your operator), a deleted row leaves a tombstone, ' +
          'and a saved row\'s level and service cannot change — delete it and add another. Pages, records and fields offered are the component\'s own; others are accepted with a warning, ' +
          'as the page\'s Unrestricted Prompt allows. Pre runs before the delivered PeopleCode of the event, Post after it, Override instead of it.'))
    ].filter(Boolean));
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') { state = m; render(); }
    else if (m.type === 'fields') { fields.set(m.record, { onComponent: m.onComponent, all: m.all }); render(); }
  });
  vscode.postMessage({ type: 'ready' });
})();
