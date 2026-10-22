// App Engine Designer client (src/editors/aeDesignerPanel.ts posts the document; this script shows it
// and sends operations back -- model/aeSession.ts AeOp). No document logic lives here.
(function () {
  'use strict';
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage() {}, getState() { return undefined; }, setState() {} };
  const C = JSON.parse(document.getElementById('config').textContent);
  const L = C.labels;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const saved = vscode.getState() || {};

  let state = { doc: undefined, diagnostics: [], dirty: false, canUndo: false, canRedo: false, editable: false, isNew: false };
  let sel = saved.sel || { kind: 'program' };
  let view = saved.view || 'definition';
  let programTab = saved.programTab || 'general';
  let showComments = saved.showComments !== false;
  let collapsed = new Set(saved.collapsed || []);
  let filter = saved.filter || { market: '', platform: '' };
  let status = '';
  let statusError = false;
  let clipboard = '';
  let rows = [];
  const pending = new Map();
  let nextId = 1;
  const cache = {};

  const persist = () => vscode.setState({ sel, view, programTab, showComments, collapsed: [...collapsed], filter });
  const post = (m) => vscode.postMessage(m);
  const op = (o) => post({ type: 'op', op: o });
  const choices = (what, prefix) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); post({ type: 'choices', id, what, prefix: prefix || '' }); });

  // ---------------------------------------------------------------- helpers
  const vkey = (v) => `${v.market}.${v.dbType}.${v.effdt}`;
  const vobj = (v) => ({ market: v.market, dbType: v.dbType, effdt: v.effdt });
  const platformName = (d) => (C.platforms.concat(C.legacyPlatforms).find((p) => p[0] === d) || [d, d])[1];
  const vlabel = (sec, v) => `${sec}.${v.market}.${d2p(v.dbType)}.${v.effdt}`;
  const d2p = (d) => ({ ' ': 'default', '1': 'DB2', '2': 'ORACLE', '3': 'INFORMIX', '4': 'DB2UNIX', '5': 'ALLBASE', '6': 'SYBASE', '7': 'MICROSFT' }[d] || d);
  const label = (map, code) => map[code] ?? (String(code).trim() ? `${code}` : '');
  const ACT = C.actionLabels;
  const SQLY = ['H', 'W', 'D', 'S', 'N'];
  const sameV = (a, b) => a && b && a.market === b.market && a.dbType === b.dbType && a.effdt === b.effdt;
  function find() {
    const d = state.doc;
    if (!d || sel.kind === 'program') return {};
    const section = d.sections.find((s) => s.name === sel.section);
    const variant = section && (section.variants.find((v) => sameV(v, sel.variant)) || section.variants[0]);
    const step = variant && sel.step !== undefined ? variant.steps.find((s) => s.name === sel.step) : undefined;
    const action = step && sel.action ? step.actions.find((a) => a.type === sel.action) : undefined;
    return { section, variant, step, action };
  }
  const stepRef = () => ({ section: sel.section, variant: sel.variant, step: sel.step });
  const actionRef = () => ({ ...stepRef(), type: sel.action });
  function insertable(step) {
    const has = new Set(step.actions.map((a) => a.type));
    return C.actionOrder.filter((t) => !has.has(t) && !(t === 'C' && has.has('S')) && !(t === 'S' && has.has('C')) && (t !== 'X' || state.doc.program.programType === '4'));
  }
  function diagFor(at) {
    return state.diagnostics.filter((g) => g.at && g.at.section === at.section && (!at.variant || !g.at.variant || sameV(g.at.variant, at.variant)) &&
      (at.step === undefined ? g.at.step === undefined : g.at.step === at.step) && (at.action === undefined ? g.at.action === undefined : g.at.action === at.action));
  }
  function badge(list) {
    const e = list.filter((g) => g.severity === 'error').length;
    const w = list.filter((g) => g.severity === 'warning').length;
    return (e ? `<span class="badge error" title="${e} error(s)">&#x2716;${e}</span>` : '') + (w ? `<span class="badge warning" title="${w} warning(s)">&#x26A0;${w}</span>` : '');
  }

  // ---------------------------------------------------------------- toolbar
  function renderToolbar() {
    const ed = state.editable;
    const b = (id, text, title, enabled = true, cls = '') => `<button id="${id}" class="${cls}" title="${esc(title)}" ${enabled ? '' : 'disabled'}>${text}</button>`;
    const f = find();
    $('toolbar').innerHTML = [
      b('tb-save', 'Save', 'Save the program (Ctrl+S)', ed && (state.dirty || state.isNew), 'primary'),
      b('tb-run', 'Run and Monitor', 'Run the saved Application Engine through Process Scheduler', !state.isNew && !state.dirty),
      b('tb-undo', 'Undo', 'Undo (Ctrl+Z)', ed && state.canUndo), b('tb-redo', 'Redo', 'Redo (Ctrl+Y)', ed && state.canRedo),
      '<span class="sep"></span>',
      b('tb-section', 'Insert Section', 'Insert a section', ed),
      b('tb-step', 'Insert Step/Action', 'Insert a step (with an SQL action) after the selected step', ed && !!f.section),
      b('tb-action', 'Insert Action', 'Insert the next action the step can take', ed && !!f.step && insertable(f.step).length > 0),
      b('tb-delete', 'Delete', 'Delete the selection (Del)', ed && sel.kind !== 'program' && !(sel.kind === 'section' && sel.section === 'MAIN')),
      '<span class="sep"></span>',
      b('tb-props', 'Program Properties', 'Program Properties'),
      b('tb-validate', 'Validate', 'Validate against the database and compile the PeopleCode'),
      b('tb-preview', 'Preview Save', 'Show what a save would write', ed),
      b('tb-reload', 'Reload', 'Reload from the database'),
      '<span class="sep"></span>',
      b('tb-saveas', 'Save As...', 'Save a copy under a new name (with its SQL and PeopleCode)', ed && !state.isNew),
      b('tb-rename', 'Rename...', 'Rename the program', ed && !state.isNew && !state.dirty),
      b('tb-deleteprog', 'Delete Program', 'Delete the program', ed),
      `<span class="status ${statusError ? 'error' : ''}" title="${esc(status)}">${state.dirty ? '<span class="dirty">&#x25CF; unsaved</span> ' : ''}${esc(status || (state.editable ? '' : 'Read-only'))}</span>`
    ].join('');
  }

  // ---------------------------------------------------------------- tabs
  function renderTabs() {
    const d = state.doc;
    const markets = [...new Set(d ? d.sections.flatMap((s) => s.variants.map((v) => v.market)) : [])].sort();
    const platforms = [...new Set(d ? d.sections.flatMap((s) => s.variants.map((v) => v.dbType)) : [])].sort();
    $('tabs').innerHTML = `<button data-view="definition" class="${view === 'definition' ? 'on' : ''}">Definition</button>` +
      `<button data-view="flow" class="${view === 'flow' ? 'on' : ''}">Program Flow</button>` +
      `<span class="filter">Market <select id="f-market"><option value="">All</option>${markets.map((m) => `<option ${filter.market === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` +
      ` Platform <select id="f-platform"><option value="">All</option>${platforms.map((p) => `<option value="${esc(p)}" ${filter.platform === p ? 'selected' : ''}>${esc(platformName(p))}</option>`).join('')}</select>` +
      ` <label><input type="checkbox" id="f-comments" ${showComments ? 'checked' : ''}> Comments</label></span>`;
  }
  const visible = (v) => (!filter.market || v.market === filter.market) && (!filter.platform || v.dbType === filter.platform);

  // ---------------------------------------------------------------- definition view
  function renderDefinition() {
    const d = state.doc;
    rows = [];
    const out = [];
    const isSel = (k) => (k.kind === sel.kind && k.section === sel.section && sameV(k.variant, sel.variant) && k.step === sel.step && k.action === sel.action);
    const pkey = 'p';
    rows.push({ kind: 'program' });
    out.push(`<div class="node ${sel.kind === 'program' ? 'sel' : ''}" data-row="0"><span class="tw"></span><span class="icon">&#x2699;</span>` +
      `<span class="name">${esc(d.name)}</span><span class="descr">${esc(d.program.descr.trim())}</span>` +
      `<span class="chip">${esc(label(Object.fromEntries(C.programTypes), d.program.programType))}</span>${d.program.library ? '<span class="chip">Library</span>' : ''}` +
      `${badge(state.diagnostics.filter((g) => !g.at))}</div>`);
    void pkey;
    for (const s of d.sections) {
      for (const v of s.variants.filter(visible)) {
        const skey = `s|${s.name}|${vkey(v)}`;
        const sk = { kind: 'section', section: s.name, variant: vobj(v) };
        const open = !collapsed.has(skey);
        rows.push(sk);
        out.push(`<div class="section ${v.active ? '' : 'inactive'}"><div class="node ${isSel(sk) ? 'sel' : ''}" data-row="${rows.length - 1}">` +
          `<span class="tw" data-toggle="${esc(skey)}">${v.steps.length ? (open ? '&#x25BE;' : '&#x25B8;') : ''}</span><span class="icon">&#x1F4C1;</span>` +
          `<span class="name">${esc(s.name)}</span><span class="descr">${esc(v.descr.trim())}</span>` +
          `<span class="chip" title="Section Type">${esc(label(L.sectionType, s.type))}</span><span class="chip" title="Access">${s.isPublic ? 'Public' : 'Private'}</span>` +
          `${v.autoCommit === 'Y' ? '<span class="chip">Auto Commit</span>' : ''}${v.active ? '' : '<span class="chip">Inactive</span>'}` +
          `${badge(diagFor({ section: s.name, variant: v }))}<span class="path">${esc(vlabel(s.name, v))}</span></div>`);
        if (showComments && v.descrlong) out.push(`<div class="comment">${esc(v.descrlong)}</div>`);
        if (open) {
          v.steps.forEach((st, i) => {
            const tkey = `t|${s.name}|${vkey(v)}|${st.name}`;
            const tk = { kind: 'step', section: s.name, variant: vobj(v), step: st.name };
            const topen = !collapsed.has(tkey);
            rows.push(tk);
            const hasDs = st.actions.some((a) => a.type === 'D');
            out.push(`<div class="step ${st.active ? '' : 'inactive'}"><div class="node ${isSel(tk) ? 'sel' : ''}" data-row="${rows.length - 1}">` +
              `<span class="tw" data-toggle="${esc(tkey)}">${st.actions.length ? (topen ? '&#x25BE;' : '&#x25B8;') : ''}</span><span class="chip">${String(i + 1).padStart(3, '0')}</span>` +
              `<span class="name">${esc(st.name)}</span><span class="descr">${esc(st.descr.trim())}</span>` +
              `<span class="chip" title="Commit After">${esc(label(L.commit, st.commitAfter))}${hasDs && st.commitFrequency ? ` / ${st.commitFrequency}` : ''}</span>` +
              `<span class="chip" title="On Error">${esc(label(L.onError, st.onError))}</span>${st.active ? '' : '<span class="chip">Inactive</span>'}` +
              `${badge(diagFor({ section: s.name, variant: v, step: st.name }))}</div>`);
            if (showComments && st.descrlong) out.push(`<div class="comment">${esc(st.descrlong)}</div>`);
            if (topen) {
              for (const a of st.actions) {
                const ak = { kind: 'action', section: s.name, variant: vobj(v), step: st.name, action: a.type };
                rows.push(ak);
                out.push(`<div class="action"><div class="node ${isSel(ak) ? 'sel' : ''}" data-row="${rows.length - 1}"><span class="tw"></span>` +
                  `<span class="icon">${a.type === 'P' ? '&#x2263;' : a.type === 'C' ? '&#x21B3;' : a.type === 'M' ? '&#x2709;' : '&#x2B1A;'}</span>` +
                  `<span class="name">${esc(ACT[a.type])}</span><span class="descr">${esc(a.descr.trim())}</span>${actionChips(st, a)}` +
                  `${badge(diagFor({ section: s.name, variant: v, step: st.name, action: a.type }))}</div>`);
                if (showComments && a.descrlong) out.push(`<div class="comment">${esc(a.descrlong)}</div>`);
                const text = a.type === 'P' ? a.peopleCode : a.text;
                if (text && text.trim()) out.push(`<div class="preview">${esc(text.trim().split('\n').slice(0, 3).join('\n'))}</div>`);
                out.push('</div>');
              }
            }
            out.push('</div>');
          });
          if (!v.steps.length) out.push('<div class="empty step">No steps. Insert Step/Action adds one.</div>');
        }
        out.push('</div>');
      }
    }
    $('view').innerHTML = out.join('');
    const el = $('view').querySelector('.node.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function actionChips(st, a) {
    const c = (t, title) => `<span class="chip" title="${esc(title)}">${esc(t)}</span>`;
    switch (a.type) {
      case 'S': return c(label(L.reuse, a.reuse), 'ReUse Statement') + c(`No Rows: ${label(L.onNoRows, st.onNoRows)}`, 'No Rows');
      case 'D': return c(label(L.reuse, a.reuse), 'ReUse Statement') + c(label(L.doSelectType, a.doSelectType), 'Do Select Type');
      case 'H': case 'W': case 'N': return c(label(L.reuse, a.reuse), 'ReUse Statement');
      case 'P': return c(`On Return: ${label(L.onReturn, st.onReturn)}`, 'On Return');
      case 'C': return c(st.dynamic ? 'Dynamic' : `${st.doProgram.trim() && st.doProgram.trim() !== state.doc.name ? st.doProgram.trim() + '.' : ''}${st.doSection.trim() || '(none)'}`, 'Called section');
      case 'M': return c(`${st.messageSet}, ${st.messageNumber}`, 'Message Set, Number');
      case 'X': return c(`Graphical Mapper: ${a.reuse === 'I' ? 'No' : 'Yes'}`, 'Graphical Mapper');
      default: return '';
    }
  }

  // ---------------------------------------------------------------- program flow view
  function renderFlow() {
    const d = state.doc;
    const out = [];
    for (const s of d.sections) for (const v of s.variants.filter(visible)) {
      out.push(`<div class="flow-section"><h3>${esc(vlabel(s.name, v))} <span class="at">${esc(v.descr.trim())}</span></h3>`);
      v.steps.forEach((st, i) => {
        out.push(`<div class="flow-step"><span class="st">${String(i + 1).padStart(3, '0')} ${esc(st.name)}</span> <span class="at">${esc(st.descr.trim())}</span>`);
        for (const a of st.actions) {
          const text = a.type === 'P' ? a.peopleCode : a.text;
          let body = '';
          if (a.type === 'C') body = st.dynamic ? '(Dynamic: the section named in AE_SECTION / AE_APPLID of the state record)' : `Call ${st.doProgram.trim() && st.doProgram.trim() !== d.name ? st.doProgram.trim() + '.' : ''}${st.doSection.trim()}`;
          else if (a.type === 'M') body = `Message ${st.messageSet}, ${st.messageNumber}${st.messageParms && st.messageParms.trim() ? `  (${st.messageParms.trim()})` : ''}`;
          else body = text && text.trim() ? text : '(none)';
          out.push(`<div class="flow-action"><span class="at">${esc(ACT[a.type])}</span><pre>${esc(body)}</pre></div>`);
        }
        out.push('</div>');
      });
      out.push('</div>');
    }
    $('view').innerHTML = out.join('') || '<div class="empty">No sections.</div>';
  }

  // ---------------------------------------------------------------- properties
  const dis = () => (state.editable ? '' : 'disabled');
  const sel1 = (id, opts, value, extra = '') => `<select id="${id}" ${dis()} ${extra}>${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const txt = (id, value, extra = '') => `<input type="text" id="${id}" value="${esc(value)}" ${dis()} ${extra}>`;
  const num = (id, value, extra = '') => `<input type="number" id="${id}" value="${esc(value)}" ${dis()} ${extra}>`;
  const chk = (id, on, extra = '') => `<input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis()} ${extra}>`;
  const row = (labelText, control) => `<label class="row"><span>${esc(labelText)}</span>${control}</label>`;
  const check = (control, labelText) => `<label class="check">${control}<span>${esc(labelText)}</span></label>`;

  function renderProps() {
    const d = state.doc;
    if (!d) return;
    const f = find();
    let html = '';
    if (sel.kind === 'program' || !f.section) html = programProps(d);
    else if (sel.kind === 'section') html = sectionProps(d, f.section, f.variant);
    else if (sel.kind === 'step' && f.step) html = stepProps(d, f.section, f.variant, f.step);
    else if (sel.kind === 'action' && f.action) html = actionProps(d, f.section, f.variant, f.step, f.action);
    const here = sel.kind === 'program' ? state.diagnostics.filter((g) => !g.at) : f.section ? diagFor({ section: sel.section, variant: sel.variant, step: sel.step, action: sel.action }) : [];
    if (here.length) html += `<fieldset class="diags"><legend>Validation</legend>${here.map((g) => `<div class="diag ${g.severity}">${esc(g.message)}${g.fix ? ` <em>(${esc(g.fix)})</em>` : ''}</div>`).join('')}</fieldset>`;
    $('props').innerHTML = html;
    if (sel.kind === 'program') hydrateProgram(d);
  }

  function programProps(d) {
    const p = d.program;
    const tabs = [['general', 'General'], ['state', 'State Records'], ['temp', 'Temp Tables'], ['advanced', 'Advanced']];
    let body = '';
    if (programTab === 'general') {
      body = row('Description', txt('p-descr', p.descr.trim(), 'maxlength="30"')) +
        `<label class="row"><span>Comments</span><span></span></label><textarea id="p-descrlong" rows="5" ${dis()}>${esc(p.descrlong ?? '')}</textarea>` +
        row('Owner ID', `<select id="p-owner" ${dis()}><option value=" ">${p.owner.trim() ? esc(p.owner) : ''}</option></select>`) +
        `<div class="hint">Last updated ${esc(p.lastUpdated || '')} by ${esc(p.lastUpdatedBy || '')}${p.version ? `, version ${p.version}` : ''}.</div>`;
    } else if (programTab === 'state') {
      body = `<div class="list" id="p-states">${d.stateRecords.map((s, i) => `<div class="item"><input type="radio" name="p-def" data-def="${i}" ${s.isDefault ? 'checked' : ''} ${dis()} title="Default State Record">` +
        `<span class="grow">${esc(s.record)}</span><button data-rmstate="${i}" ${dis()}>Remove</button></div>`).join('') || '<div class="item hint">No state records.</div>'}</div>` +
        `<div class="inline">${txt('p-state-q', '', 'placeholder="Record name (ends in AET)" list="dl-states"')}<button id="p-state-add" ${dis()}>Add</button></div>` +
        `<datalist id="dl-states"></datalist><div class="hint">The default state record is the one the program's %Bind and %Select use unqualified.</div>`;
    } else if (programTab === 'temp') {
      const r = p.recuse;
      body = `<div class="list" id="p-temps">${d.tempTables.map((t, i) => `<div class="item"><span class="grow">${esc(t)}</span><button data-rmtemp="${i}" ${dis()}>Remove</button></div>`).join('') || '<div class="item hint">No temporary tables.</div>'}</div>` +
        `<div class="inline">${txt('p-temp-q', '', 'placeholder="Temporary Table record" list="dl-temps"')}<button id="p-temp-add" ${dis()}>Add</button></div><datalist id="dl-temps"></datalist>` +
        row('Instance Count', num('p-instances', p.tempTableInstances, 'min="0"')) +
        check(chk('p-share', r & 4), 'Share Tables in Online Mode') + check(chk('p-usedelete', r & 8), 'Use Delete for Truncate Table') +
        `<fieldset><legend>Runtime: if non-shared tables cannot be assigned</legend>` +
        check(`<input type="radio" name="p-rt" id="p-continue" ${r & 1 ? '' : 'checked'} ${dis()}>`, 'Continue') +
        check(`<input type="radio" name="p-rt" id="p-abort" ${r & 1 ? 'checked' : ''} ${dis()}>`, 'Abort') + '</fieldset>';
    } else {
      body = check(chk('p-restart', p.disableRestart), 'Disable Restart') +
        check(chk('p-library', p.library), 'Application Library') +
        check(chk('p-batch', p.recuse & 2), 'Batch Only') +
        row('Message Set', num('p-msgset', p.messageSet, 'min="0"')) +
        row('Program Type', sel1('p-type', C.programTypes, p.programType)) +
        '<div class="hint">Application Library: checking it renames MAIN (a library has no entry point); unchecking it adds an empty MAIN, as App Designer does.</div>';
    }
    return `<h2>Program Properties</h2><div class="sub">${esc(d.name)}${state.isNew ? ' (new, not saved)' : ''}</div>` +
      `<div class="ptabs">${tabs.map(([k, t]) => `<button data-ptab="${k}" class="${programTab === k ? 'on' : ''}">${t}</button>`).join('')}</div>${body}`;
  }

  async function hydrateProgram(d) {
    if (programTab === 'general' && state.editable) {
      cache.owners = cache.owners || await choices('owners');
      const s = $('p-owner');
      if (s) s.innerHTML = `<option value=" "></option>` + cache.owners.map((o) => `<option value="${esc(o.value)}" ${o.value === d.program.owner.trim() ? 'selected' : ''}>${esc(o.label || o.value)}</option>`).join('');
    }
  }

  function sectionProps(d, s, v) {
    const platforms = C.platforms.concat(C.platforms.some((p) => p[0] === v.dbType) ? [] : C.legacyPlatforms.filter((p) => p[0] === v.dbType));
    return `<h2>Section ${esc(s.name)}</h2><div class="sub">${esc(vlabel(s.name, v))}</div>` +
      row('Section Name', txt('s-name', s.name, `maxlength="8" ${s.name === 'MAIN' ? 'disabled' : ''}`)) +
      row('Description', txt('s-descr', v.descr.trim(), 'maxlength="30"')) +
      row('Market', `${txt('s-market', v.market, 'maxlength="3" list="dl-markets"')}<datalist id="dl-markets"></datalist>`) +
      row('Platform', sel1('s-platform', platforms, v.dbType)) +
      row('Effective Date', `<input type="date" id="s-effdt" value="${esc(v.effdt)}" ${dis()}>`) +
      row('Effective Status', sel1('s-status', [['A', 'Active'], ['I', 'Inactive']], v.active ? 'A' : 'I')) +
      row('Section Type', sel1('s-type', [['C', 'Critical Updates'], ['P', 'Prepare Only']], s.type)) +
      check(chk('s-auto', v.autoCommit === 'Y'), 'Auto Commit: After Step') +
      check(chk('s-public', s.isPublic, s.name === 'MAIN' ? 'disabled' : ''), 'Access: Public') +
      `<label class="row"><span>Comment</span><span></span></label><textarea id="s-comment" rows="4" ${dis()}>${esc(v.descrlong ?? '')}</textarea>` +
      `<div class="hint">Market, Platform and Effective Date key the section's variant: changing one moves its steps, SQL and PeopleCode.</div>`;
  }

  function stepProps(d, s, v, st) {
    const hasDs = st.actions.some((a) => a.type === 'D');
    return `<h2>Step ${esc(st.name)}</h2><div class="sub">${esc(vlabel(s.name, v))}.${esc(st.name)}</div>` +
      row('Step Name', txt('t-name', st.name, 'maxlength="8"')) +
      row('Description', txt('t-descr', st.descr.trim(), 'maxlength="30"')) +
      row('Commit After', sel1('t-commit', [['D', 'Default'], ['N', 'Later'], ['Y', 'After Step']], st.commitAfter)) +
      row('Frequency', num('t-freq', st.commitFrequency, `min="0" ${hasDs ? '' : 'disabled title="Only with a Do Select"'}`)) +
      row('On Error', sel1('t-onerror', [['A', 'Abort'], ['I', 'Ignore'], ['S', 'Suppress']].concat(st.onError === 'B' ? [['B', 'Break']] : []), st.onError)) +
      check(chk('t-active', st.active), 'Active') +
      `<label class="row"><span>Comment</span><span></span></label><textarea id="t-comment" rows="4" ${dis()}>${esc(st.descrlong ?? '')}</textarea>` +
      (state.editable ? `<div class="inline"><button id="t-insert-action" ${insertable(st).length ? '' : 'disabled'}>Insert Action</button>${sel1('t-insert-type', insertable(st).map((t) => [t, ACT[t]]), insertable(st)[0])}</div>` : '');
  }

  function actionProps(d, s, v, st, a) {
    const types = [a.type, ...insertable(st)].filter((t, i, all) => all.indexOf(t) === i).sort((x, y) => C.actionOrder.indexOf(x) - C.actionOrder.indexOf(y));
    let body = row('Action Type', sel1('a-type', types.map((t) => [t, ACT[t]]), a.type)) +
      row('Description', txt('a-descr', a.descr.trim(), 'maxlength="30"'));
    const reuse3 = [['I', 'Bulk Insert'], ['N', 'No'], ['Y', 'Yes']];
    switch (a.type) {
      case 'H': case 'W': case 'N': body += row('ReUse Statement', sel1('a-reuse', [['N', 'No'], ['Y', 'Yes']], a.reuse)); break;
      case 'D': body += row('ReUse Statement', sel1('a-reuse', reuse3, a.reuse)) + row('Do Select Type', sel1('a-dst', [['F', 'Select/Fetch'], ['R', 'Reselect'], ['Y', 'Restartable']], a.doSelectType)); break;
      case 'S': body += row('ReUse Statement', sel1('a-reuse', reuse3, a.reuse)) + row('No Rows', sel1('t-norows', [['A', 'Abort'], ['B', 'Section Break'], ['C', 'Continue'], ['S', 'Skip Step']], st.onNoRows)); break;
      case 'P': body += row('On Return', sel1('t-onreturn', [['A', 'Abort'], ['B', 'Break'], ['S', 'Skip Step']], st.onReturn)); break;
      case 'X': body += row('Graphical Mapper', sel1('a-reuse', [['I', 'No'], ['N', 'Yes']], a.reuse)); break;
      case 'C': {
        const local = !st.doProgram.trim() || st.doProgram.trim() === d.name;
        body += row('Program ID', `${txt('c-program', local ? '' : st.doProgram.trim(), `placeholder="(current)" list="dl-programs" ${st.dynamic ? 'disabled' : ''}`)}<datalist id="dl-programs"></datalist>`) +
          row('Section Name', local
            ? sel1('c-section', [[' ', '']].concat(d.sections.map((x) => [x.name, x.name])), st.doSection.trim() || ' ', st.dynamic ? 'disabled' : '')
            : `${txt('c-section', st.doSection.trim(), `list="dl-sections" ${st.dynamic ? 'disabled' : ''}`)}<datalist id="dl-sections"></datalist>`) +
          check(chk('c-dynamic', st.dynamic), 'Dynamic') +
          (!local && st.doProgram.trim() ? `<div class="inline"><button id="c-open">Open ${esc(st.doProgram.trim())}</button></div>` : '') +
          '<div class="hint">Dynamic: the program and section to call come from the state record\'s AE_APPLID and AE_SECTION at run time.</div>';
        break;
      }
      case 'M':
        body += row('Message Set', num('m-set', st.messageSet, 'min="0"')) + row('Number', num('m-num', st.messageNumber, 'min="0"')) +
          row('Parameters', txt('m-parms', (st.messageParms ?? '').trim(), 'placeholder="%Bind(FIELD), \'text\', ..."'));
        break;
    }
    body += `<label class="row"><span>Comment</span><span></span></label><textarea id="a-comment" rows="3" ${dis()}>${esc(a.descrlong ?? '')}</textarea>`;
    if (SQLY.includes(a.type) || a.type === 'X' || a.type === 'P') {
      const kind = a.type === 'P' ? 'PeopleCode' : a.type === 'X' ? 'XSLT' : 'SQL';
      const text = a.type === 'P' ? a.peopleCode : a.text;
      body += `<fieldset><legend>${kind}</legend><textarea id="a-text" class="code" ${dis()} spellcheck="false">${esc(text ?? '')}</textarea>` +
        `<div class="inline"><button id="a-open">Open in Editor</button>${state.editable ? `<button id="a-apply">Apply</button>` : ''}</div>` +
        (kind === 'SQL' ? '<div class="hint">App Designer stores App Engine SQL on one line: line breaks and runs of spaces outside quotes become single spaces when you change it.</div>' : '') + '</fieldset>';
    }
    return `<h2>${esc(ACT[a.type])}</h2><div class="sub">${esc(vlabel(s.name, v))}.${esc(st.name)}.${esc(ACT[a.type])}</div>${body}`;
  }

  // ---------------------------------------------------------------- output
  function renderOutput() {
    const ds = state.diagnostics;
    const e = ds.filter((g) => g.severity === 'error').length;
    const w = ds.filter((g) => g.severity === 'warning').length;
    $('output').innerHTML = `<div class="head">Validation: ${e} error(s), ${w} warning(s), ${ds.length - e - w} note(s)</div>` +
      ds.map((g, i) => `<div class="diag ${g.severity}" data-diag="${i}" title="${esc(g.message)}"><span class="sev">${g.severity}</span>${esc(g.path)}: ${esc(g.message)}</div>`).join('');
  }

  function render() {
    if (!state.doc) return;
    renderToolbar();
    renderTabs();
    if (view === 'flow') renderFlow(); else renderDefinition();
    renderProps();
    renderOutput();
  }

  // ---------------------------------------------------------------- selection / menu
  function select(k) {
    sel = k.kind === 'program' ? { kind: 'program' } : { ...k };
    persist();
    render();
  }

  function validateSelection() {
    const f = find();
    if (sel.kind === 'program') return;
    if (!f.section) { sel = { kind: 'program' }; return; }
    if (!sameV(f.variant, sel.variant)) sel.variant = vobj(f.variant);
    if (sel.kind === 'step' && !f.step) sel = { kind: 'section', section: sel.section, variant: sel.variant };
    if (sel.kind === 'action' && !f.action) sel = f.step ? { kind: 'step', section: sel.section, variant: sel.variant, step: sel.step } : { kind: 'section', section: sel.section, variant: sel.variant };
  }

  function menu(x, y) {
    const f = find();
    const ed = state.editable;
    const items = [];
    const add = (text, fn, enabled = true, key = '') => items.push({ text, fn, enabled, key });
    const sepa = () => items.push(null);
    const a = f.action;
    add('View PeopleCode', () => post({ type: 'openText', ref: stepRef(), action: 'P' }), sel.kind === 'action' && a && a.type === 'P');
    add('View SQL', () => post({ type: 'openText', ref: stepRef(), action: a.type }), sel.kind === 'action' && a && SQLY.includes(a.type));
    add('View XSLT', () => post({ type: 'openText', ref: stepRef(), action: 'X' }), sel.kind === 'action' && a && a.type === 'X' && state.doc.program.programType === '4');
    sepa();
    add('Cut', () => cut(), ed && sel.kind === 'step', 'Ctrl+X');
    add('Copy', () => copy(), sel.kind === 'step', 'Ctrl+C');
    add('Paste', () => paste(), ed && !!clipboard && (sel.kind === 'step' || sel.kind === 'section'), 'Ctrl+V');
    add('Delete', () => del(), ed && sel.kind !== 'program' && !(sel.kind === 'section' && sel.section === 'MAIN' && f.section.variants.length < 2), 'Del');
    sepa();
    add('Refresh View', () => render(), true, 'F5');
    add(showComments ? 'Hide Comments' : 'Show Comments', () => { showComments = !showComments; persist(); render(); });
    sepa();
    add('Insert Section', () => op({ kind: 'insertSection' }), ed);
    add('Insert Step/Action', () => insertStep(), ed && sel.kind !== 'program' && sel.kind !== 'action');
    if (f.step && ed) for (const t of insertable(f.step)) add(`Insert Action: ${ACT[t]}`, () => op({ kind: 'insertAction', ref: stepRef(), type: t }), sel.kind === 'step' || sel.kind === 'action');
    if (a && ed) {
      sepa();
      for (const t of [...insertable(f.step)].filter((t) => t !== a.type)) add(`Change Type to ${ACT[t]}`, () => op({ kind: 'changeActionType', ref: actionRef(), type: t }));
    }
    if (a && a.type === 'C' && f.step.doProgram.trim() && f.step.doProgram.trim() !== state.doc.name) { sepa(); add(`Open ${f.step.doProgram.trim()}`, () => post({ type: 'openProgram', name: f.step.doProgram.trim() })); }
    sepa();
    add('Program Properties', () => select({ kind: 'program' }));
    const m = $('menu');
    m.innerHTML = items.filter((it, i) => it || (i > 0 && items[i - 1])).map((it, i) => (it ? `<div class="mi ${it.enabled ? '' : 'off'}" data-mi="${i}">${esc(it.text)}${it.key ? `<span class="key">${esc(it.key)}</span>` : ''}</div>` : '<div class="ms"></div>')).join('');
    const live = items.filter((it, i) => it || (i > 0 && items[i - 1]));
    m.hidden = false;
    m.style.left = `${Math.min(x, window.innerWidth - m.offsetWidth - 4)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - m.offsetHeight - 4)}px`;
    m.onclick = (e) => { const t = e.target.closest('[data-mi]'); if (!t) return; m.hidden = true; const it = live[Number(t.dataset.mi)]; if (it && it.enabled) it.fn(); };
  }

  function insertStep() {
    if (sel.kind === 'section') op({ kind: 'insertStep', section: sel.section, variant: sel.variant });
    else if (sel.step !== undefined) op({ kind: 'insertStep', section: sel.section, variant: sel.variant, after: sel.step });
  }
  function del() {
    if (!state.editable || sel.kind === 'program') return;
    const f = find();
    if (sel.kind === 'section') op({ kind: 'deleteSection', section: sel.section, ...(f.section.variants.length > 1 ? { variant: sel.variant } : {}) });
    else if (sel.kind === 'step') op({ kind: 'deleteStep', ref: stepRef() });
    else if (sel.kind === 'action') op({ kind: 'deleteAction', ref: actionRef() });
  }
  function copy() { if (sel.kind === 'step') post({ type: 'copy', ref: stepRef() }); }
  function cut() { if (sel.kind === 'step' && state.editable) { copy(); op({ kind: 'deleteStep', ref: stepRef() }); } }
  function paste() {
    if (!state.editable) return;
    if (sel.kind === 'step') post({ type: 'paste', target: { section: sel.section, variant: sel.variant, after: sel.step } });
    else if (sel.kind === 'section') post({ type: 'paste', target: { section: sel.section, variant: sel.variant } });
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('#menu')) $('menu').hidden = true;
    const tog = t.closest('[data-toggle]');
    if (tog) { const k = tog.dataset.toggle; collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k); persist(); render(); return; }
    const r = t.closest('[data-row]');
    if (r) { select(rows[Number(r.dataset.row)]); $('view').focus(); return; }
    const v = t.closest('[data-view]');
    if (v) { view = v.dataset.view; persist(); render(); return; }
    const pt = t.closest('[data-ptab]');
    if (pt) { programTab = pt.dataset.ptab; persist(); render(); return; }
    const dg = t.closest('[data-diag]');
    if (dg) {
      const g = state.diagnostics[Number(dg.dataset.diag)];
      if (g && g.at) select({ kind: g.at.action ? 'action' : g.at.step !== undefined ? 'step' : 'section', section: g.at.section, variant: g.at.variant, step: g.at.step, action: g.at.action });
      else select({ kind: 'program' });
      return;
    }
    if (t.dataset.rmstate !== undefined) {
      const recs = state.doc.stateRecords.filter((_, i) => i !== Number(t.dataset.rmstate));
      if (recs.length && !recs.some((r2) => r2.isDefault)) recs[0] = { ...recs[0], isDefault: true };
      op({ kind: 'setStateRecords', records: recs });
      return;
    }
    if (t.dataset.rmtemp !== undefined) { op({ kind: 'setTempTables', tables: state.doc.tempTables.filter((_, i) => i !== Number(t.dataset.rmtemp)) }); return; }
    switch (t.id) {
      case 'tb-save': post({ type: 'save' }); break;
      case 'tb-undo': post({ type: 'undo' }); break;
      case 'tb-redo': post({ type: 'redo' }); break;
      case 'tb-section': op({ kind: 'insertSection' }); break;
      case 'tb-step': insertStep(); break;
      case 'tb-action': if (sel.step !== undefined) op({ kind: 'insertAction', ref: stepRef() }); break;
      case 'tb-delete': del(); break;
      case 'tb-props': select({ kind: 'program' }); break;
      case 'tb-validate': status = 'Validating...'; statusError = false; renderToolbar(); post({ type: 'validate' }); break;
      case 'tb-preview': post({ type: 'preview' }); break;
      case 'tb-reload': post({ type: 'reload' }); break;
      case 'tb-run': post({ type: 'run' }); break;
      case 'tb-saveas': post({ type: 'saveAs' }); break;
      case 'tb-rename': post({ type: 'rename' }); break;
      case 'tb-deleteprog': post({ type: 'delete' }); break;
      case 'p-state-add': {
        const name = $('p-state-q').value.trim().toUpperCase();
        if (name) op({ kind: 'setStateRecords', records: [...state.doc.stateRecords, { record: name, isDefault: state.doc.stateRecords.length === 0 }] });
        break;
      }
      case 'p-temp-add': { const name = $('p-temp-q').value.trim().toUpperCase(); if (name) op({ kind: 'setTempTables', tables: [...state.doc.tempTables, name] }); break; }
      case 't-insert-action': op({ kind: 'insertAction', ref: stepRef(), type: $('t-insert-type').value }); break;
      case 'a-open': post({ type: 'openText', ref: stepRef(), action: sel.action }); break;
      case 'a-apply': applyText(); break;
      case 'c-open': post({ type: 'openProgram', name: find().step.doProgram.trim() }); break;
    }
  });

  function applyText() {
    const v = $('a-text').value;
    op({ kind: 'setAction', ref: actionRef(), patch: sel.action === 'P' ? { peopleCode: v } : { text: v } });
  }

  document.addEventListener('contextmenu', (e) => {
    const r = e.target.closest('[data-row]');
    if (!r) return;
    e.preventDefault();
    select(rows[Number(r.dataset.row)]);
    menu(e.clientX, e.clientY);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    const id = t.id;
    const d = state.doc;
    if (id === 'f-market') { filter.market = t.value; persist(); render(); return; }
    if (id === 'f-platform') { filter.platform = t.value; persist(); render(); return; }
    if (id === 'f-comments') { showComments = t.checked; persist(); render(); return; }
    if (!state.editable || !d) return;
    const f = find();
    const p = d.program;
    const setP = (patch) => op({ kind: 'setProgram', patch });
    const setV = (patch) => op({ kind: 'setVariant', section: sel.section, variant: sel.variant, patch });
    const setS = (patch) => op({ kind: 'setSection', section: sel.section, patch });
    const setT = (patch) => op({ kind: 'setStep', ref: stepRef(), patch });
    const setA = (patch) => op({ kind: 'setAction', ref: actionRef(), patch });
    const bit = (b, on) => (on ? p.recuse | b : p.recuse & ~b);
    if (t.name === 'p-def') { op({ kind: 'setStateRecords', records: d.stateRecords.map((s, i) => ({ ...s, isDefault: i === Number(t.dataset.def) })) }); return; }
    switch (id) {
      case 'p-descr': setP({ descr: t.value || ' ' }); break;
      case 'p-descrlong': setP({ descrlong: t.value === '' ? null : t.value }); break;
      case 'p-owner': setP({ owner: t.value || ' ' }); break;
      case 'p-instances': setP({ tempTableInstances: Math.max(0, Number(t.value) || 0) }); break;
      case 'p-share': setP({ recuse: bit(4, t.checked) }); break;
      case 'p-usedelete': setP({ recuse: bit(8, t.checked) }); break;
      case 'p-continue': setP({ recuse: bit(1, false) }); break;
      case 'p-abort': setP({ recuse: bit(1, true) }); break;
      case 'p-restart': setP({ disableRestart: t.checked }); break;
      case 'p-library': op({ kind: 'setLibrary', library: t.checked }); break;
      case 'p-batch': setP({ recuse: bit(2, t.checked) }); break;
      case 'p-msgset': setP({ messageSet: Math.max(0, Number(t.value) || 0) }); break;
      case 'p-type': setP({ programType: t.value }); break;
      case 's-name': if (t.value.trim()) op({ kind: 'renameSection', from: sel.section, to: t.value.trim() }); break;
      case 's-descr': setV({ descr: t.value || ' ' }); break;
      case 's-market': setV({ market: t.value.trim().toUpperCase() }); break;
      case 's-platform': setV({ dbType: t.value }); break;
      case 's-effdt': if (t.value) setV({ effdt: t.value }); break;
      case 's-status': setV({ active: t.value === 'A' }); break;
      case 's-type': setS({ type: t.value }); break;
      case 's-auto': setV({ autoCommit: t.checked ? 'Y' : 'N' }); break;
      case 's-public': setS({ isPublic: t.checked }); break;
      case 's-comment': setV({ descrlong: t.value === '' ? null : t.value }); break;
      case 't-name': if (t.value.trim()) op({ kind: 'renameStep', ref: stepRef(), to: t.value.trim() }); break;
      case 't-descr': setT({ descr: t.value || ' ' }); break;
      case 't-commit': setT({ commitAfter: t.value }); break;
      case 't-freq': setT({ commitFrequency: Math.max(0, Number(t.value) || 0) }); break;
      case 't-onerror': setT({ onError: t.value }); break;
      case 't-active': setT({ active: t.checked }); break;
      case 't-comment': setT({ descrlong: t.value === '' ? null : t.value }); break;
      case 't-norows': setT({ onNoRows: t.value }); break;
      case 't-onreturn': setT({ onReturn: t.value }); break;
      case 'a-type': op({ kind: 'changeActionType', ref: actionRef(), type: t.value }); break;
      case 'a-descr': setA({ descr: t.value || ' ' }); break;
      case 'a-reuse': setA({ reuse: t.value }); break;
      case 'a-dst': setA({ doSelectType: t.value }); break;
      case 'a-comment': setA({ descrlong: t.value === '' ? null : t.value }); break;
      case 'c-program': { const prog = t.value.trim().toUpperCase(); setT({ doProgram: prog || d.name, doSection: ' ' }); break; }
      case 'c-section': setT({ doSection: t.value.trim() || ' ', doProgram: f.step.doProgram.trim() ? f.step.doProgram : d.name }); break;
      case 'c-dynamic': setT(t.checked ? { dynamic: true, doSection: ' ', doProgram: ' ' } : { dynamic: false, doProgram: d.name }); break;
      case 'm-set': setT({ messageSet: Math.max(0, Number(t.value) || 0) }); break;
      case 'm-num': setT({ messageNumber: Math.max(0, Number(t.value) || 0) }); break;
      case 'm-parms': setT({ messageParms: t.value || ' ' }); break;
    }
  });

  // Lookups as the user types into the list-backed fields.
  let lookupTimer;
  document.addEventListener('input', (e) => {
    const t = e.target;
    const map = { 'p-state-q': ['stateRecords', 'dl-states'], 'p-temp-q': ['tempTables', 'dl-temps'], 'c-program': ['programs', 'dl-programs'], 's-market': ['markets', 'dl-markets'] };
    const m = map[t.id];
    if (!m) return;
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(async () => {
      const items = m[0] === 'markets' ? (cache.markets = cache.markets || await choices('markets')) : await choices(m[0], t.value.trim());
      const dl = $(m[1]);
      if (dl) dl.innerHTML = items.map((i) => `<option value="${esc(i.value)}">${esc(i.label || '')}</option>`).join('');
    }, 200);
  });
  document.addEventListener('focusin', async (e) => {
    if (e.target.id === 'c-section' && e.target.tagName === 'INPUT') {
      const items = await choices('sections', find().step.doProgram.trim());
      const dl = $('dl-sections');
      if (dl) dl.innerHTML = items.filter((i) => i.label === 'Y').map((i) => `<option value="${esc(i.value)}">Public</option>`).join('');
    }
    if (e.target.id === 's-market') { cache.markets = cache.markets || await choices('markets'); const dl = $('dl-markets'); if (dl) dl.innerHTML = cache.markets.map((i) => `<option value="${esc(i.value)}">${esc(i.label || '')}</option>`).join(''); }
  });

  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); if (inField) e.target.blur(); post({ type: 'save' }); return; }
    if (inField) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); return; }
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); post({ type: 'undo' }); return; }
    if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); post({ type: 'redo' }); return; }
    if (ctrl && e.key.toLowerCase() === 'c') { copy(); return; }
    if (ctrl && e.key.toLowerCase() === 'x') { cut(); return; }
    if (ctrl && e.key.toLowerCase() === 'v') { paste(); return; }
    if (e.key === 'Delete') { del(); return; }
    if (e.key === 'F5') { e.preventDefault(); render(); return; }
    if (e.key === 'F2') { const n = $('s-name') || $('t-name'); if (n && !n.disabled) { n.focus(); n.select(); } return; }
    if (e.key === 'Escape') { $('menu').hidden = true; return; }
    if (e.key === 'Enter' && sel.kind === 'action') { const a = find().action; if (a && (SQLY.includes(a.type) || a.type === 'P' || a.type === 'X')) post({ type: 'openText', ref: stepRef(), action: a.type }); return; }
    if (view !== 'definition' || !rows.length) return;
    const i = rows.findIndex((r) => r.kind === sel.kind && r.section === sel.section && sameV(r.variant, sel.variant) && r.step === sel.step && r.action === sel.action);
    if (e.key === 'ArrowDown') { e.preventDefault(); select(rows[Math.min(rows.length - 1, i + 1)]); }
    if (e.key === 'ArrowUp') { e.preventDefault(); select(rows[Math.max(0, i - 1)]); }
    const key = sel.kind === 'section' ? `s|${sel.section}|${vkey(sel.variant)}` : sel.kind === 'step' ? `t|${sel.section}|${vkey(sel.variant)}|${sel.step}` : '';
    if (e.key === 'ArrowLeft' && key) { collapsed.add(key); persist(); render(); }
    if (e.key === 'ArrowRight' && key) { collapsed.delete(key); persist(); render(); }
  });

  // Splitter
  let drag = false;
  $('splitter').addEventListener('mousedown', () => { drag = true; });
  document.addEventListener('mouseup', () => { drag = false; });
  document.addEventListener('mousemove', (e) => { if (drag) $('props').style.width = `${Math.max(260, window.innerWidth - e.clientX)}px`; });

  // ---------------------------------------------------------------- messages
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      state = m;
      if (m.select) sel = { kind: m.select.action ? 'action' : m.select.step !== undefined ? 'step' : m.select.section ? 'section' : 'program', ...m.select };
      if (sel.kind !== 'program' && !sel.variant && state.doc) {
        const s = state.doc.sections.find((x) => x.name === sel.section);
        if (s) sel.variant = vobj(s.variants[0]);
      }
      validateSelection();
      if (m.status) { status = m.status; statusError = false; }
      if (m.clipboard) clipboard = m.clipboard;
      persist();
      render();
    } else if (m.type === 'error') {
      status = m.message; statusError = true; renderToolbar();
    } else if (m.type === 'choices') {
      const r = pending.get(m.id); pending.delete(m.id); if (r) r(m.items || []);
    } else if (m.type === 'preview') {
      const s = m.summary;
      status = m.empty ? 'Nothing to save.' : `A save would write: ${s.inserted} inserted, ${s.updated} updated, ${s.deleted} deleted; ` +
        `${s.sqlChanged.length} SQL, ${s.peopleCodeChanged.length} PeopleCode; counters ${Object.entries(m.increments).filter(([, d]) => d).map(([n, d]) => `${n}+${d}`).join(' ')}` +
        `${s.tombstones.length ? `; tombstones ${s.tombstones.join(', ')}` : ''}.`;
      statusError = false;
      renderToolbar();
    }
  });
  post({ type: 'ready' });
}());
