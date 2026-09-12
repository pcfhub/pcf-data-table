import * as React from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import {
    cellKey,
    coerceValue,
    columnWidths,
    DateOp,
    DESCENDING,
    EditKind,
    editKindFor,
    editorValue,
    filterKindFor,
    headerCheckState,
    nextDateOp,
    Option,
    pagerLabel,
    pendingText,
    PinnedColumn,
    PinPlan,
    primaryColumn,
    sameValue,
    SelectionMode,
    tableMinWidth,
} from './resolve';

/** A pencil, on the same 20×20 grid as the chevrons. */
const PENCIL_GLYPH = 'M4 16v-3l8-8 3 3-8 8H4zM12.5 4.5l3 3';

/**
 * The edit affordance.
 *
 * Inline `<svg>` inheriting the button's `color`, for the reason the chevrons
 * are: an icon behind `<img src>` renders in an isolated document that cannot
 * read this stylesheet, so its `currentColor` resolves to black and a dark form
 * gets a black glyph on a dark ground. `pcf-file-drop` shipped exactly that.
 */
function PencilGlyph(): React.ReactElement {
    return (
        <svg className="DataTable-pencil" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
                d={PENCIL_GLYPH}
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
 * One open cell editor.
 *
 * **Its own component so it can hold the typed value in its own state**, which
 * matters more here than it looks: the control's `updateView` re-renders this
 * whole table on every platform pass, and a value living in the parent would be
 * re-derived from the record on each one — so a save landing elsewhere, or the
 * editability of another cell resolving, would wipe out what the user was
 * halfway through typing. Mounted only while a cell is being edited, so the
 * state starts fresh and dies with the editor.
 *
 * Commit on blur, Enter and Tab; revert on Escape. Escape has to call
 * `onCancel` before the blur handler sees it, which is why the flag exists —
 * without it, pressing Escape blurs the input and commits the value it was
 * cancelling.
 */
function CellEditor(props: {
    kind: EditKind;
    initial: string;
    label: string;
    /** The choice column's options; ignored by every other kind. */
    options: Option[];
    /** The three words a `<select>` needs and an `<input>` does not. */
    strings: { yes: string; no: string; none: string };
    onCommit: (typed: string) => void;
    onCancel: () => void;
}): React.ReactElement {
    const [value, setValue] = React.useState(props.initial);
    const cancelled = React.useRef(false);
    const ref = React.useRef<HTMLInputElement & HTMLSelectElement>(null);

    React.useEffect(() => {
        if (ref.current) {
            ref.current.focus();

            if (typeof ref.current.select === 'function') {
                ref.current.select();
            }
        }
    }, []);

    /**
     * Leaving the editor.
     *
     * **An untouched editor closes without writing**, and that is a fix rather
     * than an optimisation. Committing an unchanged value calls `setValue` with
     * what the record already holds, which stages nothing — and `save()` with
     * nothing staged throws `UciError: Invalid snapshot with id undefined`. So
     * opening a cell, changing your mind and clicking away produced a red error
     * under a cell nobody had edited, observed on a real subgrid 2026-09-09.
     *
     * That error string is the same one a wrong column name produces, which is
     * worth knowing: it means "there is no pending change to save", and a bad
     * column name is only one way to have none.
     *
     * Compared as the strings the editor holds rather than as coerced values.
     * `props.initial` is what `editorValue` put in the box, so the comparison is
     * exactly "did the user alter what they were shown" — no type coercion, no
     * `20` versus `20.00` argument, and nothing to get wrong per column type.
     */
    const finish = (): void => {
        if (cancelled.current) {
            return;
        }

        if (value === props.initial) {
            props.onCancel();

            return;
        }

        props.onCommit(value);
    };

    const onKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Escape') {
            cancelled.current = true;
            event.stopPropagation();
            props.onCancel();

            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            // Through `finish` rather than straight to `onCommit`: Enter on an
            // untouched cell is the same "nothing changed" as clicking away, and
            // committing it throws the same `Invalid snapshot` error.
            finish();
        }
    };

    const shared = {
        ref,
        className: 'DataTable-editor',
        'aria-label': props.label,
        value,
        onBlur: finish,
        onKeyDown,
        // A click inside the editor must not reach the row, which opens the
        // record — the same guard the select cell carries.
        onClick: (event: React.MouseEvent): void => event.stopPropagation(),
    };

    /*
     * Yes and No from the `.resx`, where 0.3.x hardcoded them — the only two
     * user-visible strings in the control that were.
     */
    if (props.kind === 'boolean') {
        return (
            <select
                {...shared}
                onChange={(event): void => setValue(event.target.value)}
            >
                <option value="true">{props.strings.yes}</option>
                <option value="false">{props.strings.no}</option>
            </select>
        );
    }

    /*
     * A native `<select>`, not a Fluent one: this control has never mounted a
     * Fluent input, and a portalled listbox inside a table cell is a layout
     * problem the boolean editor above already declined to take on. The empty
     * entry is the clear — `coerceValue` turns `''` into `null` — and it is
     * first so that a cleared cell reads as chosen rather than as broken.
     */
    if (props.kind === 'choice') {
        return (
            <select
                {...shared}
                onChange={(event): void => setValue(event.target.value)}
            >
                <option value="">{props.strings.none}</option>
                {props.options.map((option) => (
                    <option key={option.value} value={String(option.value)}>
                        {option.label}
                    </option>
                ))}
            </select>
        );
    }

    return (
        <input
            {...shared}
            type={
                props.kind === 'number'
                    ? 'number'
                    : props.kind === 'date'
                      ? 'date'
                      : props.kind === 'datetime'
                        ? 'datetime-local'
                        : 'text'
            }
            onChange={(event): void => setValue(event.target.value)}
        />
    );
}

/**
 * The class list and sticky offset for one pinned cell, or nothing at all.
 *
 * **Logical insets rather than `left`/`right`.** The offsets are measured from
 * the *start* of the table, and in a right-to-left form the start is the right —
 * so a physical `left` would pin the first column to the far side of the row it
 * belongs to. The rest of this control's CSS already reasons in logical
 * properties (`padding-inline`, `margin-inline-start`) for the same reason.
 *
 * `is-pinnedEdge` marks the last column of a run. The seam it draws is the only
 * thing that tells a reader the columns beside it are moving and these are not;
 * without it a pinned column reads as a rendering fault.
 */
function pinCell(
    pin: PinnedColumn | undefined,
    base?: string,
): { className: string | undefined; style: React.CSSProperties | undefined } {
    if (!pin || !pin.pinned) {
        return { className: base, style: undefined };
    }

    const classes = [base, 'is-pinned', `is-pinned-${pin.pinned}`];

    if (pin.edge) {
        classes.push('is-pinnedEdge');
    }

    return {
        className: classes.filter(Boolean).join(' '),
        style:
            pin.pinned === 'start'
                ? { insetInlineStart: `${pin.offset}px` }
                : { insetInlineEnd: `${pin.offset}px` },
    };
}

/** The select column sticks whenever anything is pinned at the start. */
const SELECT_PIN: PinnedColumn = { pinned: 'start', width: null, offset: 0, edge: false };

/**
 * How long to wait for a write before giving up on it.
 *
 * **A promise that never settles is not a hypothetical.** 0.3.1 on a real
 * subgrid left four cells reading "Saving…" indefinitely, and the values were
 * gone on reload — so the platform never came back, one way or the other. With
 * no bound the control asserts "saving" forever about a write that is not
 * happening, which is the worst of the three states it could be in: a reader
 * who sees a failure retries, a reader who sees success moves on, and a reader
 * who sees "Saving…" waits.
 *
 * Fifteen seconds is far longer than a Dataverse write and short enough to be
 * an answer. Timing out is not the same as knowing the write failed, and the
 * message says so rather than claiming the change was rejected.
 */
const WRITE_TIMEOUT_MS = 15000;

/**
 * The write, or a rejection once `WRITE_TIMEOUT_MS` has passed.
 *
 * The timer is cleared either way. Left running it would hold the component's
 * closure alive for fifteen seconds past every successful edit, and on a form
 * somebody is paging through, that is a timer per cell they touched.
 */
function withTimeout(promise: Promise<void>, message: string): Promise<void> {
    let timer: number | undefined;

    const expiry = new Promise<void>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), WRITE_TIMEOUT_MS);
    });

    const clear = (): void => window.clearTimeout(timer);

    return Promise.race([promise, expiry]).then(
        () => clear(),
        (error: unknown) => {
            clear();

            throw error;
        },
    );
}

/** The pager chevrons, on a 20×20 grid. Two strokes each. */
const CHEVRON_PREVIOUS = 'M12.5 5 7.5 10l5 5';
const CHEVRON_NEXT = 'M7.5 5l5 5-5 5';

/** A tray with an arrow into it, on the same 20×20 grid as the chevrons. */
const DOWNLOAD_GLYPH = 'M10 3v8m0 0 3-3m-3 3-3-3M4 14v2h12v-2';

/** The clear-filter cross, on the same grid but drawn smaller — see the CSS. */
const CLEAR_GLYPH = 'M6 6l8 8M14 6l-8 8';

/** The New button's plus, on the chevrons' grid. */
const PLUS_GLYPH = 'M10 4v12M4 10h12';

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
    /** Which columns stick, how wide they are, and how far in they sit. */
    pins: PinPlan;
    pageIds: string[];
    selected: string[];
    selectionMode: SelectionMode;
    enableSorting: boolean;
    openOnRowClick: boolean;
    page: number;
    pageSize: number;
    filters: Record<string, string>;
    /** The On / From / Until toggle per date column; absent means On. */
    filterOps: Record<string, DateOp>;
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
    onFilterOp: (columnName: string, op: DateOp) => void;
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

    enableEditing: boolean;
    /** The maker's allow-list, or `null` for "whatever the platform permits". */
    allowedColumns: Set<string> | null;
    /**
     * The width the host measured, as a pixel ceiling for the root.
     *
     * `null` where the host never measured. Without it `overflow-x: auto` on
     * the scroll wrapper is inert against a shrink-to-fit parent, and the table
     * is clipped with no scrollbar rather than scrolled.
     */
    maxWidth: number | null;
    /** Ask whether a cell may be written. `null` where the host cannot write. */
    canEdit: (id: string, column: string) => Promise<boolean> | null;
    /** Write one cell. Rejects with whatever the platform refused it with. */
    onCommitEdit: (id: string, column: string, value: unknown) => Promise<void>;

    /**
     * The option list for a choice column, from entity metadata.
     *
     * **Function-or-null where `canEdit` is per-call null**, and the
     * difference is what each one is a fact about. `canEdit` answers for a
     * *record* — this row may lack the write methods — so it has to be asked
     * per cell. This answers for the *host*: either `utils.getEntityMetadata`
     * exists or it does not, decided once in `updateView`. The component needs
     * that before it renders a filter box or asks `isEditable` for a cell that
     * can never get an editor, so it is a fact about the prop rather than
     * about a call. `null` is a host without `utils`, and canvas is one.
     */
    loadOptions: ((column: string) => Promise<Option[]>) | null;

    /**
     * The platform's own date formatter, or `null` where the host has none.
     *
     * Used for the text a date cell shows while its write is in flight, so
     * the moment reads like the platform's `9/1/2026 12:30 AM` rather than
     * as a different format — `context.formatting.formatDateShort`, which
     * renders in the *user's* zone rather than the browser's. Function-or-null
     * on the `loadOptions` argument: a fact about the host.
     */
    formatDate: ((value: Date, includeTime: boolean) => string) | null;

    /**
     * Whether the New button is offered — the maker's switch and the host's
     * `navigation.openForm`, resolved in `updateView`.
     */
    canCreate: boolean;
    /**
     * Open the quick create form. Resolves the new row's id, or `null` when the
     * form was dismissed; rejects when the platform refused to open it.
     */
    onCreate: () => Promise<string | null>;
}

/**
 * Everything about editing that is *state on screen* rather than data.
 *
 * **It lives here rather than in the control class, and 0.3.0 shipped it the
 * other way round and did not work.** Changing which cell is open has to repaint
 * the table, and a control class cannot cause a repaint: `notifyOutputChanged()`
 * tells the platform an **output** changed, and the platform answers by calling
 * `getOutputs()`. A React control repaints when `updateView` returns a new
 * element, and that is the platform's decision.
 *
 * Observed on a real Accounts subgrid, 2026-09-09: the pencil rendered, the
 * click ran, the class field was set, and nothing happened. `dev/host.js` had
 * hidden it, because `settle()` re-drives the control explicitly — so a test
 * that clicked and then settled was modelling a repaint the platform never
 * performs.
 *
 * In React state, a `setState` repaints and the platform is not involved. The
 * state survives the platform's own `updateView` passes because the element type
 * is unchanged, so React reconciles rather than remounting.
 */
function useEditing(props: IProps): {
    editing: { id: string; column: string } | null;
    editableCells: Map<string, boolean>;
    pending: Map<string, unknown>;
    saving: Set<string>;
    failure: { key: string; message: string } | null;
    begin: (id: string, column: string) => void;
    cancel: () => void;
    commit: (id: string, column: string, kind: EditKind, typed: string) => void;
} {
    const [editing, setEditing] = React.useState<{ id: string; column: string } | null>(null);
    const [editableCells, setEditableCells] = React.useState<Map<string, boolean>>(
        () => new Map(),
    );
    const [pending, setPending] = React.useState<Map<string, unknown>>(() => new Map());
    const [saving, setSaving] = React.useState<Set<string>>(() => new Set());
    const [failure, setFailure] = React.useState<{ key: string; message: string } | null>(null);

    /**
     * Cells already asked about, whatever the answer.
     *
     * A ref rather than state: asking again is the thing to prevent, and
     * re-rendering because the *set of asked cells* changed would be a render
     * per answer. It only grows, which is what makes the effect terminate.
     */
    const asked = React.useRef<Set<string>>(new Set());
    const mounted = useMounted();

    const {
        enableEditing, allowedColumns, canEdit, loadOptions, columns, pageIds, dataset, getString,
    } = props;
    const pageKey = pageIds.join('|');
    const columnKey = columns.map((column) => column.name).join('|');

    React.useEffect(() => {
        if (!enableEditing) {
            return undefined;
        }

        /*
         * The maker's allow-list is applied **before** asking, not after. It
         * narrows what is offered; it cannot widen it — a column the platform
         * reports as read-only stays read-only however it is listed. Asking
         * only about columns that could carry an editor also saves a call per
         * cell on every choice and lookup column in the view.
         */
        const candidates = columns.filter((column) => {
            const kind = editKindFor(column);

            // A choice column on a host with no metadata can never get an
            // editor, so asking `isEditable` for it is a fetch bought for
            // nothing — the same argument as the allow-list below.
            return (
                kind !== 'none'
                && (kind !== 'choice' || loadOptions !== null)
                && (allowedColumns === null || allowedColumns.has(column.name))
            );
        });

        const answers: Promise<[string, boolean]>[] = [];

        pageIds.forEach((id) => {
            candidates.forEach((column) => {
                const key = cellKey(id, column.name);

                if (asked.current.has(key)) {
                    return;
                }

                asked.current.add(key);

                const ask = canEdit(id, column.name);

                // `null` is a host that cannot write at all. Recorded as `false`
                // rather than left absent, so it is asked once and not once per
                // render.
                answers.push(
                    ask
                        ? ask.then(
                            // `=== true` rather than truthiness: `isEditable` is
                            // the method whose unawaited Promise is truthy, and
                            // accepting anything truthy here would repeat that
                            // mistake one layer down.
                            (value): [string, boolean] => [key, value === true],
                            (): [string, boolean] => [key, false],
                        )
                        : Promise.resolve<[string, boolean]>([key, false]),
                );
            });
        });

        if (answers.length === 0) {
            return undefined;
        }

        /*
         * Guarded on unmount, not on this effect's cleanup. 0.3.x dropped the
         * batch whenever the page changed while it was in flight — and `asked`
         * is permanent, so the cells of the page the reader left were never
         * asked about again and came back read-only. Same guard as
         * `useChoiceOptions`.
         */
        Promise.all(answers).then((entries) => {
            if (!mounted.current) {
                return;
            }

            setEditableCells((current) => {
                const next = new Map(current);

                entries.forEach(([key, value]) => next.set(key, value));

                return next;
            });
        });

        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enableEditing, pageKey, columnKey, allowedColumns, loadOptions === null]);

    /**
     * Retire optimistic values the dataset has caught up with.
     *
     * No dependency array on purpose — it has to run against whatever the
     * platform last handed down, and the `changed` guard is what stops it
     * looping. Two exits: the refreshed record agrees, or the record has left
     * the view, which is what a filtered view does the moment an edit stops
     * matching the filter. Without the second the map grows for the lifetime of
     * the control.
     */
    React.useEffect(() => {
        if (pending.size === 0) {
            return;
        }

        const next = new Map(pending);
        let changed = false;

        pending.forEach((value, key) => {
            // Still in flight: the dataset cannot have caught up with a write
            // that has not landed, and dropping the override here would flash
            // the old value back under the user's cursor.
            if (saving.has(key)) {
                return;
            }

            const separator = key.lastIndexOf('|');
            const record = dataset.records[key.slice(0, separator)];

            if (!record) {
                next.delete(key);
                changed = true;

                return;
            }

            /*
             * Compared per kind — see `sameValue`. 0.3.x compared as strings,
             * and a date's `String(Date)` never equals the ISO string the
             * record reports, so an edited date cell kept its pending text for
             * the life of the page. The kind comes from the column, which is
             * why `columns` is a dependency below.
             */
            const columnName = key.slice(separator + 1);
            const column = columns.find((candidate) => candidate.name === columnName);
            const kind = column ? editKindFor(column) : 'none';

            if (sameValue(kind, record.getValue(columnName), value)) {
                next.delete(key);
                changed = true;
            }
        });

        if (changed) {
            setPending(next);
        }
        // The guard above is what stops this looping: a pass that changes
        // nothing sets nothing, so the next render finds the same map and
        // stops. `dataset.records` is the thing being reconciled against.
    }, [pending, saving, dataset.records, columns]);

    const drop = <T,>(collection: Set<string> | Map<string, T>, key: string): void => {
        if (collection instanceof Set) {
            setSaving((current) => {
                const next = new Set(current);

                next.delete(key);

                return next;
            });

            return;
        }

        setPending((current) => {
            const next = new Map(current);

            next.delete(key);

            return next;
        });
    };

    return {
        editing,
        editableCells,
        pending,
        saving,
        failure,
        begin: (id, column): void => {
            setEditing({ id, column });
            // The failure belonged to the previous attempt. Reopening the cell
            // is the user answering it, so it goes rather than sitting above an
            // editor that has not been used yet.
            setFailure(null);
        },
        cancel: (): void => setEditing(null),
        commit: (id, column, kind, typed): void => {
            const key = cellKey(id, column);
            const coerced = coerceValue(kind, typed);

            setEditing(null);

            /*
             * A half-typed number writes nothing, on the same argument
             * `numericCondition` makes for a half-typed filter: `NaN` is a wrong
             * answer that looks like a finished one. Reported rather than
             * swallowed, because a cell that silently reverts reads as broken.
             */
            if (!coerced.ok) {
                setFailure({ key, message: getString('DataTable_NotANumber') });

                return;
            }

            setFailure(null);
            setPending((current) => new Map(current).set(key, coerced.value));
            setSaving((current) => new Set(current).add(key));

            withTimeout(
                props.onCommitEdit(id, column, coerced.value),
                getString('DataTable_SaveTimedOut'),
            ).then(
                () => drop(saving, key),
                (error: unknown) => {
                    drop(saving, key);
                    drop(pending, key);
                    setFailure({
                        key,
                        message:
                            (error as Error)?.message
                            || getString('DataTable_SaveFailedGeneric'),
                    });
                },
            );
        },
    };
}

/**
 * The option lists for the choice columns on screen, one fetch per column.
 *
 * **One hook for the editor and the filter box**, so a view with a choice
 * column asks for its metadata exactly once however many rows it has and
 * whichever of the two features is on. The answer lives here rather than in the
 * control class for the reason every other piece of editing state does: it
 * arrives asynchronously and has to repaint the table when it lands, which a
 * `setState` does and `notifyOutputChanged()` does not.
 *
 * A rejected fetch is recorded as `[]` — the column then gets neither editor
 * nor box, which is the read-only fallback the host without `utils` gets —
 * and logged once, because a metadata call that fails silently is a feature
 * that vanished for no visible reason.
 */
function useChoiceOptions(props: IProps): Map<string, Option[]> {
    const [options, setOptions] = React.useState<Map<string, Option[]>>(() => new Map());
    const asked = React.useRef<Set<string>>(new Set());
    const mounted = useMounted();

    const { loadOptions, columns, enableEditing, enableFiltering } = props;
    const wanted = loadOptions !== null && (enableEditing || enableFiltering);
    const columnKey = columns.map((column) => column.name).join('|');

    React.useEffect(() => {
        if (!wanted || loadOptions === null) {
            return undefined;
        }

        const pending = columns
            .filter((column) => editKindFor(column) === 'choice' && !asked.current.has(column.name))
            .map((column) => {
                asked.current.add(column.name);

                return loadOptions(column.name).then(
                    (list): [string, Option[]] => [column.name, list],
                    (error: unknown): [string, Option[]] => {
                        console.warn('[DataTable] metadata failed', column.name, error);

                        return [column.name, []];
                    },
                );
            });

        if (pending.length === 0) {
            return undefined;
        }

        /*
         * Guarded on unmount and not on the effect's own cleanup. `asked` is
         * permanent, so an answer dropped because the column set changed while
         * it was in flight would never be asked for again — the column would
         * sit read-only for the life of the control.
         */
        Promise.all(pending).then((entries) => {
            if (!mounted.current) {
                return;
            }

            setOptions((current) => {
                const next = new Map(current);

                entries.forEach(([name, list]) => next.set(name, list));

                return next;
            });
        });

        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wanted, columnKey]);

    return options;
}

/** Whether the component is still mounted, for answers that arrive after it is not. */
function useMounted(): React.MutableRefObject<boolean> {
    const mounted = React.useRef(true);

    React.useEffect(
        () => (): void => {
            mounted.current = false;
        },
        [],
    );

    return mounted;
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
    ops: Record<string, DateOp>,
): [
    Record<string, string>,
    (columnName: string, value: string) => void,
    Record<string, DateOp>,
    (columnName: string, op: DateOp) => void,
] {
    const [local, setLocal] = React.useState(filters);
    /*
     * The toggle is mirrored for a stronger reason than the boxes are. An
     * operator change on an *empty* box changes no expression, so the class
     * applies nothing, refreshes nothing, and `updateView` never runs — and a
     * label read straight from props would stay on "On" however many times it
     * was clicked. Component state is the only thing that repaints it.
     */
    const [localOps, setLocalOps] = React.useState(ops);
    const key = JSON.stringify([filters, ops]);

    React.useEffect(() => {
        setLocal(filters);
        setLocalOps(ops);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return [
        local,
        (columnName: string, value: string): void =>
            setLocal((current) => ({ ...current, [columnName]: value })),
        localOps,
        (columnName: string, op: DateOp): void =>
            setLocalOps((current) => ({ ...current, [columnName]: op })),
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
    const [filters, setFilter, filterOps, setFilterOp] = useMirroredFilters(
        props.filters,
        props.filterOps,
    );
    const checkState = headerCheckState(selected, pageIds);
    const headerRef = useIndeterminate(checkState);
    // Before every early return: hooks cannot be conditional.
    const edit = useEditing(props);
    const choiceOptions = useChoiceOptions(props);
    const [creating, setCreating] = React.useState(false);
    const [createFailure, setCreateFailure] = React.useState<string | null>(null);

    /**
     * The New button. `creating` disables it while the quick create form is
     * up, because a second click would open a second form over the first.
     * A dismissed form resolves `null` and is not a failure; a form the
     * platform would not open is, and it is said under the button rather than
     * lost in the console.
     */
    const create = (): void => {
        setCreating(true);
        setCreateFailure(null);

        props.onCreate().then(
            () => setCreating(false),
            (error: unknown) => {
                setCreating(false);
                setCreateFailure(
                    (error as Error)?.message || getString('DataTable_CreateFailed'),
                );
            },
        );
    };

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
            {/*
              **The measured width, as a pixel ceiling.** Without it the scroll
              wrapper's `overflow-x: auto` is inert: a form section can hand a
              control a shrink-to-fit parent, which takes its width *from* its
              content, so `width: 100%` here resolves against a number this
              control produced. The table then draws wider than its box, an
              ancestor clips it, and no scrollbar appears — observed on a real
              subgrid, 2026-09-09. Nothing written in CSS breaks that circle;
              the way out is a number from outside it.
            */}
            <div
                className="DataTable"
                style={props.maxWidth ? { maxWidth: `${props.maxWidth}px` } : undefined}
            >
                {content}
            </div>
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

    const primary = primaryColumn(columns);
    const selectable = props.selectionMode !== 'none';
    const multiple = props.selectionMode === 'multiple';
    const pins = props.pins;

    /*
     * **Two width systems, and only one of them is in force at a time.**
     *
     * Unpinned, this is exactly what 0.2.0 did: `columnWidths` turns
     * `visualSizeFactor` into percentages, or returns `null` where the host set
     * no factors at all and the browser's own table layout is the better answer.
     *
     * Pinned, the plan owns every width — because a pinned column needs pixels
     * for its sticky offset to mean anything, and the loose columns then have to
     * divide what is left rather than the whole table. Mixing the two by hand at
     * this level is how the layout drifts wider on every render.
     */
    const widths = pins.none ? columnWidths(columns) : pins.columns.map((pin) => pin.width);
    const minWidth = pins.none ? tableMinWidth(columns.length, selectable) : pins.minWidth;
    const selectPin = pins.selectPinned ? SELECT_PIN : undefined;

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
                    style={{ minWidth: `${minWidth}px` }}
                >
                    <caption className="DataTable-caption">{dataset.getTitle()}</caption>

                    {widths && (
                        <colgroup>
                            {selectable && <col className="DataTable-selectCol" />}
                            {widths.map((width, index) => (
                                <col
                                    key={columns[index].name}
                                    // `null` is a real entry: the plan leaves a
                                    // loose column unmeasured where the host set
                                    // no factors, and React drops an undefined
                                    // width rather than writing `width: null`.
                                    style={{ width: width ?? undefined }}
                                />
                            ))}
                        </colgroup>
                    )}

                    <thead>
                        <tr>
                            {selectable && (
                                <th scope="col" {...pinCell(selectPin, 'DataTable-selectCell')}>
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

                            {columns.map((column, index) => {
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
                                        {...pinCell(pins.columns[index])}
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
                                {selectable && <th {...pinCell(selectPin, 'DataTable-selectCell')} />}

                                {columns.map((column, index) => {
                                    const kind = filterKindFor(column);
                                    const options = choiceOptions.get(column.name);

                                    /*
                                      A choice column can carry a box only once
                                      its options are here: nothing on a host
                                      without `utils`, nothing while they load,
                                      nothing when the list came back empty.
                                      Read-only is the fallback for all three.
                                    */
                                    const withheld =
                                        kind === 'choice' && !(options && options.length > 0);

                                    if (kind === 'none' || withheld) {
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
                                                title={getString('DataTable_Unfilterable').replace(
                                                    '{0}',
                                                    column.displayName,
                                                )}
                                                {...pinCell(
                                                    pins.columns[index],
                                                    'DataTable-filterNone',
                                                )}
                                            >
                                                <span aria-hidden="true">—</span>
                                            </th>
                                        );
                                    }

                                    const label = (
                                        kind === 'number'
                                            ? getString('DataTable_FilterNumberHint')
                                            : kind === 'date'
                                              ? getString('DataTable_FilterDateHint')
                                              : getString('DataTable_FilterColumn')
                                    ).replace('{0}', column.displayName);

                                    /*
                                      The choice box has no clear cross: "Any"
                                      is the clear, and it is the first entry so
                                      that a box nobody has touched reads as a
                                      choice made rather than as a box that is
                                      empty.
                                    */
                                    if (kind === 'choice') {
                                        return (
                                            <th key={column.name} {...pinCell(pins.columns[index])}>
                                                <select
                                                    className="DataTable-filter DataTable-filterSelect"
                                                    value={filters[column.name] ?? ''}
                                                    disabled={props.disabled}
                                                    aria-label={label}
                                                    title={label}
                                                    onChange={(event): void => {
                                                        setFilter(column.name, event.target.value);
                                                        props.onFilter(column.name, event.target.value);
                                                    }}
                                                >
                                                    <option value="">
                                                        {getString('DataTable_FilterAny')}
                                                    </option>
                                                    {(options ?? []).map((option) => (
                                                        <option
                                                            key={option.value}
                                                            value={String(option.value)}
                                                        >
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </th>
                                        );
                                    }

                                    const op = filterOps[column.name] ?? 'on';
                                    const opLabel = getString(
                                        op === 'from'
                                            ? 'DataTable_DateFrom'
                                            : op === 'until'
                                              ? 'DataTable_DateUntil'
                                              : 'DataTable_DateOn',
                                    );

                                    return (
                                        <th key={column.name} {...pinCell(pins.columns[index])}>
                                            <span className={
                                                kind === 'date'
                                                    ? 'DataTable-filterBox DataTable-filterDate'
                                                    : 'DataTable-filterBox'
                                            }>
                                            {/*
                                              The toggle leads the box, so the
                                              cell reads as a sentence — "From
                                              2026-03-01" — and so the date
                                              input's own picker icon, which
                                              Chromium draws at the trailing
                                              edge, does not collide with it.
                                            */}
                                            {kind === 'date' && (
                                                <button
                                                    type="button"
                                                    className="DataTable-filterOp"
                                                    disabled={props.disabled}
                                                    aria-label={getString('DataTable_DateOpHint').replace(
                                                        '{0}',
                                                        column.displayName,
                                                    )}
                                                    title={getString('DataTable_DateOpHint').replace(
                                                        '{0}',
                                                        column.displayName,
                                                    )}
                                                    onClick={(): void => {
                                                        const next = nextDateOp(op);

                                                        setFilterOp(column.name, next);
                                                        props.onFilterOp(column.name, next);
                                                    }}
                                                >
                                                    {/*
                                                      The word, and the sign
                                                      the stylesheet swaps in
                                                      when the cell is too
                                                      narrow for the word. The
                                                      accessible name is the
                                                      hint above either way.
                                                    */}
                                                    <span className="DataTable-filterOpWord">{opLabel}</span>
                                                    <span className="DataTable-filterOpSign" aria-hidden="true">
                                                        {op === 'from' ? '≥' : op === 'until' ? '≤' : '='}
                                                    </span>
                                                </button>
                                            )}
                                            <input
                                                type={kind === 'date' ? 'date' : 'text'}
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
                                                        : kind === 'date'
                                                          // A date input draws its own
                                                          // mask and ignores this.
                                                          ? undefined
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
                                            onClick={(event): void => event.stopPropagation()}
                                            {...pinCell(selectPin, 'DataTable-selectCell')}
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

                                    {columns.map((column, index) => {
                                        const key = cellKey(id, column.name);
                                        const kind = editKindFor(column);
                                        const isPrimaryCell =
                                            Boolean(primary) && column.name === primary?.name;

                                        /*
                                          **Three conditions, and the platform's
                                          is the last word.** The maker's
                                          allow-list narrows; `editKindFor`
                                          vetoes types with no editor; and
                                          `editableCells` is what the platform
                                          said about this cell on this record.
                                          Absent means "not answered yet" — which
                                          renders read-only, because declining
                                          to offer an editor is always safe and
                                          offering one the platform then refuses
                                          is not.
                                        */
                                        const options = choiceOptions.get(column.name);
                                        const editable =
                                            props.enableEditing
                                            && kind !== 'none'
                                            // A choice with no options to offer
                                            // is a `<select>` that can only
                                            // clear, so it waits for them.
                                            && (kind !== 'choice' || Boolean(options && options.length > 0))
                                            && (props.allowedColumns === null
                                                || props.allowedColumns.has(column.name))
                                            && edit.editableCells.get(key) === true;

                                        const isEditingCell =
                                            edit.editing?.id === id
                                            && edit.editing?.column === column.name;

                                        const saving = edit.saving.has(key);
                                        const hasPending = edit.pending.has(key);
                                        const failure =
                                            edit.failure?.key === key
                                                ? edit.failure.message
                                                : null;

                                        /*
                                          The optimistic value outranks the
                                          record's, because the record has not
                                          been re-read yet. `getFormattedValue`
                                          cannot see a value the dataset does
                                          not hold, so `pendingText` formats it
                                          — through `context.formatting` for a
                                          date, so the moment between the save
                                          landing and the refresh arriving
                                          reads like the platform's own cell
                                          rather than as `2026-03-01`. Retired
                                          by `sameValue` once the record agrees.
                                        */
                                        const text = hasPending
                                            ? pendingText(kind, edit.pending.get(key), options, props.formatDate)
                                            : record.getFormattedValue(column.name);

                                        const cellClass = [
                                            saving ? 'is-saving' : '',
                                            failure ? 'is-invalid' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ');

                                        const pinned = pinCell(pins.columns[index]);

                                        return (
                                            <td
                                                key={column.name}
                                                {...pinned}
                                                className={
                                                    [pinned.className, cellClass]
                                                        .filter(Boolean)
                                                        .join(' ') || undefined
                                                }
                                            >
                                                {isEditingCell ? (
                                                    <CellEditor
                                                        kind={kind}
                                                        initial={editorValue(
                                                            kind,
                                                            record.getValue(column.name),
                                                        )}
                                                        label={getString(
                                                            'DataTable_EditCell',
                                                        ).replace('{0}', column.displayName)}
                                                        options={options ?? []}
                                                        strings={{
                                                            yes: getString('DataTable_Yes'),
                                                            no: getString('DataTable_No'),
                                                            none: getString('DataTable_NoValue'),
                                                        }}
                                                        onCommit={(typed): void =>
                                                            edit.commit(id, column.name, kind, typed)
                                                        }
                                                        onCancel={edit.cancel}
                                                    />
                                                ) : (
                                                    <>
                                                        {/*
                                                          The primary cell is a
                                                          button so open-record
                                                          is reachable by
                                                          keyboard. A clickable
                                                          <tr> alone is not.
                                                        */}
                                                        {isPrimaryCell ? (
                                                            <button
                                                                type="button"
                                                                className="DataTable-open"
                                                                title={getString(
                                                                    'DataTable_OpenRecord',
                                                                ).replace('{0}', rowName)}
                                                                onClick={(event): void => {
                                                                    event.stopPropagation();
                                                                    props.onOpenRecord(id);
                                                                }}
                                                            >
                                                                {text}
                                                            </button>
                                                        ) : editable ? (
                                                            /*
                                                              A real button, for
                                                              the same reason the
                                                              primary cell is
                                                              one: an editor
                                                              reachable only by
                                                              mouse is an editor
                                                              half the users
                                                              cannot open.
                                                            */
                                                            <button
                                                                type="button"
                                                                className="DataTable-editTrigger"
                                                                title={getString(
                                                                    'DataTable_EditCell',
                                                                ).replace(
                                                                    '{0}',
                                                                    column.displayName,
                                                                )}
                                                                onClick={(event): void => {
                                                                    event.stopPropagation();
                                                                    edit.begin(
                                                                        id,
                                                                        column.name,
                                                                    );
                                                                }}
                                                            >
                                                                <span>
                                                                    {text
                                                                        || getString(
                                                                            'DataTable_EditEmpty',
                                                                        )}
                                                                </span>
                                                            </button>
                                                        ) : (
                                                            text
                                                        )}

                                                        {/*
                                                          The primary cell keeps
                                                          its open-record link
                                                          and gets the pencil
                                                          beside it. Folding
                                                          editing into that
                                                          button would put two
                                                          behaviours on one
                                                          target — and the
                                                          column that names the
                                                          row is exactly the one
                                                          people most want to
                                                          rename.
                                                        */}
                                                        {isPrimaryCell && editable && (
                                                            <button
                                                                type="button"
                                                                className="DataTable-editPencil"
                                                                aria-label={getString(
                                                                    'DataTable_EditCell',
                                                                ).replace(
                                                                    '{0}',
                                                                    column.displayName,
                                                                )}
                                                                title={getString(
                                                                    'DataTable_EditCell',
                                                                ).replace(
                                                                    '{0}',
                                                                    column.displayName,
                                                                )}
                                                                onClick={(event): void => {
                                                                    event.stopPropagation();
                                                                    edit.begin(
                                                                        id,
                                                                        column.name,
                                                                    );
                                                                }}
                                                            >
                                                                <PencilGlyph />
                                                            </button>
                                                        )}

                                                        {saving && (
                                                            <span className="DataTable-savingNote">
                                                                {getString('DataTable_Saving')}
                                                            </span>
                                                        )}

                                                        {/*
                                                          The refusal is named
                                                          against the cell that
                                                          caused it, and it is
                                                          `role="alert"` because
                                                          a rollback a screen
                                                          reader never hears is
                                                          a value that silently
                                                          changed back.
                                                        */}
                                                        {failure && (
                                                            <span
                                                                className="DataTable-cellError"
                                                                role="alert"
                                                            >
                                                                {getString(
                                                                    'DataTable_SaveFailed',
                                                                )
                                                                    .replace(
                                                                        '{0}',
                                                                        column.displayName,
                                                                    )
                                                                    .replace('{1}', failure)}
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                            </td>
                                        );
                                    })}
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
                {/*
                  First among the tools, because it is the one a reader
                  reaches for most and the one that is not about the rows
                  already on screen. Beside the pager rather than above the
                  table: a model-driven subgrid already has a command bar up
                  there, and a second New above it would be two buttons that
                  read the same and behave differently.
                */}
                {props.canCreate && (
                    <button
                        type="button"
                        className="DataTable-create"
                        disabled={props.disabled || creating}
                        title={getString('DataTable_NewHint')}
                        onClick={create}
                    >
                        <Chevron d={PLUS_GLYPH} />
                        {getString('DataTable_New')}
                    </button>
                )}

                {createFailure && (
                    <span className="DataTable-createError" role="alert">
                        {createFailure}
                    </span>
                )}

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
