#!/usr/bin/env python3
"""
Cycle 94: discriminator matrices over `cycle94-method-row-truth-census.ts`
output (research only).

Truth per call (clean gaps of resolvable programs only):
  ALLOC  stored opened a PACKAGE.<class> row at the call
  REUSE  stored opened none
  AMBIG  several calls share the gap and only some opened a row

Usage:
  python3 cycle94-method-row-matrix.py <calls.jsonl> <feature>[,<feature>...] [--where expr] [--min N] [--ids]
Features are record fields or the derived ones below; `expr` is a Python
expression over the record `r` (e.g. "r['top'] and r['importMode']=='named'").
"""
import json
import sys
from collections import Counter, defaultdict


def truth(r):
    if r['callsInGap'] == 1:
        return 'ALLOC' if r['storedRows'] >= 1 else 'REUSE'
    if r['storedRows'] == 0:
        return 'REUSE'
    if r['storedRows'] >= r['callsInGap']:
        return 'ALLOC'
    return 'AMBIG'


def derive(r):
    r['truth'] = truth(r)
    r['context'] = 'function' if r['fn'] else ('top' if r['control'] == 0 and r['tries'] == 0 else ('try' if r['control'] == 0 else 'control'))
    r['top'] = r['context'] == 'top'
    r['decl'], r['phase'], r['init'] = (r['varKind'].split('/') + ['-', '-'])[:3]
    r['first'] = r['occVar'] == 1
    r['firstMethod'] = r['occVarMethod'] == 1
    r['firstClass'] = r['occClass'] == 1
    r['firstClassMethod'] = r['occClassMethod'] == 1
    r['classRowsBefore'] = min(len(r['storedClassRowsBefore']), 3)
    r['generated'] = 'ALLOC' if r['generatedRows'] >= r['callsInGap'] else ('REUSE' if r['generatedRows'] == 0 else 'AMBIG')
    return r


def main():
    rows = [derive(json.loads(line)) for line in open(sys.argv[1])]
    features = sys.argv[2].split(',') if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else []
    where = sys.argv[sys.argv.index('--where') + 1] if '--where' in sys.argv else 'True'
    minimum = int(sys.argv[sys.argv.index('--min') + 1]) if '--min' in sys.argv else 1
    usable = [r for r in rows if r['clean'] and not r['external']]
    print(f'calls {len(rows)}; external-metadata programs excluded {sum(1 for r in rows if r["external"])}; '
          f'unclean gaps excluded {sum(1 for r in rows if not r["external"] and not r["clean"])}; usable {len(usable)}')
    print('truth:', dict(Counter(r['truth'] for r in usable)), ' generated:', dict(Counter(r['generated'] for r in usable)))
    if not features:
        return
    table = defaultdict(Counter)
    ids = defaultdict(lambda: defaultdict(list))
    for r in usable:
        if not eval(where):
            continue
        key = tuple(str(r[f]) for f in features)
        table[key][r['truth']] += 1
        if len(ids[key][r['truth']]) < 6 and r['id'] not in ids[key][r['truth']]:
            ids[key][r['truth']].append(r['id'])
    print(' | '.join(features), '=> ALLOC / REUSE / AMBIG')
    for key, counts in sorted(table.items(), key=lambda kv: -sum(kv[1].values())):
        if sum(counts.values()) < minimum:
            continue
        line = f'{counts["ALLOC"]:5} {counts["REUSE"]:5} {counts["AMBIG"]:4}  ' + ' | '.join(key)
        if '--ids' in sys.argv:
            line += f'   A{ids[key]["ALLOC"][:4]} R{ids[key]["REUSE"][:4]}'
        print(line)


if __name__ == '__main__':
    main()
