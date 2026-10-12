// Customization Plan editor (src/editors/customizationPlanPanel.ts): a PREVIEW. The five stages can be walked and a
// requirement typed; nothing is discovered, validated, approved or written, and every action is disabled.
(function () {
  'use strict';
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage() {}, getState() {}, setState() {} };
  const config = JSON.parse(document.getElementById('config').textContent);
  const saved = vscode.getState() || {};
  let stage = saved.stage || 0;
  let requirement = saved.requirement || '';
  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e[k] = v;
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  };
  const save = () => vscode.setState({ stage, requirement });
  const t = config.target;

  function header() {
    return el('header', null,
      el('div', { class: 'title' }, el('h1', null, 'Customization Plan'), el('span', { class: 'badge' }, 'Draft')),
      el('div', { class: 'sub' }, t ? `${t.name} · ${t.kind}${t.connection ? ' · ' + t.connection : ''} · ${config.policy.strategy}` : 'No PeopleSoft definition selected'),
      el('div', { class: 'preview' }, 'Preview — Customization Intelligence is not connected yet. Nothing here inspects the database, and no step can be approved or applied.'));
  }

  function stepper() {
    return el('nav', { class: 'stepper' }, config.stages.map((s, i) =>
      el('button', { class: 'step' + (i === stage ? ' on' : '') + (i < stage ? ' done' : ''), onclick: () => { stage = i; save(); render(); } },
        el('span', { class: 'num' }, String(i + 1)), s)));
  }

  const muted = (text) => el('div', { class: 'muted' }, text);
  const row = (label, value, cls) => el('div', { class: 'kv' + (cls ? ' ' + cls : '') }, el('span', null, label), el('span', null, value));

  function body() {
    switch (stage) {
      case 0: return el('section', null,
        el('h2', null, '1. Requirement'),
        row('Target', t ? `${t.name} (${t.kind})` : 'None — open a definition and use Open Plan Designer from Customization Strategy'),
        row('Environment', t && t.connection ? t.connection : 'Unknown'),
        el('label', { class: 'block' }, 'Business change',
          el('textarea', { rows: 6, placeholder: 'e.g. Add a classification field to the delivered page, store it, and validate it on save.', value: requirement,
            oninput: (e) => { requirement = e.target.value; save(); } })),
        muted('The requirement stays in this tab; plans are not stored yet.'));
      case 1: return el('section', null,
        el('h2', null, '2. Discover environment capabilities'),
        config.frameworks.length
          ? el('div', { class: 'list' }, config.frameworks.map((f) => el('div', { class: 'cap' },
              el('div', null, el('strong', null, f.label), el('div', { class: 'muted' }, f.purpose)),
              el('div', { class: 'state' }, f.state), el('div', { class: 'muted small' }, 'To verify: ' + f.mustVerify),
              el('button', { disabled: true, title: 'Not available yet' }, 'Discover'))))
          : muted('No configuration framework is documented for this definition type.'),
        muted('Actual results must come from inspecting the PeopleSoft environment. Nothing is shown as available until it has been verified.'));
      case 2: return el('section', null,
        el('h2', null, '3. Strategy'),
        muted('Ranked alternatives appear here once discovery has results. A plan may combine mechanisms — a custom record, a subpage in a drop zone, Event Mapping for validation.'),
        el('table', null,
          el('thead', null, el('tr', null, el('th', null, 'Criterion'), el('th', null, 'Configuration-based extension'), el('th', null, 'Direct modification'))),
          el('tbody', null, [
            ['Delivered definitions changed', 'Normally no', 'Yes'],
            ['Upgrade retrofit', 'Generally reduced', 'Greater potential'],
            ['Dependency testing', 'Required', 'Required'],
            ['Framework eligibility', 'Must be demonstrated', 'Not applicable'],
            ['Approval', 'Normal write policy', 'Delivered-object policy: ' + config.policy.delivered],
            ['Execution', 'Configuration adapters, custom-object writers', 'Existing definition writers']
          ].map((r) => el('tr', null, r.map((c) => el('td', null, c)))))));
      case 3: return el('section', null,
        el('h2', null, '4. Validate'),
        el('div', { class: 'list' }, [
          ['Ownership of every target', 'Not run'], ['Framework prerequisites', 'Not run'], ['Organization naming' + (config.policy.prefix ? ` (${config.policy.prefix})` : ''), 'Not run'],
          ['Delivered-object changes', 'Not run'], ['Policy', 'Not run']
        ].map(([k, v]) => row(k, v, 'muted-row'))),
        el('button', { disabled: true, title: 'Not available yet' }, 'Validate Plan'));
      default: return el('section', null,
        el('h2', null, '5. Approval'),
        el('div', { class: 'dialog' },
          el('div', { class: 'dtitle' }, 'Delivered Object Modification'),
          row('Environment', t && t.connection ? t.connection : '—'), row('Object', t ? t.name : '—'), row('Change type', 'Direct definition edit'), row('Authorization', 'Required'),
          el('label', { class: 'block' }, 'Reason configuration was rejected', el('textarea', { rows: 3, disabled: true, placeholder: 'Filled from the plan\'s evidence. An unverified alternative is not grounds to declare configuration impossible.' })),
          el('label', { class: 'block' }, 'Proposed object changes', muted('A definition diff is required before authorization.')),
          el('label', { class: 'check' }, el('input', { type: 'checkbox', disabled: true }), 'I have reviewed the exact proposed changes.'),
          el('label', { class: 'check' }, el('input', { type: 'checkbox', disabled: true }), 'I have reviewed the upgrade and retrofit implications.'),
          el('div', { class: 'buttons' }, el('button', { disabled: true }, 'Request Authorization'))),
        muted('No approval is issued from this preview. Approvals will be issued by the server, bound to the plan, the object revisions, the policy and the connection.'));
    }
  }

  function footer() {
    return el('footer', null,
      el('button', { disabled: stage === 0, onclick: () => { stage--; save(); render(); } }, 'Back'),
      el('button', { class: 'link', onclick: () => vscode.postMessage({ type: 'openSettings' }) }, 'Customization settings…'),
      el('button', { class: 'primary', disabled: stage === config.stages.length - 1, onclick: () => { stage++; save(); render(); } }, 'Next'));
  }

  function render() { document.getElementById('app').replaceChildren(header(), stepper(), body(), footer()); }
  render();
})();
