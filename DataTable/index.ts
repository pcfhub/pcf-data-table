import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { DataTableControl, IProps } from './components/DataTableControl';
import {
    ASCENDING,
    buildFilter,
    cellKey,
    clampPage,
    coerceValue,
    editableColumnSet,
    EditKind,
    editKindFor,
    lastPage,
    nextDirection,
    pageSizeChoices,
    pinPlan,
    SelectionMode,
    toCsv,
    toggleId,
    visibleColumns,
} from './components/resolve';

/**
 * The half of `EntityRecord` that the type definitions do not admit exists.
 *
 * `@types/powerapps-component-framework@1.3.18` declares four methods on
 * `EntityRecord` — `getFormattedValue`, `getRecordId`, `getValue`,
 * `getNamedReference` — and **none of them writes**. A live record on a real
 * model-driven subgrid carries twenty-three, measured 2026-09-09 against
 * `cll_account` on Dataverse online, including every method below.
 *
 * This is the inverse of the `fluentDesignLanguage` case in SPEC.md, where the
 * types turned out to be ahead of a comment claiming they lagged. The rule
 * covering both, and the one this file already applies to
 * `paging.loadExactPage`: **the typings are a claim about the type definitions,
 * not about the host.** So: a local interface, a cast, and a runtime detect
 * before anything is offered to a user.
 *
 * Why bother rather than using `webAPI.updateRecord`, which is typed and which
 * `pcf-kanban-board` already uses: that needs `<uses-feature name="WebAPI" />`,
 * an install-time permission prompt in every environment, and it does nothing
 * at all in a canvas app. This path needs neither. It is the reason this
 * control still declares no features.
 */
interface EditableRecord {
    setValue(columnName: string, value: unknown): Promise<unknown>;
    save(): Promise<unknown>;
    /**
     * **Async, and that is the trap.** So are `isSecured`, `isReadable` and
     * `getFieldRequiredLevel`, while `isValid` and
     * `getCurrencyDecimalPrecision` are not — and nothing distinguishes them by
     * name. An unawaited call returns a Promise, which is **truthy**, so
     * `if (record.isEditable(name))` is true for every column including the
     * ones that are not editable. A bug shaped like working code.
     */
    isEditable(columnName: string): Promise<boolean>;
}

/**
 * The record as something that can be written to, or `null`.
 *
 * Feature-detected on the two methods actually called. A host missing either
 * gets no editors at all rather than cells that accept keystrokes and discard
 * them — the same rule as `enableFiltering && Boolean(dataset.filtering)`.
 */
function editableRecord(record: unknown): EditableRecord | null {
    const candidate = record as EditableRecord | undefined;

    return candidate
        && typeof candidate.setValue === 'function'
        && typeof candidate.save === 'function'
        && typeof candidate.isEditable === 'function'
        ? candidate
        : null;
}

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

    /* --------------------------------------------------------------- editing */

    /**
     * What the platform said about each cell, keyed `recordId|column`.
     *
     * **Answered by the platform rather than inferred**, and that is the whole
     * shape of the feature. Column-level editability is not on `Column` — the
     * interface is name, displayName, dataType, alias, order, visualSizeFactor,
     * isHidden, isPrimary, disableSorting and nothing else — so the design this
     * replaced was going to offer an editor on every column of a writable type
     * and find out the truth when the save was refused. `isEditable(column)`
     * answers per column *and per record*: on the measured subgrid two columns
     * came back `true` and `statuscode` came back `false` on the same row.
     */
    private editableCells = new Map<string, boolean>();

    /**
     * Cells already asked about, whatever the answer.
     *
     * **This is what makes the resolution terminate.** Answering is a fetch, so
     * it lands after the render that needed it and has to ask for another one —
     * and a control that re-asked on every pass would notify, re-render, ask
     * again, forever. The set is finite and only grows, so the loop closes.
     */
    private editableAsked = new Set<string>();

    /** Answers still in flight. The last one home asks for the re-render. */
    private editablePending = 0;

    /** The cell with an editor open, if any. */
    private editing: { id: string; column: string } | null = null;

    /**
     * Values this control has asserted but the dataset has not confirmed.
     *
     * The optimistic override, per cell rather than per record. Retired when the
     * refreshed record agrees — **not** when `save()` resolves: a resolved save
     * means Dataverse accepted the write, not that the dataset has re-read it,
     * and clearing on resolve puts the old value back on screen for one frame.
     * `pcf-kanban-board` carries the same reconcile for a whole card.
     */
    private pendingValues = new Map<string, unknown>();

    /** Cells with a write in flight, so the editor can say so. */
    private savingCells = new Set<string>();

    /** The most recent refusal, shown against the cell that caused it. */
    private editFailure: { key: string; message: string } | null = null;

    /** The row most recently written, for `getOutputs`. */
    private editedRecordId = '';

    /**
     * The size the *reader* picked, which outranks the maker's property.
     *
     * `null` until they pick one, and that is what keeps the unset-property
     * path intact: with no property and no choice, this control still calls
     * `setPageSize` exactly zero times and leaves the host paging as it was.
     */
    private chosenPageSize: number | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
    ): void {
        // No container: a virtual control never receives one.
        this.notifyOutputChanged = notifyOutputChanged;

        /*
         * **Without this call the platform does not report `allocatedWidth` at
         * all**, and the pinning clamp in `pinPlan()` is dead code.
         *
         * Measured on a real Accounts subgrid, 2026-09-09, on the build that
         * shipped pinning: `mode.allocatedWidth` came back **-1**, alongside
         * `allocatedHeight: -1`. The clamp reads a non-positive width as "the
         * host did not measure" and pins as asked — which is the right answer
         * for `npm start` and exactly the wrong one for a phone subgrid, the
         * case the clamp exists for. So the feature was measured against a
         * number that a real form was never going to send.
         *
         * The rig missed it because `dev/host.js` answers `allocatedWidth` from
         * its `width` option whether or not anything asked, so a control that
         * never subscribes still reads a width there. That gap is now closed
         * with the `resizeUntracked` quirk.
         *
         * Feature-detected rather than called outright: `mode` is typed as
         * always carrying this method, and that is a claim about the type
         * definitions rather than about the host — the same reasoning
         * `goToPage` applies to `loadExactPage`.
         */
        if (typeof context.mode.trackContainerResize === 'function') {
            context.mode.trackContainerResize(true);
        }
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

        /*
         * `isControlDisabled` is part of the condition rather than checked in
         * the component: a disabled control must not offer an editor at all,
         * and asking the platform about editability for cells nobody can reach
         * is a fetch per cell bought for nothing.
         */
        const editingOn =
            (context.parameters.enableEditing.raw ?? false) && !context.mode.isControlDisabled;
        const allowedColumns = editableColumnSet(context.parameters.editableColumns.raw);

        if (editingOn) {
            // Order matters: retire what the refresh confirmed before deciding
            // what still needs asking about.
            this.reconcilePending(dataset);
            this.resolveEditability(dataset, columns, pageIds, allowedColumns);
        }

        const props: IProps = {
            dataset,
            columns,
            /*
             * Computed here rather than in the component because it is a
             * decision about the host — `mode.allocatedWidth` is the measurement
             * that decides whether pinning is affordable at all, and the
             * component never sees `context`. Everything else about the plan is
             * pure and lives in `resolve.ts`.
             */
            pins: pinPlan(
                columns,
                context.parameters.pinnedStart.raw,
                context.parameters.pinnedEnd.raw,
                context.mode.allocatedWidth,
                mode !== 'none',
            ),
            pageIds,
            selected: this.selected,
            selectionMode: mode,
            enableSorting: context.parameters.enableSorting.raw ?? true,
            openOnRowClick: context.parameters.openOnRowClick.raw ?? true,
            page: this.page,
            pageSize: this.appliedPageSize,
            filters: this.filters,
            lastPage: lastPage(dataset.paging.totalResultCount, this.appliedPageSize),
            /*
             * Empty unless the maker listed sizes, and the empty list is what
             * hides the picker — so the unset case stays exactly as it was.
             */
            pageSizeOptions: pageSizeChoices(
                context.parameters.pageSizeOptions.raw,
                this.appliedPageSize,
            ),
            /*
             * The row is offered only where it can work. `dataset.filtering` is
             * typed as always present and is not, and a filter box that accepts
             * keystrokes and changes nothing is worse than no box at all.
             */
            enableFiltering: (context.parameters.enableFiltering.raw ?? true) && Boolean(dataset.filtering),
            enableExport: context.parameters.enableExport.raw ?? false,
            disabled: context.mode.isControlDisabled,
            visible: context.mode.isVisible,
            isRTL: context.userSettings.isRTL,
            theme: context.fluentDesignLanguage?.tokenTheme,
            getString: (id: string): string => context.resources.getString(id),
            onSort: (columnName: string): void => this.sortBy(dataset, columnName),
            onFilter: (columnName: string, value: string): void =>
                this.setFilterValue(context, columnName, value),
            onClearFilter: (columnName: string): void => this.clearFilterValue(context, columnName),
            onClearFilters: (): void => this.clearFilters(context),
            onGoToPage: (page: number): void => this.goToPage(dataset, page),
            onPageSize: (size: number): void => this.choosePageSize(context, size),
            onExport: (): void => this.exportCsv(context, dataset),
            onNextPage: (): void => this.nextPage(dataset),
            onPreviousPage: (): void => this.previousPage(dataset),
            onToggleRow: (id: string): void => this.toggleRow(dataset, id, mode),
            onToggleAll: (ids: string[], selectAll: boolean): void =>
                this.toggleAll(dataset, ids, selectAll),
            onOpenRecord: (id: string): void => this.openRecord(dataset, id),

            enableEditing: editingOn,
            allowedColumns,
            editableCells: this.editableCells,
            editing: this.editing,
            pendingValues: this.pendingValues,
            savingCells: this.savingCells,
            editFailure: this.editFailure,
            onBeginEdit: (id: string, column: string): void => {
                this.editing = { id, column };
                // The failure belonged to the last attempt. Reopening the cell
                // is the user answering it, so it goes rather than sitting
                // above an editor that has not been used yet.
                this.editFailure = null;
                this.notifyOutputChanged();
            },
            onCancelEdit: (): void => {
                this.editing = null;
                this.notifyOutputChanged();
            },
            onCommitEdit: (id: string, column: string, kind: EditKind, typed: string): void =>
                this.commitEdit(context, id, column, kind, typed),
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
            editedRecordId: this.editedRecordId,
        };
    }

    /**
     * Ask the platform which of the cells on screen this user may write.
     *
     * **Three things about this are load-bearing.**
     *
     * `isEditable` is **async**, so this is a fetch rather than a read and
     * cannot happen during render. Until an answer lands the cell renders
     * read-only, because declining to offer an editor is always safe and
     * offering one the platform then refuses is not.
     *
     * `editableAsked` is what makes it terminate. The last answer home calls
     * `notifyOutputChanged()` to get the re-render that shows the editors, and
     * that re-render runs `updateView` again — so a version that re-asked would
     * notify forever. The set only grows, so the second pass asks nothing and
     * the loop closes.
     *
     * The maker's `editableColumns` list is applied **before** asking, not
     * after. It narrows what is offered; it cannot widen it. A column the
     * platform reports as read-only stays read-only however it is listed.
     */
    private resolveEditability(
        dataset: DataSet,
        columns: ComponentFramework.PropertyHelper.DataSetApi.Column[],
        pageIds: string[],
        allowed: Set<string> | null,
    ): void {
        const candidates = columns.filter(
            (column) =>
                editKindFor(column) !== 'none' && (allowed === null || allowed.has(column.name)),
        );

        if (candidates.length === 0) {
            return;
        }

        pageIds.forEach((id) => {
            const record = editableRecord(dataset.records[id]);

            if (!record) {
                return;
            }

            candidates.forEach((column) => {
                const key = cellKey(id, column.name);

                if (this.editableAsked.has(key)) {
                    return;
                }

                this.editableAsked.add(key);
                this.editablePending += 1;

                Promise.resolve(record.isEditable(column.name))
                    // `=== true` rather than truthiness: this is the method
                    // whose unawaited Promise is truthy, and a `.then` that
                    // accepted anything truthy would repeat the same mistake
                    // one layer down.
                    .then((value) => this.editableCells.set(key, value === true))
                    .catch(() => this.editableCells.set(key, false))
                    .then(() => {
                        this.editablePending -= 1;

                        if (this.editablePending === 0) {
                            this.notifyOutputChanged();
                        }
                    });
            });
        });
    }

    /**
     * Retire optimistic values the dataset has caught up with.
     *
     * Two exits, and the second is the one that stops this map growing for the
     * lifetime of the control: the refreshed record agrees, or the record has
     * left the view — which is what a filtered view does the moment an edit
     * stops matching the filter.
     *
     * Compared as strings because `getValue` returns whatever the column holds
     * — a `Date`, a number, a boolean — and the value written came from an
     * `<input>`. Equality of *rendered* value is the question being asked here.
     */
    private reconcilePending(dataset: DataSet): void {
        this.pendingValues.forEach((value, key) => {
            const separator = key.lastIndexOf('|');
            const id = key.slice(0, separator);
            const column = key.slice(separator + 1);
            const record = dataset.records[id];

            if (!record) {
                this.pendingValues.delete(key);

                return;
            }

            // Still in flight: the dataset cannot have caught up with a write
            // that has not been made yet, and deleting here would flash the old
            // value back under the user's cursor.
            if (this.savingCells.has(key)) {
                return;
            }

            if (String(record.getValue(column) ?? '') === String(value ?? '')) {
                this.pendingValues.delete(key);
            }
        });
    }

    /**
     * Write one cell.
     *
     * `setValue` then `save`, both on the record — no `webAPI`, so no
     * `<uses-feature>` and no install-time prompt, and it works on a host where
     * WebAPI does not exist at all.
     *
     * The refusal path is the reason this control catches at all, so it is
     * written first: a rejected write puts the old value back and names the
     * failure against the cell. A silent rollback is worse than none — the user
     * sees their edit disappear and has no idea whether it saved.
     */
    private commitEdit(
        context: ComponentFramework.Context<IInputs>,
        id: string,
        column: string,
        kind: EditKind,
        typed: string,
    ): void {
        const dataset = context.parameters.records;
        const record = editableRecord(dataset.records[id]);
        const key = cellKey(id, column);

        this.editing = null;

        if (!record) {
            this.notifyOutputChanged();

            return;
        }

        const coerced = coerceValue(kind, typed);

        /*
         * A half-typed number writes nothing, on the same argument
         * `numericCondition` makes for a half-typed filter: `NaN` is a wrong
         * answer that looks like a finished one. It is reported rather than
         * swallowed, because a cell that silently reverts reads as a broken
         * control.
         */
        if (!coerced.ok) {
            this.editFailure = {
                key,
                message: context.resources.getString('DataTable_NotANumber'),
            };
            this.notifyOutputChanged();

            return;
        }

        this.editFailure = null;
        this.pendingValues.set(key, coerced.value);
        this.savingCells.add(key);
        this.notifyOutputChanged();

        record
            .setValue(column, coerced.value)
            .then(() => record.save())
            .then(() => {
                this.savingCells.delete(key);
                this.editedRecordId = id;
                // The override stays until `reconcilePending` sees the dataset
                // agree. A resolved save is Dataverse accepting the write, not
                // the dataset having re-read it.
                this.notifyOutputChanged();
            })
            .catch((error: unknown) => {
                this.savingCells.delete(key);
                this.pendingValues.delete(key);
                this.editFailure = {
                    key,
                    /*
                     * A rejected platform call is typed `unknown` and is not
                     * reliably an `Error` — the same caveat `pcf-kanban-board`
                     * records. `UciError: Invalid snapshot with id undefined`
                     * arrives here when the column name is wrong, and it names
                     * neither the column nor the record, so the control's own
                     * sentence has to carry that.
                     */
                    message:
                        (error as Error)?.message
                        || context.resources.getString('DataTable_SaveFailedGeneric'),
                };
                this.notifyOutputChanged();
            });
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
        // The reader's choice outranks the maker's property, and the property
        // outranks the host — but only once one of them has actually spoken.
        const raw = this.chosenPageSize ?? context.parameters.pageSize.raw;

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

        const previous = this.appliedPageSize;

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);

        /*
         * **Repaginating makes "page 4" mean something else**, so the reader
         * goes back to the first page — the same move `sortBy` makes, and for
         * the same reason. Any change to the shape of the result set — a sort,
         * a filter, a page size — resets the page.
         *
         * **Only when it changed, though.** `previous` is 0 until a size has
         * been applied, and at mount the platform is already on page one, so
         * resetting there is a round trip bought for nothing: `reset()` is a
         * fetch in its own right and the `refresh()` below is a second one.
         *
         * Left out entirely at first, and close to unfalsifiable while the size
         * comes only from a manifest property: a property changes once, at
         * configuration time, almost always while the reader is on page one.
         * `pcf-data-table` 0.2.0 made it reachable with a rows-per-page picker,
         * and asked for page 3 of a result set that had just been recut.
         */
        if (previous > 0) {
            this.page = 1;
            dataset.paging.reset();
        }

        dataset.refresh();
    }

    /**
     * Write the rows this control is holding to a CSV file.
     *
     * **It exports what has been loaded, not the whole view, and the button
     * says so.** The dataset holds the pages fetched so far; reaching the rest
     * means raising the page size, looping `loadExactPage` and reassembling —
     * an async state machine on top of a lifecycle that re-enters `updateView`
     * on every fetch. That is worth doing and is not worth doing quietly, so it
     * is not in this release. An export that silently covers one page of a
     * 240-row view is the same failure as a client-side sort: a wrong answer
     * that looks completely right.
     *
     * Values come from `getFormattedValue`, which is what the cells render, so
     * the file matches what the reader was looking at rather than the raw
     * values underneath it.
     */
    private exportCsv(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const columns = visibleColumns(dataset.columns ?? []);
        const ids = dataset.sortedRecordIds ?? [];

        const rows = ids
            .map((id) => dataset.records[id])
            .filter((record) => Boolean(record))
            .map((record) => columns.map((column) => record.getFormattedValue(column.name) ?? ''));

        const csv = toCsv(
            columns.map((column) => column.displayName),
            rows,
        );

        const name = `${dataset.getTitle() || 'records'}.csv`;

        /*
         * **Two mechanisms, because a model-driven form is an iframe this
         * control does not own.** Whether a browser download works is a
         * property of the host's sandbox and Permissions-Policy rather than of
         * this code — the same reasoning `pcf-copy-field` carries for the
         * clipboard.
         *
         * `navigation.openFile` first, where it exists. It needs no
         * `<feature-usage>`: it is a method on `context.navigation`, which is
         * not gated — so this control still declares no features and still
         * installs without a permission prompt.
         *
         * Feature-detect the *method*, not the bag: `context.navigation` is
         * present on every host, and `openFile` is documented model-driven
         * only. Checking the bag would pass on canvas and throw.
         */
        if (typeof context.navigation?.openFile === 'function') {
            context.navigation.openFile(
                {
                    // Base64 with no `data:` prefix, and `unescape`/`encodeURIComponent`
                    // rather than a bare `btoa`, which throws on any character
                    // above U+00FF — the fixture's `école` is one.
                    fileContent: btoa(unescape(encodeURIComponent(csv))),
                    fileName: name,
                    // KB, not bytes. `FileObject.fileSize` is the one field of
                    // that interface that reads like it means something else.
                    fileSize: Math.ceil(csv.length / 1024),
                    mimeType: 'text/csv',
                },
                // 2 is Save. 1 is Open, which for a CSV means the host may hand
                // it to a viewer — so a button saying Export would do something
                // else. Omitting the options object entirely defaults to Open.
                { openMode: 2 },
            );

            return;
        }

        this.downloadInBrowser(csv, name);
    }

    /** The fallback: a Blob and a synthetic link, for hosts without `openFile`. */
    private downloadInBrowser(csv: string, name: string): void {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');

        link.href = url;
        link.download = name;
        link.click();

        // The object URL pins the blob in memory until it is revoked, and this
        // control can be mounted for as long as the form is open.
        URL.revokeObjectURL(url);
    }

    /** Adopt a page size the reader picked from the pager. */
    private choosePageSize(context: ComponentFramework.Context<IInputs>, size: number): void {
        this.chosenPageSize = size;
        this.applyPageSize(context, context.parameters.records);
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

    /**
     * Empty one filter box and ask for the result straight away.
     *
     * Separate from `setFilterValue` because it is not typing: pressing a clear
     * button is a finished decision, and holding it for the debounce makes the
     * button feel broken for a third of a second. `pcf-view-filter` treats its
     * own Clear the same way.
     */
    private clearFilterValue(
        context: ComponentFramework.Context<IInputs>,
        columnName: string,
    ): void {
        if (this.filterTimer !== null) {
            window.clearTimeout(this.filterTimer);
            this.filterTimer = null;
        }

        this.filters = { ...this.filters, [columnName]: '' };
        this.applyFilter(context);
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
        const last = lastPage(dataset.paging.totalResultCount, this.appliedPageSize);
        const wanted = clampPage(target, last);
        const back = wanted < this.page;

        if (typeof dataset.paging.loadExactPage === 'function') {
            this.page = wanted;
            dataset.paging.loadExactPage(this.page);

            return;
        }

        /*
         * **The host without `loadExactPage` can only step one page**, and
         * that gap was unreachable while the pager moved by one: a jump from
         * page 1 to page 7 called `loadNextPage` once, landed on page 2, and
         * left `this.page` claiming 7 — a pager reading "page 7" over page 2's
         * rows, which is worse than refusing.
         *
         * So a multi-page jump is refused here rather than half-performed.
         * Looping the call would be the other answer and is not obviously
         * right: each step is a round trip, `loadNextPage(true)` accumulates
         * the whole range on the platform that ignores its argument, and
         * nothing has watched what that does past page two on a real form.
         * Refusing is the honest version until it has.
         */
        if (Math.abs(wanted - this.page) !== 1) {
            return;
        }

        this.page = wanted;

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
