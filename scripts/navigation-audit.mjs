/** Report every contributed command's mouse-accessible home, including picker
 * choices and contextual tree rows that do not need their own menu entries. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function auditNavigation(manifest) {
  const homes = new Map();
  const add = (command, home) => homes.set(command, [...(homes.get(command) ?? []), home]);
  const menus = manifest.contributes.menus;
  const submenus = new Set((manifest.contributes.submenus ?? []).map(s => s.id));
  const roots = Object.keys(menus).filter(k => !submenus.has(k) && k !== 'commandPalette');
  function visit(location, via = [], seen = new Set()) {
    if (seen.has(location)) throw new Error('Menu cycle: ' + location);
    const next = new Set([...seen, location]);
    for (const item of menus[location] ?? []) {
      if (item.command) add(item.command, [...via, location, item.when ?? ''].filter(Boolean).join(' → '));
      if (item.submenu) visit(item.submenu, [...via, location], next);
    }
  }
  for (const menu of roots) visit(menu);
  for (const file of ['src/model/toolTrees.ts', 'src/model/customizationStrategy.ts', 'src/settings/settingsView.ts',
    'src/views/discoveryView.ts', 'src/views/connections.ts', 'src/views/browser.ts', 'src/views/projects.ts', 'src/views/changeReviewView.ts']) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/command:\s*(?:\{\s*(?:id|command):\s*)?['"](psft\.[^'"]+)['"]/g)) add(match[1], file);
  }
  add('psft.plannedTool', 'Configuration Tools / Data Migration Tools → Coming soon rows (internal placeholder)');
  const indirect = {
    'psft.clearRecentProjects': ['psft.openRecentProject', 'Clear Recent Projects choice'],
    'psft.buildProject': ['psft.project.build', 'same guarded build handler'],
    'psft.changeReview.apply': ['psft.changeReview.open', 'legacy navigation alias; application is a trusted workspace button'],
    'psft.changeReview.revert': ['psft.changeReview.open', 'legacy navigation alias; Prepare revert is in More actions'],
    'psft.changeReview.redo': ['psft.changeReview.open', 'legacy navigation alias; Prepare redo is in More actions']
  };
  for (const [command, choice] of Object.entries({ newPage: 'Page', newPageFluid: 'Page Fluid', newAppEngine: 'App Engine Program',
    newMenu: 'Menu', newComponentInterface: 'Component Interface', newMessageChannel: 'Message Channel',
    newHtmlDefinition: 'HTML Definition', newSqlDefinition: 'SQL Definition', newStyleSheet: 'Style Sheet' })) {
    indirect['psft.' + command] = ['psft.newDefinition', 'New Definition picker → ' + choice];
  }
  for (const [command, [entry, label]] of Object.entries(indirect)) {
    if (!homes.has(entry)) throw new Error('Unreachable navigation entry: ' + entry);
    add(command, entry + ' → ' + label);
  }
  const declared = manifest.contributes.commands.map(c => c.command);
  const missing = declared.filter(command => !homes.has(command));
  if (missing.length) throw new Error('Commands without a navigation home: ' + missing.join(', '));
  return declared.map(command => ({ command, homes: homes.get(command) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditNavigation(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(`Navigation coverage: ${report.length}/${report.length} commands have a menu, tree, picker or trusted workspace home.`);
}
