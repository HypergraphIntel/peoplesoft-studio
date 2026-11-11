import type { Workspace } from '../workspace.js';
import { writable, type McpWriteHost } from './writeTools.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import type { Json } from '../changeReview/model.js';
import type { LifecycleScope } from '../providers/classLifecycle.js';

/**
 * Application Class / Package lifecycle proposals for Change Review: the request becomes an intent (the class's source,
 * or the bare package row), the calibrated writers run it in one rolled-back transaction, and the native after-image is
 * staged. Deletions stage null after the same preview proves the writer accepts them.
 */
export async function prepareLifecycleReview(workspace: Workspace, host: McpWriteHost | undefined, tool: string, args: Record<string, unknown>) {
    if (!host) throw new Error('Package and class review requires an enabled write host.');
    const kind = tool === 'psft_create_package' || tool === 'psft_delete_package' ? 'package' : 'class';
    // psft_create_package ROOT:Sub[:Sub2] adds a subpackage to an existing package (the root keeps its case rule, the subpackage its own).
    const subpackage = tool === 'psft_create_package' && String(args.name).includes(':') ? String(args.name).split(':').map(p => p.trim()) : undefined;
    if (subpackage && (subpackage.length < 2 || subpackage.length > 3 || subpackage.slice(1).some(p => !/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(p))))
        throw new Error('A subpackage path is ROOT:Sub or ROOT:Sub:Sub2: each subpackage a letter, then letters, digits or _ (at most 30).');
    const parts = subpackage ? [subpackage[0].toUpperCase()] : kind === 'package' ? [String(args.name ?? args.package).trim().toUpperCase()]
        : tool === 'psft_save_peoplecode' ? (args.parts as string[]).map(p => p.trim()).filter((p, i, all) => !(i === all.length - 1 && p === 'OnExecute'))
            : [String(args.package).trim().toUpperCase(), ...((args.path as string[] | undefined) ?? []).map(p => p.trim()), String(args.className).trim()];
    const gate = await writable(workspace, host, String(args.connection), parts[0]);
    const defn = kind === 'class' ? makeKey(DefinitionType.ApplicationClassPeopleCode, ...parts) : makeKey(DefinitionType.ApplicationPackage, parts[0]);
    if (host.hasUnsavedEditor(gate.provider.id, defn)) throw new Error('The definition has unsaved editor changes.');
    const live = await gate.provider.readLifecycleForReview(kind, parts);
    let intent: LifecycleScope | null = null;
    if (tool === 'psft_save_peoplecode') {
        if (live.value) throw new Error(`${parts.join(':')} already exists; its source saves through the PeopleCode review adapter.`);
        intent = { scope: 'app-class/1', tables: { PSAPPCLASSDEFN: [{ APPCLASSREF: ' ', DESCR: ' ' }], PSPCMTXT: [{ PROGSEQ: 0, PCTEXT: String(args.source) }], PSPCMPROG: [], PSPCMNAME: [], PSPACKAGEDEFN: [] } };
    } else if (subpackage) {
        if (!live.value) throw new Error(`There is no package named ${parts[0]}; create it first with psft_create_package ${parts[0]}.`);
        const path = subpackage.slice(1), level = path.length, qualify = level === 1 ? ':' : path[0];
        const rows = live.value.tables.PSPACKAGEDEFN;
        if (level === 2 && !rows.some(r => String(r.PACKAGEID).trim() === path[0] && String(r.QUALIFYPATH).trim() === ':'))
            throw new Error(`${parts[0]}:${path[0]} does not exist; create the parent subpackage first.`);
        if (rows.some(r => String(r.PACKAGEID).trim().toUpperCase() === path[level - 1].toUpperCase() && String(r.QUALIFYPATH).trim() === qualify))
            throw new Error(`${[parts[0], ...path].join(':')} already exists.`);
        intent = { ...live.value, tables: { ...live.value.tables, PSPACKAGEDEFN: [...rows, { PACKAGEID: path[level - 1], PACKAGEROOT: parts[0], QUALIFYPATH: qualify, PACKAGELEVEL: level,
            PACKAGEREF: ' ', DESCR: ' ', OBJECTOWNERID: ' ', DESCRLONG: null }] } };
    } else if (tool === 'psft_create_package') {
        if (live.value) throw new Error(`A package named ${parts[0]} already exists.`);
        intent = { scope: 'app-package/1', tables: { PSAPPCLASSDEFN: [], PSPACKAGEDEFN: [{ PACKAGEID: parts[0], PACKAGEROOT: parts[0], QUALIFYPATH: '.', PACKAGELEVEL: 0, PACKAGEREF: ' ', DESCR: ' ', OBJECTOWNERID: ' ', DESCRLONG: null }] } };
    } else if (!live.value) throw new Error(`${parts.join(':')} does not exist.`);
    // The writers decide, in rollback: refusals (a missing subpackage, a package with classes, outside users) stop here.
    const preview = await gate.provider.runLifecycleChange(kind, parts, intent, gate.operatorId, live.token, true);
    if (preview.after.hash === live.hash) throw new Error('The proposal has no changes.');
    return { adapter: kind === 'class' ? 'app-class' : 'app-package', key: (kind === 'class' ? parts : parts[0]) as Json, after: preview.after.value as unknown as Json, expectedToken: live.token };
}
