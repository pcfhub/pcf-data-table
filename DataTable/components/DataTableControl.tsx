import * as React from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import {
    columnWidths,
    DESCENDING,
    filterKindFor,
    headerCheckState,
    pagerLabel,
    primaryColumn,
    SelectionMode,
    tableMinWidth,
} from './resolve';

/** The pager chevrons, on a 20×20 grid. Two strokes each. */
const CHEVRON_PREVIOUS = 'M12.5 5 7.5 10l5 5';
const CHEVRON_NEXT = 'M7.5 5l5 5-5 5';

/** A tray with an arrow into it, on the same 20×20 grid as the chevrons. */
const DOWNLOAD_GLYPH = 'M10 3v8m0 0 3-3m-3 3-3-3M4 14v2h12v-2';

/** The clear-filter cross, on the same grid but drawn smaller — see the CSS. */
const CLEAR_GLYPH = 'M6 6l8 8M14 6l-8 8';

/**
 * The cross inside a filter box.
 *
 * Its own class rather than `DataTable-chevron`: it is drawn at 12px against
 * the chevrons' 16, and it must not pick up their right-to-left mirror — a
 * cross is symmetrical, so flipping it is a no-op that would still have to be
 * read and dismissed by whoever next edits that rule.
 */
function ClearGlyph(): React.ReactElement {
    return (
        <svg
            className="DataTable-clearGlyph"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
        >
            <path
                d={CLEAR_GLYPH}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

/**
 * The export glyph.
 *
 * Same class as `DataTable-chevron` rather than one of its own: it wants the
 * identical box and the identical RTL treatment, and a second class that only
 * repeated the first would be two places to change the size.
 */
function DownloadGlyph(): React.ReactElement {
    return (
        <svg
            className="DataTable-chevron"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
        >
            <path
                d={DOWNLOAD_GLYPH}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/**
 * A chevron, inline, so it can follow the theme.
 *
 * An icon behind `<img src>` — file or data URL, PNG or SVG — renders as an
 * isolated document that cannot see this control's stylesheet, so a
 * `currentColor` inside it resolves to black and a dark form gets a black glyph
 * on a dark background. `pcf-file-drop` shipped exactly that and it was found
 * on a real form. Inline, `currentColor` is the button's own colour — which
 * here comes from the Fluent theme the provider above is handed.
 *
 * Decorative: it sits on a button that already reads “Previous page”, so
 * announcing the glyph as well would add a word and no meaning. Same reasoning
 * as the sort arrow above it.
 */
function Chevron(props: { d: string }): React.ReactElement {
    return (
        <svg
            className="DataTable-chevron"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
        >
            <path
                d={props.d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type DataSet = ComponentFramework.PropertyTypes.DataSet;

export interface IProps {
    dataset: DataSet;
    columns: Column[];
    pageIds: string[];
    selected: string[];
    selectionMode: SelectionMode;
    enableSorting: boolean;
    openOnRowClick: boolean;
    page: number;
    pageSize: number;
    filters: Record<string, string>;
    enableFiltering: boolean;
    lastPage: number;
    pageSizeOptions: number[];
    enableExport: boolean;
    disabled: boolean;
    visible: boolean;
    isRTL: boolean;
    theme: Record<string, string> | undefined;
    getString: (id: string) => string;
    onSort: (columnName: string) => void;
    onFilter: (columnName: string, value: string) => void;
    onClearFilter: (columnName: string) => void;
    onClearFilters: () => void;
    onGoToPage: (page: number) => void;
    onPageSize: (size: number) => void;
    onExport: () => void;
    onNextPage: () => void;
    onPreviousPage: () => void;
    onToggleRow: (id: string) => void;
    onToggleAll: (ids: string[], selectAll: boolean) => void;
    onOpenRecord: (id: string) => void;
}

/**
 * Selection is mirrored in local state rather than rendered straight from
 * props.
 *
 * On a real form either would work, because the platform re-renders after
 * `notifyOutputChanged()`. PCFHub's demo harness does not: it posts the outputs
 * to the parent window, and it rebuilds the whole DataSet on every render — so
 * a component that rendered selection straight from props would look dead in
 * the published demo, with every checkbox accepting a click and none of them
 * ticking.
 *
 * The resync key is the selection's *content*, not its identity: every
 * `updateView` hands down a fresh array.
 */
function useMirroredSelection(selected: string[]): [string[], (next: string[]) => void] {
    const [local, setLocal] = React.useState(selected);
    const key = selected.join('|');

    React.useEffect(() => {
        setLocal(selected);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return [local, setLocal];
}

/**
 * The filter boxes, mirrored locally for the same reason the selection is.
 *
 * Here it is not only about the demo harness. The value handed down is debounced
 * — `index.ts` waits 300 ms before applying it — so rendering the boxes straight
 * from props would make each one lag a third of a second behind the keystroke
 * that filled it, and a fast typist would watch characters arrive out of order.
 * Local state is what the user is typing; props are what the platform was asked
 * for, and the resync key is the applied content.
 */
function useMirroredFilters(
    filters: Record<string, string>,
): [Record<string, string>, (columnName: string, value: string) => void] {
    const [local, setLocal] = React.useState(filters);
    const key = JSON.stringify(filters);

    React.useEffect(() => {
        setLocal(filters);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return [
        local,
        (columnName: string, value: string): void =>
            setLocal((current) => ({ ...current, [columnName]: value })),
    ];
}

/** `indeterminate` is a DOM property, not an attribute — React will not set it. */
function useIndeterminate(state: 'none' | 'some' | 'all'): React.RefObject<HTMLInputElement> {
    const ref = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (ref.current) {
            ref.current.indeterminate = state === 'some';
        }
    }, [state]);

    return ref;
}

export function DataTableControl(props: IProps): React.ReactElement | null {
    const { dataset, columns, pageIds, getString } = props;

    const [selected, setSelected] = useMirroredSelection(props.selected);
    const [filters, setFilter] = useMirroredFilters(props.filters);
    const checkState = headerCheckState(selected, pageIds);
    const headerRef = useIndeterminate(checkState);

    // Whether the reader has narrowed the view themselves. It decides whether
    // an empty result is "this view is empty" or "your filters matched nothing"
    // — and, below, whether the table is drawn at all when nothing came back.
    const filtered = Object.values(props.filters).some((value) => value.trim() !== '');

    // Canvas relies on this; a model-driven form hides the section itself, so
    // honouring it costs a line and covers both hosts.
    if (!props.visible) {
        return null;
    }

    const frame = (content: React.ReactElement): React.ReactElement => (
        <FluentProvider theme={props.theme ?? webLightTheme} dir={props.isRTL ? 'rtl' : 'ltr'}>
            <div className="DataTable">{content}</div>
        </FluentProvider>
    );

    if (dataset.error) {
        return frame(
            <p className="DataTable-message DataTable-error">
                {dataset.errorMessage || getString('DataTable_Error')}
            </p>,
        );
    }

    // A canvas app supplies only the columns the maker picked in the Items
    // Fields flyout. None picked is a real state, and a bare <table> with a
    // header row and no cells reads as a broken control rather than as a
    // configuration the maker still has to finish.
    if (columns.length === 0) {
        return frame(
            <p className="DataTable-message">
                {dataset.loading ? getString('DataTable_Loading') : getString('DataTable_NoColumns')}
            </p>,
        );
    }

    /*
     * `loading` is true on the first updateView, before any records arrive, so
     * rendering the empty state here would flash "No records" on every load.
     *
     * **The `!filtered` is load-bearing and not a tidy-up.** The filter boxes
     * live in `<thead>`, so returning a bare message here at the moment a
     * filter matches nothing would delete the only UI that can clear it: the
     * reader types one character too many and the control becomes a dead end
     * with no way back to their own data. When a filter is in force the table
     * is drawn regardless, and the message goes in the body — see the empty
     * `<tbody>` branch below.
     */
    if (pageIds.length === 0 && !filtered) {
        return frame(
            <p className="DataTable-message">
                {dataset.loading ? getString('DataTable_Loading') : getString('DataTable_Empty')}
            </p>,
        );
    }

    const widths = columnWidths(columns);
    const primary = primaryColumn(columns);
    const selectable = props.selectionMode !== 'none';
    const multiple = props.selectionMode === 'multiple';

    const toggleRow = (id: string): void => {
        props.onToggleRow(id);
        setSelected(
            selected.includes(id)
                ? selected.filter((existing) => existing !== id)
                : multiple
                  ? [...selected, id]
                  : [id],
        );
    };

    const toggleAll = (): void => {
        const selectAll = checkState !== 'all';
        props.onToggleAll(pageIds, selectAll);
        setSelected(selectAll ? [...new Set([...selected, ...pageIds])] : []);
    };

    const sortFor = (column: Column): 'ascending' | 'descending' | 'none' => {
        // `sorting` is typed as a required array, and the local test harness
        // supplies `undefined` for it — so this reads through a fallback.
        // Without it `npm start` throws a TypeError the harness swallows, and
        // the control renders as an empty box with nothing in the console.
        const status = (dataset.sorting ?? []).find((entry) => entry.name === column.name);

        if (!status) {
            return 'none';
        }

        return status.sortDirection === DESCENDING ? 'descending' : 'ascending';
    };

    return frame(
        <>
            <div className={dataset.loading ? 'DataTable-scroll is-loading' : 'DataTable-scroll'}>
                {/*
                  The minimum is what makes the wrapper's `overflow-x: auto` do
                  anything at all — see `tableMinWidth`. Inline rather than in
                  the stylesheet because it depends on how many columns the view
                  has, which CSS cannot count.
                */}
                <table
                    className="DataTable-table"
                    style={{ minWidth: `${tableMinWidth(columns.length, selectable)}px` }}
                >
                    <caption className="DataTable-caption">{dataset.getTitle()}</caption>

                    {widths && (
                        <colgroup>
                            {selectable && <col className="DataTable-selectCol" />}
                            {widths.map((width, index) => (
                                <col key={columns[index].name} style={{ width }} />
                            ))}
                        </colgroup>
                    )}

                    <thead>
                        <tr>
                            {selectable && (
                                <th scope="col" className="DataTable-selectCell">
                                    {multiple && (
                                        <input
                                            ref={headerRef}
                                            type="checkbox"
                                            checked={checkState === 'all'}
                                            disabled={props.disabled}
                                            aria-label={getString('DataTable_SelectAll')}
                                            onChange={toggleAll}
                                        />
                                    )}
                                </th>
                            )}

                            {columns.map((column) => {
                                const sorted = sortFor(column);
                                // The fixture format cannot express a
                                // non-sortable column, so undefined means
                                // sortable — which is also what a view reports
                                // for an ordinary column.
                                const sortable = props.enableSorting && !column.disableSorting;

                                return (
                                    <th
                                        key={column.name}
                                        scope="col"
                                        aria-sort={sortable ? sorted : undefined}
                                    >
                                        {sortable ? (
                                            <button
                                                type="button"
                                                className="DataTable-sort"
                                                title={getString('DataTable_SortBy').replace(
                                                    '{0}',
                                                    column.displayName,
                                                )}
                                                onClick={(): void => props.onSort(column.name)}
                                            >
                                                <span>{column.displayName}</span>
                                                <span aria-hidden="true" className="DataTable-arrow">
                                                    {sorted === 'ascending'
                                                        ? '▲'
                                                        : sorted === 'descending'
                                                          ? '▼'
                                                          : ''}
                                                </span>
                                            </button>
                                        ) : (
                                            column.displayName
                                        )}
                                    </th>
                                );
                            })}
                        </tr>

                        {/*
                          A second row in the same `<thead>`, which inherits the
                          `<colgroup>` alignment above rather than needing its
                          own — including the leading select column, which is
                          why the empty `<th>` below is not optional.
                        */}
                        {props.enableFiltering && (
                            <tr className="DataTable-filterRow">
                                {selectable && <th className="DataTable-selectCell" />}

                                {columns.map((column) => {
                                    const kind = filterKindFor(column);

                                    if (kind === 'none') {
                                        /*
                                          Empty, and it has to say why. A blank
                                          cell between two filter boxes reads as
                                          a box that failed to render — on the
                                          first real form it was the thing that
                                          looked broken — so it carries the
                                          reason on hover and a dash for the eye.
                                        */
                                        return (
                                            <th
                                                key={column.name}
                                                className="DataTable-filterNone"
                                                title={getString('DataTable_Unfilterable').replace(
                                                    '{0}',
                                                    column.displayName,
                                                )}
                                            >
                                                <span aria-hidden="true">—</span>
                                            </th>
                                        );
                                    }

                                    const label = (
                                        kind === 'number'
                                            ? getString('DataTable_FilterNumberHint')
                                            : getString('DataTable_FilterColumn')
                                    ).replace('{0}', column.displayName);

                                    return (
                                        <th key={column.name}>
                                            <span className="DataTable-filterBox">
                                            <input
                                                type="text"
                                                className="DataTable-filter"
                                                value={filters[column.name] ?? ''}
                                                disabled={props.disabled}
                                                aria-label={label}
                                                title={label}
                                                /*
                                                  A visible placeholder, not only
                                                  the accessible name. Without it
                                                  the row is a line of empty
                                                  boxes with no stated purpose,
                                                  which is what it looked like on
                                                  the first real form.
                                                */
                                                placeholder={
                                                    kind === 'number'
                                                        ? getString('DataTable_FilterNumberPlaceholder')
                                                        : getString('DataTable_FilterPlaceholder')
                                                }
                                                onChange={(event): void => {
                                                    setFilter(column.name, event.target.value);
                                                    props.onFilter(column.name, event.target.value);
                                                }}
                                            />

                                            {/*
                                              Only once there is something to
                                              clear. A cross sitting in an empty
                                              box is a control that does nothing,
                                              and it would compete with the
                                              placeholder for the same few
                                              pixels.
                                            */}
                                            {(filters[column.name] ?? '') !== '' && !props.disabled && (
                                                <button
                                                    type="button"
                                                    className="DataTable-filterClear"
                                                    aria-label={getString(
                                                        'DataTable_ClearFilter',
                                                    ).replace('{0}', column.displayName)}
                                                    title={getString('DataTable_ClearFilter').replace(
                                                        '{0}',
                                                        column.displayName,
                                                    )}
                                                    onClick={(): void => {
                                                        setFilter(column.name, '');
                                                        props.onClearFilter(column.name);
                                                    }}
                                                >
                                                    <ClearGlyph />
                                                </button>
                                            )}
                                            </span>
                                        </th>
                                    );
                                })}
                            </tr>
                        )}
                    </thead>

                    <tbody>
                        {/*
                          The other half of the early-return fix above: the
                          table is standing, so the reason there are no rows
                          goes in it. Naming the filters rather than saying "no
                          records" is the difference between a reader reaching
                          for the boxes they filled and one concluding the view
                          is empty.
                        */}
                        {pageIds.length === 0 && (
                            <tr>
                                <td colSpan={columns.length + (selectable ? 1 : 0)}>
                                    <span className="DataTable-message">
                                        {dataset.loading
                                            ? getString('DataTable_Loading')
                                            : getString('DataTable_NoMatches')}
                                    </span>{' '}
                                    <button
                                        type="button"
                                        className="DataTable-clearFilters"
                                        disabled={props.disabled}
                                        onClick={props.onClearFilters}
                                    >
                                        {getString('DataTable_ClearFilters')}
                                    </button>
                                </td>
                            </tr>
                        )}

                        {pageIds.map((id) => {
                            const record = dataset.records[id];

                            if (!record) {
                                return null;
                            }

                            const rowName = primary ? record.getFormattedValue(primary.name) : id;
                            const isSelected = selected.includes(id);

                            return (
                                <tr
                                    key={id}
                                    className={isSelected ? 'is-selected' : undefined}
                                    aria-selected={selectable ? isSelected : undefined}
                                    onClick={
                                        props.openOnRowClick
                                            ? (): void => props.onOpenRecord(id)
                                            : undefined
                                    }
                                >
                                    {selectable && (
                                        <td
                                            className="DataTable-selectCell"
                                            onClick={(event): void => event.stopPropagation()}
                                        >
                                            <input
                                                type={multiple ? 'checkbox' : 'radio'}
                                                name={multiple ? undefined : 'DataTable-selection'}
                                                checked={isSelected}
                                                disabled={props.disabled}
                                                aria-label={getString('DataTable_SelectRow').replace(
                                                    '{0}',
                                                    rowName,
                                                )}
                                                onChange={(): void => toggleRow(id)}
                                            />
                                        </td>
                                    )}

                                    {columns.map((column) => (
                                        <td key={column.name}>
                                            {/*
                                                The primary cell is a button so
                                                open-record is reachable by
                                                keyboard. A clickable <tr> alone
                                                is not.
                                            */}
                                            {primary && column.name === primary.name ? (
                                                <button
                                                    type="button"
                                                    className="DataTable-open"
                                                    title={getString('DataTable_OpenRecord').replace(
                                                        '{0}',
                                                        rowName,
                                                    )}
                                                    onClick={(event): void => {
                                                        event.stopPropagation();
                                                        props.onOpenRecord(id);
                                                    }}
                                                >
                                                    {record.getFormattedValue(column.name)}
                                                </button>
                                            ) : (
                                                record.getFormattedValue(column.name)
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="DataTable-pager">
                {/*
                  `hasPreviousPage` is deliberately not consulted. It stays
                  false after paging forward — the platform treats the load as
                  the range pages 1..N, which truthfully has nothing before it —
                  so trusting it left Previous permanently disabled with no way
                  back. The control's own page counter is what answers this.
                */}
                <button
                    type="button"
                    disabled={props.disabled || props.page <= 1}
                    onClick={props.onPreviousPage}
                >
                    {/* Chevron then label — decoration on a button that already
                        says what it does, so the name is unchanged. */}
                    <Chevron d={CHEVRON_PREVIOUS} />
                    {getString('DataTable_Previous')}
                </button>

                <span className="DataTable-pagerStatus" aria-live="polite">
                    {pagerLabel(
                        props.page,
                        props.pageSize,
                        pageIds.length,
                        dataset.paging.totalResultCount,
                        getString('DataTable_RangeStatus'),
                        getString('DataTable_PageStatus'),
                    )}
                </span>

                <button
                    type="button"
                    disabled={props.disabled || !dataset.paging.hasNextPage}
                    onClick={props.onNextPage}
                >
                    {/* Label then chevron: the glyph points the way the button
                        goes, so it trails rather than leads. */}
                    {getString('DataTable_Next')}
                    <Chevron d={CHEVRON_NEXT} />
                </button>

                {/*
                  Everything past here is a *tool*, not a way through the pages,
                  and it is separated for that reason. Previous / status / Next
                  are one control read left to right; a jump box, a page size and
                  an export dropped between them made the row read as five peers
                  and put Export where Next belongs. On a real form that was the
                  first thing anyone noticed.

                  The jump box is a number input rather than first/last chevron
                  buttons: the reader who wants page 7 of 40 wants 7, not
                  thirty-eight clicks, and the pager's chevron count is asserted
                  in `dev/smoke.js` against an `<img>` glyph that renders black
                  on a dark form — a check worth keeping meaningful rather than
                  re-baselining.
                */}
                <span className="DataTable-pagerTools">
                {props.lastPage > 1 && (
                    <span className="DataTable-jump">
                        <label>
                            {getString('DataTable_GoToPage')}
                            <input
                                type="number"
                                min={1}
                                max={props.lastPage}
                                value={props.page}
                                disabled={props.disabled}
                                onChange={(event): void => {
                                    const wanted = Number(event.target.value);

                                    // A cleared box is mid-edit, not page zero.
                                    if (Number.isFinite(wanted) && event.target.value !== '') {
                                        props.onGoToPage(wanted);
                                    }
                                }}
                            />
                        </label>
                        <span>{getString('DataTable_OfPages').replace('{0}', String(props.lastPage))}</span>
                    </span>
                )}

                {props.pageSizeOptions.length > 0 && (
                    <label className="DataTable-pageSize">
                        {getString('DataTable_RowsPerPage')}
                        <select
                            value={props.pageSize}
                            disabled={props.disabled}
                            onChange={(event): void => props.onPageSize(Number(event.target.value))}
                        >
                            {props.pageSizeOptions.map((size) => (
                                <option key={size} value={size}>
                                    {size}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {props.enableExport && (
                    <button
                        type="button"
                        className="DataTable-export"
                        disabled={props.disabled}
                        title={getString('DataTable_ExportHint')}
                        onClick={props.onExport}
                    >
                        <DownloadGlyph />
                        {getString('DataTable_Export')}
                    </button>
                )}
                </span>
            </div>
        </>,
    );
}
