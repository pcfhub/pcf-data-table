/**
 * Which name in a *Related through* fragment the platform refused — because
 * it will not say.
 *
 * **Measured 2026-10-17 (SPEC.md 0.8.0, P11):** a link naming a column the
 * table does not have is refused as *0x80041103 Query Builder Error*, the rows
 * are cleared, and nothing names the column. So after a refusal this asks the
 * table definitions, one name at a time, in the order the fragment uses them,
 * and answers the first that is not there.
 *
 * **What the definitions answer, measured the same day** on the test
 * environment, same-origin as every other metadata read here:
 *
 *   - `EntityDefinitions(LogicalName='t')/Attributes(LogicalName='c')` —
 *     **200** for a column that exists;
 *   - **404** `0x80060888` *"Navigation property Attributes With Id =
 *     LogicalName='c' does not exist on Metadata Entity …"* for one that does
 *     not;
 *   - **404** `0x80060888` *"Entity With Id = LogicalName='t' does not
 *     exist."* when the table itself is not there.
 *
 * So one request per name tells a missing table from a missing column. Pure:
 * `fetch` is handed in, so the suite drives each answer.
 */

import { RelatedName } from '../lib/related-rows/fragment';

export type NamesFetch = (url: string, init: { credentials: 'same-origin'; headers: Record<string, string> }) => Promise<{
    status: number;
    text(): Promise<string>;
}>;

/** The first name that is not there: a table (`column: null`) or a column of one. `null` when every name is, or nothing could be asked. */
export interface MissingName {
    table: string;
    column: string | null;
}

export async function findMissingName(
    clientUrl: string,
    names: RelatedName[],
    fetchFn: NamesFetch,
): Promise<MissingName | null> {
    const base = clientUrl.replace(/\/+$/, '');
    const asked = new Set<string>();

    for (const name of names) {
        const key = `${name.table}.${name.column}`;

        if (asked.has(key)) {
            continue;
        }

        asked.add(key);

        let status: number;
        let body = '';

        try {
            const response = await fetchFn(
                `${base}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(name.table)}')`
                    + `/Attributes(LogicalName='${encodeURIComponent(name.column)}')?$select=LogicalName`,
                { credentials: 'same-origin', headers: { Accept: 'application/json' } },
            );

            status = response.status;
            body = status === 404 ? await response.text() : '';
        } catch {
            // The network, not the name: nothing more can be said.
            return null;
        }

        if (status === 404) {
            return /Entity With Id/i.test(body) && !/Navigation property/i.test(body)
                ? { table: name.table, column: null }
                : { table: name.table, column: name.column };
        }

        if (status < 200 || status >= 300) {
            // Refused for some other reason (privilege, throttling): say nothing rather than guess.
            return null;
        }
    }

    return null;
}
