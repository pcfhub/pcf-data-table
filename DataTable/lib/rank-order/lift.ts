/*
 * _template/variants/lib/rank-order — the keyboard
 *
 * SHARED. Copied into a control as <Control>/lib/rank-order/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Written 2026-10-30 for pcf-data-table 0.9.0; `liftGridKey`, the same
 * across columns, 2026-11-12 for pcf-kanban-board 0.6.0.
 */

/**
 * Moving a row from the keyboard: focus its handle, **Space lifts, Up and
 * Down move, Space drops, Escape cancels** — the pattern drag-and-drop
 * libraries settled on, which a screen reader can follow when each step is
 * announced. Enter works where Space does, for the users who reach for it.
 *
 * Pure: the control keeps a `LiftState`, hands every key here with the row's
 * index and the row count, applies the state that comes back, announces
 * `event`, and on `drop` writes the move (`plan.ts`). `handled` decides
 * `preventDefault()` — a lifted row takes the arrows from the page's scroll.
 *
 * Tab while lifted cancels and is **not** handled, so focus still leaves:
 * a move nobody can see the end of is worse than one that never happened.
 */

export type LiftState =
    | { lifted: false }
    | { lifted: true; id: string; from: number; at: number };

export interface LiftPress {
    key: string;
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
    shift?: boolean;
}

export type LiftEvent = 'lift' | 'move' | 'edge' | 'drop' | 'cancel';

export interface LiftResult {
    state: LiftState;
    handled: boolean;
    event?: LiftEvent;
}

export const RESTING: LiftState = { lifted: false };

/**
 * What `press` does to `state` on the handle of the row `id`, drawn at
 * `index` of `count` rows. `edge` is a move that would leave the page: taken,
 * announced, nothing moves.
 */
export function liftKey(state: LiftState, press: LiftPress, id: string, index: number, count: number): LiftResult {
    const unhandled: LiftResult = { state, handled: false };

    if (press.ctrl || press.meta || press.alt) {
        return unhandled;
    }

    if (!state.lifted) {
        if (press.key === ' ' || press.key === 'Enter') {
            return { state: { lifted: true, id, from: index, at: index }, handled: true, event: 'lift' };
        }
        return unhandled;
    }

    const to = (at: number): LiftResult => {
        const clamped = Math.max(0, Math.min(at, count - 1));
        if (clamped === state.at) {
            return { state, handled: true, event: 'edge' };
        }
        return { state: { ...state, at: clamped }, handled: true, event: 'move' };
    };

    switch (press.key) {
        case 'ArrowUp':
            return to(state.at - 1);
        case 'ArrowDown':
            return to(state.at + 1);
        case 'Home':
            return to(0);
        case 'End':
            return to(count - 1);
        case ' ':
        case 'Enter':
            // A drop where it was lifted is a cancel: nothing to write.
            return state.at === state.from
                ? { state: RESTING, handled: true, event: 'cancel' }
                : { state: RESTING, handled: true, event: 'drop' };
        case 'Escape':
            return { state: RESTING, handled: true, event: 'cancel' };
        case 'Tab':
            return { state: RESTING, handled: false, event: 'cancel' };
        default:
            // Anything else is swallowed while lifted, so a stray letter
            // cannot start type-ahead or a shortcut halfway through a move.
            return { state, handled: true };
    }
}

/*
 * The grid version — added 2026-11-12 for pcf-kanban-board 0.6.0, where a
 * card lifted from one lane can be carried to the next.
 */

/** A place on a board: a column (a lane, or a lane's cell in a row) and a slot in it. */
export interface GridSpot {
    column: number;
    index: number;
}

export type GridLiftState =
    | { lifted: false }
    | { lifted: true; id: string; from: GridSpot; at: GridSpot };

export interface GridLayout {
    /**
     * How many slots each column offers the lifted row: its **other** rows,
     * plus one. So the column it came from has as many as it has rows, and
     * every other column one more. Slot `i` is "before that column's `i`th
     * other row"; the last slot is its end.
     */
    places: readonly number[];
    /** Whether a column takes the row at all — a lane the table's transitions close, say. Absent, every one does. */
    open?: (column: number) => boolean;
    /** Right to left: Left and Right swap, as they do on screen. */
    rtl?: boolean;
}

export interface GridLiftResult {
    state: GridLiftState;
    handled: boolean;
    event?: LiftEvent;
}

export const GRID_RESTING: GridLiftState = { lifted: false };

const sameSpot = (a: GridSpot, b: GridSpot): boolean => a.column === b.column && a.index === b.index;

/**
 * `liftKey` across columns. Up and Down move within the column, Home and End
 * to its ends; **Left and Right carry the row to the nearest open column
 * that way**, keeping its slot where the column is long enough and its end
 * where it is not, and stop at the last one (`edge`). Space or Enter drops —
 * a cancel where it was lifted — and Escape and Tab cancel, as in `liftKey`.
 *
 * `spot` is where the row `id` is drawn when it is not lifted; `layout` is
 * the board as it would be with the row taken out.
 */
export function liftGridKey(
    state: GridLiftState,
    press: LiftPress,
    id: string,
    spot: GridSpot,
    layout: GridLayout,
): GridLiftResult {
    const unhandled: GridLiftResult = { state, handled: false };

    if (press.ctrl || press.meta || press.alt) {
        return unhandled;
    }

    if (!state.lifted) {
        if (press.key === ' ' || press.key === 'Enter') {
            return { state: { lifted: true, id, from: spot, at: spot }, handled: true, event: 'lift' };
        }
        return unhandled;
    }

    const slots = (column: number): number => Math.max(1, layout.places[column] ?? 1);
    const to = (next: GridSpot): GridLiftResult => (sameSpot(next, state.at)
        ? { state, handled: true, event: 'edge' }
        : { state: { ...state, at: next }, handled: true, event: 'move' });
    const within = (index: number): GridLiftResult => to({
        column: state.at.column,
        index: Math.max(0, Math.min(index, slots(state.at.column) - 1)),
    });
    const across = (step: number): GridLiftResult => {
        const open = layout.open ?? ((): boolean => true);
        for (let column = state.at.column + step; column >= 0 && column < layout.places.length; column += step) {
            if (open(column)) {
                return to({ column, index: Math.min(state.at.index, slots(column) - 1) });
            }
        }
        return { state, handled: true, event: 'edge' };
    };
    const forward = layout.rtl ? -1 : 1;

    switch (press.key) {
        case 'ArrowUp':
            return within(state.at.index - 1);
        case 'ArrowDown':
            return within(state.at.index + 1);
        case 'Home':
            return within(0);
        case 'End':
            return within(slots(state.at.column) - 1);
        case 'ArrowRight':
            return across(forward);
        case 'ArrowLeft':
            return across(-forward);
        case ' ':
        case 'Enter':
            return sameSpot(state.at, state.from)
                ? { state: GRID_RESTING, handled: true, event: 'cancel' }
                : { state: GRID_RESTING, handled: true, event: 'drop' };
        case 'Escape':
            return { state: GRID_RESTING, handled: true, event: 'cancel' };
        case 'Tab':
            return { state: GRID_RESTING, handled: false, event: 'cancel' };
        default:
            return { state, handled: true };
    }
}
