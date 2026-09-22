/**
 * The two Web API reads grouping needs: the view's own FetchXML, and the
 * aggregate.
 *
 * Ported from `pcf-chart-view/ChartView/data/ChartData.ts`. Both go through
 * `context.webAPI` rather than a same-origin `fetch`, which is what keeps this
 * inside the `WebAPI` feature the manifest already declares — **0.6.0 adds no
 * install-time permission prompt**, and that is worth a release-notes line.
 *
 * Only the parent-candidate metadata read cannot go this way, because
 * `context.webAPI` cannot address `EntityDefinitions`; that stays a
 * same-origin fetch in `index.ts`, on the route this control already opened
 * for a lookup's bind key.
 */

import { AliasPlan, GroupSpec } from '../group/types';
import { aggregateFetchXml, isRenderableMessage, queryString } from '../query/fetchXml';
import { AggregateRow } from '../query/rows';

/** The slice of `context.webAPI` this file uses. */
export interface WebApiReader {
    retrieveRecord(entity: string, id: string, options?: string): Promise<{ [key: string]: unknown }>;
    retrieveMultipleRecords(entity: string, options?: string): Promise<{ entities?: unknown[] }>;
}

/** A refusal, already turned into something a maker can read. */
export interface Refusal {
    message: string;
    /** Whether `message` is fit to show. See `isRenderableMessage`. */
    renderable: boolean;
    raw: unknown;
}

/**
 * A server fault as one sentence.
 *
 * **Neither source of a message can be trusted alone**, which is the finding
 * that shaped this. Measured 2026-09-20, twice, in opposite directions: the
 * primary-key refusal arrived here perfectly worded while the platform's own
 * console log scrubbed it to `Aggregate _scrubbedSensitiveData_`; the
 * multi-select refusal arrived here as a message *template* with an
 * unsubstituted `{0}` while the platform's log named the attribute and the
 * exact XML.
 *
 * So there is no rule of the form "prefer the rejection". All this can do is
 * extract the best sentence available and say whether it is fit to show —
 * and the control refuses locally, before sending, anything whose refusal it
 * knows to be unreadable.
 */
export function messageOf(error: unknown): string {
    const fault = error as { message?: unknown; title?: unknown } | null;

    if (fault && typeof fault.message === 'string' && fault.message !== '') {
        // A payload fault buries the sentence after the second `InnerException :`.
        const inner = fault.message.split('InnerException :').pop() ?? fault.message;

        return inner.split(/\r?\n/)[0].trim();
    }

    return fault && typeof fault.title === 'string' ? fault.title : String(error);
}

export const refusalOf = (error: unknown): Refusal => {
    const message = messageOf(error);

    return { message, renderable: isRenderableMessage(message), raw: error };
};

/**
 * One view definition per id for the life of the page. **A miss is cached
 * too**: a view that is not there stays not there, and re-asking costs a
 * round trip and — measured — a red 404 in the console every time.
 */
const viewCache = new Map<string, Promise<string | null>>();

/**
 * The view's FetchXML, from `savedquery` then `userquery`.
 *
 * `null` when neither answers — an unknown id, a personal view the user
 * cannot read, a `getViewId()` that lied. **That is a degraded query, not an
 * error**: the caller decides whether the runtime filter is enough to stand
 * in for what the view meant.
 *
 * **The fallback is not free, and the cost is visible to the user.** Measured
 * 2026-09-20: a `retrieveRecord` for a row that is not there logs a red 404
 * from inside the platform's own OData layer, *above* any `catch` here. So a
 * **system** view costs nothing, and a **personal** view costs exactly one
 * logged 404 per page load on a form that is working correctly. There is no
 * way to suppress it from here; `docs/limitations.md` says so instead.
 */
export function readViewFetchXml(api: WebApiReader, viewId: string): Promise<string | null> {
    if (viewId === '') {
        return Promise.resolve(null);
    }

    const cached = viewCache.get(viewId);

    if (cached) {
        return cached;
    }

    const read = (table: string): Promise<string | null> =>
        api.retrieveRecord(table, viewId, '?$select=fetchxml').then((row) => {
            const xml = row && row.fetchxml;

            return typeof xml === 'string' && xml.indexOf('<fetch') !== -1 ? xml : null;
        });

    const promise = read('savedquery')
        .catch(() => read('userquery'))
        .catch(() => null);

    viewCache.set(viewId, promise);

    return promise;
}

/** For the suite: forget every cached view. */
export const resetViewCache = (): void => viewCache.clear();

export interface AggregateRequest {
    spec: GroupSpec;
    plan: AliasPlan;
    viewXml: string | null;
    filterXml: string;
}

/** The query text a request sends — exported so the suite can assert it exactly. */
export const requestXml = (request: AggregateRequest): string =>
    aggregateFetchXml(request.spec, request.plan, request.viewXml, request.filterXml);

/**
 * The aggregate, as raw rows.
 *
 * A rejection becomes a `Refusal` and is re-thrown; the caller catches it and
 * falls back to the browser route with a caption that says so. **A refusal is
 * whole-query** — measured: one unusable measure cost the group counts too —
 * which is why `parseAggregates` refuses what it cannot spell rather than
 * sending it and hoping.
 */
export function loadAggregate(api: WebApiReader, request: AggregateRequest): Promise<AggregateRow[]> {
    const xml = requestXml(request);

    return api.retrieveMultipleRecords(request.spec.entity, queryString(xml)).then(
        (result) => {
            const entities = result && result.entities;

            return Array.isArray(entities) ? (entities as AggregateRow[]) : [];
        },
        (error: unknown) => {
            throw refusalOf(error);
        },
    );
}
