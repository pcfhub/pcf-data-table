/*
 * _template/variants/lib/rank-order — the keyboard
 *
 * SHARED. Copied into a control as <Control>/lib/rank-order/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Written 2026-10-30 for pcf-data-table 0.9.0.
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
