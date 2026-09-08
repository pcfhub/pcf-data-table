/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the platform globals, loads
 * `out/controls/DataTable/bundle.js` the way a form would, binds it to a
 * twelve-record view with three pages in it, and asserts what the control did —
 * both what it passed down to its component and what it asked the platform for.
 *
 * Why it exists alongside `npm start`: half of what this control does is ask
 * the platform for things, and a rendered table shows none of it. Whether a
 * sort *replaced* the order or appended to it, whether a page turn asked for
 * page two or for "one more page", whether the selection survives a page change
 * — those are decisions, they are what regresses, and here they are assertions
 * with an exit code.
 *
 * This control is React-virtual, so `updateView` returns an element and the
 * assertions read the props it passed down. That is the better test of the two:
 * the props are the control's decisions, where the DOM is one rendering of
 * them.
 *
 * **What passing here does NOT mean.** Every record below is supplied by this
 * file. It cannot tell you that a real view hands over what this fixture hands
 * over, that server-side sorting sorts the same way, that `openDatasetItem`
 * opens anything, or that the ribbon reads `setSelectedRecordIds`. Keep those
 * in SPEC.md under "Not verified".
 *
 * **The quirks default to the platform's observed misbehaviour, not its
 * documentation.** See the header of `dev/host.js`: a harness modelling the
 * platform as written down passes a control that cannot page on a real form.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const clock = require('./clock.js');
const fixture = require('./fixture.js');

const BUNDLE = path.join(root, 'out', 'controls', 'DataTable', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/DataTable. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

/*
 * The filter debounce is a `window.setTimeout`, and `dom.install` makes `window`
 * the global — so replacing the timers here is what the bundle closes over.
 *
 * Installed rather than waited on: a real 300 ms wait would make every filter
 * assertion asynchronous and the suite three seconds slower for nothing, and a
 * test that waits *almost* long enough fails intermittently, which is worse
 * than one that fails.
 */
const time = clock.install(Date.parse('2026-01-01T09:00:00Z'), global);

const registration = host.captureRegistration(global);
const source = fs.readFileSync(BUNDLE, 'utf8');

/*
 * The platform libraries, under the names the bundle actually asks for — read
 * out of the bundle rather than written down here. `pcf-scripts` maps a
 * `<platform-library>` version onto the build it supports, so Fluent `9.46.2`
 * arrives as `FluentUIReactv940`; hardcoding it breaks on the next bump with a
 * ReferenceError naming a global that appears nowhere in this repository.
 */
const reactGlobals = [...new Set(source.match(/\bReactv[\w]*\b/g) || [])];
const fluentGlobals = [...new Set(source.match(/\bFluentUIReact[\w]*\b/g) || [])];

let React = null;

if (reactGlobals.length > 0) {
    React = require(path.join(root, 'node_modules', 'react'));
    reactGlobals.forEach((name) => {
        global[name] = React;
    });
}

/*
 * Fluent is stubbed rather than loaded: every component resolves to its own
 * name as an element type, so the props the control passed survive for
 * inspection. These assertions are about the control's decisions, not about how
 * Fluent renders them — and Fluent 9 ships no UMD build to load anyway.
 */
const fluent = new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? name : undefined) });

fluentGlobals.forEach((name) => {
    global[name] = fluent;
});

vm.runInThisContext(source, { filename: 'bundle.js' });

/**
 * Render what the control returned, executing the component body.
 *
 * **`updateView` only *builds* an element.** `DataTableControl` does not run
 * until something renders it, so an assertion that reads props alone cannot see
 * a crash inside the component — and `sortFor`, the function that carried the
 * `dataset.sorting` bug, lives there. A props-only suite passed against the
 * broken control, which is how this helper came to exist.
 *
 * `react-dom/server` needs no DOM and no browser. Fluent is stubbed, so its
 * components render as their own names and the markup is meaningless — the
 * point is entirely whether rendering threw.
 */
function renderDeep(element) {
    const server = require(path.join(root, 'node_modules', 'react-dom', 'server'));

    // React's development warnings about unknown element types would bury the
    // report; the assertions are about throwing, not about tag names.
    const warn = console.error;
    console.error = () => {};

    try {
        return server.renderToStaticMarkup(element);
    } finally {
        console.error = warn;
    }
}

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source".
const marked = (key) => `resx:${key}`;

/** The control's own input properties, at their manifest defaults. */
const INPUTS = {
    selectionMode: 'multiple',
    enableSorting: true,
    enableFiltering: true,
    openOnRowClick: true,
    enableExport: true,
    /*
     * `null`, not absent, and not a list. The platform builds the parameter
     * object for every declared property and reports `raw: null` for one the
     * maker left alone — so `null` is what "no rows-per-page picker" looks like
     * from inside the control, and it is the default worth testing against.
     */
    pageSizeOptions: null,
};

/**
 * Bind a fresh control to a fresh view and render until it settles.
 *
 * The returned handle exposes both halves: the props the control passed down,
 * and what the platform was asked to do.
 */
function bind(options) {
    const handle = host.createHost(fixture, {
        getString: marked,
        ...options,
        inputs: { ...INPUTS, ...(options && options.inputs) },
    });
    const instance = new registration.ctor();

    let notifications = 0;

    instance.init(handle.context, () => {
        notifications += 1;
    }, {}, dom.createElement('div'));

    let driven = host.drive(instance, handle, 10);

    return {
        instance,
        handle,
        get driven() {
            return driven;
        },
        props: () => (driven.element && driven.element.props) || {},
        outputs: () => instance.getOutputs(),
        notifications: () => notifications,
        calls: () => handle.state.calls,
        /** Let the platform catch up after something the control asked for. */
        settle: () => {
            driven = host.drive(instance, handle, 10);

            return driven;
        },
    };
}

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* ------------------------------------------------------------ the basics */

const view = bind({});

/*
 * A control that mutates in `updateView` without a guard never stops, and the
 * limit being reached is the loop.
 *
 * **One pass, where this used to be two.** The second pass was the page size:
 * the property carried `default-value="25"`, so every mount called
 * `setPageSize` and `refresh()` and cost a round trip — while replacing the
 * *Rows per page* the user had set on the grid. With no default there is
 * nothing to ask for, and the control settles on the first pass.
 */
check(
    'settles instead of refreshing forever',
    !view.driven.looping && view.driven.passes === 1,
    `${view.driven.passes} passes, calls: ${view.calls().join(' ')}`,
);

/*
 * The assertion about a call that must **not** happen — `pcf-row-commands`
 * shipped the override and had to be released twice to take it back out.
 */
check(
    'an unset page size overrides nothing — the host is already paging',
    view.calls().filter((call) => call.startsWith('setPageSize')).length === 0,
    view.calls().join(' '),
);

const overriding = bind({ inputs: { pageSize: 3 } });

check(
    'a page size the maker did set is asked for once and then left alone',
    overriding.calls().filter((call) => call.startsWith('setPageSize')).length === 1,
    overriding.calls().join(' '),
);

/*
 * A main grid answers the width and never the height — `-1` for the life of the
 * control, however politely it asks. A control that waits for a positive number
 * waits forever, which is how `pcf-row-commands` ran its rows off the bottom of
 * a page and took the pager with them.
 */
const unmeasured = bind({ width: 900, quirks: { heightUnmeasured: true } });

check(
    'renders on a host that measures a width and never a height',
    unmeasured.handle.context.mode.allocatedHeight === -1 && !unmeasured.driven.looping,
    `allocatedHeight ${unmeasured.handle.context.mode.allocatedHeight}`,
);

/*
 * `isHidden` and `order` are the maker's decisions in the view designer. The
 * fixture supplies its columns out of order and marks one hidden, so a control
 * that uses `dataset.columns` as handed over fails both of these.
 */
const columns = () => (view.props().columns || []).map((column) => column.displayName);

check('shows only the columns the maker left visible', columns().length === 6, columns().join(' | '));

check(
    'in the order the view designer set, not the order the array arrived in',
    columns()[0] === 'Account name' && columns()[1] === 'Account number',
    columns().join(' | '),
);

/* ------------------------------------------------------------------ paging */

check(
    'shows one page of records, not the whole view',
    (view.props().pageIds || []).length === 5,
    `${(view.props().pageIds || []).length} ids for a page size of 5 over 12 records`,
);

const paged = bind({});
paged.props().onNextPage();
paged.settle();

/*
 * **The assertion this rig exists for.**
 *
 * With `accumulatePages` on — the observed platform behaviour, and the default
 * — `sortedRecordIds` holds page one *and* page two after a forward page. A
 * control that uses the array it was given shows ten records here, with page
 * two stacked under page one, and looks completely correct against any
 * single-page fixture.
 */
check(
    'page two replaces page one rather than stacking under it',
    (paged.props().pageIds || []).length === 5,
    `${(paged.props().pageIds || []).length} ids on page 2; the platform handed over ${paged.handle.dataset.sortedRecordIds.length}`,
);

/*
 * `hasPreviousPage` stays false on a real form after paging forward, so a pager
 * driven by it can go forward and never come back. The control counts pages
 * itself for this reason, and this is what proves it does.
 */
check(
    'knows it is on page two even though the platform reports no previous page',
    paged.props().page === 2,
    `hasPreviousPage: ${paged.handle.dataset.paging.hasPreviousPage}; page: ${paged.props().page}`,
);

/*
 * **The pager chevrons are inline `<svg>`, and that is a theming decision.**
 *
 * The same glyph behind an `<img src>` — a resource, a data URL, PNG or SVG
 * alike — renders in an isolated document that cannot see this control’s
 * stylesheet, so its `currentColor` resolves to black and a dark form gets a
 * black chevron on a dark background. `pcf-file-drop` shipped exactly that, and
 * it was found on a real form rather than in review.
 *
 * Asserted against the rendered markup rather than against props, because the
 * chevron is markup: `updateView` only *builds* an element, and an icon that
 * fails to render is invisible to a props-only check. This control has no
 * `dev/harness.html` — a virtual control’s bundle wants Fluent under a global
 * and Fluent 9 ships no UMD build — so there is no browser to look in either.
 */
const markup = renderDeep(view.driven.element);

check(
    'the pager renders inline svg chevrons, not images',
    (markup.match(/<svg[^>]*DataTable-chevron/g) || []).length === 2 && !markup.includes('<img'),
    `${(markup.match(/<svg[^>]*DataTable-chevron/g) || []).length} chevrons, ${(markup.match(/<img/g) || []).length} images`,
);

check(
    'stroked with currentColor, so the Fluent theme decides their colour',
    (markup.match(/stroke="currentColor"/g) || []).length === 2,
);

/* Decorative: each sits on a button that already reads “Previous page”. */
check(
    'and hidden from the accessibility tree',
    (markup.match(/<svg[^>]*aria-hidden="true"/g) || []).length === 2,
);

/* The label is still there — the chevron was added beside it, not instead of
   it, so the accessible name is unchanged. */
check(
    'and the buttons still say what they do in words',
    markup.includes('resx:DataTable_Previous') && markup.includes('resx:DataTable_Next'),
);

check(
    'turning a page asks for that page by number',
    paged.calls().some((call) => call.indexOf('loadExactPage(2)') === 0),
    paged.calls().join(' '),
);

/*
 * `loadExactPage` is typed as required, which is a claim about the type
 * definitions rather than about the host.
 */
const noExact = bind({ quirks: { hasLoadExactPage: false } });
let fellBack = true;

try {
    noExact.props().onNextPage();
    noExact.settle();
} catch (error) {
    fellBack = false;
}

check(
    'pages without loadExactPage rather than throwing',
    fellBack && noExact.calls().some((call) => call.indexOf('loadNextPage') === 0),
    noExact.calls().join(' '),
);

/* ----------------------------------------------------------------- sorting */

const sorted = bind({});

sorted.props().onSort('name');
sorted.settle();
sorted.props().onSort('accountnumber');
sorted.settle();
sorted.props().onSort('statecode');
sorted.settle();

/*
 * `dataset.sorting` is the whole ORDER BY and it is mutated in place, so a
 * control that pushes instead of replacing builds a three-deep sort nobody
 * asked for — invisible against a fixture small enough that the first column
 * decides every comparison.
 */
check(
    'sorting a third column replaces the order rather than appending to it',
    sorted.handle.dataset.sorting.length === 1,
    `${sorted.handle.dataset.sorting.length} sort entries after three sorts`,
);

check(
    'a new order sends the reader back to page one',
    sorted.calls().some((call) => call === 'paging.reset'),
    sorted.calls().join(' '),
);

/*
 * **The host that supplies no sorting array at all, which is `npm start`.**
 *
 * Its dataset mock sets `sorting: undefined` while the type definitions call it
 * required, so `dataset.sorting.find(...)` throws — and the harness *swallows*
 * the TypeError. This control rendered as an empty box with nothing in the
 * console until the `?? []` in `sortFor` and the guard in `sortBy` landed.
 *
 * Verified against pcf-start 1.51.1 by instrumenting a control and reading the
 * dataset it was handed: `typeof dataset.sorting === "undefined"`, columns and
 * records both present, `isVisible: true` — everything needed to render, and a
 * blank container.
 *
 * Caught rather than allowed to propagate, because the failure being guarded
 * against is a throw: an uncaught one would end the run with a stack trace
 * instead of a named failing check.
 */
let unsorted = null;
let renderError = null;

try {
    unsorted = bind({ quirks: { sortingAbsent: true } });
    // Deep, not shallow: the crash is inside the component, which building the
    // element does not execute.
    renderDeep(unsorted.driven.element);
} catch (error) {
    renderError = `${error.constructor.name}: ${error.message}`;
}

check(
    'renders on a host that supplies no sorting array (npm start does not)',
    renderError === null && unsorted !== null && unsorted.driven.element !== undefined,
    renderError ? `threw during render — ${renderError}` : 'sorting was undefined',
);

let sortError = null;

if (unsorted) {
    try {
        unsorted.props().onSort('name');
        unsorted.settle();
    } catch (error) {
        sortError = `${error.constructor.name}: ${error.message}`;
    }
}

check(
    'and declines a sort it has no way to express, rather than throwing',
    unsorted !== null && sortError === null,
    sortError || undefined,
);

/* ------------------------------------------------------------------ export */

const exported = bind({ pageSize: 50 });

exported.props().onExport();

const file = exported.handle.state.files[0];
const csvLines = file ? file.content.split('\r\n') : [];

check(
    'exporting hands the host a CSV to save, not to open',
    Boolean(file) && file.mimeType === 'text/csv' && file.openMode === 2,
    file ? `${file.fileName} ${file.mimeType} openMode ${file.openMode}` : 'no file',
);

/*
 * The header row is the columns as drawn — visible only, in view order — so the
 * spreadsheet matches the table rather than the raw view behind it.
 */
check(
    'the header row is the columns the reader can see, in their order',
    csvLines[0] === '﻿Account name,Account number,Primary contact,Status,Annual revenue,Modified on',
    JSON.stringify(csvLines[0]),
);

/*
 * A BOM, because without one Excel reads UTF-8 as the local codepage and the
 * fixture's `école` opens as `Ã©cole`. Found by a customer, never by a test —
 * unless there is one.
 */
check(
    'and carries a BOM so Excel reads it as UTF-8',
    file && file.content.charCodeAt(0) === 0xfeff && file.content.includes('école Numérique'),
    file ? `first char U+${file.content.charCodeAt(0).toString(16).toUpperCase()}` : 'no file',
);

/*
 * The comma in `Consolidated Messenger…` is not there, but the long name is —
 * what matters is that a value holding a comma or a quote round-trips. `a10`'s
 * contact is `Margarethe Kowalczyk-Fitzgerald`, and the leading `-` case is
 * covered below.
 */
const quoted = bind({
    pageSize: 50,
    records: [
        { id: 'q1', values: { name: 'Smith, Roe & Co', accountnumber: 'Say "hello"', primarycontactname: 'Line\nBreak', statecode: 'Active', ownerid: '', revenue: 10, modifiedon: '2026-01-01' } },
        { id: 'q2', values: { name: '=HYPERLINK("http://evil","click")', accountnumber: '-1500', primarycontactname: '+1 555 0100', statecode: 'Active', ownerid: '', revenue: -250, modifiedon: '2026-01-02' } },
    ],
});

quoted.props().onExport();

const quotedCsv = quoted.handle.state.files[0].content;

check(
    'a value holding a comma, a quote or a newline is quoted rather than shifting the columns',
    quotedCsv.includes('"Smith, Roe & Co"') &&
        quotedCsv.includes('"Say ""hello"""') &&
        quotedCsv.includes('"Line\nBreak"'),
    JSON.stringify(quotedCsv.split('\r\n')[1]),
);

/*
 * **A cell beginning `=`, `+`, `-` or `@` is a formula to Excel, Sheets and
 * LibreOffice alike**, so a record someone named `=HYPERLINK(...)` runs when a
 * colleague opens the export. The apostrophe makes it text.
 */
check(
    'a formula in a record name is defused rather than exported as one',
    quotedCsv.includes(`"'=HYPERLINK(""http://evil"",""click"")"`) &&
        quotedCsv.includes("'+1 555 0100"),
    JSON.stringify(quotedCsv.split('\r\n')[2]),
);

/*
 * And the half that is easy to get wrong in the other direction: `-1500` is a
 * negative figure, not a formula. Prefixing it turns a column of numbers into a
 * column of text that will not sum, which is a quieter bug than the one the
 * guard is for.
 */
check(
    'a negative number stays a number',
    quotedCsv.includes(',-1500,') && quotedCsv.includes(',-250,') && !quotedCsv.includes("'-1500"),
    JSON.stringify(quotedCsv.split('\r\n')[2]),
);

/*
 * The host without `openFile` — canvas. The control must reach the Blob
 * fallback rather than checking `context.navigation` once and calling a method
 * that is not on it.
 */
let canvasExportError = null;
let canvasExport = null;

try {
    canvasExport = bind({ pageSize: 50, quirks: { openFileAbsent: true } });

    canvasExport.props().onExport();
} catch (error) {
    canvasExportError = `${error.constructor.name}: ${error.message}`;
}

check(
    'a host without openFile falls back rather than throwing',
    canvasExportError === null &&
        canvasExport !== null &&
        // Nothing reached openFile, so the other path is the one that ran.
        canvasExport.handle.state.files.length === 0 &&
        !canvasExport.calls().some((call) => call.startsWith('navigation.openFile')),
    canvasExportError || 'reached the browser download path',
);

/* ------------------------------------------------- jumping and page sizing */

const jumped = bind({});

jumped.props().onGoToPage(3);
jumped.settle();

check(
    'jumping asks for that page by number, not one step at a time',
    jumped.calls().some((call) => call === 'loadExactPage(3)') && jumped.props().page === 3,
    `page ${jumped.props().page}; ${jumped.calls().join(' ')}`,
);

/*
 * 12 records at a page size of 5 is three pages. A jump past the end used to be
 * unreachable — the pager moved by one and `hasNextPage` stopped it — and an
 * unclamped `goToPage` would leave the label reading "page 9" over the rows of
 * whatever the platform returned for it, which is usually nothing.
 */
jumped.props().onGoToPage(9);
jumped.settle();

check(
    'a jump past the last page lands on the last page',
    jumped.props().page === 3,
    `page ${jumped.props().page} of 3`,
);

/*
 * The host without `loadExactPage` can only step one page. A multi-page jump
 * there is refused rather than half-performed: calling `loadNextPage` once and
 * setting `page = 7` gives a pager reading "page 7" over page 2's rows, which
 * is worse than not moving.
 */
const stepwise = bind({ quirks: { hasLoadExactPage: false } });

stepwise.props().onGoToPage(3);
stepwise.settle();

check(
    'a host that can only step refuses a multi-page jump rather than lying',
    stepwise.props().page === 1 && !stepwise.calls().some((call) => call.startsWith('loadNextPage')),
    `page ${stepwise.props().page}; ${stepwise.calls().join(' ') || 'no paging calls'}`,
);

/*
 * **The regression the picker exists to expose.** Repaginating makes "page 3"
 * mean something else, and `applyPageSize` did not reset the page — harmless
 * while the size could only come from a property, which changes once at
 * configuration time; one click from page 3 once a reader can change it.
 */
const resized = bind({ inputs: { pageSizeOptions: '5,10,25' } });

resized.props().onGoToPage(2);
resized.settle();
resized.props().onPageSize(10);
const afterResize = resized.settle();

check(
    'changing the page size sends the reader back to page one',
    resized.props().page === 1 && resized.props().pageSize === 10,
    `page ${resized.props().page} at size ${resized.props().pageSize}`,
);

check(
    'and asks the platform once rather than looping',
    resized.calls().filter((call) => call === 'setPageSize(10)').length === 1 && !afterResize.looping,
    `${resized.calls().filter((call) => call === 'setPageSize(10)').length} calls, ${afterResize.passes} passes`,
);

/*
 * The picker is opt-in through a property with no `default-value`, and the
 * adopt-the-host path has to survive it: a maker who configured neither still
 * gets a control that never calls `setPageSize`. That is asserted for the
 * property in "an unset page size overrides nothing"; this is the other half.
 */
check(
    'no rows-per-page list means no picker, and no page size asked for',
    view.props().pageSizeOptions.length === 0 &&
        !view.calls().some((call) => call.startsWith('setPageSize')),
    `${view.props().pageSizeOptions.length} options; ${view.calls().join(' ') || 'no calls'}`,
);

/*
 * The current size is always offered, however the maker wrote the list —
 * a picker that cannot show its own state reads as broken.
 */
const oddList = bind({ pageSize: 7, inputs: { pageSizeOptions: '10, 25, notanumber, 9999, 25' } });

check(
    'the list is cleaned up and always contains the size in force',
    oddList.props().pageSizeOptions.join(',') === '7,10,25',
    oddList.props().pageSizeOptions.join(','),
);

/* --------------------------------------------------------------- filtering */

/**
 * Type into one filter box and let the debounce expire.
 *
 * The 300 ms is the control's, and 500 is comfortably past it without being a
 * guess about scheduling: `clock.advance` fires everything due in the window.
 */
const typeFilter = (handle, columnName, value) => {
    handle.props().onFilter(columnName, value);
    time.advance(500);

    return handle.settle();
};

const filtered = bind({ pageSize: 50 });

typeFilter(filtered, 'name', 'tra');

/*
 * The whole point of doing this server-side. A control filtering the array on
 * screen would narrow twelve rows out of a view that may hold thousands, which
 * is a wrong answer that looks completely right — the same argument that keeps
 * sorting off the client here.
 *
 * Asserted on the ids rather than on the call, because `setFilter` without a
 * `refresh()` logs identically and moves nothing. The rig models that split
 * deliberately; see the note on `requestedFilter` in `dev/host.js`.
 */
check(
    'filtering narrows the result set rather than the page',
    filtered.props().pageIds.length === 1 && filtered.props().pageIds[0] === 'a03',
    `${filtered.props().pageIds.length} rows: ${filtered.props().pageIds.join(',')}`,
);

check(
    'a filter sends the reader back to page one',
    filtered.calls().some((call) => call === 'paging.reset') && filtered.props().page === 1,
    `page ${filtered.props().page}`,
);

/*
 * **The guard that stops this being a hang.**
 *
 * `refresh()` fires `updateView`, so a control that re-applies the expression
 * it is already filtering by refreshes forever. Counting refreshes is what
 * catches it: `drive()` would otherwise report a settled render either way,
 * because the rig's `fetched()` does not re-enter `updateView` itself.
 */
const beforeRepeat = filtered.handle.state.refreshes;

typeFilter(filtered, 'name', 'tra');

check(
    're-applying an identical filter asks the platform for nothing',
    filtered.handle.state.refreshes === beforeRepeat,
    `${filtered.handle.state.refreshes - beforeRepeat} extra refreshes`,
);

/*
 * The `'none'` initial state, and why it is not `''`. A view arrives
 * unfiltered, so clearing a filter nobody set is already the platform's state —
 * and starting from `''` spends a `clearFilter`, a `paging.reset()` and a round
 * trip on the first keystroke of every session before anything can match.
 */
const untouched = bind({});
const beforeClear = untouched.handle.state.refreshes;

untouched.props().onClearFilters();
untouched.settle();

check(
    'clearing a filter that was never set costs no round trip',
    untouched.handle.state.refreshes === beforeClear,
    `${untouched.handle.state.refreshes - beforeClear} extra refreshes`,
);

/*
 * Two boxes have to mean "both". `pcf-view-filter` ORs, because it takes one
 * term and looks for it in any of several columns; a filter *row* is the other
 * shape, and with `Or` a second filter would return more rows than the first —
 * which reads as the control ignoring what was typed.
 */
/*
 * Both columns have to be filterable ones, and that is not a detail. Written
 * first against `statecode`, this passed while proving nothing: an OptionSet
 * contributes no condition, so there was only ever one filter and `And` versus
 * `Or` could not show. Flipping the constant to `Or` still passed. `Or` here
 * returns 10 rows against `And`'s 4.
 *
 * 10 rather than 12 on the first filter: `a09`'s account number is null and
 * `a11`'s is ACC-0007, and neither matches `%ACC-1%`.
 */
const narrowed = bind({ pageSize: 50 });

typeFilter(narrowed, 'accountnumber', 'ACC-1');
const afterOne = narrowed.props().pageIds.length;
typeFilter(narrowed, 'revenue', '>3000000');

check(
    'a second filter narrows rather than widens',
    afterOne === 10 && narrowed.props().pageIds.length === 4,
    `${afterOne} rows on one filter, ${narrowed.props().pageIds.length} on two`,
);

/*
 * The numeric box takes a comparison prefix, and a half-typed one must send
 * nothing rather than a condition comparing against NaN — which the server
 * rejects by naming the column, in a network trace nobody is reading.
 */
const halfTyped = bind({ pageSize: 50 });

typeFilter(halfTyped, 'revenue', '>');

check(
    'a half-typed comparison filters nothing rather than filtering wrongly',
    halfTyped.props().pageIds.length === 12,
    `${halfTyped.props().pageIds.length} rows`,
);

/*
 * **The filter row has to survive matching nothing.**
 *
 * The boxes live in `<thead>`, and the control used to return a bare message
 * the moment `pageIds` was empty — so one character too many would delete the
 * only UI that can undo it, leaving the reader no route back to their own data.
 *
 * Asserted against rendered markup rather than props: the early return is in
 * the component, and `updateView` only builds an element.
 */
const empty = bind({ pageSize: 50 });

typeFilter(empty, 'name', 'zzzznothing');
const emptyMarkup = renderDeep(empty.driven.element);

check(
    'a filter that matches nothing keeps the row that can clear it',
    empty.props().pageIds.length === 0 &&
        emptyMarkup.includes('DataTable-filterRow') &&
        emptyMarkup.includes('resx:DataTable_NoMatches'),
    `${empty.props().pageIds.length} rows; filter row ${emptyMarkup.includes('DataTable-filterRow') ? 'kept' : 'GONE'}`,
);

/*
 * A column whose values the server cannot be asked about gets no box at all.
 * The fixture's date and lookup columns are there for this: a text input over
 * a date builds a comparison against the wrong thing, and a choice or lookup
 * filters on an integer or a GUID that `Column` does not carry.
 */
check(
    'only the columns that can be filtered get a box',
    (emptyMarkup.match(/class="DataTable-filter"/g) || []).length === 4,
    `${(emptyMarkup.match(/class="DataTable-filter"/g) || []).length} inputs across 6 visible columns`,
);

/*
 * The host that removes `filtering` altogether. Same shape of risk as
 * `sortingAbsent` and one step less certain — the types declare it required, so
 * a control that calls `setFilter` through it unguarded has taken them at their
 * word.
 */
let unfilterable = null;
let filterRenderError = null;

try {
    unfilterable = bind({ quirks: { filteringAbsent: true } });
    renderDeep(unfilterable.driven.element);
} catch (error) {
    filterRenderError = `${error.constructor.name}: ${error.message}`;
}

check(
    'renders on a host that supplies no filtering at all',
    filterRenderError === null,
    filterRenderError || 'filtering was undefined',
);

check(
    'and offers no filter row rather than boxes that do nothing',
    unfilterable !== null && unfilterable.props().enableFiltering === false,
    unfilterable === null ? 'did not render' : `enableFiltering ${unfilterable.props().enableFiltering}`,
);

/* --------------------------------------------------------------- selection */

const picked = bind({});

picked.props().onToggleRow('a01');
picked.props().onToggleRow('a03');
picked.settle();

check(
    'ticking rows records them in the order they were ticked',
    picked.outputs().selectedRecordIds === 'a01\na03',
    JSON.stringify(picked.outputs().selectedRecordIds),
);

/*
 * `setSelectedRecordIds` is not bookkeeping: on a model-driven subgrid it is
 * how this control tells the form's command bar which records the ribbon
 * buttons act on. A control that keeps its own copy and forgets to tell the
 * platform leaves the ribbon acting on nothing.
 */
check(
    'and tells the platform, so the command bar acts on them',
    picked.calls().filter((call) => call.indexOf('setSelectedRecordIds') === 0).length === 2,
    picked.calls().filter((call) => call.indexOf('setSelectedRecordIds') === 0).join(' '),
);

check('each change notifies exactly once', picked.notifications() === 2, String(picked.notifications()));

/*
 * Selection survives paging, deliberately: ids are stable, and a user who ticks
 * three rows on page one and pages forward has not changed their mind about
 * them. The platform's own copy does not survive a refresh, which is why the
 * control keeps its own.
 */
const kept = bind({});

kept.props().onToggleRow('a01');
kept.settle();
kept.props().onNextPage();
kept.settle();

check(
    'a selection survives a page change',
    kept.outputs().selectedRecordIds === 'a01' && kept.props().page === 2,
    `${JSON.stringify(kept.outputs().selectedRecordIds)} on page ${kept.props().page}`,
);

/*
 * Single-select replaces rather than accumulates. `toggleId` is where that
 * lives, and it is invisible in a rendered table until someone ticks a second
 * row and both stay ticked.
 */
const single = bind({ inputs: { selectionMode: 'single' } });

single.props().onToggleRow('a01');
single.props().onToggleRow('a02');
single.settle();

check(
    'single-select keeps one row, not two',
    single.outputs().selectedRecordIds === 'a02',
    JSON.stringify(single.outputs().selectedRecordIds),
);

/*
 * Switching the maker's setting to `none` has to clear what is already ticked —
 * otherwise a form keeps acting on a selection the user can no longer see or
 * change.
 */
const off = bind({});

off.props().onToggleRow('a01');
off.settle();

const cleared = off.instance.updateView(
    host.createHost(fixture, { getString: marked, inputs: { ...INPUTS, selectionMode: 'none' } }).context,
);

check(
    'switching selection off clears what was already ticked',
    off.outputs().selectedRecordIds === '' && cleared !== undefined,
    JSON.stringify(off.outputs().selectedRecordIds),
);

/*
 * `getOutputs` returns every output property, and `undefined` means "no
 * change" rather than "empty" — so a cleared selection has to travel as the
 * empty string or a form can never observe it being cleared.
 */
check(
    'a cleared selection is observable, not "no change"',
    off.outputs().selectedRecordIds !== undefined && off.outputs().openedRecordId !== undefined,
    JSON.stringify(off.outputs()),
);

/* ------------------------------------------------------------- the states */

check(
    'an empty view produces no rows',
    (bind({ records: [] }).props().pageIds || []).length === 0,
);

check(
    'a host that publishes no theme is passed none rather than a guess',
    bind({ host: 'canvas' }).props().theme === undefined,
);

report();

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real view still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
