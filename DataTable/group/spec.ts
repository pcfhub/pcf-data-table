/**
 * The maker's two text properties → a `GroupSpec`, or a refusal.
 *
 * Pure. This is where grouping decides what it will not ask the server, and
 * that is a measured position rather than a cautious one:
 *
 * - **A refusal is whole-query.** One unusable measure costs the group counts
 *   too — measured 2026-09-20, `sum` over a primary key took the entire
 *   response with it. So a measure that cannot be spelled is dropped *here*,
 *   with a reason, rather than sent.
 * - **Some refusals cannot be shown to anybody.** The multi-select refusal
 *   came back as a message template with an unsubstituted `{0}` in it. A
 *   control that renders that shows a maker a formatting placeholder, so the
 *   question is never asked: `MultiSelectPicklist` is refused locally, by
 *   `dataType`, before a query exists.
 *
 * The maker gets a text box rather than a column picker, which a
 * `property-set` role would have given for free. That trade is argued in the
 * manifest; the mitigation is here — **every name is validated against the
 * view's real columns**, and a miss is named rather than ignored.
 */

import { Aggregate, GroupKind, GroupSpec, MeasureSpec, groupKindFor, measurableWith } from './types';

/** The one thing this file needs of a dataset column. */
export interface ColumnLike {
    name: string;
    dataType: string;
    displayName?: string;
}

export interface SpecProblem {
    /** The text the maker wrote that could not be used. */
    input: string;
    reason: 'unknown-column' | 'cannot-group' | 'cannot-measure' | 'unknown-aggregate' | 'malformed';
}

export interface SpecResult {
    spec: GroupSpec | null;
    problems: SpecProblem[];
}

const AGGREGATES: Aggregate[] = ['sum', 'avg', 'min', 'max'];

const split = (value: string | null | undefined): string[] =>
    String(value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');

/**
 * `"cll_industry, cll_priority"` → the columns, checked against the view.
 *
 * A name the view does not have is a **problem, not a silent drop**: the
 * maker typed `revenu` and nothing happened is the failure mode a column
 * picker would have prevented, so the least this can do is say which columns
 * do exist.
 */
export function parseGroupColumns(
    input: string | null | undefined,
    columns: ColumnLike[],
): { groups: { column: string; kind: GroupKind }[]; problems: SpecProblem[] } {
    const problems: SpecProblem[] = [];
    const groups: { column: string; kind: GroupKind }[] = [];

    for (const name of split(input)) {
        const column = columns.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());

        if (!column) {
            problems.push({ input: name, reason: 'unknown-column' });

            continue;
        }

        const kind = groupKindFor(column.dataType);

        if (kind === 'unsupported') {
            problems.push({ input: name, reason: 'cannot-group' });

            continue;
        }

        // A column named twice groups once; the second is not an error worth
        // reporting, it is the same grouping.
        if (!groups.some((existing) => existing.column === column.name)) {
            groups.push({ column: column.name, kind });
        }
    }

    return { groups, problems };
}

/**
 * `"sum:revenue, avg:revenue"` → the measures, checked against the view.
 *
 * `count` is deliberately not accepted as an aggregate here: it is asked for
 * on every query regardless, so a maker writing `count:anything` is asking
 * for something they already have. It is reported rather than silently
 * ignored, because silence would read as "count is not supported".
 */
export function parseAggregates(
    input: string | null | undefined,
    columns: ColumnLike[],
): { measures: MeasureSpec[]; problems: SpecProblem[] } {
    const problems: SpecProblem[] = [];
    const measures: MeasureSpec[] = [];

    for (const entry of split(input)) {
        const parts = entry.split(':').map((part) => part.trim());

        if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
            problems.push({ input: entry, reason: 'malformed' });

            continue;
        }

        const aggregate = parts[0].toLowerCase() as Aggregate;
        const name = parts[1];

        if (AGGREGATES.indexOf(aggregate) === -1) {
            problems.push({ input: entry, reason: 'unknown-aggregate' });

            continue;
        }

        const column = columns.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());

        if (!column) {
            problems.push({ input: entry, reason: 'unknown-column' });

            continue;
        }

        /*
         * The check that stops one bad measure costing every group its count.
         * Measured: the server refuses the *whole query* for an aggregate it
         * will not perform, so this cannot be left to it.
         */
        if (!measurableWith(column.dataType, aggregate)) {
            problems.push({ input: entry, reason: 'cannot-measure' });

            continue;
        }

        if (!measures.some((existing) => existing.column === column.name && existing.aggregate === aggregate)) {
            measures.push({ column: column.name, aggregate });
        }
    }

    return { measures, problems };
}

/**
 * The whole spec, or `null` when there is nothing to group by.
 *
 * `null` is the ordinary state: `groupBy` unset means 0.6.0 renders exactly
 * what 0.5.0 rendered, which is the point of the property having no default.
 * It is also what a `groupBy` naming only columns the view does not have
 * produces — **an ungrouped table and a named problem**, never a half-grouped
 * one.
 */
export function buildSpec(
    entity: string,
    primaryId: string,
    columns: ColumnLike[],
    groupBy: string | null | undefined,
    aggregates: string | null | undefined,
): SpecResult {
    const groups = parseGroupColumns(groupBy, columns);
    const measures = parseAggregates(aggregates, columns);
    const problems = groups.problems.concat(measures.problems);

    if (groups.groups.length === 0) {
        return { spec: null, problems };
    }

    return {
        spec: { entity, primaryId, groups: groups.groups, measures: measures.measures },
        problems,
    };
}

/**
 * A problem as one line for the console.
 *
 * The console rather than the UI, deliberately: a mistyped column name is a
 * *design-time* error, and the person who can fix it is in the maker portal,
 * not looking at the form. Putting it on the form would show every user an
 * error only one person can act on.
 */
export function describeProblem(problem: SpecProblem, columns: ColumnLike[]): string {
    const available = columns.map((column) => column.name).join(', ');

    switch (problem.reason) {
        case 'unknown-column':
            return `"${problem.input}" is not a column on this view. Available: ${available}`;
        case 'cannot-group':
            return `"${problem.input}" cannot be grouped — a multi-select choice holds a list, which a group is not.`;
        case 'cannot-measure':
            return `"${problem.input}" cannot be aggregated that way. sum and avg need a numeric column; min and max also take a date.`;
        case 'unknown-aggregate':
            return `"${problem.input}" — the aggregate must be one of ${AGGREGATES.join(', ')}. A count is always included.`;
        default:
            return `"${problem.input}" is not in the form aggregate:column, such as sum:revenue.`;
    }
}
