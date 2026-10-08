import { ACTION_LABELS, LABELS, PEOPLECODE_PLATFORM, type AeSection, type AeStep, type AeVariant, type AppEngineProgram } from '../model/appEngine.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * An App Engine program laid out as App Designer's Definition view (each
 * section a bar, its steps below it, each step's actions below the step,
 * every setting in a labelled box -- BEN110 as App Designer showed it), and
 * its Program Flow view (each step's actions with their SQL and
 * PeopleCode). Read-only.
 */

/** "MAIN.GBL.default.1900-01-01": section, market, platform, effective date, as App Designer labels sections and steps. */
export function variantLabel(section: string, v: AeVariant): string {
  return `${section}.${v.market}.${PEOPLECODE_PLATFORM[v.dbType] ?? LABELS.platform[v.dbType] ?? v.dbType}.${v.effdt}`;
}

const label = (map: Record<string, string>, code: string) => map[code] ?? code;
const box = (caption: string, value: string, wide = false) =>
  `<div class="field${wide ? ' wide' : ''}"><span class="cap">${esc(caption)}</span><span class="val">${esc(value) || '&nbsp;'}</span></div>`;

/** An action's settings, as its App Designer row shows them. */
function actionFields(step: AeStep, a: AeStep['actions'][number]): string {
  switch (a.type) {
    case 'S': return box('ReUse Statement:', label(LABELS.reuse, a.reuse)) + box('No Rows:', label(LABELS.onNoRows, step.onNoRows));
    case 'D': return box('ReUse Statement:', label(LABELS.reuse, a.reuse)) + box('Do Select Type:', label(LABELS.doSelectType, a.doSelectType));
    case 'H': case 'W': case 'N': return box('ReUse Statement:', label(LABELS.reuse, a.reuse));
    case 'P': return box('On Return:', label(LABELS.onReturn, step.onReturn));
    case 'C': return box('Section:', step.call?.section ?? '') + box('Program ID:', step.call?.program ?? '') + box('Call Type:', step.call?.dynamic ? 'Dynamic' : 'Static');
    case 'M': return box('Message Set:', String(step.message?.set ?? '')) + box('Number:', String(step.message?.number ?? '')) + box('Parameters:', a.messageParms ?? '', true);
    default: return '';
  }
}

function definitionView(program: AppEngineProgram): string {
  const out: string[] = [];
  for (const section of program.sections) {
    for (const v of section.variants) {
      out.push(`<details open class="section"><summary class="bar"><span class="name">${esc(section.name)}</span>` +
        `<span class="descr">${esc(v.description)}</span><span class="path">${esc(variantLabel(section.name, v))}</span>` +
        `${v.active ? '' : '<span class="flag">Inactive</span>'}</summary>`);
      out.push(`<div class="section-props">${box('Access:', label(LABELS.access, section.isPublic ? 'Y' : 'N'))}` +
        `${box('Section Type:', label(LABELS.sectionType, section.type))}${box('Auto Commit:', label(LABELS.autoCommit, v.autoCommit))}</div>`);
      for (const step of v.steps) {
        const hasDoSelect = step.actions.some((a) => a.type === 'D');
        out.push(`<details open class="step"><summary class="step-head"><span class="name box">${esc(step.name)}</span>` +
          `<span class="descr box">${esc(step.description)}</span><span class="path">${esc(variantLabel(section.name, v))}</span></summary>`);
        out.push(`<div class="step-props"><span class="seq">${String(step.seq).padStart(3, '0')}</span>` +
          `${box('Commit After:', label(LABELS.commit, step.commit))}${box('Frequency:', hasDoSelect ? String(step.commitFrequency) : '')}` +
          `${box('On Error:', label(LABELS.onError, step.onError))}<span class="check">${step.active ? '&#x2611;' : '&#x2610;'} Active</span></div>`);
        for (const a of step.actions) {
          out.push(`<div class="action"><div class="action-head"><span class="name box">${esc(ACTION_LABELS[a.type])}</span>` +
            `<span class="descr box">${esc(a.description)}</span></div><div class="action-props">${actionFields(step, a)}</div></div>`);
        }
        out.push('</details>');
      }
      out.push('</details>');
    }
  }
  return out.join('\n');
}

function flowView(program: AppEngineProgram, peopleCode: (s: AeSection, v: AeVariant, st: AeStep) => string | undefined): string {
  const out: string[] = [];
  for (const section of program.sections) {
    for (const v of section.variants) {
      out.push(`<h3>${esc(section.name)} <span class="path">${esc(variantLabel(section.name, v))}</span> <span class="descr">${esc(v.description)}</span></h3>`);
      for (const step of v.steps) {
        out.push(`<div class="flow-step"><div class="flow-head">${esc(String(step.seq).padStart(3, '0'))} ${esc(step.name)}` +
          ` <span class="descr">${esc(step.description)}</span>${step.active ? '' : ' <span class="flag">Inactive</span>'}</div>`);
        for (const a of step.actions) {
          let body = '';
          if (a.type === 'P') {
            const source = peopleCode(section, v, step);
            body = source === undefined ? '<p class="descr">(PeopleCode not read)</p>' : `<pre>${esc(source.replace(/\s+$/, ''))}</pre>`;
          } else if (a.type === 'C') {
            body = `<p>Call ${esc(step.call?.program ? `${step.call.program}.` : '')}${esc(step.call?.section ?? '')}${step.call?.dynamic ? ' (dynamic)' : ''}</p>`;
          } else if (a.type === 'M') {
            body = `<p>Message ${step.message?.set ?? ''}, ${step.message?.number ?? ''}${step.message?.text !== undefined ? `: &ldquo;${esc(step.message.text)}&rdquo;` : ''}` +
              `${a.messageParms ? ` &mdash; ${esc(a.messageParms)}` : ''}</p>`;
          } else if (a.text !== undefined) {
            body = `<pre>${esc(a.text.replace(/\r\n/g, '\n').replace(/\s+$/, ''))}</pre>`;
          }
          out.push(`<div class="flow-action"><div class="flow-type">${esc(ACTION_LABELS[a.type])}</div>${body}</div>`);
        }
        out.push('</div>');
      }
    }
  }
  return out.join('\n');
}

export function renderAppEngineHtml(program: AppEngineProgram, connection: string, nonce: string,
  peopleCode: (s: AeSection, v: AeVariant, st: AeStep) => string | undefined = () => undefined): string {
  const props = [
    `Type: ${label(LABELS.programType, program.programType)}`, `Disable Restart: ${program.disableRestart ? 'Yes' : 'No'}`,
    `Application Library: ${program.library ? 'Yes' : 'No'}`, `Message Set: ${program.messageSet}`,
    `State records: ${program.stateRecords.map((s) => s.record + (s.isDefault ? ' (default)' : '')).join(', ') || '(none)'}`,
    ...(program.tempTables.length ? [`Temp tables: ${program.tempTables.join(', ')} (instances ${program.tempTableInstances})`] : [])
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  :root { --box-bg: var(--vscode-input-background); --box-border: var(--vscode-input-border, var(--vscode-panel-border, #8888));
    --band: var(--vscode-editorWidget-background, #8881); --band-2: var(--vscode-sideBar-background, #8882); }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
    background: var(--vscode-editor-background); padding: 0.75rem 1rem 2rem; }
  h1 { font-size: 1.15rem; margin: 0 0 0.2rem; }
  .meta { color: var(--vscode-descriptionForeground); margin: 0 0 0.6rem; }
  .tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--box-border); margin-bottom: 0.75rem; }
  .tabs button { background: none; border: none; border-bottom: 2px solid transparent; color: var(--vscode-foreground);
    padding: 0.3rem 0.9rem; cursor: pointer; opacity: 0.75; font: inherit; }
  .tabs button.on { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
  .view { display: none; } .view.on { display: block; }
  .cols { display: grid; grid-template-columns: 8rem 10rem 1fr; font-weight: 600; border-bottom: 1px solid var(--box-border);
    padding: 0.2rem 0; margin-bottom: 0.5rem; }
  details > summary { list-style: none; cursor: pointer; } details > summary::-webkit-details-marker { display: none; }
  details > summary::before { content: '\\229F'; margin-right: 0.35rem; opacity: 0.7; }
  details:not([open]) > summary::before { content: '\\229E'; }
  .section { margin-bottom: 1rem; }
  .bar { display: flex; align-items: center; gap: 0.6rem; background: var(--vscode-list-activeSelectionBackground, #000);
    color: var(--vscode-list-activeSelectionForeground, #fff); padding: 0.25rem 0.5rem; font-weight: 600; }
  .bar .descr { font-style: italic; font-weight: normal; } .bar .path { margin-left: auto; font-style: italic; font-weight: normal; }
  .section-props { display: flex; gap: 0.75rem; padding: 0.35rem 0 0.35rem 2rem; }
  .step { margin: 0.6rem 0 0.6rem 8rem; background: var(--band); padding: 0.3rem 0.5rem 0.5rem; }
  .step-head { display: flex; align-items: center; gap: 0.5rem; }
  .step-head .path { margin-left: auto; font-style: italic; color: var(--vscode-descriptionForeground); }
  .step-props { display: flex; align-items: flex-end; gap: 0.5rem; margin: 0.25rem 0 0.4rem 1.3rem; }
  .seq { width: 2.5rem; color: var(--vscode-descriptionForeground); }
  .check { padding-bottom: 0.15rem; }
  .action { margin: 0.5rem 0 0 4rem; background: var(--band-2); padding: 0.3rem 0.5rem 0.4rem; }
  .action-head { display: flex; gap: 0.5rem; }
  .action-props { display: flex; gap: 0.5rem; margin: 0.25rem 0 0 7.5rem; }
  .box { border: 1px solid var(--box-border); background: var(--box-bg); padding: 0.1rem 0.4rem; min-width: 5rem; }
  .name.box { font-weight: 600; min-width: 6rem; } .descr.box { font-style: italic; min-width: 12rem; }
  .field { display: flex; flex-direction: column; min-width: 8rem; } .field.wide { min-width: 18rem; }
  .cap { font-size: 0.85em; color: var(--vscode-descriptionForeground); text-align: center; }
  .val { border: 1px solid var(--box-border); background: var(--box-bg); padding: 0.1rem 0.4rem; min-height: 1.2em; }
  .flag { color: var(--vscode-errorForeground); font-weight: 600; }
  h3 { font-size: 1rem; margin: 1.2rem 0 0.4rem; } h3 .path, h3 .descr, .flow-head .descr { font-weight: normal; color: var(--vscode-descriptionForeground); }
  .flow-step { margin: 0.4rem 0 0.8rem 1rem; } .flow-head { font-weight: 600; }
  .flow-action { margin: 0.3rem 0 0 1.5rem; } .flow-type { font-weight: 600; font-size: 0.9em; }
  pre { margin: 0.2rem 0; padding: 0.4rem 0.6rem; background: var(--vscode-textCodeBlock-background, var(--band));
    font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre-wrap; font-variant-ligatures: none; }
</style>
</head>
<body>
<h1>${esc(program.name)}</h1>
<p class="meta">App Engine Program on ${esc(connection)}${program.description ? ` &mdash; ${esc(program.description)}` : ''}<br>${props.map(esc).join(' &nbsp;&middot;&nbsp; ')}</p>
<div class="tabs" role="tablist">
  <button class="on" data-view="definition" role="tab">Definition</button>
  <button data-view="flow" role="tab">Program Flow</button>
</div>
<div id="definition" class="view on" role="tabpanel">
  <div class="cols"><span>Section</span><span>Step</span><span>Action</span></div>
  ${definitionView(program)}
</div>
<div id="flow" class="view" role="tabpanel">
  ${flowView(program, peopleCode)}
</div>
<script nonce="${nonce}">
  for (const b of document.querySelectorAll('.tabs button')) {
    b.addEventListener('click', () => {
      for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b);
      for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === b.dataset.view);
    });
  }
</script>
</body>
</html>`;
}
