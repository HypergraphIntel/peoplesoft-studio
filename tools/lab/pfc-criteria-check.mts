/* Page and Field Configurator: every stored criteria row compared with the criteria catalog the configurator would offer (read only). */
import { DatabaseProvider } from '../../src/providers/database';
import { catalogCriteriaRow, pfcCatalogFields, pfcCatalogPages, pfcFieldTypes } from '../../src/providers/pfcCatalog';
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const t = (v: unknown) => String(v ?? '').trim();
await (p as any).withConnection(async (c: any) => {
  const rows = (await c.execute(`SELECT * FROM PS_EOCC_CONFIG_CRT ORDER BY PNLGRPNAME, EOCC_SEQUENCE_NBR`, {}, { outFormat: 4002 })).rows;
  const catalogs = new Map<string, Awaited<ReturnType<typeof pfcCatalogFields>>>();
  let match = 0, differ = 0, missing = 0, system = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (t(r.RECNAME) === 'SYSTEM_VARIABLE') { system++; continue; }
    const comp = `${t(r.PNLGRPNAME)}.${t(r.MARKET)}`;
    if (!catalogs.has(comp)) {
      const all = [];
      for (const pg of (await pfcCatalogPages(c, t(r.PNLGRPNAME), t(r.MARKET))).filter((x) => x.type === 'P')) all.push(...await pfcCatalogFields(c, pg.page, 'P', { criteria: true }));
      catalogs.set(comp, all);
    }
    const f = catalogs.get(comp)!.find((x) => x.record === t(r.RECNAME) && x.field === t(r.FIELDNAME) && x.pnlfldid === Number(r.PNLFLDID) && x.page === t(r.PNLNAME));
    const tag = `${comp} seq ${Number(r.EOCC_SEQUENCE_NBR)} ${t(r.RECNAME)}.${t(r.FIELDNAME)}`;
    if (!f) { missing++; if (!seen.has(tag)) console.log(`  not offered: ${tag} on ${t(r.PNLNAME)} #${Number(r.PNLFLDID)}`); seen.add(tag); continue; }
    const types = await pfcFieldTypes(c, [f.field]);
    const mine = catalogCriteriaRow(f, types.get(f.field) ?? 0, { SEQUENCE_NBR: Number(r.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: Number(r.EOCC_SEQUENCE_NBR) }, t(r.EOCC_CRITERIA_SYM));
    const diffs = ['RECNAME', 'FIELDNAME', 'PNLFLDID', 'PNLNAME', 'OCCURSLEVEL', 'EOCC_FIELD_TYPE', 'LBLTEXT', 'RECNAME1', 'FIELDNAME1', 'RECNAME_BASE']
      .filter((k) => t(mine[k]) !== t(r[k])).map((k) => `${k} ${t(mine[k])}|${t(r[k])}`);
    if (diffs.length) { differ++; console.log(`  differs: ${tag}: ${diffs.join('; ')}`); } else match++;
  }
  console.log(`criteria rows: ${match} match, ${differ} differ, ${missing} not offered, ${system} system variables (of ${rows.length})`);
});
await p.dispose();
