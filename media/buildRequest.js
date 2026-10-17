// Build Request page (src/editors/buildRequestPanel.ts): the request and its attachments, the hand-off to an agent,
// its questions, the build spec to review and approve, and the build's progress. Every decision is posted to the
// extension, which owns the request; the page only renders the state it is sent.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let state = null, mcp = { running: false, writes: false }, agent = 'claude', agentKnown = false;
  /** Text the developer is typing, by field id, kept over re-renders until it is saved. */
  const drafts = {};
  const open = new Set((vscode.getState() || {}).open || []);
  const timers = {};

  const AGENTS = { claude: 'Claude Code', codex: 'Codex', clipboard: 'Copy prompt (any agent)' };
  const ROUTE = { TOOLS: 'Studio builds', MANUAL: 'Manual step', NONE: 'Existing' };
  const PROGRESS = { PENDING: 'Pending', BUILT: 'Built', STAGED: 'Staged for review', MANUAL: 'Manual step', FAILED: 'Failed', SKIPPED: 'Skipped' };

  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'fid') e.dataset.fid = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e[k] = v;
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  };
  const post = (m) => vscode.postMessage(m);
  const size = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const when = (iso) => iso ? new Date(iso).toLocaleString() : '';
  const value = (fid, saved) => fid in drafts ? drafts[fid] : saved;

  /** A text field that saves on blur and after a pause in typing. */
  function field(fid, saved, save, props, multi) {
    const flush = (e) => {
      clearTimeout(timers[fid]);
      if (fid in drafts && drafts[fid] !== saved) save(e.target.value);
      delete drafts[fid];
    };
    return el(multi ? 'textarea' : 'input', { ...props, fid, value: value(fid, saved),
      oninput: (e) => { drafts[fid] = e.target.value; clearTimeout(timers[fid]); timers[fid] = setTimeout(() => { if (drafts[fid] !== undefined) { save(drafts[fid]); } }, 900); },
      onchange: flush });
  }
  const edit = (key) => (v) => post({ type: 'edit', edit: { [key]: v } });

  function toggle(key) {
    if (open.has(key)) open.delete(key); else open.add(key);
    vscode.setState({ open: [...open] });
    render();
  }

  function stepper() {
    const s = state.status;
    const at = ['DRAFT'].includes(s) ? 0 : ['QUESTIONS', 'SPEC_PROPOSED', 'CHANGES_REQUESTED', 'SPEC_STALE'].includes(s) ? 2 : s === 'BUILT' ? 4 : 3;
    const steps = ['Describe', 'Analyze', 'Review spec', 'Build', 'Done'];
    return el('nav', { class: 'stepper' }, steps.map((label, i) => el('span', { class: 'step' + (i === at ? ' on' : '') + (i < at ? ' done' : '') },
      el('span', { class: 'num' }, i < at ? '✓' : String(i + 1)), label)));
  }

  function header() {
    return el('header', null,
      el('div', { class: 'title' },
        field('title', state.title, edit('title'), { class: 'title-input', 'aria-label': 'Title', placeholder: 'What is being built?' }),
        el('span', { class: 'badge s-' + state.status }, state.statusLabel)),
      el('div', { class: 'sub' }, `${state.id} · `,
        el('button', { class: 'link', onclick: () => post({ type: 'revealFolder' }) }, 'Open folder'), ' · ',
        el('button', { class: 'link danger', onclick: () => post({ type: 'delete' }) }, 'Delete request')),
      stepper());
  }

  function requestSection() {
    const kind = state.kinds.find((k) => k.value === state.kind);
    return el('section', null,
      el('h2', null, '1. The request'),
      el('div', { class: 'grid' },
        el('label', null, 'Kind', el('select', { onchange: (e) => edit('kind')(e.target.value) },
          state.kinds.map((k) => el('option', { value: k.value, selected: k.value === state.kind }, k.label))),
          el('span', { class: 'hint' }, kind ? kind.summary : '')),
        el('label', null, 'Connection', el('select', { onchange: (e) => edit('connection')(e.target.value) },
          el('option', { value: '', selected: !state.connection }, '— choose —'),
          state.connections.map((c) => el('option', { value: c, selected: c === state.connection }, c))),
          el('span', { class: 'hint' }, 'The environment the agent researches and builds on.')),
        el('label', null, 'Project', field('project', state.project, edit('project'), { placeholder: 'e.g. ZZ_INB_VENDOR', spellcheck: false }),
          el('span', { class: 'hint' }, 'Every built definition goes into this project.'))),
      el('label', { class: 'block' }, 'What is being asked for',
        field('narrative', state.narrative, edit('narrative'), { rows: 8, placeholder: 'Paste the business user\'s request, emails, meeting notes, constraints, deadlines, contacts — anything the documents do not say.' }, true)));
  }

  function attachmentsSection() {
    const rows = state.attachments.map((a) => el('div', { class: 'att' },
      el('span', { class: 'codicon' }, a.extraction === 'none' ? '📄' : '📝'),
      el('div', { class: 'att-main' }, el('div', { class: 'att-name' }, a.name),
        el('div', { class: 'hint' }, `${size(a.size)} · ` + (a.extraction === 'none'
          ? `original only — ${a.extractionNote || 'no text extracted'} (the agent opens the file itself)`
          : `text extracted (${a.extraction}, ${a.textLength.toLocaleString()} characters)`))),
      el('div', { class: 'att-actions' },
        a.extraction !== 'none' && el('button', { onclick: () => post({ type: 'openAttachment', attachmentId: a.id, asText: true }) }, 'View text'),
        el('button', { onclick: () => post({ type: 'openAttachment', attachmentId: a.id, asText: false }) }, 'Open'),
        el('button', { class: 'link danger', onclick: () => post({ type: 'removeAttachment', attachmentId: a.id }) }, 'Remove'))));
    return el('section', null,
      el('h2', null, 'Attachments'),
      el('p', { class: 'hint' }, 'Specs, mapping spreadsheets, sample files, WSDL/XSD, screenshots. Word, Excel, PowerPoint and text files are read into text; PDFs and images keep their original, which the agent opens directly. Stored with the request in VS Code\'s storage, not the workspace.'),
      rows.length ? el('div', { class: 'list' }, rows) : el('div', { class: 'empty' }, 'No attachments yet.'),
      el('button', { onclick: () => post({ type: 'addFiles' }) }, '+ Add files…'));
  }

  function agentPicker() {
    return el('select', { class: 'agent', onchange: (e) => { agent = e.target.value; render(); } },
      Object.entries(AGENTS).map(([v, label]) => el('option', { value: v, selected: v === agent }, label)));
  }

  function mcpNote() {
    return mcp.running ? null : el('div', { class: 'warn' }, 'The PeopleSoft Studio MCP server is not running; the agent reads the request through it. You will be offered to start it.');
  }

  function analyzeSection() {
    const last = state.handoffs.filter((h) => h.phase === 'analyze').pop();
    const revise = ['SPEC_STALE', 'CHANGES_REQUESTED'].includes(state.status);
    return el('section', null,
      el('h2', null, '2. Analyze'),
      el('p', { class: 'hint' }, 'The agent reads the request and the attachments, researches the connection read-only, asks you what the material leaves open, and proposes a build spec. It changes nothing in PeopleSoft until you approve the spec.'),
      mcpNote(),
      el('div', { class: 'row' }, agentPicker(),
        el('button', { class: state.spec && !revise ? '' : 'primary', onclick: () => post({ type: 'handoff', phase: 'analyze', agent }) },
          agent === 'clipboard' ? 'Copy analysis prompt' : (revise ? 'Ask ' + AGENTS[agent] + ' to revise' : state.spec ? 'Re-analyze with ' + AGENTS[agent] : 'Analyze with ' + AGENTS[agent]))),
      last && el('div', { class: 'hint' }, `Last handed to ${AGENTS[last.agent] || last.agent} ${when(last.at)}.`));
  }

  function questionsSection() {
    if (!state.questions.length) return null;
    return el('section', null,
      el('h2', null, `Questions from the agent${state.openQuestions ? ` (${state.openQuestions} open)` : ''}`),
      state.questions.map((q) => {
        const fid = 'answer:' + q.id;
        return el('div', { class: 'question' + (q.answer ? ' answered' : '') },
          el('div', { class: 'q' }, `${q.id}. ${q.text}`),
          q.why && el('div', { class: 'hint' }, 'Why: ' + q.why),
          field(fid, q.answer || '', (v) => post({ type: 'answer', questionId: q.id, answer: v }), { rows: 2, placeholder: 'Your answer' }, true));
      }),
      state.openQuestions === 0 && state.spec && state.spec.stale && el('div', { class: 'hint' }, 'All answered. Ask the agent to revise the spec with your answers (step 2).'));
  }

  function objectRow(o, i) {
    const key = 'obj:' + o.ref, isOpen = open.has(key), p = o.progress;
    return [
      el('tr', { class: 'obj' + (isOpen ? ' open' : ''), onclick: () => toggle(key) },
        el('td', null, el('span', { class: 'chev' }, isOpen ? '▾' : '▸'), String(i + 1)),
        el('td', null, o.kind),
        el('td', { class: 'mono' }, o.name),
        el('td', null, o.action),
        el('td', null, el('span', { class: 'route r-' + o.route.route, title: o.route.reason || (o.route.tools || []).join(', ') }, ROUTE[o.route.route])),
        el('td', null, p ? el('span', { class: 'prog p-' + p.status }, PROGRESS[p.status]) : el('span', { class: 'muted' }, state.approved && o.action !== 'reuse' ? 'Pending' : '—'))),
      isOpen && el('tr', { class: 'details' }, el('td', { colSpan: 6 },
        el('div', null, el('strong', null, 'Purpose: '), o.purpose),
        o.dependsOn.length > 0 && el('div', null, el('strong', null, 'Depends on: '), o.dependsOn.join(', ')),
        o.sources.length > 0 && el('div', null, el('strong', null, 'From: '), o.sources.join(', ')),
        el('div', null, el('strong', null, 'Studio: '), o.route.route === 'TOOLS' ? `builds it with ${o.route.tools.join(', ')}` : o.route.reason),
        o.details && el('pre', null, o.details),
        p && el('div', { class: 'progress-detail' }, el('strong', null, `${PROGRESS[p.status]} ${when(p.at)}: `), el('pre', null, p.detail),
          p.changeSetId && el('button', { onclick: (e) => { e.stopPropagation(); post({ type: 'openChangeSet', changeSetId: p.changeSetId }); } }, 'Open in Change Review'))))
    ];
  }

  function specSection() {
    const s = state.spec;
    if (!s) return null;
    const manual = s.objects.filter((o) => o.route.route === 'MANUAL').length;
    const feedbackNow = state.feedback.filter((f) => f.specRevision === s.revision);
    return el('section', null,
      el('h2', null, `3. Build spec — revision ${s.revision}`),
      el('div', { class: 'hint' }, `Proposed ${when(s.proposedAt)} · ${s.objects.length} objects` + (manual ? ` · ${manual} manual step${manual > 1 ? 's' : ''} (Studio cannot build ${manual > 1 ? 'them' : 'it'} yet)` : '')),
      s.stale && el('div', { class: 'warn' }, 'The request changed after this spec was proposed (an answer, an attachment or the description). Ask the agent to revise it before approving.'),
      el('pre', { class: 'summary' }, s.summary),
      el('table', null,
        el('thead', null, el('tr', null, ['#', 'Kind', 'Name', 'Action', 'Studio', 'Progress'].map((h) => el('th', null, h)))),
        el('tbody', null, s.objects.map(objectRow))),
      s.mappings.length > 0 && el('details', { open: open.has('mappings'), ontoggle: (e) => { if (e.target.open !== open.has('mappings')) toggle('mappings'); } },
        el('summary', null, `Field mappings (${s.mappings.length})`),
        el('table', null, el('thead', null, el('tr', null, el('th', null, 'Source'), el('th', null, 'Target'), el('th', null, 'Rule'))),
          el('tbody', null, s.mappings.map((m) => el('tr', null, el('td', { class: 'mono' }, m.source), el('td', { class: 'mono' }, m.target), el('td', null, m.rule)))))),
      s.assumptions.length > 0 && el('div', null, el('h3', null, 'Assumptions'), el('ul', null, s.assumptions.map((a) => el('li', null, a)))),
      s.testPlan && el('div', null, el('h3', null, 'Test plan'), el('pre', null, s.testPlan)),
      feedbackNow.length > 0 && el('div', null, el('h3', null, 'Your requested changes'), el('ul', null, feedbackNow.map((f) => el('li', null, f.text)))),
      !state.approved && el('div', { class: 'review' },
        el('textarea', { fid: 'feedback', rows: 3, value: value('feedback', ''), placeholder: 'What should change? The agent revises the spec from this.', oninput: (e) => { drafts.feedback = e.target.value; } }),
        el('div', { class: 'row end' },
          el('button', { onclick: () => { const t = drafts.feedback || ''; if (t.trim()) { post({ type: 'requestChanges', text: t }); delete drafts.feedback; render(); } } }, 'Request changes'),
          el('button', { class: 'primary', disabled: !!state.approvalBlocker, title: state.approvalBlocker || '', onclick: () => post({ type: 'approve', specRevision: s.revision }) }, 'Approve spec')),
        state.approvalBlocker && el('div', { class: 'hint end' }, state.approvalBlocker)),
      state.approved && el('div', { class: 'ok' }, `Approved ${when(state.approval.at)}. Changing the request or the spec withdraws approval.`));
  }

  function buildSection() {
    if (!state.approved) return null;
    const objs = state.spec.objects.filter((o) => o.action !== 'reuse');
    const count = (st) => objs.filter((o) => (o.progress ? o.progress.status : 'PENDING') === st).length;
    const sets = [...new Set(objs.map((o) => o.progress && o.progress.changeSetId).filter(Boolean))];
    return el('section', null,
      el('h2', null, '4. Build'),
      el('p', { class: 'hint' }, 'The agent builds only what the approved spec lists, in dependency order, through Studio\'s write tools — each write still asks for your confirmation or lands in Change Review — and leaves manual steps for what Studio cannot build yet.'),
      !mcp.writes && el('div', { class: 'warn' }, 'MCP writes are off (peoplesoft.mcp.writes): the agent can research and report, but not create definitions.'),
      mcpNote(),
      el('div', { class: 'row' }, agentPicker(),
        el('button', { class: 'primary', onclick: () => post({ type: 'handoff', phase: 'build', agent }) },
          agent === 'clipboard' ? 'Copy build prompt' : (count('PENDING') < objs.length ? 'Continue build with ' : 'Build with ') + AGENTS[agent])),
      el('div', { class: 'counts' }, ['BUILT', 'STAGED', 'MANUAL', 'FAILED', 'SKIPPED', 'PENDING'].map((st) =>
        el('span', { class: 'prog p-' + st }, `${PROGRESS[st]}: ${count(st)}`))),
      sets.map((id) => el('button', { onclick: () => post({ type: 'openChangeSet', changeSetId: id }) }, `Open Change Set ${id.slice(0, 8)}…`)));
  }

  function render() {
    if (!state) { app.replaceChildren(el('div', { class: 'empty' }, 'Loading…')); return; }
    const active = document.activeElement, fid = active && active.dataset ? active.dataset.fid : undefined;
    const sel = fid && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    app.replaceChildren(...[header(), requestSection(), attachmentsSection(), analyzeSection(), questionsSection(), specSection(), buildSection()].filter(Boolean));
    if (fid) {
      const again = app.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
      if (again) { again.focus(); if (sel) try { again.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
    }
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type !== 'state') return;
    state = m.state; mcp = m.mcp;
    if (!agentKnown) { agent = m.agent || 'claude'; agentKnown = true; }
    render();
  });
  render();
  post({ type: 'ready' });
})();
