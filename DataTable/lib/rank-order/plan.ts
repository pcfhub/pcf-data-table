/*
 * _template/variants/lib/rank-order — the writes
 *
 * SHARED. Copied into a control as <Control>/lib/rank-order/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Written 2026-10-30 for pcf-data-table 0.9.0, whose SPEC.md carries the
 * probe it rests on (R1–R6): a whole-number column sorted ascending puts rows
 * with no value first, and the platform re-sorts nothing until a re-read.
 */

/**
 * Rows in your own order, held in a whole-number column the maker names: what
 * to write when a row moves, and when the rows with no value are numbered.
 *
 * Pure — no DOM, no dataset — so a suite loads it through `dev/modules.js`.
 * The control reads the rows on show, asks here, writes what comes back
 * (`setValue` + `save` on each), and re-reads. Nothing here knows how the
 * write goes or what the column is called.
 *
 * The rules, each from a measurement or a decision recorded with it:
 *
 * - **Values stay readable.** A move reuses the values the rows it passes
 *   already have, so 10, 20, 30 stay 10, 20, 30 in the new order. Only when
 *   that cannot work (two rows sharing a value, say) are rows numbered, and
 *   then with consecutive whole numbers, never fractions or gaps invented.
 * - **A move never reaches another page.** The values written stay inside
 *   the range the page already spans, except at the open ends of the list
 *   (the first page may go down to 1; the last may go up), so a row moved on
 *   page 2 cannot land among page 3's.
 * - **A row with no value sorts first** (R1), so one unnumbered row anywhere
 *   above a numbered one breaks the order. A page holding any is refused for
 *   moves (`unnumbered`); `planNumbering` numbers them first, across the
 *   whole list, because numbering only this page's would drop them below the
 *   unnumbered rows on the next.
 */

export interface OrderRow {
    /** The control's own key for the row: what a write names. */
    id: string;
    /** The order column's value, `null` when the row has none. */
    value: number | null;
}

export interface OrderWrite {
    id: string;
    from: number | null;
    to: number;
}

/** Where the rows on show sit in the whole list. */
export interface PageEdges {
    /** Nothing comes before them: values may go down to `FLOOR`. */
    first: boolean;
    /** Nothing comes after them: values may go up to `CEILING`. */
    last: boolean;
}

/** The lowest value a move or a numbering writes unless the rows already go lower. */
export const FLOOR = 1;
/** A whole-number column's own ceiling. */
export const CEILING = 2147483647;

export type MovePlan =
    | { ok: true; order: string[]; writes: OrderWrite[] }
    | { ok: false; reason: 'noMove' | 'unnumbered' | 'noRoom' };

export interface NumberingPlan {
    /** `unnumbered`: only the rows with no value were given one. `all`: 1, 2, 3 … down the list. */
    mode: 'unnumbered' | 'all';
    writes: OrderWrite[];
}

/** How many rows have no value, and how many share one with the row above. */
export function orderState(rows: readonly OrderRow[]): { unnumbered: number; ties: number } {
    let unnumbered = 0;
    let ties = 0;
    rows.forEach((row, index) => {
        if (row.value === null) {
            unnumbered += 1;
        } else if (index > 0 && rows[index - 1].value === row.value) {
            ties += 1;
        }
    });
    return { unnumbered, ties };
}

/** `rows` with the row at `from` taken out and put back at `to`. */
export function moved<T>(rows: readonly T[], from: number, to: number): T[] {
    const out = rows.slice();
    const [row] = out.splice(from, 1);
    out.splice(to, 0, row);
    return out;
}

const increasing = (values: readonly number[]): boolean => values.every((value, i) => i === 0 || values[i - 1] < value);

/**
 * What to write so that the row at `from` sits at `to` once the page is
 * re-read in the order column's order. `rows` is the page as drawn, which is
 * that order: ascending, rows with no value first.
 */
export function planMove(rows: readonly OrderRow[], from: number, to: number, edges: PageEdges): MovePlan {
    const n = rows.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) {
        return { ok: false, reason: 'noMove' };
    }
    if (rows.some((row) => row.value === null)) {
        return { ok: false, reason: 'unnumbered' };
    }

    const values = rows.map((row) => row.value as number);
    const order = moved(rows, from, to);
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);

    /*
     * First choice: the rows between `from` and `to` swap values among
     * themselves. The same values in the same ascending order, handed out in
     * the new row order — so every value already on the page stays, and only
     * the rows that moved are written. It needs the span to be strictly
     * increasing and strictly apart from its neighbours: a tie at either edge
     * would leave the new order to however the server breaks ties.
     */
    const span = values.slice(lo, hi + 1);
    const apartAbove = lo === 0 || values[lo - 1] < values[lo];
    const apartBelow = hi === n - 1 || values[hi] < values[hi + 1];

    if (increasing(span) && apartAbove && apartBelow) {
        return { ok: true, order: order.map((row) => row.id), writes: writesFor(order, lo, span) };
    }

    /*
     * Otherwise number a window of the new order with consecutive values,
     * starting one above the row just above it, and grow the window a row at
     * a time until the values fit under the row just below it. The window
     * starts as the moved span and grows toward whichever side leaves more
     * room, so the fewest rows are written.
     */
    const pageMin = Math.min(...values);
    const pageMax = Math.max(...values);
    const lowest = edges.first ? Math.min(FLOOR, pageMin) : pageMin;
    const highest = edges.last ? CEILING : pageMax;
    const above = (a: number): number => (a > 0 ? (order[a - 1].value as number) : lowest - 1);
    const below = (b: number): number => (b < n - 1 ? (order[b + 1].value as number) : highest + 1);
    const room = (a: number, b: number): number => below(b) - above(a) - 1 - (b - a + 1);

    let a = lo;
    let b = hi;
    while (room(a, b) < 0) {
        const up = a > 0 ? room(a - 1, b) : -Infinity;
        const down = b < n - 1 ? room(a, b + 1) : -Infinity;
        if (up === -Infinity && down === -Infinity) {
            return { ok: false, reason: 'noRoom' };
        }
        if (down >= up) {
            b += 1;
        } else {
            a -= 1;
        }
    }

    const start = above(a) + 1;
    const fresh = order.slice(a, b + 1).map((_, i) => start + i);
    return { ok: true, order: order.map((row) => row.id), writes: writesFor(order, a, fresh) };
}

function writesFor(order: readonly OrderRow[], start: number, values: readonly number[]): OrderWrite[] {
    const writes: OrderWrite[] = [];
    values.forEach((value, i) => {
        const row = order[start + i];
        if (row.value !== value) {
            writes.push({ id: row.id, from: row.value, to: value });
        }
    });
    return writes;
}

/**
 * Give every row with no value one, keeping the list in the order it is
 * drawn. `rows` is the **whole** list in that order — rows with no value
 * first — because they all sort above every numbered row, wherever the page
 * break falls.
 *
 * The unnumbered rows take the values just below the first numbered one,
 * which writes only them. When that would go under `FLOOR` (the first
 * numbered row is already 1, say), or `mode` asks for it, the list is
 * numbered 1, 2, 3 … instead, which writes every row whose value changes.
 *
 * `whole` says `rows` is the entire list. When it is not — a first page with
 * more pages after it — renumbering the list is impossible from here, so the
 * unnumbered rows go under `FLOOR` instead: 0, -1, … keep them in place
 * without touching a row on another page.
 */
export function planNumbering(
    rows: readonly OrderRow[],
    mode: 'unnumbered' | 'all' = 'unnumbered',
    whole = true,
): NumberingPlan {
    const all = (): NumberingPlan => ({ mode: 'all', writes: writesFor(rows, 0, rows.map((_, i) => i + 1)) });
    if (mode === 'all') {
        return all();
    }

    const k = rows.findIndex((row) => row.value !== null);
    const unnumbered = k === -1 ? rows.length : k;
    // A row with no value after a numbered one is not where the platform put
    // it; whatever produced that order, numbering from the top is the answer.
    if (rows.slice(unnumbered).some((row) => row.value === null)) {
        return all();
    }
    if (unnumbered === 0) {
        return { mode: 'unnumbered', writes: [] };
    }

    const first = k === -1 ? FLOOR + unnumbered : (rows[k].value as number);
    const start = first - unnumbered;
    if (start < FLOOR && whole) {
        return all();
    }
    return {
        mode: 'unnumbered',
        writes: writesFor(rows, 0, rows.slice(0, unnumbered).map((_, i) => start + i)),
    };
}
