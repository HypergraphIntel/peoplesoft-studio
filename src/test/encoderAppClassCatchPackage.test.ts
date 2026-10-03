import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeProgramArtifacts } from '../peoplecode/encoder.js';

/*
 * Cycle 137: an Application Class `catch <Class> &e` allocates nothing by
 * itself; a method call on the variable uses the class row, as in
 * ordinary PeopleCode (Cycle 111). 29979 `catch PTAF_CORE:EXCEPTIONS:
 * SACError &e` ... `&e.GetSubstitution(..)` stores PACKAGE.SACERROR; 30207
 * `catch PTPP_PORTAL:EXCEPTION:PortalException &ex` with no call on `&ex`
 * stores none.
 */
const owner = { recordName: 'APP', fieldName: 'Demo', packagePath: ['APP', 'Demo'] };
const packages = (catchBody: string) => encodeProgramArtifacts(
  `import PKG:*;\n\nclass Demo\n   method Run();\nend-class;\n\nmethod Run\n   try\n      &x = 2;\n   catch PKG:Err &e\n      ${catchBody}\n   end-try;\nend-method;\n`,
  { owner }
).references.filter(r => r.kind === 'package').map(r => (r as { packageName?: string }).packageName);

test('a method call on an Application Class catch variable uses its class row (29979)', () => {
  assert.deepEqual(packages('&e.Report();'), ['', 'ERR']);
});

test('an Application Class catch with no call on its variable allocates no class row (30207)', () => {
  assert.deepEqual(packages('&x = 1;'), ['']);
});
