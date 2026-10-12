// CI Designer (src/editors/ciDesignerPanel.ts): App Designer's Component Interface window. The panel owns the document;
// this script draws the component's buffer (left) and the interface (right) and sends the window's edits as operations
// (src/model/ciOperations.ts).
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

  const TYPE = { 1: 'getkey', 2: 'createkey', 3: 'collection', 4: 'property', 5: 'findkey' };
  const KEYSET = { 1: 'GETKEYS', 2: 'CREATEKEYS', 5: 'FINDKEYS' };
  const SETOP = { 1: 'get', 2: 'create', 5: 'find' };
  const RECTYPE = { 0: 'Table', 1: 'View', 2: 'Derived', 3: 'Subrecord', 5: 'Dynamic View', 6: 'Query View', 7: 'Temporary Table' };
  const ROOT = 'PS_ROOT';

  let state = null;
  let sel = { kind: 'root' };   // { kind: 'root' | 'item' | 'keyset' | 'properties' | 'methods', item?: {type,parent,name}, set? }
  let propsTab = 'general';
  const collapsed = new Set();   // CI tree nodes closed (by id)
  const bufOpen = new Set(['search', '00-00']); // buffer nodes open
  const send = (m) => vscode.postMessage(m);
  const op = (o) => { if (state && state.editable) send({ type: 'op', op: o }); };
  const items = () => state.doc.items;
  const findItem = (r) => r && items().find((i) => i.type === r.type && i.parent === r.parent && i.name === r.name);
  const sameRef = (a, b) => a && b && a.type === b.type && a.parent === b.parent && a.name === b.name;

  // ---------------------------------------------------------------- choices
  let choiceSeq = 0; const pending = new Map(); const cache = new Map();
  function choices(what, arg) {
    const k = what + '|' + (arg || '');
    if (cache.has(k)) return Promise.resolve(cache.get(k));
    const id = ++choiceSeq; send({ type: 'choices', id, what, arg: arg || '' });
    return new Promise((resolve) => pending.set(id, (list) => { cache.set(k, list); resolve(list); }));
  }

  // ---------------------------------------------------------------- toolbar
  function toolbar() {
    const t = $('toolbar'); t.replaceChildren();
    const ed = state.editable;
    const b = (label, type, opts = {}) => el('button', { textContent: label, title: opts.title || '', class: opts.primary ? 'primary' : '', disabled: !!opts.disabled, onclick: () => send({ type }) });
    t.append(
      b('Save', 'save', { primary: true, disabled: !ed || (!state.dirty && !state.isNew), title: 'Save as App Designer saves it (Ctrl+S)' }),
      b('Undo', 'undo', { disabled: !ed || !state.canUndo }), b('Redo', 'redo', { disabled: !ed || !state.canRedo }),
      el('span', { class: 'sep' }),
      el('button', { textContent: 'Component Interface Properties', onclick: () => { sel = { kind: 'root' }; propsTab = 'general'; render(); } }),
      b('Validate', 'validate', { title: 'Validate for Consistency' }),
      b('Preview Save', 'preview', { disabled: !ed, title: 'The rows and counters a save would write' }),
      b('View PeopleCode', 'openPeopleCode', { disabled: state.isNew, title: 'Its Methods PeopleCode: the user methods are its Functions' }),
      b('Reload', 'reload', { disabled: state.isNew }),
      el('span', { class: 'sep' }),
      b('Save As…', 'saveAs', { disabled: !ed }), b('Rename…', 'rename', { disabled: !ed || state.isNew }), b('Delete', 'deleteCi', { disabled: !ed }),
      el('span', { class: 'status' + (state.statusError ? ' error' : ''), textContent: (state.dirty ? '● ' : '') + (state.status || `${state.doc.component}.${state.doc.market} on ${state.connection}${ed ? '' : ' (read-only)'}`) })
    );
  }

  // ---------------------------------------------------------------- the component's buffer (left)
  function bufferTree() {
    const v = $('buffer'); v.replaceChildren();
    const buf = state.buffer;
    const doc = state.doc;
    if (!buf) { v.append(el('div', { class: 'empty' }, `The component ${doc.component}.${doc.market} cannot be read: nothing can be dragged in.`)); return; }
    const tree = el('div', { class: 'tree' });
    const rt = (r) => RECTYPE[buf.recordTypes[r]] || 'Record';
    const node = (depth, id, label, opts = {}) => {
      const open = bufOpen.has(id);
      const row = el('div', { class: 'tnode' + (opts.cls ? ' ' + opts.cls : ''), title: opts.title || '', draggable: !!opts.drag && state.editable });
      row.style.paddingLeft = (4 + depth * 14) + 'px';
      row.append(el('span', { class: 'tw', textContent: opts.leaf ? '' : open ? '▾' : '▸', onclick: (e) => { e.stopPropagation(); if (open) bufOpen.delete(id); else bufOpen.add(id); bufferTree(); } }),
        el('span', { class: 'ic ' + (opts.icon || '') }), label);
      if (opts.drag) row.addEventListener('dragstart', (e) => { dragging = opts.drag; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', label); });
      if (opts.ondblclick) row.ondblclick = opts.ondblclick;
      if (opts.oncontextmenu) row.oncontextmenu = opts.oncontextmenu;
      tree.append(row);
      return open || opts.leaf;
    };
    node(0, 'comp', `${buf.component} (Component)`, { leaf: true, icon: 'comp', ondblclick: () => send({ type: 'openComponent' }) });
    const searchRecs = [...new Set([buf.searchRecord, buf.addSearchRecord].filter(Boolean))];
    for (const rec of searchRecs) {
      const label = `${rec} (${rt(rec)}) - ${rec === buf.searchRecord ? 'Search Record' : 'Add Search Record'}`;
      if (node(0, 'search:' + rec, label, { icon: 'rec', ondblclick: () => send({ type: 'openRecord', record: rec }) })) {
        for (const f of buf.searchFields.filter((x) => x.record === rec)) {
          node(1, '', `${f.field} (Record Field)`, { leaf: true, icon: f.searchKey ? 'key' : f.altKey ? 'altkey' : 'field', drag: { kind: 'searchField', record: rec, field: f.field },
            title: f.searchKey ? 'Search key: drag onto GETKEYS, FINDKEYS or CREATEKEYS' : f.altKey ? 'Alternate search key: drag onto FINDKEYS' : '' });
        }
      }
    }
    const scroll = (s, depth) => {
      const label = s.level === 0 ? 'Scroll - Level 0' : `Scroll - Level ${s.level}  Primary Record: ${s.record}`;
      const id = s.scrollName;
      if (!node(depth, id, label, { icon: 'scroll', cls: s.system ? 'system' : '', drag: s.level > 0 && !s.system ? { kind: 'scroll', scroll: s.scrollName } : null,
        title: s.system ? 'The Fluid system header / side page: in the buffer, not offered' : s.level > 0 ? `${s.scrollName}: drag onto PROPERTIES or its parent's collection` : '' })) return;
      for (const rec of s.records) {
        const rid = id + '|' + rec;
        const fields = s.fields.filter((f) => f.record === rec && !f.system);
        if (!fields.length) continue;
        if (node(depth + 1, rid, `${rec} (${rt(rec)})`, { icon: 'rec', ondblclick: () => send({ type: 'openRecord', record: rec }) })) {
          for (const f of fields) {
            const present = items().some((i) => i.type === 4 && i.scrollName === s.scrollName && i.record === rec && i.field.trim() === f.field);
            node(depth + 2, '', `${f.field} (Record Field)`, { leaf: true, icon: f.key ? 'key' : 'field', cls: (present ? 'present' : '') + (f.ancestorKey ? ' parentkey' : ''),
              drag: f.ancestorKey ? null : { kind: 'field', scroll: s.scrollName, record: rec, field: f.field },
              title: f.ancestorKey ? 'A key of the level above: the parent\'s' : present ? 'Already a property' : `Seq ${f.seq}: drag onto ${s.level === 0 ? 'PROPERTIES' : 'its collection'}` });
          }
        }
      }
      for (const k of s.scrolls) if (!k.system) scroll(k, depth + 1);
    };
    scroll(buf.level0, 0);
    v.append(tree);
  }

  // ---------------------------------------------------------------- the interface (right)
  let dragging = null;
  function ciTree() {
    const v = $('ci'); v.replaceChildren();
    const doc = state.doc;
    const grid = el('div', { class: 'cigrid' });
    grid.append(el('div', { class: 'cihead' }, el('span', null, 'Name'), el('span', null, 'Record'), el('span', null, 'Field'), el('span', null, 'Read Only'), el('span', null, 'Comment')));
    const row = (depth, id, label, opts = {}) => {
      const isOpen = !collapsed.has(id);
      const r = el('div', { class: 'cirow' + (opts.on ? ' sel' : '') + (opts.cls ? ' ' + opts.cls : ''), tabIndex: 0, title: opts.title || '' });
      const name = el('span', { class: 'cname' });
      name.style.paddingLeft = (4 + depth * 14) + 'px';
      name.append(el('span', { class: 'tw', textContent: opts.leaf ? '' : isOpen ? '▾' : '▸', onclick: (e) => { e.stopPropagation(); if (isOpen) collapsed.add(id); else collapsed.delete(id); ciTree(); } }),
        el('span', { class: 'ic ' + (opts.icon || '') }), label);
      r.append(name, el('span', null, opts.record || ''), el('span', null, opts.field || ''), el('span', null, opts.ro ? 'Y' : ''), el('span', null, opts.comment || ''));
      r.onclick = opts.onclick || null;
      if (opts.oncontextmenu) r.oncontextmenu = (e) => { e.preventDefault(); opts.onclick && opts.onclick(); opts.oncontextmenu(e); };
      if (opts.ondblclick) r.ondblclick = opts.ondblclick;
      if (opts.drop) {
        r.addEventListener('dragover', (e) => { if (dragging && opts.drop(dragging, true)) { e.preventDefault(); r.classList.add('drop-here'); } });
        r.addEventListener('dragleave', () => r.classList.remove('drop-here'));
        r.addEventListener('drop', (e) => { e.preventDefault(); r.classList.remove('drop-here'); if (dragging) opts.drop(dragging, false); dragging = null; });
      }
      grid.append(r);
      return isOpen || opts.leaf;
    };
    const itemCtx = (it) => (e) => contextMenu(e, { item: it });
    if (row(0, 'root', doc.name, { icon: 'ci', on: sel.kind === 'root', onclick: () => { sel = { kind: 'root' }; render(); }, oncontextmenu: (e) => contextMenu(e, {}) })) {
      // Key sets, as the window lists an interface it opens (CREATEKEYS, FINDKEYS, GETKEYS); an empty set shows when the component offers it.
      for (const t of [2, 5, 1]) {
        const keys = items().filter((i) => i.type === t);
        const offered = state.buffer && state.buffer.keys.some((k) => k.type === t);
        if (!keys.length && !offered) continue;
        const id = 'keys' + t;
        if (row(1, id, KEYSET[t], { icon: 'keyset', cls: keys.length ? '' : 'empty', on: sel.kind === 'keyset' && sel.set === t, onclick: () => { sel = { kind: 'keyset', set: t }; render(); },
          drop: (d, test) => d.kind === 'searchField' && state.buffer.keys.some((k) => k.type === t && k.field === d.field) && (test || op({ op: 'add_key', set: SETOP[t], field: d.field })) })) {
          for (const k of keys) {
            const ref = { type: k.type, parent: k.parent, name: k.name };
            row(2, '', k.name, { leaf: true, icon: 'key', record: k.record, field: k.field.trim(), on: sel.kind === 'item' && sameRef(sel.item, ref),
              onclick: () => { sel = { kind: 'item', item: ref }; render(); }, oncontextmenu: itemCtx(k) });
          }
        }
      }
      // PROPERTIES and its collections.
      const dropOn = (scrollName, collection) => (d, test) => {
        if (d.kind === 'field') { if (d.scroll !== scrollName) return false; return test || op({ op: 'add_field', scroll: d.scroll, record: d.record, field: d.field }); }
        if (d.kind === 'scroll') { const parent = d.scroll.split('-').slice(0, -2).join('-'); if (parent !== scrollName && d.scroll !== scrollName) return false; return test || op({ op: 'add_scroll', scroll: d.scroll }); }
        return false;
      };
      const node = (parent, depth) => {
        for (const it of items().filter((i) => i.parent === parent && (i.type === 3 || i.type === 4))) {
          const ref = { type: it.type, parent: it.parent, name: it.name };
          const on = sel.kind === 'item' && sameRef(sel.item, ref);
          const diag = (state.diagnostics || []).some((d) => d.path === `${it.parent}.${it.name}` && d.severity === 'error');
          if (it.type === 3) {
            if (row(depth, 'c:' + it.name, it.name, { icon: 'coll', record: it.record, on, cls: diag ? 'error' : '', title: `${it.scrollName} (level ${it.level})`,
              onclick: () => { sel = { kind: 'item', item: ref }; propsTab = 'item'; render(); }, oncontextmenu: itemCtx(it), drop: dropOn(it.scrollName, it.name) })) node(it.name, depth + 1);
          } else {
            row(depth, '', it.name, { leaf: true, icon: it.key ? 'key' : 'prop', record: it.record, field: it.field.trim(), ro: it.readOnly, comment: it.comment.trim(), on, cls: diag ? 'error' : '',
              title: `Seq ${it.seq} -- ${it.scrollName}`, onclick: () => { sel = { kind: 'item', item: ref }; propsTab = 'item'; render(); }, oncontextmenu: itemCtx(it),
              ondblclick: () => send({ type: 'openRecord', record: it.record }) });
          }
        }
      };
      if (row(1, 'props', 'PROPERTIES', { icon: 'props', on: sel.kind === 'properties', onclick: () => { sel = { kind: 'properties' }; render(); }, drop: dropOn('00-00', ROOT) })) node(ROOT, 2);
      // METHODS: the user methods (its PeopleCode's Functions) first, then the standard methods it has.
      if (row(1, 'methods', 'METHODS', { icon: 'props', on: sel.kind === 'methods', onclick: () => { sel = { kind: 'methods' }; render(); }, ondblclick: () => send({ type: 'openPeopleCode' }),
        oncontextmenu: (e) => contextMenu(e, { methods: true }) })) {
        for (const m of state.userMethods || []) row(2, '', m, { leaf: true, icon: 'method user', ondblclick: () => send({ type: 'openPeopleCode' }), title: 'A user method: a Function of its Methods PeopleCode' });
        for (const [m, bit] of Object.entries(config.methods)) if (doc.methods & bit) row(2, '', m, { leaf: true, icon: 'method', onclick: () => { sel = { kind: 'root' }; propsTab = 'methods'; render(); } });
      }
    }
    v.append(grid);
  }

  // ---------------------------------------------------------------- context menu (App Designer's)
  function contextMenu(e, target) {
    const m = $('menu'); m.replaceChildren();
    const ed = state.editable;
    const it = target.item;
    const add = (label, enabled, fn, key) => m.append(el('div', { class: 'mi' + (enabled ? '' : ' off'), onclick: () => { hide(); fn(); } }, label, key ? el('span', { class: 'key' }, key) : null));
    const sepr = () => m.append(el('div', { class: 'ms' }));
    add('View Definition', !!(it && it.type === 4), () => send({ type: 'openRecord', record: it.record }), 'Ctrl+D');
    add('View PeopleCode', !state.isNew, () => send({ type: 'openPeopleCode' }), 'Ctrl+E');
    sepr();
    add('Edit Property', !!it, () => { sel = { kind: 'item', item: { type: it.type, parent: it.parent, name: it.name } }; propsTab = 'item'; render(); });
    add('Edit Reference', false, () => {}); add('Create Reference', false, () => {});
    add('Toggle Read Only Access', ed && !!it && it.type !== 3, () => op({ op: 'set_item', type: TYPE[it.type], parent: it.parent, name: it.name, readOnly: !it.readOnly }));
    add('Delete', ed && !!it, () => send({ type: 'delete', itemType: TYPE[it.type], parent: it.parent, name: it.name }));
    sepr();
    add('Component Interface Properties', true, () => { sel = { kind: 'root' }; propsTab = 'general'; render(); });
    sepr();
    add('Validate for Consistency', true, () => send({ type: 'validate' }));
    m.hidden = false;
    m.style.left = Math.min(e.clientX, window.innerWidth - 260) + 'px'; m.style.top = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 8) + 'px';
    function hide() { m.hidden = true; }
    setTimeout(() => document.addEventListener('click', hide, { once: true }), 0);
  }

  // ---------------------------------------------------------------- properties
  const field = (label, control, hint) => el('label', { class: 'row', title: hint || '' }, el('span', null, label), control);
  const check = (label, on, onchange, disabled) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!on, disabled: !!disabled || !state.editable, onchange: (e) => onchange(e.target.checked) }), label);
  const text = (value, onchange, opts = {}) => el('input', { type: opts.number ? 'number' : 'text', value: value ?? '', maxLength: opts.max || 254, disabled: !!opts.disabled || !state.editable,
    onchange: (e) => onchange(opts.upper ? e.target.value.trim().toUpperCase() : e.target.value) });
  const radio = (name, label, on, onchange, disabled) => el('label', { class: 'check' }, el('input', { type: 'radio', name, checked: !!on, disabled: !!disabled || !state.editable, onchange }), label);

  function props() {
    const p = $('props'); p.replaceChildren();
    const it = sel.kind === 'item' ? findItem(sel.item) : null;
    if (it) return editProperty(p, it);
    if (sel.kind === 'keyset') return keySetHelp(p);
    if (sel.kind === 'properties') return p.append(el('h2', null, 'PROPERTIES'), el('div', { class: 'hint' }, 'Drag a record field from the left onto PROPERTIES (level 0) or its scroll\'s collection; drag a scroll to add its collection with all its fields (merged into its collection when it has one).'));
    if (sel.kind === 'methods') return p.append(el('h2', null, 'METHODS'), el('div', { class: 'hint' }, 'The standard methods are set in Component Interface Properties; the user methods are the Functions of its Methods PeopleCode (View PeopleCode).'),
      el('button', { textContent: 'View PeopleCode', disabled: state.isNew, onclick: () => send({ type: 'openPeopleCode' }) }));
    ciProperties(p);
  }

  // Component Interface Properties: General (Component, Market, Description, Menu Name, Comments, Owner ID, Last Updated),
  // Standard Methods, Synchronization [ci05-ci10].
  function ciProperties(p) {
    const d = state.doc;
    p.append(el('h2', null, 'Properties'), el('div', { class: 'sub' }, d.name));
    const tabs = el('div', { class: 'ptabs' });
    for (const [k, l] of [['general', 'General'], ['methods', 'Standard Methods'], ['sync', 'Synchronization']]) tabs.append(el('button', { class: propsTab === k ? 'on' : '', textContent: l, onclick: () => { propsTab = k; render(); } }));
    p.append(tabs);
    if (propsTab === 'methods') {
      const canAdd = state.buffer ? (state.buffer.actions & 1) === 1 : (d.methods & 2) === 2;
      for (const [m, bit] of Object.entries(config.methods)) {
        p.append(check(m, d.methods & bit, (on) => op({ op: 'set_methods', methods: { [m]: on } }), m === 'Create' && !canAdd));
      }
      p.append(el('div', { class: 'hint' }, 'Create is greyed on a component that cannot Add. Taking a method away also removes permission lists\' grants of it.'));
      return;
    }
    if (propsTab === 'sync') {
      const s = d.sync;
      const set = (patch) => op({ op: 'set_sync', synchronizable: true, ...patch });
      p.append(check('Synchronizable', !!s, (on) => op({ op: 'set_sync', synchronizable: on })));
      const conflictNames = Object.keys(config.conflict);
      p.append(el('fieldset', null, el('legend', null, 'Conflict Resolution'),
        ...conflictNames.map((n) => radio('conflict', n, s && s.conflict === config.conflict[n], () => set({ conflict: n }), !s))));
      p.append(el('fieldset', null, el('legend', null, 'Application Messages'),
        field('Message Set Number', text(s ? String(s.messageSet || '') : '', (v) => set({ messageSet: Number(v) || 0 }), { number: true, disabled: !s }))));
      const uploads = { Yes: 'Yes', 'No, restore server values at synchronization time': 'No, restore server values', 'No, retain current device values': 'No, retain device values' };
      p.append(el('fieldset', null, el('legend', null, 'Upload changes from mobile device?'),
        ...Object.entries(uploads).map(([label, value]) => radio('upload', label, s && s.upload === config.upload[label], () => set({ upload: value }), !s))));
      const proj = text(s ? (s.relatedProject || '').trim() : '', (v) => set({ relatedProject: v }), { upper: true, disabled: !s, max: 30 });
      proj.setAttribute('list', 'projects');
      const dl = el('datalist', { id: 'projects' }); choices('projects').then((list) => { for (const x of list) dl.append(el('option', { value: x.value, label: x.label || '' })); });
      p.append(field('Related Content Project', proj), dl);
      return;
    }
    p.append(field('Component', el('a', { href: '#', textContent: d.component, onclick: (e) => { e.preventDefault(); send({ type: 'openComponent' }); } })));
    p.append(field('Market', el('span', null, d.market)));
    p.append(field('Description', text((d.description || '').trim(), (v) => op({ op: 'set_interface', description: v }), { max: 30 })));
    const menus = el('select', { disabled: !state.editable, onchange: (e) => op({ op: 'set_interface', menu: e.target.value }) }, el('option', { value: ' ', textContent: '' }));
    choices('menus', `${d.component}.${d.market}`).then((list) => {
      for (const x of list) menus.append(el('option', { value: x.value, textContent: x.value, selected: x.value === d.menu.trim() }));
      if (d.menu.trim() && !list.some((x) => x.value === d.menu.trim())) menus.append(el('option', { value: d.menu.trim(), textContent: d.menu.trim(), selected: true }));
    });
    p.append(field('Menu Name', menus, 'A menu with an item for the component'));
    p.append(el('div', null, 'Comments'), el('textarea', { rows: 5, value: d.comments || '', disabled: !state.editable, onchange: (e) => op({ op: 'set_interface', comments: e.target.value }) }));
    const owners = el('select', { disabled: !state.editable, onchange: (e) => op({ op: 'set_interface', owner: e.target.value }) }, el('option', { value: ' ', textContent: '' }));
    choices('owners').then((list) => { for (const x of list) owners.append(el('option', { value: x.value, textContent: x.label || x.value, selected: x.value === d.owner.trim() })); });
    p.append(field('Owner ID', owners));
    diagnostics(p, () => true);
  }

  // Edit Property: Name, Comment, Read Only Access (Record and Field shown) [ci11, ci12]; a collection's Name.
  function editProperty(p, it) {
    const t = TYPE[it.type];
    const set = (patch) => op({ op: 'set_item', type: t, parent: it.parent, name: it.name, ...patch });
    p.append(el('h2', null, it.type === 3 ? 'Edit Collection' : it.type === 4 ? 'Edit Property' : `Edit ${KEYSET[it.type]} key`));
    p.append(field('Name', text(it.name, (v) => { sel = { kind: 'item', item: { type: it.type, parent: it.parent, name: v.trim().toUpperCase() } }; set({ newName: v }); }, { upper: true, max: 30 })));
    p.append(field('Record', el('a', { href: '#', textContent: it.record, onclick: (e) => { e.preventDefault(); send({ type: 'openRecord', record: it.record }); } })));
    if (it.type !== 3) {
      p.append(field('Field', el('span', null, it.field.trim())));
      p.append(field('Comment', text(it.comment.trim(), (v) => set({ comment: v }), { max: 30 })));
      p.append(check('Read Only Access', it.readOnly, (on) => set({ readOnly: on })));
    }
    p.append(el('div', { class: 'hint' }, `Seq ${it.seq} -- scroll ${it.scrollName} (level ${it.level})${it.syncId ? ` -- SYNCID ${it.syncId}` : ' -- the save gives it a SYNCID'}`));
    if (state.editable) p.append(el('button', { textContent: 'Delete', onclick: () => send({ type: 'delete', itemType: t, parent: it.parent, name: it.name }) }));
    diagnostics(p, (x) => x.path === `${it.parent}.${it.name}`);
  }

  function keySetHelp(p) {
    const t = sel.set;
    p.append(el('h2', null, KEYSET[t]));
    const offered = (state.buffer ? state.buffer.keys.filter((k) => k.type === t) : []).map((k) => k.field);
    p.append(el('div', { class: 'hint' }, t === 1 ? 'Get keys: the search record\'s search keys.' : t === 5 ? 'Find keys: the search record\'s search and alternate search keys.' : 'Create keys: the add search record\'s search keys (a component that can Add).'));
    for (const f of offered) {
      const present = items().some((i) => i.type === t && i.field.trim() === f);
      p.append(el('div', { class: 'row' }, el('span', null, f), present ? el('span', { class: 'muted' }, 'present')
        : el('button', { textContent: 'Add', disabled: !state.editable, onclick: () => op({ op: 'add_key', set: SETOP[t], field: f }) })));
    }
  }

  function diagnostics(p, filter) {
    const list = (state.diagnostics || []).filter(filter);
    if (list.length) p.append(el('div', { class: 'diags' }, list.map((x) => el('div', { class: 'diag ' + x.severity }, `${x.severity}: ${x.message}`))));
  }

  function output() {
    const o = $('output'); o.replaceChildren();
    const list = state.diagnostics || [];
    if (!list.length) return;
    o.append(el('div', { class: 'head' }, `${list.filter((d) => d.severity === 'error').length} errors, ${list.filter((d) => d.severity === 'warning').length} warnings`));
    for (const d of list) o.append(el('div', { class: 'diag ' + d.severity }, el('span', { class: 'sev' }, d.severity), `${d.path}: ${d.message}`));
  }

  function render() {
    if (!state) return;
    if (sel.kind === 'item' && !findItem(sel.item)) sel = { kind: 'root' };
    toolbar(); bufferTree(); ciTree(); props(); output();
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') { state = { ...m, statusError: false }; render(); }
    else if (m.type === 'choices') { const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m.items); } }
    else if (m.type === 'error') { if (state) { state.status = m.message; state.statusError = true; toolbar(); } }
    else if (m.type === 'preview') {
      if (!state) return;
      const inc = Object.entries(m.increments).filter(([, d]) => d).map(([n, d]) => `${n} +${d}`).join(', ');
      state.status = m.empty ? 'Nothing to save.' : `A save writes: ${m.summary.changes.join('; ') || 'the interface row'}${inc ? ' -- ' + inc : ''}${m.summary.renamedOnSave.length ? ' -- names stored: ' + m.summary.renamedOnSave.join(', ') : ''}`;
      state.statusError = false; toolbar();
    }
  });

  document.addEventListener('dragend', () => { dragging = null; });
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.target.blur(); setTimeout(() => send({ type: 'save' }), 0); }
      return;
    }
    const k = e.key.toLowerCase();
    const it = sel.kind === 'item' ? findItem(sel.item) : null;
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); send({ type: 'save' }); }
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); send({ type: e.shiftKey ? 'redo' : 'undo' }); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); send({ type: 'redo' }); }
    else if ((e.ctrlKey || e.metaKey) && k === 'e') { e.preventDefault(); send({ type: 'openPeopleCode' }); }
    else if ((e.ctrlKey || e.metaKey) && k === 'd' && it && it.type === 4) { e.preventDefault(); send({ type: 'openRecord', record: it.record }); }
    else if (k === 'delete' && it && state.editable) send({ type: 'delete', itemType: TYPE[it.type], parent: it.parent, name: it.name });
  });

  // The splitters.
  const splitter = (id, target, side) => {
    const sp = $(id), pane = $(target); let x0 = 0, w0 = 0;
    const move = (e) => { pane.style.width = Math.max(200, Math.min(window.innerWidth - 300, w0 + side * (e.clientX - x0))) + 'px'; };
    sp.addEventListener('mousedown', (e) => { x0 = e.clientX; w0 = pane.offsetWidth; document.addEventListener('mousemove', move); document.addEventListener('mouseup', () => document.removeEventListener('mousemove', move), { once: true }); });
  };
  splitter('splitter1', 'buffer', 1);
  splitter('splitter', 'props', -1);

  send({ type: 'ready' });
})();
