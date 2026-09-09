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
 * The width budgeted per data column before the table starts scrolling.
 *
 * **A budget, not a floor.** The `<colgroup>` percentages divide whatever width
 * the table ends up with, so a column whose `visualSizeFactor` is small still
 * lands below this — with the view fixture, 69px against a budget of 100. What
 * the budget buys is the *total*: enough width that no column collapses to an
 * ellipsis and the reader can scroll to the rest.
 *
 * 40px is the select column, which holds a fixed-size checkbox and does not
 * take part in the proportions.
 */
const MIN_COLUMN_WIDTH = 100;
const SELECT_COLUMN_WIDTH = 40;

/**
 * The width below which the table should scroll rather than squeeze.
 *
 * **`.DataTable-scroll` has `overflow-x: auto` and it is inert without this.**
 * `table-layout: fixed` with `width: 100%` makes the table exactly as wide as
 * its container, so there is never anything to scroll — the columns absorb the
 * shortfall instead. On a 320px phone subgrid that is a seven-column view drawn
 * at 28 to 63 pixels a column: every cell an ellipsis, and a horizontal scrollbar
 * that never appears because, as far as the browser is concerned, everything
 * fits.
 *
 * A minimum width is what turns the overflow back on. The `<colgroup>`
 * percentages still divide whatever width wins, so the view designer's
 * proportions survive; they simply divide the minimum instead of the container.
 */
export function tableMinWidth(columnCount: number, selectable: boolean): number {
    return columnCount * MIN_COLUMN_WIDTH + (selectable ? SELECT_COLUMN_WIDTH : 0);
}

/** Where a column is pinned, if it is. */
export type PinnedEdge = 'start' | 'end' | null;

export interface PinnedColumn {
    pinned: PinnedEdge;
    /**
     * The `<col>` width. **`px` for a pinned column and `%` for the rest**, and
     * that mix is the feature rather than an inconsistency — see `pinPlan`.
     * `null` means "say nothing and let the browser divide the remainder".
     */
    width: string | null;
    /** How far in from the pinned edge the column sits, in px. */
    offset: number;
    /** The last column of a pinned run — the one that carries the seam. */
    edge: boolean;
}

export interface PinPlan {
    /** One entry per column, in the order the columns were handed in. */
    columns: PinnedColumn[];
    /**
     * Whether the select column sticks too. **Not optional when anything is
     * pinned at the start**: it is the first column, so leaving it to scroll
     * would slide the checkboxes underneath the column pinned beside them.
     */
    selectPinned: boolean;
    /** The table's minimum width, which is what makes the wrapper scroll. */
    minWidth: number;
    /** Nothing is pinned, and the caller should lay out exactly as 0.2.0 did. */
    none: boolean;
}

/** The plan that means "lay out as though this feature did not exist". */
function noPins(columns: Column[], selectable: boolean): PinPlan {
    return {
        columns: columns.map(() => ({ pinned: null, width: null, offset: 0, edge: false })),
        selectPinned: false,
        minWidth: tableMinWidth(columns.length, selectable),
        none: true,
    };
}

/**
 * A pinned column's width in px.
 *
 * **`visualSizeFactor` is read as pixels here and as a ratio in
 * `columnWidths`, and both are right.** Dataverse stores a view column's width
 * in `layoutxml` as a pixel number, so the field really is a width; treating it
 * as a ratio is what lets the unpinned columns divide whatever space the table
 * ends up with. A pinned column cannot do that — see the offsets below — so it
 * takes the number at face value.
 *
 * Canvas reports `0` for every factor, which is the same "there is no view
 * designer here" that makes `columnWidths` return `null`. A pinned column still
 * needs a number, so it falls back to the budget every column gets.
 */
function pinnedWidth(column: Column): number {
    return column.visualSizeFactor > 0 ? column.visualSizeFactor : MIN_COLUMN_WIDTH;
}

/**
 * Which columns stick to which edge, how wide they are, and how far in they sit.
 *
 * Three constraints shape this, and each one is a bug if it is skipped.
 *
 * **A sticky offset has to be pixels.** `inset-inline-start` on a sticky cell
 * resolves against its containing block — the table — not against the columns
 * to its left, so the percentage widths `columnWidths` produces cannot express
 * "start where the previous pinned column ended". So a pinned column leaves the
 * proportional pool and takes a fixed px width, and the unpinned columns divide
 * the remaining factor between them.
 *
 * **At least one column has to be left unpinned.** Pinning everything is a
 * table that cannot scroll, drawn with a scrollbar. `end` is trimmed before
 * `start`, because the start columns are the ones that identify the row.
 *
 * **Pinning switches itself off when it would eat the view.** Two 200px columns
 * pinned in a 320px phone subgrid leave 120px of table behind a 400px pinned
 * region — worse than not pinning, and worse in a way that only shows up on a
 * phone. `allocatedWidth` is the measurement to clamp against: a main grid
 * hands over a measured width and leaves the height at -1 forever (see the
 * `heightUnmeasured` quirk in `dev/host.js`), so width is the one of the pair
 * that can be trusted. A host that reports no width at all gets what it asked
 * for rather than a guess.
 */
export function pinPlan(
    columns: Column[],
    pinnedStart: number | null,
    pinnedEnd: number | null,
    allocatedWidth: number,
    selectable: boolean,
): PinPlan {
    const wantedStart = Math.max(0, Math.trunc(pinnedStart ?? 0) || 0);
    const wantedEnd = Math.max(0, Math.trunc(pinnedEnd ?? 0) || 0);

    if (wantedStart + wantedEnd === 0 || columns.length === 0) {
        return noPins(columns, selectable);
    }

    // Leave one column to scroll. Trim the end first — see above.
    const room = Math.max(0, columns.length - 1);
    const start = Math.min(wantedStart, room);
    const end = Math.min(wantedEnd, Math.max(0, room - start));

    if (start + end === 0) {
        return noPins(columns, selectable);
    }

    const selectPinned = selectable && start > 0;
    const widths = columns.map(pinnedWidth);

    const pinnedTotal =
        widths.slice(0, start).reduce((sum, width) => sum + width, 0) +
        widths.slice(columns.length - end).reduce((sum, width) => sum + width, 0) +
        (selectPinned ? SELECT_COLUMN_WIDTH : 0);

    /*
     * The clamp. `allocatedWidth` is 0 or -1 on a host that did not measure, and
     * a control that treated that as "no room" would unpin itself everywhere
     * rather than only where it matters.
     */
    if (allocatedWidth > 0 && pinnedTotal > allocatedWidth - MIN_COLUMN_WIDTH) {
        return noPins(columns, selectable);
    }

    // What is left for the columns that still divide a proportion.
    const looseFactor = columns
        .slice(start, columns.length - end)
        .reduce((sum, column) => sum + (column.visualSizeFactor || 0), 0);

    let fromStart = selectPinned ? SELECT_COLUMN_WIDTH : 0;
    let fromEnd = 0;
    const laidOut: PinnedColumn[] = new Array(columns.length);

    for (let index = 0; index < start; index += 1) {
        laidOut[index] = {
            pinned: 'start',
            width: `${widths[index]}px`,
            offset: fromStart,
            edge: index === start - 1,
        };
        fromStart += widths[index];
    }

    // Backwards, because an end-pinned column's offset is the sum of the ones
    // between it and the right-hand edge rather than of the ones before it.
    for (let index = columns.length - 1; index >= columns.length - end; index -= 1) {
        laidOut[index] = {
            pinned: 'end',
            width: `${widths[index]}px`,
            offset: fromEnd,
            edge: index === columns.length - end,
        };
        fromEnd += widths[index];
    }

    for (let index = start; index < columns.length - end; index += 1) {
        /*
         * `calc`, not a bare percentage, and this is the join between the two
         * width systems. A percentage on a `<col>` is a share of the *table*,
         * which already includes the pinned pixels — so three loose columns at
         * 33% each beside 200px of pinned column ask for 200px more table than
         * there is, and the whole layout drifts wider on every render that
         * changes the pinned set. Subtracting the pinned total first makes the
         * share a share of what is actually left.
         */
        const share = (columns[index].visualSizeFactor || 0) / looseFactor;

        laidOut[index] = {
            pinned: null,
            width: looseFactor > 0 ? `calc((100% - ${pinnedTotal}px) * ${share})` : null,
            offset: 0,
            edge: false,
        };
    }

    return {
        columns: laidOut,
        selectPinned,
        minWidth:
            pinnedTotal +
            (columns.length - start - end) * MIN_COLUMN_WIDTH +
            (selectable && !selectPinned ? SELECT_COLUMN_WIDTH : 0),
        none: false,
    };
}

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

/**
 * One CSV cell: quoted where it has to be, and defused where it could execute.
 *
 * Two separate jobs in one function, and only the first is about CSV.
 *
 * **Quoting** is the format: a value holding a comma, a quote or a newline is
 * wrapped in quotes with its own quotes doubled. Miss it and one address
 * column silently shifts every field after it into the wrong column.
 *
 * **The leading apostrophe** is about what opens the file. A cell beginning
 * `=`, `+`, `-` or `@` is a formula to Excel, Sheets and LibreOffice alike, so
 * a record whose name someone set to `=HYPERLINK(...)` runs when a colleague
 * opens the export. The apostrophe makes it text.
 *
 * It is withheld from anything that parses as a number, which is the part worth
 * getting right: `-1500` is a negative revenue and prefixing it turns a column
 * of figures into a column of text that will not sum. Only a leading `-` that
 * is *not* a number can be a formula.
 */
export function csvCell(value: string): string {
    const defused = /^[=+\-@\t\r]/.test(value) && !Number.isFinite(Number(value))
        ? `'${value}`
        : value;

    return /[",\r\n]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}

/**
 * A CSV document from a header row and the rows below it.
 *
 * CRLF because that is what RFC 4180 says and what Excel expects; a BOM because
 * without one Excel reads UTF-8 as the local codepage, and the export of a view
 * containing `école` opens as `Ã©cole`. Both are the kind of thing found by a
 * customer rather than by a test.
 */
export function toCsv(headers: string[], rows: string[][]): string {
    const lines = [headers, ...rows].map((cells) => cells.map(csvCell).join(','));

    // The BOM as an escape rather than the character: a literal BOM in source
    // is invisible, and eslint's no-irregular-whitespace rejects it outright.
    return `\ufeff${lines.join('\r\n')}\r\n`;
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

/* -------------------------------------------------------------------------
 * Editing
 * ---------------------------------------------------------------------- */

/**
 * What kind of editor a column can carry, decided from `dataType`.
 *
 * **A veto, exactly like `filterKindFor` above**, and the exclusions are the
 * same ones for the same reason. A `dataType` this list does not recognise
 * yields `'none'` and no editor, rather than falling through to a text box that
 * builds a value the platform rejects.
 *
 * Choices and lookups are refused, not deferred. The value the platform stores
 * is an integer or a GUID, and **`Column` carries neither** — the whole
 * interface is name, displayName, dataType, alias, order, visualSizeFactor,
 * isHidden, isPrimary and disableSorting. Building a faithful picker needs
 * `utils.getEntityMetadata()`, which is model-driven only and would add a
 * `<uses-feature>` entry — an install-time permission prompt on every
 * environment, which is the exact cost this whole feature was shaped to avoid.
 * `pcf-grid-cell-styler` declines the same two cells for the same reason.
 */
export type EditKind = 'text' | 'number' | 'boolean' | 'date' | 'none';

const BOOLEAN_TYPES = ['TwoOptions'];

/**
 * Date-only and date-and-time both edit as a date.
 *
 * The time half of a `DateAndTime.DateAndTime` is preserved rather than
 * offered: an `<input type="date">` cannot express it, and zeroing it silently
 * would move every appointment to midnight.
 */
const DATE_TYPES = ['DateAndTime.DateOnly', 'DateAndTime.DateAndTime'];

export function editKindFor(column: Column): EditKind {
    if (TEXT_TYPES.includes(column.dataType)) {
        return 'text';
    }

    if (NUMBER_TYPES.includes(column.dataType)) {
        return 'number';
    }

    if (BOOLEAN_TYPES.includes(column.dataType)) {
        return 'boolean';
    }

    if (DATE_TYPES.includes(column.dataType)) {
        return 'date';
    }

    return 'none';
}

/**
 * Turn what was typed into the value `setValue` should receive.
 *
 * `ok: false` means "do not write this" rather than "write nothing" — a
 * half-typed number commits nothing at all, on the same argument
 * `numericCondition` makes for a half-typed filter. Writing `NaN` would be a
 * wrong answer that looks like a finished one.
 *
 * An empty box is a real value — `null`, i.e. clear the column — for everything
 * but text, where it is the empty string the platform already stores.
 */
export function coerceValue(kind: EditKind, typed: string): { ok: boolean; value: unknown } {
    if (kind === 'text') {
        return { ok: true, value: typed };
    }

    if (kind === 'number') {
        if (typed.trim() === '') {
            return { ok: true, value: null };
        }

        const value = Number(typed);

        return Number.isFinite(value) ? { ok: true, value } : { ok: false, value: null };
    }

    if (kind === 'boolean') {
        return { ok: true, value: typed === 'true' };
    }

    if (kind === 'date') {
        if (typed.trim() === '') {
            return { ok: true, value: null };
        }

        /*
         * **Built from local components rather than parsed from the string**,
         * and this repository has already paid for the difference.
         *
         * `<input type="date">` yields `YYYY-MM-DD`. `new Date('2026-03-01')`
         * parses that as **UTC** midnight, so west of Greenwich it is the
         * evening of 29 February — the column comes back a day early. The same
         * class of one-day shift took `pcf-date-range-picker` five releases,
         * and three of the theories along the way were wrong because they were
         * reasoned rather than measured.
         *
         * `new Date(y, m - 1, d)` is local midnight, unambiguously, with no
         * parsing rules involved.
         */
        const parts = typed.split('-').map(Number);

        if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
            return { ok: false, value: null };
        }

        const value = new Date(parts[0], parts[1] - 1, parts[2]);

        return Number.isNaN(value.getTime()) ? { ok: false, value: null } : { ok: true, value };
    }

    return { ok: false, value: null };
}

/**
 * The columns the maker restricted editing to, or `null` for "no restriction".
 *
 * `null` rather than "every column" because the two are not the same question:
 * unrestricted still defers to what the *platform* says about each column, and
 * this set only ever narrows that further. A maker naming a column the platform
 * reports as read-only does not make it editable.
 */
export function editableColumnSet(raw: string | null): Set<string> | null {
    const names = (raw ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');

    return names.length > 0 ? new Set(names) : null;
}

/** One cell, addressed. Record ids are GUIDs and column names have no `|`. */
export function cellKey(recordId: string, columnName: string): string {
    return `${recordId}|${columnName}`;
}

/** The value an editor should open with, formatted for its input type. */
export function editorValue(kind: EditKind, raw: unknown): string {
    if (raw === null || raw === undefined) {
        return '';
    }

    if (kind === 'date') {
        const date = raw instanceof Date ? raw : new Date(String(raw));

        if (Number.isNaN(date.getTime())) {
            return '';
        }

        // Local components again, for the same reason `coerceValue` builds
        // them: `toISOString()` here would show the previous day west of
        // Greenwich, and the editor would round-trip a value nobody typed.
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');

        return `${date.getFullYear()}-${month}-${day}`;
    }

    if (kind === 'boolean') {
        return raw === true || raw === 1 || raw === '1' ? 'true' : 'false';
    }

    return String(raw);
}
