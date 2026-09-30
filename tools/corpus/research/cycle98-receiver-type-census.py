#!/usr/bin/env python3
"""
Cycle 98: receiver origin of Direction 2 identity failures (research only).

Inputs: `cycle97-member-identity-dump.ts` output and a JSON map of
definition id -> PeopleCode source (ordinary programs).

Stored and generated token streams are aligned as in
`cycle97-member-identity-census.py`. For every aligned member position the
receiver of the member is classified from the STORED tokens before it:

  var:<declared type>     `&v.X`, the variable's declared type from the
                          source (Local / Component / Global / parameter
                          `As`); `var:undeclared` when there is none
  index:<declared type>   `&v(...).X`
  call:<name>             `<...>.Name(...).X` or `Name(...).X`
  after-RECORD-row        `<row>.REC.X` (X is a field of REC)
  other

and the position class: STORED_ROW (stored row, generated inline --
Direction 2), ROW_ROW, INLINE_BOTH, GEN_ROW. Matrices are keyed by
(receiver, stored row kind) so every rule can be checked against the
controls with the same receiver shape.

Usage: python3 cycle98-receiver-type-census.py <dump.jsonl> <sources.json> [--detail receiver] [--json out.json]
"""
import json
import re
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher

DECL = re.compile(r'\b(Local|Component|Global)\s+((?:array\s+of\s+)*)([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)\s+([^;=]*)', re.I)
PARAM = re.compile(r'(&[A-Za-z0-9_]+)\s+As\s+((?:array\s+of\s+)*)([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)', re.I)


def declared_types(source):
    types = {}
    for m in DECL.finditer(source):
        t = m.group(1) + ' ' + ('array of ' if m.group(2) else '') + (m.group(3) if ':' not in m.group(3) else 'AppClass')
        for v in re.findall(r'&[A-Za-z0-9_]+', m.group(4)):
            types.setdefault(v.lower(), set()).add(t.lower())
    for m in PARAM.finditer(source):
        t = 'param ' + ('array of ' if m.group(2) else '') + (m.group(3) if ':' not in m.group(3) else 'AppClass')
        types.setdefault(m.group(1).lower(), set()).add(t.lower())
    return {k: '/'.join(sorted(v)) for k, v in types.items()}


def norm(tok):
    op, _, text = tok.partition(':')
    if op == 'N4a':
        return 'M:' + text.split('.')[-1]
    if op == 'a':
        return 'M:' + text.strip().upper()
    return tok


def text(tok):
    return tok.split(':', 1)[1] if ':' in tok else ''


def receiver(tokens, i, types):
    """Receiver shape of the member at tokens[i] (tokens[i-1] must be '.')."""
    if i < 2 or text(tokens[i - 1]).strip() != '.':
        return 'no-dot'
    r = tokens[i - 2]
    if r.startswith('N4a:RECORD.'):
        return 'after-RECORD-row'
    if r.startswith('N4a:SCROLL.'):
        return 'after-SCROLL-row'
    if r.startswith('1:&'):
        return 'var:' + types.get(text(r).lower(), 'undeclared')
    if text(r).strip() == ')':
        depth, j = 0, i - 2
        while j >= 0:
            t = text(tokens[j]).strip()
            if t == ')':
                depth += 1
            elif t == '(':
                depth -= 1
                if depth == 0:
                    break
            j -= 1
        callee = tokens[j - 1] if j >= 1 else ''
        if callee.startswith('1:&'):
            return 'index:' + types.get(text(callee).lower(), 'undeclared')
        if callee.startswith('a:') or callee.startswith('N'):
            name = text(callee).strip()
            before = text(tokens[j - 2]).strip() if j >= 2 else ''
            return ('method:' if before == '.' else 'call:') + name
        if text(callee).strip() == ')':
            return 'call-result-index'
        return 'call:?' + callee[:12]
    return 'other:' + r[:14]


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    sources = json.load(open(sys.argv[2]))
    detail = sys.argv[sys.argv.index('--detail') + 1] if '--detail' in sys.argv else None
    table = defaultdict(Counter)
    defs = defaultdict(lambda: defaultdict(set))
    exact_defs = defaultdict(lambda: defaultdict(set))
    for r in rows:
        types = declared_types(sources.get(str(r['id']), ''))
        s, g = r['s'], r['g']
        sn, gn = [norm(t) for t in s], [norm(t) for t in g]
        for tag, i1, i2, j1, j2 in SequenceMatcher(a=sn, b=gn, autojunk=False).get_opcodes():
            if tag != 'equal':
                continue
            for k in range(i2 - i1):
                if not sn[i1 + k].startswith('M:'):
                    continue
                a, b = s[i1 + k], g[j1 + k]
                a_row, b_row = a.startswith('N4a'), b.startswith('N4a')
                cls = 'ROW_ROW' if a_row and b_row else 'STORED_ROW' if a_row else 'GEN_ROW' if b_row else 'INLINE_BOTH'
                kind = text(a).split('.')[0] if a_row else (text(b).split('.')[0] if b_row else '-')
                recv = receiver(s, i1 + k, types)
                if '--end' in sys.argv:
                    nxt = s[i1 + k + 1] if i1 + k + 1 < len(s) else ''
                    recv += ' [chain-end]' if not nxt.endswith(':.') else ''
                key = (recv, kind)
                table[key][cls] += 1
                defs[key][cls].add(r['id'])
                if r['exact']:
                    exact_defs[key][cls].add(r['id'])
                if detail and cls == 'STORED_ROW' and recv == detail and len(defs[key][cls]) <= 6:
                    print(r['id'], 'member', sn[i1 + k][2:], 'kind', kind, '|', ' '.join(text(t) for t in s[max(0, i1 + k - 8):i1 + k + 2]))
    print('receiver                          kind      STORED_ROW (defs)  ROW_ROW (defs)  GEN_ROW  INLINE_BOTH  | exact defs with ROW_ROW')
    for key in sorted(table, key=lambda k: -len(defs[k]['STORED_ROW'])):
        c = table[key]
        if not c['STORED_ROW']:
            continue
        print(f"{key[0][:33]:33} {key[1]:9} {c['STORED_ROW']:5} ({len(defs[key]['STORED_ROW']):4})  {c['ROW_ROW']:6} ({len(defs[key]['ROW_ROW']):4})  {c['GEN_ROW']:6}  {c['INLINE_BOTH']:7}  | {len(exact_defs[key]['ROW_ROW']):4}   e.g. {sorted(defs[key]['STORED_ROW'])[:5]}")
    if '--json' in sys.argv:
        json.dump({f'{k[0]}|{k[1]}': {'counts': table[k], 'defs': {c: sorted(v) for c, v in defs[k].items()}} for k in table},
                  open(sys.argv[sys.argv.index('--json') + 1], 'w'))


if __name__ == '__main__':
    main()
