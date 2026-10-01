#!/usr/bin/env python3
"""
Cycle 103: score built-in PACKAGE lifetime models against stored PSPCMNAME
(research only).

Input: the JSON lines of `cycle103-builtin-package-lifetime-census.ts --json`
(one line per built-in type event in an ordinary program whose non-PACKAGE
rows align; each with its interval and that interval's stored / generated
rows of the same type).

A model maps every event to an allocation UNIT; the type's row is reused
within a unit and opened in a new one. Two checks:

  event level     events whose stored outcome is determined (open / reuse):
                  model prediction vs stored, and the encoder's current
                  generated outcome vs stored, per class
  interval level  EVERY interval, ambiguous ones included and without any
                  inference: the number of events the model opens there vs
                  the stored rows there (and generated rows vs stored)

Models:

  unit94   the Cycle 94 allocation unit: leading declaration section
           (closed by executable code, after the first initialized
           declaration, or at the first Function definition), then each
           top-level statement / Function body statement; a Function header
           stays with the unit before it
  runs     Cycle 103: as unit94, except that a Function definition does not
           close the leading declaration section -- it starts a new RUN of
           it (declarations after the Function share with each other, not
           with those before); a Function header joins the run immediately
           before it while the section is open, otherwise it is its own unit;
           each Function body statement / outermost body control structure
           is its own unit

Usage: python3 cycle103-builtin-package-unit-model.py <census.jsonl> [unit94|runs]
"""
import collections
import json
import sys


def shape(e):
    return (f"{e['kind']}{'[]' if e['array'] else ''}{'=' if e['initialized'] else ''}"
            f"{' nested' if e['controlDepth'] else ''}{' fn' if e['functionId'] else ''}")


def units_unit94(events):
    out = []
    for e in events:
        fid = e['functionId']
        leading = not e['leadingClosed'] and e['functionsBefore'] == 0
        if fid == 0:
            if leading and e['controlDepth'] == 0:
                out.append(('top', 'leading'))
            elif e['controlDepth'] > 0:
                out.append(('top', 'structure', e['structure']))
            else:
                out.append(('top', 'statement', e['statement']))
        elif e['kind'] in ('param', 'returns'):
            out.append(('top', 'leading') if leading else (fid, 'header'))
        elif e['controlDepth'] > 0:
            out.append((fid, 'structure', e['structure']))
        else:
            out.append((fid, 'statement', e['statement']))
    return out


def units_runs(events):
    out = []
    for e in events:
        fid = e['functionId']
        if fid == 0:
            if not e['leadingClosed'] and e['controlDepth'] == 0:
                out.append(('top', 'run', e['functionsBefore']))
            elif e['controlDepth'] > 0:
                out.append(('top', 'structure', e['structure']))
            else:
                out.append(('top', 'statement', e['statement']))
        elif e['kind'] in ('param', 'returns'):
            out.append(('top', 'run', e['functionsBefore']) if not e['leadingClosed'] else (fid, 'header'))
        elif e['controlDepth'] > 0:
            out.append((fid, 'structure', e['structure']))
        else:
            out.append((fid, 'statement', e['statement']))
    return out


MODELS = {'unit94': units_unit94, 'runs': units_runs}


def predict(events, units):
    seen, out = set(), []
    for e, u in zip(events, units):
        key = (e['type'], u)
        out.append('reuse' if key in seen else 'open')
        seen.add(key)
    return out


def main():
    events = [json.loads(line) for line in open(sys.argv[1])]
    names = sys.argv[2:] or list(MODELS)
    by_definition = collections.defaultdict(list)
    for e in events:
        by_definition[e['definitionId']].append(e)
    for name in names:
        model = MODELS[name]
        event_score = collections.Counter()
        classes = collections.defaultdict(lambda: [0, 0, 0, []])
        interval_score = collections.Counter()
        interval_misses = collections.defaultdict(list)
        for definition, evs in by_definition.items():
            evs = sorted(evs, key=lambda e: e['offset'])
            predicted = predict(evs, model(evs))
            last = {}
            groups = collections.defaultdict(list)
            for e, p in zip(evs, predicted):
                groups[(e['type'], e['interval'])].append(p)
                previous = last.get(e['type'])
                last[e['type']] = e
                if e['stored'] == 'ambiguous':
                    continue
                event_score[(p == e['stored'], e['generated'] == e['stored'])] += 1
                if previous is None:
                    continue
                relation = 'other-body' if e['functionId'] != previous['functionId'] else ('nested' if e['controlDepth'] else 'same-body')
                c = classes[f"{e['type']:<14} {relation:<10} {shape(previous):<20} -> {shape(e)}"]
                c[0] += 1
                if p != e['stored']:
                    c[1] += 1
                    if len(c[3]) < 6:
                        c[3].append(definition)
                if e['generated'] != e['stored']:
                    c[2] += 1
            for (t, interval), preds in groups.items():
                first = next(e for e in evs if e['type'] == t and e['interval'] == interval)
                opens = sum(p == 'open' for p in preds)
                ambiguous = 0 < first['storedRows'] < len(preds)
                kind = 'ambiguous' if ambiguous else 'plain'
                interval_score[('model', opens == first['storedRows'], kind)] += 1
                interval_score[('generated', first['generatedRows'] == first['storedRows'], kind)] += 1
                if opens != first['storedRows']:
                    interval_misses[(t, opens - first['storedRows'])].append(definition)
        print(f'== model {name}')
        print('   events (model correct, generated correct):', dict(event_score))
        print('   intervals:', {f'{who} {"match" if ok else "MISMATCH"} {kind}': n for (who, ok, kind), n in sorted(interval_score.items())})
        print('   model interval misses (type, predicted-stored):', {k: sorted(set(v))[:8] for k, v in interval_misses.items()})
        print('   classes where model or generated is wrong: n, model wrong, generated wrong')
        for key, (n, mw, gw, ex) in sorted(classes.items(), key=lambda kv: -(kv[1][1] + kv[1][2])):
            if mw or gw:
                print(f'   {n:5} {mw:5} {gw:5}  {key}  {ex}')


if __name__ == '__main__':
    main()
