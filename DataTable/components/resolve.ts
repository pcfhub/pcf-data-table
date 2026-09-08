/**
 * Pure helpers, kept out of the render so they can be read — and corrected —
 * without React in the way.
 *
 * Nothing here touches `context`, the dataset, or the DOM. Everything takes
 * plain values and returns plain values.
 */

type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type SortDirection = ComponentFramework.PropertyHelper.DataSetApi.Types.SortDirection;
type FilterExpression = ComponentFramework.PropertyHelper.DataSetApi.FilterExpression;

/** `SortDirection` is a numeric union, not an enum object — there is nothing to import. */
export const ASCENDING = 0 as SortDirection;
export const DESCENDING = 1 as SortDirection;

export type SelectionMode = 'none' | 'single' | 'multiple';

/**
 * `FilterOperator`: 0 And, 1 Or. Numeric unions again, so again no import.
 *
 * **This control ANDs, and `pcf-view-filter` ORs, and the difference is the
 * whole shape of the feature rather than a preference.** That control takes one
 * term and asks for it in *any* of several columns, which is an `Or`. This one
 * gives every column its own box, and two filled boxes have to mean "both" —
 * with `Or` a second filter would return *more* rows than the first, which
 * reads as the control ignoring what was typed.
 */
const AND = 0;

/**
 * The `ConditionOperator` values used here, out of the ~90 the platform
 * defines. All are supported on canvas and model-driven alike; reaching past
 * this set is choosing a host.
 *
 * `Like` (6) is case-insensitive and takes SQL wildcards rather than a
 * substring, which is why the value is wrapped in `%` below rather than passed
 * bare.
 */
const EQUAL = 0;
const GREATER_THAN = 2;
const LESS_THAN = 3;
const GREATER_EQUAL = 4;
const LESS_EQUAL = 5;
const LIKE = 6;

/**
 * What kind of filter input a column can carry, decided from `dataType`.
 *
 * **The comparison vetoes rather than enables**, following `pcf-star-rating`: a
 * `dataType` this list does not recognise yields `'none'` and no input, rather
 * than falling through to a text box and building a `Like` the server rejects.
 * An unfilterable column is a visible, explicable state; a query that fails
 * names the column rather than the control, and only in a network trace.
 */
export type FilterKind = 'text' | 'number' | 'none';

const TEXT_TYPES = [
    'SingleLine.Text',
    'SingleLine.TextArea',
    'SingleLine.Email',
    'SingleLine.Phone',
    'SingleLine.URL',
    'SingleLine.Ticker',
    'Multiple',
];

const NUMBER_TYPES = ['Whole.None', 'Decimal', 'Currency', 'FP'];

export function filterKindFor(column: Column): FilterKind {
    if (TEXT_TYPES.includes(column.dataType)) {
        return 'text';
    }

    if (NUMBER_TYPES.includes(column.dataType)) {
        return 'number';
    }

    /*
     * Everything else — dates, choices, two-options, lookups — gets no input,
     * and for two different reasons worth keeping apart.
     *
     * Dates: the operators that would express "on or after this day" (`On`,
     * `OnOrAfter`, `OnOrBefore`) are not documented as supported on both hosts,
     * and a `GreaterThan` against a date column compares the wrong thing.
     *
     * Choices, two-options and lookups: the value the server filters on is an
     * integer or a GUID, and **`Column` carries neither.** The whole interface
     * is name, displayName, dataType, alias, order, visualSizeFactor, isHidden,
     * isPrimary and disableSorting — there is no option list on it. Reading one
     * means `utils.getEntityMetadata()`, which is model-driven only and would
     * add a `<uses-feature>` entry, i.e. an install-time permission prompt on
     * every environment. See SPEC.md for the option that was considered and
     * declined.
     */
    return 'none';
}

/**
 * Escape what SQL `LIKE` treats as a wildcard, so a typed `%` matches a `%`.
 *
 * `%`, `_` and `[` are the three, and the escape is a character class rather
 * than a backslash: `[%]`, `[_]`, `[[]`. A backslash is not an escape character
 * here and would be searched for literally.
 *
 * Without this, typing `%` matches every record in the table — a filter box
 * that appears to ignore what was typed — and typing `_` quietly matches any
 * single character.
 */
export function escapeLike(term: string): string {
    return term.replace(/[%_[]/g, (character) => `[${character}]`);
}

/**
 * A numeric filter box, which accepts a comparison prefix.
 *
 * `>1000`, `>=1000`, `<1000`, `<=1000`, or a bare `1000` for equality. Returns
 * `null` when what is left after the prefix is not a number, so a half-typed
 * `>` sends no condition at all rather than one comparing against `NaN`.
 */
function numericCondition(attributeName: string, typed: string): Condition | null {
    const match = /^\s*(>=|<=|>|<)?\s*(-?[\d.]+)\s*$/.exec(typed);

    if (!match) {
        return null;
    }

    const value = Number(match[2]);

    if (!Number.isFinite(value)) {
        return null;
    }

    const operator = { '>': GREATER_THAN, '>=': GREATER_EQUAL, '<': LESS_THAN, '<=': LESS_EQUAL }[
        match[1] ?? ''
    ];

    return { attributeName, conditionOperator: operator ?? EQUAL, value };
}

interface Condition {
    attributeName: string;
    conditionOperator: number;
    value: string | number;
}

/**
 * The expression for what is typed across the filter row, or `null` for none.
 *
 * One condition per filled box, combined with `And`. A column whose box is
 * empty contributes nothing — an empty filter is not a filter for `''`.
 */
export function buildFilter(
    filters: Record<string, string>,
    columns: Column[],
): FilterExpression | null {
    const conditions: Condition[] = [];

    columns.forEach((column) => {
        const typed = (filters[column.name] ?? '').trim();

        if (typed === '') {
            return;
        }

        const kind = filterKindFor(column);

        if (kind === 'text') {
            conditions.push({
                attributeName: column.name,
                conditionOperator: LIKE,
                value: `%${escapeLike(typed)}%`,
            });

            return;
        }

        if (kind === 'number') {
            const condition = numericCondition(column.name, typed);

            if (condition) {
                conditions.push(condition);
            }
        }
    });

    if (conditions.length === 0) {
        return null;
    }

    // Cast because the typed shape does not accept the bare numeric literals
    // these operators are; the union has no enum object to name them through.
    return { filterOperator: AND, conditions } as unknown as FilterExpression;
}

/**
 * The columns to render, in the order the view asks for.
 *
 * `isHidden` is the maker's decision in the view designer, not a suggestion, and
 * `order` is what they dragged the columns into. A table that ignores either
 * looks broken to the person who set them.
 */
export function visibleColumns(columns: Column[]): Column[] {
    return columns
        .filter((column) => !column.isHidden)
        .sort((a, b) => a.order - b.order);
}

/**
 * `visualSizeFactor` as percentage widths for a `<colgroup>`.
 *
 * Canvas may report every factor as 0 — there is no view designer there to have
 * set them — in which case there is nothing to distribute and the browser's own
 * table layout is a better answer than dividing by zero.
 */
export function columnWidths(columns: Column[]): string[] | null {
    const total = columns.reduce((sum, column) => sum + (column.visualSizeFactor || 0), 0);

    if (total <= 0) {
        return null;
    }

    return columns.map((column) => `${((column.visualSizeFactor || 0) / total) * 100}%`);
}

/**
 * The column whose value names the row for a screen reader, and whose cell
 * carries the open-record button.
 */
export function primaryColumn(columns: Column[]): Column | undefined {
    return columns.find((column) => column.isPrimary) ?? columns[0];
}

/**
 * Ascending, then descending, then ascending again.
 *
 * Deliberately no third "unsorted" state: a view always has an order, so
 * clearing the sort would hand the user a state the platform cannot actually
 * represent.
 */
export function nextDirection(current: SortDirection | undefined): SortDirection {
    return current === ASCENDING ? DESCENDING : ASCENDING;
}

/** Add or remove one id, honouring the selection mode. */
export function toggleId(ids: string[], id: string, mode: SelectionMode): string[] {
    if (mode === 'none') {
        return [];
    }

    if (ids.includes(id)) {
        return ids.filter((existing) => existing !== id);
    }

    return mode === 'single' ? [id] : [...ids, id];
}

/**
 * Whether the header checkbox is on, off, or indeterminate.
 *
 * Scoped to the ids on screen: with paging, "all" can only honestly mean "all
 * of the ones you can see".
 */
export function headerCheckState(
    selected: string[],
    pageIds: string[],
): 'none' | 'some' | 'all' {
    if (pageIds.length === 0) {
        return 'none';
    }

    const count = pageIds.filter((id) => selected.includes(id)).length;

    if (count === 0) {
        return 'none';
    }

    return count === pageIds.length ? 'all' : 'some';
}

/**
 * The pager's label.
 *
 * `totalResultCount` is -1 when the platform did not count the rows, which is
 * common on large views. Printing "of -1" is the tell that nobody checked, so
 * fall back to naming the page instead of the range.
 */
/**
 * The last page there is, or `0` when that cannot be known.
 *
 * Two inputs and both have a live "no answer" value, which is why this is a
 * function rather than a division at the call site: `totalResultCount` is `-1`
 * on a view the platform did not count — common on large ones — and `pageSize`
 * is `0` when the host never reported one. Either way there is no last page to
 * clamp to, and `0` says so. Dividing by an unchecked `0` yields `Infinity`,
 * which then clamps every jump to it.
 */
export function lastPage(totalResultCount: number, pageSize: number): number {
    if (totalResultCount < 0 || pageSize <= 0) {
        return 0;
    }

    return Math.max(1, Math.ceil(totalResultCount / pageSize));
}

/** A requested page, held between 1 and the last — where the last is known. */
export function clampPage(target: number, last: number): number {
    const wanted = Math.max(1, Math.trunc(target) || 1);

    return last > 0 ? Math.min(wanted, last) : wanted;
}

/**
 * The sizes to offer in the rows-per-page picker.
 *
 * The current size is always included, however the maker wrote the list: it is
 * what the control is doing, and a picker that cannot show its own state reads
 * as broken. Sorted, de-duplicated, and anything outside 1..250 dropped —
 * `MAX_PAGE_SIZE` is the platform's ceiling, so an option above it would be a
 * choice that silently does something else.
 */
export function pageSizeChoices(raw: string | null, current: number): number[] {
    const parsed = (raw ?? '')
        .split(',')
        .map((part) => Math.trunc(Number(part.trim())))
        .filter((size) => Number.isFinite(size) && size >= 1 && size <= 250);

    if (parsed.length === 0) {
        return [];
    }

    const withCurrent = current > 0 ? parsed.concat(current) : parsed;

    return [...new Set(withCurrent)].sort((a, b) => a - b);
}

export function pagerLabel(
    page: number,
    pageSize: number,
    rowsOnPage: number,
    totalResultCount: number,
    rangeTemplate: string,
    pageTemplate: string,
): string {
    if (totalResultCount < 0) {
        return pageTemplate.replace('{0}', String(page));
    }

    const first = (page - 1) * pageSize + 1;

    // Clamped because the two halves of this sentence used to come from
    // different places — a page number from the platform, a row count from the
    // rendered set — and could disagree. `pcf-compact-list` printed "4–9 of 6"
    // on a real form that way. Both now come from the control, but a view that
    // shrinks underneath a stale page counter would still overrun.
    return rangeTemplate
        .replace('{0}', String(Math.min(first, totalResultCount)))
        .replace('{1}', String(Math.min(first + rowsOnPage - 1, totalResultCount)))
        .replace('{2}', String(totalResultCount));
}
