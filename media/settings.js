// @ts-check
/*
 * PeopleSoft Studio Settings page.
 *
 * Renders the SettingsState the extension host sends (see
 * src/settings/settingsMessages.ts) and posts user actions back. The only
 * state kept here is unsaved form input; everything else is re-rendered from
 * the latest host state. Values are only ever written with textContent or as
 * attribute values, never parsed as HTML.
 */
(function () {
  // @ts-ignore -- provided by the webview host
  const vscode = acquireVsCodeApi();

  /** @typedef {{ type: string, [key: string]: unknown }} Message */

  /** @type {any} The latest SettingsState. */
  let state;

  // Unsaved input, kept across re-renders and panel hide/show.
  const saved = vscode.getState() || {};
  /** @type {Record<string, string>} keyed "setting:<key>" or "conn:<id>:<field>" */
  const drafts = saved.drafts || {};
  /** @type {string[]} connection ids with an open edit form */
  let editing = saved.editing || [];
  /** @type {Record<string, Record<string, string>>} keyed like drafts' prefixes */
  const errors = {};

  function persist() {
    vscode.setState({ drafts, editing });
  }

  /** @param {Message} message */
  function post(message) {
    vscode.postMessage(message);
  }

  const SOURCE_LABELS = {
    global: 'User',
    workspace: 'Workspace',
    workspaceFolder: 'Workspace Folder'
  };

  const SECTIONS = [
    { id: 'connections', title: 'Connections' },
    { id: 'peoplecode', title: 'PeopleCode' },
    { id: 'compiler', title: 'Compiler / Analysis' },
    { id: 'mcp', title: 'AI Integration' },
    { id: 'advanced', title: 'Advanced' }
  ];

  // --- DOM helpers ---------------------------------------------------------

  /**
   * @param {string} tag
   * @param {{ className?: string, text?: string, attrs?: Record<string, string>, on?: Record<string, (e: Event) => void> }} [props]
   * @param {(Node | string | null | undefined | false)[]} [children]
   * @returns {HTMLElement}
   */
  function h(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.text !== undefined) node.textContent = props.text;
    for (const [name, value] of Object.entries(props.attrs || {})) node.setAttribute(name, value);
    for (const [event, handler] of Object.entries(props.on || {})) node.addEventListener(event, handler);
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  /** @param {string} text @param {'neutral'|'scope'|'ok'|'off'|'warn'|'error'} kind @param {string} [title] */
  function badge(text, kind, title) {
    return h('span', { className: `badge ${kind}`, text, attrs: title ? { title } : {} });
  }

  /** @param {string} text @param {() => void} onClick @param {{ secondary?: boolean, disabled?: boolean, title?: string, focusKey?: string }} [opts] */
  function button(text, onClick, opts = {}) {
    const attrs = { type: 'button' };
    if (opts.title) attrs.title = opts.title;
    if (opts.focusKey) attrs['data-focus-key'] = opts.focusKey;
    const node = /** @type {HTMLButtonElement} */ (h('button', { className: opts.secondary ? 'secondary' : '', text, attrs, on: { click: onClick } }));
    node.disabled = !!opts.disabled;
    return node;
  }

  /** @param {Record<string, string>} pairs */
  function facts(pairs) {
    const dl = h('dl', { className: 'facts' });
    for (const [term, value] of Object.entries(pairs)) {
      dl.append(h('dt', { text: term }), h('dd', { className: 'mono', text: value }));
    }
    return dl;
  }

  /** @param {string | undefined} message @param {string} id */
  function errorText(message, id) {
    return message ? h('p', { className: 'error-text', text: message, attrs: { id, role: 'alert' } }) : null;
  }

  function sourceBadge(source) {
    return source && source !== 'default'
      ? badge(SOURCE_LABELS[source] || source, 'scope', `Defined in ${SOURCE_LABELS[source] || source} settings; changes are saved there.`)
      : null;
  }

  // --- Sections ------------------------------------------------------------

  function renderConnections() {
    const section = h('section', { attrs: { id: 'connections', 'aria-labelledby': 'connections-title' } }, [
      h('h2', { text: 'Connections', attrs: { id: 'connections-title' } }),
      h('p', { className: 'description' }, [
        'PeopleSoft environments, stored in ',
        h('code', { text: 'peoplesoft.connections' }),
        state.connectionsSource !== 'default' ? ` (${SOURCE_LABELS[state.connectionsSource]} settings)` : '',
        '. Passwords are kept in the OS secret store and are never shown here.'
      ])
    ]);

    section.append(renderTarget());

    if (state.connections.length === 0) {
      section.append(h('div', { className: 'empty', text: 'No connections are configured.' }));
    } else {
      const list = h('div', { className: 'connections' });
      for (const connection of state.connections) list.append(renderConnection(connection));
      section.append(list);
    }

    section.append(h('div', { className: 'actions' }, [
      button('Add Connection…', () => post({ type: 'addConnection' }), { focusKey: 'add-connection' })
    ]));
    return section;
  }

  /**
   * The workspace target, for information only. It is chosen in the
   * Connections view or the status bar; Settings never changes it.
   */
  function renderTarget() {
    const target = state.connections.find((c) => c.selected);
    if (!target) {
      const stale = state.selectedConnectionId !== undefined;
      return h('p', { className: 'current-target', attrs: { 'aria-live': 'polite' } }, [
        h('strong', { text: 'Current target:' }),
        stale ? 'the previously selected connection is no longer configured.' : 'none.',
        h('span', { className: 'hint', text: 'Choose one in the Connections view or the status bar.' })
      ]);
    }
    return h('p', { className: 'current-target', attrs: { 'aria-live': 'polite' } }, [
      h('strong', { text: 'Current target:' }),
      h('span', { className: 'mono', text: target.name }),
      target.connected ? badge('Connected', 'ok') : badge('Not connected', 'off'),
      h('span', { className: 'hint', text: 'Change it in the Connections view or the status bar.' })
    ]);
  }

  function renderConnection(c) {
    const busy = c.test && c.test.status === 'testing';
    const head = h('div', { className: 'connection-head' }, [
      h('h3', { text: c.name }),
      h('span', { className: 'kind', text: c.kindLabel }),
      c.selected ? badge('Target', 'neutral', 'The workspace target connection, chosen in the Connections view or the status bar') : null,
      c.connected ? badge('Connected', 'ok') : badge('Not connected', 'off'),
      badge(c.access.label, 'warn', c.access.detail)
    ]);

    const details = c.kind === 'oracle'
      ? facts({ 'Connect string': c.connectString || '—', 'Access id': c.user || '—' })
      : facts({ 'Project file': c.path || '—' });

    const env = c.environment;
    if (env.status === 'available') {
      details.append(
        h('dt', { text: 'PeopleTools' }),
        h('dd', { className: 'mono', text: env.profile.ok ? `${env.release} · ${env.profile.id}` : env.release }));
    }

    const actions = h('div', { className: 'actions' }, [
      button(busy ? 'Testing…' : 'Test Connection', () => post({ type: 'testConnection', connectionId: c.id }),
        { disabled: busy, focusKey: `test:${c.id}`, title: 'Connect a temporary session and read PSSTATUS; the live connection is not affected.' }),
      button('Edit', () => toggleEdit(c.id), { secondary: true, focusKey: `edit:${c.id}`, disabled: editing.includes(c.id) }),
      button('Remove…', () => post({ type: 'removeConnection', connectionId: c.id }), { secondary: true, focusKey: `remove:${c.id}` })
    ]);

    return h('div', { className: c.selected ? 'connection selected' : 'connection', attrs: { 'data-connection': c.id } }, [
      head,
      details,
      actions,
      renderTestResult(c),
      editing.includes(c.id) ? renderEditForm(c) : null
    ]);
  }

  function renderTestResult(c) {
    if (!c.test) return null;
    const attrs = { role: 'status', 'aria-live': 'polite' };
    switch (c.test.status) {
      case 'testing':
        return h('p', { className: 'test-result hint', text: 'Testing…', attrs });
      case 'succeeded':
        return h('p', { className: 'test-result ok', text: c.test.release ? `Connected · PeopleTools ${c.test.release}` : 'Connected', attrs });
      case 'failed':
        return h('p', { className: 'test-result failed', text: `Failed: ${c.test.message}`, attrs });
    }
    return null;
  }

  const FIELD_LABELS = {
    connectString: { label: 'Connect string', placeholder: 'host:1521/SERVICE' },
    user: { label: 'Database access id', placeholder: 'SYSADM' },
    path: { label: 'Project file', placeholder: '/path/to/export.xml' }
  };

  function toggleEdit(id) {
    editing = editing.includes(id) ? editing.filter((e) => e !== id) : [...editing, id];
    if (!editing.includes(id)) clearConnectionDrafts(id);
    persist();
    render();
  }

  function clearConnectionDrafts(id) {
    for (const key of Object.keys(drafts)) if (key.startsWith(`conn:${id}:`)) delete drafts[key];
    delete errors[`conn:${id}`];
  }

  function renderEditForm(c) {
    const formErrors = errors[`conn:${c.id}`] || {};
    const form = h('form', { className: 'edit-form', attrs: { 'aria-label': `Edit ${c.name}` } });

    for (const field of c.editableFields) {
      const meta = FIELD_LABELS[field];
      const draftKey = `conn:${c.id}:${field}`;
      const inputId = `edit-${c.id}-${field}`;
      const errorId = `${inputId}-error`;
      const input = /** @type {HTMLInputElement} */ (h('input', {
        attrs: {
          type: 'text', id: inputId, spellcheck: 'false', autocomplete: 'off',
          placeholder: meta.placeholder, 'data-focus-key': draftKey,
          ...(formErrors[field] ? { 'aria-invalid': 'true', 'aria-describedby': errorId } : {})
        },
        on: { input: (e) => { drafts[draftKey] = /** @type {HTMLInputElement} */ (e.target).value; persist(); } }
      }));
      input.value = draftKey in drafts ? drafts[draftKey] : (c[field] || '');
      form.append(h('div', { className: 'field' }, [
        h('label', { text: meta.label, attrs: { for: inputId } }),
        input,
        errorText(formErrors[field], errorId)
      ]));
    }

    form.append(
      h('p', { className: 'hint', text: 'The name identifies the connection, its stored password and its open editors, so it cannot be changed here.' }),
      c.connected ? h('p', { className: 'hint', text: 'Changes apply the next time this connection connects.' }) : null,
      errorText(formErrors.form, `edit-${c.id}-form-error`),
      h('div', { className: 'actions' }, [
        h('button', { text: 'Save', attrs: { type: 'submit' } }),
        button('Cancel', () => toggleEdit(c.id), { secondary: true })
      ])
    );

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      /** @type {Record<string, string>} */
      const edit = {};
      for (const field of c.editableFields) {
        const draftKey = `conn:${c.id}:${field}`;
        edit[field] = draftKey in drafts ? drafts[draftKey] : (c[field] || '');
      }
      post({ type: 'updateConnection', connectionId: c.id, edit });
    });
    form.addEventListener('keydown', (e) => {
      if (/** @type {KeyboardEvent} */ (e).key === 'Escape') toggleEdit(c.id);
    });
    return form;
  }

  function renderSetting(s) {
    const draftKey = `setting:${s.key}`;
    const settingErrors = errors[draftKey] || {};
    const inputId = `setting-${s.key.replace(/\W/g, '-')}`;
    const errorId = `${inputId}-error`;
    const describedBy = settingErrors.value ? `${inputId}-desc ${errorId}` : `${inputId}-desc`;
    let control;
    let optionHint = null;

    if (s.control.kind === 'enum') {
      const select = /** @type {HTMLSelectElement} */ (h('select', {
        attrs: { id: inputId, 'data-focus-key': draftKey, 'aria-describedby': describedBy },
        on: { change: (e) => post({ type: 'updateSetting', key: s.key, value: /** @type {HTMLSelectElement} */ (e.target).value }) }
      }));
      for (const option of s.control.options) {
        const node = /** @type {HTMLOptionElement} */ (h('option', { text: option.label, attrs: { value: option.value } }));
        node.selected = option.value === s.value;
        select.append(node);
      }
      const current = s.control.options.find((o) => o.value === s.value);
      if (current) optionHint = h('p', { className: 'hint', text: current.description });
      control = h('div', { className: 'control-row' }, [select]);
    } else {
      const input = /** @type {HTMLInputElement} */ (h('input', {
        attrs: {
          type: 'text', id: inputId, spellcheck: 'false', autocomplete: 'off',
          placeholder: s.control.placeholder, 'data-focus-key': draftKey, 'aria-describedby': describedBy,
          ...(settingErrors.value ? { 'aria-invalid': 'true' } : {})
        }
      }));
      input.value = draftKey in drafts ? drafts[draftKey] : s.value;
      const save = button('Save', () => post({ type: 'updateSetting', key: s.key, value: input.value }), { focusKey: `${draftKey}:save` });
      const syncDirty = () => { save.disabled = input.value === s.value; };
      input.addEventListener('input', () => {
        if (input.value === s.value) delete drafts[draftKey];
        else drafts[draftKey] = input.value;
        persist();
        syncDirty();
      });
      input.addEventListener('keydown', (e) => {
        const key = /** @type {KeyboardEvent} */ (e).key;
        if (key === 'Enter' && !save.disabled) save.click();
        if (key === 'Escape') { delete drafts[draftKey]; delete errors[draftKey]; persist(); render(); }
      });
      syncDirty();
      control = h('div', { className: 'control-row' }, [input, save]);
    }

    return h('div', { className: 'setting' }, [
      h('div', { className: 'setting-title' }, [
        h('label', { text: s.label, attrs: { for: inputId } }),
        sourceBadge(s.source)
      ]),
      h('p', { className: 'description', text: s.description, attrs: { id: `${inputId}-desc` } }),
      control,
      optionHint,
      errorText(settingErrors.value, errorId),
      s.appliesWhen ? h('p', { className: 'hint', text: s.appliesWhen }) : null
    ]);
  }

  function renderSettingsSection(id, title, description) {
    const settings = state.settings.filter((s) => s.section === id);
    return h('section', { attrs: { id, 'aria-labelledby': `${id}-title` } }, [
      h('h2', { text: title, attrs: { id: `${id}-title` } }),
      description ? h('p', { className: 'description', text: description }) : null,
      ...settings.map(renderSetting)
    ]);
  }

  function renderCompiler() {
    const section = h('section', { attrs: { id: 'compiler', 'aria-labelledby': 'compiler-title' } }, [
      h('h2', { text: 'Compiler / Analysis', attrs: { id: 'compiler-title' } }),
      h('p', {
        className: 'description',
        text: 'For the current target connection, read from its PSSTATUS. The compiler profile follows the PeopleTools release automatically and is not configurable.'
      })
    ]);

    const target = state.connections.find((c) => c.selected);
    if (!target) {
      section.append(h('p', { className: 'hint', text: 'No target connection. Choose one in the Connections view or the status bar.' }));
      return section;
    }

    const env = target.environment;
    /** @type {Record<string, string>} */
    const rows = { Connection: target.name };
    let note = null;

    switch (env.status) {
      case 'not-connected':
        rows['PeopleTools release'] = 'Not connected';
        note = h('p', { className: 'hint', text: 'Connect to read the release.' });
        break;
      case 'not-applicable':
        rows['PeopleTools release'] = 'Not available';
        note = h('p', { className: 'hint', text: env.reason });
        break;
      case 'loading':
        rows['PeopleTools release'] = 'Reading PSSTATUS…';
        break;
      case 'error':
        rows['PeopleTools release'] = 'Unknown';
        note = h('p', { className: 'error-text', text: `Could not read PSSTATUS: ${env.message}` });
        break;
      case 'available':
        rows['PeopleTools release'] = env.release;
        rows['Compiler profile'] = env.profile.ok ? env.profile.id : 'None';
        if (!env.profile.ok) {
          note = h('p', { className: 'error-text', text: `Unknown compiler profile mapping: ${env.profile.message}` });
        }
        break;
    }

    section.append(facts(rows));
    if (note) section.append(note);
    return section;
  }

  function renderMcp() {
    const mcp = state.mcp;
    if (!mcp) return null;
    const statusBadge = {
      running: badge('Running', 'ok'),
      starting: badge('Starting…', 'off'),
      stopped: badge('Stopped', 'off'),
      error: badge('Error', 'error')
    }[mcp.status];

    const running = mcp.status === 'running';
    return h('section', { attrs: { id: 'mcp', 'aria-labelledby': 'mcp-title' } }, [
      h('h2', { text: 'AI Integration', attrs: { id: 'mcp-title' } }),
      h('p', { className: 'description', text: 'The local MCP server that gives AI clients read access to your connected PeopleSoft environments.' }),
      h('div', { className: 'control-row' }, [h('strong', { text: 'MCP server' }), statusBadge]),
      facts({ URL: mcp.url }),
      mcp.error ? h('p', { className: 'error-text', text: mcp.error }) : null,
      h('div', { className: 'actions' }, [
        running
          ? button('Stop', () => post({ type: 'mcp', action: 'stop' }), { secondary: true, focusKey: 'mcp:stop' })
          : button('Start', () => post({ type: 'mcp', action: 'start' }), { secondary: true, focusKey: 'mcp:start', disabled: mcp.status === 'starting' }),
        running ? button('Restart', () => post({ type: 'mcp', action: 'restart' }), { secondary: true, focusKey: 'mcp:restart' }) : null,
        button('Copy URL', () => post({ type: 'mcp', action: 'copyUrl' }), { secondary: true, focusKey: 'mcp:copy' }),
        button('Configure AI Client…', () => post({ type: 'mcp', action: 'configureClient' }), { secondary: true, focusKey: 'mcp:configure' })
      ])
    ]);
  }

  function renderToc(hasMcp) {
    const toc = document.getElementById('toc');
    if (!toc) return;
    toc.replaceChildren(...SECTIONS
      .filter((s) => s.id !== 'mcp' || hasMcp)
      .map((s) => h('a', { text: s.title, attrs: { href: `#${s.id}` } })));
  }

  // --- Render loop ---------------------------------------------------------

  function render() {
    const root = document.getElementById('root');
    if (!root || !state) return;

    // Re-rendering replaces the DOM; keep focus and caret where the user left them.
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const focusKey = active && active.getAttribute('data-focus-key');
    const selection = active instanceof HTMLInputElement
      ? [active.selectionStart, active.selectionEnd] : undefined;

    renderToc(!!state.mcp);
    root.replaceChildren(...[
      renderConnections(),
      renderSettingsSection('peoplecode', 'PeopleCode', ''),
      renderCompiler(),
      renderMcp(),
      renderSettingsSection('advanced', 'Advanced', 'Database driver settings. Most installations need none of these.')
    ].filter(Boolean));

    if (focusKey) {
      const next = /** @type {HTMLElement | null} */ (root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`));
      if (next) {
        next.focus();
        if (selection && next instanceof HTMLInputElement && selection[0] !== null) {
          next.setSelectionRange(selection[0], selection[1]);
        }
      }
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'state') {
      state = message.state;
      // Forget edit forms for connections that no longer exist.
      const ids = new Set(state.connections.map((c) => c.id));
      editing = editing.filter((id) => ids.has(id));
      persist();
      render();
    } else if (message.type === 'validation') {
      const target = message.target;
      const key = target.kind === 'setting' ? `setting:${target.key}` : `conn:${target.connectionId}`;
      const valid = Object.keys(message.errors).length === 0;
      if (valid) {
        delete errors[key];
        if (target.kind === 'setting') delete drafts[key];
        else {
          clearConnectionDrafts(target.connectionId);
          editing = editing.filter((id) => id !== target.connectionId);
        }
        persist();
      } else {
        errors[key] = message.errors;
      }
      render();
    }
  });

  const nativeSettings = document.getElementById('open-native-settings');
  if (nativeSettings) nativeSettings.addEventListener('click', () => post({ type: 'openNativeSettings' }));

  post({ type: 'ready' });
})();
