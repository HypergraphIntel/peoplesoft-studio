/* Page and Field Configurator: derived Event Mapping vs what is stored, for every configuration on the database (read only). */
import { DatabaseProvider } from '../../src/providers/database';
import { derivePfcMappings, pfcContentReferences, type PfcMapping } from '../../src/providers/pfcMapper';
const p = new DatabaseProvider({ name: 'HRDMO', platform: 'oracle', connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
const sig = (m: { serviceId: string; level: string; record?: string; field?: string; page?: string; event: string; sequence: number }) =>
  [m.serviceId, m.level, m.record ?? '', m.field ?? '', m.page ?? '', m.event, m.sequence].join('|');
const family = (type: string, s: string) => type === 'MASK' ? s.startsWith('EOCC_MASK_') : type === 'TRK' ? s.startsWith('EOCC_CHGTRK_') : s.startsWith('EOCC_') && !s.startsWith('EOCC_MASK_') && !s.startsWith('EOCC_CHGTRK_');
const hdrs = (await p.runReadOnlyQuery('SELECT PNLGRPNAME C, MARKET M, EOCC_CONFIG_TYPE T FROM PS_EOCC_CONFIG_HDR ORDER BY 1,3', 50)).rows;
await (p as any).withConnection(async (c: any) => {
  for (const h of hdrs) {
    const comp = String(h.C).trim(), mkt = String(h.M).trim(), type = String(h.T).trim();
    const want = await derivePfcMappings(c, comp, mkt, type);
    const crefs = await pfcContentReferences(c, comp, mkt);
    for (const { cref } of crefs) {
      const rows = (await c.execute(`SELECT PTCS_SERVICEID S, PTCS_ISCOMPSERVICE L, RECNAME R, FIELDNAME F, PNLNAME P, PTCS_CMPEVENT CE, PTCS_CMPRECEVENT RE, SEQNUM Q, LASTUPDDTTM D
        FROM PSPTCSSRVCONF WHERE PORTAL_NAME='_PTCS_PTEVMAP' AND PORTAL_OBJNAME=:n AND PTCS_SERVICEID LIKE 'EOCC%'`, { n: cref }, { outFormat: 4002 })).rows
        .filter((r: any) => family(type, String(r.S).trim()));
      const stored = rows.map((r: any) => sig({ serviceId: String(r.S).trim(), level: String(r.L).trim(), record: String(r.R).trim(), field: String(r.F ?? '').trim(), page: String(r.P).trim(),
          event: String(r.L).trim() === 'C' ? String(r.CE).trim() : String(r.RE).trim(), sequence: Number(r.Q) }));
      if (!stored.length) { console.log(`${comp}.${mkt} ${type} @ ${cref}: not applied (derived ${want.length})`); continue; }
      const w = want.map(sig).sort(), s = stored.sort();
      const missing = w.filter((x) => !s.includes(x)), extra = s.filter((x) => !w.includes(x));
      // STALE: nothing stored that the rules don't derive, and a derived service was delivered after the mappings were generated (an older release's save).
      const generated = Math.max(...rows.map((r: any) => new Date(r.D).getTime()));
      const services = [...new Set(missing.map((x) => x.split('|')[0]))];
      const defined = services.length ? (await c.execute(`SELECT MAX(LASTUPDDTTM) D FROM PSPTCSSRVDEFN WHERE PTCS_SERVICEID IN (${services.map((_, i) => `:s${i}`).join(',')})`,
        Object.fromEntries(services.map((x, i) => [`s${i}`, x])), { outFormat: 4002 })).rows[0] as any : undefined;
      const stale = !extra.length && defined && new Date(defined.D).getTime() > generated;
      console.log(`${comp}.${mkt} ${type} @ ${cref}: derived ${w.length}, stored ${s.length} ${!missing.length && !extra.length ? 'MATCH' : stale ? `STALE (generated ${new Date(generated).toISOString().slice(0, 10)}, services delivered ${new Date(defined.D).toISOString().slice(0, 10)})` : 'DIFF'}`);
      for (const x of missing) console.log(`    - derived only: ${x}`);
      for (const x of extra) console.log(`    + stored only:  ${x}`);
    }
  }
});
await p.dispose();
