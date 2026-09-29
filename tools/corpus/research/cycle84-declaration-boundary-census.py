#!/usr/bin/env python3
"""
Cycle 84: declaration-boundary census (research only).

Input: a token-divergence extract (cycle83-token-divergence-extract.ts).

For every NONEXACT definition, find each TOP-LEVEL token hunk that consists
only of 0x2D / 0x4F line-structure bytes, classify its signature, and record
the source shape around it from the STORED token stream:

  previous statement kind   Local / Local(AppClass) / Local(initialized) /
                            Global / Component / Constant / Declare Function /
                            import / Function / executable / comment / START
  intervening trivia        comments (0x24 / 0x4E / 0x55 disabled code) between
                            the hunk and the next real token
  next real token kind      Local / import / declaration / executable / EOF

Signatures (stored vs generated): MISSING_2D, EXTRA_2D, MISSING_4F,
EXTRA_4F, MISSING_2D_4F, EXTRA_2D_4F, ORDER_2D_4F, and REPLACE:<s>-><g> for
other 2D/4F-only replacements. "firstHunk" marks the definition's first
true divergence; "oneBlocker" marks definitions whose ONLY differences are
top-level 2D/4F hunks and whose reference key lists are identical.

Usage: python3 cycle84-declaration-boundary-census.py <extract.jsonl> [--json out.json]
"""
import importlib.util
import json
import os
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('an', os.path.join(HERE, 'cycle83-divergence-analyze.py'))
an = importlib.util.module_from_spec(spec)
spec.loader.exec_module(an)

OPEN = {'While', 'If', 'For', 'Evaluate', 'Repeat', 'Function', 'method', 'try', 'get', 'set'}
CLOSE = {'End-While': 'While', 'End-If': 'If', 'End-For': 'For', 'End-Evaluate': 'Evaluate',
         'Until': 'Repeat', 'End-Function': 'Function', 'end-method': 'method', 'end-try': 'try',
         'end-get': 'get', 'end-set': 'set'}
COMMENT_OPS = {'24', '4e', '55'}
LAYOUT_OPS = {'2d', '4f'}
DECL_WORDS = {'Global': 'Global', 'Component': 'Component', 'Constant': 'Constant',
              'Declare Function': 'Declare Function', 'PanelGroup': 'PanelGroup', 'import': 'import',
              'Function': 'Function', 'class': 'class'}


def text(x):
    return x.split(':', 1)[1] if ':' in x else ''


def depth_stack(sig):
    st, out = [], []
    for x in sig:
        out.append(len(st))
        t = text(x).strip()
        if x.startswith('N'):
            continue
        if t in OPEN:
            st.append(t)
        elif t in CLOSE and st:
            want = CLOSE[t]
            while st and st[-1] != want:
                st.pop()
            if st:
                st.pop()
    return out


def statement_kind(sig, end):
    """Kind of the statement whose last token precedes index `end`."""
    j = end - 1
    while j >= 0 and an.op_of(sig[j]) in LAYOUT_OPS:
        j -= 1
    if j < 0:
        return 'START'
    if an.op_of(sig[j]) in COMMENT_OPS:
        return 'comment'
    # walk back to the statement start: token after previous ';' / layout / comment
    k = j
    while k - 1 >= 0 and an.op_of(sig[k - 1]) not in ({'15'} | LAYOUT_OPS | COMMENT_OPS):
        k -= 1
    first = text(sig[k]).strip()
    stmt = sig[k:j + 1]
    if first == 'Local':
        ops = [an.op_of(x) for x in stmt]
        app_class = len(stmt) > 2 and '57' in ops[:6]
        initialized = '6' in ops
        return 'Local' + ('(AppClass)' if app_class else '') + ('(init)' if initialized else '')
    for word, kind in DECL_WORDS.items():
        if first.startswith(word):
            return kind
    if first in ('End-Function',):
        return 'Function'
    return 'executable'


def statement_bounds(sig, end):
    """(start, last) token indexes of the statement ending before `end`, or None."""
    j = end - 1
    while j >= 0 and an.op_of(sig[j]) in LAYOUT_OPS:
        j -= 1
    if j < 0 or an.op_of(sig[j]) in COMMENT_OPS:
        return None
    k = j
    while k - 1 >= 0 and an.op_of(sig[k - 1]) not in ({'15'} | LAYOUT_OPS | COMMENT_OPS):
        k -= 1
    return k, j


def run_predecessor(sig, end):
    """Kind of whatever precedes the run of consecutive Local statements ending before `end`."""
    pos = end
    locals_seen = 0
    while True:
        b = statement_bounds(sig, pos)
        if b is None:
            break
        if text(sig[b[0]]).strip() != 'Local':
            break
        locals_seen += 1
        pos = b[0]
    if locals_seen == 0:
        return 'n/a'
    return statement_kind(sig, pos) + f'[{locals_seen} Local]'


def next_kind(sig, start):
    j = start
    trivia = []
    while j < len(sig) and (an.op_of(sig[j]) in LAYOUT_OPS or an.op_of(sig[j]) in COMMENT_OPS):
        if an.op_of(sig[j]) in COMMENT_OPS:
            trivia.append({'24': 'comment24', '4e': 'comment4E', '55': 'disabled'}[an.op_of(sig[j])])
        j += 1
    if j >= len(sig):
        return 'EOF', trivia
    first = text(sig[j]).strip()
    if first == 'Local':
        return 'Local', trivia
    if first.startswith('import'):
        return 'import', trivia
    for word in DECL_WORDS:
        if first.startswith(word):
            return 'declaration:' + word, trivia
    return 'executable', trivia


def signature(s_part, g_part):
    s = [an.op_of(x) for x in s_part]
    g = [an.op_of(x) for x in g_part]
    if not s and g == ['2d']:
        return 'EXTRA_2D'
    if s == ['2d'] and not g:
        return 'MISSING_2D'
    if not s and set(g) == {'4f'}:
        return 'EXTRA_4F'
    if set(s) == {'4f'} and not g:
        return 'MISSING_4F'
    if s and not g and s[0] == '2d' and set(s[1:]) == {'4f'}:
        return 'MISSING_2D_4F'
    if g and not s and g[0] == '2d' and set(g[1:]) == {'4f'}:
        return 'EXTRA_2D_4F'
    if sorted(s) == sorted(g):
        return 'ORDER_2D_4F'
    return f'REPLACE:{" ".join(s)}->{" ".join(g)}'


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    hunks_out = []
    sig_aff = Counter()
    sig_first = Counter()
    sig_one = Counter()
    shape = Counter()
    shape_ex = defaultdict(list)
    for row in rows:
        if 'sSig' not in row or 'gSig' not in row or row.get('fwdExact'):
            continue
        an.normalize_owner(row)
        s, g = row['sSig'], row['gSig']
        if s == g:
            continue
        depth = depth_stack(s)
        ops = [h for h in SequenceMatcher(a=s, b=g, autojunk=False).get_opcodes() if h[0] != 'equal']
        boundary = []
        other = False
        for idx, (tag, i1, i2, j1, j2) in enumerate(ops):
            s_part, g_part = s[i1:i2], g[j1:j2]
            all_layout = all(an.op_of(x) in LAYOUT_OPS for x in s_part + g_part)
            top = (depth[i1] if i1 < len(depth) else (depth[-1] if depth else 0)) == 0
            if all_layout and top:
                boundary.append((idx, tag, i1, i2, j1, j2))
            else:
                other = True
        if not boundary:
            continue
        keys_equal = row.get('storedKeys') == row.get('generatedKeys')
        one = keys_equal and not other
        sigs = set()
        for idx, tag, i1, i2, j1, j2 in boundary:
            sg = signature(s[i1:i2], g[j1:j2])
            prev = statement_kind(s, i1)
            before_run = run_predecessor(s, i1)
            nxt, trivia = next_kind(s, i2)
            sigs.add(sg)
            sh = (sg, prev, '+'.join(sorted(set(trivia))) or '-', nxt, before_run.split('[')[0])
            shape[sh] += 1
            if len(shape_ex[sh]) < 8:
                shape_ex[sh].append(row['id'])
            hunks_out.append({'id': row['id'], 'sig': sg, 'prev': prev, 'beforeRun': before_run, 'trivia': trivia, 'next': nxt,
                              'first': idx == 0, 'oneBlocker': one,
                              'stored': ' '.join(an.op_of(x) for x in s[max(0, i1 - 3):i2 + 3]),
                              'generated': ' '.join(an.op_of(x) for x in g[max(0, j1 - 3):j2 + 3])})
        for sg in sigs:
            sig_aff[sg] += 1
            if one and len(sigs) == 1:
                sig_one[sg] += 1
        first = [h for h in boundary if h[0] == 0]
        if first:
            idx, tag, i1, i2, j1, j2 = first[0]
            sig_first[signature(s[i1:i2], g[j1:j2])] += 1

    print('=== signatures: definitions affected / first-divergence / strict one-blocker ===')
    for sg, n in sig_aff.most_common():
        print(f'  {sg:28} affected={n:4} first={sig_first[sg]:4} oneBlocker={sig_one[sg]:4}')
    print(f'  total definitions with a top-level boundary hunk: {len({h["id"] for h in hunks_out})}')
    print(f'  total strict one-blocker (boundary-only): {len({h["id"] for h in hunks_out if h["oneBlocker"]})}')
    print('\n=== source-shape matrix (hunks): signature | previous statement | trivia | next ===')
    for sh, n in shape.most_common(60):
        print(f'  {n:4}  {sh[0]:15} prev={sh[1]:22} beforeRun={sh[4]:16} trivia={sh[2]:18} next={sh[3]:20} e.g. {shape_ex[sh][:6]}')
    if '--json' in sys.argv:
        json.dump(hunks_out, open(sys.argv[sys.argv.index('--json') + 1], 'w'))


if __name__ == '__main__':
    main()
