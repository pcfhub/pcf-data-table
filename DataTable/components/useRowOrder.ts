import * as React from 'react';
import { liftKey, LiftState, RESTING } from '../lib/rank-order/lift';
import { moved } from '../lib/rank-order/plan';

/**
 * Rows in your own order, since 0.9.0: everything about how a move looks
 * while it happens. The writes are `index.ts`'s; this holds the state only
 * React can repaint — the lifted row, the drag, the order held on screen until
 * the re-read lands, the busy note and the message — for the reason editing
 * holds its optimistic values in the component (`useEditing`).
 */

/** What `index.ts` decided about the order on this pass. */
export interface OrderView {
    /** The order column's logical name. */
    column: string;
    /** Why the rows cannot be moved as drawn: another sort, a filter, grouping. `null`: they can. */
    outOfOrder: 'sort' | 'filter' | 'group' | null;
    /** A writable host and an enabled control. Each row's own answer is asked here. */
    writable: boolean;
    loading: boolean;
    /** Rows on this page with no value, which a move cannot place (R1). */
    unnumbered: number;
}

export interface OrderInputs {
    order: OrderView | null;
    pageIds: string[];
    disabled: boolean;
    canEdit: (id: string, column: string) => Promise<boolean> | null;
    getString: (id: string) => string;
    nameOf: (id: string) => string;
    onMoveRow: (from: number, to: number) => Promise<void>;
    onNumberRows: () => Promise<void>;
}

export interface HandleProps {
    ref: (element: HTMLButtonElement | null) => void;
    'aria-disabled': true | undefined;
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: () => void;
    onLostPointerCapture: () => void;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface RowOrder {
    /** The rows to draw, in the order to draw them. */
    rows: string[];
    /** Draw a handle on each row. */
    handles: boolean;
    /** The row lifted from the keyboard or being dragged. */
    liftedId: string | null;
    /** Where a drag would drop: a line above or below this row. */
    dropTarget: { id: string; edge: 'above' | 'below' } | null;
    busy: 'moving' | 'numbering' | null;
    /** Why the last move or numbering did not happen. Cleared by the next one. */
    message: string;
    /** For the live region. */
    announce: string;
    handleProps: (id: string) => HandleProps;
    rowRef: (id: string) => (element: HTMLTableRowElement | null) => void;
    number: () => void;
    /** Before *Back to your order*: the handles it brings back take the focus. */
    focusOnReturn: () => void;
}

/**
 * How long a moved order is held on screen waiting for the re-read to agree.
 * The probe's slowest refresh was 14 s (SPEC.md 0.3.x); after this the
 * dataset's own order is drawn, whatever it is.
 */
const HOLD_MS = 15000;

/** A press shorter than this is a click on the handle, not a drag. */
const DRAG_START_PX = 4;

interface Drag {
    id: string;
    from: number;
    at: number;
    startY: number;
    started: boolean;
}

export function useRowOrder(inputs: OrderInputs): RowOrder {
    const { order, pageIds, disabled, canEdit, getString, nameOf, onMoveRow, onNumberRows } = inputs;

    const [lift, setLift] = React.useState<LiftState>(RESTING);
    const [drag, setDragState] = React.useState<Drag | null>(null);
    /*
     * The drag, read by the pointer handlers from a ref: a move and a release
     * can arrive before React has re-rendered with the press, and a handler
     * closed over the previous render would see no drag at all.
     */
    const dragRef = React.useRef<Drag | null>(null);
    const setDrag = (next: Drag | null | ((current: Drag | null) => Drag | null)): void => {
        dragRef.current = typeof next === 'function' ? next(dragRef.current) : next;
        setDragState(dragRef.current);
    };
    const [held, setHeld] = React.useState<string[] | null>(null);
    const [busy, setBusy] = React.useState<RowOrder['busy']>(null);
    const [message, setMessage] = React.useState('');
    const [announce, setAnnounce] = React.useState('');
    const [editable, setEditable] = React.useState<Map<string, boolean>>(() => new Map());

    const asked = React.useRef<Set<string>>(new Set());
    const handleElements = React.useRef<Map<string, HTMLButtonElement>>(new Map());
    const rowElements = React.useRef<Map<string, HTMLTableRowElement>>(new Map());
    const mounted = React.useRef(true);
    /*
     * *Number them* and *Back to your order* remove themselves when they work,
     * taking the focus with them. The first handle is the nearest thing to
     * what they did — the *Reset widths* rule.
     */
    const focusFirst = React.useRef(false);

    React.useEffect(() => {
        mounted.current = true;
        return (): void => {
            mounted.current = false;
        };
    }, []);

    const pageKey = pageIds.join('|');
    const candidate = order !== null && order.outOfOrder === null && order.writable && !disabled;

    /*
     * Each row's own answer for the order column, asked once per row.
     * `isEditable` answered `true` for an inactive row and its save went
     * through (R4), so this is about privileges, not state. Absent is "not
     * yet", and draws no handles — offering a move the platform then refuses
     * costs a rollback.
     */
    React.useEffect(() => {
        if (!candidate || order === null) {
            return;
        }

        const column = order.column;
        const fresh = pageIds.filter((id) => !asked.current.has(`${column}|${id}`));

        if (fresh.length === 0) {
            return;
        }

        fresh.forEach((id) => asked.current.add(`${column}|${id}`));

        void Promise.all(fresh.map((id): Promise<[string, boolean]> => {
            const answer = canEdit(id, column);

            return answer
                ? answer.then((value): [string, boolean] => [id, value === true], (): [string, boolean] => [id, false])
                : Promise.resolve<[string, boolean]>([id, false]);
        })).then((entries) => {
            if (!mounted.current) {
                return;
            }

            setEditable((current) => {
                const next = new Map(current);
                entries.forEach(([id, value]) => next.set(id, value));
                return next;
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidate, order?.column, pageKey]);

    /*
     * The held order is let go when the dataset agrees with it, when the page
     * holds other rows, or after `HOLD_MS`. Each save repaints with its new
     * value but the rows are not re-sorted until the re-read (R3), so nothing
     * before that is a reason to let go.
     */
    React.useEffect(() => {
        if (held === null) {
            return undefined;
        }

        const sameRows = held.length === pageIds.length && pageIds.every((id) => held.includes(id));

        if (!sameRows || held.join('|') === pageKey) {
            setHeld(null);
            return undefined;
        }

        const timer = window.setTimeout(() => setHeld(null), HOLD_MS);

        return (): void => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [held, pageKey]);

    const handles = candidate
        && order !== null
        && order.unnumbered === 0
        && pageIds.length > 1
        && pageIds.every((id) => editable.get(id) === true);
    const idle = handles && order !== null && !order.loading && busy === null && held === null;

    // A lift or a drag outliving the handles — the page reloaded under it — is dropped.
    React.useEffect(() => {
        if (!idle) {
            if (lift.lifted) {
                setLift(RESTING);
            }
            if (drag) {
                setDrag(null);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idle]);

    React.useLayoutEffect(() => {
        if (!focusFirst.current || !handles || pageIds.length === 0) {
            return;
        }

        focusFirst.current = false;
        handleElements.current.get(pageIds[0])?.focus();
    });

    // A row moved from the keyboard is drawn somewhere else, and React may
    // have moved its button to do it: the focus goes back to it.
    React.useLayoutEffect(() => {
        if (!lift.lifted) {
            return;
        }

        const element = handleElements.current.get(lift.id);

        if (element && element.ownerDocument.activeElement !== element) {
            element.focus();
        }
    }, [lift]);

    const say = (id: string, ...values: Array<string | number>): string =>
        values.reduce<string>((text, value, index) => text.replace(`{${index}}`, String(value)), getString(id));

    const commit = (id: string, from: number, to: number): void => {
        setHeld(moved(pageIds, from, to));
        setBusy('moving');
        setMessage('');
        setAnnounce(say('DataTable_OrderDropped', nameOf(id), to + 1, pageIds.length));

        onMoveRow(from, to).then(
            () => {
                if (mounted.current) {
                    setBusy(null);
                }
            },
            (error: unknown) => {
                if (!mounted.current) {
                    return;
                }

                const text = (error as Error)?.message || getString('DataTable_OrderFailed');

                setHeld(null);
                setBusy(null);
                setMessage(text);
                setAnnounce(text);
            },
        );
    };

    /** Where a pointer at `y` would drop the dragged row: the count of other rows above it. */
    const slotAt = (id: string, y: number): number => pageIds
        .filter((other) => other !== id)
        .filter((other) => {
            const box = rowElements.current.get(other)?.getBoundingClientRect();
            return box ? box.top + box.height / 2 < y : false;
        }).length;

    const handleProps = (id: string): HandleProps => {
        const index = pageIds.indexOf(id);

        return {
            ref: (element): void => {
                if (element) {
                    handleElements.current.set(id, element);
                } else {
                    handleElements.current.delete(id);
                }
            },
            'aria-disabled': idle ? undefined : true,
            onKeyDown: (event): void => {
                if (!idle) {
                    return;
                }

                const result = liftKey(
                    lift,
                    { key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey },
                    id,
                    index,
                    pageIds.length,
                );

                if (result.handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                const before = lift;

                setLift(result.state);

                switch (result.event) {
                    case 'lift':
                        setMessage('');
                        setAnnounce(say('DataTable_OrderLifted', nameOf(id), index + 1, pageIds.length));
                        break;
                    case 'move':
                        if (result.state.lifted) {
                            setAnnounce(say('DataTable_OrderAt', nameOf(id), result.state.at + 1, pageIds.length));
                        }
                        break;
                    case 'edge':
                        setAnnounce(getString(before.lifted && before.at === 0 ? 'DataTable_OrderTop' : 'DataTable_OrderBottom'));
                        break;
                    case 'drop':
                        if (before.lifted) {
                            commit(before.id, before.from, before.at);
                        }
                        break;
                    case 'cancel':
                        if (before.lifted) {
                            setAnnounce(say('DataTable_OrderCancelled', nameOf(before.id), before.from + 1));
                        }
                        break;
                    default:
                        break;
                }
            },
            onPointerDown: (event): void => {
                // The row opens its record on a click; the handle is not the row.
                event.stopPropagation();

                if (!idle || event.button !== 0 || lift.lifted) {
                    return;
                }

                // No text selection and no native drag from the press: a
                // dragstart there cancels the pointer (seen in the preview, a
                // drag begun over a cell's text). The default being prevented
                // also takes the focus away from the press, so it is given back.
                event.preventDefault();
                event.currentTarget.focus();

                // A pointer the browser does not know refuses capture; the drag
                // still works while it stays over the handle.
                try {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                } catch {
                    // nothing to do
                }
                setDrag({ id, from: index, at: index, startY: event.clientY, started: false });
            },
            onPointerMove: (event): void => {
                const current = dragRef.current;

                if (!current || current.id !== id) {
                    return;
                }

                if (!current.started && Math.abs(event.clientY - current.startY) < DRAG_START_PX) {
                    return;
                }

                const at = slotAt(id, event.clientY);

                if (!current.started || at !== current.at) {
                    setDrag({ ...current, at, started: true });
                }
            },
            onPointerUp: (event): void => {
                event.stopPropagation();

                const done = dragRef.current;

                if (!done || done.id !== id) {
                    return;
                }

                // The release lands where the pointer let go, even if no move
                // event was delivered on the way.
                if (Math.abs(event.clientY - done.startY) >= DRAG_START_PX) {
                    done.at = slotAt(id, event.clientY);
                    done.started = true;
                }

                setDrag(null);

                try {
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                } catch {
                    // never captured
                }

                if (done.started && done.at !== done.from) {
                    commit(id, done.from, done.at);
                }
            },
            onPointerCancel: (): void => setDrag(null),
            onLostPointerCapture: (): void => setDrag((current) => (current && current.id === id ? null : current)),
            onClick: (event): void => event.stopPropagation(),
        };
    };

    const rows = held
        ?? (lift.lifted ? moved(pageIds, lift.from, lift.at) : pageIds);

    let dropTarget: RowOrder['dropTarget'] = null;

    if (drag && drag.started && drag.at !== drag.from) {
        const others = pageIds.filter((other) => other !== drag.id);

        dropTarget = drag.at < others.length
            ? { id: others[drag.at], edge: 'above' }
            : { id: others[others.length - 1], edge: 'below' };
    }

    return {
        rows,
        handles,
        liftedId: lift.lifted ? lift.id : drag && drag.started ? drag.id : null,
        dropTarget,
        busy,
        message,
        announce,
        handleProps,
        rowRef: (id: string) => (element: HTMLTableRowElement | null): void => {
            if (element) {
                rowElements.current.set(id, element);
            } else {
                rowElements.current.delete(id);
            }
        },
        focusOnReturn: (): void => {
            focusFirst.current = true;
        },
        number: (): void => {
            if (busy !== null) {
                return;
            }

            setBusy('numbering');
            setMessage('');

            onNumberRows().then(
                () => {
                    if (mounted.current) {
                        focusFirst.current = true;
                        setBusy(null);
                    }
                },
                (error: unknown) => {
                    if (!mounted.current) {
                        return;
                    }

                    const text = (error as Error)?.message || getString('DataTable_OrderFailed');

                    setBusy(null);
                    setMessage(text);
                    setAnnounce(text);
                },
            );
        },
    };
}
