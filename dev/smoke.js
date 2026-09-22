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
    /*
     * Unset, for the same reason and with the same force: pinning nothing has
     * to be the shape the control is tested in most, because it is the shape
     * every existing installation upgrades into. Every assertion written before
     * 0.3.0 runs against these.
     */
    pinnedStart: null,
    pinnedEnd: null,
    /*
     * Editing off, which is the manifest default and the shape every assertion
     * written before 0.3.0 runs in. A control nobody has configured must not
     * write, and must not spend a fetch per cell asking whether it could.
     */
    enableEditing: false,
    editableColumns: null,
    /*
     * Off, the manifest default, for the reason `enableEditing` is: a control
     * nobody configured must not offer to create rows.
     */
    enableCreate: false,
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

/** The fixture's visible columns — every count below derives from this rather than restating it. */
const VISIBLE = fixture.columns.filter((column) => !column.isHidden).length;

check('shows only the columns the maker left visible', columns().length === VISIBLE, columns().join(' | '));

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

/*
 * Three, not two: Previous, Next, and the export glyph, which reuses the same
 * class because it wants the identical box and the identical RTL treatment.
 *
 * The count stays exact rather than becoming `>= 2`. A glyph added without a
 * thought about `currentColor` is precisely what this check exists to catch, so
 * it is worth making somebody come here and change the number — the two below
 * are written against this one so there is only ever one number to change.
 */
const glyphs = (markup.match(/<svg[^>]*DataTable-chevron/g) || []).length;

check(
    'the pager renders inline svg glyphs, not images',
    glyphs === 3 && !markup.includes('<img'),
    `${glyphs} glyphs, ${(markup.match(/<img/g) || []).length} images`,
);

check(
    'stroked with currentColor, so the Fluent theme decides their colour',
    (markup.match(/stroke="currentColor"/g) || []).length === glyphs,
);

/* Decorative: each sits on a button that already reads “Previous page”. */
check(
    'and hidden from the accessibility tree',
    (markup.match(/<svg[^>]*aria-hidden="true"/g) || []).length === glyphs,
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
    csvLines[0] === '﻿Account name,Account number,Primary contact,Status,Annual revenue,Modified on,Industry,Last contacted',
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

/*
 * **Export is not a way through the pages, and the markup has to say so.**
 *
 * `.DataTable-pager button` is written for Previous and Next, so a button added
 * anywhere in that row inherits their box and joins the group. It did: on the
 * first real form Export CSV was a bordered chip between Previous and the jump
 * box, reading as a third pager control. It now lives in a tools group after
 * Next, which is what this asserts — position rather than appearance, since the
 * appearance is CSS the rig cannot see.
 */
check(
    'the export button sits after the paging controls, not among them',
    markup.indexOf('DataTable-pagerTools') > markup.indexOf('resx:DataTable_Next') &&
        markup.indexOf('DataTable-export') > markup.indexOf('DataTable-pagerTools'),
    `Next at ${markup.indexOf('resx:DataTable_Next')}, tools at ${markup.indexOf('DataTable-pagerTools')}, export at ${markup.indexOf('DataTable-export')}`,
);

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

/* ----------------------------------------------------------- narrow hosts */

/*
 * **A phone subgrid is 320px and the table has to scroll, not squeeze.**
 *
 * `.DataTable-scroll` has carried `overflow-x: auto` since the first release and
 * it was inert: `table-layout: fixed` with `width: 100%` makes the table exactly
 * as wide as its container, so there is never anything to overflow. Measured in
 * a 320px box, a seven-column view drew columns of 28 to 63 pixels — every cell
 * an ellipsis, and no scrollbar, because as far as the browser was concerned it
 * all fitted.
 *
 * The minimum width is what turns the overflow back on, and it is inline on the
 * table because it depends on the column count, which CSS cannot read. Asserted
 * on the markup for that reason — this is one of the few style decisions the
 * control makes rather than the stylesheet.
 */
const narrowMarkup = renderDeep(view.driven.element);
const minWidth = (narrowMarkup.match(/min-width:\s*(\d+)px/) || [])[1];

check(
    'the table carries a minimum width, so a narrow host scrolls rather than squeezing',
    // The visible columns at 100 each, plus the 40px select column.
    minWidth === String(VISIBLE * 100 + 40),
    `min-width: ${minWidth || 'absent'}px`,
);

/*
 * And it has to scale with the view. A fixed number in the stylesheet would be
 * too wide for a two-column subgrid and far too narrow for a twelve-column one.
 */
const narrowNoSelect = bind({ inputs: { selectionMode: 'none' } });
const noSelectMin = (renderDeep(narrowNoSelect.driven.element).match(/min-width:\s*(\d+)px/) || [])[1];

check(
    'and drops the select column from that width when there is no select column',
    noSelectMin === String(VISIBLE * 100),
    `min-width: ${noSelectMin || 'absent'}px without checkboxes`,
);

/* ----------------------------------------------------------------- pinning */

/*
 * **Pinned columns are a layout decision, so they are asserted on markup.**
 *
 * `position: sticky` itself is in the stylesheet and cannot be seen from here.
 * What the control decides — which cells get the class, how far in each one
 * sits, how wide it is, and whether pinning is affordable at all — is inline,
 * for the same reason the minimum width above is: it is a running sum of column
 * widths, and CSS cannot add up a `<colgroup>`.
 *
 * The counts are exact rather than "more than none", because the failure worth
 * catching is a pinned *header* over unpinned *cells*: the column separates
 * into a heading that stays and a body that scrolls away, which looks like two
 * different bugs and is one missing class.
 */
const pinCount = (markup, edge) =>
    (markup.match(new RegExp(`is-pinned-${edge}`, 'g')) || []).length;

/*
 * **The control has to ask for its own width before it can read one.**
 *
 * `mode.allocatedWidth` stays -1 until `trackContainerResize(true)` is called —
 * measured on a real Accounts subgrid, 2026-09-09, where a build that never
 * subscribed read -1 with `allocatedHeight` at -1 beside it. Everything the
 * clamp below decides rests on that number.
 *
 * This assertion exists because the rig used to hand over the `width` option
 * whether or not anything asked, so the clamp passed here and was dead code on
 * every form. `quirks.resizeUntracked` closes the gap; this states the
 * requirement so it fails loudly rather than silently reverting to "unmeasured".
 */
check(
    'the control asks to be told its width, or it can never know one',
    view.calls().some((call) => call.indexOf('trackContainerResize(true)') === 0),
    view.calls().filter((call) => call.startsWith('trackContainerResize')).join(' ') || 'never asked',
);

/*
 * **The measured width has to reach the root, or `overflow-x: auto` is inert.**
 *
 * A form section can hand a control a shrink-to-fit parent — `fit-content`,
 * `inline-block`, a table cell — which takes its width *from* its content. The
 * control's own `width: 100%` then resolves against a number the control
 * produced, the table draws wider than its box, an ancestor clips it, and **no
 * scrollbar appears at all**. Nothing written in CSS breaks that circle.
 *
 * 0.3.0 called `trackContainerResize(true)` and used `allocatedWidth` only for
 * the pinning clamp, so on a real subgrid the table was clipped rather than
 * scrolled and an end-pinned column could never be seen to pin — observed
 * 2026-09-09. Asserting the inline style because that is where the number can
 * go: it comes from the host, and CSS cannot read it.
 */
const measured = bind({ width: 900 });

check(
    'the measured width becomes a ceiling on the root, so the table can scroll inside it',
    renderDeep(measured.driven.element).includes('max-width:900px'),
    (renderDeep(measured.driven.element).match(/max-width:[^;"]*/) || ['absent'])[0],
);

check(
    'and a host that never measured gets no ceiling rather than a guess',
    !renderDeep(view.driven.element).includes('max-width'),
    'no max-width at allocatedWidth -1',
);

check(
    'nothing is pinned unless the maker asked',
    !narrowMarkup.includes('is-pinned'),
    'no pinned cells at the manifest defaults',
);

const pinnedOne = bind({ inputs: { pinnedStart: 1 } });
const pinnedOneMarkup = renderDeep(pinnedOne.driven.element);

check(
    'pinning the first column pins it in every row, not only in the header',
    // 5 body rows plus the header and the filter row, for the select column
    // and the pinned column alike: (5 + 2) × 2.
    pinCount(pinnedOneMarkup, 'start') === 14,
    `${pinCount(pinnedOneMarkup, 'start')} pinned cells`,
);

check(
    'and pins the select column with it, so the checkboxes cannot slide underneath',
    (pinnedOneMarkup.match(/inset-inline-start:\s*0px/g) || []).length === 7
        && (pinnedOneMarkup.match(/inset-inline-start:\s*40px/g) || []).length === 7,
    'select column at 0px, the column beside it at 40px',
);

check(
    'the seam is drawn once per pinned run, on the column the others scroll past',
    (pinnedOneMarkup.match(/is-pinnedEdge/g) || []).length === 7,
    `${(pinnedOneMarkup.match(/is-pinnedEdge/g) || []).length} edge cells`,
);

/*
 * The two width systems have to agree, and this is the assertion that says so.
 * A pinned column is pixels because its neighbour's offset is a sum of them; a
 * loose column is a share of *what is left*, which is why the calc subtracts
 * the pinned total rather than dividing the whole table. Bare percentages here
 * would ask for 240px more table than there is.
 */
check(
    'a pinned column takes pixels and the rest divide what is left',
    pinnedOneMarkup.includes('width:200px')
        && pinnedOneMarkup.includes('calc((100% - 240px)'),
    'pinned at its own width; loose columns share the remainder',
);

const pinnedMin = (pinnedOneMarkup.match(/min-width:\s*(\d+)px/) || [])[1];

check(
    'and the minimum width counts the pinned pixels rather than the budget',
    // 200 pinned + 40 select + the loose columns at the 100px budget.
    pinnedMin === String(200 + 40 + (VISIBLE - 1) * 100),
    `min-width: ${pinnedMin || 'absent'}px`,
);

const pinnedEnd = bind({ inputs: { pinnedEnd: 1 } });
const pinnedEndMarkup = renderDeep(pinnedEnd.driven.element);

check(
    'pinning at the end sticks to the other edge, and leaves the select column alone',
    pinCount(pinnedEndMarkup, 'end') === 7
        && pinCount(pinnedEndMarkup, 'start') === 0
        && pinnedEndMarkup.includes('inset-inline-end:0px'),
    `${pinCount(pinnedEndMarkup, 'end')} end-pinned cells, no select column`,
);

/*
 * **The clamp, and it is the assertion that matters most on a phone.**
 *
 * A 320px subgrid with a 200px column pinned beside a 40px select column leaves
 * 80px of scrollable table — narrower than the 100px budget a single column
 * gets. Pinning there is worse than not pinning: the reader is left with a
 * sliver of moving content beside a wall of still one. `mode.allocatedWidth` is
 * the measurement that can answer this, and it is the one a main grid actually
 * reports — the height stays -1 forever.
 */
const pinnedNarrow = bind({ width: 320, inputs: { pinnedStart: 1 } });

check(
    'pinning switches itself off where it would leave nothing to scroll',
    !renderDeep(pinnedNarrow.driven.element).includes('is-pinned'),
    'unpinned in a 320px host',
);

/*
 * And it must not overreach the other way. A host that reports no width at all
 * — the default here, and what `npm start` does — has not said "no room"; a
 * control that read -1 as a refusal would unpin itself everywhere.
 */
check(
    'a host that never measured gets the pinning it asked for, not a guess',
    pinnedOne.handle.context.mode.allocatedWidth === -1
        && pinnedOneMarkup.includes('is-pinned'),
    'allocatedWidth -1, still pinned',
);

/*
 * Pinning every column is a table that cannot scroll, drawn with a scrollbar.
 * The end of the run is trimmed before the start, because the start columns are
 * the ones that identify the row you have scrolled away from.
 */
const pinnedAll = bind({ inputs: { pinnedStart: VISIBLE, pinnedEnd: 2 } });
const pinnedAllMarkup = renderDeep(pinnedAll.driven.element);

check(
    'at least one column is always left to scroll',
    // All but one of the data columns, plus the select column riding along.
    pinCount(pinnedAllMarkup, 'start') === (VISIBLE - 1 + 1) * 7
        && pinCount(pinnedAllMarkup, 'end') === 0,
    `${pinCount(pinnedAllMarkup, 'start') / 7 - 1} of ${VISIBLE} data columns pinned, end trimmed first`,
);

/*
 * Logical insets, not `left`. The offsets are measured from the start of the
 * table, and in a right-to-left form the start is the right — so a physical
 * `left` would pin the first column to the far side of the row it belongs to.
 * Nothing below a browser can prove the sticking works; this proves the control
 * is not writing the property that cannot.
 */
check(
    'offsets are written as logical insets, so a right-to-left form pins the same columns',
    !/style="[^"]*(?:^|;)\s*left:/.test(pinnedOneMarkup)
        && pinnedOneMarkup.includes('inset-inline-start'),
    'inset-inline-start, no physical left',
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
 * **The clear button appears only once there is something to clear**, and it
 * does not wait for the debounce. Pressing it is a finished decision, not
 * typing, so holding the result for 300 ms makes the button feel broken.
 *
 * `settle()` alone, with no `time.advance`, is what asserts that: if the clear
 * went through the debounce this would still show the old filter.
 */
const clearBox = bind({ pageSize: 50 });

check(
    'no clear button until a filter has something in it',
    !renderDeep(clearBox.driven.element).includes('DataTable-filterClear'),
);

typeFilter(clearBox, 'name', 'tra');

check(
    'and one appears in the box that has',
    (renderDeep(clearBox.driven.element).match(/DataTable-filterClear/g) || []).length === 1 &&
        renderDeep(clearBox.driven.element).includes('resx:DataTable_ClearFilter'),
    `${(renderDeep(clearBox.driven.element).match(/DataTable-filterClear/g) || []).length} clear buttons`,
);

clearBox.props().onClearFilter('name');
clearBox.settle();

check(
    'clearing one filter takes effect without waiting for the debounce',
    clearBox.props().pageIds.length === 12 &&
        !renderDeep(clearBox.driven.element).includes('DataTable-filterClear'),
    `${clearBox.props().pageIds.length} rows back`,
);

/*
 * A column whose values the server cannot be asked about gets no box at all.
 *
 * Three text boxes, the number box and — since 0.4.0 — the two date boxes. The two
 * choice columns are not among them **here**, and that is a limit of the
 * renderer rather than of the control: `renderToStaticMarkup` runs no effects,
 * so the metadata the choice box is built from never arrives and the column
 * renders its read-only fallback. The positive case is asserted in
 * `choiceChecks` below on the props, and photographed by `dev/preview.html`.
 */
check(
    'only the columns that can be filtered get a box',
    (emptyMarkup.match(/class="DataTable-filter"/g) || []).length === 6,
    `${(emptyMarkup.match(/class="DataTable-filter"/g) || []).length} inputs across ${VISIBLE} visible columns`,
);

/*
 * **A row of empty bordered boxes does not say it is a filter row**, which is
 * what it looked like on the first real form. The accessible name was there
 * from the start; the visible hint was not, and a sighted reader had nothing to
 * go on but the shape.
 */
check(
    'each filter box says what it is, visibly and not only to a screen reader',
    (emptyMarkup.match(/placeholder="resx:DataTable_Filter\w*Placeholder"/g) || []).length === 4,
    `${(emptyMarkup.match(/placeholder="/g) || []).length} placeholders`,
);

/*
 * And the gap between them says why it is a gap. A blank cell in the middle of
 * a filter row reads as a box that failed to render rather than as a column
 * that cannot be filtered — the same failure in the other direction.
 */
check(
    'a column that cannot be filtered says so rather than showing a blank',
    (emptyMarkup.match(/class="DataTable-filterNone"/g) || []).length === 2 &&
        emptyMarkup.includes('resx:DataTable_Unfilterable'),
    `${(emptyMarkup.match(/class="DataTable-filterNone"/g) || []).length} unfilterable cells`,
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

/* ------------------------------------------------------------ date filter */

/**
 * The rig first. `holds()` used to pass every operator it did not model, so
 * a control sending `On` (25) narrowed nothing here and read as working to
 * any assertion that counted rows. This is the check that the case exists:
 * remove it from the switch and one row becomes twelve.
 */
const rigDates = host.createHost(fixture, { pageSize: 50, inputs: INPUTS });

rigDates.dataset.filtering.setFilter({
    filterOperator: host.AND,
    conditions: [{ attributeName: 'modifiedon', conditionOperator: host.OPERATOR.On, value: '2026-03-01' }],
});
rigDates.dataset.refresh();

check(
    'the rig models On by calendar day rather than passing it through',
    rigDates.dataset.sortedRecordIds.length === 1 && rigDates.dataset.sortedRecordIds[0] === 'a09',
    `${rigDates.dataset.sortedRecordIds.length} rows for On 2026-03-01`,
);

/*
 * The condition, exactly. `value` is the day as typed and the operator is 25
 * — not a `GreaterEqual` against a string, which is what a date column got
 * from a control that treated it as text, and which the server compares as
 * the wrong thing.
 */
const dated = bind({ pageSize: 50 });

typeFilter(dated, 'modifiedon', '2026-03-01');
const dateExpression = dated.handle.dataset.filtering.getFilter();

check(
    'a date box sends On with the day as typed',
    JSON.stringify(dateExpression) === JSON.stringify({
        filterOperator: 0,
        conditions: [{ attributeName: 'modifiedon', conditionOperator: 25, value: '2026-03-01' }],
    })
        && dated.props().pageIds.length === 1,
    JSON.stringify(dateExpression),
);

/*
 * The toggle re-asks straight away — no debounce, on the `clearFilterValue`
 * argument that a click is a finished decision — so `settle()` alone is what
 * proves it did not wait. From is 27 and Until is 26; the counts differ from
 * each other and from On, so a swapped pair cannot pass.
 */
const beforeOp = dated.handle.state.refreshes;

dated.props().onFilterOp('modifiedon', 'from');
dated.settle();

check(
    'From sends OnOrAfter without waiting for the debounce',
    dated.handle.dataset.filtering.getFilter().conditions[0].conditionOperator === 27
        && dated.props().pageIds.length === 4
        // `paging.reset()` is a fetch in its own right here, so "re-asked" is
        // more than before rather than exactly one more.
        && dated.handle.state.refreshes > beforeOp,
    `operator ${dated.handle.dataset.filtering.getFilter().conditions[0].conditionOperator}, ${dated.props().pageIds.length} rows, ${dated.handle.state.refreshes - beforeOp} refreshes`,
);

dated.props().onFilterOp('modifiedon', 'until');
dated.settle();

check(
    'and Until sends OnOrBefore',
    dated.handle.dataset.filtering.getFilter().conditions[0].conditionOperator === 26
        && dated.props().pageIds.length === 9,
    `operator ${dated.handle.dataset.filtering.getFilter().conditions[0].conditionOperator}, ${dated.props().pageIds.length} rows`,
);

/*
 * Clear filters empties the boxes and leaves the toggles. An operator is how
 * the reader wants a column compared, not what they asked for; a Clear that
 * flipped every From back to On would undo a preference to answer a query.
 */
dated.props().onClearFilters();
dated.settle();

check(
    'clearing the filters keeps the operator the reader chose',
    dated.props().pageIds.length === 12 && dated.props().filterOps.modifiedon === 'until',
    `${dated.props().pageIds.length} rows, operator ${dated.props().filterOps.modifiedon}`,
);

/*
 * A toggle over an empty box changes no expression, so it must cost no round
 * trip — and it still has to be remembered, or the next day typed would be
 * compared the old way.
 */
const untoggled = bind({ pageSize: 50 });
const beforeToggle = untoggled.handle.state.refreshes;

untoggled.props().onFilterOp('modifiedon', 'from');
untoggled.settle();

check(
    'toggling the operator with an empty box asks the platform for nothing',
    untoggled.handle.state.refreshes === beforeToggle && untoggled.props().filterOps.modifiedon === 'from',
    `${untoggled.handle.state.refreshes - beforeToggle} refreshes, operator ${untoggled.props().filterOps.modifiedon}`,
);

/*
 * A date input can hold `2026-03` mid-edit. That is not a day, and a condition
 * built from it is the half-typed `>` case in another costume.
 */
typeFilter(untoggled, 'modifiedon', '2026-03');

check(
    'a half-typed day filters nothing rather than filtering wrongly',
    untoggled.props().pageIds.length === 12
        && untoggled.handle.dataset.filtering.getFilter() === undefined,
    `${untoggled.props().pageIds.length} rows`,
);

/*
 * The box is a date input with the toggle beside it, and the toggle shows the
 * operator in force — From here, because this control toggled it above.
 * Asserted on markup because both are the component's decision.
 */
const dateMarkup = renderDeep(untoggled.driven.element);

check(
    'a date column gets a date box and a toggle that names the operator',
    dateMarkup.includes('type="date"')
        && (dateMarkup.match(/class="DataTable-filterOp"/g) || []).length === 2
        && dateMarkup.includes('>resx:DataTable_DateFrom<'),
    `${(dateMarkup.match(/class="DataTable-filterOp"/g) || []).length} toggles (one per date column); ${dateMarkup.includes('type="date"') ? 'date input present' : 'NO date input'}`,
);

/* ---------------------------------------------------------- choice filter */

/*
 * `Equal` on the integer, sent as a string — what `ConditionExpression.value`
 * is typed as, and what the server accepted alongside the number. Three
 * fixture rows hold `3`; a control that fell through to `Like '%3%'` would
 * match the same three here, so the assertion reads the operator too.
 */
const chosen = bind({ pageSize: 50 });

typeFilter(chosen, 'industrycode', '3');
const choiceExpression = chosen.handle.dataset.filtering.getFilter();

check(
    'a choice sends Equal on the integer, as a string',
    JSON.stringify(choiceExpression) === JSON.stringify({
        filterOperator: 0,
        conditions: [{ attributeName: 'industrycode', conditionOperator: 0, value: '3' }],
    })
        && chosen.props().pageIds.join(',') === 'a02,a05,a11',
    `${JSON.stringify(choiceExpression)} → ${chosen.props().pageIds.join(',')}`,
);

typeFilter(chosen, 'industrycode', 'abc');

check(
    'and anything that is not an integer sends nothing',
    chosen.props().pageIds.length === 12,
    `${chosen.props().pageIds.length} rows`,
);

/*
 * Without metadata there is no option list to build the box from, and the
 * column stays exactly what it was in 0.3.4: unfilterable, with the dash that
 * says so. `loadOptions` is the fact the component reads, so it is asserted
 * on the prop; the dash is asserted on markup.
 */
const noUtils = bind({ quirks: { utilsAbsent: true } });

check(
    'a host without utils offers no choice box and no way to ask for one',
    noUtils.props().loadOptions === null
        && (renderDeep(noUtils.driven.element).match(/class="DataTable-filterNone"/g) || []).length === 2,
    `loadOptions ${noUtils.props().loadOptions === null ? 'null' : 'present'}`,
);

/*
 * **Canvas is such a host, but it does not say so by omission.** It publishes
 * `utils` and throws `Method not implemented.` from the call — measured in a
 * real canvas app, 2026-09-21 — so `loadOptions` is offered and then refuses,
 * rather than being absent. The column ends up exactly where the absent host
 * leaves it: unfilterable, with the dash that says so.
 *
 * Asserted on the dash rather than on `loadOptions === null`, because the dash
 * is what a reader sees and the null was only ever a means to it. A control
 * that checks `typeof` and assumes the method works is the defect this
 * measurement exposed.
 */
const canvasUtils = bind({ host: 'canvas', inputs: { enableCreate: true } });

check(
    'and canvas ends in the same place, by refusing rather than by omitting',
    (renderDeep(canvasUtils.driven.element).match(/class="DataTable-filterNone"/g) || []).length === 2
        && canvasUtils.props().canCreate === false,
    `dashes ${(renderDeep(canvasUtils.driven.element).match(/class="DataTable-filterNone"/g) || []).length}`
    + `, canCreate ${canvasUtils.props().canCreate}`,
);

check(
    'and the refusal is catchable rather than fatal',
    typeof canvasUtils.props().loadOptions === 'function',
    'loadOptions offered; a synchronous throw would have killed the control',
);

/*
 * **The New button must not appear on canvas, and `typeof` cannot tell.**
 *
 * Measured with the host probe on a real canvas app, 2026-09-22: **all fifteen
 * surfaces asked about came back `present: true`**, `navigation.openForm`
 * among them. So the guard that was withholding this button — the method
 * existing — passed there, and the control drew a New that could only refuse.
 * `docs/canvas.md` had asserted since 0.4.0 that this was impossible because
 * "`navigation.openForm` is not on this host". The second half of that
 * sentence was simply wrong.
 *
 * This rig published `openForm` on canvas for the first time on the same day,
 * and this assertion failed the moment it did. What fixes it is testing an
 * *answer* — `getClientUrl` resolving to a string — rather than a method's
 * existence. That is the shape every guard in this file should now be read
 * against.
 */
check(
    'no New button on canvas, where openForm exists and refuses',
    canvasUtils.props().canCreate === false,
    `canCreate ${canvasUtils.props().canCreate}`,
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

/* ----------------------------------------------------------------- editing */

/*
 * **What this rig can and cannot say about editing, stated once.**
 *
 * Editing's interactive state — which cell is open, what the platform answered,
 * the optimistic override, the rollback — lives in React state inside
 * `DataTableControl`, because that is the only place a change can repaint the
 * table. `notifyOutputChanged()` cannot: it tells the platform an *output*
 * changed, and a React control repaints when `updateView` runs, which is the
 * platform's decision. 0.3.0 kept that state in the control class and the
 * editor never opened on a real form.
 *
 * The consequence for this file is unwelcome and worth being blunt about:
 * `renderDeep` uses `react-dom/server`, which **runs no effects and dispatches
 * no events**. So the rig cannot see an editor open, cannot see answers arrive,
 * and cannot see a cell roll back. Asserting on the first server render would
 * produce checks that pass because nothing ran — the failure mode this suite
 * has already been burned by twice.
 *
 * So what is asserted here is the boundary the control class actually owns: the
 * callbacks it hands down, and what they do to the platform. The component's
 * behaviour on top of them is verified on a real form, and SPEC.md says so.
 */

/** Let pending promises settle. Three passes covers `setValue` → `save` → notify. */
async function flush(passes = 3) {
    for (let pass = 0; pass < passes; pass += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

async function editingChecks() {
    /*
     * The default has to cost nothing: no editor, and no fetch per cell asking
     * whether there could be one. A control nobody configured should not be
     * talking to the platform about permissions.
     */
    check(
        'editing off asks the platform nothing and offers no editor',
        !renderDeep(view.driven.element).includes('DataTable-editTrigger')
            && !view.calls().some((call) => call.startsWith('record.')),
        'no triggers, no record calls',
    );

    const on = bind({ inputs: { enableEditing: true } });
    const rowId = on.props().pageIds[0];

    /*
     * **The platform's answer, not the column's type.** `accountnumber` is
     * `SingleLine.Text`, so every type-based rule would offer an editor on it.
     * On the measured subgrid `statuscode` came back `false` while two columns
     * on the same row came back `true` — editability is per column *and* per
     * record, and it is invisible on `Column`.
     */
    const editableAnswer = await on.props().canEdit(rowId, 'name');
    const restricted = bind({
        inputs: { enableEditing: true },
        quirks: { readOnlyColumns: ['accountnumber'] },
    });
    const refusedAnswer = await restricted.props().canEdit(rowId, 'accountnumber');

    check(
        'the control asks the platform per cell, and passes the answer through',
        editableAnswer === true && refusedAnswer === false,
        `name=${editableAnswer}, accountnumber=${refusedAnswer} under readOnlyColumns`,
    );

    /*
     * A host without the write methods offers nothing to ask with. `null` rather
     * than a promise resolving false, so the component can tell "cannot write"
     * apart from "may not write this cell" — they are the same on screen and
     * different in every other way.
     */
    const noWrite = bind({ inputs: { enableEditing: true }, quirks: { editableAbsent: true } });

    check(
        'a host with no write methods offers no way to ask',
        noWrite.props().canEdit(rowId, 'name') === null
            && !renderDeep(noWrite.driven.element).includes('DataTable-editTrigger'),
        'canEdit is null, no editors rendered',
    );

    /* ---- committing */

    await on.props().onCommitEdit(rowId, 'name', 'Rewritten');
    await flush();

    const writeCalls = on.calls().filter((call) => call.startsWith('record.'));

    check(
        'a commit sets the value then saves it, in that order',
        writeCalls[0] === 'record.setValue("name")' && writeCalls[1] === `record.save("${rowId}")`,
        writeCalls.slice(0, 2).join(' ') || 'nothing written',
    );

    /*
     * **`setValue` returns `undefined`, and this is the assertion that says a
     * control must not chain off it.**
     *
     * `record.setValue(...).then(() => record.save())` is `.then` on nothing: a
     * `TypeError` thrown *synchronously*, outside every `.catch` in the chain.
     * On a real subgrid that left the cell reading "Saving…" for ever, with no
     * rollback and no message, through three releases — because this rig
     * returned a promise from `setValue` and the whole chain behaved.
     *
     * Microsoft's reference page types it `Promise`, which is where the mistake
     * came from. The rig now returns what the platform returns, so the old
     * shape cannot compile a passing suite.
     */
    check(
        'the commit survives setValue returning nothing at all',
        typeof on.props().dataset.records[rowId].setValue('name', 'probe') === 'undefined'
            && writeCalls.includes(`record.save("${rowId}")`),
        'setValue returns undefined and save still ran',
    );

    /*
     * `refresh()` is part of the write rather than a courtesy: `save()` commits
     * and nothing re-reads until something asks. Without it the optimistic
     * override is the only thing holding the new value on screen, so the cell
     * shows the edit until the next platform-driven fetch and then appears to
     * lose it.
     */
    const afterSave = on.calls().slice(on.calls().indexOf(`record.save("${rowId}")`));

    check(
        'and asks the platform to re-read once the save lands',
        afterSave.includes('refresh'),
        afterSave.slice(0, 3).join(' ') || 'nothing after the save',
    );

    /*
     * **A resolved `save()` is Dataverse accepting the write, not the dataset
     * having re-read it.** The rig keeps those apart — committed values wait for
     * `reread()` — because a rig that applied them inside `save()` let a control
     * that retired its optimistic override on resolve pass every assertion,
     * while on a form the cell visibly jumps back and then forward.
     */
    check(
        'the record is still stale until the host re-reads',
        on.props().dataset.records[rowId].getValue('name') !== 'Rewritten',
        JSON.stringify(on.props().dataset.records[rowId].getValue('name')),
    );

    on.handle.reread();
    on.settle();

    check(
        'and carries the written value once it does',
        on.props().dataset.records[rowId].getValue('name') === 'Rewritten',
        JSON.stringify(on.props().dataset.records[rowId].getValue('name')),
    );

    check(
        'a saved row is reported, so a form can react to it',
        on.outputs().editedRecordId === rowId,
        on.outputs().editedRecordId || 'nothing reported',
    );

    /*
     * The refusal has to reach the component, or there is nothing to roll back
     * from. Passed on rather than swallowed: a rejected platform call is typed
     * `unknown` and is not reliably an `Error`, and `UciError: Invalid snapshot
     * with id undefined` — what a wrong column name produces — names neither the
     * column nor the record.
     */
    const refused = bind({ inputs: { enableEditing: true }, quirks: { saveRejects: true } });
    const refusedId = refused.props().pageIds[0];
    const before = refused.props().dataset.records[refusedId].getValue('name');
    let rejection = null;

    await refused.props().onCommitEdit(refusedId, 'name', 'Doomed').catch((error) => {
        rejection = error;
    });

    check(
        'a refused write rejects rather than resolving quietly',
        rejection !== null
            && refused.props().dataset.records[refusedId].getValue('name') === before,
        rejection ? String(rejection.message) : 'resolved — nothing to roll back from',
    );

    check(
        'and reports no edited row, because nothing was edited',
        refused.outputs().editedRecordId === '',
        JSON.stringify(refused.outputs().editedRecordId),
    );
}

/* ----------------------------------------------------------- choice cells */

/*
 * What the rig can say about the choice editor is the same boundary as for
 * editing above: the callbacks the class hands down, and what they do to the
 * platform. The `<select>` itself mounts in an effect and is photographed by
 * `dev/preview.html`.
 */
async function choiceChecks() {
    const on = bind({ inputs: { enableEditing: true } });
    const rowId = on.props().pageIds[0];

    check(
        'a host with utils hands the component a way to ask for options',
        typeof on.props().loadOptions === 'function',
        `loadOptions is ${typeof on.props().loadOptions}`,
    );

    /*
     * **The map shape, which is what the platform actually carries.**
     * `industrycode`'s fixture node has its options only at `OptionSet`, as a
     * map keyed by value with no `Options` array — the measured shape, and
     * not the one `pcf-kanban-board` documented. A parser written to the
     * documentation reads `[]` here and the column silently loses its editor.
     */
    const industry = await on.props().loadOptions('industrycode');

    check(
        'options are read from the value-keyed map the platform carries',
        JSON.stringify(industry) === JSON.stringify([
            { value: 1, label: 'Retail' },
            { value: 2, label: 'Manufacturing' },
            { value: 3, label: 'Services' },
            { value: 4, label: 'Technology' },
        ]),
        JSON.stringify(industry),
    );

    /*
     * And the descriptor shape, in the maker's order. `statecode`'s node has
     * them only at `attributeDescriptor.OptionSet`; a parser that read the
     * map alone gets nothing here.
     */
    const state = await on.props().loadOptions('statecode');

    check(
        'and from the descriptor array where that is the one present',
        JSON.stringify(state) === JSON.stringify([
            { value: 0, label: 'Active' },
            { value: 1, label: 'Inactive' },
        ]),
        JSON.stringify(state),
    );

    /*
     * One fetch per column, narrowed to that column. `getEntityMetadata` with
     * no attribute list is the whole table's metadata — a call a control with
     * two choice columns must not make twice, and must not make wide.
     */
    await on.props().loadOptions('industrycode');

    const metadataCalls = on.calls().filter((call) => call.startsWith('utils.getEntityMetadata'));

    check(
        'metadata is asked for once per column, and only for that column',
        metadataCalls.length === 2
            && metadataCalls[0] === 'utils.getEntityMetadata({"entity":"account","attributes":["industrycode"]})',
        metadataCalls.join(' ') || 'never asked',
    );

    /*
     * **A synchronous refusal has to arrive as a rejection.** Canvas throws
     * `getEntityMetadata: Method not implemented.` from the call itself, not as
     * a rejected promise — so there is nothing to `.catch`, the throw escapes
     * `updateView`, and the studio replaces the table with *Error loading
     * control*. Measured in a real canvas app, 2026-09-21.
     *
     * **This has to call `loadOptions`, not merely render.** `renderDeep` is
     * `react-dom/server` and runs no effects, so a rendering assertion never
     * invokes it and passes against the broken control — which is exactly what
     * happened on the first attempt at this assertion.
     */
    const canvasOptions = bind({ host: 'canvas', inputs: { enableFiltering: true } });
    let canvasThrew = false;
    let canvasRejected = false;

    try {
        await canvasOptions.props().loadOptions('industrycode').catch(() => {
            canvasRejected = true;
        });
    } catch {
        canvasThrew = true;
    }

    check('a host that refuses metadata synchronously rejects instead of throwing',
        !canvasThrew && canvasRejected,
        canvasThrew ? 'threw out of the call — this kills the control' : 'rejected, catchable');

    /*
     * A refused metadata call reaches the component as a rejection, which it
     * records as "no options" — the read-only fallback. The class must not
     * swallow it into an empty list, or the component cannot tell "no
     * options" from "could not ask", and neither can the console.
     */
    const refused = bind({ inputs: { enableEditing: true }, quirks: { metadataRejects: true } });
    let metadataError = null;

    await refused.props().loadOptions('industrycode').catch((error) => {
        metadataError = error;
    });

    check(
        'a refused metadata call rejects rather than resolving empty',
        metadataError !== null,
        metadataError ? String(metadataError.message) : 'resolved',
    );

    /*
     * The write is the integer. `getValue` reads a choice back as a string —
     * the rig does what the platform does — so the stored value is read
     * through the rig's own back door to prove the control did not write
     * `"4"`. Measured on the form: `setValue(column, 4)` persisted as 4.
     */
    await on.props().onCommitEdit(rowId, 'industrycode', 4);
    await flush();
    on.handle.reread();
    on.settle();

    check(
        'a choice commit writes the integer and the re-read carries it',
        on.handle.stored(rowId, 'industrycode') === 4
            && on.props().dataset.records[rowId].getValue('industrycode') === '4'
            && on.props().dataset.records[rowId].getFormattedValue('industrycode') === 'Technology',
        `stored ${JSON.stringify(on.handle.stored(rowId, 'industrycode'))}, getValue ${JSON.stringify(on.props().dataset.records[rowId].getValue('industrycode'))}`,
    );

    await on.props().onCommitEdit(rowId, 'industrycode', null);
    await flush();
    on.handle.reread();
    on.settle();

    check(
        'and null clears it',
        on.handle.stored(rowId, 'industrycode') === null
            && on.props().dataset.records[rowId].getFormattedValue('industrycode') === '',
        `stored ${JSON.stringify(on.handle.stored(rowId, 'industrycode'))}`,
    );

    /*
     * `statecode` is `OptionSet` too, and the platform refuses it. The type
     * string cannot tell the two apart; `isEditable` can, and the rig's
     * default `readOnlyColumns` models the measured answer.
     */
    const stateAnswer = await on.props().canEdit(rowId, 'statecode');
    const industryAnswer = await on.props().canEdit(rowId, 'industrycode');

    check(
        'state stays read-only on the platform\'s answer, not on its type',
        stateAnswer === false && industryAnswer === true,
        `statecode=${stateAnswer}, industrycode=${industryAnswer}`,
    );
}

/* ------------------------------------------------------------ quick create */

async function createChecks() {
    /*
     * Off by default, and off on a host without `openForm` whatever the maker
     * set — the method, not the bag: `navigation` is present on canvas and
     * `openForm` is not.
     */
    check(
        'the New button is off until a maker turns it on',
        view.props().canCreate === false && !markup.includes('DataTable-create'),
        `canCreate ${view.props().canCreate}`,
    );

    const noForm = bind({ inputs: { enableCreate: true }, quirks: { openFormAbsent: true } });

    check(
        'and off on a host without openForm, however it is configured',
        noForm.props().canCreate === false
            && !renderDeep(noForm.driven.element).includes('DataTable-create'),
        `canCreate ${noForm.props().canCreate}`,
    );

    /*
     * The saved case. `openForm` resolves the braced upper-case GUID the
     * platform hands back; the output carries it unbraced and lower-case like
     * the other three. `createFromEntity` is the parent from `contextInfo`,
     * and `refresh()` is what puts the row on screen.
     */
    const parent = { entityTypeName: 'account', entityId: '85f67958-7637-f111-88b5-7ced8d3b545a' };
    const saved = bind({
        inputs: { enableCreate: true },
        contextInfo: parent,
        openFormReturns: {
            savedEntityReference: [
                { id: '{436E09A8-1111-4222-8333-444444444444}', entityType: 'account', name: 'New one' },
            ],
        },
    });
    const savedMarkup = renderDeep(saved.driven.element);

    check(
        'on, the button sits first among the pager tools',
        saved.props().canCreate === true
            && savedMarkup.indexOf('DataTable-create') > savedMarkup.indexOf('DataTable-pagerTools')
            && savedMarkup.indexOf('DataTable-create') < savedMarkup.indexOf('DataTable-jump')
            && savedMarkup.includes('resx:DataTable_New'),
        `tools at ${savedMarkup.indexOf('DataTable-pagerTools')}, create at ${savedMarkup.indexOf('DataTable-create')}, jump at ${savedMarkup.indexOf('DataTable-jump')}`,
    );

    const notificationsBefore = saved.notifications();
    const refreshesBefore = saved.handle.state.refreshes;
    const createdId = await saved.props().onCreate();
    const openCall = saved.calls().find((call) => call.startsWith('navigation.openForm'));

    check(
        'New opens the quick create form seeded with the parent record',
        openCall === 'navigation.openForm({"entityName":"account","useQuickCreateForm":true,"createFromEntity":{"entityType":"account","id":"85f67958-7637-f111-88b5-7ced8d3b545a"}})',
        openCall || 'openForm never called',
    );

    check(
        'a saved row is reported unbraced and lower-case, and the view re-read',
        createdId === '436e09a8-1111-4222-8333-444444444444'
            && saved.outputs().createdRecordId === createdId
            && saved.handle.state.refreshes === refreshesBefore + 1
            && saved.notifications() === notificationsBefore + 1,
        `resolved ${JSON.stringify(createdId)}, output ${JSON.stringify(saved.outputs().createdRecordId)}, ${saved.handle.state.refreshes - refreshesBefore} refreshes, ${saved.notifications() - notificationsBefore} notifications`,
    );

    /*
     * The dismissed case — `{ savedEntityReference: null }`, measured, and the
     * rig's default because it is the branch a control forgets. Nothing to
     * refresh, nothing to report.
     */
    const dismissed = bind({ inputs: { enableCreate: true } });
    const dismissedBefore = dismissed.handle.state.refreshes;
    const dismissedId = await dismissed.props().onCreate();

    check(
        'a dismissed form resolves null, refreshes nothing and reports nothing',
        dismissedId === null
            && dismissed.outputs().createdRecordId === ''
            && dismissed.handle.state.refreshes === dismissedBefore
            && dismissed.notifications() === 0,
        `resolved ${JSON.stringify(dismissedId)}, output ${JSON.stringify(dismissed.outputs().createdRecordId)}`,
    );

    /*
     * A main grid has no parent. `createFromEntity` is left out rather than
     * sent with undefined halves, which `openForm` would take as a reference
     * to nothing.
     */
    const mainGridCall = dismissed.calls().find((call) => call.startsWith('navigation.openForm'));

    check(
        'without a parent record, createFromEntity is left out',
        mainGridCall === 'navigation.openForm({"entityName":"account","useQuickCreateForm":true})',
        mainGridCall || 'openForm never called',
    );
}

/* ----------------------------------------------------------- lookup cells */

/*
 * The one editor whose write leaves the record. What the rig can say is what
 * the control asked the platform for: which tables the dialog was offered,
 * which navigation property the bind key was spelled with, whether the
 * relationships were fetched once or per write, and what a refusal is turned
 * into. The `LookupEditor` itself mounts in the browser and is photographed.
 */
async function lookupChecks() {
    const view = fixture.withLookups();
    const withLookups = (options) => bind({
        columns: view.columns,
        records: view.records,
        inputs: { enableEditing: true },
        ...options,
    });

    /* ---- the host fact */

    const on = withLookups({});

    check(
        'a host with the dialog, metadata, the Web API and an organisation URL offers lookup editing',
        typeof on.props().pickLookup === 'function',
        `pickLookup is ${typeof on.props().pickLookup}`,
    );

    /*
     * **Four surfaces, each removable on its own.** On a real host they go
     * missing one at a time — `WebAPI` declined at install, a harness with
     * no `page`, a `utils` bag without `lookupObjects` — and a control that
     * checks one and calls all four passes on the host it was written on.
     * Canvas is all four at once.
     */
    const withheld = {
        webApiAbsent: withLookups({ quirks: { webApiAbsent: true } }),
        pageAbsent: withLookups({ quirks: { pageAbsent: true } }),
        lookupObjectsAbsent: withLookups({ quirks: { lookupObjectsAbsent: true } }),
        utilsAbsent: withLookups({ quirks: { utilsAbsent: true } }),
        canvas: withLookups({ host: 'canvas' }),
    };
    const stillOffered = Object.keys(withheld).filter(
        (name) => withheld[name].props().pickLookup !== null,
    );

    check(
        'any one of the four missing withholds it, and canvas withholds all four',
        stillOffered.length === 0,
        stillOffered.length ? `still offered under ${stillOffered.join(', ')}` : 'null under every absence',
    );

    /* ---- the dialog */

    const rowId = on.props().pageIds[0];
    const cancelled = await on.props().pickLookup('primarycontactid');
    const dialogCall = on.calls().find((call) => call.startsWith('utils.lookupObjects'));

    check(
        'a closed dialog resolves null and writes nothing',
        cancelled === null
            && dialogCall === 'utils.lookupObjects({"entityTypes":["contact"],"defaultEntityType":"contact","allowMultiSelect":false})'
            && !on.calls().some((call) => call.startsWith('webAPI.')),
        `${JSON.stringify(cancelled)}; ${dialogCall || 'dialog never opened'}`,
    );

    /*
     * The Customer column's targets live only under `attributeDescriptor` —
     * the top-level `Targets` is `undefined` on that node, measured — so a
     * dialog offered both tables is the proof the reader fell through.
     */
    await on.props().pickLookup('parentcustomerid');

    const customerDialog = on.calls().filter((call) => call.startsWith('utils.lookupObjects')).pop();

    check(
        'a Customer lookup offers both targets, read from under the descriptor',
        customerDialog === 'utils.lookupObjects({"entityTypes":["account","contact"],"defaultEntityType":"account","allowMultiSelect":false})',
        customerDialog || 'dialog never opened',
    );

    const contact = fixture.related.contact.rows[2];
    const picking = withLookups({ lookupPick: { id: contact.id, entityType: 'contact', name: contact.name } });
    const picked = await picking.props().pickLookup('primarycontactid');

    check(
        'a pick arrives braced and upper-case and is handed on unbraced and lower-case',
        JSON.stringify(picked) === JSON.stringify({ id: contact.id, entityType: 'contact', name: contact.name }),
        JSON.stringify(picked),
    );

    /* ---- the write */

    const refreshesBefore = picking.handle.state.refreshes;

    await picking.props().onCommitEdit(rowId, 'primarycontactid', picked);
    await flush();

    const update = picking.calls().find((call) => call.startsWith('webAPI.updateRecord'));
    const relationshipFetches = () => picking.calls().filter((call) => call.startsWith('fetch(')).length;

    check(
        'a lookup commit binds the navigation property to the target\'s entity set, then refreshes',
        update === `webAPI.updateRecord({"entity":"account","id":"${rowId}","data":{"primarycontactid@odata.bind":"/contacts(${contact.id})"}})`
            && picking.handle.state.refreshes === refreshesBefore + 1
            && picking.outputs().editedRecordId === rowId,
        `${update || 'updateRecord never called'}; refreshes ${picking.handle.state.refreshes - refreshesBefore}; editedRecordId ${JSON.stringify(picking.outputs().editedRecordId)}`,
    );

    /*
     * **The navigation property was read, not derived.** The relationships
     * came from one `fetch` of `EntityDefinitions`, and the key the write
     * used is the one that fetch named. On the probe table it was the
     * logical name; the rig's Customer column has two, `_account` and
     * `_contact`, which no derivation from the column name produces.
     */
    const fetched = picking.calls().find((call) => call.startsWith('fetch('));

    check(
        'the navigation property comes from one fetch of the table\'s relationships',
        relationshipFetches() === 1
            && fetched === "fetch(\"/api/data/v9.2/EntityDefinitions(LogicalName='account')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity,ReferencingEntityNavigationPropertyName\")",
        fetched || 'nothing fetched',
    );

    picking.handle.reread();
    picking.settle();

    const reread = picking.props().dataset.records[rowId].getValue('primarycontactid');

    check(
        'the re-read carries the new reference in the platform\'s own shape',
        reread && reread.etn === 'contact' && reread.id.guid === contact.id && reread.name === contact.name,
        JSON.stringify(reread),
    );

    /*
     * A Customer lookup pointing at a contact binds through `_contact`; the
     * same column pointing at an account binds through `_account`. The
     * dialog's `entityType` is what chooses, and the entity set follows it.
     */
    // Caught rather than awaited bare, so a key the rig refuses fails *this*
    // assertion with the refusal in it, instead of aborting the suite.
    const customerRefusals = [];
    const account = fixture.related.account.rows[1];

    await picking.props().onCommitEdit(rowId, 'parentcustomerid', picked)
        .catch((error) => customerRefusals.push(error.message));
    await flush();

    const customerToContact = picking.calls().filter((call) => call.startsWith('webAPI.updateRecord')).pop();

    await picking.props().onCommitEdit(rowId, 'parentcustomerid', { id: account.id, entityType: 'account', name: account.name })
        .catch((error) => customerRefusals.push(error.message));
    await flush();

    const customerToAccount = picking.calls().filter((call) => call.startsWith('webAPI.updateRecord')).pop();

    check(
        'a Customer lookup binds through the navigation property of the table picked',
        customerRefusals.length === 0
            && customerToContact === `webAPI.updateRecord({"entity":"account","id":"${rowId}","data":{"parentcustomerid_contact@odata.bind":"/contacts(${contact.id})"}})`
            && customerToAccount === `webAPI.updateRecord({"entity":"account","id":"${rowId}","data":{"parentcustomerid_account@odata.bind":"/accounts(${account.id})"}})`
            && relationshipFetches() === 1,
        customerRefusals.length
            ? `refused: ${customerRefusals.join(' / ')}`
            : `${customerToContact}\n         ${customerToAccount}; ${relationshipFetches()} fetch(es)`,
    );

    /* ---- clearing */

    picking.handle.reread();
    picking.settle();

    let clearRefusal = null;

    await picking.props().onCommitEdit(rowId, 'parentcustomerid', null)
        .catch((error) => { clearRefusal = error.message; });
    await flush();

    const cleared = picking.calls().filter((call) => call.startsWith('webAPI.updateRecord')).pop();

    check(
        'a clear binds null through the navigation property of the value being cleared',
        clearRefusal === null
            && cleared === `webAPI.updateRecord({"entity":"account","id":"${rowId}","data":{"parentcustomerid_account@odata.bind":null}})`,
        clearRefusal ? `refused: ${clearRefusal}` : (cleared || 'updateRecord never called'),
    );

    picking.handle.reread();
    picking.settle();

    const updatesBefore = picking.calls().filter((call) => call.startsWith('webAPI.updateRecord')).length;

    await picking.props().onCommitEdit(rowId, 'parentcustomerid', null);
    await flush();

    check(
        'clearing an empty cell writes nothing',
        picking.props().dataset.records[rowId].getValue('parentcustomerid') === null
            && picking.calls().filter((call) => call.startsWith('webAPI.updateRecord')).length === updatesBefore,
        `stored ${JSON.stringify(picking.props().dataset.records[rowId].getValue('parentcustomerid'))}`,
    );

    /* ---- refusals, and what the cell is told */

    /*
     * A payload fault's `message` opens with a generic line and runs into a
     * stack trace; a server fault's is one sentence with a `title` beside
     * it. The cell gets the one sentence either way, and never `raw`.
     */
    const refused = withLookups({ quirks: { webApiRejects: true } });
    let payloadFault = null;

    await refused.props().onCommitEdit(rowId, 'primarycontactid', picked).catch((error) => {
        payloadFault = error;
    });

    check(
        'a payload fault is reduced to the sentence after the last InnerException',
        payloadFault instanceof Error
            && payloadFault.message === "An undeclared property 'cll_PrimaryContact' which only has property annotations in the payload but no property value was found in the payload.",
        payloadFault ? JSON.stringify(payloadFault.message) : 'resolved',
    );

    let missing = null;

    await picking.props().onCommitEdit(rowId, 'primarycontactid', {
        id: '00000000-0000-0000-0000-000000000001',
        entityType: 'contact',
        name: 'Nobody',
    }).catch((error) => {
        missing = error;
    });

    check(
        'a server fault is shown as its own sentence',
        missing instanceof Error && missing.message === 'The requested record was not found.',
        missing ? JSON.stringify(missing.message) : 'resolved',
    );

    const unreadable = withLookups({ quirks: { relationshipsStatus: 403 } });
    let noRelationships = null;

    await unreadable.props().onCommitEdit(rowId, 'primarycontactid', picked).catch((error) => {
        noRelationships = error;
    });

    check(
        'relationships that cannot be read refuse the write rather than guessing a key',
        noRelationships instanceof Error
            && noRelationships.message === 'Relationships for account could not be read (403).'
            && !unreadable.calls().some((call) => call.startsWith('webAPI.')),
        noRelationships ? JSON.stringify(noRelationships.message) : 'resolved',
    );

    const unnamed = withLookups({ quirks: { entitySetAbsent: true } });
    let noSet = null;

    await unnamed.props().onCommitEdit(rowId, 'primarycontactid', picked).catch((error) => {
        noSet = error;
    });

    check(
        'a target with no entity set name refuses the write rather than guessing the plural',
        noSet instanceof Error
            && noSet.message === 'No entity set name for contact.'
            && !unnamed.calls().some((call) => call.startsWith('webAPI.')),
        noSet ? JSON.stringify(noSet.message) : 'resolved',
    );
}

/*
 * Grouping, through the control.
 *
 * `dev/grouping.js` asserts the decisions; these assert that the control
 * *calls* them, which is the half a pure suite cannot reach.
 *
 * **What this suite can and cannot see, stated rather than discovered.**
 * `renderDeep` is `react-dom/server`, which **runs no effects** — and
 * `dev/clock.js` installs a fake `setTimeout`, so nothing resolves by waiting
 * either. `useGroups` starts the server route in an effect, so **the server
 * route never runs here at all.** Every assertion below is therefore about the
 * **browser route**, which is computed during render — which is what a reader
 * sees while the aggregate is in flight, and on canvas, forever.
 *
 * That is not a gap to paper over. The server route's own arithmetic is
 * asserted in `dev/grouping.js` against rows measured off a real response, and
 * the two routes are asserted there to agree. What is left unproven is the
 * wiring between them, and that belongs on a form and in SPEC.md's
 * *Not verified*.
 */
function groupingChecks() {
    // Ungrouped is the default and the shape every existing installation
    // upgrades into: nothing about 0.6.0 may change it.
    const plainMarkup = renderDeep(bind({}).driven.element);

    check(
        'with groupBy unset the table is unchanged — no group rows at all',
        plainMarkup.indexOf('DataTable-groupRow') === -1,
        'no group rows',
    );

    /*
     * A page size big enough for the whole fixture, so the browser route sees
     * every record. At the default five it sees page one — three industries
     * out of four and no blank group — which is correct behaviour and a
     * confusing thing to assert against.
     */
    const markup = renderDeep(bind({ pageSize: 25, inputs: { groupBy: 'industrycode' } }).driven.element);
    const headers = (markup.match(/DataTable-groupRow/g) || []).length;

    /*
     * **The precondition, and it is not ceremony.** Every assertion below is
     * an `indexOf` over this markup, and `indexOf` on an empty string answers
     * -1 for everything — so a control that threw in `updateView` and rendered
     * nothing passes "contains no group rows", "does not overclaim its scope"
     * and every other negative. That happened on 2026-09-20 and four false
     * passes hid one real defect. Assert the table is there first.
     */
    check('the grouped table rendered at all', markup.indexOf('<table') > -1, markup.length + ' chars');

    // Four industries in the fixture and one record with none, so the blank
    // group is real rather than contrived.
    check('a grouped table draws one header per group, blank included', headers === 5, 'headers ' + headers);
    check('the blank group is named rather than left empty',
        markup.indexOf('resx:DataTable_GroupBlank') > -1, 'blank named');
    check('a choice group is labelled, not numbered', markup.indexOf('Manufacturing') > -1, 'labels present');
    check('the caption names its scope',
        markup.indexOf('resx:DataTable_CaptionLoaded') > -1, 'browser-route caption');
    check('and never overclaims it on the browser route',
        markup.indexOf('resx:DataTable_CaptionAll') === -1, 'scope honest');

    /*
     * **The row pager is gone while the groups are collapsed.**
     *
     * Found on the first form walkthrough, 2026-09-20: it read "1–4 of 21"
     * and "page 1 of 6" underneath five group headers — counting rows that
     * were not on screen, in a vocabulary the table was not in. The caption
     * answers the same question in the right one.
     */
    /*
     * **The group caption does not wear the table caption's class.**
     *
     * `.DataTable-caption` has been the `<table><caption>`'s class since
     * 0.2.0, and it is *visually hidden* — one pixel square with
     * `clip: rect(0 0 0 0)`, so a screen reader reads the table's name and
     * nobody sees it. Reusing the name put the group caption inside that clip:
     * right text, right place in the DOM, invisible on the form. Found by a
     * DOM query after two screenshots, because every assertion here is over
     * markup and markup was not what was wrong.
     */
    check('the group caption does not reuse the hidden table-caption class',
        markup.indexOf('DataTable-groupCaption') > -1
        && markup.indexOf('DataTable-pager DataTable-caption') === -1,
        'group caption class');

    /*
     * The open group's rows sit under its own header. Not assertable here —
     * expanding needs a click and `renderToStaticMarkup` dispatches no events
     * — so what is checked is the collapsed invariant either side of it: a
     * grouped table with nothing open renders headers and no rows at all.
     */
    check('a collapsed grouped table renders no member rows',
        markup.indexOf('DataTable-groupRow') > -1 && markup.indexOf('<tr class="DataTable-row') === -1,
        'headers only');

    check('the row pager is replaced by the caption, not shown beside it',
        markup.indexOf('DataTable-pagerStatus') > -1
        && markup.indexOf('resx:DataTable_Page') === -1
        && (markup.match(/class="DataTable-pager[ "]/g) || []).length === 1,
        'pagers: ' + (markup.match(/class="DataTable-pager[ "]/g) || []).length);

    /*
     * A column the view does not have renders an **ungrouped** table and names
     * the columns that do exist — never a half-grouped one. To the console,
     * because only the maker can act on it.
     */
    const warnings = [];
    const realWarn = console.warn;

    console.warn = (message) => warnings.push(String(message));

    /*
      **Two aggregates over one column both render.**

      This shipped broken through 0.6.0's whole development and was found by
      taking a screenshot, not by an assertion: the group row placed one cell
      per column and picked the measure for it with `findIndex`, so
      `sum:revenue, avg:revenue` drew the sum and dropped the average without a
      word. A configured aggregate disappearing silently is the same failure
      class as the export's missing page — the output looks perfectly correct.

      `aliasPlan` has supported M measures over one column since the first
      commit; only the rendering could not.
    */
    const twoMeasures = renderDeep(bind({
        pageSize: 25,
        inputs: { groupBy: 'industrycode', aggregates: 'sum:revenue, avg:revenue' },
    }).driven.element);

    check('a grouped table with two measures rendered at all',
        twoMeasures.indexOf('DataTable-groupMeasure') > -1, twoMeasures.slice(0, 120));
    check('both aggregates over one column are drawn',
        (twoMeasures.match(/DataTable-groupValue/g) || []).length >= 8,
        (twoMeasures.match(/DataTable-groupValue/g) || []).length + ' measure values');
    check('and each is named, since two numbers in one cell are otherwise ambiguous',
        twoMeasures.indexOf('DataTable-groupAggregate') > -1
        && twoMeasures.indexOf('>sum<') > -1 && twoMeasures.indexOf('>avg<') > -1,
        'sum ' + twoMeasures.indexOf('>sum<') + ', avg ' + twoMeasures.indexOf('>avg<'));

    /* One measure keeps the bare value it always had. */
    const oneMeasure = renderDeep(bind({
        pageSize: 25,
        inputs: { groupBy: 'industrycode', aggregates: 'sum:revenue' },
    }).driven.element);

    check('a single measure is not labelled',
        oneMeasure.indexOf('DataTable-groupMeasure') > -1
        && oneMeasure.indexOf('DataTable-groupAggregate') === -1,
        oneMeasure.indexOf('DataTable-groupAggregate') === -1 ? 'bare' : 'labelled');

    const missingMarkup = renderDeep(bind({ inputs: { groupBy: 'revenu' } }).driven.element);

    console.warn = realWarn;

    check('a groupBy naming a missing column renders ungrouped',
        missingMarkup.indexOf('DataTable-groupRow') === -1 && missingMarkup.indexOf('<table') > -1,
        'ungrouped table');
    check('and names the columns that do exist, in the console',
        warnings.some((w) => w.indexOf('not a column on this view') > -1),
        warnings.join(' | ').slice(0, 140));

    const lookupMarkup = renderDeep(bind({ pageSize: 25, inputs: { groupBy: 'ownerid' } }).driven.element);

    check('a lookup groups by its name rather than its GUID',
        lookupMarkup.indexOf('Sam Vaziri') > -1 && lookupMarkup.indexOf('b3f1a0c2') === -1,
        'lookup label');

    // Canvas has no webAPI, so the browser route is all there is.
    /*
      **Measures have to survive the browser route**, which is the only route
      canvas has. `groupRecords` computed every one of them correctly and left
      `measureLabels` as the empty strings it initialised them to, so a grouped
      canvas table with `aggregates` set drew blank cells — right answers,
      invisible. It looked fine on a model-driven form only because the server
      route brings formatted values back with the FetchXML answer.

      An aggregate belongs to no record, so there is no cell for
      `getFormattedValue` to answer about; the formatter is handed in from
      `context.formatting`.
    */
    /*
      **A canvas app publishes `page.getClientUrl` and throws when it is
      called.** Reported from a real canvas app, 2026-09-21: the studio showed
      `getClientUrl: Method not implemented.` and replaced the whole table with
      "Error loading control".

      `lookupHost` runs on every `updateView` pass, so the throw escaped the
      lifecycle and took the control with it — over a probe for the lookup
      editor, a feature canvas was never offered in the first place. A method
      existing is not a promise that it works, and `typeof … === 'function'`
      tests the wrong thing.

      This rig said `page` was simply absent on canvas until the same day,
      which is why nothing caught it. `renderDeep` is what makes the assertion
      meaningful: `updateView` only builds an element, so a throw inside the
      component is invisible to a props-only read.
    */
    /*
      **A canvas app shows an unset whole number as `0`.** Seen in a real
      studio, 2026-09-21: `Page size` read `0` on a control nobody had
      configured. `applyPageSize` clamped that with `Math.max(raw, 1)` and gave
      the reader a **one-row page** — twenty rows fetched and one drawn, which
      reads as a control that cannot page.

      Zero means "the host did not say", which is what the comment beside
      `paging.pageSize` had claimed all along; the property's clamp disagreed
      with it.
    */
    // The host pages five at a time; the *property* is the thing left at zero.
    const drawnBy = (input) => {
        const view = bind({ host: 'canvas', pageSize: 5, inputs: { pageSize: input } });

        return view.props().pageIds ? view.props().pageIds.length : 0;
    };

    check('a page size of zero adopts the host rather than drawing one row',
        drawnBy(0) === 5, drawnBy(0) + ' rows drawn, host pages 5');
    check('and a negative is the same statement',
        drawnBy(-5) === 5, drawnBy(-5) + ' rows drawn, host pages 5');
    check('while a real page size still overrides the host',
        drawnBy(3) === 3, drawnBy(3) + ' rows drawn, property asked for 3');

    const refusing = bind({ host: 'canvas', pageSize: 25 });

    check('a canvas host that refuses getClientUrl still renders',
        renderDeep(refusing.driven.element).indexOf('<table') > -1,
        renderDeep(refusing.driven.element).length + ' chars');
    check('and lookup cells are simply read-only there',
        renderDeep(refusing.driven.element).indexOf('DataTable-lookupEditor') === -1,
        'no lookup editor offered');

    const canvasMeasures = renderDeep(bind({
        host: 'canvas',
        pageSize: 25,
        inputs: { groupBy: 'industrycode', aggregates: 'sum:revenue' },
    }).driven.element);

    check('a grouped canvas table rendered at all',
        canvasMeasures.indexOf('<table') > -1, canvasMeasures.length + ' chars');
    check('and its measures are visible, not merely computed',
        (canvasMeasures.match(/DataTable-groupValue/g) || []).length >= 4,
        (canvasMeasures.match(/DataTable-groupValue/g) || []).length + ' measure values');

    const canvasMarkup = renderDeep(bind({ host: 'canvas', pageSize: 25, inputs: { groupBy: 'industrycode' } }).driven.element);

    check('grouping renders on canvas too, from the loaded rows',
        (canvasMarkup.match(/DataTable-groupRow/g) || []).length > 0, 'group rows present');
}

function sortChecks() {
    console.log('');
    console.log('  --- multi-column sort');

    const order = (view) => (view.handle.dataset.sorting || [])
        .map((status) => status.name + ':' + status.sortDirection);
    const names = (view) => (view.handle.dataset.sortedRecordIds || [])
        .map((id) => view.handle.dataset.records[id].getFormattedValue('name'));

    // Off by default: every existing installation clicks a header as before.
    const single = bind({});

    single.props().onSort('name', true);
    single.settle();

    check('shift-click does nothing while the maker has not allowed it',
        order(single), ['name:0']);

    const multi = bind({ inputs: { enableMultiSort: true } });

    multi.props().onSort('name', false);
    multi.settle();
    check('a plain click still replaces the order', order(multi), ['name:0']);

    multi.props().onSort('industrycode', true);
    multi.settle();
    check('shift-click appends rather than replacing', order(multi), ['name:0', 'industrycode:0']);

    multi.props().onSort('industrycode', true);
    multi.settle();
    check('the second activation flips only that column', order(multi), ['name:0', 'industrycode:1']);

    /*
     * The third removes it. With a rank on screen there is a meaningful "not
     * sorted by this" state and no other way to reach it — a column added by
     * mistake would otherwise be stuck in the order forever. A single-column
     * sort has no such state, which is why a plain click still cycles.
     */
    multi.props().onSort('industrycode', true);
    multi.settle();
    check('the third removes it rather than cycling back', order(multi), ['name:0']);

    /*
     * **The tie case, and it is what the first measurement got wrong.**
     *
     * Sorting by a column whose every value is distinct never produces a tie,
     * so the second entry has nothing to break and the rows agree with the
     * request either way — which reads exactly like a platform honouring it.
     * `industrycode` holds four values across twelve rows, so the ties are
     * real and flipping only the *second* entry has to reverse them.
     */
    const tied = bind({ pageSize: 25, inputs: { enableMultiSort: true } });

    tied.props().onSort('industrycode', false);
    tied.settle();
    tied.props().onSort('name', true);
    tied.settle();
    const ascending = names(tied);

    tied.props().onSort('name', true);
    tied.settle();
    const descending = names(tied);

    check('a second entry reorders within the first column\'s ties',
        JSON.stringify(ascending) !== JSON.stringify(descending),
        ascending.slice(0, 3).join(' | ') + '   vs   ' + descending.slice(0, 3).join(' | '));

    check('and the first column still leads', order(tied), ['industrycode:0', 'name:1']);

    /*
     * The host that collapses the array to its first entry — what the
     * false-passing measurement appeared to show, and what a rank indicator
     * would be wrong about. Nothing in the catalogue has met one; the switch
     * exists so the control's behaviour there is a decision rather than a
     * discovery.
     */
    const collapsed = bind({
        pageSize: 25,
        inputs: { enableMultiSort: true },
        quirks: { sortingHonoursMultiple: false },
    });

    collapsed.props().onSort('industrycode', false);
    collapsed.settle();
    collapsed.props().onSort('name', true);
    collapsed.settle();
    const before = names(collapsed);

    collapsed.props().onSort('name', true);
    collapsed.settle();

    check('on a host that collapses the array the rows do not move',
        JSON.stringify(names(collapsed)), JSON.stringify(before));

    check('a single sort shows no rank at all, exactly as 0.5.0 did',
        renderDeep(bind({ inputs: { enableMultiSort: true } }).driven.element)
            .indexOf('DataTable-sortRank') === -1,
        'no rank');

    /*
     * The rank appears only once there is more than one column in the order,
     * so a single sort is byte-identical to 0.5.0 and every existing
     * installation looks unchanged.
     *
     * `tied` still holds two; the assertion above left `multi` holding one,
     * which is why this uses the other view — the first version of this check
     * read `multi`, found no rank, and passed while claiming the opposite.
     */
    check('two sorted columns each show their rank',
        (renderDeep(tied.driven.element).match(/DataTable-sortRank/g) || []).length, 2);
}

function exportChecks() {
    console.log('');
    console.log('  --- the full-view export');

    /*
     * **The only feature that re-enters `updateView` deliberately**, so
     * driving the rig repeatedly *is* the test: each `settle()` is one pass —
     * harvest what landed, ask for the next page.
     *
     * Twelve records at a page size of five is three pages, which is enough to
     * make the loop run. Note `check(label, ok, detail)` here, not
     * `(label, actual, expected)` as in `dev/grouping.js` — the first version
     * of this section used the other signature and every assertion reported a
     * truthy row count as a pass.
     */
    // The CSV line ending, named rather than written inline so no editing
    // pass can turn the escape into a real newline.
    const NEWLINE = String.fromCharCode(13) + String.fromCharCode(10);

    const written = (view) => view.handle.state.files;

    /*
     * **One pass, not ten.**  drives until the control stops asking
     * for anything, up to ten passes — which runs the whole export inside a
     * single call and makes the loop unobservable. Driving one pass at a time
     * is what actually exercises the re-entry this feature is built on.
     */
    const step = (view) => host.drive(view.instance, view.handle, 1).element.props;

    /*
     * One pass, rendered. `updateView` only *builds* an element, so whether the
     * control drew a table or the export panel is invisible to a props-only
     * read — the choice is made inside the component. See `renderDeep`.
     */
    const stepMarkup = (view) => renderDeep(host.drive(view.instance, view.handle, 1).element);
    const rowsIn = (file) => file.content.split('\r\n').filter(Boolean).length - 1;

    // The default scope is 0.5.0's behaviour: no loop, no page movement.
    const loaded = bind({ pageSize: 5 });

    loaded.props().onExport();

    check('the default scope writes at once, without looping',
        written(loaded).length === 1, written(loaded).length + ' file(s)');
    check('and covers only the loaded page',
        written(loaded).length === 1 && rowsIn(written(loaded)[0]) === 5,
        written(loaded).length ? rowsIn(written(loaded)[0]) + ' rows' : 'none');

    /* The whole view. */
    // maxPageSize 5 clamps the export's 250 to five, so twelve records are
    // three pages and the loop actually loops. See quirks.maxPageSize.
    const whole = bind({ pageSize: 5, quirks: { maxPageSize: 5 }, inputs: { exportScope: 'view' } });

    whole.props().onExport();

    /*
     * `step` has side effects — it is one `updateView` — so each observation
     * is captured once. The first version called it twice inside a single
     * assertion and the export had finished before the loop below started.
     */
    const afterStart = step(whole);

    check('starting shows progress rather than a frozen button',
        Boolean(afterStart.exporting), JSON.stringify(afterStart.exporting));
    check('and writes nothing until it has everything',
        written(whole).length === 0, written(whole).length + ' file(s)');

    let passes = 0;
    let live = afterStart;

    while (live.exporting && passes < 20) {
        live = step(whole);
        passes += 1;
    }

    check('the loop terminates', passes > 0 && passes < 20, passes + ' passes');
    check('and writes exactly one file at the end',
        written(whole).length === 1, written(whole).length + ' file(s)');

    /*
     * Every row in the view, not the page. The fixture holds twelve and the
     * page size was five, so a `loaded` export would have had five.
     */
    check('the file holds every row in the view',
        written(whole).length === 1 && rowsIn(written(whole)[0]) === 12,
        written(whole).length ? rowsIn(written(whole)[0]) + ' rows' : 'none');

    /*
     * **The 250 rows this feature lost on a real form**, 2026-09-21: a
     * full-view export over 1,222 records wrote 972. The gap was one whole
     * page out of the middle — records ~251 to ~500 — with the tail intact and
     * no duplicates, which rules out the ceiling, the cancel and `hasNextPage`.
     *
     * `beginExport` makes two calls back to back, `setPageSize(250)` then
     * `loadExactPage(1)`, and the platform answers each with an `updateView`.
     * The first arrives **before the fetch has landed**, carrying whatever was
     * already on screen. The old machine harvested it, counted it as page one
     * and asked for page two; the real page one then arrived and was counted as
     * page two, so page two was never requested.
     *
     * The rig could not produce that pass: every mutator updated the rows in
     * the same tick as the call. `asyncFetch` and `pageSizeNotifies` together
     * are that platform, and this is the assertion that would have caught it.
     */
    // The reader's page size is deliberately *not* the export's. With them
    // equal the stale page happens to be the export page that gets skipped, so
    // nothing is lost and the defect hides. Two against five is the real shape:
    // the rows on screen sit inside export page one, and export page two is
    // then stepped over and covered by nothing.
    const racy = bind({
        pageSize: 2,
        quirks: { maxPageSize: 5, asyncFetch: true, pageSizeNotifies: true },
        inputs: { exportScope: 'view' },
    });

    // Start from page 2, as the reader did: the stale pass then carries rows
    // that are genuinely new to the export, which is what makes "it brought
    // nothing new" insufficient on its own.
    racy.props().onNextPage();
    host.drive(racy.instance, racy.handle, 10);

    racy.props().onExport();

    let racyPasses = 0;
    let racyLive = step(racy);

    while (racyLive.exporting && racyPasses < 40) {
        racyLive = step(racy);
        racyPasses += 1;
    }

    check('an export racing its own page-size change still terminates',
        racyPasses > 0 && racyPasses < 40, racyPasses + ' passes');

    /*
      **The Stop button has to stay where a reader can reach it.** Reported
      from a real form, 2026-09-21: *"I cannot stop it mid-run, because the
      table grows vertically too fast and the button scrolls out of sight."*
      The export raises the page size to 250 and the pager — which is where the
      progress and Stop live — renders *below* the table, so the export pushes
      its own cancel off the screen.

      A running export therefore draws no table at all.
    */
    const midExport = bind({
        pageSize: 2,
        quirks: { maxPageSize: 5, asyncFetch: true, pageSizeNotifies: true },
        inputs: { exportScope: 'view' },
    });

    midExport.props().onExport();

    const midMarkup = stepMarkup(midExport);

    /*
     * The precondition. Every assertion below is an `indexOf`, and `indexOf` on
     * empty markup returns -1 for everything — so "no table" would pass against
     * a control that rendered nothing at all. This repo has shipped that
     * mistake once already.
     */
    check('the export panel rendered at all',
        midMarkup.length > 0, midMarkup.length + ' chars');
    check('a running export shows its progress panel',
        midMarkup.indexOf('DataTable-exporting') > -1, midMarkup.slice(0, 160));
    check('and draws no table to push the Stop button off screen',
        midMarkup.indexOf('<table') === -1, midMarkup.slice(0, 160));
    check('with Stop inside that panel',
        midMarkup.indexOf('DataTable-exportCancel') > -1, midMarkup.slice(0, 160));

    const racyFile = written(racy);

    check('and writes one file',
        racyFile.length === 1, racyFile.length + ' file(s)');

    /*
     * The assertion that matters: **every row, exactly once**. A skipped page
     * is the worst shape this feature can fail in, because the file looks
     * perfectly well-formed — which is precisely why the defect reached a user.
     */
    check('holding every row in the view, none skipped',
        racyFile.length === 1 && rowsIn(racyFile[0]) === 12,
        racyFile.length ? rowsIn(racyFile[0]) + ' of 12 rows' : 'none');

    if (racyFile.length === 1) {
        const bodies = racyFile[0].content.split(NEWLINE).filter(Boolean).slice(1);

        check('and no row twice',
            new Set(bodies).size === bodies.length,
            bodies.length + ' rows, ' + new Set(bodies).size + ' distinct');
    }

    check('and the reader gets their page size back',
        whole.handle.dataset.paging.pageSize === 5,
        'pageSize ' + whole.handle.dataset.paging.pageSize);

    /*
      **Stop has to stop now, not on the next page.** Reported from a real
      subgrid, 2026-09-21: an export stalled and clicking Stop did nothing at
      all — because the only thing that acted on `cancelled` was the arrival of
      a page that was never coming.

      There is nothing to wait for. The file is written from what has been
      collected the moment Stop is pressed; the page still in flight arrives to
      an idle machine and `shouldHarvest` ignores it.
    */
    const stopNow = bind({ pageSize: 5, quirks: { maxPageSize: 5 }, inputs: { exportScope: 'view' } });

    stopNow.props().onExport();
    step(stopNow);
    step(stopNow);

    const filesBeforeStop = written(stopNow).length;

    stopNow.props().onCancelExport();

    check('Stop writes the file without waiting for another pass',
        filesBeforeStop === 0 && written(stopNow).length === 1,
        filesBeforeStop + ' file(s) before, ' + written(stopNow).length + ' after');

    /*
      **The host that ignores `loadExactPage` past the first jump.**

      Measured on a real subgrid, 2026-09-21, from the export's own tracing:
      `loadExactPage(1)` was honoured and returned 250 rows; `loadExactPage(2)`
      was not — same `firstId`, `firstPageNumber` still 1, `loading: false`. The
      export sat waiting for a page nobody was fetching.

      That one fact explains both of this feature's failures. The stall is the
      obvious one; the earlier short file (972 of 1,222, holding pages one,
      three, four and five) is the same thing before the guards existed, with
      ignored requests harvested as though they had answered.

      So the walk steps with `loadNextPage` rather than jumping, and only the
      first page and the restore use `loadExactPage`. The export has to come out
      whole on this host, because this host is the one it failed on.
    */
    const stubborn = bind({
        pageSize: 5,
        quirks: { maxPageSize: 5, pagingBreaksAfterResize: true },
        inputs: { exportScope: 'view' },
    });

    stubborn.props().onExport();

    let stubbornPasses = 0;
    let stubbornLive = step(stubborn);

    while (stubbornLive.exporting && stubbornPasses < 40) {
        stubbornLive = step(stubborn);
        stubbornPasses += 1;
    }

    check('an export completes on a host where a resize breaks paging',
        stubbornPasses > 0 && stubbornPasses < 40, stubbornPasses + ' passes');
    check('and writes one file',
        written(stubborn).length === 1, written(stubborn).length + ' file(s)');
    check('holding every row in the view',
        written(stubborn).length === 1 && rowsIn(written(stubborn)[0]) === 12,
        written(stubborn).length ? rowsIn(written(stubborn)[0]) + ' of 12 rows' : 'none');

    if (written(stubborn).length === 1) {
        const stubbornRows = written(stubborn)[0].content.split(NEWLINE).filter(Boolean).slice(1);

        check('with no row twice, despite the accumulating steps',
            new Set(stubbornRows).size === stubbornRows.length,
            stubbornRows.length + ' rows, ' + new Set(stubbornRows).size + ' distinct');
    }

    /* The walk is a step, not a jump — which is the whole fix. */
    const walkCalls = stubborn.calls()
        .filter((call) => call.indexOf('loadNextPage') === 0 || call.indexOf('loadExactPage') === 0);

    /*
     * **The invariant, stated directly: the export never jumps to a page other
     * than one.** That is the whole fix — a jump to page N is the call this
     * host ignores, and the call whose silent refusal produced both a stall and
     * a short file. Page one is a jump because it has to be, and because it was
     * measured honoured; everything after it steps.
     *
     * Asserted as "no `loadExactPage(n)` for n > 1" rather than as an exact
     * sequence, because the page-one jump may legitimately be repeated — the
     * page-size gate re-asks once where the host clamps the export's request —
     * and re-asking for page one is idempotent and harmless.
     */
    check('and never resized the view to do it',
        stubborn.calls().every((call) => call.indexOf('setPageSize') !== 0),
        stubborn.calls().filter((call) => call.indexOf('setPageSize') === 0).join(' ') || 'no setPageSize');
    check('paging the view the way the reader does',
        walkCalls.length >= 2, walkCalls.join(' '));

    /*
      **A pass that is not the answer must not reset the watchdog.**

      Observed on a real subgrid, 2026-09-21: an export reached page two and
      then sat there indefinitely — the reader had to press Stop to get a file.
      `driveExport` cleared the watchdog at the top of every pass and re-armed
      it on every `repeat`, so any host that kept re-rendering while a page
      failed to land pushed the thirty seconds out forever and starved the only
      failure signal this feature has.

      The watchdog belongs to the request. Here the clock is advanced past it in
      two steps with an unanswered pass in between: if that pass re-armed it,
      nothing would have been written yet.
    */
    const starve = bind({
        pageSize: 5,
        quirks: { maxPageSize: 5, asyncFetch: true, pageSizeNotifies: true },
        inputs: { exportScope: 'view' },
    });

    starve.props().onExport();
    step(starve);

    const starveMid = step(starve);

    check('the starvation case starts from a running export with rows',
        Boolean(starveMid.exporting) && starveMid.exporting.rows > 0,
        JSON.stringify(starveMid.exporting));

    time.advance(20000);

    // A pass with no fetch behind it: the dataset is unchanged, so the export
    // sees rows it already holds. This is the pass that used to re-arm.
    starve.instance.updateView(starve.handle.nextContext());

    time.advance(20000);

    check('an unanswered pass does not push the watchdog back',
        written(starve).length === 1,
        written(starve).length + ' file(s) 40s after the request');

    /*
      **A stalled export ends itself.** The watchdog is the only failure signal
      a page that never lands can produce — `loadExactPage` returns `void` and
      offers nothing to reject. Until 0.6.6 it set `phase: 'failed'` and called
      `notifyOutputChanged()`, which announces *outputs* changed and gives the
      platform no reason to call `updateView`: the failure was recorded, nothing
      rendered it, and no file was written. The control simply sat there.

      Time is advanced here with no pass in between, which is exactly what a
      page that never lands looks like.
    */
    const stalled = bind({ pageSize: 5, quirks: { maxPageSize: 5 }, inputs: { exportScope: 'view' } });

    stalled.props().onExport();
    step(stalled);

    // `props()` reports the last *settled* render, which `step` does not
    // update — so the live state has to come from the pass itself.
    const midStall = step(stalled);

    check('a stalled export is still running before the watchdog',
        Boolean(midStall.exporting), JSON.stringify(midStall.exporting));

    time.advance(60000);

    check('and writes what had been collected rather than hanging',
        written(stalled).length === 1,
        written(stalled).length + ' file(s)');

    /*
     * Putting the reader's page size back is itself a fetch, so the platform
     * calls `updateView` again — which is what carries the note onto the
     * screen. That is the whole reason the watchdog has to *finish* the export
     * instead of recording that it failed.
     */
    const afterStall = stalled.settle().element.props;

    check('the watchdog ends a stalled export rather than leaving it hanging',
        !afterStall.exporting, JSON.stringify(afterStall.exporting));
    check('and says which page never came',
        typeof afterStall.exportNote === 'string' && afterStall.exportNote !== '',
        JSON.stringify(afterStall.exportNote));

    /*
     * Cancelling cannot abort the fetch in flight — the platform offers no way
     * — so the page already asked for still arrives and is discarded. The
     * button reports *stopping* rather than *stopped* for exactly that reason.
     */
    const stopped = bind({ pageSize: 5, quirks: { maxPageSize: 5 }, inputs: { exportScope: 'view' } });

    stopped.props().onExport();
    // Two passes, not one: the first is spent on the page-size change's own
    // pass, so a cancel after a single pass would have nothing to write.
    step(stopped);
    step(stopped);
    stopped.props().onCancelExport();

    const afterCancel = step(stopped);



    let stopPasses = 0;
    let stopping = afterCancel;

    while (stopping.exporting && stopPasses < 20) {
        stopping = step(stopped);
        stopPasses += 1;
    }

    /*
     * **The "stopping" label is not observable here, and that is honest
     * rather than a gap in the suite.** Cancelling cannot abort the fetch in
     * flight, so it takes effect on the next pass — and in this rig a fetch
     * resolves synchronously, so there is no pass between the cancel and the
     * finish for the label to render in. On a form, where a page takes
     * seconds, it is the whole point: a control that said it had stopped and
     * then sat there for another round trip would read as broken.
     *
     * What *is* observable is that the cancel is obeyed: the export ends on
     * the next page rather than walking the rest of the view.
     */
    check('cancelling is obeyed on the very next pass',
        stopPasses === 0,
        stopPasses + ' further pass(es) — afterCancel was the pass that obeyed it');

    check('and the file holds what had been collected, not the whole view',
        written(stopped).length === 1 && rowsIn(written(stopped)[0]) < 12,
        written(stopped).length ? rowsIn(written(stopped)[0]) + ' rows' : 'none');

    check('a cancelled export finishes rather than hanging',
        !stopped.props().exporting, stopPasses + ' passes');
    check('and still puts the page size back',
        stopped.handle.dataset.paging.pageSize === 5,
        'pageSize ' + stopped.handle.dataset.paging.pageSize);

    /*
     * The host with no `loadExactPage`. This loop only ever steps forward by
     * one, which is exactly what `loadNextPage(true)` does — and on the
     * accumulating platform it hands back the whole range, which the dedupe
     * absorbs.
     */
    const stepping = bind({
        pageSize: 5,
        inputs: { exportScope: 'view' },
        quirks: { hasLoadExactPage: false, maxPageSize: 5 },
    });

    stepping.props().onExport();

    let stepPasses = 0;
    let stepping_live = step(stepping);

    while (stepping_live.exporting && stepPasses < 20) {
        stepping_live = step(stepping);
        stepPasses += 1;
    }

    check('it completes on a host with no loadExactPage',
        written(stepping).length === 1, written(stepping).length + ' file(s)');
    check('and the accumulating pages are not double-counted',
        written(stepping).length === 1 && rowsIn(written(stepping)[0]) === 12,
        written(stepping).length ? rowsIn(written(stepping)[0]) + ' rows' : 'none');
}

sortChecks();
exportChecks();

groupingChecks();

editingChecks()
    .then(choiceChecks)
    .then(lookupChecks)
    .then(createChecks)
    .then(report, (error) => {
        check('the asynchronous assertions ran at all', false, String((error && error.stack) || error));
        report();
    });


/* -------------------------------------------------------------- formatting */

/*
 * **A check on the rig rather than on the control, and it has earned its
 * place.**
 *
 * `makeDisplay` parsed a date-only string with `new Date(string)`, which is
 * UTC midnight by specification, and then rendered it in the local zone. West
 * of Greenwich every date came out a day early — and because this rig is what
 * captures media/, it put the wrong day in four published screenshots: a
 * fixture reading 2026-01-14 photographed as 13 Jan 2026.
 *
 * Nothing else here would have caught it. Every other assertion reads props,
 * and the control's props were right the whole time; only the rig's rendering
 * of them was wrong. So this asserts on the text a screenshot would contain.
 *
 * Zone-dependent, and worth saying rather than leaving to be discovered: put
 * the UTC parse back and this fails here, on a machine at UTC-6, with
 * "Jan 13, 2026". On a runner that is itself UTC nothing shifts and it passes
 * either way — so it guards the workstation that captures the media, which is
 * where the bug actually happened, and not the build.
 */
const formattedDate = host
    .createHost(fixture, { format: true, inputs: INPUTS })
    .context.parameters.records.records.a01.getFormattedValue('modifiedon');

check(
    'a date-only cell shows the day the fixture holds, not the day before',
    formattedDate === 'Jan 14, 2026',
    `${formattedDate} for a fixture value of 2026-01-14`,
);

const formattedMoney = host
    .createHost(fixture, { format: true, inputs: INPUTS })
    .context.parameters.records.records.a01.getFormattedValue('revenue');

check(
    'and a currency cell shows what a grid would print',
    formattedMoney === '$4,200,000.00',
    formattedMoney,
);

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
