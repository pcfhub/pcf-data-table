/*
 * The column-width decisions, asserted directly.
 *
 *     npm run widths
 *
 * `layout/widths.ts` through `dev/modules.js` — no bundle, no React, no DOM.
 * What it covers is the arithmetic: that an unresized table is laid out in
 * pixels exactly as the browser lays out its percentages, that a resized column
 * draws at its width and moves nothing else, where a pinned column sits, and
 * that storage failing in any of its ways reads as "no widths".
 *
 * **The fixture widths in the first section were measured, not derived.**
 * 0.6.20 in `dev/preview.html?fixture=demo`, 2026-09-27: a 1,368px scroll box
 * drew the eight columns at 260.39, 143.2, 195.3, 143.2, 169.25, 182.27, 104.14
 * and 130.25 — `share × (1368 − 40)` — and an 800px box at the 840px minimum
 * drew them at `share × 800`. If the pixel layout disagrees with those, the
 * first drag on an upgraded form moves every column rather than one.
 *
 * What passing here does NOT mean: that the component hands `sizeColumns` the
 * width the box really has, that a drag reaches the handle on a real form, or
 * that `localStorage` answers there. The first is `npm run smoke` and the
 * preview; the other two are SPEC.md's *Not verified*.
 */

'use strict';

const { load } = require('./modules.js');

const widths = load('layout/widths');

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);

    if (a === e) {
        passed += 1;
        console.log('  ok    ' + label);
    } else {
        failed += 1;
        console.log('  FAIL  ' + label + '\n          got      ' + a + '\n          expected ' + e);
    }
}

function section(title) {
    console.log('\n' + title);
}

/* ------------------------------------------------------------- the fixtures */

/** The demo fixture's factors — 19.6078% is 200 of 1,020, and so on. */
const FACTORS = [200, 110, 150, 110, 130, 140, 80, 100];
const COLUMNS = FACTORS.map((factor, index) => ({ name: 'c' + index, visualSizeFactor: factor }));
const LOOSE = COLUMNS.map(() => null);

const sum = (list) => list.reduce((total, value) => total + value, 0);
const drawn = (sizing) => sizing.columns.map((column) => column.width);

/* ---------------------------------------------------------------- unresized */

section('unresized, the pixels are the percentages the browser drew');

{
    const wide = widths.sizeColumns(COLUMNS, LOOSE, {}, true, false, 1368);
    const measured = [260.39, 143.2, 195.3, 143.2, 169.25, 182.27, 104.14, 130.25];

    check('at 1,368px every column is within a pixel of what 0.6.20 drew',
        drawn(wide).every((width, index) => Math.abs(width - measured[index]) < 1), true);
    check('and the table fills the box exactly, select column included',
        wide.table, 1368);

    const narrow = widths.sizeColumns(COLUMNS, LOOSE, {}, true, false, 800);
    const minimum = [156.86, 86.27, 117.64, 86.27, 101.95, 109.8, 62.73, 78.48];

    check('at 800px the budget wins and the columns divide 800 of it',
        drawn(narrow).every((width, index) => Math.abs(width - minimum[index]) < 1), true);
    check('so the table is the 840px minimum, and scrolls',
        narrow.table, 840);

    check('no select column, no 40px',
        widths.sizeColumns(COLUMNS, LOOSE, {}, false, false, 1368).table, 1368);

    check('a host that reported no width gets the budget, not zero',
        widths.sizeColumns(COLUMNS, LOOSE, {}, false, false, -1).table, 800);

    const canvas = COLUMNS.map((column) => ({ name: column.name, visualSizeFactor: 0 }));

    check('canvas reports no factors, so the columns share equally — as the browser shares them',
        drawn(widths.sizeColumns(canvas.slice(0, 4), [null, null, null, null], {}, false, false, 1000)),
        [250, 250, 250, 250]);
}

/* ------------------------------------------------------------------ resized */

section('a resized column draws at its width, and nothing else moves');

{
    const before = widths.sizeColumns(COLUMNS, LOOSE, {}, true, false, 1368);
    const wider = widths.sizeColumns(COLUMNS, LOOSE, { c1: 300 }, true, false, 1368);

    check('the column is exactly the width dragged to', wider.columns[1].width, 300);
    check('every other column is where it was',
        drawn(wider).filter((_, index) => index !== 1), drawn(before).filter((_, index) => index !== 1));
    check('and the table grows by the difference, so the box scrolls',
        wider.table, 1368 + 300 - before.columns[1].width);

    const narrower = widths.sizeColumns(COLUMNS, LOOSE, { c0: 100 }, true, false, 1368);

    /*
     * The regression this section exists for. 0.7.0's first build let a
     * narrowed table end short of its box; on a form the box is shrink-to-fit,
     * so it shrank to the table, the room shrank with it, and every column
     * followed — then widening ran the same loop upward until React gave up.
     * A table that is never narrower than the room it was sized in cannot
     * start that loop.
     */
    check('narrowed, the table still fills the box — never narrower than the room it was sized in',
        narrower.table, 1368);
    check('the last column takes the slack',
        narrower.columns[7].width, before.columns[7].width + before.columns[0].width - 100);
    check('and every column between keeps its width, so the dragged edge stays under the pointer',
        narrower.columns.slice(1, 7).map((column) => column.width), drawn(before).slice(1, 7));

    const lastNarrowed = widths.sizeColumns(COLUMNS, LOOSE, { c7: 80 }, true, false, 1368);

    check('the last column itself cannot be narrowed away from the edge: it is the edge',
        [lastNarrowed.columns[7].width, lastNarrowed.table], [before.columns[7].width, 1368]);

    check('a host that reported no width is not filled — there is nothing to fill',
        widths.sizeColumns(COLUMNS, LOOSE, { c0: 100 }, true, false, 0).table,
        800 - widths.sizeColumns(COLUMNS, LOOSE, {}, true, false, 0).columns[0].width + 100 + 40);

    const endPins = ['start', null, null, null, null, null, 'end', 'end'];
    const pinnedBefore = widths.sizeColumns(COLUMNS, endPins, {}, false, false, 1368);
    const pinnedNarrowed = widths.sizeColumns(COLUMNS, endPins, { c1: 64 }, false, false, 1368);

    check('beside columns pinned at the end, the slack goes to the last loose one, not a pinned one',
        [pinnedNarrowed.table, pinnedNarrowed.columns[5].width, pinnedNarrowed.columns[6].width, pinnedNarrowed.columns[7].width],
        [1368, pinnedBefore.columns[5].width + pinnedBefore.columns[1].width - 64, 80, 100]);

    check('a stored width for a column the view no longer has is ignored',
        drawn(widths.sizeColumns(COLUMNS, LOOSE, { gone: 500 }, true, false, 1368)), drawn(before));
}

section('the limits');

{
    check('never narrower than the minimum', widths.clampWidth(10), widths.MIN_WIDTH);
    check('never wider than the maximum', widths.clampWidth(5000), widths.MAX_WIDTH);
    check('whole pixels', widths.clampWidth(123.6), 124);
    check('and not a number is the minimum rather than NaN', widths.clampWidth(NaN), widths.MIN_WIDTH);
    check('an override out of range is clamped when drawn',
        widths.sizeColumns(COLUMNS, LOOSE, { c2: 9999 }, false, false, 1368).columns[2].width, widths.MAX_WIDTH);

    check('an arrow key is 16px', widths.nudge(200, 1, false), 216);
    check('Shift+arrow is 64px', widths.nudge(200, -1, true), 136);
    check('and neither goes past the minimum', widths.nudge(70, -1, false), widths.MIN_WIDTH);
}

/* ------------------------------------------------------------------- pinned */

section('pinned columns, in pixels');

{
    const pins = ['start', null, null, null, null, null, null, 'end'];
    const pinned = widths.sizeColumns(COLUMNS, pins, {}, true, true, 1368);

    check('a pinned column takes its factor as pixels', [pinned.columns[0].width, pinned.columns[7].width], [200, 100]);
    check('the start run begins after the select column', pinned.columns[0].offset, 40);
    check('the end run from the end', pinned.columns[7].offset, 0);
    check('each run carries one seam', pinned.columns.map((column) => column.edge),
        [true, false, false, false, false, false, false, true]);

    /*
     * The bug this layout replaces: the preview drew all six at 171.33px,
     * because a browser ignores `calc(% - px)` on a `<col>`.
     */
    const loose = drawn(pinned).slice(1, 7);

    // 1,368 less 200 + 100 pinned and the 40px select column, by 720 of factor.
    const shares = [110, 150, 110, 130, 140, 80].map((factor) => (1028 * factor) / 720);

    check('the loose columns divide what is left in the view\'s proportions, not equally',
        loose.every((width, index) => Math.abs(width - shares[index]) < 1), true);
    check('and fill it exactly', pinned.table, 1368);

    const dragged = widths.sizeColumns(COLUMNS, pins, { c0: 300 }, true, true, 1368);

    check('a resized pinned column moves the offsets after it',
        [dragged.columns[0].width, dragged.columns[0].offset], [300, 40]);
    check('but not the loose columns — they were sized before anything was dragged',
        drawn(dragged).slice(1, 7), loose);

    const eaten = widths.sizeColumns(COLUMNS, pins, { c0: 800 }, true, true, 500);

    check('a pinned column cannot be dragged into eating the view: one budget column is always left',
        eaten.columns[0].width, 500 - 100 - 40 - 100);

    const two = widths.sizeColumns(COLUMNS, ['start', 'start', null, null, null, null, null, null], {}, false, false, 1368);

    check('a run of two stacks its offsets', [two.columns[0].offset, two.columns[1].offset], [0, 200]);
    check('and only the last carries the seam', [two.columns[0].edge, two.columns[1].edge], [false, true]);
}

/* ------------------------------------------------------------------ storage */

section('where the widths live');

{
    check('by table and view',
        widths.storageKey('account', '{00000000-0000-0000-00AA-000010001001}', COLUMNS),
        'pcfhub.datatable.widths:account:00000000-0000-0000-00aa-000010001001');
    check('and by the column set where there is no view — canvas',
        widths.storageKey('account', '', COLUMNS.slice(0, 2)),
        'pcfhub.datatable.widths:account:cols:c0,c1');

    const store = (value) => () => ({
        getItem: () => value,
        setItem: () => undefined,
        removeItem: () => undefined,
    });

    check('what was stored comes back, for the columns still here',
        widths.readOverrides(store('{"c1":260,"gone":90}'), 'k', COLUMNS), { c1: 260 });
    check('clamped on the way in', widths.readOverrides(store('{"c1":5}'), 'k', COLUMNS), { c1: widths.MIN_WIDTH });
    check('nothing stored is no widths', widths.readOverrides(store(null), 'k', COLUMNS), {});
    check('somebody else\'s JSON is no widths', widths.readOverrides(store('[1,2]'), 'k', COLUMNS), {});
    check('not JSON at all is no widths', widths.readOverrides(store('{oops'), 'k', COLUMNS), {});
    check('a string where a number belongs is dropped', widths.readOverrides(store('{"c1":"260"}'), 'k', COLUMNS), {});
    check('blocked site data throws on the access itself — no widths, no error',
        widths.readOverrides(() => { throw new Error('SecurityError'); }, 'k', COLUMNS), {});
    check('and a host with no storage at all', widths.readOverrides(() => undefined, 'k', COLUMNS), {});

    const calls = [];
    const recording = () => ({
        getItem: () => null,
        setItem: (key, value) => calls.push(['set', key, value]),
        removeItem: (key) => calls.push(['remove', key]),
    });

    check('a write stores JSON', widths.writeOverrides(recording, 'k', { c1: 260 }), true);
    check('no widths removes the key rather than storing {}', widths.writeOverrides(recording, 'k', {}), true);
    check('in that order', calls, [['set', 'k', '{"c1":260}'], ['remove', 'k']]);

    const full = () => ({
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError'); },
        removeItem: () => undefined,
    });

    check('a full quota is false, not a throw — the drag still worked', widths.writeOverrides(full, 'k', { c1: 260 }), false);
}

/* ------------------------------------------------------------------ report */

console.log('');

if (failed > 0) {
    console.log('  ' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
}

console.log('  ' + passed + ' passed — the width arithmetic only; the control drawing it is npm run smoke and the preview');
