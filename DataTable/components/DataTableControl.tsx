import * as React from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import {
    columnWidths,
    headerCheckState,
    pagerLabel,
    primaryColumn,
    SelectionMode,
} from './resolve';

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
    disabled: boolean;
    visible: boolean;
    isRTL: boolean;
    theme: Record<string, string> | undefined;
    getString: (id: string) => string;
    onSort: (columnName: string) => void;
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
    const checkState = headerCheckState(selected, pageIds);
    const headerRef = useIndeterminate(checkState);

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

    // `loading` is true on the first updateView, before any records arrive, so
    // rendering the empty state here would flash "No records" on every load.
    if (pageIds.length === 0) {
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
        const status = dataset.sorting.find((entry) => entry.name === column.name);

        if (!status) {
            return 'none';
        }

        return status.sortDirection === 1 ? 'descending' : 'ascending';
    };

    return frame(
        <>
            <div className={dataset.loading ? 'DataTable-scroll is-loading' : 'DataTable-scroll'}>
                <table className="DataTable-table">
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
                    </thead>

                    <tbody>
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
                <button
                    type="button"
                    disabled={props.disabled || !dataset.paging.hasPreviousPage}
                    onClick={props.onPreviousPage}
                >
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
                    {getString('DataTable_Next')}
                </button>
            </div>
        </>,
    );
}
