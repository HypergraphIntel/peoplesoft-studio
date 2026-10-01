#!/usr/bin/env python3
"""
Cycle 108: candidate lifetime models for Application Class method-dependency
rows inside Application Class programs, scored against stored PSPCMNAME
(research only). Input: `cycle108-app-class-method-row-census.ts` groups.

A model decides, for each typed call, whether it opens a new row of its
receiver class or reuses one. Its prediction for a gap (see the census) is
the generated TYPE rows of the class in that gap (committed behavior, kept
as is) plus the calls in the gap that open; it contradicts stored when that
count differs from the stored rows of the class in the gap. `current` is the
committed encoder (its generated rows of the class, type and method).

Models (the key a row is reused under; a new scope opens a new row):
  A  program      class, whole program
  B  body         class, one method / get / set body
  C  method       class + called method, whole program
  D  body+method  class + called method, one body
  S  statement    class, one top-level statement of a body
  T  simple       class, one `;` statement
  N  none         every call opens

`A+t+rev`: A+types, and a type row after a row A opened for a call reuses
it (one program-wide pool of the class, both directions).

`+types`: an earlier generated type row of the class (import, declaration
dependency, Local, create -- not a row the committed encoder allocated
for a call, `byCall`) also satisfies the key -- program-wide for A / C,
in the same body or the header for B / D / S / T.

Usage: python3 cycle108-app-class-method-row-models.py <groups.jsonl> [--family F] [--base B] [--clean] [--pairs] [--show MODEL]
"""
import json
import sys
from collections import Counter, defaultdict

path = sys.argv[1]
family_filter = sys.argv[sys.argv.index('--family') + 1] if '--family' in sys.argv else None
base_filter = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else None
clean_only = '--clean' in sys.argv
show = sys.argv[sys.argv.index('--show') + 1] if '--show' in sys.argv else None

MODELS = {
    'A': lambda c: ('A',),
    'B': lambda c: ('B', c['impl']),
    'C': lambda c: ('C', c['method']),
    'D': lambda c: ('D', c['impl'], c['method']),
    'S': lambda c: ('S', c['impl'], c['stmt']),
    'T': lambda c: ('T', c['impl'], c['simple']),
    'N': None,
}
TYPE_SCOPE = {
    'A': lambda e: [('A',)],
    'B': lambda e: [('B', e['impl'])],
    'C': None,  # a type row has no method: seeds every method (handled below)
    'D': None,
    'S': lambda e: [],
    'T': lambda e: [],
    'N': lambda e: [],
}


def simulate(group, model, seed_types, reverse=False):
    """Predicted rows per gap. `reverse`: a type row after a row the model
    opened for a call reuses it (one class pool, both directions; A only)."""
    predicted = Counter()
    pool = set()
    type_seen_program = False
    type_seen_impl = set()
    for e in group['events']:
        if e['t'] == 'gtype' and e.get('byCall'):
            continue  # the committed encoder's row FOR a call: the model decides it
        if e['t'] == 'gtype':
            if reverse and ('A',) in pool:
                continue
            predicted[e['gap']] += 1
            type_seen_program = True
            type_seen_impl.add(e['impl'])
            continue
        if e['t'] == 'gmethod':
            continue
        if model == 'N':
            predicted[e['gap']] += 1
            continue
        key = MODELS[model](e)
        reused = key in pool
        if not reused and seed_types:
            if model in ('A', 'C'):
                reused = type_seen_program
            elif model in ('B', 'D', 'S', 'T'):
                reused = e['impl'] in type_seen_impl or -1 in type_seen_impl
        if not reused:
            predicted[e['gap']] += 1
            pool.add(key)
    return predicted


def current(group):
    predicted = Counter()
    for e in group['events']:
        if e['t'] in ('gtype', 'gmethod'):
            predicted[e['gap']] += 1
    return predicted


groups = []
for line in open(path):
    g = json.loads(line)
    if g['encodeError'] or g['ambiguous']:
        continue
    calls = [e for e in g['events'] if e['t'] == 'call']
    if family_filter is not None:
        if not any(c['family'] == family_filter for c in calls):
            continue
        # keep only this family's calls (other families' rows are noise for this view)
        g['events'] = [e for e in g['events'] if e['t'] != 'call' or e['family'] == family_filter]
    if base_filter is not None:
        if not any(c['steps'].split('>')[0] == base_filter for c in calls):
            continue
        g['events'] = [e for e in g['events'] if e['t'] != 'call' or e['steps'].split('>')[0] == base_filter]
    if clean_only and any(v['unmatchedStored'] or v['unmatchedGenerated'] for v in g['gaps'].values()):
        continue
    groups.append(g)

print(f"groups {len(groups)}  calls {sum(1 for g in groups for e in g['events'] if e['t'] == 'call')}"
      f"  exact-programs {len({g['id'] for g in groups if g['exact']})}  nonexact-programs {len({g['id'] for g in groups if not g['exact']})}")


def score(predict):
    gap_bad = gap_all = group_bad = 0
    bad_ids = []
    exact_bad = 0
    for g in groups:
        p = predict(g)
        bad = 0
        for gap, info in g['gaps'].items():
            gap_all += 1
            if p[gap] != len(info['stored']):
                bad += 1
        gap_bad += bad
        if bad:
            group_bad += 1
            bad_ids.append(g['id'])
            if g['exact']:
                exact_bad += 1
    return gap_bad, gap_all, group_bad, exact_bad, bad_ids


rows = [('current', current)]
for m in MODELS:
    rows.append((m, lambda g, m=m: simulate(g, m, False)))
    if m != 'N':
        rows.append((m + '+types', lambda g, m=m: simulate(g, m, True)))
rows.append(('A+t+rev', lambda g: simulate(g, 'A', True, True)))
print(f"{'model':10} {'bad gaps':>9} {'/ gaps':>7} {'bad groups':>11} {'(EXACT)':>8}   examples")
for name, fn in rows:
    gap_bad, gap_all, group_bad, exact_bad, ids = score(fn)
    print(f"{name:10} {gap_bad:9} {gap_all:7} {group_bad:11} {exact_bad:8}   {sorted(set(ids))[:10]}")
    if show == name:
        for g in groups:
            p = fn(g)
            for gap, info in g['gaps'].items():
                if p[gap] != len(info['stored']):
                    evs = [f"{e['t']}:{e.get('method','')}@{e.get('impl')}/{e.get('stmt')}" for e in g['events'] if e['gap'] == gap]
                    print(f"    {g['id']} {g['cls']} exact={g['exact']} gap {gap} stored {len(info['stored'])} predicted {p[gap]} {evs[:8]}")

if '--pairs' in sys.argv:
    # Phase 20: consecutive same-class calls; truth only where the later call is alone in its gap
    print('\npairs (later call alone in its gap, no type row in that gap): same-scope / cross-scope x stored reuse / open')
    for m in ['A', 'B', 'C', 'D', 'S', 'T']:
        t = Counter()
        for g in groups:
            calls = [e for e in g['events'] if e['t'] == 'call']
            by_gap = defaultdict(list)
            for e in g['events']:
                by_gap[e['gap']].append(e)
            for prev, cur in zip(calls, calls[1:]):
                if len(by_gap[cur['gap']]) != 1 or prev['gap'] == cur['gap']:
                    continue
                stored = len(g['gaps'][cur['gap']]['stored'])
                if stored > 1:
                    continue
                same = MODELS[m](prev) == MODELS[m](cur)
                t[(same, 'reuse' if stored == 0 else 'open')] += 1
        print(f"  {m}: same-scope reuse {t[(True,'reuse')]:5}  same-scope open {t[(True,'open')]:5}"
              f"  cross-scope reuse {t[(False,'reuse')]:5}  cross-scope open {t[(False,'open')]:5}")
