/**
 * **TEMPORARY. Delete this file and its three lines in `index.ts` before 0.8.0
 * is built.** It ships no behaviour. It exists to answer the questions under
 * *0.8.0 → What must be measured first* in `SPEC.md` (P1–P11), none of which
 * anything below a real Dataverse form can answer.
 *
 * The feature it is measuring for: **Related through** — a FetchXML
 * `<link-entity>` fragment with `{id}` for the form's record, applied through
 * `dataset.linking.addLinkedEntity` and conditions carrying `entityAliasName`,
 * so the rows stay the platform's. Nothing in the catalogue has ever called
 * `addLinkedEntity`, and Learn contradicts itself twice on what it rests on:
 * the SDK's `ConditionOperator` has 75 = Under … 79 = AboveOrEqual where the
 * PCF DataSet reference lists 75 = Above … 79 = UnderOrEqual, and the DataSet
 * page says "if sorting is re-configured it will reset the filter".
 *
 * Passive half: per instance, the first six `updateView` passes (the first
 * paint, P7) and one line of what the host offers. Active half:
 * `window.__pcfDataTableProbe`, a registry of every Data Table on the page —
 * `list()`, then `at(i).p1()` and so on. Each question links, filters and
 * refreshes the dataset of the instance it is called on, and **a link cannot
 * be removed**, so reload the form between questions. Nothing here writes a
 * record. Every count is read off the *latest* context, never the one the
 * question started from (the 0.4.2 lesson), at +5, +15 and +25 s.
 */

import { IInputs } from './generated/ManifestTypes';
import { queryString, rootEntityOf, stripView } from './query/fetchXml';
import { readViewFetchXml } from './data/GroupData';

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

const VERSION = '0.7.3';
const TAG = `[pcf-data-table probe ${VERSION}]`;
const ARM_KEY = 'pcfDataTableProbeP7';

interface Instance {
    index: number;
    latest: ComponentFramework.Context<IInputs>;
    first: any;
    startedAt: number;
    passes: number;
    early: any[];
    reported: boolean;
}

const instances: Instance[] = [];
const owners = new WeakMap<object, Instance>();
const answers: any[] = [];

const bare = (id: unknown): string => String(id ?? '').replace(/[{}]/g, '').toLowerCase();
const safe = <T>(read: () => T): T | string => {
    try {
        return read();
    } catch (error) {
        return 'THREW: ' + String(error);
    }
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function dataset(inst: Instance): any {
    return inst.latest.parameters.records as any;
}

function formId(inst: Instance): string {
    return bare((inst.latest.mode as any).contextInfo?.entityId);
}

function clientUrl(context: any): string {
    const fromPage = safe(() => context.page?.getClientUrl?.());

    if (typeof fromPage === 'string' && fromPage !== '' && !fromPage.startsWith('THREW')) {
        return fromPage;
    }

    return (globalThis as any).Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.() ?? '';
}

/** What the dataset says right now, read through the latest context. */
function snapshot(inst: Instance): any {
    const ds = dataset(inst);
    const ids: string[] = ds.sortedRecordIds ?? [];

    return {
        pass: inst.passes,
        msSinceInit: Date.now() - inst.startedAt,
        loading: ds.loading,
        count: ids.length,
        total: ds.paging?.totalResultCount,
        firstPageNumber: ds.paging?.firstPageNumber,
        hasNextPage: ds.paging?.hasNextPage,
        error: ds.error,
        errorMessage: ds.errorMessage,
        linked: safe(() => JSON.parse(JSON.stringify(ds.linking?.getLinkedEntities?.() ?? null))),
        filter: safe(() => JSON.parse(JSON.stringify(ds.filtering?.getFilter?.() ?? null))),
        sorting: safe(() => (ds.sorting ?? []).map((s: any) => ({ name: s.name, sortDirection: s.sortDirection }))),
        sameObjectAsFirstPass: ds === inst.first,
        firstIds: ids.slice(0, 3),
    };
}

/** +5, +15, +25 s, logged and kept; resolves with the last reading. */
async function watch(inst: Instance, question: string, extra?: any): Promise<any> {
    const readings: any[] = [];

    for (const at of [5000, 10000, 10000]) {
        await wait(at);
        const reading = snapshot(inst);
        readings.push(reading);
        console.log(TAG, `#${inst.index}`, question, `+${readings.length === 1 ? 5 : readings.length === 2 ? 15 : 25}s`, reading);
    }

    answers.push({ instance: inst.index, question, extra, readings, at: new Date().toISOString() });

    return readings[readings.length - 1];
}

function link(inst: Instance, expression: any): any {
    const ds = dataset(inst);
    const result = safe(() => ds.linking.addLinkedEntity(expression));
    console.log(TAG, `#${inst.index}`, 'addLinkedEntity', expression, '→', result, 'now', safe(() => ds.linking.getLinkedEntities()));

    return result;
}

function filter(inst: Instance, conditions: any[], filterOperator = 0): void {
    const ds = dataset(inst);
    const expression = { conditions, filterOperator };
    const result = safe(() => ds.filtering.setFilter(expression));
    console.log(TAG, `#${inst.index}`, 'setFilter', expression, '→', result);
}

function refresh(inst: Instance): void {
    const ds = dataset(inst);
    safe(() => ds.paging.reset());
    safe(() => ds.refresh());
}

/** The link every question but P11 stands on: the bound row's customer, as an account. */
const REL0 = { name: 'account', from: 'accountid', to: 'cll_customer', linkType: 'inner', alias: 'rel0' };

const onRel0 = (inst: Instance, op: number): any => ({
    attributeName: 'accountid',
    conditionOperator: op,
    value: formId(inst),
    entityAliasName: 'rel0',
});

function api(inst: Instance): any {
    return {
        index: inst.index,
        state: () => snapshot(inst),
        watch: (label = 'manual') => watch(inst, label),
        link: (expression: any) => link(inst, expression),
        filter: (conditions: any[], op = 0) => filter(inst, conditions, op),
        refresh: () => refresh(inst),

        /** Before any question: what an untouched subgrid holds. */
        base: () => watch(inst, 'BASE', { formId: formId(inst) }),

        /** P1 — does a link plus a condition on its alias narrow the rows? */
        p1: async (to = 'cll_customer') => {
            const before = snapshot(inst);
            link(inst, { ...REL0, to });
            filter(inst, [onRel0(inst, 0)]);
            refresh(inst);
            return watch(inst, 'P1 rel0.accountid Equal formId', { before, to });
        },

        /** P2 — Equal and 75–79, one after another on the same link. ~2.5 minutes. */
        p2: async (ops = [0, 75, 76, 77, 78, 79]) => {
            link(inst, REL0);
            const totals: Record<string, any> = {};

            for (const op of ops) {
                filter(inst, [onRel0(inst, op)]);
                refresh(inst);
                const last = await watch(inst, `P2 operator ${op}`);
                totals[op] = { total: last.total, count: last.count, error: last.error, errorMessage: last.errorMessage };
            }

            console.log(TAG, `#${inst.index}`, 'P2 summary', totals);
            answers.push({ instance: inst.index, question: 'P2 summary', totals });

            return totals;
        },

        /** P3 — after P1 or P2, a sort: are the filter and the link still in force? */
        p3: async (descending = true) => {
            const ds = dataset(inst);
            const column = (ds.columns ?? []).filter((c: any) => !c.isHidden).sort((a: any, b: any) => a.order - b.order)[0];
            const before = snapshot(inst);
            ds.sorting.length = 0;
            ds.sorting.push({ name: column.name, sortDirection: descending ? 1 : 0 });
            safe(() => ds.refresh());
            return watch(inst, `P3 sort ${column.name} ${descending ? 'desc' : 'asc'}`, { before });
        },

        /** P4 — page 2 by loadExactPage with the link in force. */
        p4: async (page = 2) => {
            const before = snapshot(inst);
            safe(() => dataset(inst).paging.loadExactPage(page));
            return watch(inst, `P4 loadExactPage(${page})`, { before });
        },

        /** P5 — the same alias added a second time. */
        p5: async () => {
            link(inst, REL0);
            link(inst, REL0);
            filter(inst, [onRel0(inst, 0)]);
            refresh(inst);
            return watch(inst, 'P5 rel0 added twice');
        },

        /** P6a — a link chained from rel0 (its customer's parent account = the form record). */
        p6chain: async (to = 'rel0.parentaccountid') => {
            link(inst, REL0);
            link(inst, { name: 'account', from: 'accountid', to, linkType: 'inner', alias: 'rel1' });
            filter(inst, [{ attributeName: 'accountid', conditionOperator: 0, value: formId(inst), entityAliasName: 'rel1' }]);
            refresh(inst);
            return watch(inst, `P6 chained link to=${to}`);
        },

        /** P6b — a second top-level link whose condition matches nobody: honoured → 0 rows, ignored → unchanged. */
        p6second: async () => {
            link(inst, REL0);
            link(inst, { name: 'systemuser', from: 'systemuserid', to: 'ownerid', linkType: 'inner', alias: 'rel2' });
            filter(inst, [
                onRel0(inst, 0),
                { attributeName: 'systemuserid', conditionOperator: 0, value: '00000000-0000-0000-0000-000000000001', entityAliasName: 'rel2' },
            ]);
            refresh(inst);
            return watch(inst, 'P6 second top-level link, impossible condition');
        },

        /** P7 — arm a link + filter for the next load, set in init (with or without a refresh there). */
        p7arm: (mode: 'init' | 'init+refresh' = 'init') => {
            window.localStorage.setItem(ARM_KEY, mode);
            return `armed: ${mode} — reload the form, then read at(i).early`;
        },
        p7disarm: () => {
            window.localStorage.removeItem(ARM_KEY);
            return 'disarmed';
        },
        get early() {
            return inst.early;
        },

        /** P9 — the grouping route's count: the view's own FetchXML with the fragment appended inside <entity>. */
        p9: async (operator = 'eq-or-under') => {
            const ctx = inst.latest as any;
            const ds = dataset(inst);
            const entity = ds.getTargetEntityType();
            const viewId = safe(() => ds.getViewId());
            const viewXml = typeof viewId === 'string' ? await readViewFetchXml(ctx.webAPI, viewId) : null;
            const stripped = viewXml !== null ? stripView(viewXml) : null;
            const head = stripped !== null && rootEntityOf(stripped) === entity
                ? stripped.slice((/<entity\b[^>]*>/.exec(stripped)?.index ?? 0) + (/<entity\b[^>]*>/.exec(stripped)?.[0].length ?? 0), stripped.lastIndexOf('</entity>'))
                : '';
            const fragment = `<link-entity name='account' from='accountid' to='cll_customer' alias='rel0'><filter><condition attribute='accountid' operator='${operator}' value='${formId(inst)}'/></filter></link-entity>`;
            const xml = `<fetch aggregate='true'><entity name='${entity}'><attribute name='${entity}id' aggregate='count' alias='n'/>${head}${fragment}</entity></fetch>`;
            const started = Date.now();
            let result: any;

            try {
                const answer = await ctx.webAPI.retrieveMultipleRecords(entity, queryString(xml));
                result = { n: answer?.entities?.[0]?.n, entities: answer?.entities, ms: Date.now() - started };
            } catch (error) {
                result = { rejected: error, keys: error && typeof error === 'object' ? Object.keys(error) : typeof error };
            }

            const ids: string[] = ds.sortedRecordIds ?? [];
            const customers = ids.map((id) => bare(safe(() => ds.records[id]?.getValue('cll_customer')?.id?.guid ?? ds.records[id]?.getValue('cll_customer')?.id)));
            const extra = {
                xml,
                viewFound: viewXml !== null,
                result,
                datasetTotal: ds.paging?.totalResultCount,
                loadedRows: ids.length,
                loadedRowsPointingAtForm: customers.filter((c) => c === formId(inst)).length,
                loadedCustomerIds: Array.from(new Set(customers)),
            };
            console.log(TAG, `#${inst.index}`, 'P9', extra);
            answers.push({ instance: inst.index, question: `P9 aggregate ${operator}`, extra });

            return extra;
        },

        /** P10 — a web resource by name, from a dataset control, same origin. */
        p10: async (name: string) => {
            const url = `${clientUrl(inst.latest).replace(/\/+$/, '')}/WebResources/${name.split('/').map(encodeURIComponent).join('/')}`;
            let extra: any;

            try {
                const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
                const body = await response.text();
                extra = {
                    url,
                    status: response.status,
                    ok: response.ok,
                    contentType: response.headers.get('content-type'),
                    cacheControl: response.headers.get('cache-control'),
                    bodyLength: body.length,
                    bodyStart: body.slice(0, 200),
                };
            } catch (error) {
                extra = { url, threw: String(error) };
            }

            console.log(TAG, `#${inst.index}`, 'P10', extra);
            answers.push({ instance: inst.index, question: `P10 ${name}`, extra });

            return extra;
        },

        /** P11 — a link naming a column the table does not have. Reload the form after this one. */
        p11: async () => {
            const before = snapshot(inst);
            link(inst, { name: 'account', from: 'accountid', to: 'nosuchcolumn', linkType: 'inner', alias: 'bad0' });
            filter(inst, [{ attributeName: 'accountid', conditionOperator: 0, value: formId(inst), entityAliasName: 'bad0' }]);
            refresh(inst);
            return watch(inst, 'P11 link to=nosuchcolumn', { before });
        },
    };
}

function registry(): any {
    const root = globalThis as any;

    if (!root.__pcfDataTableProbe) {
        root.__pcfDataTableProbe = {
            version: VERSION,
            answers,
            list: () => instances.map((inst) => {
                const ds = dataset(inst);
                return {
                    index: inst.index,
                    title: safe(() => ds.getTitle()),
                    viewId: safe(() => ds.getViewId()),
                    entity: safe(() => ds.getTargetEntityType()),
                    total: ds.paging?.totalResultCount,
                    count: (ds.sortedRecordIds ?? []).length,
                    formId: formId(inst),
                };
            }),
            at: (index: number) => api(instances[index]),
            /** Every answer as one JSON string, to paste into SPEC.md. */
            dump: () => JSON.stringify(answers, null, 2),
        };
    }

    return root.__pcfDataTableProbe;
}

/** From `init`: register, and run P7's armed variant before the first `updateView`. */
export function probeInit(context: ComponentFramework.Context<IInputs>, owner: object): void {
    const inst: Instance = {
        index: instances.length,
        latest: context,
        first: context.parameters.records,
        startedAt: Date.now(),
        passes: 0,
        early: [],
        reported: false,
    };

    instances.push(inst);
    owners.set(owner, inst);
    registry();

    const armed = safe(() => window.localStorage.getItem(ARM_KEY));

    if (armed === 'init' || armed === 'init+refresh') {
        const ds = context.parameters.records as any;
        inst.early.push({ armed, inInit: true, contextInfo: safe(() => JSON.parse(JSON.stringify((context.mode as any).contextInfo ?? null))), sortedInInit: (ds.sortedRecordIds ?? []).length, loadingInInit: ds.loading });
        link(inst, REL0);
        filter(inst, [onRel0(inst, 0)]);

        if (armed === 'init+refresh') {
            refresh(inst);
        }
    }
}

/** From `updateView`, first line. */
export function probe(context: ComponentFramework.Context<IInputs>, owner: object): void {
    const inst = owners.get(owner);

    if (!inst) {
        return;
    }

    inst.latest = context;
    inst.passes += 1;

    if (inst.early.length < 7) {
        inst.early.push(snapshot(inst));
    }

    if (inst.reported) {
        return;
    }

    inst.reported = true;

    const ctx = context as any;
    const ds = context.parameters.records as any;

    console.log(TAG, `#${inst.index}`, 'host', {
        linking: typeof ds.linking,
        linkingKeys: ds.linking ? Object.keys(ds.linking) : null,
        addLinkedEntity: typeof ds.linking?.addLinkedEntity,
        linkedAtFirstPass: safe(() => ds.linking?.getLinkedEntities?.()),
        filteringKeys: ds.filtering ? Object.keys(ds.filtering) : null,
        canDisableRelationshipFilter: safe(() => {
            const value = ds.filtering?.canDisableRelationshipFilter;
            return typeof value === 'function' ? { type: 'function', result: value.call(ds.filtering) } : value;
        }),
        filterAtFirstPass: safe(() => ds.filtering?.getFilter?.()),
        contextInfo: ctx.mode?.contextInfo,
        title: safe(() => ds.getTitle()),
        viewId: safe(() => ds.getViewId()),
        entity: safe(() => ds.getTargetEntityType()),
        clientUrl: clientUrl(ctx),
        armed: safe(() => window.localStorage.getItem(ARM_KEY)),
    });
}
