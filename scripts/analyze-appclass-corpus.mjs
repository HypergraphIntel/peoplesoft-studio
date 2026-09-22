// Offline analysis of mine-appclass-corpus output. No database mutations.
// Usage: node scripts/analyze-appclass-corpus.mjs CAPTURES.json REPORT.json
import { readFileSync, writeFileSync } from 'node:fs';
import { readProgramLayout } from '../dist-test/peoplecode/programLayout.js';
const captures = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const output = process.argv[3];
if (!output) throw new Error('Provide input and report JSON paths');
const report = { definitions: [], errors: [], descriptorInventory: {}, propertyOrders: {}, methodOrders: {} };
const compare = (table, name, actual, expected) => {
  const counts = table[name] ??= { match: 0, mismatch: 0, counterexamples: [] };
  if (JSON.stringify(actual) === JSON.stringify(expected)) counts.match++;
  else { counts.mismatch++; if (counts.counterexamples.length < 6) counts.counterexamples.push({ actual, expected }); }
};
for (let index = 0; index < captures.length; index++) {
  const capture = captures[index];
  const key = Object.entries(capture.key).filter(([k, v]) => k.startsWith('OBJECTVALUE') && v !== ' ').map(([, v]) => v).join('.');
  try {
    const bytes = Buffer.concat(capture.programRows.map(r => Buffer.from(r.hex, 'hex')));
    const layout = readProgramLayout(bytes);
    const readName = charOffset => {
      const at = layout.names.offset + 2 * charOffset;
      if (at < layout.names.offset || at >= layout.records.offset) throw new Error('Name offset outside directory');
      let end = at;
      while (end < layout.records.offset && bytes.readUInt16LE(end)) end += 2;
      if (end === layout.records.offset) throw new Error('Unterminated name');
      return bytes.toString('utf16le', at, end);
    };
    const records = Array.from({ length: layout.recordCount }, (_, i) => {
      const offset = layout.records.offset + 16 * i;
      const [nameOffset, slotOffset, countFlags, descriptor] = [0, 4, 8, 12].map(d => bytes.readUInt32LE(offset + d));
      return { name: readName(nameOffset), nameOffset, slotOffset, countFlags, descriptor, offset };
    });
    // Only declarations are parsed here. Method bodies retain their raw source
    // in the captures; the search summaries are candidates, not a source parser.
    const clean = capture.source.replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|\/\+[\s\S]*?\+\//g, ' ').replace(/\brem\b[^;]*;/gi, ' ');
    const split = clean.search(/\bend-(?:class|interface)\b/i);
    const declaration = split < 0 ? '' : clean.slice(0, split);
    const implementations = [...clean.slice(split).matchAll(/^\s*(method|get|set)\s+(\w+)\s*$/gmi)].map(m => ({ kind: m[1].toLowerCase(), name: m[2] }));
    const sourceMethods = [...declaration.matchAll(/\bmethod\s+(\w+)\s*\(([^)]*)\)\s*(?:Returns\s+((?:array\s+of\s+)*[\w:]+))?/gi)];
    const methods = [];
    for (const m of sourceMethods) {
      const parameters = m[2].trim() ? m[2].split(',').map(p => {
        const match = /^\s*(&\w+)\s+As\s+((?:array\s+of\s+)*[\w:]+)\s*(out)?\s*$/i.exec(p);
        return match ? { name: match[1], type: match[2].toLowerCase().replace(/\s+/g, ' '), out: !!match[3] } : null;
      }) : [];
      if (parameters.some(p => p === null)) continue;
      const rec = records.find(r => r.name.toLowerCase() === m[1].toLowerCase() && (r.countFlags & 0xffff) === parameters.length && (r.countFlags & 0x7e0000) === 0);
      if (!rec || rec.slotOffset + parameters.length + 1 > layout.slotCount) continue;
      const slots = Array.from({ length: parameters.length + 1 }, (_, i) => bytes.readUInt32LE(layout.slots.offset + (rec.slotOffset + i) * 4));
      const method = { ...rec, parameters, returnType: m[3]?.toLowerCase().replace(/\s+/g, ' '), slots, sourceIndex: m.index, declarationIndex: methods.length };
      methods.push(method);
      for (const [role, type, value] of [...parameters.map((p, i) => [p.out ? 'out' : 'parameter', p.type, slots[i]]), ['return', method.returnType ?? '(none)', rec.descriptor]]) {
        const id = `${role}:${type}`;
        const item = report.descriptorInventory[id] ??= { count: 0, values: {}, examples: [] };
        item.count++;
        const hex = '0x' + value.toString(16);
        item.values[hex] = (item.values[hex] ?? 0) + 1;
        if (item.examples.length < 6) item.examples.push({ index, key, method: method.name, value: hex });
      }
    }
    const properties = [...declaration.matchAll(/\bproperty\s+((?:array\s+of\s+)*[\w:]+)\s+(\w+)\s*([^;]*);/gi)].map((m, i) => {
      const rec = records.find(r => r.name.toLowerCase() === m[2].toLowerCase() && (r.countFlags & 0x20000));
      const preceding = declaration.slice(0, m.index);
      const visibility = [...preceding.matchAll(/\b(private|protected|public)\b/gi)].at(-1)?.[1]?.toLowerCase() ?? 'public';
      return { name: m[2], type: m[1].toLowerCase(), modifiers: m[3].trim(), visibility, declarationIndex: i, implementations: implementations.filter(x => x.kind !== 'method' && x.name.toLowerCase() === m[2].toLowerCase()), record: rec };
    });
    const propertyOrder = properties.filter(p => p.record).sort((a, b) => a.record.offset - b.record.offset).map(p => p.name);
    if (properties.length >= 2 && propertyOrder.length === properties.length) {
      const names = properties.map(p => p.name);
      compare(report.propertyOrders, 'declaration', propertyOrder, names);
      compare(report.propertyOrders, 'reverseDeclaration', propertyOrder, [...names].reverse());
      compare(report.propertyOrders, 'lexical', propertyOrder, [...names].sort());
      compare(report.propertyOrders, 'caseInsensitiveLexical', propertyOrder, [...names].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
      compare(report.propertyOrders, 'typeGrouping', propertyOrder, [...properties].sort((a, b) => a.type.localeCompare(b.type)).map(p => p.name));
      compare(report.propertyOrders, 'visibilityGrouping', propertyOrder, [...properties].sort((a, b) => a.visibility.localeCompare(b.visibility)).map(p => p.name));
      compare(report.propertyOrders, 'slotIndex', propertyOrder, [...properties].sort((a, b) => a.record.slotOffset - b.record.slotOffset).map(p => p.name));
      compare(report.propertyOrders, 'nameOffset', propertyOrder, [...properties].sort((a, b) => a.record.nameOffset - b.record.nameOffset).map(p => p.name));
      const getterSetterOrder = [...new Set(implementations.filter(x => x.kind !== 'method' && names.includes(x.name)).map(x => x.name))];
      if (getterSetterOrder.length === names.length) compare(report.propertyOrders, 'getSetImplementation', propertyOrder, getterSetterOrder);
      if (!/\bextends\b/i.test(declaration) && properties.every(p => !p.modifiers && p.visibility === 'public' && !p.implementations.length)) {
        compare(report.propertyOrders, 'plainPublicDeclaration', propertyOrder, names);
      }
    }
    const concrete = methods.filter(m => m.countFlags < 0x20000 && implementations.some(i => i.kind === 'method' && i.name.toLowerCase() === m.name.toLowerCase()));
    if (concrete.length >= 2) {
      const declared = concrete.map(m => m.name.toLowerCase());
      const implemented = implementations.filter(i => i.kind === 'method' && declared.includes(i.name.toLowerCase())).map(i => i.name.toLowerCase());
      const directory = [...concrete].sort((a, b) => a.offset - b.offset).map(m => m.name.toLowerCase());
      const slots = [...concrete].sort((a, b) => a.slotOffset - b.slotOffset).map(m => m.name.toLowerCase());
      compare(report.methodOrders, 'directoryVsDeclaration', directory, declared);
      compare(report.methodOrders, 'directoryVsImplementation', directory, implemented);
      compare(report.methodOrders, 'slotsVsDeclaration', slots, declared);
      compare(report.methodOrders, 'slotsVsImplementation', slots, implemented);
    }
    const imports = [...clean.matchAll(/\bimport\s+([\w:*]+)\s*;/gi)].map(m => m[1]);
    const locals = [...clean.matchAll(/\bLocal\s+((?:array\s+of\s+)*[\w:]+)\s+(&\w+)/gi)].map(m => ({ type: m[1], variable: m[2] }));
    const creates = [...clean.matchAll(/\bcreate\s+([\w:]+)\s*\(/gi)].map(m => m[1]);
    const calls = [...clean.matchAll(/([&%]\w+)\.(\w+)\s*\(/g)].map(m => ({ receiver: m[1], method: m[2] }));
    report.definitions.push({ index, key, sourceLength: capture.source.length, layout, inherited: /\bextends\b/i.test(declaration), interface: /\binterface\b/i.test(declaration), records, methods, properties, implementations, imports, locals, creates, calls, packages: capture.names.filter(n => n.RECNAME === 'PACKAGE') });
  } catch (error) { report.errors.push({ index, key, message: error.message }); }
}
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ definitions: report.definitions.length, errors: report.errors, propertyOrders: report.propertyOrders, methodOrders: report.methodOrders }, null, 2));
