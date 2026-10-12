// Menu Designer (src/editors/menuDesignerPanel.ts): App Designer's menu window. The panel owns the document; this
// script draws it and sends operations (model/menuSession.ts MenuOp) and requests.
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

  let state = null;          // the panel's last 'state' message
  let sel = {};              // { bar, item } -- or {} for the menu itself
  let openBar = null;        // the standard menu's bar whose items show
  let propsTab = 'general';
  const POPUP_BAR = 'MENUITEM1';
  const send = (m) => vscode.postMessage(m);
  const op = (o, select) => { if (!state || !state.editable) return; send({ type: 'op', op: o, ...(select ? { select } : {}) }); };
  const popup = () => state && state.doc.type === 1;
  const barOf = (name) => state.doc.bars.find((b) => b.name === name);
  const itemOf = (ref) => { const b = ref && barOf(ref.bar); return b && b.items.find((i) => i.name === ref.item); };

  // "&Use" shows U underlined, "&&" an ampersand (App Designer's mnemonic labels).
  function mnemonic(text) {
    const span = el('span');
    const t = text || '';
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '&' && t[i + 1] === '&') { span.append('&'); i++; continue; }
      if (t[i] === '&' && i + 1 < t.length) { span.append(el('u', null, t[i + 1])); i++; continue; }
      span.append(t[i]);
    }
    if (!t.trim()) span.append(' ');
    return span;
  }

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
      b('Save', 'save', { primary: true, disabled: !ed || (!state.dirty && !state.isNew), title: 'Save the menu as App Designer saves it (Ctrl+S)' }),
      b('Undo', 'undo', { disabled: !ed || !state.canUndo }), b('Redo', 'redo', { disabled: !ed || !state.canRedo }),
      el('span', { class: 'sep' }),
      el('button', { textContent: 'Menu Properties', onclick: () => { sel = {}; propsTab = 'general'; render(); } }),
      b('Validate', 'validate', { title: 'App Designer\'s checks, the components, records and transfer menus named, and the PeopleCode compiled' }),
      b('Preview Save', 'preview', { disabled: !ed, title: 'The rows and counters a save would write' }),
      b('Reload', 'reload', { disabled: state.isNew }),
      el('span', { class: 'sep' }),
      b('Save As…', 'saveAs', { disabled: !ed }), b('Rename…', 'rename', { disabled: !ed || state.isNew }), b('Delete Menu', 'deleteMenu', { disabled: !ed }),
      el('span', { class: 'status' + (state.statusError ? ' error' : ''), textContent: (state.dirty ? '● ' : '') + (state.status || `${config.menuTypes[state.doc.type]} menu on ${state.connection}${ed ? '' : ' (read-only)'}`) })
    );
  }

  // ---------------------------------------------------------------- the menu, as App Designer draws it
  function view() {
    const v = $('view'); v.replaceChildren();
    const doc = state.doc;
    const canvas = el('div', { class: 'mcanvas' });
    v.append(canvas);
    if (popup()) {
      canvas.append(dropdown(barOf(POPUP_BAR) || { name: POPUP_BAR, items: [] }, true));
      return;
    }
    const bar = el('div', { class: 'menubar' });
    for (const b of doc.bars) {
      const head = el('span', { class: 'bar' + (sel.bar === b.name && !sel.item ? ' sel' : '') + (openBar === b.name ? ' open' : ''), draggable: state.editable, tabIndex: 0,
        dataset: { bar: b.name }, title: `${b.name}${b.items.length ? '' : ' -- no items: not stored'}`,
        onclick: () => { openBar = openBar === b.name && sel.bar === b.name && !sel.item ? null : b.name; sel = { bar: b.name }; propsTab = 'bar'; render(); },
        oncontextmenu: (e) => { e.preventDefault(); sel = { bar: b.name }; openBar = b.name; render(); contextMenu(e, { bar: b.name }); } }, mnemonic(b.label || b.name));
      dragBar(head, b.name);
      bar.append(head);
    }
    // The dashed bar slot: Bar Item Properties on it adds a bar [mb01].
    bar.append(el('span', { class: 'bar slot', title: 'New bar (Bar Item Properties)', onclick: () => newBar(), oncontextmenu: (e) => { e.preventDefault(); contextMenu(e, { slot: 'bar' }); } }, '    '));
    canvas.append(bar);
    const ob = openBar && barOf(openBar);
    if (ob) {
      const dd = dropdown(ob, false);
      canvas.append(dd);
      const head = bar.querySelector(`.bar[data-bar="${CSS.escape(ob.name)}"]`);
      if (head) dd.style.marginLeft = (head.offsetLeft - bar.offsetLeft) + 'px';
    }
    if (!doc.bars.length) canvas.append(el('div', { class: 'empty' }, 'A new menu: click the dashed box to add its first bar (App Designer saves a menu once it has a bar with an item).'));
  }

  function dropdown(b, isPopup) {
    const list = el('div', { class: 'drop' + (isPopup ? ' popup' : '') });
    b.items.forEach((it, index) => {
      const ref = { bar: b.name, item: it.name };
      const on = sel.bar === b.name && sel.item === it.name;
      const diag = (state.diagnostics || []).filter((d) => d.at && d.at.bar === b.name && d.at.item === it.name);
      const sev = diag.some((d) => d.severity === 'error') ? 'error' : diag.some((d) => d.severity === 'warning') ? 'warning' : '';
      const row = it.type === 8
        ? el('div', { class: 'mitem sep' + (on ? ' sel' : ''), title: `${it.name} (separator)` }, el('hr'))
        : el('div', { class: 'mitem' + (on ? ' sel' : '') + (sev ? ' ' + sev : ''), title: `${it.name} -- ${config.itemTypes[it.type]}${it.component ? ': ' + it.component + '.' + (it.market || 'GBL') : ''}${it.transfer && it.transfer.menu ? ' -> ' + it.transfer.menu : ''}` },
          mnemonic(it.label), el('span', { class: 'kind' }, it.type === 9 ? 'ƒ' : it.type === 12 ? '→' : ''));
      Object.assign(row.dataset, { bar: b.name, item: it.name, index: String(index) });
      row.tabIndex = 0;
      row.draggable = state.editable;
      row.onclick = () => { sel = ref; openBar = isPopup ? null : b.name; propsTab = 'item'; render(); };
      row.ondblclick = () => { if (it.type === 9) send({ type: 'openPeopleCode', ref }); };
      row.oncontextmenu = (e) => { e.preventDefault(); sel = ref; render(); contextMenu(e, ref); };
      dragItem(row, b.name, index);
      list.append(row);
    });
    // The dashed item slot: Menu Item Properties on it adds an item [mi01, mi04, mp01].
    const slot = el('div', { class: 'mitem slot', title: 'New item (Menu Item Properties)', onclick: () => newItem(b.name),
      oncontextmenu: (e) => { e.preventDefault(); contextMenu(e, { slot: 'item', bar: b.name }); } }, ' ');
    slot.dataset.bar = b.name; slot.dataset.index = String(b.items.length);
    dragItem(slot, b.name, b.items.length, true);
    list.append(slot);
    return list;
  }

  function newBar() {
    if (!state.editable) return;
    op({ kind: 'insertBar' });
    propsTab = 'bar';
  }
  function newItem(bar) {
    if (!state.editable) return;
    op({ kind: 'insertItem', bar, item: { type: popup() ? 9 : 5 } });
    propsTab = 'item';
  }

  // Drag an item within its bar (App Designer's drag; another bar takes Cut / Paste) [mi07]; a bar along the menu bar [mb06].
  let dragging = null;
  function dragItem(row, bar, index, slotOnly) {
    if (!slotOnly) row.addEventListener('dragstart', (e) => { dragging = { kind: 'item', bar, item: row.dataset.item }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.item); });
    row.addEventListener('dragover', (e) => { if (dragging && dragging.kind === 'item' && dragging.bar === bar) { e.preventDefault(); row.classList.add('drop-here'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drop-here'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drop-here');
      if (!dragging || dragging.kind !== 'item' || dragging.bar !== bar) return;
      const from = barOf(bar).items.findIndex((i) => i.name === dragging.item);
      const to = index > from ? index - 1 : index;
      if (from !== to) op({ kind: 'moveItem', ref: { bar, item: dragging.item }, bar, index: to });
      dragging = null;
    });
  }
  function dragBar(head, name) {
    head.addEventListener('dragstart', (e) => { dragging = { kind: 'bar', bar: name }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', name); });
    head.addEventListener('dragover', (e) => { if (dragging && dragging.kind === 'bar') { e.preventDefault(); head.classList.add('drop-here'); } });
    head.addEventListener('dragleave', () => head.classList.remove('drop-here'));
    head.addEventListener('drop', (e) => {
      e.preventDefault(); head.classList.remove('drop-here');
      if (!dragging || dragging.kind !== 'bar' || dragging.bar === name) return;
      const to = state.doc.bars.findIndex((b) => b.name === name);
      op({ kind: 'moveBar', bar: dragging.bar, index: to });
      dragging = null;
    });
  }

  // ---------------------------------------------------------------- context menu (App Designer's)
  function contextMenu(e, target) {
    const m = $('menu'); m.replaceChildren();
    const it = target.item ? itemOf(target) : null;
    const ed = state.editable;
    const add = (label, enabled, fn) => m.append(el('div', { class: 'mi' + (enabled ? '' : ' off'), textContent: label, onclick: () => { hide(); fn(); } }));
    const sepr = () => m.append(el('div', { class: 'ms' }));
    add('View Definition', !!(it && it.component && (it.type === 5 || it.type === 9)), () => send({ type: 'openComponent', component: it.component, market: it.market }));
    add('View PeopleCode', !!(it && it.type === 9), () => send({ type: 'openPeopleCode', ref: target }));
    sepr();
    add('Cut', ed && !!it, () => send({ type: 'cut', ref: target }));
    add('Copy', !!it, () => send({ type: 'copy', ref: target }));
    add('Paste', ed && !!state.clipboard && (!!it || target.slot === 'item'), () => {
      const b = barOf(target.bar);
      send({ type: 'paste', bar: target.bar, index: it ? b.items.findIndex((x) => x.name === it.name) : b.items.length });
    });
    add('Delete', ed && (!!it || (!!target.bar && !target.slot)), () => send({ type: 'delete', ref: it ? target : { bar: target.bar } }));
    sepr();
    add('Menu Properties', true, () => { sel = {}; propsTab = 'general'; render(); });
    if (!popup() && (target.slot === 'bar' || (target.bar && !target.item && !target.slot))) add('Bar Item Properties', true, () => { if (target.slot === 'bar') newBar(); else { sel = { bar: target.bar }; propsTab = 'bar'; render(); } });
    else add(popup() ? 'Item Properties' : 'Menu Item Properties', !!it || target.slot === 'item', () => { if (target.slot === 'item') newItem(target.bar); else { sel = target; propsTab = 'item'; render(); } });
    sepr();
    add('Register Menu Item …', false, () => {});
    m.hidden = false;
    m.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px'; m.style.top = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 8) + 'px';
    function hide() { m.hidden = true; }
    setTimeout(() => document.addEventListener('click', hide, { once: true }), 0);
  }

  // ---------------------------------------------------------------- properties
  const field = (label, control, hint) => el('label', { class: 'row', title: hint || '' }, el('span', null, label), control);
  const check = (label, on, onchange, disabled) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!on, disabled: !!disabled || !state.editable, onchange: (e) => onchange(e.target.checked) }), label);
  const text = (value, onchange, opts = {}) => el('input', { type: opts.number ? 'number' : 'text', value: value ?? '', maxLength: opts.max || 254, disabled: !!opts.disabled || !state.editable,
    onchange: (e) => onchange(opts.upper ? e.target.value.trim().toUpperCase() : e.target.value), ...(opts.list ? { list: opts.list } : {}) });
  function datalist(id, what, arg) {
    const dl = el('datalist', { id });
    choices(what, arg).then((items) => { for (const x of items) dl.append(el('option', { value: x.value, label: x.label || '' })); });
    return dl;
  }
  function select(options, value, onchange, disabled) {
    const s = el('select', { disabled: !!disabled || !state.editable, onchange: (e) => onchange(e.target.value) });
    for (const [v, l] of options) s.append(el('option', { value: v, textContent: l, selected: String(v) === String(value) }));
    return s;
  }

  function props() {
    const p = $('props'); p.replaceChildren();
    const it = sel.item ? itemOf(sel) : null;
    const b = sel.bar && !sel.item ? barOf(sel.bar) : null;
    if (it) return itemProps(p, it);
    if (b && !popup()) return barProps(p, b);
    menuProps(p);
  }

  // Menu Properties: General (Description, Comments, Owner ID) and Use (Menu Label; a standard menu's group, orders,
  // separators and Menu installed) [mn02-mn11, mn13, mn14, mp11].
  function menuProps(p) {
    const d = state.doc;
    const set = (patch) => op({ kind: 'setMenu', patch });
    p.append(el('h2', null, 'Menu Properties'), el('div', { class: 'sub' }, `${d.name} -- ${config.menuTypes[d.type]}`));
    const tabs = el('div', { class: 'ptabs' });
    for (const [k, l] of [['general', 'General'], ['use', 'Use']]) tabs.append(el('button', { class: propsTab === k ? 'on' : '', textContent: l, onclick: () => { propsTab = k; render(); } }));
    p.append(tabs);
    if (propsTab !== 'use') {
      p.append(field('Menu Type', el('span', null, config.menuTypes[d.type])));
      p.append(field('Description', text(d.descr, (v) => set({ descr: v }), { max: config.max.descr })));
      p.append(el('div', null, 'Comments'), el('textarea', { rows: 6, value: d.descrlong || '', disabled: !state.editable, onchange: (e) => set({ descrlong: e.target.value }) }));
      const owners = select([['', '']], d.owner, (v) => set({ owner: v }));
      choices('owners').then((items) => { for (const x of items) owners.append(el('option', { value: x.value, textContent: x.label || x.value, selected: x.value === d.owner })); });
      p.append(field('Owner ID', owners));
      p.append(el('fieldset', null, el('legend', null, 'Last Updated'),
        field('Date/Time', el('span', null, d.lastUpdated || '')), field('By User', el('span', null, d.lastUpdatedBy || ''))));
    } else {
      p.append(field('Menu Label', text(d.label, (v) => set({ label: v }), { max: config.max.menuLabel })));
      if (d.type === 0) {
        p.append(el('fieldset', null, el('legend', null, 'Menu Group'),
          field('Group', text(d.group, (v) => set({ group: v }), { max: config.max.group, list: 'groups' })),
          (() => { const dl = el('datalist', { id: 'groups' }); for (const g of state.groups || []) dl.append(el('option', { value: g.value, label: String(g.order) })); return dl; })()));
        const orderBox = (legend, value, sep, key, sepKey) => {
          const alpha = value === config.alphabetical;
          return el('fieldset', null, el('legend', null, legend),
            field('Sequence #', text(alpha ? '' : String(value), (v) => set({ [key]: Number(v) || 0 }), { number: true, disabled: alpha })),
            check('Alphabetical order', alpha, (on) => set({ [key]: on ? config.alphabetical : 0 })),
            check('Add separator after', sep, (on) => set({ [sepKey]: on })));
        };
        p.append(orderBox('Menu Order', d.menuOrder, d.menuSeparator, 'menuOrder', 'menuSeparator'));
        p.append(orderBox('Menu Group Order', d.groupOrder, d.groupSeparator, 'groupOrder', 'groupSeparator'));
        p.append(el('div', { class: 'hint' }, 'The group\'s order and separator are the group\'s: saving them writes every menu of the group.'));
        p.append(check('Menu installed', d.installed, (on) => set({ installed: on })));
      }
    }
    diagnostics(p, (x) => !x.at || (!x.at.bar && !x.at.item));
  }

  // Bar Item Properties: Name (a rename: every item's key moves) and Label [mb02, mb05].
  function barProps(p, b) {
    p.append(el('h2', null, 'Bar Item Properties'));
    p.append(field('Name', text(b.name, (v) => op({ kind: 'setBar', bar: b.name, name: v }), { max: config.max.barName, upper: true })));
    p.append(field('Label', text(b.label, (v) => op({ kind: 'setBar', bar: b.name, label: v }), { max: config.max.barLabel })));
    if (b.origin && b.origin !== b.name) p.append(el('div', { class: 'hint' }, `Renamed from ${b.origin}: the save moves its items, their PeopleCode and permission-list items.`));
    p.append(el('div', { class: 'hint' }, '& before a letter makes it the mnemonic. A bar is stored only through its items.'));
    diagnostics(p, (x) => x.at && x.at.bar === b.name && !x.at.item);
  }

  // Menu Item Properties: Name, Label, Type, the component (or a PeopleCode item's enabling component) with Search Rec
  // Override; a popup's Transfer with Transfer Properties [mi01-mi05, mp01-mp08].
  function itemProps(p, it) {
    const ref = { bar: sel.bar, item: sel.item };
    const set = (item) => op({ kind: 'setItem', ref, item }, item.name ? { bar: ref.bar, item: item.name.trim().toUpperCase() } : undefined);
    p.append(el('h2', null, popup() ? 'Menu Item Properties' : 'Menu Item Properties'));
    const sep = it.type === 8;
    p.append(el('fieldset', null, el('legend', null, 'Menu Item'),
      field('Name', text(it.name, (v) => set({ name: v }), { max: config.max.itemName, upper: true, disabled: sep })),
      field('Label', text(it.label, (v) => set({ label: v }), { max: config.max.itemLabel, disabled: sep }))));
    const types = el('fieldset', null, el('legend', null, 'Type'));
    for (const t of config.typesByMenu[state.doc.type]) {
      types.append(el('label', { class: 'check' }, el('input', { type: 'radio', name: 'itype', checked: it.type === t, disabled: !state.editable, onchange: () => set({ type: t }) }), config.itemTypes[t]));
    }
    p.append(types);
    if (it.type === 5 || it.type === 9) {
      const box = el('fieldset', null, el('legend', null, it.type === 9 ? 'Enabling Component' : 'Component'),
        field('Name', text(it.component, (v) => set({ component: v }), { max: config.max.component, upper: true, list: 'components' }), 'A component (PSPNLGRPDEFN); type to search'),
        datalist('components', 'components', it.component.slice(0, 3)),
        field('Market', text(it.market, (v) => set({ market: v }), { max: 3, upper: true })));
      if (it.type === 5) {
        const over = !!it.searchRecord;
        box.append(check('Search Rec Override', over, (on) => set({ searchRecord: on ? (it.searchRecord || '') : '' })),
          field('Search Record', text(it.searchRecord, (v) => set({ searchRecord: v }), { max: config.max.searchRecord, upper: true, list: 'records' }), 'Override the component\'s search record'),
          datalist('records', 'records', (it.searchRecord || '').slice(0, 3)));
      }
      if (it.component) box.append(el('button', { textContent: 'View Definition', onclick: () => send({ type: 'openComponent', component: it.component, market: it.market }) }));
      p.append(box);
    }
    if (it.type === 9) p.append(el('button', { textContent: 'View PeopleCode (ItemSelected)', onclick: () => send({ type: 'openPeopleCode', ref }) }),
      el('div', { class: 'hint' }, (it.peopleCode || '').trim() ? `${(it.peopleCode || '').split('\n').length} lines` : 'No PeopleCode yet: selecting the item does nothing.'));
    if (it.type === 12) transferProps(p, it, set);
    if (it.origin && (it.origin.item !== it.name || it.origin.bar !== ref.bar)) p.append(el('div', { class: 'hint' }, `Was ${it.origin.bar}.${it.origin.item}: App Designer saves a rename at once (43,27); the save moves its PeopleCode and permission-list items.`));
    diagnostics(p, (x) => x.at && x.at.bar === ref.bar && x.at.item === ref.item);
  }

  // Transfer Properties: Portal (Use Current), Node (LOCAL), Menu, Component, Market, Component Item, Action, Transfer
  // Type, Use data from current page. A field clears those that follow it, as the dialog's lists do [mp07].
  function transferProps(p, it, set) {
    const x = it.transfer || {};
    const tset = (patch) => set({ transfer: patch });
    const fs = el('fieldset', null, el('legend', null, 'Transfer Destination'));
    const portal = select([['', 'Use Current']], x.portal, (v) => tset({ portal: v }));
    choices('portals').then((items) => { for (const c of items) portal.append(el('option', { value: c.value, textContent: c.value, selected: c.value === x.portal })); });
    const node = select([['', 'LOCAL']], x.node, (v) => tset({ node: v }));
    choices('nodes').then((items) => { for (const c of items) node.append(el('option', { value: c.value, textContent: c.value, selected: c.value === x.node })); });
    fs.append(field('Portal', portal), field('Node', node),
      field('Menu', text(x.menu, (v) => tset({ menu: v }), { upper: true, max: 30, list: 'xmenus' })), datalist('xmenus', 'menus', (x.menu || '').slice(0, 3)));
    const comp = select([['', '']], x.component, (v) => tset({ component: v }), !x.menu);
    if (x.menu) choices('menuComponents', x.menu).then((items) => { for (const c of items) comp.append(el('option', { value: c.value, textContent: c.value, selected: c.value === x.component })); });
    fs.append(field('Component', comp), field('Market', text(x.market, (v) => tset({ market: v }), { upper: true, max: 3, disabled: !x.component })));
    const page = select([['', '']], x.page, (v) => tset({ page: v }), !x.component);
    const action = select(Object.entries(config.transferActions).map(([k, v]) => [k, v]), String(x.action), (v) => tset({ action: Number(v) }), !x.component);
    if (x.component) {
      const cm = x.component + '.' + (x.market || 'GBL');
      choices('pages', cm).then((items) => { for (const c of items) page.append(el('option', { value: c.value, textContent: c.value, selected: c.value === x.page })); });
      choices('actions', cm).then((items) => { action.replaceChildren(...items.map((c) => el('option', { value: c.value, textContent: c.label, selected: c.value === String(x.action) }))); });
    }
    fs.append(field('Component Item', page), field('Action', action));
    p.append(fs, el('fieldset', null, el('legend', null, 'Transfer Type'),
      el('label', { class: 'check' }, el('input', { type: 'radio', name: 'xtype', checked: !x.newWindow, disabled: !state.editable, onchange: () => tset({ newWindow: false }) }), 'Re-use current window'),
      el('label', { class: 'check' }, el('input', { type: 'radio', name: 'xtype', checked: !!x.newWindow, disabled: !state.editable, onchange: () => tset({ newWindow: true }) }), 'Use new window (minimize current window)')),
      check('Use data from current page in search dialog', x.useData, (on) => tset({ useData: on }), !x.component));
  }

  function diagnostics(p, filter) {
    const list = (state.diagnostics || []).filter(filter);
    if (!list.length) return;
    p.append(el('div', { class: 'diags' }, list.map((x) => el('div', { class: 'diag ' + x.severity }, `${x.severity}: ${x.message}`))));
  }

  // ---------------------------------------------------------------- output: every diagnostic
  function output() {
    const o = $('output'); o.replaceChildren();
    const list = state.diagnostics || [];
    if (!list.length) return;
    o.append(el('div', { class: 'head' }, `${list.filter((d) => d.severity === 'error').length} errors, ${list.filter((d) => d.severity === 'warning').length} warnings`));
    for (const d of list) {
      o.append(el('div', { class: 'diag ' + d.severity, onclick: () => { if (d.at) { sel = d.at.item ? { bar: d.at.bar, item: d.at.item } : d.at.bar ? { bar: d.at.bar } : {}; if (d.at.bar) openBar = d.at.bar; render(); } } },
        el('span', { class: 'sev' }, d.severity), `${d.path}: ${d.message}`));
    }
  }

  function render() {
    if (!state) return;
    // Keep the selection on something that still exists.
    if (sel.item && !itemOf(sel)) sel = sel.bar && barOf(sel.bar) ? { bar: sel.bar } : {};
    if (sel.bar && !barOf(sel.bar)) sel = {};
    if (openBar && !barOf(openBar)) openBar = null;
    if (!popup() && !openBar && state.doc.bars.length) openBar = sel.bar || state.doc.bars[0].name;
    toolbar(); view(); props(); output();
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      state = { ...m, statusError: false };
      if (m.select) { sel = m.select.item ? { bar: m.select.bar, item: m.select.item } : m.select.bar ? { bar: m.select.bar } : sel; if (m.select.bar) openBar = m.select.bar; }
      render();
    } else if (m.type === 'choices') {
      const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m.items); }
    } else if (m.type === 'error') {
      if (state) { state.status = m.message; state.statusError = true; toolbar(); }
    } else if (m.type === 'preview') {
      if (!state) return;
      const inc = Object.entries(m.increments).filter(([, d]) => d).map(([n, d]) => `${n} +${d}`).join(', ');
      state.status = m.empty ? 'Nothing to save.' : `A save writes: ${m.summary.changes.concat(m.summary.peopleCodeChanged).join('; ') || 'the menu row'}${inc ? ' -- ' + inc : ''}${m.summary.groupMenus.length ? ' -- group: ' + m.summary.groupMenus.join(', ') : ''}`;
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
    else if ((e.ctrlKey || e.metaKey) && k === 'c' && sel.item) send({ type: 'copy', ref: sel });
    else if ((e.ctrlKey || e.metaKey) && k === 'x' && sel.item) send({ type: 'cut', ref: sel });
    else if ((e.ctrlKey || e.metaKey) && k === 'v' && (sel.bar || popup())) { const b = barOf(sel.bar || POPUP_BAR); if (b) send({ type: 'paste', bar: b.name, index: sel.item ? b.items.findIndex((i) => i.name === sel.item) : b.items.length }); }
    else if (k === 'delete' && state && state.editable && (sel.item || sel.bar)) send({ type: 'delete', ref: sel.item ? sel : { bar: sel.bar } });
  });

  // The splitter between the menu and its properties.
  (() => {
    const sp = $('splitter'), pr = $('props'); let x0 = 0, w0 = 0;
    const move = (e) => { pr.style.width = Math.max(240, Math.min(window.innerWidth - 200, w0 - (e.clientX - x0))) + 'px'; };
    sp.addEventListener('mousedown', (e) => { x0 = e.clientX; w0 = pr.offsetWidth; document.addEventListener('mousemove', move); document.addEventListener('mouseup', () => document.removeEventListener('mousemove', move), { once: true }); });
  })();

  send({ type: 'ready' });
})();
