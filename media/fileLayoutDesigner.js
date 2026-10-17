// File Layout window (src/editors/fileLayoutDesignerPanel.ts): the layout tree and App Designer's property dialogs as a
// side panel. The document lives in the extension; every edit is posted as an operation (model/fileLayoutOperations.ts)
// and the extension sends the new state back.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let state = null;
  let sel = (vscode.getState() || {}).sel || { kind: 'layout' };
  let error = '';

  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e[k] = v;
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  };
  const post = (m) => vscode.postMessage(m);
  const select = (s) => { sel = s; vscode.setState({ sel }); error = ''; render(); };
  const segOf = (name) => state.view.segments.find((s) => s.name === name);
  const fieldOf = (seg, name) => (segOf(seg) || { fields: [] }).fields.find((f) => f.name === name);
  const ops = (...list) => { error = ''; post({ type: 'ops', ops: list }); };
  const editable = () => state && state.editable;

  // ---- toolbar ----
  function toolbar() {
    const seg = sel.kind === 'segment' || sel.kind === 'field' ? sel.segment : undefined;
    const b = (label, title, onclick, disabled) => el('button', { title, disabled: disabled || !editable(), onclick }, label);
    const del = () => {
      if (sel.kind === 'segment') { ops({ op: 'delete_segment', segment: sel.segment }); select({ kind: 'layout' }); }
      else if (sel.kind === 'field') { ops({ op: 'delete_field', segment: sel.segment, field: sel.field }); select({ kind: 'segment', segment: sel.segment }); }
    };
    const move = (by) => {
      if (sel.kind === 'segment') ops({ op: 'move_segment', segment: sel.segment, by });
      else if (sel.kind === 'field') ops({ op: 'move_field', segment: sel.segment, field: sel.field, by });
    };
    return el('div', { class: 'toolbar' },
      b('Save', 'Save (Ctrl+S)', () => post({ type: 'save' }), !state.dirty),
      b('Save As…', 'Save a copy under a new name', () => post({ type: 'saveAs' }), state.isNew),
      b('↶', 'Undo (Ctrl+Z)', () => post({ type: 'undo' }), !state.canUndo),
      b('↷', 'Redo (Ctrl+Y)', () => post({ type: 'redo' }), !state.canRedo),
      el('span', { class: 'sep' }),
      b('Insert Record…', 'Insert > Record: a segment from a record\'s fields', () => post({ type: 'insert', what: 'record', segment: seg })),
      b('Segment…', 'Insert > Segment', () => post({ type: 'insert', what: 'segment', segment: seg })),
      b('Child Segment…', 'Insert > ChildSegment under the selected segment', () => post({ type: 'insert', what: 'child', segment: seg }), !seg),
      b('File Field…', 'Insert > FileField into the selected segment', () => post({ type: 'insert', what: 'field', segment: seg, field: sel.kind === 'field' ? sel.field : undefined }), !seg),
      el('span', { class: 'sep' }),
      b('▲', 'Move up', () => move(-1), sel.kind === 'layout'),
      b('▼', 'Move down', () => move(1), sel.kind === 'layout'),
      b('Delete', 'Delete the selected segment or field (Del)', del, sel.kind === 'layout'),
      el('span', { class: 'grow' }),
      el('button', { title: 'Reload from the database', disabled: state.isNew, onclick: () => post({ type: 'reload' }) }, 'Reload'),
      b('Preview', 'What a save would write (rolled back)', () => post({ type: 'preview' }), !state.dirty),
      b('Rename…', 'Rename the File Layout', () => post({ type: 'rename' }), state.isNew),
      b('Delete Layout…', 'Delete the File Layout definition', () => post({ type: 'deleteLayout' })));
  }

  // ---- tree ----
  function tree() {
    const v = state.view;
    const depth = new Map();
    for (const s of v.segments) depth.set(s.name, s.parent ? (depth.get(s.parent) || 0) + 1 : 0);
    const row = (label, cls, s, pad, extra) => el('div', { class: `node ${cls}${JSON.stringify(s) === JSON.stringify(sel) ? ' selected' : ''}`, onclick: () => select(s) },
      el('span', { class: 'pad' }, ' '.repeat(pad)), el('span', { class: 'icon' }, cls === 'layout' ? '📄' : cls === 'segment' ? '▤' : '•'), label,
      extra ? el('span', { class: 'hint' }, extra) : null);
    const out = [row(`${v.name}`, 'layout', { kind: 'layout' }, 0, v.format)];
    for (const s of v.segments) {
      const d = depth.get(s.name) || 0;
      out.push(row(s.name, 'segment', { kind: 'segment', segment: s.name }, (d + 1) * 2, `${s.fields.length} field${s.fields.length === 1 ? '' : 's'}${s.recordId ? ` · ID ${s.recordId}` : ''}`));
      for (const f of s.fields) {
        const where = v.format === 'FIXED' ? `${f.start}-${f.start + Math.max(f.length, 1) - 1}` : `${f.length}`;
        out.push(row(f.name, 'field', { kind: 'field', segment: s.name, field: f.name }, (d + 2) * 2, `${f.type} · ${where}${f.decimals ? `, ${f.decimals} dec` : ''}`));
      }
    }
    if (!v.segments.length) out.push(el('div', { class: 'empty' }, 'No segments yet: Insert Record… builds one from a record\'s fields, Segment… an empty one.'));
    return el('div', { class: 'tree', tabIndex: 0 }, out);
  }

  // ---- property controls ----
  const text = (label, value, onchange, opts = {}) => el('label', { class: 'prop' }, el('span', null, label),
    el('input', { type: opts.number ? 'number' : 'text', value: value ?? '', maxLength: opts.max, disabled: opts.disabled || !editable(), onchange: (e) => onchange(opts.number ? Number(e.target.value) : e.target.value) }));
  const area = (label, value, onchange) => el('label', { class: 'prop wide' }, el('span', null, label),
    el('textarea', { rows: 3, value: value ?? '', disabled: !editable(), onchange: (e) => onchange(e.target.value) }));
  const check = (label, value, onchange, disabled) => el('label', { class: 'check' },
    el('input', { type: 'checkbox', checked: !!value, disabled: disabled || !editable(), onchange: (e) => onchange(e.target.checked) }), label);
  const choice = (label, value, options, onchange, disabled) => el('label', { class: 'prop' }, el('span', null, label),
    el('select', { disabled: disabled || !editable(), onchange: (e) => onchange(e.target.value) }, options.map((o) => el('option', { value: o, selected: o === value }, o))));
  const ro = (label, value) => el('div', { class: 'prop' }, el('span', null, label), el('span', { class: 'ro' }, value || ' '));

  function layoutProps() {
    const v = state.view;
    const set = (k) => (x) => ops({ op: 'set_layout', properties: { [k]: x } });
    const csv = v.format === 'CSV', xml = v.format === 'XML', fixed = v.format === 'FIXED';
    return [
      el('h3', null, 'File Layout Definition Properties'),
      el('h4', null, 'General'),
      text('Description', v.description, set('description'), { max: 30 }),
      area('Comments', v.comments, set('comments')),
      el('h4', null, 'Use'),
      ro('File Layout Name', v.name),
      choice('File Layout Format', v.format, ['FIXED', 'CSV', 'XML'], set('format')),
      text('File Definition Tag', v.definitionTag, set('definitionTag'), { disabled: !xml }),
      text('Buffer Size', v.bufferSize, set('bufferSize'), { number: true, disabled: !xml }),
      check('Imply Decimal Place', v.implyDecimal, set('implyDecimal'), !fixed),
      check('Excel Format', v.excelFormat, set('excelFormat'), !csv),
      check('Qualifier Optional', v.qualifierOptional, set('qualifierOptional'), !csv),
      check('Convert Tabs to Spaces', v.convertTabs, set('convertTabs'), !csv),
      check('Interpret Backslash', v.interpretBackslash, set('interpretBackslash'), !csv),
      check('Strip White Space', v.stripWhiteSpace, set('stripWhiteSpace'), !csv),
      choice('Embedded Strings', v.backslashQuote ? 'Backslash Quote' : 'Double Quote', ['Double Quote', 'Backslash Quote'], (x) => set('backslashQuote')(x === 'Backslash Quote'), !csv),
      csv ? ro('Definition Qualifier / Delimiter', `${v.qualifier || '(none)'}  ${v.delimiter || '(none)'}`) : null
    ];
  }

  function segmentProps() {
    const s = segOf(sel.segment);
    if (!s) return [el('div', { class: 'empty' }, 'Select a segment.')];
    const set = (k) => (x) => ops({ op: 'set_segment', segment: s.name, properties: { [k]: x } });
    const fixed = state.view.format === 'FIXED';
    const out = [
      el('h3', null, 'File Layout Segment Properties'),
      ro('File Record Name', s.name),
      text('ID Seq No', s.idSeqNo, set('idSeqNo'), { number: true }),
      text('Max Rec Length', s.maxRecordLength, set('maxRecordLength'), { number: true }),
      text('File Record ID', s.recordId, set('recordId')),
      text('ID Start Position', s.idStart, set('idStart'), { number: true, disabled: !fixed }),
      text('ID Length', s.idLength, set('idLength'), { number: true }),
      text('Default Qualifier', s.qualifier, set('qualifier'), { max: 1 }),
      text('Seg Terminator', s.terminator, set('terminator')),
      choice('Field Delimiter', ['Comma', 'Semicolon', 'Tab', 'Space', 'Other'].includes(s.delimiterType) ? s.delimiterType : 'Other', ['Comma', 'Semicolon', 'Tab', 'Space', 'Other'],
        (x) => ops({ op: 'set_segment', segment: s.name, properties: x === 'Other' ? { delimiter: 'Other', otherDelimiter: s.delimiter.trim() || '|' } : { delimiter: x } })),
      s.delimiterType === 'Other' ? text('Other delimiter', s.delimiter, (x) => ops({ op: 'set_segment', segment: s.name, properties: { otherDelimiter: x } }), { max: 1 }) : null,
      ro('Record Tag', s.tag),
      area('Record Description', s.description, set('description'))
    ];
    if (fixed && s.idLength > 0 && editable()) {
      out.push(el('button', { class: 'small', onclick: () => ops({ op: 'set_segment', segment: s.name, properties: { shiftStarts: s.idLength } }) },
        `Increment start positions for all fields by ${s.idLength}`));
    }
    if (fixed && s.fields.length) out.push(positions(s));
    return out;
  }

  /** FIXED: where each field sits, overlaps marked (App Designer saves them). */
  function positions(s) {
    const sorted = [...s.fields].sort((a, b) => a.start - b.start);
    const overlaps = new Set();
    for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].start + sorted[i - 1].length > sorted[i].start) { overlaps.add(sorted[i].name); overlaps.add(sorted[i - 1].name); }
    return el('div', { class: 'positions' }, el('h4', null, `Positions (record ends at ${s.fieldsEnd}${s.maxRecordLength && s.maxRecordLength !== s.fieldsEnd ? `; Max Rec Length ${s.maxRecordLength}` : ''})`),
      el('table', null, el('tr', null, el('th', null, 'Field'), el('th', null, 'Start'), el('th', null, 'End'), el('th', null, 'Length')),
        sorted.map((f) => el('tr', { class: overlaps.has(f.name) ? 'overlap' : '', onclick: () => select({ kind: 'field', segment: s.name, field: f.name }) },
          el('td', null, f.name), el('td', null, f.start), el('td', null, f.start + f.length - 1), el('td', null, f.length)))));
  }

  function fieldProps() {
    const f = fieldOf(sel.segment, sel.field);
    if (!f) return [el('div', { class: 'empty' }, 'Select a field.')];
    const set = (k) => (x) => {
      if (k === 'name') { ops({ op: 'set_field', segment: sel.segment, field: f.name, properties: { name: x } }); select({ kind: 'field', segment: sel.segment, field: String(x).trim().toUpperCase() }); return; }
      ops({ op: 'set_field', segment: sel.segment, field: f.name, properties: { [k]: x } });
    };
    const fixed = state.view.format === 'FIXED';
    const numeric = ['Number', 'Signed Number'].includes(f.type), date = ['Date', 'Time', 'Datetime'].includes(f.type);
    let shift = 0;
    return [
      el('h3', null, 'File Layout Field Properties'),
      ro('Segment', sel.segment),
      text('Field Name', f.name, set('name'), { max: 18 }),
      text('Start Position', f.start, set('start'), { number: true, disabled: !fixed }),
      text('Length', f.length, set('length'), { number: true }),
      choice('Field Type', f.type, ['Character', 'Number', 'Signed Number', 'Date', 'Time', 'Datetime'].concat(f.type === 'Long Character' ? ['Long Character'] : []), set('type')),
      text('Decimal', f.decimals, set('decimals'), { number: true, disabled: !numeric }),
      text('Qualifier', f.qualifier, set('qualifier'), { max: 1, disabled: fixed }),
      ro('Field Tag', f.tag),
      text('Strip Characters', f.stripCharacters, set('stripCharacters')),
      text('Default Value', f.defaultValue, set('defaultValue')),
      check('Trim Spaces', f.trimSpaces, set('trimSpaces')),
      check('Pad Field', f.padField, set('padField'), fixed),
      check('Upper Case', f.upperCase, set('upperCase'), f.type !== 'Character'),
      date ? text('Date Format', f.dateFormat, set('dateFormat')) : null,
      date ? text('Date Separator', f.dateSeparator, set('dateSeparator'), { max: 1 }) : null,
      area('Field Description', f.description, set('description')),
      fixed ? el('div', { class: 'propagate' }, el('span', null, 'Propagate'),
        el('input', { type: 'number', min: 0, value: 0, disabled: !editable(), oninput: (e) => { shift = Number(e.target.value) || 0; } }),
        el('button', { disabled: !editable(), title: 'Move this field and all after it left', onclick: () => shift && set('propagate')(-shift) }, '<<<'),
        el('button', { disabled: !editable(), title: 'Move this field and all after it right', onclick: () => shift && set('propagate')(shift) }, '>>>')) : null
    ];
  }

  function problems() {
    const list = state.problems || [];
    if (!list.length && !state.status && !error) return null;
    return el('div', { class: 'output' },
      error ? el('div', { class: 'error' }, error) : null,
      state.status ? el('div', { class: 'status' }, state.status) : null,
      list.map((p) => el('div', { class: p.severity }, `${p.severity === 'error' ? '✖' : '⚠'} ${p.path}: ${p.message}`)));
  }

  function render() {
    if (!state) { app.replaceChildren(el('div', { class: 'empty' }, 'Loading…')); return; }
    if (sel.kind === 'segment' && !segOf(sel.segment)) sel = { kind: 'layout' };
    if (sel.kind === 'field' && !fieldOf(sel.segment, sel.field)) sel = segOf(sel.segment) ? { kind: 'segment', segment: sel.segment } : { kind: 'layout' };
    const props = sel.kind === 'layout' ? layoutProps() : sel.kind === 'segment' ? segmentProps() : fieldProps();
    app.replaceChildren(
      toolbar(),
      el('div', { class: 'header' }, el('strong', null, state.view.name), ` — ${state.view.format} File Layout on ${state.connection}`,
        state.isNew ? el('span', { class: 'badge' }, 'new: Save creates it') : null, !state.editable ? el('span', { class: 'badge' }, 'read-only') : null,
        state.dirty ? el('span', { class: 'badge dirty' }, 'unsaved') : null),
      el('div', { class: 'main' }, tree(), el('div', { class: 'props' }, props)),
      problems());
  }

  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (state && state.dirty) post({ type: 'save' }); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); post({ type: 'undo' }); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); post({ type: 'redo' }); }
    else if (e.key === 'Delete' && editable() && sel.kind !== 'layout') {
      if (sel.kind === 'segment') ops({ op: 'delete_segment', segment: sel.segment }); else ops({ op: 'delete_field', segment: sel.segment, field: sel.field });
    }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') { state = m; if (m.select) { sel = m.select; vscode.setState({ sel }); } error = ''; render(); }
    else if (m.type === 'error') { error = m.message; render(); }
  });
  render();
  post({ type: 'ready' });
})();
