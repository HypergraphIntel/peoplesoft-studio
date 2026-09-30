#!/usr/bin/env python3
"""
Cycle 90: comment-surroundings census for the generic declaration run
(research only).

Input: a token-divergence extract (cycle83-token-divergence-extract.ts).

Stored and generated real-token skeletons are aligned (as in the Cycle 88
close-position census). Every aligned TOP-LEVEL gap whose 0x2D content
differs (count or position) is kept when either
  A. the gap itself contains a comment, or
  B. the gap closes a Local run whose predecessor is a comment
     (the run started after a comment).
For each kept gap the census records the preceding construct, the comment
kinds in the gap, the next real construct, whether the enclosing Local run
contains an initialized Local, the Local run's predecessor, and the stored
and generated gap order. One-blocker = the definition's only differences
are such gaps and the reference lists are identical.

Usage: python3 cycle90-comment-state-census.py <extract.jsonl> [--json out.json]
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
pc = load('pc', 'cycle88-close-position-census.py')


def next_kind(token):
    text = token.split(':', 1)[1].strip() if ':' in token else ''
    if text == 'Local':
        return 'Local'
    if text.startswith('import'):
        return 'import'
    for word in ('Global', 'Component', 'Constant', 'Declare Function', 'PanelGroup'):
        if text.startswith(word):
            return 'decl:' + word
    if text == 'Function':
        return 'Function'
    return 'executable'


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    records = []
    shapes = Counter()
    examples = defaultdict(list)
    for row in rows:
        if 'sSig' not in row or 'gSig' not in row or row.get('fwdExact'):
            continue
        an.normalize_owner(row)
        s, g = row['sSig'], row['gSig']
        sr, sg, _, sidx = pc.skeleton(s)
        gr, gg, _, _ = pc.skeleton(g)
        depth = bc.depth_stack(s)
        kept, other = [], sr != gr
        for tag, i1, i2, j1, j2 in SequenceMatcher(a=sr, b=gr, autojunk=False).get_opcodes():
            if tag != 'equal':
                continue
            for k in range(i2 - i1):
                a_gap, b_gap = sg[i1 + k], gg[j1 + k]
                if a_gap == b_gap:
                    continue
                pos = sidx[i1 + k]
                top = depth[pos] == 0
                two_d_differs = (a_gap.count('2D') != b_gap.count('2D')) or (a_gap != b_gap and '2D' in a_gap + b_gap)
                has_comment = any(x.startswith('C:') for x in a_gap)
                prev = bc.statement_kind(s, pos + 1)
                before_run = bc.run_predecessor(s, pos + 1)
                run_after_comment = before_run.startswith('comment')
                if top and two_d_differs and (has_comment or run_after_comment) and not prev.startswith('import'):
                    nxt = next_kind(sr[i1 + k + 1]) if i1 + k + 1 < len(sr) else 'EOF'
                    kept.append({
                        'family': 'A:gap-has-comment' if has_comment else 'B:run-after-comment',
                        'prev': prev, 'beforeRun': before_run, 'next': nxt,
                        'comments': '+'.join(x[2:] for x in a_gap if x.startswith('C:')) or '-',
                        'stored': ' '.join(a_gap), 'generated': ' '.join(b_gap)
                    })
                else:
                    other = True
        if not kept:
            continue
        one = not other and row.get('storedKeys') == row.get('generatedKeys')
        for k in kept:
            k['id'] = row['id']
            k['oneBlocker'] = one
            records.append(k)
            key = (k['family'], k['prev'], k['beforeRun'].split('[')[0], k['comments'], k['next'], k['stored'], k['generated'])
            shapes[key] += 1
            if len(examples[key]) < 8:
                examples[key].append(row['id'])
    ids = {r['id'] for r in records}
    print(f'definitions: {len(ids)}; one-blocker: {len({r["id"] for r in records if r["oneBlocker"]})}')
    print('by family:', Counter(r['family'] for r in records))
    print('\n=== family | prev | run predecessor | comments in gap | next | stored gap | generated gap ===')
    for key, n in shapes.most_common():
        print(f'  {n:3} {key[0]:20} prev={key[1]:22} runPred={key[2]:16} comments={key[3]:14} next={key[4]:18} S[{key[5]}] G[{key[6]}] e.g. {examples[key]}')
    if '--json' in sys.argv:
        json.dump(records, open(sys.argv[sys.argv.index('--json') + 1], 'w'))


if __name__ == '__main__':
    main()
