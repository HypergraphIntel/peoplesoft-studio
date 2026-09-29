#!/usr/bin/env python3
"""
Cycle 83: analyze the token-divergence extract
(cycle83-token-divergence-extract.ts) for every NONEXACT definition.

Phase 2 -- first TRUE divergence class per definition:
  HEADER_ONLY_DOWNSTREAM  tokens, formats and NAMENUMs identical; only header/trailer bytes differ
  REFERENCE_ALLOCATION    token identities identical (operands name the same RECNAME.REFNAME);
                          only NAMENUM numbers differ -> PSPCMNAME allocation/reuse/order only
  REFERENCE_IDENTITY      first differing token is a name operand naming a different identity
  COMMENT_TRIVIA          first differing token is a comment (0x24 / 0x4E)
  STRUCTURAL_BYTE         first differing token is a structural marker (0x4F blank-line/boundary etc.)
  TOKEN_ENCODING          first differing token is any other token
  FORMAT_ONLY             identical tokens, differing spacing/format bits
  DECODER_RENDERING       forward encode exact; failure is decode/roundtrip/source-render side
  UNSUPPORTED_SYNTAX, ENCODE_ERROR, OTHER

Phase 3 -- for rows whose reference key lists differ, an edit script over
the PSPCMNAME key lists classifies each edit as MISSING_REFERENCE,
EXTRA_REFERENCE, WRONG_REUSE (duplicate identity allocated vs. reused),
WRONG_ORDER, or WRONG_IDENTITY, clustered by reference kind.

One-blocker-away: a definition counts for a cluster only when that cluster
is its ONLY remaining difference (e.g. REFERENCE_ALLOCATION rows whose
every key-list edit has the same (edit, kind) signature; token rows with a
single differing token hunk and identical key lists).

Usage: python3 cycle83-divergence-analyze.py <extract.jsonl> [--json out.json]
"""
import json
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher

COMMENT_OPS = {'24', '4e'}


def normalize_owner(row):
    """The owner row (NAMENUM 1) is stored blank for many definition types while
    the generated reference carries the owner record/field (Cycle 73's known
    comparator artifact). Byte correctness of operands that point at it is
    still measured through the NAMENUM; its key text is not compared."""
    for side in ('s', 'g'):
        sig, nn = row.get(side + 'Sig'), row.get(side + 'NN')
        if sig is None:
            continue
        row[side + 'Sig'] = [x.split(':', 1)[0] + ':OWNER' if n == 1 else x for x, n in zip(sig, nn)]
    for k in ('storedKeys', 'generatedKeys'):
        if row.get(k):
            row[k] = row[k][1:]


def ref_kind(key):
    rec, _, ref = key.partition('.')
    if rec in ('PACKAGE', 'RECORD', 'FIELD', 'SCROLL', 'COMPONENT', 'PAGE', 'MENUNAME', 'SQL', 'OPERATION',
               'MESSAGE', 'URL', 'BARNAME', 'ITEMNAME', 'PANELGROUP', 'MARKET', 'NODE', 'PORTAL', 'IMAGE',
               'HTML', 'FILELAYOUT', 'INTERLINK', 'BUSPROCESS', 'BUSACTIVITY', 'BUSEVENT', 'STYLESHEET',
               'COMPINTFC', 'ANALYTICMODEL', 'FIELDDEFN', 'RECORDDEFN'):
        return rec if rec in ('PACKAGE', 'RECORD', 'FIELD', 'SCROLL', 'COMPONENT') else 'QUOTED:' + rec
    if key == '.':
        return 'OWNER'
    return 'RECORD.FIELD'


def classify_key_edits(stored, generated):
    """Edit script over PSPCMNAME key lists (owner row included at index 0)."""
    edits = []
    if Counter(stored) == Counter(generated) and stored != generated:
        return [('WRONG_ORDER', 'ANY', None)]
    sm = SequenceMatcher(a=stored, b=generated, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            continue
        s_part, g_part = stored[i1:i2], generated[j1:j2]
        if tag == 'replace' and Counter(s_part) == Counter(g_part):
            edits.append(('WRONG_ORDER', ref_kind(s_part[0]), s_part[0]))
            continue
        # moved rows: a key present in both parts of the lists but at another place
        for key in s_part:
            if key in g_part:
                continue
            if stored.count(key) > generated.count(key) and key in generated:
                edits.append(('WRONG_REUSE_OVER', ref_kind(key), key))  # stored allocated again, generated reused
            elif key in generated:
                edits.append(('WRONG_ORDER', ref_kind(key), key))
            else:
                edits.append(('MISSING_REFERENCE', ref_kind(key), key))
        for key in g_part:
            if key in s_part:
                continue
            if generated.count(key) > stored.count(key) and key in stored:
                edits.append(('WRONG_REUSE_UNDER', ref_kind(key), key))  # generated allocated again, stored reused
            elif key in stored:
                edits.append(('WRONG_ORDER', ref_kind(key), key))
            else:
                edits.append(('EXTRA_REFERENCE', ref_kind(key), key))
    # a missing X + extra Y of the same kind at the same place is an identity swap
    return edits


def op_of(sig):
    head = sig.split(':', 1)[0]
    return head[1:] if head.startswith('N') else head


def first_divergence(row):
    cat = row['cat']
    if cat == 'UNSUPPORTED_SYNTAX':
        return 'UNSUPPORTED_SYNTAX', None
    if cat == 'ENCODE_ERROR' or row.get('encodeError'):
        return 'ENCODE_ERROR', None
    if row.get('fwdExact'):
        return 'DECODER_RENDERING', None
    if cat in ('DECODE_SOURCE_MISMATCH', 'DECODER_BARE_IDENTIFIER', 'DECODER_OTHER', 'UNKNOWN_OPCODE'):
        # forward encode is NOT exact but the decoder also disagrees; keep the
        # validator's decode class but still analyze forward bytes below.
        pass
    if 'sSig' not in row or 'gSig' not in row:
        return 'OTHER', 'decode-failed:' + ('stored' if 'sSig' not in row else 'generated')
    s, g = row['sSig'], row['gSig']
    if s == g:
        if row['sFmt'] != row['gFmt']:
            i = next(k for k in range(len(s)) if row['sFmt'][k] != row['gFmt'][k])
            return 'FORMAT_ONLY', op_of(s[i])
        if row['sNN'] != row['gNN']:
            return 'REFERENCE_ALLOCATION', None
        return 'HEADER_ONLY_DOWNSTREAM', None
    k = next((k for k in range(min(len(s), len(g))) if s[k] != g[k]), min(len(s), len(g)))
    # an allocation-only NAMENUM divergence earlier than the first token diff
    nn_first = next((j for j in range(k) if row['sNN'][j] != row['gNN'][j]), None)
    sk = s[k] if k < len(s) else '<end>'
    gk = g[k] if k < len(g) else '<end>'
    if sk.startswith('N') and gk.startswith('N'):
        return 'REFERENCE_IDENTITY', f'{sk} | {gk}'
    ops = {op_of(sk), op_of(gk)}
    if ops & COMMENT_OPS:
        return 'COMMENT_TRIVIA', f'{sk} | {gk}'
    if '4f' in ops:
        return 'STRUCTURAL_BYTE', f'{sk} | {gk}'
    if sk.startswith('N') or gk.startswith('N'):
        return 'REFERENCE_IDENTITY', f'{sk} | {gk}'
    return 'TOKEN_ENCODING', f'{sk} | {gk}'


def token_hunks(row):
    sm = SequenceMatcher(a=row['sSig'], b=row['gSig'], autojunk=False)
    return [(tag, row['sSig'][i1:i2], row['gSig'][j1:j2]) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal']


def hunk_signature(hunk):
    tag, s_part, g_part = hunk
    def short(seq):
        return ' '.join(op_of(x) if not x.startswith(('24:', '4e:')) else op_of(x) for x in seq[:4]) + (' ...' if len(seq) > 4 else '')
    return f'{tag} [{short(s_part)}] -> [{short(g_part)}]'


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    out = {}
    phase2 = Counter()
    detail = defaultdict(Counter)
    examples = defaultdict(list)
    ref_edit_first = Counter()
    ref_cluster_one_blocker = Counter()
    ref_cluster_affected = Counter()
    ref_cluster_examples = defaultdict(list)
    token_one_blocker = Counter()
    token_affected = Counter()
    token_examples = defaultdict(list)
    per_row = []

    for row in rows:
        normalize_owner(row)
        klass, info = first_divergence(row)
        phase2[klass] += 1
        if info:
            detail[klass][info.split(' | ')[0][:40] if klass != 'OTHER' else info] += 1
        if len(examples[klass]) < 12:
            examples[klass].append(row['id'])
        rec = {'id': row['id'], 'cat': row['cat'], 'phase2': klass, 'info': info}

        stored_keys = row.get('storedKeys') or []
        gen_keys = row.get('generatedKeys')
        keys_equal = gen_keys is not None and stored_keys == gen_keys
        if gen_keys is not None and not keys_equal:
            edits = classify_key_edits(stored_keys, gen_keys)
            rec['edits'] = edits[:20]
            sigs = {(e[0], e[1]) for e in edits}
            if edits:
                ref_edit_first[(edits[0][0], edits[0][1])] += 1
            for sgn in sigs:
                ref_cluster_affected[sgn] += 1
            if klass == 'REFERENCE_ALLOCATION' and len(sigs) == 1:
                sgn = next(iter(sigs))
                ref_cluster_one_blocker[sgn] += 1
                if len(ref_cluster_examples[sgn]) < 15:
                    ref_cluster_examples[sgn].append((row['id'], [e[2] for e in edits][:4]))
            rec['refOneBlocker'] = klass == 'REFERENCE_ALLOCATION' and len(sigs) == 1
        if 'sSig' in row and 'gSig' in row and row['sSig'] != row['gSig']:
            hunks = token_hunks(row)
            rec['hunks'] = len(hunks)
            sigs = [hunk_signature(h) for h in hunks]
            rec['hunkSigs'] = sigs[:10]
            for sg in set(sigs):
                token_affected[sg] += 1
            if len(set(sigs)) == 1 and keys_equal:
                token_one_blocker[sigs[0]] += 1
                if len(token_examples[sigs[0]]) < 15:
                    token_examples[sigs[0]].append(row['id'])
                rec['tokenOneBlocker'] = sigs[0]
        per_row.append(rec)

    print(f'NONEXACT rows: {len(rows)}')
    print('\n=== Phase 2: first true divergence ===')
    for k, v in phase2.most_common():
        print(f'  {k:26} {v:5}  e.g. {examples[k][:8]}')
    for k in ('REFERENCE_IDENTITY', 'COMMENT_TRIVIA', 'STRUCTURAL_BYTE', 'TOKEN_ENCODING', 'FORMAT_ONLY', 'OTHER'):
        if detail[k]:
            print(f'  -- {k} top first tokens: {detail[k].most_common(8)}')

    print('\n=== Phase 3: reference edit clusters (definitions affected / one-blocker-away) ===')
    keys = sorted(ref_cluster_affected, key=lambda s: -ref_cluster_affected[s])
    for sgn in keys[:30]:
        print(f'  {sgn[0]:20} {sgn[1]:18} affected={ref_cluster_affected[sgn]:5} oneBlocker={ref_cluster_one_blocker[sgn]:4}  e.g. {ref_cluster_examples[sgn][:5]}')
    print('  first edit per definition:', ref_edit_first.most_common(12))

    print('\n=== Token-hunk clusters (definitions affected / one-blocker-away with exact key lists) ===')
    for sg, n in sorted(token_one_blocker.items(), key=lambda x: -x[1])[:30]:
        print(f'  oneBlocker={n:4} affected={token_affected[sg]:5}  {sg}  e.g. {token_examples[sg][:8]}')

    if '--json' in sys.argv:
        json.dump(per_row, open(sys.argv[sys.argv.index('--json') + 1], 'w'))


if __name__ == '__main__':
    main()
