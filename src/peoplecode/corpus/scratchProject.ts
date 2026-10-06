/*
 * Cycle 180: generate a scratch-only, source-only Application Designer
 * project file (-PJFF input) that creates EMPTY Application Package /
 * class shells in the ZZ_PCODE_LAB namespace.
 *
 * Cycle 179 proved this import safe: definitions are created under their
 * project keys, NON_SCRATCH_CHANGED = 0. Because there is no compiled
 * payload, PeopleTools stores only a 37-byte stub program and no source.
 * The real source is then saved by App Designer itself, which writes
 * PSPCMTXT (with its own HASH_SIGNATURE), PSPCMPROG and PSPCMNAME.
 *
 * Structures come from one of the lab's own -PJTF exports (templates), and
 * only identities, lists and counts change. The result must pass
 * validateScratchProjectXml, or nothing is returned.
 */
import { validateScratchProjectXml } from './labSafety.js';

export interface ScratchPackageSpec {
  /** Level-1 sub-package name (e.g. ORDERING). */
  name: string;
  /** Class names in it. */
  classes: string[];
}

export interface ScratchProjectSpec {
  project: string;
  root: string;
  /**
   * Every level-1 sub-package of the root, as the root APM lists it.
   * Packages already in the database may be listed without
   * `createClasses`.
   */
  subpackages: string[];
  /** Sub-packages (and classes) to create in this import. */
  create: ScratchPackageSpec[];
}

export interface ScratchTemplates {
  /** Text before the first <instance> (XML header and comment). */
  head: string;
  pjm: string;
  /** A root APM (level 0) with a sub-package list. */
  rootApm: string;
  /** A level-1 APM with a class list. */
  level1Apm: string;
  /** An Application Class PCM keyed 104 / 105 / 107 / 12. */
  pcm: string;
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setTag(block: string, tag: string, value: string): string {
  const re = new RegExp(`<${tag.replace(/\./g, '\\.')}>[^<]*</${tag.replace(/\./g, '\\.')}>`);
  if (!re.test(block)) throw new Error(`template has no <${tag}>`);
  return block.replace(re, () => `<${tag}>${value}</${tag}>`);
}

function rowsOf(block: string, rowset: string, rowEnd: RegExp): { per: number; row: string } {
  const head = new RegExp(`<rowset name="${rowset}" size="(\\d+)" count="(\\d+)">`).exec(block);
  if (head === null) throw new Error(`template has no ${rowset} rowset`);
  const start = block.indexOf('<row>', head.index);
  const end = rowEnd.exec(block.slice(start));
  if (end === null) throw new Error(`cannot delimit a ${rowset} row`);
  return { per: Number(head[1]) / Number(head[2]), row: block.slice(start, start + end.index + end[0].length) };
}

function rootApm(t: ScratchTemplates, root: string, subpackages: string[]): string {
  let b = t.rootApm;
  for (const [tag, v] of [['szPackageId', root], ['szPackageRoot', root], ['szQualifyPath', '.'], ['lPackageLevel', '0']] as const) b = setTag(b, tag, esc(v));
  const { per, row } = rowsOf(t.rootApm, 'ApmPackageList', /<\/row>/);
  const rows = [...subpackages].sort().map(name => {
    let r = row;
    for (const [tag, v] of [['ApmDefnKey.szPackageId', name], ['ApmDefnKey.szPackageRoot', root], ['ApmDefnKey.szQualifyPath', ':'], ['lPackageLevel', '1']] as const) r = setTag(r, tag, esc(v));
    return r;
  });
  return b.replace(/<ApmDefnList\.lPackageCount>\d+<\/ApmDefnList\.lPackageCount>\s*<ApmDefnList\.hDefnPackageList>[\s\S]*?<\/ApmDefnList\.hDefnPackageList>/, () =>
    `<ApmDefnList.lPackageCount>${rows.length}</ApmDefnList.lPackageCount>\n        <ApmDefnList.hDefnPackageList> HANDLE\n          <rowset name="ApmPackageList" size="${per * rows.length}" count="${rows.length}">\n            ${rows.join('\n            ')}\n          </rowset>\n        </ApmDefnList.hDefnPackageList>`);
}

function level1Apm(t: ScratchTemplates, root: string, pkg: ScratchPackageSpec): string {
  let b = t.level1Apm;
  for (const [tag, v] of [['szPackageId', pkg.name], ['szPackageRoot', root], ['szQualifyPath', ':'], ['lPackageLevel', '1']] as const) b = setTag(b, tag, esc(v));
  const { per, row } = rowsOf(t.level1Apm, 'ApmClassList', /<\/hClassDefn>\s*<\/row>/);
  const rows = [...pkg.classes].sort().map(cls => {
    let r = row;
    for (const [tag, v] of [['ApmClassKey.szClassId', cls], ['ApmClassKey.szPackageRoot', root], ['ApmClassKey.szQualifyPath', pkg.name], ['lClassLevel', '2'], ['szClassId', cls]] as const) r = setTag(r, tag, esc(v));
    return r;
  });
  b = b.replace(/<ApmDefnList\.lClassCount>\d+<\/ApmDefnList\.lClassCount>\s*<ApmDefnList\.hDefnClassList>[\s\S]*?<\/ApmDefnList\.hDefnClassList>/, () =>
    `<ApmDefnList.lClassCount>${rows.length}</ApmDefnList.lClassCount>\n        <ApmDefnList.hDefnClassList> HANDLE\n          <rowset name="ApmClassList" size="${per * rows.length}" count="${rows.length}">\n            ${rows.join('\n            ')}\n          </rowset>\n        </ApmDefnList.hDefnClassList>`);
  return b.replace(/<ApmDefnList\.lPackageCount>\d+<\/ApmDefnList\.lPackageCount>\s*<ApmDefnList\.hDefnPackageList>[\s\S]*?<\/ApmDefnList\.hDefnPackageList>/, () =>
    '<ApmDefnList.lPackageCount>0</ApmDefnList.lPackageCount>\n        <ApmDefnList.hDefnPackageList>HANDLE</ApmDefnList.hDefnPackageList>');
}

function shellPcm(t: ScratchTemplates, root: string, pkg: string, cls: string): string {
  let b = t.pcm;
  const ids = [104, 105, 107, 12, 0, 0, 0];
  const values = [root, pkg, cls, 'OnExecute', '', '', ''];
  for (let i = 0; i < 7; i++) {
    b = setTag(b, `eObjectID_${i}`, String(ids[i]));
    b = setTag(b, `szObjectValue_${i}`, esc(values[i]));
  }
  for (const tag of ['nNameCount', 'lSourceLen', 'lEntryNamesLen', 'nEntry', 'nParams']) b = setTag(b, tag, '0');
  b = b.replace(/<lpPnt>[\s\S]*?<\/lpPnt>/, '<lpPnt>POINTER</lpPnt>');
  b = b.replace(/<peoplecode_text>[\s\S]*?<\/peoplecode_text>/, () => `<peoplecode_text>${esc(`class ${cls}\nend-class;\n`)}</peoplecode_text>`);
  return b.replace(/<peoplecode_blob>[\s\S]*?<\/peoplecode_blob>/, '<peoplecode_blob></peoplecode_blob>');
}

function projectItems(t: ScratchTemplates, spec: ScratchProjectSpec): string {
  const { per, row } = rowsOf(t.pjm, 'PjmPit', /<\/row>/);
  const item = (type: number, values: string[], ids: number[]) => {
    let r = setTag(row, 'eObjectType', String(type));
    for (let i = 0; i < 4; i++) {
      r = setTag(r, `szObjectValue_${i}`, esc(values[i] ?? ''));
      r = setTag(r, `eObjectID_${i}`, String(ids[i] ?? 0));
    }
    for (const [tag, v] of [['bExecute', '0'], ['eSourceStatus', '0'], ['eTargetStatus', '0'], ['eUpgradeAction', '0'], ['bTakeAction', '1'], ['bCopyDone', '0']] as const) r = setTag(r, tag, v);
    return { key: `${type}|${values.join('|')}`, xml: r };
  };
  const items = [
    ...spec.create.map(p => item(57, [p.name, spec.root, ':'], [104, 116, 117])),
    item(57, [spec.root, spec.root, '.'], [104, 116, 117]),
    ...spec.create.flatMap(p => p.classes.map(c => item(58, [spec.root, p.name, c], [104, 105, 107])))
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let b = setTag(t.pjm, 'szProjectName', esc(spec.project));
  b = setTag(b, 'nProjectCount', String(items.length));
  return b.replace(/<rowset name="PjmPit" size="\d+" count="\d+">[\s\S]*?<\/rowset>/, () =>
    `<rowset name="PjmPit" size="${per * items.length}" count="${items.length}">\n            ${items.map(i => i.xml).join('\n            ')}\n          </rowset>`);
}

/** Build the project file; throws unless it passes validateScratchProjectXml. */
export function buildScratchShellProject(t: ScratchTemplates, spec: ScratchProjectSpec): string {
  const apms = [
    ...spec.create.map(p => ({ id: p.name, xml: level1Apm(t, spec.root, p) })),
    { id: spec.root, xml: rootApm(t, spec.root, spec.subpackages) }
  ].sort((a, b) => (a.id < b.id ? -1 : 1)).map(a => a.xml);
  const pcms = spec.create.flatMap(p => [...p.classes].sort().map(c => shellPcm(t, spec.root, p.name, c)));
  const xml = `${t.head}${projectItems(t, spec)}\n  ${apms.join('\n  ')}\n  ${pcms.join('\n  ')}\n`;
  const validation = validateScratchProjectXml(xml);
  if (!validation.ok) throw new Error(`generated project is not scratch-only:\n  ${validation.violations.join('\n  ')}`);
  return xml;
}

/** An APM's own level: its first <lPackageLevel> (list rows come later). */
const ownLevel = (block: string): string | undefined => /<lPackageLevel>(\d+)<\/lPackageLevel>/.exec(block)?.[1];

/** Pull the template instances out of a -PJTF export of the lab. */
export function templatesFromExport(exportXml: string): ScratchTemplates {
  const instances = [...exportXml.matchAll(/<instance class="(\w+)">/g)].map(m => ({ cls: m[1], block: exportXml.slice(m.index!, exportXml.indexOf('</instance>', m.index!) + '</instance>'.length) }));
  const find = (cls: string, pred: (b: string) => boolean) => {
    const hit = instances.find(i => i.cls === cls && pred(i.block));
    if (hit === undefined) throw new Error(`export has no suitable ${cls} template`);
    return hit.block;
  };
  return {
    head: exportXml.slice(0, exportXml.indexOf('<instance class=')),
    pjm: find('PJM', b => /<rowset name="PjmPit"/.test(b)),
    rootApm: find('APM', b => ownLevel(b) === '0' && /<rowset name="ApmPackageList"/.test(b)),
    level1Apm: find('APM', b => ownLevel(b) === '1' && /<rowset name="ApmClassList"/.test(b)),
    pcm: find('PCM', b => /<eObjectID_0>104<\/eObjectID_0>/.test(b) && /<eObjectID_1>105<\/eObjectID_1>/.test(b) && /<eObjectID_2>107<\/eObjectID_2>/.test(b))
  };
}

/*
 * Cycle 181: scratch records, fields and Record Field PeopleCode shells
 * (the G matrix). Same contract as buildScratchShellProject: template
 * structures from the lab's own export, only identities / lists / counts
 * changed, no source and no compiled payload, and the result must pass
 * validateScratchProjectXml.
 */
export interface ScratchFieldSpec { name: string; length: number }
export interface ScratchRecordSpec { name: string; fields: string[] }
export interface ScratchRecordProgramSpec { record: string; field: string; event: string }
export interface ScratchRecordProjectSpec {
  project: string;
  fields: ScratchFieldSpec[];
  /** Derived / work records (no SQL table). */
  records: ScratchRecordSpec[];
  programs: ScratchRecordProgramSpec[];
}
export interface ScratchRecordTemplates {
  head: string;
  pjm: string;
  /** A character FIELD definition. */
  field: string;
  /** A derived / work RDM (eRecType 2) with at least one character field row. */
  derivedRecord: string;
  /** A Record Field PeopleCode PCM (1 / 2 / 12). */
  recordPcm: string;
}

/** Short label text: the part after the scratch prefix (ZZ_PCODE_LAB_VAL -> VAL). */
const shortLabel = (name: string): string => name.replace(/^ZZ_PCODE_LAB_?/i, '') || name;

function labelRows(block: string, rowset: string, idTag: string, longTag: string, shortTag: string, name: string): string {
  return block.replace(new RegExp(`<rowset name="${rowset}" size="(\\d+)" count="(\\d+)">([\\s\\S]*?)</rowset>`), (_all, size: string, count: string, rows: string) => {
    const per = Number(size) / Number(count);
    let row = /<row>[\s\S]*?<\/row>/.exec(rows)![0];
    row = setTag(row, idTag, esc(name));
    row = setTag(row, longTag, esc(name));
    row = setTag(row, shortTag, esc(shortLabel(name)));
    row = setTag(row, 'bIsDefault', '1');
    return `<rowset name="${rowset}" size="${per}" count="1">\n${row}\n</rowset>`;
  });
}

function scratchField(t: ScratchRecordTemplates, f: ScratchFieldSpec): string {
  let b = t.field;
  b = setTag(b, 'szFieldName', esc(f.name));
  b = setTag(b, 'eFieldType', '0');
  b = setTag(b, 'nLength', String(f.length));
  b = setTag(b, 'szObjectOwnerID', '');
  b = setTag(b, 'nLabelCount', '1');
  const [pre, rest] = [b.slice(0, b.indexOf('<hDBFldLabel>')), b.slice(b.indexOf('<hDBFldLabel>'))];
  const end = rest.indexOf('</hDBFldLabel>') + '</hDBFldLabel>'.length;
  const labels = labelRows(rest.slice(0, end), 'DBFldLabel', 'szLabelID', 'szLongName', 'szShortName', f.name);
  let post = rest.slice(end);
  post = setTag(post, 'szLabelID', esc(f.name));
  post = setTag(post, 'szLongName', esc(f.name));
  post = setTag(post, 'szShortName', esc(shortLabel(f.name)));
  return pre + labels + post;
}

function scratchRecord(t: ScratchRecordTemplates, r: ScratchRecordSpec, fields: Map<string, ScratchFieldSpec>): string {
  let b = t.derivedRecord;
  b = setTag(b, 'szRecName', esc(r.name));
  b = setTag(b, 'eRecType', '2');
  b = setTag(b, 'nFieldCount', String(r.fields.length));
  b = setTag(b, 'szObjectOwnerID', '');
  const rowset = /<rowset name="RecField" size="(\d+)" count="(\d+)">([\s\S]*?)<\/rowset>\s*<\/hRft>/.exec(b);
  if (rowset === null) throw new Error('template record has no RecField rowset');
  const per = Number(rowset[1]) / Number(rowset[2]);
  const charRow = [...rowset[3].matchAll(/<row>\s*<fStatus>[\s\S]*?<nRecFieldFrmtCount>\d+<\/nRecFieldFrmtCount>\s*<\/row>/g)].map(m => m[0]).find(row => /<eFieldType>0<\/eFieldType>/.test(row));
  if (charRow === undefined) throw new Error('template record has no character field row');
  const rows = r.fields.map(name => {
    const f = fields.get(name);
    if (f === undefined) throw new Error(`record ${r.name} uses undeclared field ${name}`);
    const cut = charRow.indexOf('<hDBFldLabel>'), stop = charRow.indexOf('</hDBFldLabel>') + '</hDBFldLabel>'.length;
    let pre = charRow.slice(0, cut), post = charRow.slice(stop);
    pre = setTag(pre, 'atmFieldName', esc(f.name));
    pre = setTag(pre, 'eFieldType', '0');
    pre = setTag(pre, 'nLength', String(f.length));
    pre = setTag(pre, 'eFormat', '0');
    pre = setTag(pre, 'szObjectOwnerID', '');
    pre = setTag(pre, 'nLabelCount', '1');
    const labels = labelRows(charRow.slice(cut, stop), 'DBFldLabel', 'atmLabelID', 'atmLongName', 'atmShortName', f.name);
    post = setTag(post, 'atmLongName', esc(f.name));
    post = setTag(post, 'atmShortName', esc(shortLabel(f.name)));
    post = setTag(post, 'atmPhysicalRecNameList', esc(`${r.name}     `));
    return pre + labels + post;
  });
  return b.replace(rowset[0], `<rowset name="RecField" size="${per * rows.length}" count="${rows.length}">\n${rows.join('\n')}\n</rowset>\n</hRft>`);
}

function recordShellPcm(t: ScratchRecordTemplates, p: ScratchRecordProgramSpec): string {
  let b = t.recordPcm;
  const ids = [1, 2, 12, 0, 0, 0, 0];
  const values = [p.record, p.field, p.event, '', '', '', ''];
  for (let i = 0; i < 7; i++) {
    b = setTag(b, `eObjectID_${i}`, String(ids[i]));
    b = setTag(b, `szObjectValue_${i}`, esc(values[i]));
  }
  for (const tag of ['nNameCount', 'lSourceLen', 'lEntryNamesLen', 'nEntry', 'nParams']) b = setTag(b, tag, '0');
  b = b.replace(/<lpPnt>[\s\S]*?<\/lpPnt>/, '<lpPnt>POINTER</lpPnt>');
  b = b.replace(/<peoplecode_text>[\s\S]*?<\/peoplecode_text>/, () => '<peoplecode_text>/* shell */\n</peoplecode_text>');
  return b.replace(/<peoplecode_blob>[\s\S]*?<\/peoplecode_blob>/, '<peoplecode_blob></peoplecode_blob>');
}

/** Build the records / fields / Record PeopleCode shell project; throws unless scratch-only. */
export function buildScratchRecordProject(t: ScratchRecordTemplates, spec: ScratchRecordProjectSpec): string {
  const fields = new Map(spec.fields.map(f => [f.name, f]));
  const { per, row } = rowsOf(t.pjm, 'PjmPit', /<\/row>/);
  const item = (type: number, values: string[], ids: number[]) => {
    let r = setTag(row, 'eObjectType', String(type));
    for (let i = 0; i < 4; i++) {
      r = setTag(r, `szObjectValue_${i}`, esc(values[i] ?? ''));
      r = setTag(r, `eObjectID_${i}`, String(ids[i] ?? 0));
    }
    for (const [tag, v] of [['bExecute', '0'], ['eSourceStatus', '0'], ['eTargetStatus', '0'], ['eUpgradeAction', '0'], ['bTakeAction', '1'], ['bCopyDone', '0']] as const) r = setTag(r, tag, v);
    return { key: `${String(type).padStart(3, '0')}|${values.join('|')}`, xml: r };
  };
  const items = [
    ...spec.records.map(r => item(0, [r.name], [1])),
    ...spec.fields.map(f => item(2, [f.name], [6])),
    ...spec.programs.map(p => item(8, [p.record, p.field, p.event], [1, 2, 12]))
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let pjm = setTag(t.pjm, 'szProjectName', esc(spec.project));
  pjm = setTag(pjm, 'nProjectCount', String(items.length));
  pjm = pjm.replace(/<rowset name="PjmPit" size="\d+" count="\d+">[\s\S]*?<\/rowset>/, () =>
    `<rowset name="PjmPit" size="${per * items.length}" count="${items.length}">\n            ${items.map(i => i.xml).join('\n            ')}\n          </rowset>`);
  const records = [...spec.records].sort((a, b) => (a.name < b.name ? -1 : 1)).map(r => scratchRecord(t, r, fields));
  const fieldDefs = [...spec.fields].sort((a, b) => (a.name < b.name ? -1 : 1)).map(f => scratchField(t, f));
  const pcms = [...spec.programs].sort((a, b) => (`${a.record}|${a.field}` < `${b.record}|${b.field}` ? -1 : 1)).map(p => recordShellPcm(t, p));
  const xml = `${t.head}${pjm}\n  ${[...records, ...fieldDefs, ...pcms].join('\n  ')}\n`;
  const validation = validateScratchProjectXml(xml);
  if (!validation.ok) throw new Error(`generated project is not scratch-only:\n  ${validation.violations.join('\n  ')}`);
  return xml;
}

/** Record / field / Record PeopleCode templates from a -PJTF export of the lab. */
export function recordTemplatesFromExport(exportXml: string): ScratchRecordTemplates {
  const instances = [...exportXml.matchAll(/<instance class="(\w+)">/g)].map(m => exportXml.slice(m.index!, exportXml.indexOf('</instance>', m.index!) + '</instance>'.length));
  const pick = (cls: string, pred: (b: string) => boolean): string => {
    const hits = instances.filter(b => b.startsWith(`<instance class="${cls}">`) && pred(b)).sort((a, b) => a.length - b.length);
    if (hits.length === 0) throw new Error(`export has no suitable ${cls} template`);
    return hits[0];
  };
  return {
    head: exportXml.slice(0, exportXml.indexOf('<instance class=')),
    pjm: pick('PJM', b => /<rowset name="PjmPit"/.test(b)),
    field: pick('FIELD', b => /<eFieldType>0<\/eFieldType>/.test(b) && /<rowset name="DBFldLabel"/.test(b)),
    derivedRecord: pick('RDM', b => /<eRecType>2<\/eRecType>/.test(b) && /<rowset name="RecField"[\s\S]*<eFieldType>0<\/eFieldType>[\s\S]*<rowset name="DBFldLabel"/.test(b)),
    recordPcm: pick('PCM', b => /<eObjectID_0>1<\/eObjectID_0>/.test(b) && /<eObjectID_1>2<\/eObjectID_1>/.test(b) && /<eObjectID_2>12<\/eObjectID_2>/.test(b))
  };
}
