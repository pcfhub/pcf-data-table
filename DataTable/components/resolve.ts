/**
 * Pure helpers, kept out of the render so they can be read — and corrected —
 * without React in the way.
 *
 * Nothing here touches `context`, the dataset, or the DOM. Everything takes
 * plain values and returns plain values.
 */

type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type SortDirection = ComponentFramework.PropertyHelper.DataSetApi.Types.SortDirection;

/** `SortDirection` is a numeric union, not an enum object — there is nothing to import. */
export const ASCENDING = 0 as SortDirection;
export const DESCENDING = 1 as SortDirection;

export type SelectionMode = 'none' | 'single' | 'multiple';

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

    return rangeTemplate
        .replace('{0}', String(first))
        .replace('{1}', String(first + rowsOnPage - 1))
        .replace('{2}', String(totalResultCount));
}
