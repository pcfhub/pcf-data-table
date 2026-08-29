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
const fixture = require('./fixture.js');

const BUNDLE = path.join(root, 'out', 'controls', 'DataTable', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/DataTable. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

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
const INPUTS = { selectionMode: 'multiple', enableSorting: true, openOnRowClick: true };

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
 * A control that mutates in `updateView` without a guard never stops. Two
 * passes is the settled number — one render, then one more for the page size it
 * asked for on the first — and the limit being reached is the loop.
 */
check(
    'settles instead of refreshing forever',
    !view.driven.looping && view.driven.passes === 2,
    `${view.driven.passes} passes, calls: ${view.calls().join(' ')}`,
);

/*
 * `isHidden` and `order` are the maker's decisions in the view designer. The
 * fixture supplies its columns out of order and marks one hidden, so a control
 * that uses `dataset.columns` as handed over fails both of these.
 */
const columns = () => (view.props().columns || []).map((column) => column.displayName);

check('shows only the columns the maker left visible', columns().length === 4, columns().join(' | '));

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
