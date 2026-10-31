/*
 * Rows in your own order: the writes a move needs, numbering, and the
 * keyboard — `lib/rank-order` (the template's) asserted directly.
 *
 *     npm run order
 *
 * No bundle, no React, no DOM. Every plan is checked the way the platform
 * would check it: the writes applied, the page re-read in the order column's
 * order (rows with no value first, R1), and the result compared with the order
 * the user asked for. A plan that writes values in the right order but lets a
 * tie decide a position fails here, because a tie is the server's choice.
 *
 * What passing here does NOT mean: that the control writes what the plan says,
 * holds the order until the re-read lands, or rolls a refusal back — that is
 * `npm run smoke` against the rig — nor that the platform does what SPEC.md
 * 0.9.0 measured on the day it was measured.
 */

'use strict';

const { load } = require('./load.js');

const plan = load('lib/rank-order/plan');
const lift = load('lib/rank-order/lift');

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

/* -------------------------------------------------------------- the helpers */

/** Rows named a, b, c … with these values. */
const page = (values) => values.map((value, i) => ({ id: String.fromCharCode(97 + i), value }));

/** The writes applied, then the server's sort: nulls first, ascending, ties kept as they were. */
function reread(rows, writes) {
    const next = new Map(rows.map((row) => [row.id, row.value]));
    writes.forEach((write) => next.set(write.id, write.to));
    const keyed = rows.map((row, index) => ({ id: row.id, value: next.get(row.id), index }));
    keyed.sort((x, y) => {
        if (x.value === null || y.value === null) {
            return x.value === null && y.value === null ? x.index - y.index : x.value === null ? -1 : 1;
        }
        return x.value - y.value || x.index - y.index;
    });
    return keyed;
}

/**
 * The plan's order survives a re-read, and no row it wrote shares a value with
 * a neighbour — that tie would be the server's to break. Two untouched rows
 * may still tie, as they did before the move: the plan does not rely on them.
 */
function survives(rows, result) {
    const after = reread(rows, result.writes);
    const written = new Set(result.writes.map((write) => write.id));
    const ids = after.map((row) => row.id).join('');
    const apart = after.every((row, i) => i === 0
        || (!written.has(row.id) && !written.has(after[i - 1].id))
        || after[i - 1].value < row.value);
    return ids === result.order.join('') && apart;
}

/** Inside what the page may use: down to FLOOR (or lower, if already lower) only on the first page, up to CEILING only on the last. */
function inside(rows, result, edges) {
    const values = rows.map((row) => row.value);
    const lowest = edges.first ? Math.min(plan.FLOOR, ...values) : Math.min(...values);
    const highest = edges.last ? plan.CEILING : Math.max(...values);
    return result.writes.every((write) => write.to >= lowest && write.to <= highest && Number.isInteger(write.to));
}

const MIDDLE = { first: false, last: false };
const ONLY = { first: true, last: true };

/* -------------------------------------------------------------------- moves */

section('A move reuses the values the rows already have');
{
    const rows = page([10, 20, 30, 40]);
    const result = plan.planMove(rows, 3, 0, MIDDLE);
    check('the last row to the top: d a b c', result.order, ['d', 'a', 'b', 'c']);
    check('the four values stay 10, 20, 30, 40', result.writes.map((w) => `${w.id}${w.to}`), ['d10', 'a20', 'b30', 'c40']);
    check('and it survives a re-read', survives(rows, result), true);
}
{
    const rows = page([1, 2, 3, 4, 5]);
    const result = plan.planMove(rows, 1, 3, MIDDLE);
    check('only the rows it passes are written — a and e untouched', result.writes.map((w) => w.id), ['c', 'd', 'b']);
    check('survives', survives(rows, result), true);
}
{
    const rows = page([1, 2, 3, 4, 5]);
    const result = plan.planMove(rows, 2, 3, MIDDLE);
    check('one place down is two writes', result.writes.length, 2);
}

section('A tie the move relies on is numbered away, with whole numbers');
{
    const rows = page([1, 2, 2, 3, 4]);
    const result = plan.planMove(rows, 4, 1, ONLY);
    check('ok', result.ok, true);
    check('survives a re-read — no tie left to the server', survives(rows, result), true);
    check('whole numbers inside the page', inside(rows, result, ONLY), true);
}
{
    // The tie is below the span, at its edge: a permutation would hand the
    // moved row a value equal to the row under it.
    const rows = page([1, 2, 3, 3, 5]);
    const result = plan.planMove(rows, 0, 2, MIDDLE);
    check('a tie at the edge of the span is not left to the server', survives(rows, result), true);
    check('and stays inside 1 … 5 on a middle page', inside(rows, result, MIDDLE), true);
}
{
    const rows = page([8, 8]);
    const result = plan.planMove(rows, 1, 0, { first: false, last: true });
    check('the last page may go up: b keeps 8, a takes 9 — one write', result.writes.map((w) => `${w.id}${w.to}`), ['a9']);
}
{
    const rows = page([3, 3, 5]);
    const result = plan.planMove(rows, 2, 0, { first: true, last: false });
    check('the first page may go down to 1 — b already holds 3, so it is not written', result.writes.map((w) => `${w.id}${w.to}`), ['c1', 'a2']);
    check('survives', survives(rows, result), true);
}
{
    const rows = page([-3, -2, -1]);
    const result = plan.planMove(rows, 2, 0, ONLY);
    check('values already below 1 are kept, not lifted to 1', result.writes.map((w) => w.to), [-3, -2, -1]);
}

section('What a move refuses');
check('no move: the same place', plan.planMove(page([1, 2]), 1, 1, ONLY), { ok: false, reason: 'noMove' });
check('no move: off the page', plan.planMove(page([1, 2]), 0, 5, ONLY), { ok: false, reason: 'noMove' });
check('a page holding a row with no value', plan.planMove(page([null, 1, 2]), 2, 1, ONLY), { ok: false, reason: 'unnumbered' });
{
    // The probe's page 2: 5, 5, 6 … 13 between pages 1 and 3. Ten rows need
    // ten values and the page spans nine, so swapping the two 5s would have
    // to reach a neighbouring page.
    const rows = page([5, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    check('no room on a middle page whose values are all taken', plan.planMove(rows, 1, 0, MIDDLE), { ok: false, reason: 'noRoom' });
    const fine = plan.planMove(rows, 5, 2, MIDDLE);
    check('… while a move that misses the tie still works there', [fine.ok, survives(rows, fine)], [true, true]);
}

section('3,000 random pages: every plan survives a re-read and stays inside the page');
{
    // A seeded generator, so a failure here reproduces.
    let seed = 20261030;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let bad = 0;
    let noRoomWrong = 0;
    let refused = 0;
    for (let trial = 0; trial < 3000; trial++) {
        const n = 2 + Math.floor(random() * 9);
        const values = [];
        let value = Math.floor(random() * 6) - 2;
        for (let i = 0; i < n; i++) {
            value += Math.floor(random() * 3); // 0 makes a tie
            values.push(value);
        }
        const rows = page(values);
        const edges = { first: random() < 0.4, last: random() < 0.4 };
        const from = Math.floor(random() * n);
        let to = Math.floor(random() * n);
        if (to === from) {
            to = (from + 1) % n;
        }
        const result = plan.planMove(rows, from, to, edges);
        if (result.ok) {
            if (!survives(rows, result) || !inside(rows, result, edges)) {
                bad += 1;
            }
        } else {
            refused += 1;
            // Refused only when even the whole page cannot be numbered inside its limits.
            const lowest = edges.first ? Math.min(plan.FLOOR, ...values) : Math.min(...values);
            const highest = edges.last ? plan.CEILING : Math.max(...values);
            if (result.reason !== 'noRoom' || highest - lowest + 1 >= n) {
                noRoomWrong += 1;
            }
        }
    }
    check('no plan that a re-read would undo', bad, 0);
    check('no refusal while the page had room', noRoomWrong, 0);
    check('and some were refused, so the refusal was exercised', refused > 0, true);
}

/* ---------------------------------------------------------------- numbering */

section('Numbering the rows with no value');
{
    const result = plan.planNumbering(page([null, null, 10, 20]));
    check('they take the values just below the first numbered row — only they are written', [result.mode, result.writes.map((w) => `${w.id}${w.to}`)], ['unnumbered', ['a8', 'b9']]);
}
{
    const result = plan.planNumbering(page([null, null, null]));
    check('a column nobody has numbered: 1, 2, 3', [result.mode, result.writes.map((w) => w.to)], ['unnumbered', [1, 2, 3]]);
}
{
    const result = plan.planNumbering(page([null, null, 1, 2, 3]));
    check('no room under 1: the whole list is numbered 1 … 5 instead', [result.mode, result.writes.map((w) => `${w.id}${w.to}`)], ['all', ['a1', 'b2', 'c3', 'd4', 'e5']]);
}
{
    const result = plan.planNumbering(page([null, 2, 3]));
    check('exactly enough room: one write', result.writes.map((w) => `${w.id}${w.to}`), ['a1']);
}
{
    const result = plan.planNumbering(page([null, null, 1, 2, 3]), 'unnumbered', false);
    check('no room under 1 and more pages after: 0 and -1, nothing else written', [result.mode, result.writes.map((w) => `${w.id}${w.to}`)], ['unnumbered', ['a-1', 'b0']]);
}
check('nothing to number writes nothing', plan.planNumbering(page([1, 2, 3])).writes, []);
check('a row with no value under a numbered one: number from the top', plan.planNumbering(page([1, null, 2])).mode, 'all');
check('asked for all, the rows already in place are not written', plan.planNumbering(page([1, 5, 3]), 'all').writes.map((w) => `${w.id}${w.to}`), ['b2']);

section('The state of a page');
check('unnumbered and ties counted', plan.orderState(page([null, null, 1, 1, 2, 2])), { unnumbered: 2, ties: 2 });
check('a clean page', plan.orderState(page([1, 2, 3])), { unnumbered: 0, ties: 0 });

/* ------------------------------------------------------------------ the keys */

section('Lift, move, drop');
{
    const resting = lift.RESTING;
    const lifted = lift.liftKey(resting, { key: ' ' }, 'c', 2, 5);
    check('Space on a resting handle lifts it, where it is', [lifted.event, lifted.handled, lifted.state], ['lift', true, { lifted: true, id: 'c', from: 2, at: 2 }]);
    check('Enter lifts too', lift.liftKey(resting, { key: 'Enter' }, 'c', 2, 5).event, 'lift');
    check('an arrow on a resting handle is the page\'s', lift.liftKey(resting, { key: 'ArrowDown' }, 'c', 2, 5).handled, false);

    const down = lift.liftKey(lifted.state, { key: 'ArrowDown' }, 'c', 2, 5);
    check('Down moves one place', [down.event, down.state.at], ['move', 3]);
    const end = lift.liftKey(down.state, { key: 'End' }, 'c', 3, 5);
    check('End goes to the last place', end.state.at, 4);
    const past = lift.liftKey(end.state, { key: 'ArrowDown' }, 'c', 4, 5);
    check('past the last place is an edge: taken, announced, nothing moves', [past.event, past.handled, past.state.at], ['edge', true, 4]);
    const home = lift.liftKey(past.state, { key: 'Home' }, 'c', 4, 5);
    check('Home goes to the first', home.state.at, 0);
    check('Up at the top is an edge', lift.liftKey(home.state, { key: 'ArrowUp' }, 'c', 0, 5).event, 'edge');

    const drop = lift.liftKey(home.state, { key: ' ' }, 'c', 0, 5);
    check('Space drops somewhere else: a drop, and the handle rests', [drop.event, drop.state], ['drop', { lifted: false }]);
    check('Space where it was lifted is a cancel — nothing to write', lift.liftKey(lifted.state, { key: ' ' }, 'c', 2, 5).event, 'cancel');
    check('Escape cancels', lift.liftKey(down.state, { key: 'Escape' }, 'c', 3, 5).event, 'cancel');
    const tab = lift.liftKey(down.state, { key: 'Tab' }, 'c', 3, 5);
    check('Tab cancels and lets the focus go', [tab.event, tab.handled, tab.state], ['cancel', false, { lifted: false }]);
    check('Ctrl+Down is the host\'s, lifted or not', lift.liftKey(down.state, { key: 'ArrowDown', ctrl: true }, 'c', 3, 5).handled, false);
    const stray = lift.liftKey(down.state, { key: 'a' }, 'c', 3, 5);
    check('a stray key while lifted is swallowed and changes nothing', [stray.handled, stray.event, stray.state.at], [true, undefined, 3]);
}

/* ------------------------------------------------------------------ report */

console.log('');

if (failed > 0) {
    console.log('  ' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
}

console.log('  ' + passed + ' passed — the plan and the keys only; the control applying them is npm run smoke');
