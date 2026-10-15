/** Static discovery, not runtime verification. */
import ts from 'typescript';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const rows: string[] = [];
for (const file of readdirSync('src/mcp').filter(f => f.endsWith('.ts'))) {
 const text = readFileSync('src/mcp/'+file,'utf8');
 const ast = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 function visit(node: ts.Node) {
  if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text==='registerTool' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
   const config=node.arguments[1]?.getText(ast)??'';
   if (/annotations:\s*(WRITE|DESTRUCTIVE)/.test(config)) {
    const body=node.arguments[2]?.getText(ast)??'';
    const calls=[...new Set([...body.matchAll(/\.(save\w*|create\w*|delete\w*|rename\w*|copy\w*|remove\w*|write\w*|add\w*)\(/g)].map(m=>m[1]))];
    const line=ast.getLineAndCharacterOfPosition(node.getStart()).line+1;
    rows.push(`| \`${node.arguments[0].text}\` | ${/DESTRUCTIVE/.test(config)?'Destructive':'Write'} | [${file}:${line}](../../src/mcp/${file}#L${line}) | ${calls.map(c=>'`'+c+'`').join(', ')||'Inspect delegated callback'} |`);
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);
}
let out='# MCP mutation inventory\n\nGenerated from registrations by `npx tsx tools/change-review/inventory.mts`.\nStatic routing evidence, not proof of complete snapshots, staging or reversibility.\nRead-only annotated tools with incidental local state are outside this mutation table.\n\n| Tool | Annotation | Registration | Direct writer-like calls |\n|---|---|---|---|\n'+rows.join('\n')+'\n\n## Commit boundary inventory\n\nEach listed file contains explicit commit/rollback calls. These are separate\nwriter transactions, not a multi-object atomic transaction. Counts are static;\ninspect each branch before assigning a transaction guarantee.\n\n| Module | Commit calls | Rollback calls |\n|---|---|---|\n';
for(const file of readdirSync('src/providers').filter(f=>f.endsWith('.ts'))) {
 const text=readFileSync('src/providers/'+file,'utf8');
 const commits=[...text.matchAll(/\.commit\(/g)].length,rollbacks=[...text.matchAll(/\.rollback\(/g)].length;
 if(commits||rollbacks)out+=`| [${file}](../../src/providers/${file}) | ${commits} | ${rollbacks} |\n`;
}
writeFileSync('docs/change-review/INVENTORY.md',out);console.log('Inventoried '+rows.length+' mutation registrations.');
