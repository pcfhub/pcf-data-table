/**
 * The **browser route**: the loaded records grouped in the page, producing the
 * same `GroupReading[]` the server route does.
 *
 * It is always available, it is the only route a canvas app gets, and it is
 * what stands in when `webAPI` is absent, the view cannot be read, the runtime
 * filter cannot be spelled, or the server refuses. What it is *not* is a
 * substitute — it sees the loaded page and nothing else, which is why the
 * caption says which route answered and why a page-sized total is never shown
 * as the whole.
 *
 * **The two routes have to agree, and this file is half of why they can.**
 * Both produce `GroupReading`, both normalise through `readGroupValue`, and
 * the suite asserts that grouping the same records either way gives the same
 * keys, labels and counts. That assertion is the whole value of the seam: a
 * fixture-driven test becomes a fair test of the server path's arithmetic.
 */

import {
    AliasPlan,
    Aggregate,
    GroupKind,
    GroupReading,
    KEY_SEPARATOR,
} from './types';
import { Condition } from '../query/fetchXml';
import { groupKeyOf, readGroupValue } from '../query/rows';

/** The one thing this file needs of a dataset record. */
export interface ReadableRecord {
    getValue(column: string): unknown;
    getFormattedValue(column: string): string;
}

/**
 * A lookup read off a **record** rather than off an aggregate row.
 *
 * Measured 2026-09-20: `{ etn, id: { guid }, name }` — **the GUID is nested at
 * `.id.guid`, not a bare string**, and arrives unbraced and lower-case.
 * Comparing `getValue()` directly against an id fails on every row, which is
 * the bug this function exists to have already made.
 */
export function lookupGuidOf(raw: unknown): string | null {
    if (raw === null || raw === undefined) {
        return null;
    }

    if (typeof raw === 'string') {
        return raw.replace(/[{}]/g, '').toLowerCase();
    }

    const loose = raw as { id?: unknown; guid?: unknown };
    const id = loose.id as { guid?: unknown } | string | undefined;

    if (typeof id === 'string') {
        return id.replace(/[{}]/g, '').toLowerCase();
    }

    const guid = (id && typeof id === 'object' ? id.guid : undefined) ?? loose.guid;

    return typeof guid === 'string' ? guid.replace(/[{}]/g, '').toLowerCase() : null;
}

/** One record's value for one group column, normalised to match the server's. */
function valueOf(record: ReadableRecord, column: string, kind: GroupKind): string | number | null {
    let raw: unknown;

    try {
        raw = record.getValue(column);
    } catch {
        return null;
    }

    if (kind === 'lookup') {
        return lookupGuidOf(raw);
    }

    return readGroupValue(raw, kind);
}

function labelOf(record: ReadableRecord, column: string, value: string | number | null, blankLabel: string): string {
    if (value === null) {
        return blankLabel;
    }

    try {
        const formatted = record.getFormattedValue(column);

        if (typeof formatted === 'string' && formatted !== '') {
            return formatted;
        }
    } catch {
        // A column the host cannot format falls back to the value.
    }

    return String(value);
}

/**
 * The loaded records, grouped.
 *
 * Insertion-ordered: a group appears where its first record does, and
 * `sortGroups` decides the final order. Measures are computed here so that a
 * caption saying *loaded so far* is still saying something true about the rows
 * it can see.
 */
export function groupRecords(
    records: ReadableRecord[],
    plan: AliasPlan,
    blankLabel: string,
    format?: (value: number, column: string) => string,
): GroupReading[] {
    const found = new Map<string, { reading: GroupReading; sums: number[]; seen: number[] }>();

    for (const record of records) {
        const values = plan.groups.map((group) => valueOf(record, group.column, group.kind));
        const key = groupKeyOf(values);
        let entry = found.get(key);

        if (!entry) {
            entry = {
                reading: {
                    key,
                    values,
                    labels: plan.groups.map((group, index) => labelOf(record, group.column, values[index], blankLabel)),
                    count: 0,
                    measures: plan.measures.map(() => null),
                    measureLabels: plan.measures.map(() => ''),
                },
                sums: plan.measures.map(() => 0),
                seen: plan.measures.map(() => 0),
            };
            found.set(key, entry);
        }

        entry.reading.count += 1;

        plan.measures.forEach((measure, index) => {
            const raw = valueOf(record, measure.column, 'number');

            if (raw === null || typeof raw !== 'number') {
                return;
            }

            entry.sums[index] += raw;
            entry.seen[index] += 1;

            const current = entry.reading.measures[index];

            entry.reading.measures[index] = applyMeasure(measure.aggregate, current, raw, entry.sums[index], entry.seen[index]);
        });
    }

    /*
     * **Label what was computed, or none of it is ever seen.**
     *
     * `measureLabels` was initialised to empty strings above and nothing ever
     * filled them on this route, so a grouped table with `aggregates` set
     * calculated every measure correctly and then drew a blank cell. It only
     * looked right because the *server* route brings its own formatted values
     * back from FetchXML — which meant the feature worked on a model-driven
     * form and silently showed nothing on canvas, where this is the only route
     * there is. Found by looking at a screenshot, 2026-09-21.
     *
     * The formatter is passed in because an aggregate is not a record value:
     * there is no cell for the platform to format, so the caller supplies
     * `context.formatting`. Without one the number is still shown, unformatted,
     * which is worse than a currency symbol and far better than nothing.
     */
    return [...found.values()].map((entry) => {
        entry.reading.measureLabels = entry.reading.measures.map((value, index) => {
            if (value === null) {
                return '';
            }

            if (typeof value !== 'number') {
                return String(value);
            }

            return format ? format(value, plan.measures[index].column) : String(value);
        });

        return entry.reading;
    });
}

/**
 * One more value folded into a measure.
 *
 * **`avg` is the asymmetry worth knowing**, and it is the reason a reading
 * cannot simply be re-averaged: on the browser route the average is over
 * records this control has seen, and on the server route the value handed back
 * is *already* the group's average and averaging it again would be wrong. So
 * the two routes compute `avg` differently on purpose, and produce the same
 * answer only when the browser route holds every record of the group.
 * The caption is what tells a reader whether that was the case.
 */
function applyMeasure(
    aggregate: Aggregate,
    current: string | number | null,
    value: number,
    sum: number,
    seen: number,
): number {
    if (aggregate === 'sum') {
        return sum;
    }

    if (aggregate === 'avg') {
        return seen === 0 ? 0 : sum / seen;
    }

    if (current === null || typeof current !== 'number') {
        return value;
    }

    return aggregate === 'min' ? Math.min(current, value) : Math.max(current, value);
}

/** How the group headers are ordered. */
export type GroupSort = 'label' | 'count';

/**
 * Group order.
 *
 * **`label` is the default, and the reason is measured rather than
 * aesthetic.** Sorting a view by an OptionSet column puts *Manufacturing*
 * (option value 2) before *Retail* (option value 1) — the platform sorts a
 * Choice by its **label**, alphabetically, not by its option value. The
 * aggregate hands `g0` back as the integer, so headers ordered by that integer
 * would read Retail, Manufacturing, Services, Technology while the rows
 * underneath read Manufacturing, Retail, Services, Technology. Headers and
 * rows contradicting each other about order, on the same column, in the same
 * table.
 *
 * There is deliberately **no `value` option**, for that reason: it would be a
 * switch whose only effect is to make the table disagree with itself.
 *
 * Sorted over the complete group list, which is honest on the server route and
 * honest-about-what-it-holds on the browser one — unlike sorting *rows* in the
 * page, which reorders a fraction of the result and looks completely right.
 */
export function sortGroups(readings: GroupReading[], by: GroupSort): GroupReading[] {
    const sorted = [...readings];

    /*
     * **Blank last, and it is applied before the sort key rather than after.**
     *
     * The first version put this inside the label comparator and let the count
     * branch short-circuit on `b.count - a.count`, so ordering by count put the
     * blank group first whenever it was the largest — which, being "everything
     * with no value", it often is. Caught by `dev/grouping.js`, which is the
     * reason that assertion says *whatever the order* rather than testing one.
     */
    sorted.sort((a, b) => {
        const aBlank = isBlank(a);
        const bBlank = isBlank(b);

        if (aBlank !== bBlank) {
            return aBlank ? 1 : -1;
        }

        if (by === 'count' && a.count !== b.count) {
            return b.count - a.count;
        }

        return compareLabels(a, b);
    });

    return sorted;
}

/** A group that is the absence of a value, in every one of its columns. */
const isBlank = (reading: GroupReading): boolean => reading.values.every((value) => value === null);

const compareLabels = (a: GroupReading, b: GroupReading): number =>
    a.labels.join(KEY_SEPARATOR).localeCompare(b.labels.join(KEY_SEPARATOR));

/**
 * The conditions that narrow a dataset to one group — how expansion works.
 *
 * Expanding is a **filter, not a scroll**: the control ANDs these onto the
 * filter row's own expression and refreshes, and the group's members arrive as
 * ordinary paged rows. That is what dissolves "a group whose members span
 * pages" — the question is never asked.
 *
 * Returns `null` when the group cannot be expressed, and then the header gets
 * **no chevron** rather than one that does nothing. `date` is the case that
 * matters today: a bucketed day needs a `between` pair the filter builder does
 * not emit, which is one of the reasons date bucketing is not in 0.6.0.
 */
export function expandConditions(reading: GroupReading, plan: AliasPlan): Condition[] | null {
    const conditions: Condition[] = [];

    for (let index = 0; index < plan.groups.length; index += 1) {
        const group = plan.groups[index];
        const value = reading.values[index];

        if (group.kind === 'unsupported' || group.kind === 'date') {
            return null;
        }

        if (value === null) {
            // 12 is Null, and it takes no value.
            conditions.push({ attributeName: group.column, conditionOperator: 12, value: '' });

            continue;
        }

        // 0 is Equal. A Choice goes as its integer rendered as a string, which
        // is what the filter row already sends for a choice box.
        conditions.push({ attributeName: group.column, conditionOperator: 0, value: String(value) });
    }

    return conditions;
}
