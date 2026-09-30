#!/usr/bin/env python3
"""
Cycle 93: first TRUE reference divergence per NONEXACT definition
(research only).

Input: a token-divergence extract (cycle83-token-divergence-extract.ts).

Only definitions whose stored and generated token IDENTITY streams are
equal are analyzed (the remaining difference is then purely which PSPCMNAME
row each operand uses). Operands are walked in order on both sides; the
first operand whose allocate/reuse decision differs is classified:

  STORED_ALLOCATES_GENERATED_REUSES   stored opens a new row, generated reuses one
  STORED_REUSES_GENERATED_ALLOCATES   stored reuses a row, generated opens a new one
  WRONG_REUSE_TARGET                  both reuse, but different earlier rows
  NON_OPERAND_ROWS                    operand decisions agree; only rows that are
                                      never operands (PACKAGE ...) differ
and reported with its reference kind, operand opcode, the receiver shape
(tokens before the operand), the shape of the earlier same-key operand
whose row is (not) reused, and whether a Function/method boundary or a
statement boundary lies between them.

One-blocker: every divergent operand decision in the definition has the
same (class, kind, receiver shape) signature.

Usage: python3 cycle93-first-reference-divergence.py <extract.jsonl> [--json out.json] [--detail <signature substring>]
"""
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('an', os.path.join(HERE, 'cycle83-divergence-analyze.py'))
an = importlib.util.module_from_spec(spec)
spec.loader.exec_module(an)

FUNCTION_WORDS = {'Function', 'method', 'get', 'set'}


def text(tok):
    return tok.split(':', 1)[1] if ':' in tok else ''


def shape(sig, i):
    """Receiver shape: the tokens of the postfix chain leading to operand i."""
    out = []
    j = i - 1
    depth = 0
    while j >= 0 and len(out) < 9:
        t = text(sig[j])
        op = sig[j].split(':', 1)[0]
        if t == ')':
            depth += 1
            out.append(')')
        elif t == '(':
            if depth == 0:
                out.append('(')
                # include the callee name
                if j > 0:
                    out.append(abstract(sig[j - 1]))
                break
            depth -= 1
            out.append('(')
        elif depth > 0:
            pass
        elif t == '.':
            out.append('.')
        elif op.startswith('N'):
            out.append(abstract(sig[j]))
        elif op in ('1', 'a', '12', '50', '16'):
            out.append(abstract(sig[j]))
        else:
            out.append(abstract(sig[j]))
            break
        j -= 1
    return ' '.join(reversed(out))


def abstract(tok):
    op, _, t = tok.partition(':')
    if op.startswith('N'):
        return '<' + op[1:] + ':' + an.ref_kind(t) + '>'
    if op == '1':
        return '&v'
    if op == '50':
        return 'num'
    if op == '16':
        return 'str'
    if op == '12':
        return t
    if op == 'a':
        return t
    return t or op


def follow(sig, i):
    out = []
    for tok in sig[i + 1:i + 4]:
        out.append(abstract(tok))
    return ' '.join(out)


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    detail = sys.argv[sys.argv.index('--detail') + 1] if '--detail' in sys.argv else None
    first = Counter()
    first_examples = defaultdict(list)
    one = Counter()
    one_examples = defaultdict(list)
    affected = Counter()
    records = []
    population = 0
    for row in rows:
        if 'sSig' not in row or 'gSig' not in row or row.get('fwdExact'):
            continue
        an.normalize_owner(row)
        s, g = row['sSig'], row['gSig']
        if s != g:
            continue
        sn, gn = row['sNN'], row['gNN']
        if sn == gn and row.get('storedKeys') == row.get('generatedKeys'):
            continue
        population += 1
        seen_s, seen_g = {}, {}
        last_by_key = {}
        function_index = 0
        statement = 0
        signatures = []
        for i, tok in enumerate(s):
            op = tok.split(':', 1)[0]
            if not op.startswith('N'):
                if text(tok) in FUNCTION_WORDS and op not in ('a', '1'):
                    function_index += 1
                if op == '15':
                    statement += 1
                continue
            a, b = sn[i], gn[i]
            if a is None or b is None or a == 1 or b == 1:
                continue
            key = text(tok)
            s_new, g_new = a not in seen_s, b not in seen_g
            cls = None
            if s_new and not g_new:
                cls = 'STORED_ALLOCATES_GENERATED_REUSES'
                prior = seen_g[b]
            elif g_new and not s_new:
                cls = 'STORED_REUSES_GENERATED_ALLOCATES'
                prior = seen_s[a]
            elif not s_new and not g_new and seen_s[a] != seen_g[b]:
                cls = 'WRONG_REUSE_TARGET'
                prior = seen_s[a]
            if s_new:
                seen_s[a] = i
            if g_new:
                seen_g[b] = i
            if cls is not None:
                pf, pstmt = last_by_key.get(('pos', prior), (function_index, statement))
                relation = 'other-function' if pf != function_index else ('same-statement' if pstmt == statement else 'same-function')
                signature = (cls, an.ref_kind(key), op[1:], shape(s, i), '| prior: ' + shape(s, prior) + ' ' + abstract(s[prior]), relation)
                signatures.append((signature, i, prior))
            last_by_key[('pos', i)] = (function_index, statement)
        if not signatures:
            signature = ('NON_OPERAND_ROWS', '', '', '', '', '')
            signatures = [(signature, -1, -1)]
        sig0, i0, p0 = signatures[0]
        first[sig0] += 1
        if len(first_examples[sig0]) < 8:
            first_examples[sig0].append(row['id'])
        distinct = {x[0] for x in signatures}
        for d in distinct:
            affected[d] += 1
        if len(distinct) == 1:
            one[sig0] += 1
            if len(one_examples[sig0]) < 8:
                one_examples[sig0].append(row['id'])
        records.append({'id': row['id'], 'first': sig0, 'distinct': len(distinct), 'count': len(signatures)})
        if detail and detail in ' '.join(sig0) and i0 >= 0:
            print(row['id'], row['display'])
            print('   prior:', ' '.join(text(t) or t for t in s[max(0, p0 - 10):p0 + 4]))
            print('   here :', ' '.join(text(t) or t for t in s[max(0, i0 - 10):i0 + 4]), ' S=%s G=%s' % (sn[i0], gn[i0]))
    print(f'token-identical reference-only population: {population}')
    print('\n=== first divergence signature: first / affected / one-blocker ===')
    for sig, n in first.most_common(70):
        print(f'{n:4} {affected[sig]:4} {one[sig]:4}  {" | ".join(sig)}  e.g. {first_examples[sig][:6]}')
    coarse = Counter()
    coarse_one = Counter()
    for r in records:
        c = tuple(r['first'][:3]) + (r['first'][5],)
        coarse[c] += 1
        if r['distinct'] == 1:
            coarse_one[c] += 1
    print('\n=== coarse (class, kind, opcode, relation): first / single-signature ===')
    for c, n in coarse.most_common():
        print(f'{n:4} {coarse_one[c]:4}  {c}')
    if '--json' in sys.argv:
        json.dump(records, open(sys.argv[sys.argv.index('--json') + 1], 'w'))


if __name__ == '__main__':
    main()
