import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: !watch,
  // vscode is provided by the host; oracledb loads native/thin bits at runtime;
  // ibm_db (DB2) is not shipped: it is loaded from where Install DB2 Driver put
  // it (src/db/db2.ts). mssql (SQL Server, pure JavaScript) is bundled.
  external: ['vscode', 'oracledb', 'ibm_db'],
  logLevel: 'info'
});

if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
