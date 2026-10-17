/*
 * _template/variants/lib/config-source — a maker's configuration, inline or
 * from a web resource
 *
 * SHARED. Copied into a control as <Control>/lib/config-source/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-10-17 from pcf-row-commands' configLoader.ts (0.3.0, which
 * measured the route from a dataset control) and generalised to any text.
 */

/**
 * Where a property longer than a name comes from, and every way that can fail,
 * named. A decision module: `fetch` is handed in, so a suite drives each state.
 *
 * The property holds either the configuration itself — the caller says what it
 * starts with (`{` for JSON, `<` for FetchXML) — or **the name of a web
 * resource holding it**. Both, because each host refuses one:
 *
 *   - **A model-driven form refuses a static value over 100 characters**
 *     (measured, pcf-code-editor 2026-09-23). A web resource has no such
 *     ceiling, and a field or dataset control reads one the same way —
 *     same-origin, no `<uses-feature>` (pcf-code-editor; pcf-row-commands on a
 *     subgrid and a main grid, 2026-10-08).
 *   - **A canvas app has no organisation to fetch from**, and a formula has no
 *     ceiling, so there the property carries the text itself.
 *
 * What a fetch answers, measured: **200** with the body as uploaded — a Script
 * resource as `text/jscript` (row-commands), a **Data (XML)** one as
 * `text/xml` (pcf-data-table 0.7.3, P10) — **404 with an empty body** for a
 * name that is not there, so the status is all there is to go on, and
 * `cache-control: private` both ways: so every load revalidates with
 * `cache: "no-cache"`, and a new publish reaches the next form load. An edit
 * reaches nobody until it is published.
 *
 * **Inline text is answered at once**, with no promise to wait on —
 * `classifySource` — because a caller may need it before the first render: a
 * dataset control that links rows in `init` draws no unfiltered rows, and one
 * that waits a tick draws the whole view first (pcf-data-table P7).
 */

export type SourceKind =
    | { kind: 'none' }
    | { kind: 'inline'; text: string }
    | { kind: 'named'; name: string };

export type SourceLoad =
    | { state: 'none' }
    | { state: 'ready'; text: string; from: 'inline' | 'webresource'; name?: string }
    | { state: 'notFound'; name: string }
    | { state: 'denied'; name: string; status: number }
    | { state: 'failed'; name: string; status: number }
    | { state: 'offline'; name: string }
    | { state: 'noHost'; name: string };

export type SourceFetch = (url: string, init: { credentials: 'same-origin'; cache: 'no-cache' }) => Promise<{
    status: number;
    ok: boolean;
    text(): Promise<string>;
}>;

/** The address of a web resource, from the organisation's URL. */
export function webResourceUrl(name: string, clientUrl: string): string {
    const base = clientUrl.replace(/\/+$/, '');
    const path = name.split('/').map(encodeURIComponent).join('/');

    return `${base}/WebResources/${path}`;
}

/** What the property holds, decided without a round trip. */
export function classifySource(raw: unknown, isInline: (text: string) => boolean): SourceKind {
    const text = typeof raw === 'string' ? raw.trim() : '';

    if (text === '') {
        return { kind: 'none' };
    }

    return isInline(text) ? { kind: 'inline', text } : { kind: 'named', name: text };
}

/**
 * Read the property, and the web resource it names if it names one. **Never
 * rejects**: a configuration that cannot be had is a state the caller says out
 * loud.
 *
 * `clientUrl` is `null` on a host with no organisation — canvas — where a name
 * cannot be fetched and says so rather than trying a relative path.
 */
export async function loadSource(
    raw: unknown,
    isInline: (text: string) => boolean,
    clientUrl: string | null,
    fetchFn: SourceFetch | undefined,
): Promise<SourceLoad> {
    const source = classifySource(raw, isInline);

    if (source.kind === 'none') {
        return { state: 'none' };
    }

    if (source.kind === 'inline') {
        return { state: 'ready', text: source.text, from: 'inline' };
    }

    const { name } = source;

    if (!clientUrl || typeof fetchFn !== 'function') {
        return { state: 'noHost', name };
    }

    let response: Awaited<ReturnType<SourceFetch>>;

    try {
        response = await fetchFn(webResourceUrl(name, clientUrl), { credentials: 'same-origin', cache: 'no-cache' });
    } catch {
        // A rejected fetch is the network: offline, or the request blocked.
        return { state: 'offline', name };
    }

    if (response.status === 404) {
        return { state: 'notFound', name };
    }

    if (response.status === 401 || response.status === 403) {
        return { state: 'denied', name, status: response.status };
    }

    if (!response.ok) {
        return { state: 'failed', name, status: response.status };
    }

    try {
        return { state: 'ready', text: await response.text(), from: 'webresource', name };
    } catch {
        return { state: 'offline', name };
    }
}
