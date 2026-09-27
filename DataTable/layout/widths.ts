/**
 * Column widths in pixels: what the view gives each column, what the user
 * dragged, and where a pinned column sits.
 *
 * A decision module — nothing here touches the DOM, React or the platform, so
 * `dev/widths.js` loads it through `dev/modules.js` and asserts the arithmetic
 * rather than a rendering of it. Ported from `pcf-row-commands` 0.2.0, whose
 * `widths.ts` is the same idea for a plain-DOM table; what differs here is the
 * layout it has to reproduce, which is this control's and not that one's.
 *
 * **Why pixels at all, when 0.2.0 laid the table out in percentages.** A width
 * the user drags has to draw at the number dragged to, and a percentage of a
 * table that is itself `width: 100%` is a share of whatever the host is — the
 * same stretch `pcf-row-commands` measured at ×2.23 on a wide main grid. So
 * once anything is resized the table is laid out here, in pixels, and the
 * browser is told the answer rather than asked for one.
 *
 * **And pinned columns needed it already.** `pinPlan` gave the loose columns
 * beside a pinned one `calc((100% - 240px) * share)`, and a browser ignores
 * `calc()` mixing a percentage and a length on a `<col>`: measured in the
 * preview 2026-09-27 at a 1,368px box, pinned 1 + 1, every loose column drew
 * at 171.33px — an equal share, whatever the view designer had set. The
 * pixel layout below restores the proportions the plan always meant.
 */

/**
 * The width budgeted per loose column before the table scrolls rather than
 * squeezing — see `tableMinWidth` in `components/resolve.ts`, which reads it
 * from here so the two layouts cannot disagree about it.
 */
export const COLUMN_BUDGET = 100;

/** The select column: a fixed-size checkbox that takes no part in proportions. */
export const SELECT_WIDTH = 40;

/** The narrowest a column is dragged to. A header needs its label, its sort arrow and a handle. */
export const MIN_WIDTH = 64;

/** The widest a column can be dragged. Wider than a laptop screen is a mistake with no way back but Reset. */
export const MAX_WIDTH = 800;

/** One arrow key's worth, and one Shift+arrow's — `pcf-row-commands`' numbers. */
export const STEP = 16;
export const STEP_LARGE = 64;

export type Edge = 'start' | 'end' | null;

/** Dragged widths by column name. A column absent from the map has none. */
export type Overrides = Record<string, number>;

export interface ColumnLike {
    name: string;
    visualSizeFactor: number;
}

export interface SizedColumn {
    /** Whole pixels. */
    width: number;
    pinned: Edge;
    /** How far in from the pinned edge, in px; 0 for a loose column. */
    offset: number;
    /** The last column of a pinned run — the one that carries the seam. */
    edge: boolean;
}

export interface Sizing {
    /** One per column, in the order given. */
    columns: SizedColumn[];
    /** The table's own width: every column plus the select column. */
    table: number;
}

export function clampWidth(width: number, max: number = MAX_WIDTH): number {
    if (!Number.isFinite(width)) {
        return MIN_WIDTH;
    }

    return Math.min(Math.max(max, MIN_WIDTH), Math.max(MIN_WIDTH, Math.round(width)));
}

/** One arrow key on a handle. Right widens left-to-right; the RTL caller flips `direction`. */
export function nudge(width: number, direction: 1 | -1, large: boolean): number {
    return clampWidth(width + direction * (large ? STEP_LARGE : STEP));
}

/**
 * A pinned column's width, before anybody drags it: the view's factor read as
 * pixels, which `pcf-row-commands` P5 measured it to be, or the budget where
 * the host set none — canvas reports 0 for every column.
 */
function pinnedBase(column: ColumnLike): number {
    return column.visualSizeFactor > 0 ? column.visualSizeFactor : COLUMN_BUDGET;
}

/**
 * Every column's width, in the width available.
 *
 * **With no overrides, this is what the browser already draws.** The loose
 * columns divide what is left after the pinned ones and the select column, in
 * proportion to their factors, and never below the budget in total — measured
 * against 0.6.20 in the preview at 840px and 1,368px, where the percentage
 * layout drew each column at `share × (table − 40)` exactly. So the first drag
 * moves one column and nothing else.
 *
 * **With overrides, a resized column draws at exactly its width and the others
 * keep theirs** — except the last loose column, which takes whatever is left
 * when the columns add up to less than the box (see the fill below).
 * `pcf-row-commands` shares that surplus among every column nobody resized,
 * and there the edge being dragged drifts from the pointer: narrowing one
 * column widens the ones before it, which moves the column's own left edge.
 * Giving it all to the last column keeps the handle under the pointer for
 * every column but that one, whose edge is the box's.
 *
 * **A pinned column cannot be dragged into eating the view.** `pinPlan` unpins
 * everything when the pinned total leaves less than one budget column of room;
 * a drag honours the same line by stopping short of it, which is gentler than
 * unpinning mid-drag.
 *
 * `available <= 0` is a host that reported no width: the loose columns get
 * their budget and the pinned clamp is off.
 */
export function sizeColumns(
    columns: ColumnLike[],
    pinned: Edge[],
    overrides: Overrides,
    selectable: boolean,
    selectPinned: boolean,
    available: number,
): Sizing {
    const select = selectable ? SELECT_WIDTH : 0;
    const isPinned = columns.map((_, index) => Boolean(pinned[index]));
    const base = columns.map((column, index) => (isPinned[index] ? pinnedBase(column) : 0));
    const pinnedTotal = base.reduce((sum, width) => sum + width, 0);

    const loose = columns.map((_, index) => index).filter((index) => !isPinned[index]);
    const factorTotal = loose.reduce((sum, index) => sum + Math.max(0, columns[index].visualSizeFactor || 0), 0);
    const room = Math.max(available > 0 ? available - pinnedTotal - select : 0, loose.length * COLUMN_BUDGET);

    /*
     * Rounded at the running edge rather than per column, so every column is
     * within a pixel of its exact share **and** the widths add up to the room
     * exactly — a pixel short and the table stops before the edge, a pixel
     * over and a scrollbar appears for nothing. Flooring each share and
     * handing the remainder to the last column does the second and not the
     * first: with eight columns the last one came out seven pixels wide of
     * what the browser drew.
     */
    let exact = 0;
    let edge = 0;

    loose.forEach((index) => {
        const share = factorTotal > 0 ? Math.max(0, columns[index].visualSizeFactor || 0) / factorTotal : 1 / loose.length;

        exact += room * share;

        const next = Math.round(exact);

        base[index] = next - edge;
        edge = next;
    });

    const widths = columns.map((column, index) => {
        const override = overrides[column.name];

        return override === undefined ? base[index] : clampWidth(override);
    });

    // The pinned clamp, one resized pinned column at a time.
    if (available > 0) {
        const limit = available - COLUMN_BUDGET - (selectPinned ? select : 0);

        columns.forEach((column, index) => {
            if (!isPinned[index] || overrides[column.name] === undefined) {
                return;
            }

            const others = widths.reduce((sum, width, other) => (isPinned[other] && other !== index ? sum + width : sum), 0);

            widths[index] = Math.min(widths[index], Math.max(MIN_WIDTH, limit - others));
        });
    }

    /*
     * **The table fills its box, and the last loose column takes the slack.**
     *
     * 0.7.0's first build let a narrowed table end short of the edge, and on a
     * real form that was worse than untidy. A form section is a shrink-to-fit
     * parent, so the box the component measures *is* the table's width: the
     * table ended short, the box shrank to it, the room shrank with the box,
     * and every column shrank again — a 64px drag took 326px off the table in
     * the preview with the host made shrink-to-fit, and the white space was
     * the part of the host the box no longer covered. Widening then ran the
     * loop the other way, with nothing to stop it where the host reported no
     * width, until React refused to re-render ("Error loading control").
     *
     * Filling keeps the table at least as wide as the room it was sized in, so
     * a measured box can never report less than it was given. The **last**
     * loose column takes it, rather than every free column in proportion as
     * `pcf-row-commands` does, because a column's left edge then never moves
     * while the column is dragged: every column that grows is after it.
     */
    if (available > 0 && loose.length > 0) {
        const total = widths.reduce((sum, width) => sum + width, 0) + select;

        if (total < available) {
            widths[loose[loose.length - 1]] += available - total;
        }
    }

    const sized: SizedColumn[] = columns.map((_, index) => ({
        width: widths[index],
        pinned: pinned[index] ?? null,
        offset: 0,
        edge: false,
    }));

    // Offsets are running sums: forwards from the start edge, backwards from the end.
    let fromStart = selectPinned ? select : 0;
    let lastStart = -1;

    sized.forEach((column, index) => {
        if (column.pinned === 'start') {
            column.offset = fromStart;
            fromStart += column.width;
            lastStart = index;
        }
    });

    let fromEnd = 0;
    let firstEnd = -1;

    for (let index = sized.length - 1; index >= 0; index -= 1) {
        if (sized[index].pinned === 'end') {
            sized[index].offset = fromEnd;
            fromEnd += sized[index].width;
            firstEnd = index;
        }
    }

    if (lastStart >= 0) {
        sized[lastStart].edge = true;
    }

    if (firstEnd >= 0) {
        sized[firstEnd].edge = true;
    }

    return {
        columns: sized,
        table: widths.reduce((sum, width) => sum + width, 0) + select,
    };
}

/**
 * Where a view's widths live.
 *
 * By table **and** view, because a width is a decision about one view: the
 * name column of *Active Accounts* and of *My Accounts* are sized for
 * different company. `getViewId()` was measured present and stable on a
 * subgrid and a main grid by `pcf-row-commands` (P4). A host without one —
 * canvas has no saved view — keys by the column set instead.
 */
export function storageKey(table: string, viewId: string | null | undefined, columns: ColumnLike[]): string {
    const view = viewId && viewId !== ''
        ? viewId.replace(/[{}]/g, '').toLowerCase()
        : `cols:${columns.map((column) => column.name).join(',')}`;

    return `pcfhub.datatable.widths:${table}:${view}`;
}

/** Whatever `localStorage` answers — which may be a throw on the access itself. */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * The overrides stored for this view, kept only for columns it still has.
 *
 * **Every step can fail and none of them is an error the user should see.**
 * Reading `localStorage` throws when site data is blocked (the access, not a
 * method), the value may be somebody else's JSON or none, and a column the
 * maker has since removed leaves a width behind. Each of those is "no
 * overrides" — the view's widths — which is what 0.6.x drew.
 */
export function readOverrides(storage: () => StorageLike | undefined, key: string, columns: ColumnLike[]): Overrides {
    let raw: string | null = null;

    try {
        raw = storage()?.getItem(key) ?? null;
    } catch {
        return {};
    }

    if (raw === null) {
        return {};
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }

    const names = new Set(columns.map((column) => column.name));
    const kept: Overrides = {};

    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (names.has(name) && typeof value === 'number' && Number.isFinite(value)) {
            kept[name] = clampWidth(value);
        }
    }

    return kept;
}

/**
 * Store the overrides, or remove the key when there are none. `false` when the
 * store refused — a full quota, blocked site data — so the caller keeps the
 * widths for this session and says nothing: the drag still worked.
 */
export function writeOverrides(storage: () => StorageLike | undefined, key: string, overrides: Overrides): boolean {
    try {
        const store = storage();

        if (!store) {
            return false;
        }

        if (Object.keys(overrides).length === 0) {
            store.removeItem(key);
        } else {
            store.setItem(key, JSON.stringify(overrides));
        }

        return true;
    } catch {
        return false;
    }
}
