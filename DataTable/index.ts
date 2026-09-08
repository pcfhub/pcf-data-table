import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { DataTableControl, IProps } from './components/DataTableControl';
import {
    ASCENDING,
    buildFilter,
    nextDirection,
    SelectionMode,
    toggleId,
    visibleColumns,
} from './components/resolve';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type SortDirection = ComponentFramework.PropertyHelper.DataSetApi.Types.SortDirection;

/** The platform's ceiling on a page. Not in the type definitions; see SPEC.md. */
const MAX_PAGE_SIZE = 250;

/**
 * How long to wait after the last keystroke before filtering.
 *
 * Each application is a server round trip, so this is not a rendering
 * optimisation — it is the difference between one query and one per character.
 */
const FILTER_DEBOUNCE_MS = 300;

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

    /**
     * The page number. Not "a fallback for `firstPageNumber`" — the only
     * source. `firstPageNumber` is not read anywhere in this control; see
     * `pageIds()` for why.
     */
    private page = 1;

    /**
     * What is typed in the filter row, by column name.
     *
     * The control's own copy, for the same reason `selected` is: the platform's
     * `filtering.getFilter()` is `undefined` in the local rigs and is an
     * expression rather than the text a box should show even when it is not.
     * Round-tripping the UI through it would mean parsing back out what was
     * just built.
     */
    private filters: Record<string, string> = {};

    /**
     * The filter expression last handed to the platform, serialised.
     *
     * **Starts at `'none'` rather than at `''`, and that is the initial state
     * rather than a sentinel** — a view arrives unfiltered, so "no filter" is
     * already what the platform is doing. Starting from `''` makes the first
     * keystroke of every session clear a filter nobody set: a `clearFilter`, a
     * `paging.reset()` and a full round trip before the user has typed enough
     * to match anything.
     */
    private appliedFilter = 'none';

    /** The debounce timer, cleared in `destroy()`. */
    private filterTimer: number | null = null;

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
        const pageIds = this.pageIds(dataset);

        const props: IProps = {
            dataset,
            columns,
            pageIds,
            selected: this.selected,
            selectionMode: mode,
            enableSorting: context.parameters.enableSorting.raw ?? true,
            openOnRowClick: context.parameters.openOnRowClick.raw ?? true,
            page: this.page,
            pageSize: this.appliedPageSize,
            filters: this.filters,
            /*
             * The row is offered only where it can work. `dataset.filtering` is
             * typed as always present and is not, and a filter box that accepts
             * keystrokes and changes nothing is worse than no box at all.
             */
            enableFiltering: (context.parameters.enableFiltering.raw ?? true) && Boolean(dataset.filtering),
            disabled: context.mode.isControlDisabled,
            visible: context.mode.isVisible,
            isRTL: context.userSettings.isRTL,
            theme: context.fluentDesignLanguage?.tokenTheme,
            getString: (id: string): string => context.resources.getString(id),
            onSort: (columnName: string): void => this.sortBy(dataset, columnName),
            onFilter: (columnName: string, value: string): void =>
                this.setFilterValue(context, columnName, value),
            onClearFilters: (): void => this.clearFilters(context),
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
        /*
         * The platform unmounts the React tree for a virtual control, but the
         * filter debounce is this control's own and outlives it. Left running
         * it fires against a dataset the platform has already released — and on
         * a form the user is navigating between records, that is every
         * navigation.
         */
        if (this.filterTimer !== null) {
            window.clearTimeout(this.filterTimer);
            this.filterTimer = null;
        }
    }

    /**
     * Ask for a new page size, but only when it actually changed.
     *
     * `setPageSize()` does nothing until the next fetch, so it has to be
     * followed by `refresh()` — and `refresh()` fires `updateView`. Without the
     * guard this is: updateView → setPageSize → refresh → updateView → forever.
     */
    private applyPageSize(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const raw = context.parameters.pageSize.raw;

        /*
         * **The platform already has a page size, and it is usually the right
         * one.** `paging.pageSize` is the size the host is actually retrieving
         * with — a main grid's *Rows per page* personalisation, a subgrid's
         * form-designer setting, the canvas default.
         *
         * So the property carries no `default-value`, and this is the half of
         * that decision written in code: unset, adopt what the host is doing and
         * **never call `setPageSize` at all**; set, override. Adopting still
         * records the number, because the page slice and the pager label both
         * need to know how big a page is — reading it is not the same as asking
         * for it. See the manifest for why the default was removed.
         */
        if (raw === null || raw === undefined) {
            // `0` is "the host did not say", not "one row per page". A fallback
            // of `1` is a page size the platform never has, and the slice would
            // cut the view down to it — twenty rows arriving and one drawn.
            this.appliedPageSize = dataset.paging.pageSize > 0 ? dataset.paging.pageSize : 0;

            return;
        }

        const wanted = Math.min(Math.max(Math.trunc(raw), 1), MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);
        dataset.refresh();
    }

    /**
     * The records belonging to the page the pager says it is on.
     *
     * **Slicing `sortedRecordIds` is the thing a dataset control is told never
     * to do**, because on a platform that honours `loadOnlyNewPage` that array
     * already *is* the current page and slicing hides records the platform
     * paged for.
     *
     * The flag is not honoured. Observed on a real model-driven form,
     * 2026-08-21, against `pcf-compact-list`: `loadNextPage(true)` from page 1
     * of a 6-record view at page size 3 returned all six ids and page 2
     * rendered under page 1. This control makes the identical call and has the
     * identical bug; it was found in the list first only because that is where
     * somebody looked.
     *
     * So the slice is a repair for one specific platform behaviour, guarded so
     * that it removes itself: an array no longer than a page already is the
     * page. Slicing by page offset rather than by tail keeps it right going
     * backwards.
     */
    private pageIds(dataset: DataSet): string[] {
        const ids = dataset.sortedRecordIds ?? [];

        // `0` is "the host reported no page size" — see `applyPageSize`.
        // There is no page to cut to, so draw everything that arrived.
        if (this.appliedPageSize <= 0 || ids.length <= this.appliedPageSize) {
            return ids;
        }

        const start = (this.page - 1) * this.appliedPageSize;
        const slice = ids.slice(start, start + this.appliedPageSize);

        // Never empty the table: a wrong page is recoverable by clicking, an
        // empty one looks like data loss.
        return slice.length > 0 ? slice : ids.slice(-this.appliedPageSize);
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
        const sorting = dataset.sorting;

        /*
         * Typed as required, absent on `npm start`.
         *
         * The order has to be expressed by mutating this array in place, so
         * with no array there is nothing to express it through — and the local
         * harness cannot sort anyway. Decline rather than throw: a click that
         * does nothing there is a great deal better than a control that
         * disappears.
         */
        if (!sorting) {
            return;
        }

        const current = sorting.find((status) => status.name === columnName);
        const direction: SortDirection = current
            ? nextDirection(current.sortDirection)
            : ASCENDING;

        sorting.length = 0;
        sorting.push({ name: columnName, sortDirection: direction });

        // A new order makes "page 4" meaningless.
        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /**
     * Record what was typed in one filter box, then ask for the result.
     *
     * Debounced, because this runs on every keystroke and each application is a
     * round trip. Called only from the component's callback — never from
     * `updateView`, which `applyFilter` would re-enter.
     */
    private setFilterValue(
        context: ComponentFramework.Context<IInputs>,
        columnName: string,
        value: string,
    ): void {
        this.filters = { ...this.filters, [columnName]: value };

        if (this.filterTimer !== null) {
            window.clearTimeout(this.filterTimer);
        }

        this.filterTimer = window.setTimeout(() => {
            this.filterTimer = null;
            this.applyFilter(context);
        }, FILTER_DEBOUNCE_MS);
    }

    /** Drop every filter and ask for the unfiltered view, with no debounce. */
    private clearFilters(context: ComponentFramework.Context<IInputs>): void {
        if (this.filterTimer !== null) {
            window.clearTimeout(this.filterTimer);
            this.filterTimer = null;
        }

        this.filters = {};
        this.applyFilter(context);
    }

    /**
     * Hand the filter to the platform, reset the page, ask for the data.
     *
     * The same five moves as `sortBy`, in the same order and for the same
     * reasons, plus one that sorting does not need:
     *
     *  1. **`setFilter` is not a fetch.** It records an expression and nothing
     *     moves until `refresh()`. A control that omits the refresh looks
     *     exactly like one whose filter matched nothing.
     *  2. **`refresh()` fires `updateView`**, so re-applying an expression the
     *     platform is already filtering by refreshes again, and again. The
     *     signature comparison below is what makes that terminate; without it
     *     this is an unbounded loop, which a browser shows as a hang.
     *  3. **Filtering does not reset the page**, and the platform will not do
     *     it. Filter from page three and the control asks for page three of a
     *     result set that may have one page in it, and what comes back is
     *     nothing at all — which reads as "no matches" for a term with plenty.
     */
    private applyFilter(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;
        const filtering = dataset.filtering;

        /*
         * Typed as always present, which is a claim about the type definitions
         * rather than about the host — so it is checked rather than trusted,
         * exactly as `sorting` is in `sortBy`. With no filtering there is
         * nothing to express a filter through, and the row is not rendered at
         * all; this guard covers the host that removes it between renders.
         */
        if (!filtering) {
            return;
        }

        const expression = buildFilter(this.filters, visibleColumns(dataset.columns ?? []));
        const signature = expression === null ? 'none' : JSON.stringify(expression);

        if (signature === this.appliedFilter) {
            return;
        }

        this.appliedFilter = signature;

        if (expression === null) {
            filtering.clearFilter();
        } else {
            filtering.setFilter(expression);
        }

        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /**
     * Turn to an absolute page.
     *
     * `loadNextPage(true)` is supposed to limit the result to the newly loaded
     * page and does not — see `pageIds()`. `loadExactPage` says what a pager
     * means and is the documented fallback, so it is preferred where the host
     * has it. It is typed as required and feature-detected anyway: a required
     * member is a claim about the type definitions, not about the host, which
     * is exactly the claim that failed here.
     *
     * Either way `pageIds()` decides what renders, so the table turns whether
     * or not the call underneath honours the request.
     */
    private goToPage(dataset: DataSet, target: number): void {
        const back = target < this.page;

        this.page = Math.max(1, target);

        if (typeof dataset.paging.loadExactPage === 'function') {
            dataset.paging.loadExactPage(this.page);
            return;
        }

        if (back) {
            dataset.paging.loadPreviousPage(true);
        } else {
            dataset.paging.loadNextPage(true);
        }
    }

    private nextPage(dataset: DataSet): void {
        // `hasNextPage` has behaved, and a local counter cannot answer
        // "is there more" on its own.
        if (!dataset.paging.hasNextPage) {
            return;
        }

        this.goToPage(dataset, this.page + 1);
    }

    /**
     * `hasPreviousPage` is not consulted, because it stays false after paging
     * forward: the platform treats the load as the range pages 1..N, which
     * truthfully has nothing before it. Trusting it left Previous permanently
     * disabled with no way back.
     */
    private previousPage(dataset: DataSet): void {
        if (this.page <= 1) {
            return;
        }

        this.goToPage(dataset, this.page - 1);
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
