/**
 * **TEMPORARY. Delete this file and its three lines in `index.ts` before 0.9.0
 * is built.** It ships no behaviour. It exists to answer *0.9.0 → What must be
 * measured first* in `SPEC.md` (R1–R7), none of which the rig can answer: the
 * rig is a model of the platform, so it reports whatever we chose to write into
 * it.
 *
 * The feature it is measuring for: **rows in your own order** — a maker-named
 * whole-number column, the table sorted by it, and a moved row renumbering the
 * rows it passes through `record.setValue`/`save`. Nothing in the catalogue has
 * imposed a sort on load, written several records in one gesture, or relied on
 * where Dataverse puts a null in an ascending sort.
 *
 * Passive half: per instance, the sort the first pass arrived with (R1's
 * reload question) and, after `mark()`, every `updateView` pass with the row
 * order it carried (R3). Active half: `window.__pcfDataTableProbe`, a registry
 * of every Data Table on the page — `list()`, then `at(i).r1('cll_order')` and
 * so on. **R3 and R5 write records**; nothing else does.
 */

import { IInputs } from './generated/ManifestTypes';

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

const VERSION = '0.8.3';
const TAG = `[pcf-data-table probe ${VERSION}]`;

interface Pass {
    t: number;
    loading: boolean;
    order: string;
}

interface Instance {
    index: number;
    latest: ComponentFramework.Context<IInputs>;
    startedAt: number;
    passes: number;
    firstSorting: any;
    firstColumns: string[];
    marked: number | null;
    log: Pass[];
}

const instances: Instance[] = [];
const owners = new WeakMap<object, Instance>();

const safe = <T>(read: () => T): T | string => {
    try {
        return read();
    } catch (error) {
        return 'THREW: ' + String(error);
    }
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const short = (id: string): string => String(id).replace(/[{}]/g, '').slice(0, 8);

function dataset(inst: Instance): any {
    return inst.latest.parameters.records as any;
}

function primaryName(ds: any): string {
    return (ds.columns ?? []).find((c: any) => c.isPrimary)?.name ?? '';
}

/** The page as the dataset holds it now: name and order value, in row order. */
function rows(inst: Instance, column: string): any[] {
    const ds = dataset(inst);
    const primary = primaryName(ds);

    return (ds.sortedRecordIds ?? []).map((id: string) => {
        const record = ds.records[id];

        return {
            id: short(id),
            name: safe(() => record.getFormattedValue(primary)),
            order: safe(() => record.getValue(column)),
        };
    });
}

/** One string per page, so a pass log reads as a sequence of orders. */
function orderLine(inst: Instance, column: string): string {
    return rows(inst, column)
        .map((row) => `${row.name}=${row.order === null ? '∅' : row.order}`)
        .join(' | ');
}

let watchedColumn = 'cll_order';

function snap(inst: Instance, column = watchedColumn): any {
    const ds = dataset(inst);

    return {
        pass: inst.passes,
        loading: ds.loading,
        error: ds.error,
        errorMessage: ds.errorMessage,
        entity: safe(() => ds.getTargetEntityType?.()),
        total: ds.paging?.totalResultCount,
        pageSize: ds.paging?.pageSize,
        hasNextPage: ds.paging?.hasNextPage,
        sorting: safe(() => (ds.sorting ?? []).map((s: any) => ({ name: s.name, sortDirection: s.sortDirection }))),
        columns: (ds.columns ?? []).map((c: any) => `${c.name}:${c.dataType}${c.isHidden ? ':hidden' : ''}`),
        rows: rows(inst, column),
    };
}

function sortBy(inst: Instance, column: string, direction: 0 | 1): void {
    const ds = dataset(inst);
    ds.sorting.splice(0, ds.sorting.length);
    ds.sorting.push({ name: column, sortDirection: direction });
    safe(() => ds.paging.reset());
    ds.refresh();
}

function describeError(error: any): any {
    return {
        type: typeof error,
        ctor: error?.constructor?.name,
        message: error?.message,
        keys: error && typeof error === 'object' ? Object.keys(error) : null,
        json: safe(() => JSON.stringify(error)),
        string: String(error),
    };
}

/** setValue then save on one record, timed; never refreshes. */
async function writeOne(inst: Instance, column: string, id: string, value: any): Promise<any> {
    const ds = dataset(inst);
    const fullId = (ds.sortedRecordIds ?? []).find((each: string) => short(each) === short(id)) ?? id;
    const record = ds.records[fullId];
    const started = performance.now();

    try {
        const set = record.setValue(column, value);
        const afterSet = Math.round(performance.now() - started);
        const valueAfterSet = safe(() => record.getValue(column));
        await record.save();

        return {
            id: short(fullId),
            value,
            setReturned: typeof set,
            msToSetValue: afterSet,
            valueAfterSet,
            msToSaved: Math.round(performance.now() - started),
            valueAfterSave: safe(() => dataset(inst).records[fullId]?.getValue(column)),
            ok: true,
        };
    } catch (error) {
        return {
            id: short(fullId),
            value,
            msToFailed: Math.round(performance.now() - started),
            error: describeError(error),
            valueAfterFailure: safe(() => dataset(inst).records[fullId]?.getValue(column)),
            datasetError: [dataset(inst).error, dataset(inst).errorMessage],
            ok: false,
        };
    }
}

function api(inst: Instance): any {
    return {
        index: inst.index,
        version: VERSION,
        dataset: () => dataset(inst),
        column: (name: string) => {
            watchedColumn = name;
            return name;
        },
        snap: (column?: string) => snap(inst, column),
        first: () => ({ sorting: inst.firstSorting, columns: inst.firstColumns }),
        mark: () => {
            inst.marked = performance.now();
            inst.log = [];
            return 'marked';
        },
        log: () => inst.log,

        /** R1: impose the column's sort; where do nulls land; ascending and descending. */
        r1: async (column = watchedColumn) => {
            watchedColumn = column;
            const before = snap(inst, column);
            sortBy(inst, column, 0);
            await wait(3000);
            const ascending = snap(inst, column);
            sortBy(inst, column, 1);
            await wait(3000);
            const descending = snap(inst, column);
            sortBy(inst, column, 0);
            await wait(3000);
            const answer = { before: before.sorting, ascending, descending: descending.rows, after: snap(inst, column).sorting };
            console.log(TAG, `#${inst.index}`, 'R1', answer);
            return answer;
        },

        /** R2: is the column readable when it is not in the view; does addColumn exist and work. */
        r2: async (column = watchedColumn) => {
            const ds = dataset(inst);
            const firstId = (ds.sortedRecordIds ?? [])[0];
            const answer: any = {
                inColumns: (ds.columns ?? []).some((c: any) => c.name === column),
                getValueBefore: safe(() => ds.records[firstId]?.getValue(column)),
                addColumn: typeof ds.addColumn,
            };

            if (typeof ds.addColumn === 'function') {
                answer.addColumnReturned = safe(() => ds.addColumn(column));
                ds.refresh();
                await wait(3500);
                const now = dataset(inst);
                answer.inColumnsAfter = (now.columns ?? []).some((c: any) => c.name === column);
                answer.columnAfter = safe(() => (now.columns ?? []).find((c: any) => c.name === column));
                answer.getValueAfter = safe(() => now.records[(now.sortedRecordIds ?? [])[0]]?.getValue(column));
            }

            console.log(TAG, `#${inst.index}`, 'R2', answer);
            return answer;
        },

        /**
         * R3 (writes): [[id, value], ...] — sequential or parallel saves, timed,
         * the passes they cause, the order before any refresh, then after one.
         */
        r3: async (writes: Array<[string, any]>, mode: 'seq' | 'par' = 'seq', column = watchedColumn) => {
            inst.marked = performance.now();
            inst.log = [];
            const before = orderLine(inst, column);
            const started = performance.now();
            const results: any[] = [];

            if (mode === 'par') {
                results.push(...(await Promise.all(writes.map(([id, value]) => writeOne(inst, column, id, value)))));
            } else {
                for (const [id, value] of writes) {
                    results.push(await writeOne(inst, column, id, value));
                }
            }

            const msAllSaved = Math.round(performance.now() - started);
            const rightAfter = orderLine(inst, column);
            await wait(2000);
            const twoSecondsLater = orderLine(inst, column);
            const passesBeforeRefresh = inst.log.length;
            dataset(inst).refresh();
            await wait(3000);
            const answer = {
                mode,
                msAllSaved,
                results,
                before,
                rightAfter,
                twoSecondsLater,
                passesBeforeRefresh,
                afterRefresh: orderLine(inst, column),
                passes: inst.log,
            };
            console.log(TAG, `#${inst.index}`, 'R3', answer);
            return answer;
        },

        /** R4: isEditable on the order column, per row, with statecode when the view has it. */
        r4: async (column = watchedColumn) => {
            const ds = dataset(inst);
            const answer = await Promise.all(
                (ds.sortedRecordIds ?? []).map(async (id: string) => {
                    const record = ds.records[id];
                    return {
                        id: short(id),
                        name: safe(() => record.getFormattedValue(primaryName(ds))),
                        state: safe(() => record.getFormattedValue('statecode')),
                        editable: await Promise.resolve(safe(() => record.isEditable(column))).catch((e: any) => 'REJECTED ' + String(e)),
                    };
                }),
            );
            console.log(TAG, `#${inst.index}`, 'R4', answer);
            return answer;
        },

        /** R5 (writes): one write expected to be refused — what rejects, what the row holds after. */
        r5: async (id: string, value: any, column = watchedColumn) => {
            const answer = await writeOne(inst, column, id, value);
            await wait(1500);
            const settled = rows(inst, column).find((row) => row.id === short(id));
            const result = { answer, settled };
            console.log(TAG, `#${inst.index}`, 'R5', result);
            return result;
        },

        /** R6: page size and page jumps. */
        page: async (size: number) => {
            const ds = dataset(inst);
            ds.paging.setPageSize(size);
            safe(() => ds.paging.reset());
            ds.refresh();
            await wait(3000);
            return snap(inst);
        },
        goto: async (pageNumber: number) => {
            const ds = dataset(inst);
            safe(() => (ds.paging.loadExactPage ? ds.paging.loadExactPage(pageNumber) : ds.paging.loadNextPage(true)));
            await wait(3000);
            return snap(inst);
        },
    };
}

declare global {
    interface Window {
        __pcfDataTableProbe?: { version: string; list: () => any[]; at: (index: number) => any };
    }
}

export function probeInit(context: ComponentFramework.Context<IInputs>, owner: object): void {
    const ds = context.parameters.records as any;
    const inst: Instance = {
        index: instances.length,
        latest: context,
        startedAt: performance.now(),
        passes: 0,
        firstSorting: safe(() => (ds.sorting ?? []).map((s: any) => ({ name: s.name, sortDirection: s.sortDirection }))),
        firstColumns: (ds.columns ?? []).map((c: any) => c.name),
        marked: null,
        log: [],
    };
    instances.push(inst);
    owners.set(owner, inst);

    window.__pcfDataTableProbe = {
        version: VERSION,
        list: () =>
            instances.map((each) => ({
                index: each.index,
                entity: safe(() => dataset(each).getTargetEntityType?.()),
                rows: (dataset(each).sortedRecordIds ?? []).length,
                firstSorting: each.firstSorting,
            })),
        at: (index: number) => api(instances[index]),
    };

    console.log(TAG, `instance #${inst.index} init`, { sorting: inst.firstSorting, columns: inst.firstColumns });
}

export function probe(context: ComponentFramework.Context<IInputs>, owner: object): void {
    const inst = owners.get(owner);

    if (!inst) {
        return;
    }

    inst.latest = context;
    inst.passes += 1;

    if (inst.marked !== null && inst.log.length < 40) {
        inst.log.push({
            t: Math.round(performance.now() - inst.marked),
            loading: (context.parameters.records as any).loading,
            order: orderLine(inst, watchedColumn),
        });
    }
}
