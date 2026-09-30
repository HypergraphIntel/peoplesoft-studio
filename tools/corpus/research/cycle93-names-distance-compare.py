#!/usr/bin/env python3
"""
Cycle 93: compare two `cycle93-names-distance-sweep.ts` outputs (research only).

For every definition whose generated PSPCMNAME list changed between the two
encoder states, measure the edit distance from the stored list before and
after. Reports closer / farther / same, names-exact gained and lost,
forward-exact gained and lost, and the changed set split by whether the
stored PACKAGE rows carry descriptive content (PACKAGEROOT).

Usage: python3 cycle93-names-distance-compare.py <before.json> <after.json> [--show id,id,...]
"""
import json
import sys
from difflib import SequenceMatcher


def distance(stored, generated):
    total = 0
    for tag, i1, i2, j1, j2 in SequenceMatcher(a=stored, b=generated, autojunk=False).get_opcodes():
        if tag != 'equal':
            total += max(i2 - i1, j2 - j1)
    return total


def main():
    before = json.load(open(sys.argv[1]))
    after = json.load(open(sys.argv[2]))
    closer, farther, same, names_gained, names_lost = [], [], [], [], []
    for key, a in before.items():
        b = after.get(key)
        if b is None or a['g'] == b['g']:
            continue
        da, db = distance(a['s'], a['g']), distance(b['s'], b['g'])
        (closer if db < da else farther if db > da else same).append(int(key))
        if db == 0 and da > 0:
            names_gained.append(int(key))
        if da == 0 and db > 0:
            names_lost.append(int(key))
    exact_gained = sorted(int(k) for k in before if k in after and not before[k]['x'] and after[k]['x'])
    exact_lost = sorted(int(k) for k in before if k in after and before[k]['x'] and not after[k]['x'])
    bytes_changed = sum(1 for k in before if k in after and before[k]['h'] != after[k]['h'])
    print(f'PSPCMNAME lists changed: {len(closer) + len(farther) + len(same)}')
    print(f'  closer to stored: {len(closer)}')
    print(f'  farther from stored: {len(farther)} {sorted(farther)}')
    print(f'  same distance: {len(same)} {sorted(same)}')
    print(f'names-exact gained: {len(names_gained)}; lost: {len(names_lost)} {sorted(names_lost)}')
    print(f'programs with changed bytes: {bytes_changed}')
    print(f'forward-exact gained: {len(exact_gained)} {exact_gained}')
    print(f'forward-exact lost: {len(exact_lost)} {exact_lost}')
    if '--show' in sys.argv:
        for key in sys.argv[sys.argv.index('--show') + 1].split(','):
            def fmt(rows):
                return ' '.join(x.replace('PACKAGE.', '') or '_' for x in rows)
            print(key)
            print('  stored:', fmt(before[key]['s']))
            print('  before:', fmt(before[key]['g']))
            print('  after :', fmt(after[key]['g']))


if __name__ == '__main__':
    main()
