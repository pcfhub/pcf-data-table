import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { DataTableControl, GroupAnswer, GroupRoute, IProps } from './components/DataTableControl';
import {
    ASCENDING,
    buildFilter,
    clampPage,
    DateOp,
    editableColumnSet,
    editKindFor,
    faultMessage,
    lastPage,
    LookupValue,
    lookupTargets,
    lookupValue,
    navigationProperty,
    nextDirection,
    Option,
    pageSizeChoices,
    parseOptions,
    parseRelationships,
    pinPlan,
    Relationship,
    SelectionMode,
    toCsv,
    toggleId,
    visibleColumns,
} from './components/resolve';
import { AliasPlan, GroupSource, GroupSpec } from './group/types';
import { GroupSort } from './group/group';
import { buildSpec, describeProblem } from './group/spec';
import { aliasPlan, Condition, Filter, filterToFetchXml, parentFilterXml } from './query/fetchXml';
import {
    begin,
    Collecting,
    ExportState,
    harvest,
    nextPageFor,
    restorePlan,
    shouldHarvest,
    wasCapped,
} from './export/collect';
import { describesPlan, toGroupReading } from './query/rows';
import { ParentReading, ParentResolution, resolveParentLookup, rowsConfirm, withholdsRoute } from './data/parent';
import { loadAggregate, readViewFetchXml, Refusal, WebApiReader } from './data/GroupData';

/**
 * How long one export page may take before the machine gives up on it.
 *
 * **`loadExactPage` returns `void` and has no rejection to catch**, so a fetch
 * that never lands is indistinguishable from one still in flight.
 * `dataset.error` covers a refusal the platform reports; this covers the
 * silence, which would otherwise leave "Reading page 4…" on screen for the life
 * of the form.
 *
 * Thirty seconds is above the slowest refresh measured on the probe subgrid
 * (3–14s) with room to spare.
 */
const EXPORT_TIMEOUT_MS = 30000;

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
 * control declares `Utility` and not `WebAPI`: the one feature it takes buys
 * the option list a Choice editor is built from, not the write.
 *
 * **It does not write a Lookup.** Measured 2026-09-11: `setValue` on a Lookup
 * column accepted five value shapes and staged none of them — every `save()`
 * refused with "Invalid snapshot", the stored value untouched. The editor for
 * that column type was cut from 0.4.0 on that measurement; SPEC.md has it.
 */
interface EditableRecord {
    /**
     * **Not a promise, and 0.3.0–0.3.2 assumed it was.**
     *
     * It returns `undefined`. Microsoft's own reference page types it
     * `Promise`, and the working samples in the wild call it synchronously —
     * several `setValue`s in a row, then one `await record.save()`. Typing it
     * as a promise here produced `record.setValue(...).then(...)`, which is
     * `.then` on `undefined`: a `TypeError` thrown **synchronously**, before
     * any `.catch` in the chain and before the timeout wrapper existed to see
     * it. The cell had already been marked saving, nothing caught the throw,
     * and it read "Saving…" forever with no rollback and no message.
     *
     * Typed `unknown` rather than `void` so that a host which *does* return a
     * promise is not a type error — `Promise.resolve()` upstream handles both.
     */
    setValue(columnName: string, value: unknown): unknown;
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
    /**
     * Measured present, and measured to answer `false` immediately after a
     * resolved `setValue` — which is the loose thread 0.3.2 is pulling on.
     * Nothing gates on it; the diagnostics in `writeCell` only report it.
     */
    isDirty?(): Promise<boolean> | boolean;
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

/**
 * The one method of `context.utils` this control calls, or `null`.
 *
 * **Detected per method, not per bag** — the `pcf-row-commands` rule. `utils`
 * is typed as always present and is absent on canvas whatever the manifest
 * declares; `required="false"` on the feature means a model-driven host may
 * leave it out too. Checking the bag and then calling the method passes on the
 * host it was written on and throws on the next one.
 */
type MetadataReader = (entity: string, attributes: string[]) => Promise<unknown>;

function metadataReader(context: ComponentFramework.Context<IInputs>): MetadataReader | null {
    const utils = (context as { utils?: { getEntityMetadata?: unknown } }).utils;

    if (!utils || typeof utils.getEntityMetadata !== 'function') {
        return null;
    }

    const read = (utils.getEntityMetadata as MetadataReader).bind(utils);

    /*
     * **A host can publish this method and refuse to run it, and refuse
     * *synchronously*.** Canvas throws `getEntityMetadata: Method not
     * implemented.` from the call itself rather than returning a rejected
     * promise — so there is nothing for a caller to `.catch`, the throw escapes
     * `updateView`, and the studio replaces the table with *Error loading
     * control*. Reported from a real canvas app, 2026-09-21, one build after the
     * identical defect in `page.getClientUrl` was fixed: fixing that one did not
     * fix this one, it revealed it.
     *
     * The Promise executor is the whole repair. A throw inside it rejects the
     * promise instead of propagating, which turns "refused synchronously" into
     * the asynchronous refusal every caller is already written for.
     *
     * **The rejection is deliberately not swallowed here.** A refused call has
     * to stay distinguishable from a column that genuinely has no options —
     * the component records the rejection as its read-only fallback, and
     * `dev/smoke.js` asserts that an empty list is not substituted for it.
     * This makes the refusal catchable; it does not decide what it means.
     */
    return (entity: string, attributes: string[]): Promise<unknown> =>
        new Promise<unknown>((resolve) => resolve(read(entity, attributes)));
}

/**
 * The four host surfaces a lookup edit needs, or `null` if any one is missing.
 *
 * **The only editor that leaves the record.** `record.setValue()` on a Lookup
 * column stages nothing (measured 2026-09-11, five shapes), so the write is
 * `webAPI.updateRecord` with an `@odata.bind` key — which needs the navigation
 * property name from `EntityDefinitions` (a same-origin `fetch`, because
 * `context.webAPI` cannot address metadata entities), the target's entity set
 * name from `utils.getEntityMetadata`, and the pick itself from
 * `utils.lookupObjects`. Each was measured on 2026-09-13; SPEC.md 0.5.0 has
 * the nine questions. Canvas has none of the four, so a lookup cell is
 * read-only there and the component is told so by this returning `null`.
 *
 * `page.getClientUrl` is not in the typings and is preferred over a
 * root-relative URL for the reason `pcf-grid-data-bars` gives: on-premises
 * puts the organisation in a *path*, where `/api/...` 404s. The `Xrm` global
 * is the fallback, not the preference.
 */
/**
 * Call a platform method that might not work, and take `undefined` for an
 * answer.
 *
 * **A method can exist and still refuse.** Canvas publishes
 * `page.getClientUrl` and throws `Method not implemented.` when it is called,
 * so `typeof … === 'function'` is a test of the wrong thing. Reported from a
 * real canvas app, 2026-09-21: the throw escaped `lookupHost`, escaped
 * `updateView`, and the studio rendered **"Error loading control"** — the whole
 * table gone over a probe for a feature canvas was never offered.
 *
 * Every detection in this file is written to answer "can this host do X?" with
 * a value rather than an exception. This is that contract for the one probe
 * that has to *call* something to find out.
 */
function ask<T>(call: () => T): T | undefined {
    try {
        return call();
    } catch {
        return undefined;
    }
}

interface LookupHost {
    clientUrl: string;
    readMetadata: MetadataReader;
    pick: (options: Record<string, unknown>) => Promise<unknown>;
    update: (entity: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
}

function lookupHost(context: ComponentFramework.Context<IInputs>): LookupHost | null {
    const loose = context as {
        utils?: { lookupObjects?: unknown };
        webAPI?: { updateRecord?: unknown };
        page?: { getClientUrl?: unknown };
    };
    const readMetadata = metadataReader(context);
    const pick = loose.utils?.lookupObjects;
    const update = loose.webAPI?.updateRecord;
    const page = loose.page;
    const fromPage = typeof page?.getClientUrl === 'function'
        ? ask(() => (page.getClientUrl as () => unknown)())
        : undefined;
    const fromGlobal = ask(() => (globalThis as {
        Xrm?: { Utility?: { getGlobalContext?: () => { getClientUrl?: () => unknown } } };
    }).Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.());
    const clientUrl = [fromPage, fromGlobal].find(
        (url): url is string => typeof url === 'string' && url !== '',
    );

    if (
        !readMetadata
        || typeof pick !== 'function'
        || typeof update !== 'function'
        || !clientUrl
    ) {
        return null;
    }

    return {
        clientUrl: clientUrl.replace(/\/$/, ''),
        readMetadata,
        pick: (pick as LookupHost['pick']).bind(loose.utils),
        update: (update as LookupHost['update']).bind(loose.webAPI),
    };
}

/**
 * `navigation.openForm`, or `null` — the same rule. Typed as always present;
 * absent on canvas and on the hub's demo harness.
 */
type FormOpener = (options: Record<string, unknown>) => Promise<unknown>;

/**
 * The organisation URL, or `null` where nothing answers with one.
 *
 * **This is the only measured way to tell a model-driven host from a canvas
 * one.** Every other surface lies: the host probe asked a real canvas app about
 * fifteen of them on 2026-09-22 and **all fifteen came back present**, refusing
 * only when called. `typeof context.navigation.openForm === 'function'` is
 * therefore true on canvas, and so is the same test for every Web API method.
 *
 * `getClientUrl` refuses too — but it refuses by *throwing*, and a thrown
 * refusal is an answer once it is caught. A value, not a method, is the thing
 * worth testing.
 *
 * The `Xrm` global is the fallback rather than the preference, for the reason
 * `pcf-grid-data-bars` gives: on-premises puts the organisation in a path,
 * where a root-relative URL 404s.
 */
function clientUrlOf(context: ComponentFramework.Context<IInputs>): string | null {
    const page = (context as { page?: { getClientUrl?: unknown } }).page;
    const fromPage = typeof page?.getClientUrl === 'function'
        ? ask(() => (page.getClientUrl as () => unknown)())
        : undefined;
    const fromGlobal = ask(() => (globalThis as {
        Xrm?: { Utility?: { getGlobalContext?: () => { getClientUrl?: () => unknown } } };
    }).Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.());

    const found = [fromPage, fromGlobal].find(
        (url): url is string => typeof url === 'string' && url !== '',
    );

    return found ?? null;
}

/**
 * The quick create opener, or `null` on a host that cannot open a form.
 *
 * **`typeof navigation.openForm === 'function'` is not that test.** It passes
 * on canvas, where the method exists and refuses — so the control drew a New
 * button in a canvas app that could only fail. Found by measuring the host
 * rather than by reading the code: `docs/canvas.md` had claimed since 0.4.0
 * that *"there is no New button, whatever `enableCreate` is set to:
 * `navigation.openForm` is not on this host"*, and the second half of that
 * sentence was simply wrong.
 *
 * So the method has to exist **and** the host has to be one where it means
 * anything. See `clientUrlOf` for why that is the discriminator.
 */
function formOpener(context: ComponentFramework.Context<IInputs>): FormOpener | null {
    const navigation = (context as { navigation?: { openForm?: unknown } }).navigation;

    if (!navigation || typeof navigation.openForm !== 'function') {
        return null;
    }

    return clientUrlOf(context) === null
        ? null
        : (navigation.openForm as FormOpener).bind(navigation);
}

/**
 * `mode.contextInfo` — untyped, and measured 2026-09-11 on a form subgrid as
 * `{ entityTypeName: 'account', entityId: '85f6…', entityRecordName: '…' }`, the
 * parent record. A main grid has no parent and is expected to carry nothing
 * here, so both fields are checked and the result is optional.
 */
function parentReference(
    context: ComponentFramework.Context<IInputs>,
): { entityType: string; id: string } | null {
    const info = (context.mode as { contextInfo?: { entityTypeName?: unknown; entityId?: unknown } })
        .contextInfo;

    return info && typeof info.entityTypeName === 'string' && typeof info.entityId === 'string'
        ? { entityType: info.entityTypeName, id: info.entityId }
        : null;
}

/**
 * A GUID as the other three outputs spell it: unbraced, lower-case.
 *
 * `openForm` resolves `{ id: "{436E09A8-…}" }` and `record.getValue` on a
 * lookup returns `a1e84297-…` — measured on the same day, on the same host —
 * so a form that compared `createdRecordId` with `openedRecordId` would never
 * find a match without this.
 */
function bareGuid(raw: unknown): string | null {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim().replace(/^\{|\}$/g, '').toLowerCase();

    return /^[0-9a-f-]{36}$/.test(trimmed) ? trimmed : null;
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
/**
 * The primary key a `count` is taken over.
 *
 * **Not readable from `dataset.columns`** — measured 2026-09-20: the layout
 * carried ten columns and the primary key was not among them, though the
 * view's own FetchXML selected it. So it is read from metadata.
 *
 * `pcf-chart-view` derives it as `{entity}id` with a hard-coded set of the
 * seventeen system activity tables as the exception. **That set cannot cover a
 * custom activity table**, which is a real shape a maker can create and whose
 * primary key is `activityid` like every other activity. So metadata is the
 * primary mechanism here and the list is only the synchronous fallback, for
 * the pass before the read lands and for a host that refuses it.
 */
const ACTIVITIES = new Set([
    'task', 'email', 'appointment', 'phonecall', 'letter', 'fax', 'serviceappointment',
    'recurringappointmentmaster', 'socialactivity', 'campaignactivity', 'campaignresponse',
    'bulkoperation', 'incidentresolution', 'opportunityclose', 'quoteclose', 'orderclose',
    'activitypointer',
]);

/** The guess, for the pass before metadata answers. Right for most tables. */
const guessPrimaryId = (entity: string): string =>
    (ACTIVITIES.has(entity) ? 'activityid' : `${entity}id`);

/**
 * One input's raw value, or `null` where the parameter is not there at all.
 *
 * **The platform builds a parameter object for every declared property**, so
 * `context.parameters.groupBy` is always present on a real host and reading
 * `.raw` unguarded is safe there. That is a claim about the platform, and this
 * repository's rule is that such a claim is checked rather than trusted — the
 * same rule `sorting`, `loadExactPage` and `trackContainerResize` are all
 * under.
 *
 * It earned its keep immediately: `dev/host.js` builds only the inputs a suite
 * hands it, so the first grouped render threw *"Cannot read properties of
 * undefined"* out of `updateView` and took the whole control down — and
 * several assertions passed against the resulting empty markup, because
 * "contains no group rows" is true of nothing at all. A control that dies on a
 * property a host did not declare is worse than one that renders ungrouped.
 */
function boolInput(context: ComponentFramework.Context<IInputs>, name: string): boolean {
    const parameter = (context.parameters as unknown as Record<string, { raw?: unknown } | undefined>)[name];

    return parameter ? parameter.raw === true : false;
}

function rawInput(context: ComponentFramework.Context<IInputs>, name: string): string | null {
    const parameter = (context.parameters as unknown as Record<string, { raw?: unknown } | undefined>)[name];
    const raw = parameter ? parameter.raw : null;

    return typeof raw === 'string' ? raw : null;
}

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

    /**
     * What a group with no value is called.
     *
     * Held on the instance because `loadGroups` runs **after** the pass that
     * started it, by which time there is no `context` in scope — the loader
     * pattern's one cost. Refreshed on every `updateView`, so a host that
     * changes language mid-session is not left with the old word.
     */
    private blankLabel = '(blank)';

    /** The last set of grouping problems reported, so a bad name is logged once rather than per render. */
    private reportedGroupProblems = '';

    /**
     * The conditions narrowing the table to one expanded group, or empty.
     *
     * **One group at a time**, and that is a design decision rather than a
     * limitation waiting to be lifted: two expansions mean two sets of
     * conditions ORed together, interleaved rows, and the paging problem back
     * again. Expanding a second group collapses the first.
     */
    private expansion: Condition[] = [];

    /** The full-view export's state machine. See `DataTable/export/collect.ts`. */
    private exportState: ExportState = { phase: 'idle' };

    /** The per-page watchdog, cleared in `destroy()` beside `filterTimer`. */
    private exportWatchdog: number | null = null;

    /** A sentence about the last export, or `''`. */
    private exportNote = '';

    /**
     * The failure template, captured while `context` is in scope.
     *
     * The watchdog fires long after the pass that armed it, and there is no
     * `context` in a timer callback — the same cost the group loader pays for
     * `blankLabel`.
     */
    private exportFailure = '';

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

    /**
     * The On / From / Until toggle per date column. Kept apart from `filters`
     * so that clearing the boxes leaves the toggles where the reader put them
     * — an operator is a preference, a value is a query.
     */
    private filterOps: Record<string, DateOp> = {};

    /**
     * The option lists asked for so far, by column, as the promise itself.
     *
     * The promise rather than the result, so that two cells asking at once
     * share one fetch and a rejection is cached as firmly as an answer — a
     * metadata call that fails once should not be retried on every render.
     * Cleared when the table changes underneath the control and in
     * `destroy()`.
     */
    private metadata = new Map<string, Promise<Option[]>>();
    private metadataEntity = '';

    /**
     * What a lookup write needs and reads once: the bound table's many-to-one
     * relationships (one fetch per table), each lookup column's targets (one
     * metadata call per column) and each target table's entity set name (one
     * per table). Promises, for the reason `metadata` above holds promises,
     * and cleared with it.
     */
    private relationships: Promise<Relationship[]> | null = null;

    /** The table's real primary key, read once. See `primaryIdFor`. */
    private primaryId: Promise<string> | null = null;
    private targets = new Map<string, Promise<string[]>>();
    private entitySets = new Map<string, Promise<string>>();

    /** The row most recently added through the New button, for `getOutputs`. */
    private createdRecordId = '';

    /* --------------------------------------------------------------- editing */

    /**
     * The row most recently written, for `getOutputs`.
     *
     * **The only piece of editing state left in this class**, and the reason is
     * worth stating because 0.3.0 shipped with the rest of it here and the
     * feature did not work on a real form.
     *
     * Every other piece — which cell is open, what the platform said about each
     * cell, the optimistic overrides, the in-flight writes, the last refusal —
     * is *transient UI state*, and changing it has to repaint the table.
     * `notifyOutputChanged()` does not repaint a React control: it tells the
     * platform an **output** changed, and the platform answers by calling
     * `getOutputs()`. A repaint happens when `updateView` runs and returns a new
     * element, and that is the platform's decision, not this control's.
     *
     * Observed 2026-09-09 on a real Accounts subgrid: the pencil rendered, a
     * click called `onBeginEdit`, the class field was set, `notifyOutputChanged`
     * fired — and nothing happened on screen, because nothing re-rendered.
     *
     * `dev/host.js` hid it. `settle()` re-drives the control explicitly, so a
     * test that called `onBeginEdit` and then `settle()` was modelling a repaint
     * the platform never performs. That is the fourth time this release the rig
     * has been more generous than the platform.
     *
     * So all of it now lives in `DataTableControl` as React state, where a
     * `setState` repaints without asking the platform for anything. What crosses
     * back into this class is only what the platform actually needs: the write
     * itself, and this id.
     */
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
            // `ask`, because a host can publish a method and refuse to run it —
            // measured twice on canvas, 2026-09-21. Losing the resize
            // subscription costs column widths; letting the throw out costs the
            // whole control.
            ask(() => context.mode.trackContainerResize(true));
        }
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const dataset = context.parameters.records;
        const mode = (context.parameters.selectionMode.raw ?? 'single') as SelectionMode;

        /*
         * **First, before anything else.** A running export re-enters
         * `updateView` on every page it asks for, and this is the pass that
         * harvests one and asks for the next. Everything below renders.
         */
        this.driveExport(context, dataset);

        this.blankLabel = context.resources.getString('DataTable_GroupBlank');

        this.applyPageSize(context, dataset);

        if (mode === 'none' && this.selected.length > 0) {
            this.selected = [];
            dataset.clearSelectedRecordIds();
            this.notifyOutputChanged();
        }

        const columns = visibleColumns(dataset.columns ?? []);
        const pageIds = this.pageIds(dataset);

        /*
         * Grouping, resolved against the view's real columns.
         *
         * `groupBy` unset is the ordinary state and means this renders exactly
         * what 0.5.0 rendered — which is why the property has no default.
         *
         * The primary key is **guessed** here and not read, and that is a
         * known gap rather than a decision: `dataset.columns` does not carry
         * it (measured — the layout held ten columns and the primary key was
         * not among them), so the real answer is `PrimaryIdAttribute` from
         * metadata. `guessPrimaryId` is right for every ordinary table and for
         * the seventeen system activity tables, and **wrong for a custom
         * activity table**, whose key is `activityid` and which no list can
         * know about. The metadata read replaces it; until then a custom
         * activity table's aggregate is refused by the server rather than
         * answered wrongly.
         */
        const groupSpec = buildSpec(
            dataset.getTargetEntityType(),
            guessPrimaryId(dataset.getTargetEntityType()),
            /*
             * **Every column the dataset carries, not only the visible ones.**
             *
             * A hidden column is still fetched and still readable, and
             * grouping by one is a real thing to want — "group by owner"
             * without an owner column taking up width in the table. Validating
             * against `visibleColumns` refused exactly that, and the refusal
             * was indistinguishable from a typo: the maker got "ownerid is not
             * a column on this view" about a column that is on the view.
             *
             * The measure cells still align to the **visible** columns, which
             * is a different question and the right answer to it.
             */
            dataset.columns ?? [],
            rawInput(context, 'groupBy'),
            rawInput(context, 'aggregates'),
        );

        /*
         * Reported to the **console**, once per distinct set, and not to the
         * form.
         *
         * A mistyped column name is a design-time error: the person who can
         * fix it is in the maker portal, and putting it on the form shows
         * every user of that form an error only one of them can act on. What
         * the maker gets instead is the list of columns that do exist, which
         * is what a property-set's column picker would have given for free —
         * the trade the manifest argues.
         */
        if (groupSpec.problems.length > 0) {
            const reported = groupSpec.problems.map((problem) => problem.input).join('|');

            if (reported !== this.reportedGroupProblems) {
                this.reportedGroupProblems = reported;

                for (const problem of groupSpec.problems) {
                    // eslint-disable-next-line no-console
                    console.warn('DataTable: ' + describeProblem(problem, columns));
                }
            }
        }

        const groupRoute = this.groupRoute(context, dataset, groupSpec.spec);


        /*
         * `isControlDisabled` is part of the condition rather than checked in
         * the component: a disabled control must not offer an editor at all,
         * and asking the platform about editability for cells nobody can reach
         * is a fetch per cell bought for nothing.
         */
        const editingOn =
            (context.parameters.enableEditing.raw ?? false) && !context.mode.isControlDisabled;
        const allowedColumns = editableColumnSet(context.parameters.editableColumns.raw);

        /*
         * Two facts about the *host*, decided once here and handed down as
         * function-or-null — see `loadOptions` in `IProps` for why that shape
         * and not `canEdit`'s per-call null.
         */
        const readMetadata = metadataReader(context);
        const openForm = formOpener(context);
        const lookups = lookupHost(context);

        /*
         * The cache is per table. A control rebound to another view — the
         * view selector on a subgrid does this — must not answer the new
         * table's `industrycode` with the old one's options, nor write its
         * lookups with the old one's navigation properties.
         */
        const entity = dataset.getTargetEntityType?.() ?? '';

        if (entity !== this.metadataEntity) {
            this.metadata.clear();
            this.relationships = null;
            this.targets.clear();
            this.metadataEntity = entity;
        }

        const props: IProps = {
            dataset,
            columns,
            groupRoute,
            groupSort: (rawInput(context, 'groupSort') ?? 'label') as GroupSort,
            groupPlan: groupSpec.spec ? aliasPlan(groupSpec.spec) : null,
            /*
             * Expanding and collapsing, as one call. `null` collapses.
             *
             * The conditions arrive already built by `expandConditions`, which
             * returns `null` for a group kind that cannot be expressed as a
             * filter — a date bucket needs a `between` pair `buildFilter` does
             * not emit. The component withholds the chevron in that case, so
             * this is never called with an inexpressible group.
             */
            onExpand: (conditions) => {
                this.expansion = conditions ?? [];
                this.page = 1;
                this.applyFilter(context);
            },
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
            filterOps: this.filterOps,
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
            onSort: (columnName: string, additive: boolean): void =>
                this.sortBy(dataset, columnName, additive && boolInput(context, 'enableMultiSort')),
            canMultiSort: boolInput(context, 'enableMultiSort') && Boolean(dataset.sorting),
            onFilter: (columnName: string, value: string): void =>
                this.setFilterValue(context, columnName, value),
            onFilterOp: (columnName: string, op: DateOp): void =>
                this.setFilterOp(context, columnName, op),
            onClearFilter: (columnName: string): void => this.clearFilterValue(context, columnName),
            onClearFilters: (): void => this.clearFilters(context),
            onGoToPage: (page: number): void => this.goToPage(dataset, page),
            onPageSize: (size: number): void => this.choosePageSize(context, size),
            onExport: (): void => this.beginExport(context, dataset),
            onCancelExport: (): void => this.cancelExport(context, dataset),

            /*
             * Formatting an aggregate, which no record owns. `formatting` is
             * typed as always present and is absent on the hub's demo harness,
             * so each method is detected rather than assumed — the same rule
             * the date formatter above follows. A currency column gets the
             * user's currency, everything else a decimal, and a host with
             * neither gets the plain number rather than nothing.
             */
            formatNumber: (value: number, column: string): string => {
                const currency = (dataset.columns ?? [])
                    .some((each) => each.name === column && each.dataType.indexOf('Currency') === 0);
                const format = context.formatting as {
                    formatCurrency?: (value: number) => string;
                    formatDecimal?: (value: number) => string;
                } | undefined;

                if (currency && typeof format?.formatCurrency === 'function') {
                    return format.formatCurrency(value);
                }

                if (typeof format?.formatDecimal === 'function') {
                    return format.formatDecimal(value);
                }

                return String(value);
            },
            /*
             * The machine's state, flattened to what the component needs to
             * draw. It never sees the state object itself, for the same reason
             * it never sees `context`: rendering is not where this is decided.
             */
            exporting: this.exportState.phase === 'collecting'
                ? {
                    page: this.exportState.awaitingPage ?? this.exportState.nextPage,
                    rows: this.exportState.rows.length,
                    stopping: this.exportState.cancelled,
                }
                : null,
            exportNote: this.exportState.phase === 'failed' ? this.exportState.message : this.exportNote,
            onNextPage: (): void => this.nextPage(dataset),
            onPreviousPage: (): void => this.previousPage(dataset),
            onToggleRow: (id: string): void => this.toggleRow(dataset, id, mode),
            onToggleAll: (ids: string[], selectAll: boolean): void =>
                this.toggleAll(dataset, ids, selectAll),
            onOpenRecord: (id: string): void => this.openRecord(dataset, id),

            enableEditing: editingOn,
            allowedColumns,
            /*
             * **The measured width, applied as a ceiling on the root.**
             *
             * Without it `overflow-x: auto` on the scroll wrapper is inert, and
             * that is not a CSS problem with a CSS answer. A form section can
             * hand a control a shrink-to-fit parent — `fit-content`,
             * `inline-block`, a table cell — which takes its width *from* its
             * content, so the control's own `width: 100%` resolves against a
             * number the control itself produced. Nothing written inside the
             * control breaks that circle; the way out is a number from outside
             * it, which is what `trackContainerResize(true)` in `init` buys.
             *
             * 0.3.0 called that and used the answer only for the pinning clamp,
             * so on a real subgrid the table drew wider than its box, was
             * clipped by an ancestor, and showed no scrollbar at all — the
             * documented symptom, observed 2026-09-09.
             */
            maxWidth: context.mode.allocatedWidth > 0 ? context.mode.allocatedWidth : null,
            /**
             * Ask the platform whether this cell may be written, or `null` when
             * the host cannot write at all.
             *
             * Returning the promise rather than resolving it here is the whole
             * point: the component owns the answer, so it can repaint when it
             * lands. This class cannot.
             */
            canEdit: (id: string, column: string): Promise<boolean> | null => {
                const record = editableRecord(dataset.records[id]);

                return record ? Promise.resolve(record.isEditable(column)) : null;
            },
            /*
             * Routed by the column's kind rather than by the value's shape: a
             * lookup is the one column whose write leaves the record, and
             * `null` — a clear — looks the same for every kind.
             */
            onCommitEdit: (id: string, column: string, value: unknown): Promise<void> => {
                const target = (dataset.columns ?? []).find((candidate) => candidate.name === column);

                return target && editKindFor(target) === 'lookup'
                    ? this.writeLookup(lookups, dataset, id, column, lookupValue(value))
                    : this.writeCell(dataset, id, column, value);
            },

            /*
             * `null` where any of the four surfaces a lookup edit needs is
             * missing — canvas, the hub's harness, a host that declined
             * `WebAPI`. The component reads `null` as "lookup cells stay
             * read-only", which is exactly 0.4.x.
             */
            pickLookup: lookups
                ? (column: string): Promise<LookupValue | null> =>
                    this.pickLookup(lookups, entity, column)
                : null,

            /*
             * `null` where the host has no `utils.getEntityMetadata` — canvas,
             * the hub's harness, a model-driven host that declined the
             * feature. The component reads `null` as "no choice editor and no
             * choice box", which is exactly 0.3.4.
             */
            loadOptions: readMetadata
                ? (column: string): Promise<Option[]> =>
                    this.optionsFor(readMetadata, entity, column)
                : null,

            /*
             * `formatDateShort` renders in the Dataverse user's zone rather
             * than the browser's — the `pcf-date-range-picker` finding — which
             * is what makes a pending date read like the platform's own cell
             * beside it. Detected per method: `formatting` is typed as always
             * present, and the hub's harness supplies a bag without it.
             */
            formatDate:
                typeof context.formatting?.formatDateShort === 'function'
                    ? (value: Date, includeTime: boolean): string =>
                        // The platform's answer where it gives one, the
                        // browser's where it refuses. This runs inside render,
                        // so a throw is fatal rather than degrading — and a
                        // date in the wrong zone is a far smaller wrong than no
                        // table at all.
                        ask(() => context.formatting.formatDateShort(value, includeTime))
                        ?? (includeTime ? value.toLocaleString() : value.toLocaleDateString())
                    : null,

            canCreate:
                (context.parameters.enableCreate.raw ?? false)
                && !context.mode.isControlDisabled
                && openForm !== null,
            onCreate: (): Promise<string | null> =>
                openForm
                    ? this.createRecord(openForm, parentReference(context), dataset)
                    : Promise.resolve(null),
        };

        return React.createElement(DataTableControl, props);
    }

    /**
     * The option list for one Choice column, fetched once per column.
     *
     * `getEntityMetadata(entity, [column])` — the second argument narrows the
     * request to the one attribute, which is what keeps this a small call on a
     * table with two hundred columns. The result is a class instance whose
     * `Attributes.get(column)` is the node `parseOptions` reads; see that
     * function for the shape, which was measured rather than assumed.
     */
    private optionsFor(
        read: MetadataReader,
        entity: string,
        column: string,
    ): Promise<Option[]> {
        const cached = this.metadata.get(column);

        if (cached) {
            return cached;
        }

        const fetched = read(entity, [column]).then((metadata) => {
            const attributes = (metadata as { Attributes?: { get?: (name: string) => unknown } })
                ?.Attributes;

            return parseOptions(
                attributes && typeof attributes.get === 'function' ? attributes.get(column) : null,
            );
        });

        this.metadata.set(column, fetched);

        return fetched;
    }

    /**
     * The tables one lookup column can point at, fetched once per column.
     *
     * Same call as `optionsFor` — `getEntityMetadata(entity, [column])` — and
     * a different key off the node: `Targets`, which a `Lookup.Simple` carries
     * at the top and a `Lookup.Customer` only under `attributeDescriptor`.
     * `lookupTargets` reads both. Cached separately from the option lists
     * because the two are asked at different moments and a rejection of one
     * should not be the answer to the other.
     */
    private targetsFor(read: MetadataReader, entity: string, column: string): Promise<string[]> {
        const cached = this.targets.get(column);

        if (cached) {
            return cached;
        }

        const fetched = read(entity, [column]).then((metadata) => {
            const attributes = (metadata as { Attributes?: { get?: (name: string) => unknown } })
                ?.Attributes;

            return lookupTargets(
                attributes && typeof attributes.get === 'function' ? attributes.get(column) : null,
            );
        });

        this.targets.set(column, fetched);

        return fetched;
    }

    /**
     * The entity set name of a target table — the plural the bind value is
     * spelled with — fetched once per table.
     *
     * `getEntityMetadata(table)` with no column list, as `pcf-tag-list` does;
     * `EntitySetName` answered `contacts` and `accounts` on the probe. A node
     * without one rejects rather than guessing `${table}s`, because a guess
     * that is wrong writes to a URL that does not exist and the platform's
     * refusal names neither the table nor the guess.
     */
    private entitySetFor(read: MetadataReader, table: string): Promise<string> {
        const cached = this.entitySets.get(table);

        if (cached) {
            return cached;
        }

        const fetched = read(table, []).then((metadata) => {
            const set = (metadata as { EntitySetName?: unknown })?.EntitySetName;

            if (typeof set !== 'string' || set === '') {
                throw new Error(`No entity set name for ${table}.`);
            }

            return set;
        });

        this.entitySets.set(table, fetched);

        return fetched;
    }

    /**
     * The bound table's many-to-one relationships, fetched once per table.
     *
     * **A same-origin `fetch`, not `context.webAPI`.** `retrieveMultipleRecords`
     * addresses records by entity logical name and cannot reach
     * `EntityDefinitions` — the finding `pcf-grid-data-bars` made for numeric
     * ranges applies to navigation properties for the same reason. Reading
     * metadata needs no feature declaration and no privilege beyond being
     * signed in; the probe read it in 84 ms.
     *
     * It is the navigation property that makes this necessary: the bind key
     * for a lookup is *not* its logical name by rule and *not* its schema name
     * by rule — on the probe table it was the logical name, and a Customer
     * lookup has two — so the control reads the answer rather than deriving it.
     */
    /**
     * The table's primary key, from metadata.
     *
     * **`guessPrimaryId` is not good enough, and this is measured rather than
     * cautious.** It derives `{entity}id` with a hard-coded set of the
     * seventeen *system* activity tables as the exception — the shape
     * `pcf-chart-view` uses. A **custom** activity table's key is `activityid`
     * too, and no list can know about a table a maker created this morning.
     *
     * Measured 2026-09-20 on `cll_sitevisit`: the derived `cll_sitevisitid`
     * was refused with `0x80041103`, *"The specified field does not exist"*,
     * and because a refusal is whole-query it took the group counts with it.
     * So the guess fails safe — nothing wrong is reported — but it fails, and
     * grouping simply does not work on a custom activity table without this.
     *
     * Read through the same same-origin `fetch` the relationships use, because
     * `context.webAPI` cannot address `EntityDefinitions`. Cached for the life
     * of the control, and **the guess is the fallback** for a host that
     * refuses the read — which is the right way round: derive when you cannot
     * ask, rather than ask only when the derivation looks doubtful.
     */
    private primaryIdFor(host: LookupHost, entity: string): Promise<string> {
        if (this.primaryId) {
            return this.primaryId;
        }

        const url = `${host.clientUrl}/api/data/v9.2/EntityDefinitions(LogicalName='`
            + `${encodeURIComponent(entity)}')?$select=PrimaryIdAttribute`;

        const read = fetch(url, {
            headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
            credentials: 'same-origin',
        })
            .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
            .then((body: { PrimaryIdAttribute?: unknown }) => {
                const name = body && body.PrimaryIdAttribute;

                return typeof name === 'string' && name !== '' ? name : guessPrimaryId(entity);
            })
            .catch(() => guessPrimaryId(entity));

        this.primaryId = read;

        return read;
    }

    private relationshipsFor(host: LookupHost, entity: string): Promise<Relationship[]> {
        if (this.relationships) {
            return this.relationships;
        }

        const url =
            `${host.clientUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(entity)}')`
            + '/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity,'
            + 'ReferencingEntityNavigationPropertyName';

        const fetched = fetch(url, {
            headers: {
                Accept: 'application/json',
                'OData-MaxVersion': '4.0',
                'OData-Version': '4.0',
            },
            credentials: 'same-origin',
        }).then((response) => {
            if (!response.ok) {
                throw new Error(`Relationships for ${entity} could not be read (${response.status}).`);
            }

            return response.json().then(parseRelationships);
        });

        this.relationships = fetched;

        return fetched;
    }

    /**
     * Open the platform's lookup dialog for one column, and hand back the pick.
     *
     * Resolves a `LookupValue` in this control's spelling, or `null` for a
     * dialog the reader closed — measured 2026-09-11 as a resolve of `[]`,
     * not `undefined` and not a rejection, so the read below treats anything
     * that is not a non-empty array as a cancel. A pick arrives with the GUID
     * braced and upper-case; `lookupValue` normalises it.
     *
     * The dialog is offered every table the column can point at, which for a
     * Customer lookup is two; the resolved `entityType` says which was picked
     * and is what `writeLookup` chooses the navigation property by. A column
     * whose metadata names no target gets no dialog — there is nothing to
     * search — and the rejection is the sentence the cell shows.
     */
    private pickLookup(
        host: LookupHost,
        entity: string,
        column: string,
    ): Promise<LookupValue | null> {
        return this.targetsFor(host.readMetadata, entity, column).then((targets) => {
            if (targets.length === 0) {
                throw new Error(`${column} names no table to search.`);
            }

            return host
                .pick({
                    entityTypes: targets,
                    defaultEntityType: targets[0],
                    allowMultiSelect: false,
                })
                .then((picked) => {
                    const first = Array.isArray(picked) ? picked[0] : undefined;

                    return first ? lookupValue(first) : null;
                });
        });
    }

    /**
     * Write one lookup cell through the Web API, and report the row afterwards.
     *
     * `updateRecord(entity, id, { '<navigationProperty>@odata.bind':
     * '/<entitySet>(<guid>)' })` — or `null` in place of the path to clear,
     * which the probe measured as accepted and clearing (2026-09-13). The
     * `$ref` DELETE the Web API also offers for a clear works too and is not
     * used: this control makes no write the feature declaration does not
     * cover.
     *
     * **A clear names the navigation property of the value being cleared.** A
     * Customer lookup has one per target, and `null` on the wrong one is a
     * no-op rather than an error — so the current reference's `entityType`
     * picks it, and clearing a cell that is already empty writes nothing at
     * all.
     *
     * Everything about how this looks while it happens belongs to the
     * component, as with `writeCell`; the rejection is turned into the one
     * readable sentence a `webAPI` fault carries, because the raw `message`
     * of a payload fault opens with a generic line and runs into a stack
     * trace.
     */
    private writeLookup(
        host: LookupHost | null,
        dataset: DataSet,
        id: string,
        column: string,
        value: LookupValue | null,
    ): Promise<void> {
        if (!host) {
            return Promise.reject(new Error('This host cannot write a lookup.'));
        }

        const entity = dataset.getTargetEntityType();
        const current = lookupValue(dataset.records[id]?.getValue(column));
        const target = value?.entityType ?? current?.entityType ?? null;

        // Nothing to clear, so nothing to write — and no navigation property
        // to name it by either.
        if (value === null && target === null) {
            return Promise.resolve();
        }

        const started = Date.now();
        const since = (): string => `+${Date.now() - started}ms`;

        return Promise.all([
            this.relationshipsFor(host, entity),
            value ? this.entitySetFor(host.readMetadata, value.entityType) : Promise.resolve(null),
        ])
            .then(([relationships, entitySet]) => {
                const key = navigationProperty(relationships, column, target as string);

                if (!key) {
                    throw new Error(`No relationship from ${column} to ${target}.`);
                }

                return host.update(entity, id, {
                    [`${key}@odata.bind`]: value && entitySet ? `/${entitySet}(${value.id})` : null,
                });
            })
            .then(() => {
                // The same rule as `writeCell`: `refresh()` is part of the
                // write. Measured 2026-09-13: the new reference was on the
                // next pass, about a second later.
                dataset.refresh();

                this.editedRecordId = id;
                this.notifyOutputChanged();
            })
            .catch((error: unknown) => {
                console.warn('[DataTable] lookup write failed', column, since(), error);

                throw new Error(faultMessage(error, 'The lookup could not be saved.'));
            });
    }

    /**
     * Open the quick create form, and report the row it made.
     *
     * Resolves the new id, or `null` for a form the reader dismissed — measured
     * 2026-09-11 as `{ savedEntityReference: null }`, not `[]` and not a
     * rejection, which is why the read below is optional at every step. A saved
     * row resolves `savedEntityReference[0].id` braced and upper-case, and is
     * normalised to the spelling every other output uses.
     *
     * `createFromEntity` seeds the parent so the row lands in this subgrid; on
     * a main grid there is no parent and the option is left out. `refresh()`
     * is what puts the row on screen — the same argument `writeCell` makes.
     */
    private createRecord(
        open: FormOpener,
        parent: { entityType: string; id: string } | null,
        dataset: DataSet,
    ): Promise<string | null> {
        const options: Record<string, unknown> = {
            entityName: dataset.getTargetEntityType(),
            useQuickCreateForm: true,
        };

        if (parent) {
            options.createFromEntity = { entityType: parent.entityType, id: parent.id };
        }

        return Promise.resolve()
            .then(() => open(options))
            .then((result) => {
                const saved = (result as { savedEntityReference?: { id?: unknown }[] | null })
                    ?.savedEntityReference;
                const id = bareGuid(saved?.[0]?.id);

                if (id === null) {
                    return null;
                }

                dataset.refresh();
                this.createdRecordId = id;
                this.notifyOutputChanged();

                return id;
            })
            .catch((error: unknown) => {
                console.warn('[DataTable] create failed', error);

                throw error;
            });
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

    /**
     * The record this subgrid sits on, and everything needed to work out which
     * lookup points at it — or `null` on a main grid.
     *
     * `mode.contextInfo` is undocumented and typed as nothing; measured
     * 2026-09-20 as `{ entityTypeName, entityId, entityRecordName }` on a form
     * subgrid, and **with no `entityId` at all on a main grid** — so `entityId`
     * is the test for "under a record", not the presence of the object.
     */
    private parentReading(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        entity: string,
    ): ParentReading | null {
        const info = (context.mode as { contextInfo?: Record<string, unknown> }).contextInfo;
        const entityType = info && typeof info.entityTypeName === 'string' ? info.entityTypeName : '';
        const id = info && typeof info.entityId === 'string' ? info.entityId : '';

        if (entityType === '' || id === '') {
            return null;
        }

        const host = lookupHost(context);
        const typed = (rawInput(context, 'parentLookup') ?? '').trim().toLowerCase();
        const records = (dataset.sortedRecordIds ?? [])
            .map((recordId) => dataset.records[recordId])
            .filter((record) => Boolean(record));

        /*
         * Which columns the dataset actually loaded — **every column it
         * carries, hidden ones included**, not just the visible ones. This is
         * the only thing that knows; `getValue` answers `null` for an unloaded
         * column, a non-existent column and an empty one alike.
         */
        const fetched = (dataset.columns ?? []).map((column) => column.name);

        return {
            record: { entityType, id },
            explicit: typed === '' ? null : typed,
            /*
             * Reuses the `ManyToOneRelationships` read this control already
             * makes for a lookup's `@odata.bind` key — same URL, same cache,
             * filtered to the form's table. One metadata call serves both.
             */
            candidates: () => (host
                ? this.relationshipsFor(host, entity).then((all) => all
                    .filter((relationship) => relationship.target === entityType)
                    .map((relationship) => relationship.column))
                : Promise.resolve([])),
            confirmed: (column) => rowsConfirm(records, column, id, fetched),
        };
    }

    /**
     * Everything the server route needs, or `null` when it is withheld.
     *
     * Built fresh on every `updateView` and handed to the component as a
     * **loader** rather than resolved here — the `pcf-kanban-board` lesson:
     * storing the answer on this instance and calling `notifyOutputChanged()`
     * to get a repaint does not work, because that call announces that
     * *outputs* changed and these did not, so the platform has no reason to
     * call `updateView` again.
     *
     * `key` concatenates everything the answer depends on, so a change re-runs
     * the query and a stale answer for an old key is dropped.
     *
     * The route is withheld — `null` — where sending the query would produce a
     * number that is **wrong rather than missing**: no `webAPI` (canvas),
     * nothing to group by, or a runtime filter that cannot be spelled in
     * FetchXML, which would count records the grid is not showing.
     */
    private groupRoute(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        spec: GroupSpec | null,
    ): GroupRoute | null {
        const api = (context as { webAPI?: WebApiReader }).webAPI;

        if (!api || !spec) {
            return null;
        }

        /*
         * **The filter row only — never the expansion.**
         *
         * `dataset.filtering` holds both: `applyFilter` composes the maker's
         * filter row with the conditions that narrow the table to one expanded
         * group. Reading it back here fed the expansion into the aggregate,
         * which re-ran and returned *only the expanded group* — so opening a
         * group made every other group's header vanish, and getting back
         * needed a second click to collapse.
         *
         * Found on the form, 2026-09-20, and it was a design error rather than
         * a bug: **the expansion narrows the rows, not the group list.** The
         * group list answers "what is in this view", which an expansion does
         * not change. Building the aggregate's filter from the filter row
         * alone keeps the headers on screen *and* stops the route key moving,
         * so expanding costs no round trip at all.
         */
        const filter = filterToFetchXml(buildFilter(
            this.filters,
            visibleColumns(dataset.columns ?? []),
            this.filterOps,
        ) as Filter | null);

        if (!filter.translatable) {
            return null;
        }

        const plan = aliasPlan(spec);
        const host = lookupHost(context);
        const loose = dataset as { getViewId?: () => unknown };
        const rawViewId = typeof loose.getViewId === 'function' ? ask(() => loose.getViewId!()) : null;
        const viewId = typeof rawViewId === 'string' ? rawViewId.replace(/[{}]/g, '').toLowerCase() : '';
        const parent = this.parentReading(context, dataset, spec.entity);

        return {
            key: [
                spec.entity,
                spec.groups.map((group) => group.column + ':' + group.kind).join('|'),
                spec.measures.map((measure) => measure.aggregate + ':' + measure.column).join('|'),
                viewId,
                filter.xml,
                parent ? parent.record.entityType + '/' + parent.record.id + '/' + (parent.explicit ?? '') : '',
            ].join('~'),
            load: () => this.loadGroups(api, host, spec, plan, viewId, filter.xml, parent),
        };
    }

    /** The server route, run: resolve the parent, read the view, send the aggregate. */
    private loadGroups(
        api: WebApiReader,
        host: LookupHost | null,
        spec: GroupSpec,
        plan: AliasPlan,
        viewId: string,
        filterXml: string,
        parent: ParentReading | null,
    ): Promise<GroupAnswer> {
        const blank = this.blankLabel;
        const refused = (message: string | null): GroupAnswer =>
            ({ readings: [], source: 'client-refused', message });

        const resolved: Promise<ParentResolution> = parent
            ? resolveParentLookup(parent)
            : Promise.resolve({ column: null, by: 'unrelated', candidates: [] });

        /*
         * The real primary key, in parallel with the parent resolution rather
         * than before it — both are cached metadata reads and neither depends
         * on the other, so on every pass after the first this costs nothing at
         * all.
         */
        const keyed: Promise<string> = host
            ? this.primaryIdFor(host, spec.entity)
            : Promise.resolve(spec.primaryId);

        return Promise.all([resolved, keyed]).then(([resolution, primaryId]) => {
            /*
             * A subgrid whose parent cannot be settled withholds the route
             * rather than counting the whole table.
             *
             * `unrelated` is **not** that case: it means the rows say this
             * grid is not narrowed to the record, and then no condition is the
             * right answer — measured before the probe subgrid was switched to
             * related-records only, where the table held 56 and the subgrid
             * reported 56.
             */
            if (parent && withholdsRoute(resolution)) {
                // eslint-disable-next-line no-console
                console.warn(
                    'DataTable: the lookup relating this subgrid to its record could not be settled ('
                    + resolution.by + '; candidates: ' + (resolution.candidates.join(', ') || 'none')
                    + '). Counting the whole view is withheld, because it would report a number larger '
                    + 'than the grid is showing. Set the Parent lookup property, or "none" if this '
                    + 'subgrid is not related to the record.',
                );

                return refused(null);
            }

            const parentXml = resolution.column && parent
                ? parentFilterXml(resolution.column, parent.record.id)
                : '';

            return readViewFetchXml(api, viewId).then((viewXml) => loadAggregate(api, {
                // The key from metadata, not the one guessed in `updateView`.
                spec: { ...spec, primaryId },
                plan,
                viewXml,
                filterXml: parentXml + filterXml,
            }).then(
                (rows) => {
                    /*
                     * Every alias comes back naming its own column, so a
                     * response that does not describe the query sent is a
                     * caught error rather than a mislabelled column. Free, and
                     * the only integrity check available on a route whose
                     * output is otherwise plausible whatever went in.
                     */
                    if (!describesPlan(rows, plan)) {
                        // eslint-disable-next-line no-console
                        console.warn('DataTable: the aggregate response does not describe the query sent.');

                        return refused(null);
                    }

                    return {
                        readings: rows.map((row) => toGroupReading(row, plan, blank)),
                        source: 'server' as GroupSource,
                        message: null,
                    };
                },
                (refusal: Refusal) => refused(
                    // Only a message fit to show. Measured: the server can
                    // send a template with `{0}` still in it.
                    refusal.renderable ? refusal.message : null,
                ),
            ));
        });
    }


    /**
     * Drive one pass of a running export.
     *
     * Called at the **top** of `updateView`, before anything else, and this is
     * the only feature in the control that re-enters the lifecycle
     * deliberately: every page it asks for produces an `updateView`, which is
     * how the progress repaints for free and how the next page gets asked for.
     *
     * The guard is `shouldHarvest`: the machine is running, a page was asked
     * for, and the platform is no longer loading. Any other pass falls through
     * and renders. **Exactly one fetch is outstanding and the page number
     * strictly increases**, which is what makes it terminate.
     *
     * State lives on the instance rather than in React, and this is the one
     * feature where that is safe — because the export drives `updateView`
     * itself. The editing state had to move into the component for exactly the
     * opposite reason: nothing re-entered the lifecycle to repaint it.
     */
    private driveExport(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const state = this.exportState;

        if (!shouldHarvest(state, Boolean(dataset.loading))) {
            return;
        }

        /*
         * **The watchdog is not cleared here.** It belongs to the request, not
         * to the pass. Clearing it at the top and re-arming it on every
         * `repeat` reset the thirty seconds on each pass the platform sent —
         * so a host that keeps re-rendering while a page never lands starved
         * the only failure signal this feature has, and the export hung
         * instead of ending. Observed on a real subgrid, 2026-09-21: an export
         * stopped on page two and sat there until the reader pressed Stop.
         *
         * `askForExportPage` clears and re-arms it when a new page is asked
         * for, and `finishExport` clears it. Those are the only two moments
         * that change what is outstanding.
         */
        const columns = visibleColumns(dataset.columns ?? []);
        const arrival = harvest(
            state,
            dataset.sortedRecordIds ?? [],
            (id) => {
                const record = dataset.records[id];

                return columns.map((column) => (record ? record.getFormattedValue(column.name) : ''));
            },
        );

        // The page asked for has not landed — these are rows already held. Keep
        // waiting on the request already outstanding: do not advance past it,
        // do not ask again, and leave its watchdog running.
        if (arrival.kind === 'repeat') {
            return;
        }

        const collected = arrival.state;

        if (arrival.kind === 'end') {
            this.finishExport(context, dataset, collected);

            return;
        }

        const next = nextPageFor(collected, Boolean(dataset.paging.hasNextPage));

        if (next === null) {
            this.finishExport(context, dataset, collected);

            return;
        }

        this.exportState = { ...collected, awaitingPage: next };
        this.askForExportPage(context, dataset, next);
        this.notifyOutputChanged();
    }

    /**
     * Ask for one page.
     *
     * `loadExactPage` where the host has it — measured moving cleanly in both
     * directions and **not** accumulating. Otherwise `loadNextPage(true)`,
     * which only steps forward by one and is therefore exactly what this loop
     * needs; on the accumulating platform it hands back the whole range, which
     * the dedupe already absorbs and which makes the loop *cheaper*.
     *
     * `goToPage` refuses a multi-page jump on that host, and rightly — but
     * this never makes one.
     */
    private askForExportPage(context: ComponentFramework.Context<IInputs>, dataset: DataSet, page: number): void {
        const paging = dataset.paging as {
            loadExactPage?: (page: number) => void;
            loadNextPage?: (only: boolean) => void;
        };

        this.startExportWatchdog(context, dataset);

        /*
         * **Page one is a jump; every page after it is a step.**
         *
         * Measured on a real subgrid, 2026-09-21, with the export tracing this
         * method used to print. `loadExactPage(1)` was honoured — 250 rows,
         * `pageSize` 250, `hasNextPage` true, `totalResultCount` 1222. The very
         * next call, `loadExactPage(2)`, was **not**: the platform re-rendered
         * holding page one's rows, left `firstPageNumber` at 1, and reported
         * `loading: false`. It was not fetching and nothing further arrived.
         *
         * That single fact explains both failures this feature has had. The
         * stall is the obvious one. The earlier short file — 972 of 1,222, with
         * pages one, three, four and five present — is the same thing before
         * the guards existed: an ignored request was harvested as though it had
         * answered, the counter advanced past a page nobody had asked for
         * again, and whichever later jumps happened to land left the gaps.
         *
         * So the walk does not use page numbers any more. `loadNextPage` is the
         * dataset's own "give me more", it cannot be asked for a page that does
         * not follow the one loaded, and `hasNextPage` says when to stop. On
         * this platform it accumulates — `pageIds()` records the measurement
         * that `loadOnlyNewPage` is not honoured — which `harvest`'s dedupe has
         * absorbed since the first version of this machine.
         *
         * `loadExactPage` keeps exactly one job: putting the reader back on
         * their page afterwards, which is a single jump and is what it was
         * actually measured doing.
         */
        if (typeof paging.loadExactPage === 'function') {
            paging.loadExactPage(page);

            return;
        }

        if (page <= 1) {
            dataset.paging.reset();

            return;
        }

        if (typeof paging.loadNextPage === 'function') {
            paging.loadNextPage(true);
        }
    }

    /**
     * Give up on a page that never arrived.
     *
     * **`loadExactPage` returns `void` and has no rejection to catch**, so a
     * fetch that never lands is indistinguishable from one still in flight.
     * `dataset.error` covers a refusal the platform reports; this covers the
     * silence, which would otherwise leave "Reading page 4…" on screen for the
     * life of the form.
     *
     * Cleared in `destroy()` beside `filterTimer`, for the same reason: a form
     * the user navigated away from mid-export.
     */
    /**
     * The only failure signal a page that never lands can produce.
     *
     * **It has to finish the export, not record that it failed.** Until
     * 0.6.6 it set `phase: 'failed'` and called `notifyOutputChanged()` — and
     * that announces *outputs* changed, which gives the platform no reason to
     * call `updateView`. So a stalled export sat on screen saying "Reading page
     * 2" forever: the failure was recorded, nothing rendered it, and no file
     * was written. Observed on a real subgrid, 2026-09-21.
     *
     * This is the same lesson `pcf-kanban-board` is quoted for elsewhere in
     * this file, arrived at a second time from the other direction: nothing
     * re-enters `updateView` on its own, so any state set outside it must carry
     * itself to completion.
     */
    private startExportWatchdog(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        this.clearExportWatchdog();

        this.exportWatchdog = setTimeout(() => {
            const state = this.exportState;

            if (state.phase !== 'collecting') {
                return;
            }

            // Write what there is and put the reader back. A short file that
            // says why beats a control that never comes back.
            this.finishExport(context, dataset, state, this.exportFailure
                .replace('{0}', String(state.awaitingPage ?? state.nextPage))
                .replace('{1}', String(state.rows.length)));
        }, EXPORT_TIMEOUT_MS) as unknown as number;
    }

    private clearExportWatchdog(): void {
        if (this.exportWatchdog !== null) {
            clearTimeout(this.exportWatchdog);
            this.exportWatchdog = null;
        }
    }

    /** Write what was collected, then put the reader back where they were. */
    private finishExport(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        state: Collecting,
        note?: string,
    ): void {
        this.clearExportWatchdog();

        const capped = wasCapped(state);

        this.exportState = { phase: 'idle' };
        // `note` is the watchdog's reason. Passed in rather than set on the
        // instance beforehand, because this line used to clear it again.
        this.exportNote = note !== undefined
            ? note
            : capped
                ? context.resources.getString('DataTable_ExportCapped').replace('{0}', String(state.rows.length))
                : '';

        if (state.rows.length > 0) {
            this.writeCsv(context, dataset, state.headers, state.rows);
        }

        this.putBack(dataset, restorePlan(state));
        this.notifyOutputChanged();
    }

    /**
     * Restore the page size and the page.
     *
     * **Always, however the export ended** — finished, cancelled or failed. It
     * moved the reader off their page and raised their page size to 250 to do
     * its job, and leaving them there would be a side effect of asking for a
     * file.
     *
     * One more round trip, unavoidable. On a host without `loadExactPage` the
     * page cannot be restored at all and the reader lands on page one; that is
     * named in `docs/limitations.md` rather than hidden.
     */
    private putBack(dataset: DataSet, restore: { page: number; pageSize: number }): void {
        const paging = dataset.paging as { loadExactPage?: (page: number) => void };

        // The page size is no longer touched by an export, so there is nothing
        // to put back but the page. Calling `setPageSize` here anyway would
        // re-introduce the very state change that broke paging past page one.
        this.appliedPageSize = restore.pageSize;

        if (restore.page > 1 && typeof paging.loadExactPage === 'function') {
            this.page = restore.page;
            paging.loadExactPage(restore.page);

            return;
        }

        this.page = 1;
        dataset.refresh();
    }

    /**
     * Start a full-view export, or write the loaded rows and be done.
     *
     * The `loaded` scope is 0.5.0's behaviour untouched: no loop, no page
     * movement, no state machine.
     *
     * **`view` no longer raises the page size, and that is the fix for the
     * whole saga.** It used to ask for 250 — measured honoured, echoed back,
     * not clamped — to keep the round trips down. Page one duly arrived at 250.
     * Every request after it failed: `loadExactPage(2)` was ignored outright,
     * `loadNextPage(true)` threw into the platform's own global error handler,
     * and both left the dataset holding page one with `loading: false`.
     * Traced on a real subgrid, 2026-09-21.
     *
     * The reader's pager walks this same view without trouble, and `goToPage`
     * calls exactly what the export calls. The single difference was the
     * resize. So the export stops deviating: it pages the view the way the
     * reader already pages it, at the size already in effect, and the platform
     * state it walks over is the state the platform is already happy with.
     *
     * The cost is round trips, and it is a real cost — a view of 1,222 records
     * at a page size of 25 is 49 of them rather than 5. That is what the page
     * counter and the Stop button are for, and a maker who minds can raise
     * `pageSizeOptions`. A slow export that is correct beats a fast one that
     * silently drops a page, which is what the last three attempts shipped.
     */
    private beginExport(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        if (this.exportState.phase === 'collecting') {
            return;
        }

        const columns = visibleColumns(dataset.columns ?? []);
        const headers = columns.map((column) => column.displayName);

        if (rawInput(context, 'exportScope') !== 'view') {
            this.exportCsv(context, dataset);

            return;
        }

        this.exportNote = '';
        this.exportFailure = context.resources.getString('DataTable_ExportFailed');
        this.exportState = begin(headers, {
            page: this.page,
            pageSize: this.appliedPageSize,
        });

        this.askForExportPage(context, dataset, 1);
        this.notifyOutputChanged();
    }

    /**
     * Stop collecting.
     *
     * **It cannot abort the fetch in flight** — the platform offers no way to —
     * so the page already asked for still arrives and is discarded. That is why
     * the button reports *stopping* rather than *stopped*: a control that said
     * it had stopped and then sat there for another round trip would read as
     * broken. Said in `docs/limitations.md` too.
     */
    private cancelExport(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const state = this.exportState;

        if (state.phase !== 'collecting') {
            return;
        }

        /*
         * **Stop stops.** It used to set `cancelled` and wait for the page in
         * flight to arrive before writing anything — which is fine while pages
         * are arriving and a hang when they are not. Observed on a real
         * subgrid, 2026-09-21: the export stalled, and Stop then did nothing at
         * all, because the only thing that acted on `cancelled` was the arrival
         * of a page that was never coming.
         *
         * There is nothing to wait for. The file can be written now, from what
         * has been collected; the page still in flight arrives to an idle
         * machine and is ignored, which is what `shouldHarvest` is for. The
         * platform offers no way to abort the request itself — that part of
         * `docs/limitations.md` stands — but nothing about it needs to be
         * waited on.
         */
        this.clearExportWatchdog();
        this.finishExport(context, dataset, state);
    }

    public getOutputs(): IOutputs {
        return {
            selectedRecordIds: this.selected.join('\n'),
            openedRecordId: this.openedRecordId,
            editedRecordId: this.editedRecordId,
            createdRecordId: this.createdRecordId,
        };
    }

    /**
     * Write one cell, and report the row afterwards.
     *
     * `setValue` then `save`, both on the record — no `webAPI`, so no
     * `<uses-feature>` and no install-time permission prompt, and it works on a
     * host where WebAPI does not exist at all.
     *
     * **Everything about how this looks while it happens belongs to the
     * component**, which is why this returns a promise and holds no state. The
     * optimistic value, the "saving" note, the rollback and the message are all
     * repaints, and this class cannot cause a repaint: `notifyOutputChanged()`
     * tells the platform an *output* changed, and a React control repaints when
     * `updateView` runs, which is the platform's decision. 0.3.0 kept that state
     * here and the editor never opened on a real form.
     *
     * The rejection is passed on rather than swallowed. A rejected platform call
     * is typed `unknown` and is not reliably an `Error` — the caveat
     * `pcf-kanban-board` records — and `UciError: Invalid snapshot with id
     * undefined` arrives here when the column name is wrong, naming neither the
     * column nor the record. The component turns it into a sentence.
     */
    private writeCell(
        dataset: DataSet,
        id: string,
        column: string,
        value: unknown,
    ): Promise<void> {
        const record = editableRecord(dataset.records[id]);

        if (!record) {
            return Promise.reject(new Error('This host cannot write to a dataset record.'));
        }

        // Timing, for the failure log below. A write that hangs is reported by
        // the component's fifteen-second bound, and "+15003ms" is the tell that
        // separates a refusal from a call that never came back.
        const started = Date.now();
        const since = (): string => `+${Date.now() - started}ms`;

        /*
         * **`Promise.resolve().then(...)` rather than chaining off `setValue`.**
         *
         * `setValue` returns `undefined`, so `record.setValue(...).then(...)`
         * is `.then` on nothing: a `TypeError` thrown synchronously, outside
         * every `.catch` in the chain. Starting from a resolved promise turns a
         * synchronous throw *inside* the callback into a rejection, which is
         * what the caller is equipped to handle.
         *
         * The shape follows the samples that work: set the values, then one
         * `save()`, then `refresh()`. Only `save` is awaitable.
         */
        return Promise.resolve()
            .then(() => {
                record.setValue(column, value);
            })
            .then(() => record.save())
            .then(() => {
                /*
                 * **`refresh()` is part of the write, not a courtesy.**
                 *
                 * `save()` commits; nothing re-reads until something asks. The
                 * working samples call it immediately after saving, and without
                 * it the optimistic override is the only thing holding the new
                 * value on screen — so the cell would show the edit until the
                 * next platform-driven fetch and then appear to lose it.
                 *
                 * Safe to call here: this runs from a user gesture, not from
                 * `updateView`, so the `updateView` it triggers does not
                 * re-enter anything.
                 */
                dataset.refresh();

                this.editedRecordId = id;
                // The one thing here that *is* an output, and the one thing
                // `notifyOutputChanged` is actually for.
                this.notifyOutputChanged();
            })
            .catch((error: unknown) => {
                // Failure only. A write that never comes back now rejects on
                // the component's fifteen-second bound, so this line catches
                // the hang as well as the refusal — and the platform's own
                // message names neither the column nor the record.
                console.warn('[DataTable] write failed', column, since(), error);

                throw error;
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

        /*
         * The export's per-page watchdog, for the same reason: a form the
         * reader navigated away from mid-export would otherwise fire a timer
         * into a control that no longer exists.
         */
        this.clearExportWatchdog();

        this.metadata.clear();
        this.relationships = null;
        this.targets.clear();
        this.entitySets.clear();
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
        /*
         * **Zero is "unset", not "one row per page".**
         *
         * The comment below has said that about `paging.pageSize` since 0.2.0,
         * and the clamp underneath disagreed with it about the *property*: a
         * raw `0` fell past this branch into `Math.max(…, 1)` and became a page
         * size of one.
         *
         * That is not a hypothetical. **A canvas app shows an unset whole
         * number as `0`** — seen in a real studio, 2026-09-21, with `Page size`
         * reading `0` on a control nobody had configured — so the trap was
         * waiting for every canvas maker who left the property alone: twenty
         * rows fetched and one drawn, looking like the control could not page.
         *
         * A negative is the same statement and gets the same answer.
         */
        if (raw === null || raw === undefined || raw <= 0) {
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

        this.writeCsv(context, dataset, columns.map((column) => column.displayName), rows);
    }

    /**
     * Turn headers and rows into a file, by whichever route the host allows.
     *
     * Split out of `exportCsv` so the full-view path can hand it rows that
     * came from forty fetches rather than from the dataset as it stands. Every
     * decision below is 0.5.0's, unchanged.
     */
    private writeCsv(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        headers: string[],
        rows: string[][],
    ): void {
        const csv = toCsv(headers, rows);

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
    /**
     * Order by one column.
     *
     * `additive` appends to the order instead of replacing it, which the
     * platform honours: **measured 2026-09-20**, two entries pushed and
     * refreshed reordered the rows within the first column's ties, and
     * flipping only the second entry's direction reversed them. The array
     * survived `paging.reset()` and a page turn, and four entries were retained
     * with no ceiling found.
     *
     * That measurement took two attempts and the first was a false pass. The
     * probe sorted by a column whose every value was distinct, so the primary
     * sort never produced a tie and the secondary had nothing to break — rows
     * agreeing with the request is not evidence the request was honoured. The
     * second attempt grouped the sort by a four-value Choice and flipped only
     * the second entry.
     */
    private sortBy(dataset: DataSet, columnName: string, additive: boolean): void {
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

        const at = sorting.findIndex((status) => status.name === columnName);
        const current = at === -1 ? undefined : sorting[at];

        if (!additive) {
            /*
             * The 0.5.0 behaviour, unchanged and deliberately the default: a
             * plain click replaces the order rather than adding to it. Every
             * existing installation clicks a header the same way it always did.
             */
            const direction: SortDirection = current ? nextDirection(current.sortDirection) : ASCENDING;

            sorting.length = 0;
            sorting.push({ name: columnName, sortDirection: direction });
        } else if (at === -1) {
            sorting.push({ name: columnName, sortDirection: ASCENDING });
        } else if (current && current.sortDirection === ASCENDING) {
            sorting[at] = { name: columnName, sortDirection: nextDirection(current.sortDirection) };
        } else {
            /*
             * **The third activation removes it**, rather than cycling back to
             * ascending.
             *
             * With a rank on screen there is a meaningful "not sorted by this"
             * state, and no other way to reach it — a column added to a
             * multi-column sort by mistake would otherwise be stuck in the
             * order forever. A single-column sort has no such state, which is
             * why the plain path above still cycles.
             */
            sorting.splice(at, 1);
        }

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

    /**
     * Change how one date box compares, and re-ask straight away if it holds a
     * day.
     *
     * No debounce, on the `clearFilterValue` argument: a click on the toggle
     * is a finished decision. With an empty box nothing changes on the
     * server, and `applyFilter` finds the same signature and asks for nothing
     * — the label repaints from component state, which is why it lives there.
     */
    private setFilterOp(
        context: ComponentFramework.Context<IInputs>,
        columnName: string,
        op: DateOp,
    ): void {
        this.filterOps = { ...this.filterOps, [columnName]: op };

        if ((this.filters[columnName] ?? '').trim() === '') {
            return;
        }

        if (this.filterTimer !== null) {
            window.clearTimeout(this.filterTimer);
            this.filterTimer = null;
        }

        this.applyFilter(context);
    }

    /**
     * Drop every filter and ask for the unfiltered view, with no debounce.
     *
     * The date toggles stay. They are how the reader wants a column compared,
     * not what they asked for, and a Clear that flipped every "From" back to
     * "On" would undo a preference to answer a query.
     */
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
     *  4. **One `refresh()` per decision, never two in a row.** Measured
     *     2026-09-11: a refresh on this subgrid takes 3–14 s, and one issued
     *     while another is in flight appears to be dropped rather than
     *     queued. The debounce and the signature guard are what keep this to
     *     one; a control that refreshed on every keystroke would lose most of
     *     them and show the result of whichever one landed.
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

        const filterRow = buildFilter(
            this.filters,
            visibleColumns(dataset.columns ?? []),
            this.filterOps,
        );

        /*
         * **Expanding a group is a filter, not a scroll**, and this is where
         * the two meet.
         *
         * The expansion's conditions are ANDed onto whatever the filter row
         * already says, so a maker's filter and a reader's expansion compose
         * rather than replace each other. Everything downstream — paging,
         * sorting, the pager — then works inside the group untouched, which is
         * what dissolves "a group whose members span pages": that question is
         * never asked, because the control never asks for *the rows of group X
         * within page N*.
         */
        const expression = this.expansion.length === 0
            ? filterRow
            : {
                /*
                 * One cast, at the one place the pure side meets the platform
                 * side. `query/fetchXml.ts` declares its own `Condition`
                 * rather than importing `ConditionExpression`, so that the
                 * module stays loadable by `dev/modules.js` with no platform
                 * types in reach — the purity boundary that suite enforces.
                 * The two shapes are the same three fields; only the operator
                 * is an enum on one side and a number on the other.
                 */
                conditions: (filterRow ? filterRow.conditions : [])
                    .concat(this.expansion as unknown as NonNullable<typeof filterRow>['conditions']),
                filterOperator: 0,
                ...(filterRow && filterRow.filters ? { filters: filterRow.filters } : {}),
            } as typeof filterRow;

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
