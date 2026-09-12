/*
 * The platform, stood in for: a working `DataSet` with real paging and real
 * sorting, plus the switches for the ways a real one misbehaves.
 *
 * Loaded by both `harness.html` in a browser and `smoke.js` in Node, which is
 * why it attaches to `window` *and* assigns `module.exports` and requires
 * neither to exist.
 *
 * ---
 *
 * **Why this exists.** Every dataset control in the catalogue is published at
 * `demo.fidelity: "limited"` for the same reason: the hub's harness seeds a
 * single page, reports no next or previous page, and discards sorting between
 * renders. `npm start` is not much better — it will bind a CSV, but it will not
 * put the control on page three of a sorted view and then change the page size
 * underneath it.
 *
 * So the paging and sorting code in a dataset control — which is most of the
 * hard code in a dataset control — has never been exercised by anything before
 * this file. It ships with twelve records and a page size of five for exactly
 * that reason: three pages is the smallest number that tells you whether page
 * two came from the platform or from a slice.
 *
 * ---
 *
 * **The `quirks` switches are the point, not a curiosity.**
 *
 * The scaffolded control carries three repairs for behaviour observed on a real
 * model-driven form, and each one looks like superstition until you can turn
 * the behaviour on:
 *
 *   - `loadNextPage(true)` **ignores its argument** and hands back the whole
 *     range from page one, so `sortedRecordIds` accumulates instead of
 *     replacing. This is why the control slices.
 *   - `hasPreviousPage` **stays false** after paging forward, so a pager driven
 *     by it can never go back. This is why the control counts pages itself.
 *   - `firstPageNumber` **disagrees with the ids**, which is how a range like
 *     "4–9 of 6" gets printed. This is why the label is built from the
 *     control's own counter.
 *
 * Default them to the observed behaviour, not the documented one. A harness
 * that models the platform as it is written down will pass a control that
 * cannot page on a real form — which is the exact failure these switches exist
 * to prevent.
 *
 * ---
 *
 * **A stub must never be more capable than the thing it stands in for.**
 * `refresh()` here does not re-render; it records that a render is owed, and
 * the driver decides when to run it. That is deliberate. A `refresh()` that
 * re-entered `updateView` immediately would hide the loop a guarded mutator
 * exists to prevent, and would make an infinite one look like a hang instead of
 * a count.
 */

(function (root, factory) {
    'use strict';

    var api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.__pcfHost = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    /** `SortDirection` is a numeric union: 0 ascending, 1 descending. */
    var ASCENDING = 0;
    var DESCENDING = 1;

    /**
     * `FilterOperator`, which combines the conditions of one expression.
     *
     * **Undeclared is `And`**, and that is the trap in both directions. A
     * search meaning "this term in any of four columns" that forgets to say
     * `Or` matches nothing and reads as a broken query rather than a missing
     * field. A per-column filter row that says `Or` widens instead of
     * narrowing, so two filled boxes return more rows than one did.
     */
    var AND = 0;
    var OR = 1;

    /**
     * The `ConditionOperator` values this stand-in honours, out of the ~90 the
     * platform defines.
     *
     * The first eight are the ones a control can use on **both** hosts. The
     * rest of the enum is where the hosts disagree, and the disagreement is not
     * symmetric: `NotLike` (7) and `NotNull` (13) are canvas-only, while
     * `Yesterday` (14), `Today` (15) and `Tomorrow` (16) are model-driven-only.
     * A control that reaches past that set is choosing a host, and should say
     * so in `docs/limitations.md`.
     *
     * `On`, `OnOrBefore` and `OnOrAfter` are here because `pcf-data-table`
     * 0.4.0 sends them, and were measured on a model-driven subgrid
     * 2026-09-11 with `value: 'yyyy-MM-dd'`: all three narrow, and the day is
     * compared in the *user's* zone rather than UTC. `holds()` below models
     * exactly that and nothing about canvas, which has not been asked.
     */
    var OPERATOR = {
        Equal: 0,
        NotEqual: 1,
        GreaterThan: 2,
        LessThan: 3,
        GreaterEqual: 4,
        LessEqual: 5,
        Like: 6,
        Null: 12,
        On: 25,
        OnOrBefore: 26,
        OnOrAfter: 27,
    };

    /*
     * Every string the control asks for, with the value the .resx actually
     * carries.
     *
     * **Kept complete rather than partial on purpose.** `getString` falls back
     * to the key, so a missing entry renders as `DataTable_Export` — which is
     * invisible in an assertion that only counts elements, and glaring in a
     * screenshot taken from `dev/preview.html`. A rig that renders the control
     * for a picture has to render the words too.
     *
     * Regenerate by parsing `strings/<Control>.1033.resx` for every key the
     * source passes to `getString`; smoke.js overrides this with marked keys
     * where it wants to prove a string came from the .resx at all.
     */
    var STRINGS = {
        DataTable_ClearFilter: "Clear the filter on {0}",
        DataTable_ClearFilters: "Clear filters",
        DataTable_CreateFailed: "The quick create form could not be opened.",
        DataTable_DateFrom: "From",
        DataTable_DateOn: "On",
        DataTable_DateOpHint: "Change how {0} is compared: on, from or until the chosen day",
        DataTable_DateUntil: "Until",
        DataTable_EditCell: "Edit {0}",
        DataTable_EditEmpty: "(empty)",
        DataTable_Empty: "No records.",
        DataTable_Error: "This view could not be loaded.",
        DataTable_Export: "Export CSV",
        DataTable_ExportHint: "Save the rows loaded so far as a CSV file. Pages you have not opened are not included.",
        DataTable_FilterAny: "Any",
        DataTable_FilterColumn: "Filter by {0}",
        DataTable_FilterDateHint: "Filter by {0}. Pick a day; the button beside it chooses on, from or until that day.",
        DataTable_FilterNumberHint: "Filter by {0}. Type a number, or a comparison such as >1000.",
        DataTable_FilterNumberPlaceholder: "e.g. >1000",
        DataTable_FilterPlaceholder: "Filter",
        DataTable_GoToPage: "Go to page",
        DataTable_Loading: "Loading records…",
        DataTable_New: "New",
        DataTable_NewHint: "Add a row using the quick create form.",
        DataTable_Next: "Next page",
        DataTable_No: "No",
        DataTable_NoColumns: "No columns are selected for this table.",
        DataTable_NoMatches: "No records match these filters.",
        DataTable_NoValue: "(none)",
        DataTable_NotANumber: "That is not a number, so nothing was saved.",
        DataTable_OfPages: "of {0}",
        DataTable_OpenRecord: "Open {0}",
        DataTable_PageStatus: "Page {0}",
        DataTable_Previous: "Previous page",
        DataTable_RangeStatus: "{0}–{1} of {2}",
        DataTable_RowsPerPage: "Rows per page",
        DataTable_SaveFailed: "{0} could not be saved. {1}",
        DataTable_SaveFailedGeneric: "The platform refused the change.",
        DataTable_SaveTimedOut: "The platform did not confirm this change. It may not have been saved — reload the form to see the stored value.",
        DataTable_Saving: "Saving…",
        DataTable_SelectAll: "Select all rows on this page",
        DataTable_SelectRow: "Select {0}",
        DataTable_SortBy: "Sort by {0}",
        DataTable_Unfilterable: "{0} cannot be filtered here. Lookups are filtered by the view; a choice needs table metadata this host does not provide.",
        DataTable_Yes: "Yes",
    };

    var HOSTS = {
        'model-driven': { label: 'model-driven form', publishesTheme: true },
        canvas: { label: 'canvas app', publishesTheme: false },
    };

    /**
     * `context.client.getFormFactor()`, which is a number and not the one most
     * people guess.
     *
     * **0 Unknown, 1 Desktop, 2 Tablet, 3 Phone.** Web is `1`, and `3` — the
     * value that looks like it ought to mean "the big one" — is a phone. A
     * dataset control that drops columns on a narrow client is comparing
     * against one of these, and comparing against the wrong one drops them
     * everywhere except where it meant to.
     */
    var FORM_FACTORS = { unknown: 0, desktop: 1, tablet: 2, phone: 3 };

    var DEFAULTS = {
        host: 'model-driven',
        formFactor: 'desktop',
        /**
         * `mode.allocatedWidth` / `allocatedHeight`.
         *
         * **-1 until the control calls `mode.trackContainerResize(true)`**, and
         * that is the default here because it is the platform's. A table that
         * decides its column widths from a width it never asked for lays out
         * against -1 on every host.
         */
        width: -1,
        height: -1,
        pageSize: 5,
        visible: true,
        dark: undefined,
        rtl: false,
        /** No records yet, which is the state of the first `updateView`. */
        loading: false,
        error: false,
        errorMessage: 'The records could not be loaded.',
        /** Replace with `[]` to see the empty state, or with a subset. */
        records: null,
        columns: null,

        /**
         * The control's own input properties, merged into `parameters`.
         *
         * The scaffolded control has only `pageSize`, and every real one grows
         * more. Pass them as raw values — `{ selectionMode: 'multiple' }` — and
         * they arrive as `{ raw: … }` where the control expects them.
         *
         * Passing them rather than editing this file is what keeps a repo's
         * copy of the rig close enough to the template's to update by copying.
         */
        /**
         * Format values the way a platform would, in `getFormattedValue` only.
         * Off for assertions, on for `dev/preview.html`. See `makeDisplay`.
         */
        format: false,

        inputs: {},

        /**
         * `mode.contextInfo` — the record the subgrid sits on, or `null` for
         * a main grid, which has none. Measured on a form subgrid 2026-09-11
         * as `{ entityTypeName, entityId, entityRecordName }`; a control
         * passes it to `openForm` as `createFromEntity` so a quick-created
         * row lands in the subgrid it was asked for from.
         */
        contextInfo: null,

        /**
         * What `navigation.openForm` resolves with. The measured shapes: a
         * saved quick create form resolves `{ savedEntityReference: [{ id:
         * "{436E09A8-…}", entityType, name }] }` — braced, upper-case — and a
         * **dismissed one resolves `{ savedEntityReference: null }`**, not `[]`
         * and not a rejection. The default is the dismissal, because that is
         * the branch a control forgets.
         */
        openFormReturns: { savedEntityReference: null },

        quirks: {
            /**
             * `loadNextPage(true)` returns the whole range from page one rather
             * than only the new page. Observed on a real form; defaulted on
             * because that is what a real form does.
             */
            accumulatePages: true,
            /** `hasPreviousPage` never becomes true. Observed on a real form. */
            previousPageStuck: true,
            /** `totalResultCount` is -1 — common on large views. */
            uncounted: false,
            /**
             * Whether `paging.loadExactPage` exists at all. It is typed as
             * required, which is a claim about the type definitions rather than
             * about the host, so a control that calls it unguarded is worth
             * being able to break here.
             */
            hasLoadExactPage: true,

            /**
             * Whether `dataset.sorting` exists at all.
             *
             * **This one is not hypothetical, and it is not the platform — it
             * is `npm start`.** The local test harness's dataset mock sets
             * `sorting: undefined`, so `dataset.sorting.find(...)` throws a
             * TypeError that the harness swallows: the control renders as an
             * empty box with nothing in the console. A freshly scaffolded
             * dataset control did exactly that until this switch existed to
             * catch it.
             *
             * Off by default because a real form supplies the array — the
             * default models the platform, and the assertion in `smoke.js`
             * covers the one host known to deviate.
             */
            sortingAbsent: false,

            /**
             * `mode.allocatedHeight` stays -1 however the host is sized, and
             * however politely the control asks.
             *
             * **This is a main grid, and it is by design rather than a timing
             * problem.** A control on a table's main grid is handed a measured
             * *width* and never a height: `trackContainerResize(true)` changes
             * the width and leaves the height at -1 for the life of the control.
             *
             * It matters because "-1 means the host has not measured *yet*" is
             * the natural reading, and a control that waits for a positive
             * number waits forever. `pcf-row-commands` gated its scroll layout
             * on a measured height and ran twenty-five rows off the bottom of a
             * main grid, taking the pager — the only route to page two — with
             * them.
             *
             * Off by default, because a form subgrid does measure both.
             */
            heightUnmeasured: false,

            /**
             * Whether `dataset.filtering` exists at all.
             *
             * Same shape of risk as `sortingAbsent`, one step less certain: the
             * type definitions declare `filtering` as always present, and a
             * control that calls `dataset.filtering.setFilter(...)` without
             * checking has taken the types at their word. Turn this on to find
             * out what that costs before a host does it for you.
             *
             * Off by default, because a real form supplies it.
             */
            filteringAbsent: false,

            /**
             * Whether `context.navigation.openFile` exists.
             *
             * Separate from the bag below because it is absent for a different
             * reason: `openFile` is documented model-driven apps only, while
             * `context.navigation` itself is present either way. A control that
             * checks the bag rather than the method passes on a host that
             * cannot open a file — and then does nothing at all on the one that
             * matters.
             */
            openFileAbsent: false,

            /** Whether `context.navigation` exists at all. Typed non-optional. */
            navigationAbsent: false,

            /**
             * Whether `context.navigation.openForm` exists. Same shape as
             * `openFileAbsent` and for the same reason: `navigation` is there
             * on every host and `openForm` is not — canvas has no forms to
             * open, and the hub's demo harness supplies neither.
             */
            openFormAbsent: false,

            /**
             * Whether `context.utils` exists at all.
             *
             * It does not on canvas, whatever the manifest declares, and a
             * model-driven host may leave it out when the feature is declared
             * `required="false"`. Forced on under `host: 'canvas'` below, so a
             * control cannot be told it is on canvas and handed a metadata
             * call that canvas does not have.
             */
            utilsAbsent: false,

            /** `utils.getEntityMetadata` rejects — a table the user cannot read, a network fault. */
            metadataRejects: false,

            /** Whether `context.formatting` exists. The hub's demo harness omits it. */
            formattingAbsent: false,

            /**
             * `allocatedWidth` stays -1 until the control calls
             * `trackContainerResize(true)`.
             *
             * **Defaulted on, because that is what a real form does.** Measured
             * on an Accounts subgrid, 2026-09-09: a control that never
             * subscribed read `allocatedWidth` as -1, with `allocatedHeight`
             * at -1 beside it.
             *
             * It is a quirk rather than plain behaviour because it hid a real
             * bug for a whole release. The rig used to answer the `width`
             * option unconditionally, so `pcf-data-table`'s pinning clamp —
             * which drops pinning where it would leave nothing to scroll —
             * passed its assertions here and was dead code on every form. A rig
             * that is more generous than the platform does not fail safe; it
             * certifies the failure.
             *
             * Turn it off to model a host that measures without being asked, if
             * one is ever found.
             */
            resizeUntracked: true,

            /**
             * Whether the record carries the write half of `EntityRecord` at
             * all — `setValue`, `save`, `isDirty`, `isEditable`.
             *
             * Off by default, because a real model-driven subgrid has them:
             * measured 2026-09-09. On, it models the host that does not, which
             * a control has to survive by offering no editors rather than by
             * offering ones that discard what is typed. None of these methods
             * is in the typings, so "the host has them" is a claim about one
             * measurement rather than about a contract.
             */
            editableAbsent: false,

            /** `save()` rejects. The path the whole rollback exists for. */
            saveRejects: false,

            /**
             * Columns `isEditable` answers `false` for.
             *
             * Not hypothetical: on the measured subgrid `statuscode` came back
             * `false` while two other columns on the same row came back `true`.
             * Column-level editability is per column *and* per record, and it is
             * invisible on `Column` — so a control that inferred it from
             * `dataType` would offer an editor over exactly this case.
             */
            readOnlyColumns: ['statecode'],
        },
    };

    function formatted(value) {
        return value === null || value === undefined ? '' : String(value);
    }

    /*
     * What `getFormattedValue` hands back, which on the platform is *not*
     * `String(value)`.
     *
     * Separate from `formatted()` above, which stays raw and is what filtering
     * and sorting compare on — the server filters the stored value, not the
     * rendered one, and the CSV assertions read exact cell contents where
     * `-1500` says more about quoting and formula defusing than `-$1,500.00`.
     *
     * **`format: true` is for pictures.** `dev/preview.html` renders the control
     * to be looked at, and a table of `2450000` and `2026-08-14` is a control
     * that does not exist: a real platform formats a Currency and a DateOnly
     * before the control ever sees them, so a screenshot of raw values
     * misrepresents the thing being photographed.
     */
    function makeDisplay(columns, format, metadata) {
        var types = {};

        (columns || []).forEach(function (column) {
            types[column.name] = column.dataType || '';
        });

        return function (value, name) {
            if (value === null || value === undefined) {
                return '';
            }

            var type = types[name] || '';

            /*
             * **Formatted whether or not `format` is on**, because for these
             * two there is no raw rendering: the platform never shows a
             * choice as its integer or a lookup as its object, and
             * `String({ id: … })` is `[object Object]` in a cell. A choice
             * value the option list does not know renders as its number,
             * which is what a real grid does for an orphaned value.
             */
            if (type === 'OptionSet') {
                var entry = ((metadata || {})[name] || {}).options || [];
                var match = entry.filter(function (option) {
                    return String(option.value) === String(value);
                })[0];

                return match ? match.label : String(value);
            }

            if (type.indexOf('Lookup') === 0) {
                return typeof value === 'object' ? formatted(value.name) : String(value);
            }

            if (!format || typeof value !== 'number' && type.indexOf('DateAndTime') !== 0) {
                return String(value);
            }

            if (type === 'Currency') {
                return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
            }

            if (type === 'Decimal' || type === 'FP' || type === 'Whole.None') {
                return value.toLocaleString('en-US');
            }

            if (type.indexOf('DateAndTime') === 0) {
                /*
                 * **Parsed from its parts, not by `new Date(string)`.**
                 *
                 * `new Date('2026-08-14')` is UTC midnight by specification,
                 * and `toLocaleDateString` then renders it in the local zone —
                 * so west of Greenwich every date came out a day early. This
                 * rig produced the published screenshots, so it put the wrong
                 * day in the media for as long as it was here: a fixture
                 * reading 2026-08-14 photographed as 13 Aug 2026.
                 *
                 * Same lesson as `coerceValue` and `editorValue` in the
                 * control itself, now in the third place that needed it. A
                 * date-only value is a day on a calendar, with no time to
                 * convert and no zone to convert it from.
                 */
                var text = String(value);
                var day = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z)?$/.exec(text);
                var date = day
                    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
                    : new Date(text);

                return isNaN(date.getTime())
                    ? String(value)
                    : type === 'DateAndTime.DateAndTime'
                        // An instant shows its time, in the zone the page runs in.
                        ? date.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            }

            return String(value);
        };
    }

    /**
     * Build the dataset and the context around it.
     *
     * The returned handle carries the engine's own view of the world —
     * `refreshes`, `calls`, the true page — so an assertion can be about what
     * the control *asked the platform to do*, which is the half that a rendered
     * table never shows.
     */
    function createHost(fixture, options) {
        var o = Object.assign({}, DEFAULTS, options || {});
        var quirks = Object.assign({}, DEFAULTS.quirks, (options || {}).quirks);
        var hostKind = HOSTS[o.host] || HOSTS['model-driven'];

        var allRecords = o.records || fixture.records;
        var columns = o.columns || fixture.columns;
        // Raw unless asked for; see makeDisplay. Only getFormattedValue uses it.
        var display = makeDisplay(columns, o.format, fixture.metadata);
        var types = {};

        columns.forEach(function (column) {
            types[column.name] = column.dataType || '';
        });

        /*
         * `utils` is a model-driven surface. Forced absent under `host:
         * 'canvas'` however the quirk is set, so a control cannot be told it
         * is on canvas and then handed a metadata call canvas does not have.
         */
        var utilsPresent = !quirks.utilsAbsent && o.host !== 'canvas';
        /* `openForm` is model-driven only, on the same rule as `openFile`. */
        var openFormPresent = !quirks.openFormAbsent && o.host !== 'canvas';

        var state = {
            /** The page the platform believes it is on. */
            page: 1,
            /**
             * The page size actually in force, which is not the one most
             * recently requested — `setPageSize` does nothing until the next
             * fetch, and that gap is where a mutator loop lives.
             */
            pageSize: o.pageSize,
            requestedPageSize: o.pageSize,
            refreshes: 0,
            renderOwed: false,
            /**
             * Whether the control has subscribed to container resize.
             *
             * **The platform does not report `allocatedWidth` until it has.**
             * Measured on a real Accounts subgrid, 2026-09-09: a control that
             * never called `trackContainerResize(true)` read `allocatedWidth`
             * as -1 there, while this rig handed it the `width` option
             * regardless — so a layout gated on a measured width tested green
             * here and was dead code on a form. See `quirks.resizeUntracked`.
             */
            resizeTracked: false,
            /** Every mutator the control called, in order, with its argument. */
            calls: [],
            /**
             * Every file the control handed to `navigation.openFile`, decoded.
             *
             * The content and not only the metadata, because for an export the
             * bytes *are* the behaviour: a control that quotes a CSV cell
             * wrongly, or writes the raw value where the cell showed a
             * formatted one, logs an identical call.
             */
            files: [],
        };

        var sorting = [];

        /**
         * The filter the control asked for, and the filter in force.
         *
         * Two variables for the same reason `pageSize` and `requestedPageSize`
         * are two: **`setFilter` is not a fetch.** It records an expression and
         * not one row moves until `refresh()`, so `fetched()` is what promotes
         * the request into the result set. A stub that filtered on `setFilter`
         * alone would pass a control that never refreshes — and a control that
         * never refreshes looks exactly like one whose filter matched nothing,
         * which is what makes that the hardest of these to spot by eye.
         *
         * Once applied, the filter is the *server's* result set: the record
         * map, `totalResultCount` and `hasNextPage` all follow it. The reason a
         * control's pager breaks under a filter is almost always a total that
         * did not.
         */
        var requestedFilter = null;
        var filter = null;

        function log(name, argument) {
            state.calls.push(argument === undefined ? name : name + '(' + JSON.stringify(argument) + ')');
        }

        /**
         * One `ConditionExpression` against one row.
         *
         * `Like` takes SQL wildcards rather than a substring — `dana%` is a
         * prefix match and `%dana%` a contains — and is case-insensitive, which
         * is Dataverse's default collation. A control that lowercases the term
         * itself and expects an exact match here is testing something the
         * server does not do.
         */
        function holds(row, condition) {
            var actual = row.values[condition.attributeName];
            var left = formatted(actual).toLowerCase();
            var right = formatted(condition.value).toLowerCase();

            switch (condition.conditionOperator) {
                /*
                 * As strings, which is what lets `Equal` on a Choice column
                 * take `'3'` and `3` alike — the server did, measured
                 * 2026-09-11 — and what makes it fail against a fixture that
                 * still holds `'Active'` where the platform holds `1`.
                 */
                case OPERATOR.Equal:
                    return left === right;
                case OPERATOR.NotEqual:
                    return left !== right;
                case OPERATOR.GreaterThan:
                    return Number(actual) > Number(condition.value);
                case OPERATOR.LessThan:
                    return Number(actual) < Number(condition.value);
                case OPERATOR.GreaterEqual:
                    return Number(actual) >= Number(condition.value);
                case OPERATOR.LessEqual:
                    return Number(actual) <= Number(condition.value);
                case OPERATOR.Null:
                    return actual === null || actual === undefined || actual === '';
                case OPERATOR.Like:
                    return likePattern(right).test(left);
                /*
                 * Whole days, compared as `yyyy-MM-dd` in the *local* zone —
                 * which is the platform's behaviour with the user's zone
                 * standing in for the machine's. An empty cell matches
                 * nothing under any of the three, as it does on the server.
                 */
                case OPERATOR.On:
                    return dayOf(actual) !== null && dayOf(actual) === dayOf(condition.value);
                case OPERATOR.OnOrBefore:
                    return dayOf(actual) !== null && dayOf(actual) <= dayOf(condition.value);
                case OPERATOR.OnOrAfter:
                    return dayOf(actual) !== null && dayOf(actual) >= dayOf(condition.value);
                default:
                    /*
                     * Unhonoured operators pass rather than fail, so an
                     * assertion about a filter this file cannot model reads as
                     * "no filtering happened" instead of "everything vanished".
                     * The second is indistinguishable from a control that
                     * filtered its own rows away.
                     *
                     * **That default is also how a filter that filtered
                     * nothing got certified.** Before `On`, `OnOrBefore` and
                     * `OnOrAfter` were modelled above, a control sending them
                     * passed every row through here and read as "working" to
                     * any assertion that counted rows. An operator a control
                     * sends has to be in the switch, or the rig is more
                     * generous than the platform — the failure mode the whole
                     * file exists to prevent.
                     */
                    return true;
            }
        }

        /**
         * A value's calendar day as `yyyy-MM-dd`, or `null` for no value.
         *
         * A date-only string is already a day and is taken as one — parsing
         * it through `Date` would make it UTC midnight and shift it west of
         * Greenwich, the bug `makeDisplay` below already paid for. Anything
         * else is a timestamp, and its day is the local one.
         */
        function dayOf(value) {
            if (value === null || value === undefined || value === '') {
                return null;
            }

            var text = String(value);

            // A bare day, or a day at UTC midnight — which is how a DateOnly
            // column hands its day over. Either is the day as written.
            if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(text)) {
                return text.slice(0, 10);
            }

            var date = value instanceof Date ? value : new Date(text);

            if (isNaN(date.getTime())) {
                return null;
            }

            var month = String(date.getMonth() + 1);
            var day = String(date.getDate());

            return date.getFullYear() + '-' + (month.length < 2 ? '0' + month : month) + '-' + (day.length < 2 ? '0' + day : day);
        }

        function escapeForRegExp(part) {
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        /**
         * A SQL `LIKE` pattern as a regular expression.
         *
         * Three things are special and the third is the one people miss:
         * `%` is any run, `_` is any single character, and **`[c]` is a literal
         * `c`** — which is how a search term containing a wildcard is escaped,
         * because a backslash is not an escape character here.
         *
         * Without the bracket case a control that correctly escapes a typed `%`
         * to `[%]` looks broken against this stand-in while being right on the
         * server, which is the worst way for a harness to be wrong.
         */
        function likePattern(pattern) {
            var source = '^';

            for (var at = 0; at < pattern.length; at += 1) {
                var character = pattern.charAt(at);

                if (character === '[' && pattern.charAt(at + 2) === ']') {
                    source += escapeForRegExp(pattern.charAt(at + 1));
                    at += 2;
                } else if (character === '%') {
                    source += '.*';
                } else if (character === '_') {
                    source += '.';
                } else {
                    source += escapeForRegExp(character);
                }
            }

            return new RegExp(source + '$');
        }

        /** A `FilterExpression`, including any child `filters`, against one row. */
        function passes(row, expression) {
            if (!expression) {
                return true;
            }

            var conditions = expression.conditions || [];
            var children = expression.filters || [];

            var results = conditions
                .map(function (condition) {
                    return holds(row, condition);
                })
                .concat(
                    children.map(function (child) {
                        return passes(row, child);
                    }),
                );

            if (results.length === 0) {
                return true;
            }

            // Undeclared is `And` — see the note on FilterOperator above.
            var operator = expression.filterOperator === undefined ? AND : expression.filterOperator;

            return operator === OR ? results.some(Boolean) : results.every(Boolean);
        }

        /** Every record the current filter admits — the server's result set. */
        function matching() {
            return filter
                ? allRecords.filter(function (row) {
                    return passes(row, filter);
                })
                : allRecords;
        }

        /** All matching records in the order the current sort puts them. */
        function ordered() {
            var rows = matching().slice();

            if (sorting.length === 0) {
                return rows;
            }

            /*
             * Only the first entry is honoured, and that is not a shortcut: a
             * view's ORDER BY is what `dataset.sorting` holds, and a control
             * that pushes instead of replacing builds a three-deep sort nobody
             * asked for. Sorting by one column here makes that visible as a
             * wrong order rather than hiding it behind a stable tie-break.
             */
            var by = sorting[0];

            return rows.sort(function (a, b) {
                var left = formatted(a.values[by.name]);
                var right = formatted(b.values[by.name]);
                var compared = left.localeCompare(right);

                return by.sortDirection === DESCENDING ? -compared : compared;
            });
        }

        /**
         * What `sortedRecordIds` holds.
         *
         * With `accumulatePages` on — the observed platform behaviour — it is
         * every id from page one to the current page, which is why a control
         * that renders the array directly stacks page two under page one.
         */
        function visibleIds() {
            var rows = ordered();
            var end = state.page * state.pageSize;
            var start = quirks.accumulatePages ? 0 : (state.page - 1) * state.pageSize;

            return rows.slice(start, end).map(function (row) {
                return row.id;
            });
        }

        /**
         * One attribute's metadata node, in the shape measured 2026-09-11.
         *
         * A real node carries the option list twice — `attributeDescriptor
         * .OptionSet` as an array of `{ Label, Value, IsHidden }`, and
         * `OptionSet` as a **map keyed by value** of `{ text, value }`, with
         * no `Options` array anywhere and no `GlobalOptionSet`. The fixture
         * asks for one shape per column so that a control reading only one
         * of the two is caught by the column that carries the other. Labels
         * are plain strings on both; the `UserLocalizedLabel` shape the Web
         * API returns was not seen and is not served.
         *
         * A lookup carries `Targets` at the top of the node for a
         * `Lookup.Simple` and only under `attributeDescriptor` for a
         * `Lookup.Customer`; the fixture's one lookup is simple.
         */
        function attributeNode(name) {
            var entry = (fixture.metadata || {})[name];

            if (!entry) {
                return undefined;
            }

            var node = {
                LogicalName: name,
                AttributeTypeName: types[name] || '',
                attributeDescriptor: { LogicalName: name },
            };

            if (entry.targets) {
                node.Targets = entry.targets.slice();
                node.attributeDescriptor.Targets = entry.targets.slice();
            }

            if (entry.options && entry.shape === 'descriptor') {
                node.attributeDescriptor.OptionSet = entry.options.map(function (option) {
                    return { Label: option.label, Value: option.value, IsHidden: false };
                });
            }

            if (entry.options && entry.shape === 'map') {
                node.OptionSet = {};
                entry.options.forEach(function (option) {
                    node.OptionSet[option.value] = { text: option.label, value: option.value };
                });
            }

            return node;
        }

        function recordFor(row) {
            var record = {
                getRecordId: function () {
                    return row.id;
                },
                /*
                 * **A choice reads back as a string.** `getValue` on an
                 * `OptionSet` column returned `"3"` on the measured subgrid,
                 * not `3`, while `setValue` wants the integer — so a control
                 * that compares what it wrote with what it reads has to
                 * coerce, and a rig that handed back the fixture's number
                 * would let one that does not pass.
                 */
                getValue: function (name) {
                    var value = row.values[name];

                    if (value !== null && value !== undefined && typeof value === 'number' && (types[name] || '') === 'OptionSet') {
                        return String(value);
                    }

                    return value;
                },
                getFormattedValue: function (name) {
                    return display(row.values[name], name);
                },
                getNamedReference: function () {
                    return { id: row.id, name: formatted(row.values.name), etn: fixture.targetEntityType };
                },
            };

            /*
             * **The write half of `EntityRecord`, which the type definitions do
             * not declare.**
             *
             * Measured on a real model-driven subgrid, 2026-09-09: a live record
             * carries twenty-three methods where
             * `@types/powerapps-component-framework@1.3.18` declares four, and
             * none of the four writes. `setValue`, `save`, `isDirty` and
             * `isEditable` are all really there, and `setValue` + `save`
             * committed a value that survived a reload.
             *
             * It is worth a control reaching past the typings for, because the
             * alternative — `webAPI.updateRecord` — needs
             * `<uses-feature name="WebAPI" />`, an install-time permission
             * prompt in every environment, and does nothing at all in canvas.
             */
            if (quirks.editableAbsent) {
                return record;
            }

            /*
             * Staged, not applied. `setValue` on the platform does not commit —
             * `save()` does — and a rig that applied immediately would let a
             * control pass while never calling `save` at all.
             */
            row.staged = row.staged || {};

            /*
             * **Returns `undefined`, because the platform does.**
             *
             * This rig used to return `Promise.resolve()`, and that single line
             * is what let `pcf-data-table` 0.3.0 through 0.3.2 ship a write that
             * could never work. The control chained
             * `record.setValue(...).then(() => record.save())`, which against a
             * real record is `.then` on `undefined` — a `TypeError` thrown
             * synchronously, outside every `.catch`, leaving the cell reading
             * "Saving…" for ever. Against this rig it was a well-behaved
             * promise chain and every assertion passed.
             *
             * Microsoft's reference page types it `Promise`, which is where the
             * mistake came from; the samples that actually work call it
             * synchronously and await only `save()`. When the documentation and
             * the platform disagree, the platform wins — and this file is where
             * that has to be written down, because it is the only thing here
             * that a test can fail against.
             *
             * Fifth time this release the rig was more generous than the
             * platform, and the most expensive of the five.
             */
            record.setValue = function (name, value) {
                log('record.setValue', name);
                row.staged[name] = value;

                return undefined;
            };

            record.save = function () {
                log('record.save', row.id);

                if (quirks.saveRejects) {
                    // Rejected with an Error, but do not rely on that: a
                    // rejected platform call is typed `unknown` and is not
                    // reliably one — the caveat `pcf-kanban-board` records.
                    row.staged = {};

                    return Promise.reject(new Error('The platform refused this write.'));
                }

                /*
                 * **Resolving is not applying, and collapsing the two makes the
                 * rig lie.**
                 *
                 * A resolved `save()` means Dataverse accepted the write. It
                 * does *not* mean the dataset has re-read — that is a separate
                 * fetch, and until it lands the record still reports the old
                 * value. The gap is the entire reason an optimistic control
                 * keeps an override and retires it on the refresh rather than
                 * on the promise.
                 *
                 * This rig used to apply the values synchronously here, before
                 * resolving. So a control that retired its override the moment
                 * `save()` resolved passed every assertion — the record already
                 * agreed, and there was no window in which the old value could
                 * come back. On a form there is one, and the cell visibly jumps
                 * back and then forward.
                 *
                 * Committed values now wait for `handle.reread()`, which is the
                 * host re-reading. A rig more generous than the platform does
                 * not fail safe; it certifies the failure.
                 */
                row.committed = Object.assign(row.committed || {}, row.staged);
                row.staged = {};

                return Promise.resolve();
            };

            record.isDirty = function () {
                return Promise.resolve(Object.keys(row.staged).length > 0);
            };

            /*
             * **A Promise, because the platform's is.** `isEditable`,
             * `isSecured`, `isReadable` and `getFieldRequiredLevel` are async
             * while `isValid` and `getCurrencyDecimalPrecision` are not, and
             * nothing distinguishes them by name — so an unawaited call returns
             * a truthy Promise and every column looks editable. Returning a
             * bare boolean here would let exactly that bug pass.
             */
            record.isEditable = function (name) {
                return Promise.resolve(quirks.readOnlyColumns.indexOf(name) === -1);
            };

            return record;
        }

        var filtering = {
            /*
             * Returns what was set, which is how a control tells "the filter I
             * am about to apply" from "the filter already in force". Without
             * that comparison, re-applying on every `updateView` is an
             * unbounded refresh loop — the one `drive()` counts passes to
             * catch.
             */
            getFilter: function () {
                return requestedFilter || undefined;
            },

            setFilter: function (expression) {
                log('filtering.setFilter', expression && expression.conditions ? expression.conditions.length : 0);
                // Requested, not applied. Nothing changes until a fetch.
                requestedFilter = expression || null;
            },

            clearFilter: function () {
                log('filtering.clearFilter');
                requestedFilter = null;
            },
        };

        var dataset = {
            get columns() {
                return columns;
            },

            get sortedRecordIds() {
                return o.loading || o.error ? [] : visibleIds();
            },

            /*
             * Keyed by id and containing only the records of the current page,
             * because that is what the platform hands over — a control that
             * reaches for a record it was not given gets `undefined`, and the
             * scaffolded table's `if (!record) continue` is written for exactly
             * that.
             */
            get records() {
                var map = {};

                visibleIds().forEach(function (id) {
                    var row = allRecords.filter(function (candidate) {
                        return candidate.id === id;
                    })[0];

                    if (row) {
                        map[id] = recordFor(row);
                    }
                });

                return map;
            },

            /**
             * Mutated in place by the control. That is the documented API —
             * and `undefined` under `sortingAbsent`, which is what `npm start`
             * hands over.
             */
            get sorting() {
                return quirks.sortingAbsent ? undefined : sorting;
            },

            /**
             * Real filtering, and `undefined` under `filteringAbsent`.
             *
             * **Setting a filter is not a fetch.** `setFilter` records the
             * expression and not one row moves until the control calls
             * `refresh()` — which is the platform's contract and the half
             * people leave out, because a control that forgets the refresh
             * looks exactly like one whose filter did not match anything.
             *
             * Nor does it reset the page. Filter from page three and the
             * control is asking for page three of a result set that may have
             * one page in it; the platform will happily hand back nothing at
             * all. `paging.reset()` before `refresh()` is the control's job,
             * and leaving it out here is what makes the omission visible.
             */
            get filtering() {
                return quirks.filteringAbsent ? undefined : filtering;
            },

            paging: {
                get pageSize() {
                    return state.pageSize;
                },

                /*
                 * Follows the filter, because on the server it is a count of
                 * the *result set* rather than of the table. A pager that
                 * breaks under a filter is almost always reading a total that
                 * did not narrow with it.
                 */
                get totalResultCount() {
                    return quirks.uncounted ? -1 : matching().length;
                },

                get hasNextPage() {
                    return state.page * state.pageSize < matching().length;
                },

                /*
                 * False after paging forward, as observed. The platform treats
                 * the load as the range 1..N, and a range beginning at page one
                 * truthfully has nothing before it — so a pager driven by this
                 * can go forward and never come back.
                 */
                get hasPreviousPage() {
                    return quirks.previousPageStuck ? false : state.page > 1;
                },

                /*
                 * Disagrees with the ids when pages accumulate: it reports the
                 * current page while `sortedRecordIds` holds every page up to
                 * it. A label that takes its start from here and its row count
                 * from the array prints a range past its own total.
                 */
                get firstPageNumber() {
                    return state.page;
                },

                setPageSize: function (size) {
                    log('setPageSize', size);
                    // Requested, not applied. Nothing changes until a fetch.
                    state.requestedPageSize = size;
                },

                loadNextPage: function (loadOnlyNewPage) {
                    log('loadNextPage', loadOnlyNewPage);
                    state.page += 1;
                    fetched();
                },

                loadPreviousPage: function (loadOnlyNewPage) {
                    log('loadPreviousPage', loadOnlyNewPage);
                    state.page = Math.max(1, state.page - 1);
                    fetched();
                },

                loadExactPage: quirks.hasLoadExactPage
                    ? function (page) {
                        log('loadExactPage', page);
                        state.page = Math.max(1, page);
                        fetched();
                    }
                    : undefined,

                reset: function () {
                    log('paging.reset');
                    state.page = 1;
                    fetched();
                },
            },

            get loading() {
                return o.loading;
            },

            get error() {
                return o.error;
            },

            get errorMessage() {
                return o.errorMessage;
            },

            getTitle: function () {
                return fixture.title;
            },

            getTargetEntityType: function () {
                return fixture.targetEntityType;
            },

            refresh: function () {
                log('refresh');
                fetched();
            },

            openDatasetItem: function (reference) {
                log('openDatasetItem', reference && reference.id);
            },

            getSelectedRecordIds: function () {
                return [];
            },

            setSelectedRecordIds: function (ids) {
                log('setSelectedRecordIds', ids.length);
            },

            clearSelectedRecordIds: function () {
                log('clearSelectedRecordIds');
            },

            addColumn: function (name) {
                log('addColumn', name);
            },
        };

        /**
         * A round trip to the server: the requested page size takes effect and
         * a render is owed.
         *
         * Owed rather than performed, so that a control which refreshes from
         * inside `updateView` shows up as a count instead of a stack overflow.
         */
        function fetched() {
            state.pageSize = state.requestedPageSize;
            // The request becomes the result set here, and nowhere earlier.
            filter = requestedFilter;
            state.refreshes += 1;
            state.renderOwed = true;
        }

        function createContext() {
            var parameters = {
                records: dataset,
                /*
                 * **The control's `pageSize` input is not the host's page size,
                 * and this rig used to hand over one number for both.**
                 *
                 * `o.pageSize` is what the *platform* is paging at — what
                 * `paging.pageSize` reports, the way a main grid reports the
                 * user's *Rows per page*. The input below is what the *maker*
                 * typed into the property, and the point of that property
                 * carrying no `default-value` is that leaving it alone is a
                 * state the control can see. Seeding it from `o.pageSize` made
                 * that state unreachable: every mount looked like a maker who
                 * had deliberately asked for exactly what the host was already
                 * doing, so the adopt-the-host path was never once exercised.
                 */
                pageSize: {
                    raw: Object.hasOwn(o.inputs, 'pageSize') ? o.inputs.pageSize : null,
                    type: 'Whole.None',
                },
            };

            // The control's own inputs, wrapped the way the platform hands them
            // over. A raw `null` is a real value here — an input the maker left
            // unset — so it is passed through rather than defaulted.
            Object.keys(o.inputs).forEach(function (name) {
                parameters[name] = { raw: o.inputs[name], type: (parameters[name] || {}).type };
            });

            return {
                parameters: parameters,

                /**
                 * `context.navigation`, with `openFile` attached separately.
                 *
                 * **Presence is per method, not per bag**, which is the whole
                 * reason `openFile` is added conditionally rather than written
                 * into the literal. `context.navigation` is present on every
                 * host; `openFile` is documented model-driven only. A control
                 * that feature-detects the bag and then calls the method passes
                 * on the host it was written on and throws on the next one.
                 *
                 * Nothing is performed — the call is recorded, and the file's
                 * base64 is decoded back so an assertion can be about what the
                 * reader would actually open.
                 */
                navigation: quirks.navigationAbsent
                    ? undefined
                    : Object.assign(
                        { openUrl: function (url) { log('navigation.openUrl', url); } },
                        !openFormPresent
                            ? {}
                            : {
                                /**
                                 * Logged in full, because the options *are*
                                 * the behaviour: whether `useQuickCreateForm`
                                 * was set, whether `createFromEntity` named
                                 * the parent. Resolves `o.openFormReturns` —
                                 * the dismissal by default, see DEFAULTS.
                                 */
                                openForm: function (formOptions) {
                                    log('navigation.openForm', formOptions);

                                    return Promise.resolve(o.openFormReturns);
                                },
                            },
                        quirks.openFileAbsent
                            ? {}
                            : {
                                openFile: function (file, fileOptions) {
                                    var f = file || {};

                                    log('navigation.openFile', {
                                        fileName: f.fileName,
                                        fileSize: f.fileSize,
                                        mimeType: f.mimeType,
                                        openMode: (fileOptions || {}).openMode,
                                    });

                                    state.files.push({
                                        fileName: f.fileName,
                                        fileSize: f.fileSize,
                                        mimeType: f.mimeType,
                                        openMode: (fileOptions || {}).openMode,
                                        content: Buffer.from(f.fileContent || '', 'base64').toString('utf8'),
                                    });

                                    return Promise.resolve();
                                },
                            },
                    ),

                /**
                 * `context.utils`, absent on canvas and under `utilsAbsent`.
                 *
                 * **`getEntityMetadata` resolves with a class instance, not a
                 * plain object**, and this reproduces that rather than
                 * flattening it: the own enumerable properties are private
                 * fields and the public members are getters on the prototype,
                 * so code that walks `Object.keys` sees `_entityDescriptor`
                 * and nothing else, while reading `metadata.Attributes` by
                 * name works. A flat object here would let that code pass
                 * locally and fail on a form.
                 *
                 * `Attributes.get(column)` returns the node in the shape
                 * `fixture.metadata` asks for — `descriptor` or `map`, see
                 * `dev/fixture.js` — and `undefined` for a column the fixture
                 * says nothing about, which is what a real node does for a
                 * column that is not a choice or a lookup.
                 */
                utils: utilsPresent
                    ? {
                        getEntityMetadata: function (entityName, attributes) {
                            log('utils.getEntityMetadata', { entity: entityName, attributes: attributes });

                            if (quirks.metadataRejects) {
                                return Promise.reject(new Error('Metadata for ' + entityName + ' could not be read.'));
                            }

                            function Metadata() {
                                this._entityDescriptor = { EntityLogicalName: entityName };
                                this._attributes = attributes || [];
                            }

                            Object.defineProperty(Metadata.prototype, 'Attributes', {
                                get: function () {
                                    return {
                                        get: function (name) {
                                            return attributeNode(name);
                                        },
                                    };
                                },
                            });

                            return Promise.resolve(new Metadata());
                        },
                    }
                    : undefined,

                mode: {
                    isVisible: o.visible,
                    isControlDisabled: false,
                    label: fixture.title,
                    /*
                     * The parent record of a form subgrid, `undefined` on a
                     * main grid. Untyped on the platform; see DEFAULTS.
                     */
                    contextInfo: o.contextInfo
                        ? {
                            entityTypeName: o.contextInfo.entityTypeName,
                            entityId: o.contextInfo.entityId,
                            entityRecordName: o.contextInfo.entityRecordName,
                        }
                        : undefined,
                    // Recorded rather than delivered — "did the control ask for
                    // resize notifications" is a decision worth asserting; the
                    // resize itself comes from the `width` option.
                    trackContainerResize: function (value) {
                        log('trackContainerResize', value);
                        state.resizeTracked = value !== false;
                    },
                    setFullScreen: function (value) {
                        log('setFullScreen', value);
                    },
                    /*
                     * A getter, because the answer depends on something the
                     * control does rather than on how the host was configured:
                     * **the platform reports no width until the control has
                     * subscribed.** A plain property handed one over whether or
                     * not anything asked, which is how `pcf-data-table` shipped
                     * a pinning clamp that could never fire on a real form.
                     */
                    get allocatedWidth() {
                        return quirks.resizeUntracked && !state.resizeTracked ? -1 : o.width;
                    },
                    // Pinned at -1 under `heightUnmeasured`, whatever `height`
                    // says — a main grid answers the width and never this.
                    allocatedHeight: quirks.heightUnmeasured ? -1 : o.height,
                },

                /**
                 * `context.formatting`, the two methods a table needs. Renders
                 * en-US, which stands in for the *user's* locale and zone — on
                 * the platform `formatDateShort` follows the Dataverse user
                 * rather than the browser. Absent under `formattingAbsent`,
                 * which is the hub's demo harness.
                 */
                formatting: quirks.formattingAbsent
                    ? undefined
                    : {
                        formatDateShort: function (value, includeTime) {
                            return includeTime
                                ? value.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                                : value.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
                        },
                        formatDateLong: function (value) {
                            return value.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                        },
                    },

                resources: {
                    getString:
                        o.getString
                        || function (key) {
                            return STRINGS[key] !== undefined ? STRINGS[key] : key;
                        },
                },

                // Absent on a host that publishes no theme — canvas, and the
                // hub's own demo harness.
                fluentDesignLanguage: hostKind.publishesTheme ? { isDarkTheme: Boolean(o.dark) } : undefined,

                userSettings: { isRTL: o.rtl, languageId: 1033 },

                client: {
                    getClient: function () {
                        return o.formFactor === 'phone' || o.formFactor === 'tablet' ? 'Mobile' : 'Web';
                    },
                    getFormFactor: function () {
                        return FORM_FACTORS[o.formFactor] !== undefined ? FORM_FACTORS[o.formFactor] : 1;
                    },
                    isOffline: function () {
                        return false;
                    },
                },

                updatedProperties: [],
            };
        }

        return {
            dataset: dataset,
            context: createContext(),
            /** A fresh context object, as the platform hands down each pass. */
            nextContext: createContext,
            state: state,
            quirks: quirks,
            options: o,
            /** True while the control has asked for data it has not re-rendered against. */
            renderOwed: function () {
                return state.renderOwed;
            },
            settled: function () {
                state.renderOwed = false;
            },
            /**
             * The host re-reading after a write — a separate fetch from the
             * `save()` that resolved.
             *
             * Values committed by `record.save()` become visible on the records
             * only here. Until it is called, a control's own override is the
             * only thing holding the new value on screen, which is exactly the
             * state a control that retires too early gets wrong.
             */
            reread: function () {
                allRecords.forEach(function (row) {
                    if (!row.committed) {
                        return;
                    }

                    Object.keys(row.committed).forEach(function (name) {
                        row.values[name] = row.committed[name];
                    });
                    row.committed = null;
                });

                state.renderOwed = true;
            },
            /**
             * What the server holds for one cell, untouched by `getValue`'s
             * shaping. `getValue` on a choice hands back a string, as the
             * platform does, so it cannot say whether the control *wrote* the
             * integer `setValue` wants — this can.
             */
            stored: function (id, name) {
                var row = allRecords.filter(function (candidate) {
                    return candidate.id === id;
                })[0];

                return row ? row.values[name] : undefined;
            },
        };
    }

    /**
     * Render until the control stops asking for more, and say how many passes
     * it took.
     *
     * This is the single most useful thing this file does. A dataset control's
     * mutators — `setPageSize`, `refresh`, `loadExactPage` — all end in a new
     * `updateView`, so an unguarded one is an infinite loop that a browser
     * shows as a hang and a rendered table shows as nothing at all. Here it is
     * a number: **a settled control renders twice** (once, then once more for
     * the page size it asked for), and anything that keeps climbing to the
     * limit is the loop.
     */
    function drive(instance, handle, limit) {
        var passes = 0;
        var max = limit || 10;
        var element;

        do {
            handle.settled();
            element = instance.updateView(handle.nextContext());
            passes += 1;
        } while (handle.renderOwed() && passes < max);

        /*
         * `element` is what a *virtual* control returned on the last pass, and
         * `undefined` for a standard one, which wrote into its container
         * instead. Handing it back is what lets one set of assertions read
         * either shape — a virtual dataset control's decisions are all in the
         * props it passed down.
         */
        return { passes: passes, looping: handle.renderOwed(), element: element };
    }

    function captureRegistration(global) {
        var box = { name: null, ctor: null };

        global.ComponentFramework = global.ComponentFramework || {};
        global.ComponentFramework.registerControl = function (fullName, ctor) {
            box.name = fullName;
            box.ctor = ctor;
        };

        return box;
    }

    return {
        ASCENDING: ASCENDING,
        DESCENDING: DESCENDING,
        AND: AND,
        OR: OR,
        OPERATOR: OPERATOR,
        FORM_FACTORS: FORM_FACTORS,
        HOSTS: HOSTS,
        STRINGS: STRINGS,
        DEFAULTS: DEFAULTS,
        createHost: createHost,
        drive: drive,
        captureRegistration: captureRegistration,
    };
});
