import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { DataTableControl, IProps } from './components/DataTableControl';
import { ASCENDING, nextDirection, SelectionMode, toggleId, visibleColumns } from './components/resolve';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type SortDirection = ComponentFramework.PropertyHelper.DataSetApi.Types.SortDirection;

/** The platform's ceiling on a page. Not in the type definitions; see SPEC.md. */
const MAX_PAGE_SIZE = 250;

/**
 * A virtual (React) dataset control.
 *
 * Everything that talks to the platform lives in this file. The component below
 * it never sees `context` or the dataset — every call arrives there as a
 * callback prop. That is not tidiness for its own sake: it keeps the whole
 * platform surface in one file that can be read against the type definitions in
 * a single pass, which is the only way to be sure about an API this narrow.
 *
 * The rule the rest of this class is shaped by: **`updateView` runs on every
 * change to any bound value, including the ones this control caused itself.**
 * A dataset control has mutators — `setPageSize`, `refresh`, `loadNextPage` —
 * and calling any of them unguarded from `updateView` is an infinite loop, not
 * a slow render.
 */
export class DataTable implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged!: () => void;

    /**
     * The control's own copy of the selection, and the source of truth for
     * `getOutputs()`.
     *
     * The platform's copy (`getSelectedRecordIds()`) does not survive a refresh
     * or a page change, so it cannot be the record of what the user ticked.
     * Selection deliberately persists across page changes here: ids are stable,
     * and a user who ticks three rows on page 1 and pages forward has not
     * changed their mind about them.
     */
    private selected: string[] = [];

    private openedRecordId = '';

    /**
     * The page size this control has already asked the platform for.
     *
     * Guarding on this rather than on `ds.paging.pageSize` is the whole trick:
     * the platform's own `pageSize` will not equal the requested value until the
     * refresh lands, so comparing against it re-fires at least once more — and
     * if the platform clamps the value, forever.
     */
    private appliedPageSize = 0;

    /** Our own page counter, for hosts where `firstPageNumber` is not usable. */
    private page = 1;

    public init(
        _context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
    ): void {
        // No container: a virtual control never receives one.
        this.notifyOutputChanged = notifyOutputChanged;
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const dataset = context.parameters.records;
        const mode = (context.parameters.selectionMode.raw ?? 'single') as SelectionMode;

        this.applyPageSize(context, dataset);

        if (mode === 'none' && this.selected.length > 0) {
            this.selected = [];
            dataset.clearSelectedRecordIds();
            this.notifyOutputChanged();
        }

        const columns = visibleColumns(dataset.columns ?? []);
        const pageIds = dataset.sortedRecordIds ?? [];

        const props: IProps = {
            dataset,
            columns,
            pageIds,
            selected: this.selected,
            selectionMode: mode,
            enableSorting: context.parameters.enableSorting.raw ?? true,
            openOnRowClick: context.parameters.openOnRowClick.raw ?? true,
            page: this.currentPage(dataset),
            pageSize: this.appliedPageSize,
            disabled: context.mode.isControlDisabled,
            visible: context.mode.isVisible,
            isRTL: context.userSettings.isRTL,
            theme: context.fluentDesignLanguage?.tokenTheme,
            getString: (id: string): string => context.resources.getString(id),
            onSort: (columnName: string): void => this.sortBy(dataset, columnName),
            onNextPage: (): void => this.nextPage(dataset),
            onPreviousPage: (): void => this.previousPage(dataset),
            onToggleRow: (id: string): void => this.toggleRow(dataset, id, mode),
            onToggleAll: (ids: string[], selectAll: boolean): void =>
                this.toggleAll(dataset, ids, selectAll),
            onOpenRecord: (id: string): void => this.openRecord(dataset, id),
        };

        return React.createElement(DataTableControl, props);
    }

    /**
     * `getOutputs` returns every output property, and the generated types make
     * each one optional — so returning `undefined` means "no change", not
     * "empty". Emit the empty string rather than nothing at all, or a form can
     * never observe the selection being cleared.
     *
     * One id per line rather than comma-joined: a GUID contains no newline, so
     * the split is unambiguous, and a canvas app can `Split(…, Char(10))`.
     */
    public getOutputs(): IOutputs {
        return {
            selectedRecordIds: this.selected.join('\n'),
            openedRecordId: this.openedRecordId,
        };
    }

    public destroy(): void {
        // The platform unmounts the React tree for a virtual control, and this
        // control holds no listeners, timers or observers of its own.
    }

    /**
     * Ask for a new page size, but only when it actually changed.
     *
     * `setPageSize()` does nothing until the next fetch, so it has to be
     * followed by `refresh()` — and `refresh()` fires `updateView`. Without the
     * guard this is: updateView → setPageSize → refresh → updateView → forever.
     */
    private applyPageSize(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const raw = context.parameters.pageSize.raw ?? 25;
        const wanted = Math.min(Math.max(Math.trunc(raw), 1), MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);
        dataset.refresh();
    }

    /**
     * Prefer the platform's own page number when it looks usable.
     *
     * With `loadNextPage(true)` the loaded range is a single page, so
     * `firstPageNumber` should be the current page — but that is an inference
     * from the naming, not something the type definitions promise, so the local
     * counter is the fallback rather than the other way round.
     */
    private currentPage(dataset: DataSet): number {
        const first = dataset.paging.firstPageNumber;

        return typeof first === 'number' && first >= 1 ? first : this.page;
    }

    /**
     * Sorting is server-side, applied across every page.
     *
     * That is the entire reason not to sort in the browser: a client-side sort
     * reorders the rows on screen — 25 out of 240 — which is a wrong answer that
     * looks completely right.
     *
     * `dataset.sorting` is an array you mutate in place, and it is the whole
     * ORDER BY. Replacing rather than appending is what keeps three clicks from
     * building a three-deep sort nobody asked for.
     */
    private sortBy(dataset: DataSet, columnName: string): void {
        const current = dataset.sorting.find((status) => status.name === columnName);
        const direction: SortDirection = current
            ? nextDirection(current.sortDirection)
            : ASCENDING;

        dataset.sorting.length = 0;
        dataset.sorting.push({ name: columnName, sortDirection: direction });

        // A new order makes "page 4" meaningless.
        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /**
     * `loadNextPage()` with no argument is infinite scroll, not paging: the type
     * definition says it "returns results for the whole page range", so the
     * dataset accumulates pages 1..N in `sortedRecordIds` and the table grows
     * instead of turning. `true` limits it to the newly loaded page.
     */
    private nextPage(dataset: DataSet): void {
        if (!dataset.paging.hasNextPage) {
            return;
        }

        this.page += 1;
        dataset.paging.loadNextPage(true);
    }

    private previousPage(dataset: DataSet): void {
        if (!dataset.paging.hasPreviousPage) {
            return;
        }

        this.page = Math.max(1, this.page - 1);
        dataset.paging.loadPreviousPage(true);
    }

    private toggleRow(dataset: DataSet, id: string, mode: SelectionMode): void {
        this.selected = toggleId(this.selected, id, mode);
        this.commitSelection(dataset);
    }

    private toggleAll(dataset: DataSet, ids: string[], selectAll: boolean): void {
        this.selected = selectAll
            ? [...new Set([...this.selected, ...ids])]
            : this.selected.filter((id) => !ids.includes(id));

        this.commitSelection(dataset);
    }

    /**
     * `setSelectedRecordIds` is not bookkeeping.
     *
     * On a model-driven subgrid it is how this control tells the form's command
     * bar which records the ribbon buttons should act on — so it is called on
     * every change even though the control keeps its own copy for `getOutputs`.
     */
    private commitSelection(dataset: DataSet): void {
        dataset.setSelectedRecordIds(this.selected);
        this.notifyOutputChanged();
    }

    /**
     * Notify before opening, so the output is observable even on a host where
     * `openDatasetItem` does nothing — which is the canvas case.
     *
     * `openDatasetItem` takes an EntityReference, and `getNamedReference()` is
     * the only way to build one; there is no id-based overload.
     */
    private openRecord(dataset: DataSet, id: string): void {
        const record = dataset.records[id];

        if (!record) {
            return;
        }

        this.openedRecordId = id;
        this.notifyOutputChanged();
        dataset.openDatasetItem(record.getNamedReference());
    }
}
