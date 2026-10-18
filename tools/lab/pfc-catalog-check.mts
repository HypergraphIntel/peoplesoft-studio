/* Page and Field Configurator: every stored field row compared with the field catalog the configurator would offer (read only). */
import { DatabaseProvider } from '../../src/providers/database';
import { pfcFieldCatalog, type PfcCatalogField } from '../../src/providers/pfcCatalog';
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const t = (v: unknown) => String(v ?? '').trim();
const verbose = process.argv.includes('--verbose');
await (p as any).withConnection(async (c: any) => {
  const comps = (await c.execute(`SELECT DISTINCT PNLGRPNAME C, MARKET M FROM PS_EOCC_CONFIG_FLD WHERE RECNAME <> ' ' ORDER BY 1`, {}, { outFormat: 4002 })).rows;
  const tally: Record<string, number> = {};
  for (const { C, M } of comps) {
    const catalog = await pfcFieldCatalog(c, t(C), t(M));
    const all: PfcCatalogField[] = catalog.flatMap((pg) => pg.fields);
    const rows = (await c.execute(`SELECT * FROM PS_EOCC_CONFIG_FLD WHERE PNLGRPNAME = :c AND MARKET = :m AND RECNAME <> ' '`, { c: C, m: M }, { outFormat: 4002 })).rows;
    let ok = 0, missing = 0, differs = 0, skipped = 0;
    for (const r of rows) {
      const parts = t(r.PTCS_PNLFLDNAME).split('.');
      const kind = parts[5] ?? '';
      if (kind === 'Srch' || kind === 'Prmpt') { skipped++; continue; }
      const key5 = parts.slice(0, 5).join('.');
      const cands = all.filter((f) => f.pageField.split('.').slice(0, 5).join('.') === key5 && (!kind || f.pageField.endsWith(`.${kind}`)) && f.page === t(r.PNLNAME));
      if (!cands.length) { missing++; if (verbose) console.log(`  missing ${t(C)} ${t(r.PTCS_PNLFLDNAME)} on ${t(r.PNLNAME)} (std ${t(r.STDPNLNAME)})`); continue; }
      const f = cands.find((x) => x.componentPage === t(r.STDPNLNAME)) ?? cands[0];
      const diffs: string[] = [];
      const cmp = (name: string, mine: unknown, theirs: unknown) => { if (t(mine) !== t(theirs)) diffs.push(`${name} ${t(mine)}|${t(theirs)}`); };
      cmp('STDPNLNAME', f.componentPage, r.STDPNLNAME);
      cmp('FIELDTYPE', f.fieldType, r.FIELDTYPE);
      cmp('FIELDUSE', f.fieldUse, r.FIELDUSE);
      cmp('OCCURSLEVEL', f.occursLevel, r.OCCURSLEVEL);
      cmp('SECOCCURSLEVEL', kind === 'S' ? f.level : 0, r.SECOCCURSLEVEL);
      cmp('RECNAME1', f.record1, r.RECNAME1);
      cmp('FIELDNAME1', f.field1, r.FIELDNAME1);
      cmp('RECNAME_BASE', f.recordBase, r.RECNAME_BASE);
      if (kind) cmp('EOCC_SBP_LEVEL', f.ownLevel, r.EOCC_SBP_LEVEL);
      if (t(r.EOCC_LBL_OVERRIDE) !== 'Y') cmp('LBLTEXT', f.label, r.LBLTEXT);
      if (diffs.length) { differs++; for (const d of diffs) tally[d.split(' ')[0]] = (tally[d.split(' ')[0]] ?? 0) + 1; if (verbose) console.log(`  differs ${t(C)} ${t(r.PTCS_PNLFLDNAME)}: ${diffs.join('; ')}`); }
      else ok++;
    }
    console.log(`${t(C)}.${t(M)}: ${ok} match, ${differs} differ, ${missing} not offered, ${skipped} search/prompt (catalog ${all.length} fields on ${catalog.length} pages)`);
  }
  console.log('differing columns:', JSON.stringify(tally));
});
await p.dispose();
