import * as z from 'zod/v4';

/**
 * A File Layout as a migration carries it: the document its window opens (fileLayoutDocument.ts), which holds every stored
 * PSFLDDEFN / PSFLDSEGDEFN / PSFLDFIELDDEFN column but the keys, the derived counts and sequence numbers and the save
 * stamp. The target saves it with the File Layout writer (a new one as File > New then Save does). Migration derives no
 * prerequisites from it: the writer checks none, and records meet a layout at run time (ReadRowset).
 */
const values = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
export const fileLayoutMigrationSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_#@$]{0,29}$/), v: values,
  segments: z.array(z.object({ name: z.string().min(1).max(30), parent: z.string().max(30), v: values,
    fields: z.array(z.object({ name: z.string().min(1).max(30), v: values }).strict()) }).strict())
}).strict();

