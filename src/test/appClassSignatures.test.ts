import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSignatureComments, type SignatureResolver } from '../model/appClassSignatures.js';

/*
 * App Designer's save writes signature comments into each method, get and set body. The rules
 * reproduce 1,382 of 1,387 Application Class sources in the 8.61.15 corpus exactly; these cases
 * pin each rule with lab classes.
 */

function resolver(classes: Record<string, string>): SignatureResolver {
  const byLower = new Map(Object.keys(classes).map((k) => [k.toLowerCase(), k]));
  return { canonical: async (p) => byLower.get(p.toLowerCase()), source: async (p) => classes[p] };
}

const BASE = `class Base
   method Base();
   method Shared(&a As string) Returns number;
   method Concrete();
   property string Title get;
protected
   method Hook() abstract;
   method Helper();
private
   method Hidden();
end-class;
`;

test('parameters, out, commas, returns and types are written as App Designer writes them', async () => {
  const source = `import ZZ_LAB:Util:*;
import ZZ_LAB:Item;

class Worker
   method Worker(&name As string);
   method Run(&count As integer, &items As array of array of string, &item As Item, &helper As Helper out) Returns array of Item;
   method Free(&x As array) Returns array2;
   method Meta() Returns %metadata:ProjectDefn:ProjectDefn;
   property boolean Ready get set;
end-class;

method Worker
   /+ &name as String +/
end-method;

method Run
   /+ stale +/
   Return Null;
end-method;

method Free
   Return Null;
end-method;

method Meta
end-method;

get Ready
   Return True;
end-get;

set Ready
end-set;
`;
  const out = await addSignatureComments(source, 'ZZ_LAB:Worker', resolver({ 'ZZ_LAB:Item': '', 'ZZ_LAB:Util:Helper': '' }));
  assert.equal(out, source
    .replace('   /+ stale +/\n', ['   /+ &count as Integer, +/', '   /+ &items as Array2 of String, +/', '   /+ &item as ZZ_LAB:Item, +/',
      '   /+ &helper as ZZ_LAB:Util:Helper out +/', '   /+ Returns Array of ZZ_LAB:Item +/', ''].join('\n'))
    .replace('method Free\n', 'method Free\n   /+ &x as Array of Any +/\n   /+ Returns Array2 of Any +/\n')
    .replace('method Meta\n', 'method Meta\n   /+ Returns %Metadata:ProjectDefn:ProjectDefn +/\n')
    .replace('get Ready\n', 'get Ready\n   /+ Returns Boolean +/\n')
    .replace('set Ready\n', 'set Ready\n   /+ &NewValue as Boolean +/\n'));
  // Saving again changes nothing.
  assert.equal(await addSignatureComments(out, 'ZZ_LAB:Worker', resolver({ 'ZZ_LAB:Item': '', 'ZZ_LAB:Util:Helper': '' })), out);
});

test('Extends/implements names the nearest public or protected-abstract declaration, in its casing', async () => {
  const source = `import ZZ_LAB:Base;

class Child extends Base
   method Child();
   method shared(&a As string) Returns number;
   method Concrete();
   method Hook();
   method Helper();
   method Hidden();
   property string Title get;
end-class;

method Child
end-method;

method shared
end-method;

method Concrete
end-method;

method Hook
end-method;

method Helper
end-method;

method Hidden
end-method;

get Title
end-get;
`;
  const out = await addSignatureComments(source, 'ZZ_LAB:Child', resolver({ 'ZZ_LAB:Base': BASE }));
  assert.match(out, /method shared\n   \/\+ &a as String \+\/\n   \/\+ Returns Number \+\/\n   \/\+ Extends\/implements ZZ_LAB:Base\.Shared \+\/\n/);
  assert.match(out, /method Concrete\n   \/\+ Extends\/implements ZZ_LAB:Base\.Concrete \+\/\n/);
  assert.match(out, /method Hook\n   \/\+ Extends\/implements ZZ_LAB:Base\.Hook \+\/\n/, 'protected and abstract');
  assert.match(out, /method Helper\nend-method/, 'protected, not abstract: no line');
  assert.match(out, /method Hidden\nend-method/, 'private: not inherited');
  assert.match(out, /get Title\n   \/\+ Returns String \+\/\n   \/\+ Extends\/implements ZZ_LAB:Base\.Title \+\/\n/);
  assert.match(out, /method Child\nend-method/, 'a constructor without parameters gets nothing');
});

test('the walk passes a protected concrete declaration to an abstract one above it; a built-in parent ends it', async () => {
  const mid = `import ZZ_LAB:Base;\nclass Mid extends Base\nprotected\n   method Hook();\nend-class;\n`;
  const source = `import ZZ_LAB:Mid;\nclass Leaf extends Mid\n   method Hook();\nend-class;\n\nmethod Hook\nend-method;\n`;
  const out = await addSignatureComments(source, 'ZZ_LAB:Leaf', resolver({ 'ZZ_LAB:Base': BASE, 'ZZ_LAB:Mid': mid }));
  assert.match(out, /method Hook\n   \/\+ Extends\/implements ZZ_LAB:Base\.Hook \+\/\n/);
  const builtIn = `class Problem extends Exception\n   method Problem(&why As string);\n   method ToString() Returns string;\nend-class;\n\nmethod ToString\nend-method;\n`;
  assert.match(await addSignatureComments(builtIn, 'ZZ_LAB:Problem', resolver({})), /method ToString\n   \/\+ Returns String \+\/\nend-method/);
});

test('indent follows the header, a statement terminator after the block stays, and commented-out code is left alone', async () => {
  const source = `class Odd
   method Go() Returns string;
end-class;

   method Go
      /+ Returns string +/;
   Return "x";
end-method;

/*method Old
   /+ Returns String +/
end-method;*/
`;
  const out = await addSignatureComments(source, 'ZZ_LAB:Odd', resolver({}));
  assert.equal(out, source.replace('      /+ Returns string +/;', '      /+ Returns String +/;'));
});

test('an interface is left as written', async () => {
  const source = `interface Shape\n   method Area() Returns number;\nend-interface;\n`;
  assert.equal(await addSignatureComments(source, 'ZZ_LAB:Shape', resolver({})), source);
});
