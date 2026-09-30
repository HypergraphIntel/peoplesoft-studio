#!/usr/bin/env python3
"""
Cycle 88: declaration-close POSITION census around top-level comments
(research only).

Input: a token-divergence extract (cycle83-token-divergence-extract.ts).

Both the stored and generated token streams are split into "real" tokens
(everything except 0x2D / 0x4F layout bytes and comments) and the GAP that
follows each real token (the ordered run of layout bytes and comments).
The real-token skeletons are aligned with difflib; for every aligned pair of
real tokens at top level, the two gaps are compared. A gap is POSITIONAL when
both sides contain the same multiset of layout bytes and comments but in a
different order, and a 0x2D is involved.

Comment kinds: BLOCK (0x24 starting "/*"), REM (0x24 REM text),
TRAILING (0x4E), DISABLED (0x55).

For every positional gap the census records the comment kinds, the stored
and generated gap order, the statement before and the real token after,
and whether the definition's ONLY differences are positional gaps
(one-blocker).

Usage: python3 cycle88-close-position-census.py <extract.jsonl> [--json out.json]
"""
import importlib.util
import json
import os
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


an = load('an', 'cycle83-divergence-analyze.py')
bc = load('bc', 'cycle84-declaration-boundary-census.py')

LAYOUT = {'2d', '4f'}
COMMENTS = {'24', '4e', '55'}


def comment_kind(token):
    op = an.op_of(token)
    text = token.split(':', 1)[1].strip().lower() if ':' in token else ''
    if op == '55':
        return 'DISABLED'
    if op == '4e':
        return 'TRAILING'
    if text.startswith('rem'):
        return 'REM'
    return 'BLOCK'


def gap_symbol(token):
    op = an.op_of(token)
    if op == '2d':
        return '2D'
    if op == '4f':
        return '4F'
    return 'C:' + comment_kind(token)


def skeleton(sig):
    """[(real token, [gap symbols after it])] plus the leading gap."""
    real, gaps, lead = [], [], []
    index = []
    for i, token in enumerate(sig):
        op = an.op_of(token)
        if op in LAYOUT or op in COMMENTS:
            (gaps[-1] if gaps else lead).append(gap_symbol(token))
        else:
            real.append(token)
            gaps.append([])
            index.append(i)
    return real, gaps, lead, index


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    records = []
    shapes = Counter()
    examples = defaultdict(list)
    per_kind = Counter()
    one_blocker = set()
    for row in rows:
        if 'sSig' not in row or 'gSig' not in row or row.get('fwdExact'):
            continue
        an.normalize_owner(row)
        s, g = row['sSig'], row['gSig']
        sr, sg, _, sidx = skeleton(s)
        gr, gg, _, _ = skeleton(g)
        depth = bc.depth_stack(s)
        positional = []
        other_difference = sr != gr
        matcher = SequenceMatcher(a=sr, b=gr, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag != 'equal':
                continue
            for k in range(i2 - i1):
                a_gap, b_gap = sg[i1 + k], gg[j1 + k]
                if a_gap == b_gap:
                    continue
                top = depth[sidx[i1 + k]] == 0
                same_multiset = Counter(a_gap) == Counter(b_gap)
                if same_multiset and '2D' in a_gap and any(x.startswith('C:') for x in a_gap) and top:
                    before = bc.statement_kind(s, sidx[i1 + k] + 1)
                    after_i = i1 + k + 1
                    after = an.op_of(sr[after_i]) + ':' + sr[after_i].split(':', 1)[1][:14] if after_i < len(sr) else 'EOF'
                    kinds = sorted({x[2:] for x in a_gap if x.startswith('C:')})
                    positional.append({
                        'stored': ' '.join(a_gap), 'generated': ' '.join(b_gap),
                        'kinds': kinds, 'before': before, 'after': after
                    })
                else:
                    other_difference = True
        if not positional:
            continue
        if not other_difference and row.get('storedKeys') == row.get('generatedKeys'):
            one_blocker.add(row['id'])
        for p in positional:
            key = (p['stored'], p['generated'], '+'.join(p['kinds']), p['before'])
            shapes[key] += 1
            if len(examples[key]) < 8:
                examples[key].append(row['id'])
            for kind in p['kinds']:
                per_kind[kind] += 1
            records.append({'id': row['id'], **p})
    ids = {r['id'] for r in records}
    print(f'definitions with a positional 0x2D/comment gap: {len(ids)}; one-blocker: {len(one_blocker)}')
    print('comment kinds involved (gaps):', dict(per_kind))
    print('\n=== stored gap | generated gap | comment kinds | statement before ===')
    for key, n in shapes.most_common():
        print(f'  {n:3}  S[{key[0]}]  G[{key[1]}]  kinds={key[2]:18} before={key[3]:16} e.g. {examples[key]}')
    if '--json' in sys.argv:
        json.dump({'records': records, 'oneBlocker': sorted(one_blocker)},
                  open(sys.argv[sys.argv.index('--json') + 1], 'w'))


if __name__ == '__main__':
    main()
