#!/usr/bin/env python3
"""
Cycle 97: member identity census (research only).

Input: `cycle97-member-identity-dump.ts` output (stored and generated token
streams of every ordinary definition, EXACT ones included).

Stored and generated streams are aligned on a member-normalized form
(an inline name `a:X` and a shorthand row `N4a:KIND.X` both become `M:X`),
so a member written inline on one side and as a PSPCMNAME row on the other
lines up. For every aligned member position this records:

  ROW_ROW      both sides open a row (same kind)
  GEN_ROW      generated opens a row, stored writes the member inline
               (Direction 1: bogus row for a built-in member)
  STORED_ROW   stored opens a row, generated writes it inline (Direction 2)

keyed by the row kind (RECORD / FIELD / SCROLL / ...) and member name. The
row kind is the receiver position the encoder believed it was in: a
RECORD row after a Row value, a FIELD row after a Record value.

It also counts, over the whole corpus, every stored shorthand row KIND.X,
so a candidate built-in (KIND, X) can be checked for contradictions: a
stored row with that identity anywhere means X is a real record / field
name in some program.

Usage: python3 cycle97-member-identity-census.py <dump.jsonl> [--member X] [--json out.json]
"""
import json
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher


def norm(tok):
    op, _, text = tok.partition(':')
    if op == 'N4a':
        return 'M:' + text.split('.')[-1]
    if op == 'a':
        return 'M:' + text.strip().upper()
    return tok


def kind_of(tok):
    op, _, text = tok.partition(':')
    return text.split('.')[0] if op.startswith('N') else None


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    only = sys.argv[sys.argv.index('--member') + 1].upper() if '--member' in sys.argv else None
    stored_rows = Counter()          # (KIND, MEMBER) -> stored shorthand rows anywhere
    stored_row_defs = defaultdict(set)
    table = defaultdict(Counter)     # (KIND, MEMBER) -> class counts
    defs = defaultdict(lambda: defaultdict(set))
    exact_defs = defaultdict(lambda: defaultdict(set))
    for r in rows:
        for tok in r['s']:
            if tok.startswith('N4a:'):
                k = kind_of(tok)
                m = tok.split(':', 1)[1].split('.')[-1]
                stored_rows[(k, m)] += 1
                stored_row_defs[(k, m)].add(r['id'])
        s, g = r['s'], r['g']
        sn, gn = [norm(t) for t in s], [norm(t) for t in g]
        for tag, i1, i2, j1, j2 in SequenceMatcher(a=sn, b=gn, autojunk=False).get_opcodes():
            if tag != 'equal':
                continue
            for k in range(i2 - i1):
                a, b = s[i1 + k], g[j1 + k]
                if not sn[i1 + k].startswith('M:'):
                    continue
                member = sn[i1 + k][2:]
                a_row, b_row = a.startswith('N4a'), b.startswith('N4a')
                if a_row and b_row:
                    cls, kind = 'ROW_ROW', kind_of(b)
                elif b_row:
                    cls, kind = 'GEN_ROW', kind_of(b)
                elif a_row:
                    cls, kind = 'STORED_ROW', kind_of(a)
                else:
                    continue
                table[(kind, member)][cls] += 1
                defs[(kind, member)][cls].add(r['id'])
                if r['exact']:
                    exact_defs[(kind, member)][cls].add(r['id'])
    keys = sorted(table, key=lambda k: -len(defs[k]['GEN_ROW']))
    print('kind   member                    GEN_ROW(defs) ROW_ROW(defs) STORED_ROW(defs) | stored KIND.member rows anywhere (defs)')
    for key in keys:
        if only and key[1] != only:
            continue
        c = table[key]
        if not only and not c['GEN_ROW']:
            continue
        print(f"{key[0]:6} {key[1]:25} {c['GEN_ROW']:5} ({len(defs[key]['GEN_ROW']):4}) {c['ROW_ROW']:5} ({len(defs[key]['ROW_ROW']):4}) {c['STORED_ROW']:5} ({len(defs[key]['STORED_ROW']):4}) | "
              f"{stored_rows[key]:5} ({len(stored_row_defs[key]):4})  e.g. {sorted(defs[key]['GEN_ROW'])[:4]} ctl {sorted(stored_row_defs[key])[:3]}")
    if '--json' in sys.argv:
        json.dump({f'{k[0]}|{k[1]}': {
            'counts': table[k],
            'defs': {c: sorted(v) for c, v in defs[k].items()},
            'storedRowsAnywhere': stored_rows[k],
            'storedRowDefs': sorted(stored_row_defs[k])
        } for k in table}, open(sys.argv[sys.argv.index('--json') + 1], 'w'))


if __name__ == '__main__':
    main()
