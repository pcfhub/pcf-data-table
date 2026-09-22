/**
 * The decidable half of a full-view export: what to ask for next, when to
 * stop, and what to put back afterwards.
 *
 * Pure. The fetching, the timers and the file live in `index.ts`, because they
 * are the platform; everything here is arithmetic over a state object, which
 * is the part worth asserting directly.
 *
 * **The problem this exists for**, stated in `index.ts` since 0.2.0: the
 * dataset holds the pages that have been fetched, so an export covers what
 * somebody happened to have paged through. Reaching the rest means raising the
 * page size, looping `loadExactPage` and reassembling — *"an async state
 * machine on top of a lifecycle that re-enters `updateView` on every fetch"*.
 *
 * **The measurement that shaped it** (2026-09-20, SPEC.md 0.6.0):
 *
 * - **`setPageSize(250)` is honoured**, echoed back, not clamped. So a view of
 *   250 rows or fewer is **one fetch and no loop at all** — the common case
 *   stops being a state machine, and the machine below only runs for the long
 *   one.
 * - **`loadExactPage` does not accumulate**, sets `hasPreviousPage`, and moves
 *   backwards as readily as forwards. The restore step is therefore a single
 *   call rather than a walk.
 * - The dedupe stays regardless, because it is what the `loadNextPage(true)`
 *   fallback needs on a host without `loadExactPage` — there, page three
 *   arrives as pages one to three.
 */

/** Where the user was before the export moved them, so they can be put back. */
export interface Restore {
    page: number;
    pageSize: number;
}

export interface Collecting {
    phase: 'collecting';
    /**
     * The page already asked for and not yet seen, or `null` when nothing is
     * outstanding.
     *
     * **This is the re-entry guard**, and it generalises the pattern
     * `appliedPageSize` and `appliedFilter` already use: a field recording what
     * has been asked for, compared before asking again. `updateView` fires on
     * every dataset change including the ones this machine caused, so without
     * it the export asks for the same page forever.
     */
    awaitingPage: number | null;
    /** The page to ask for once the outstanding one lands. */
    nextPage: number;
    /** Record ids already collected, so an accumulating host cannot double-count. */
    seen: Set<string>;
    rows: string[][];
    headers: string[];
    restore: Restore;
    cancelled: boolean;
}

export interface Idle { phase: 'idle' }

export interface Failed {
    phase: 'failed';
    message: string;
    /** What was collected before it stopped, so it can still be offered. */
    rows: string[][];
    restore: Restore;
}

export type ExportState = Idle | Collecting | Failed;

/**
 * The row ceiling.
 *
 * Forty pages at 250. A constant rather than a property, because it is a
 * number nobody can choose well and a maker asked to would be guessing at
 * someone else's patience.
 *
 * **The real constraint is round trips, not memory.** Forty sequential fetches
 * at a latency nobody has isolated — E1's readings were swamped by the probe's
 * own settle — is somewhere between a minute and a very long time. That is
 * what the page counter and the Cancel in the progress UI are for: the ceiling
 * stops the pathological case, and the reader stops the merely slow one.
 */
export const EXPORT_MAX_ROWS = 10000;

/**
 * The round-trip ceiling.
 *
 * **The row ceiling stopped bounding the cost the moment the export stopped
 * resizing.** It reads at whatever page size the view is already using, and a
 * model-driven subgrid's default is small — measured at **four** on a real form,
 * 2026-09-21, which turned 1,222 records into 306 requests. At that size the
 * 10,000-row ceiling would allow 2,500.
 *
 * `EXPORT_MAX_ROWS` bounds the file; this bounds the server. Whichever is
 * reached first ends the export, and the completion message says the file holds
 * the first N rows rather than the view.
 *
 * A maker who needs more sets the control's `pageSize`, which raises the page
 * the *view* uses — established when the grid loads rather than changed
 * underneath it, which is the distinction the whole export saga turned on.
 */
export const EXPORT_MAX_PAGES = 500;

export function begin(headers: string[], restore: Restore): Collecting {
    return {
        phase: 'collecting',
        awaitingPage: 1,
        nextPage: 1,
        seen: new Set<string>(),
        rows: [],
        headers,
        restore,
        cancelled: false,
    };
}

/**
 * What a qualifying `updateView` pass turned out to be carrying.
 *
 * **This is tri-state because assuming it was binary lost 250 rows.** Measured
 * on a real form, 2026-09-21: an export started from page 2 wrote 972 of 1,222
 * records, and the gap in the file was one whole page — records ~229 to ~478,
 * with the tail intact and no duplicates.
 *
 * `beginExport` issues two platform calls back to back, `setPageSize(250)` then
 * `loadExactPage(1)`, and the platform answered with **two** `updateView`
 * passes. Both satisfied `shouldHarvest` — collecting, a page outstanding, not
 * loading. The first harvested page one and asked for page two; the second
 * still held page one's rows, contributed nothing because the dedupe ate all
 * 250, and **advanced the page counter anyway**. Page two was never requested.
 *
 * The old guard proved a page had been *asked for*. It never proved one had
 * *arrived*. Nothing here may advance on a pass that brought no new records.
 */
export type Arrival =
    /** A new page landed. Ask for the next one. */
    | { kind: 'page'; state: Collecting }
    /**
     * Rows we already hold. The page asked for has not landed yet, so the wait
     * stays in place, nothing advances, and **no second request is made** — one
     * is already outstanding. A host that answers `loadExactPage(n)` with the
     * same page forever stalls here and the watchdog ends it, which is the
     * honest outcome: better a named failure than a quietly short file.
     */
    | { kind: 'repeat' }
    /** Nothing came back at all. There is no more view to read. */
    | { kind: 'end'; state: Collecting };

/**
 * Fold one page's rows in, deduplicating by record id.
 *
 * **The dedupe is not belt-and-braces.** A host without `loadExactPage` falls
 * back to `loadNextPage(true)`, which on the measured platform returns the
 * whole range from page one — so page three arrives holding pages one to
 * three, and a naive append triples the first page. Arrival order is kept,
 * which is the view's order.
 *
 * **"No new records" is a sound test for "not the page I asked for."** On a
 * host that does not accumulate, page N is a fresh 250 ids, every one of them
 * new. On a host that does, page N arrives as pages 1..N and still carries the
 * 250 that make it page N. Either way a genuine new page contributes something;
 * only a repeat contributes nothing. At the real end of the view `hasNextPage`
 * has already stopped the loop, so the case cannot be confused with exhaustion.
 */
export function harvest(
    state: Collecting,
    ids: string[],
    rowOf: (id: string) => string[],
): Arrival {
    if (ids.length === 0) {
        return { kind: 'end', state };
    }

    const seen = state.seen;
    const rows = state.rows;
    let added = 0;

    for (const id of ids) {
        if (seen.has(id)) {
            continue;
        }

        seen.add(id);

        if (rows.length >= EXPORT_MAX_ROWS) {
            break;
        }

        rows.push(rowOf(id));
        added += 1;
    }

    if (added === 0 && rows.length > 0) {
        return { kind: 'repeat' };
    }

    return {
        kind: 'page',
        state: { ...state, seen, rows, awaitingPage: null, nextPage: state.nextPage + 1 },
    };
}

/**
 * The page to ask for next, or `null` when the export is finished.
 *
 * **It asks the platform rather than computing.** The first version divided
 * `totalResultCount` by the page size it had *requested* — and the platform
 * may hand back fewer rows per page than asked for, which
 * `docs/limitations.md` has said since 0.2.0 and which the rig now models. So
 * on any view the platform paged more tightly than 250, the machine concluded
 * one page covered everything and wrote a **silently truncated file**: the
 * worst shape of bug this feature could have, because the export looks like it
 * worked.
 *
 * `hasNextPage` is the platform's own answer to the only question that
 * matters, it needs no arithmetic, and it is correct whether or not the count
 * is available — `totalResultCount` is **`-1` when the platform declines to
 * count**, which is a real state and not an error.
 *
 * The ceiling remains as the backstop for a host whose `hasNextPage` never
 * goes false.
 */
export function nextPageFor(state: Collecting, hasNextPage: boolean): number | null {
    if (state.cancelled || state.rows.length >= EXPORT_MAX_ROWS) {
        return null;
    }

    // The request ceiling. See `EXPORT_MAX_PAGES`.
    if (state.nextPage > EXPORT_MAX_PAGES) {
        return null;
    }

    return hasNextPage ? state.nextPage : null;
}

/**
 * Whether either ceiling cut the export short, which the completion message
 * names. Rows bound the file; pages bound the server.
 */
export const wasCapped = (state: { rows: string[][]; nextPage?: number }): boolean =>
    state.rows.length >= EXPORT_MAX_ROWS || (state.nextPage ?? 0) > EXPORT_MAX_PAGES;

/**
 * Whether this `updateView` pass is the one that should harvest.
 *
 * Three things have to be true at once: the machine is running, something was
 * asked for, and the platform is no longer loading. Any other pass renders
 * progress and returns — **exactly one fetch is outstanding at a time and the
 * page number strictly increases**, which is what makes this terminate.
 */
export const shouldHarvest = (state: ExportState, loading: boolean): state is Collecting =>
    state.phase === 'collecting' && state.awaitingPage !== null && !loading;

/**
 * What to put back when the export ends, however it ended.
 *
 * Always returned, even for a cancel or a failure: the export moved the user
 * off their page and raised their page size, and leaving them there would be a
 * side effect of asking for a file.
 */
export const restorePlan = (state: Collecting | Failed): Restore => state.restore;
