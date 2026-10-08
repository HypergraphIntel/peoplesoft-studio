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
  /** The Build Settings panel's open tab: 'buildCreate' (Build) or 'buildAlter' (Alter). */
  let buildTab = saved.buildTab === 'buildAlter' ? 'buildAlter' : 'buildCreate';
  /**
   * Connection panels opened or closed by hand, by id. One not in here is
   * open when it is the target connection, else closed.
   * @type {Record<string, boolean>}
   */
  const expanded = saved.expanded || {};
  /** @type {Set<string> | undefined} connection ids in the last state, to open ones added since */
  let knownConnections;
  /** @type {Record<string, Record<string, string>>} keyed like drafts' prefixes */
  const errors = {};

  function persist() {
    vscode.setState({ drafts, editing, buildTab, expanded });
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
    { id: 'mcp', title: 'AI Integration' },
    { id: 'build', title: 'Build Settings' },
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

  /** @param {Record<string, string | Node>} pairs */
  function facts(pairs) {
    const dl = h('dl', { className: 'facts' });
    for (const [term, value] of Object.entries(pairs)) {
      dl.append(h('dt', { text: term }),
        typeof value === 'string' ? h('dd', { className: 'mono', text: value }) : h('dd', {}, [value]));
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
        '. Passwords are kept in the OS secret store and are never shown here. ',
        'Each connection\u2019s compiler profile follows its PeopleTools release automatically.'
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

  function isExpanded(c) {
    return c.id in expanded ? expanded[c.id] : !!c.selected;
  }

  function toggleExpanded(c) {
    expanded[c.id] = !isExpanded(c);
    persist();
    render();
  }

  function renderConnection(c) {
    const busy = c.test && c.test.status === 'testing';
    const open = isExpanded(c);
    const bodyId = `connection-body-${c.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    const head = h('div', {
      className: 'connection-head',
      on: {
        // The whole header row toggles, not just the name; its badges are not controls.
        click: (e) => { if (!(/** @type {HTMLElement} */ (e.target)).closest('button')) toggleExpanded(c); }
      }
    }, [
      h('h3', {}, [
        h('button', {
          className: 'disclosure',
          attrs: {
            type: 'button', 'aria-expanded': String(open), 'aria-controls': bodyId,
            'data-focus-key': `expand:${c.id}`, title: open ? 'Collapse' : 'Expand'
          },
          on: { click: () => toggleExpanded(c) }
        }, [h('span', { className: 'chevron', attrs: { 'aria-hidden': 'true' } }), c.name])
      ]),
      h('span', { className: 'kind', text: c.kindLabel }),
      c.selected ? badge('Target', 'neutral', 'The workspace target connection, chosen in the Connections view or the status bar') : null,
      c.connected ? badge('Connected', 'ok') : badge('Not connected', 'off'),
      badge(c.access.label, 'warn', c.access.detail),
      c.peoplecodeWrite && c.peoplecodeWrite.access === 'writable'
        ? badge('Writes allowed', 'error', 'PeopleCode may be saved back to this database once saving is implemented.')
        : null,
      // Closed, the header still says where the connection goes.
      open ? null : h('span', { className: 'summary', text:
        c.kind === 'projectFile' ? (c.path || '')
          : c.signon === 'threeTier' ? [c.appServerMachine, c.appServerPort].filter(Boolean).join(':') || c.appServerName || ''
            : (c.connectString || '') })
    ]);

    const details = facts(c.kind === 'projectFile'
      ? { 'Project file': c.path || '—' }
      : c.signon === 'threeTier'
        ? { 'Application server': c.appServerName || '—', 'Machine': c.appServerMachine || '—', 'Port': c.appServerPort || '—',
            ...(c.tuxedoConnectString ? { 'Tuxedo connect string': c.tuxedoConnectString } : {}),
            ...(c.walletName ? { 'Wallet': c.walletName } : {}),
            'PeopleSoft operator': c.operatorId || '—' }
      : c.signon === 'twoTier'
        ? { 'Connect string': c.connectString || '—', 'Connect ID (proxy)': c.user || '—', 'PeopleSoft operator': c.operatorId || '—',
            'Schema': c.schema || `Automatic (PSDBOWNER, else ${DEFAULT_SCHEMA[c.kind] || 'SYSADM'})` }
        : { 'Connect string': c.connectString || '—', 'Access id': c.user || '—', 'Schema': c.schema || `Automatic (PSDBOWNER, else ${DEFAULT_SCHEMA[c.kind] || 'SYSADM'})` });

    const actions = h('div', { className: 'actions' }, [
      button(busy ? 'Testing…' : 'Test Connection', () => post({ type: 'testConnection', connectionId: c.id }),
        { disabled: busy, focusKey: `test:${c.id}`, title: 'Connect a temporary session and read PSSTATUS; the live connection is not affected.' }),
      button('Edit', () => toggleEdit(c.id), { secondary: true, focusKey: `edit:${c.id}`, disabled: editing.includes(c.id) }),
      button('Remove…', () => post({ type: 'removeConnection', connectionId: c.id }), { secondary: true, focusKey: `remove:${c.id}` })
    ]);

    return h('div', {
      className: ['connection', c.selected ? 'selected' : '', open ? '' : 'collapsed'].filter(Boolean).join(' '),
      attrs: { 'data-connection': c.id }
    }, [
      head,
      open
        ? h('div', { className: 'connection-body', attrs: { id: bodyId } }, [
            details,
            renderAnalysis(c),
            renderPeopleCodeSaving(c),
            actions,
            renderTestResult(c),
            editing.includes(c.id) ? renderEditForm(c) : null
          ])
        : null
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

  /** What an empty Schema resolves to after PSDBOWNER, by connection kind. */
  const DEFAULT_SCHEMA = { oracle: 'SYSADM', mssql: 'the login\'s default schema', db2: 'the user\'s schema' };

  const FIELD_LABELS = {
    connectString: { label: 'Connect string', placeholder: 'host:1521/SERVICE' },
    connectString_mssql: { label: 'Connect string', placeholder: 'host[\\instance][:port]/database' },
    connectString_db2: { label: 'Connect string', placeholder: 'host[:port]/database' },
    user: { label: 'Database access id', placeholder: 'SYSADM' },
    schema: { label: 'Schema (owner ID)', placeholder: 'Automatic: PS.PSDBOWNER, else SYSADM' },
    schema_mssql: { label: 'Schema (owner ID)', placeholder: 'Automatic: PSDBOWNER, else the login\'s default schema' },
    schema_db2: { label: 'Schema (owner ID)', placeholder: 'Automatic: PS.PSDBOWNER, else the user\'s schema' },
    path: { label: 'Project file', placeholder: '/path/to/export.xml' },
    appServerName: { label: 'Application Server Name', placeholder: 'the domain name' },
    appServerMachine: { label: 'Machine Name or IP Address', placeholder: 'appserver.example.com' },
    appServerPort: { label: 'Port Number', placeholder: '9033' },
    tuxedoConnectString: { label: 'TUXEDO Connect String', placeholder: '//host:port (optional)' },
    walletLocation: { label: 'Wallet Location', placeholder: 'optional' },
    walletName: { label: 'Wallet Name', placeholder: 'optional' }
  };

  function toggleEdit(id) {
    editing = editing.includes(id) ? editing.filter((e) => e !== id) : [...editing, id];
    if (editing.includes(id)) expanded[id] = true;
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
      // Two-tier: the database login is the proxy Connect ID, not the access id.
      const meta = (field === 'user' && c.signon === 'twoTier')
        ? { label: 'Connect ID (proxy login)', placeholder: 'people' }
        : FIELD_LABELS[`${field}_${c.kind}`] || FIELD_LABELS[field];
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

    // DOM append writes a null as the text "null": only the parts present.
    form.append(...[
      h('p', { className: 'hint', text: 'The name identifies the connection, its stored password and its open editors, so it cannot be changed here.' }),
      c.connected ? h('p', { className: 'hint', text: 'Changes apply the next time this connection connects.' }) : null,
      errorText(formErrors.form, `edit-${c.id}-form-error`),
      h('div', { className: 'actions' }, [
        h('button', { text: 'Save', attrs: { type: 'submit' } }),
        button('Cancel', () => toggleEdit(c.id), { secondary: true })
      ])
    ].filter(Boolean));

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
    } else if (s.control.kind === 'boolean') {
      // VS Code's own layout for a boolean: the checkbox, labelled by the description.
      const checkbox = /** @type {HTMLInputElement} */ (h('input', {
        attrs: { type: 'checkbox', id: inputId, 'data-focus-key': draftKey, 'aria-describedby': describedBy },
        on: { change: (e) => post({ type: 'updateSetting', key: s.key, value: /** @type {HTMLInputElement} */ (e.target).checked }) }
      }));
      checkbox.checked = s.value === true;
      return h('div', { className: 'setting' }, [
        h('div', { className: 'setting-title' }, [h('span', { text: s.label }), sourceBadge(s.source)]),
        h('div', { className: 'checkbox-row' }, [
          checkbox,
          h('label', { className: 'description', text: s.description, attrs: { for: inputId, id: `${inputId}-desc` } })
        ]),
        errorText(settingErrors.value, errorId),
        s.appliesWhen ? h('p', { className: 'hint', text: s.appliesWhen }) : null
      ]);
    } else {
      // Text and number settings share a draft-and-save input; the host validates.
      const current = String(s.value);
      const numeric = s.control.kind === 'number';
      const input = /** @type {HTMLInputElement} */ (h('input', {
        className: numeric ? 'number' : '',
        attrs: {
          type: 'text', id: inputId, spellcheck: 'false', autocomplete: 'off',
          ...(numeric ? { inputmode: 'numeric' } : {}),
          placeholder: s.control.placeholder, 'data-focus-key': draftKey, 'aria-describedby': describedBy,
          ...(settingErrors.value ? { 'aria-invalid': 'true' } : {})
        }
      }));
      input.value = draftKey in drafts ? drafts[draftKey] : current;
      const save = button('Save', () => post({ type: 'updateSetting', key: s.key, value: input.value }), { focusKey: `${draftKey}:save` });
      const syncDirty = () => { save.disabled = input.value === current; };
      input.addEventListener('input', () => {
        if (input.value === current) delete drafts[draftKey];
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

  /** App Designer's Build Settings dialog as one panel: a Build tab (its Create tab) and an Alter tab. */
  function renderBuildSettings() {
    const tabs = [
      { id: 'buildCreate', label: 'Build', description: 'What Build does when a table, view, index or sequence already exists.' },
      { id: 'buildAlter', label: 'Alter', description: 'How Alter Tables changes an existing table.' }
    ];
    const current = tabs.find((t) => t.id === buildTab) || tabs[0];
    const tabList = h('div', { className: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Build Settings' } },
      tabs.map((t) => h('button', {
        className: t.id === current.id ? 'tab selected' : 'tab',
        text: t.label,
        attrs: {
          type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-selected': String(t.id === current.id),
          'aria-controls': 'build-panel', 'data-focus-key': `tab:${t.id}`, tabindex: t.id === current.id ? '0' : '-1'
        },
        on: {
          click: () => { buildTab = t.id; persist(); render(); },
          keydown: (e) => {
            const key = /** @type {KeyboardEvent} */ (e).key;
            if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
            const i = tabs.findIndex((x) => x.id === buildTab);
            buildTab = tabs[(i + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id;
            persist(); render();
          }
        }
      })));
    const settings = state.settings.filter((s) => s.section === current.id);
    return h('section', { attrs: { id: 'build', 'aria-labelledby': 'build-title' } }, [
      h('h2', { text: 'Build Settings', attrs: { id: 'build-title' } }),
      h('p', { className: 'description', text: 'App Designer\'s Build Settings, used by Build... on records.' }),
      h('div', { className: 'tabbed' }, [
        tabList,
        h('div', { className: 'tab-panel', attrs: { id: 'build-panel', role: 'tabpanel', 'aria-labelledby': `tab-${current.id}` } }, [
          h('p', { className: 'description', text: current.description }),
          ...settings.map(renderSetting)
        ])
      ])
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

  /**
   * The connection's Compiler / Analysis group: its PeopleTools release
   * (PSSTATUS), the compiler profile that release selects, and -- for a
   * database connection -- the decoder its PeopleCode is rendered with.
   * The release comes from the live connection, or from the last Test
   * Connection when it is not connected.
   */
  function renderAnalysis(c) {
    const env = c.environment;
    /** @type {Record<string, string | Node>} */
    const rows = {};
    const notes = [];
    const hint = (text) => h('p', { className: 'hint analysis-note', text });

    switch (env.status) {
      case 'not-connected':
        rows['PeopleTools release'] = 'Unknown';
        rows['Compiler profile'] = 'Unknown';
        notes.push(hint('Connect, or run Test Connection, to read the release.'));
        break;
      case 'not-applicable':
        rows['PeopleTools release'] = 'Not available';
        rows['Compiler profile'] = 'Not available';
        notes.push(hint(env.reason));
        break;
      case 'loading':
        rows['PeopleTools release'] = 'Reading PSSTATUS…';
        rows['Compiler profile'] = '…';
        break;
      case 'error':
        rows['PeopleTools release'] = 'Unknown';
        rows['Compiler profile'] = 'Unknown';
        notes.push(h('p', { className: 'error-text analysis-note', text: `Could not read PSSTATUS: ${env.message}` }));
        break;
      case 'available':
        rows['PeopleTools release'] = env.release;
        rows['Compiler profile'] = env.profile.ok ? `${env.profile.id} (automatic)` : 'None';
        if (!env.profile.ok) {
          notes.push(h('p', { className: 'error-text analysis-note', text: `Unknown compiler profile mapping: ${env.profile.message}` }));
        } else if (env.source === 'test') {
          notes.push(hint('Release from the last Test Connection.'));
        }
        break;
    }

    if (c.decoder) {
      rows['PeopleCode decoder'] = optionSelect(c, 'decoder', state.decoderOptions, c.decoder.value,
        (o) => c.decoder.inherited && o.value === c.decoder.value ? `${o.label} (default)` : o.label);
      const current = state.decoderOptions.find((o) => o.value === c.decoder.value);
      if (current) notes.push(hint(current.description));
      if (c.decoder.inherited) notes.push(hint('Using the default, peoplesoft.peoplecode.decoder.'));
      if (c.connected) notes.push(hint('A change applies the next time this connection connects.'));
      const error = optionError(c, 'decoder');
      if (error) notes.push(error);
    }

    return h('div', { className: 'analysis', attrs: { role: 'group', 'aria-label': `${c.name} compiler and analysis` } }, [
      h('h4', { text: 'Compiler / Analysis' }),
      facts(rows),
      ...notes
    ]);
  }

  /** A dropdown for one per-connection option; changes are sent as setConnectionOption. */
  function optionSelect(c, option, options, value, labelOf = (o) => o.label) {
    const errorKey = `option:${c.id}:${option}`;
    const error = (errors[errorKey] || {})[option];
    const select = /** @type {HTMLSelectElement} */ (h('select', {
      attrs: {
        'data-focus-key': errorKey, 'aria-label': `${c.name} ${option}`,
        ...(error ? { 'aria-invalid': 'true' } : {})
      },
      on: {
        change: (e) => post({
          type: 'setConnectionOption', connectionId: c.id, option,
          value: /** @type {HTMLSelectElement} */ (e.target).value
        })
      }
    }));
    for (const o of options) {
      const node = /** @type {HTMLOptionElement} */ (h('option', { text: labelOf(o), attrs: { value: o.value } }));
      node.selected = o.value === value;
      select.append(node);
    }
    return select;
  }

  function optionError(c, option) {
    const error = (errors[`option:${c.id}:${option}`] || {})[option];
    return error ? h('p', { className: 'error-text analysis-note', text: error, attrs: { role: 'alert' } }) : null;
  }

  /**
   * Whether PeopleCode may be saved natively to this database, as which
   * operator, and how. The host verifies the operator exists before it is
   * stored, and again before Writable is allowed.
   */
  function renderPeopleCodeSaving(c) {
    if (!c.peoplecodeWrite) return null;
    const { access, saveMode, operatorId } = c.peoplecodeWrite;
    const writable = access === 'writable';
    const hint = (text) => h('p', { className: 'hint analysis-note', text });

    const draftKey = `option:${c.id}:peoplesoftOperatorId`;
    const input = /** @type {HTMLInputElement} */ (h('input', {
      className: 'operator',
      attrs: {
        type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'e.g. VP1',
        'aria-label': `${c.name} PeopleSoft Operator ID`, 'data-focus-key': draftKey,
        ...(optionErrorText(c, 'peoplesoftOperatorId') ? { 'aria-invalid': 'true' } : {})
      }
    }));
    input.value = draftKey in drafts ? drafts[draftKey] : operatorId;
    const save = button('Save', () => post({ type: 'setConnectionOption', connectionId: c.id, option: 'peoplesoftOperatorId', value: input.value }),
      { secondary: true, focusKey: `${draftKey}:save`, title: 'Checks that the operator exists in this database (PSOPRDEFN), then saves it.' });
    const sync = () => { save.disabled = input.value.trim() === operatorId; };
    input.addEventListener('input', () => {
      if (input.value === operatorId) delete drafts[draftKey]; else drafts[draftKey] = input.value;
      persist();
      sync();
    });
    input.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter' && !save.disabled) save.click(); });
    sync();

    /** @type {Record<string, string | Node>} */
    const rows = {
      Access: optionSelect(c, 'peoplecodeAccess', state.peoplecodeAccessOptions, access),
      'Operator ID': h('span', { className: 'control-row' }, [input, save])
    };
    if (writable) rows['Save mode'] = optionSelect(c, 'peoplecodeSaveMode', state.peoplecodeSaveModeOptions, saveMode);

    const describe = (options, value) => options.find((o) => o.value === value)?.description;
    return h('div', { className: writable ? 'analysis writable' : 'analysis', attrs: { role: 'group', 'aria-label': `${c.name} PeopleCode saving` } }, [
      h('h4', { text: 'PeopleCode saving' }),
      facts(rows),
      hint(describe(state.peoplecodeAccessOptions, access) || ''),
      hint(operatorId
        ? `Saves are recorded as PeopleSoft operator ${operatorId} (LASTUPDOPRID).`
        : 'Set the PeopleSoft operator saves are recorded as. It must exist in this database; Writable requires it.'),
      writable ? hint(describe(state.peoplecodeSaveModeOptions, saveMode) || '') : null,
      writable && saveMode === 'save-only'
        ? h('p', { className: 'warning-text analysis-note', text: 'Saves are refused in Save only mode. Choose Compile and save to save PeopleCode.' })
        : null,
      optionError(c, 'peoplecodeAccess'),
      optionError(c, 'peoplesoftOperatorId'),
      optionError(c, 'peoplecodeSaveMode')
    ]);
  }

  function optionErrorText(c, option) {
    return (errors[`option:${c.id}:${option}`] || {})[option];
  }

  function renderMcp() {
    const mcp = state.mcp;
    if (!mcp) return null;
    const statusBadge = {
      running: badge('Running', 'ok'),
      starting: badge('Starting…', 'off'),
      stopped: badge('Stopped', 'off'),
      disabled: badge('Disabled', 'off'),
      error: badge('Error', 'error')
    }[mcp.status];

    const running = mcp.status === 'running';
    const disabled = mcp.status === 'disabled';
    const settings = state.settings.filter((x) => x.section === 'mcp');

    return h('section', { attrs: { id: 'mcp', 'aria-labelledby': 'mcp-title' } }, [
      h('h2', { text: 'AI Integration', attrs: { id: 'mcp-title' } }),
      h('div', { className: 'control-row' }, [h('strong', { text: 'MCP server' }), statusBadge]),
      disabled
        ? h('p', { className: 'hint', text: 'The server is off. Turn on “Enable MCP server” below to start it.' })
        : facts({ URL: mcp.url }),
      mcp.error ? h('p', { className: 'error-text', text: mcp.error, attrs: { role: 'alert' } }) : null,
      disabled ? null : h('div', { className: 'actions' }, [
        running
          ? button('Stop', () => post({ type: 'mcp', action: 'stop' }), { secondary: true, focusKey: 'mcp:stop', title: 'Stop until restarted; the setting stays on.' })
          : button('Start', () => post({ type: 'mcp', action: 'start' }), { secondary: true, focusKey: 'mcp:start', disabled: mcp.status === 'starting' }),
        running ? button('Restart', () => post({ type: 'mcp', action: 'restart' }), { secondary: true, focusKey: 'mcp:restart' }) : null,
        button('Copy URL', () => post({ type: 'mcp', action: 'copyUrl' }), { secondary: true, focusKey: 'mcp:copy' }),
        button('Configure AI Client…', () => post({ type: 'mcp', action: 'configureClient' }), { secondary: true, focusKey: 'mcp:configure' })
      ]),
      ...settings.map(renderSetting)
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
      renderMcp(),
      renderBuildSettings(),
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
      for (const id of Object.keys(expanded)) if (!ids.has(id)) delete expanded[id];
      // A connection added while the page is open opens, to be filled in.
      if (knownConnections) for (const id of ids) if (!knownConnections.has(id)) expanded[id] = true;
      knownConnections = ids;
      persist();
      render();
    } else if (message.type === 'validation') {
      const target = message.target;
      const key = target.kind === 'setting' ? `setting:${target.key}`
        : target.kind === 'connectionOption' ? `option:${target.connectionId}:${target.option}`
        : `conn:${target.connectionId}`;
      const valid = Object.keys(message.errors).length === 0;
      if (valid) {
        delete errors[key];
        if (target.kind === 'setting') delete drafts[key];
        else if (target.kind === 'connectionOption') {
          delete drafts[`option:${target.connectionId}:${target.option}`];
        } else if (target.kind === 'connection') {
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
