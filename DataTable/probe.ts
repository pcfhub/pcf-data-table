/**
 * **TEMPORARY. Delete this file, its two lines in `index.ts`, and the WebAPI
 * feature it made the manifest declare, before 0.5.0 is built.** It ships no
 * behaviour. It exists to answer the questions under *0.5.0 → What must be
 * measured first* in `SPEC.md`, none of which anything below a real Dataverse
 * form can answer.
 *
 * The feature it is measuring for: editing a Lookup cell. 0.4.0 measured that
 * the platform's own dialog works (`utils.lookupObjects` — pick is a
 * `LookupValue[]` with a braced upper-case GUID, cancel is `[]`) and that
 * `record.setValue()` on a Lookup column stages nothing, five shapes tried. So
 * the write has to be `webAPI.updateRecord` with an `@odata.bind` key — which
 * this repository has never called, and which rests on three things nothing
 * here has watched:
 *
 *   - the **key**: the navigation property name, which is *not* the column's
 *     logical name — it is schema-cased (`cll_PrimaryContact`) for a simple
 *     lookup, and for a Customer lookup there are two of them, one per target
 *     (`cll_customer_account`, `cll_customer_contact`);
 *   - the **value**: `/<entity set name>(<guid>)`, the target table's plural,
 *     which `pcf-tag-list` reads off `getEntityMetadata(...).EntitySetName`;
 *   - the **clear**: the Web API disassociates through a DELETE on `$ref`, and
 *     `context.webAPI` has no such method — whether `updateRecord` with `null`
 *     is accepted decides whether the editor can offer a clear at all.
 *
 * Passive half: one `console.log` per control instance of what the host
 * offers. Active half: `window.__pcfDataTableProbe`, a bag of small calls the
 * person at the keyboard invokes on a record and a column *they* pick — this
 * file never writes to anybody's data on load.
 */

import { IInputs } from './generated/ManifestTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

let reported = false;

/**
 * 0.4.3: the context of the *latest* `updateView`, not the first. 0.4.2 parked
 * the first pass's dataset and read `records[id]` off it after a `refresh()`;
 * it never changed, and the probe could not say whether the subgrid had not
 * re-read or the parked object was a dead snapshot. Both are now visible.
 */
let latest: ComponentFramework.Context<IInputs> | undefined;
let passes = 0;

const TAG = '[pcf-data-table probe 0.4.3]';

/** Braced upper-case (dialog, openForm) → unbraced lower-case (getValue, Web API URLs). */
const bareGuid = (id: string): string => id.replace(/[{}]/g, '').toLowerCase();

/** One line per settled promise, with the shape and the time, whichever way it went. */
async function timed<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
    const started = Date.now();
    try {
        const result = await run();
        console.log(TAG, label, 'RESOLVED in', Date.now() - started, 'ms →', result);
        return result;
    } catch (error) {
        const shape = error && typeof error === 'object' ? Object.keys(error as object) : typeof error;
        console.log(TAG, label, 'REJECTED in', Date.now() - started, 'ms →', error, 'keys:', shape);
        return undefined;
    }
}

/**
 * The org URL for a same-origin metadata read. `page.getClientUrl` is not in
 * the typings; the `Xrm` global is the fallback `pcf-grid-data-bars` uses.
 */
function clientUrl(context: any): string {
    return (
        context.page?.getClientUrl?.() ??
        (globalThis as any).Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.() ??
        ''
    );
}

export function probe(context: ComponentFramework.Context<IInputs>): void {
    latest = context;
    passes += 1;

    if (reported) {
        return;
    }

    const dataset = context.parameters.records;
    const firstId = (dataset.sortedRecordIds ?? [])[0];
    const record = firstId ? dataset.records[firstId] : undefined;

    // `updateView` runs before the first fetch lands; reporting from that pass
    // measures the wrong moment.
    if (!record) {
        return;
    }

    reported = true;

    const ctx = context as any;
    const entity = dataset.getTargetEntityType();
    const lookups = (dataset.columns ?? [])
        .filter((column) => column.dataType.startsWith('Lookup'))
        .map((column) => ({ name: column.name, dataType: column.dataType }));

    // ---- Q1: what the host offers -------------------------------------------
    console.log(TAG, 'host', {
        webAPI: typeof ctx.webAPI,
        updateRecord: typeof ctx.webAPI?.updateRecord,
        retrieveRecord: typeof ctx.webAPI?.retrieveRecord,
        getEntityMetadata: typeof ctx.utils?.getEntityMetadata,
        lookupObjects: typeof ctx.utils?.lookupObjects,
        pageGetClientUrl: typeof ctx.page?.getClientUrl,
        xrmGlobal: typeof (globalThis as any).Xrm,
        clientUrl: clientUrl(ctx),
        entity,
        entitySetGuess: `${entity}s`,
        contextInfo: ctx.mode?.contextInfo,
        lookupColumnsInView: lookups,
        firstRecordId: record.getRecordId(),
        firstRecordLookups: Object.fromEntries(
            lookups.map((column) => [column.name, record.getValue(column.name)]),
        ),
    });

    const api = {
        context,
        dataset,
        record,
        entity,

        /** Q3: what the metadata node says about a lookup column — SchemaName? Targets? anything naming the navigation property? */
        node: (column: string) =>
            timed(`getEntityMetadata(${entity}, [${column}])`, async () => {
                const metadata = await ctx.utils.getEntityMetadata(entity, [column]);
                const node = metadata?.Attributes?.get?.(column);
                return {
                    EntitySetName: metadata?.EntitySetName,
                    nodeKeys: node ? Object.keys(node) : node,
                    SchemaName: node?.SchemaName,
                    Targets: node?.Targets,
                    descriptorKeys: node?.attributeDescriptor ? Object.keys(node.attributeDescriptor) : undefined,
                    descriptorSchemaName: node?.attributeDescriptor?.SchemaName,
                    descriptorTargets: node?.attributeDescriptor?.Targets,
                };
            }),

        /** Q4: the target table's entity set name — the plural the bind value needs. */
        setName: (table: string) =>
            timed(`getEntityMetadata(${table}).EntitySetName`, async () => {
                const metadata = await ctx.utils.getEntityMetadata(table);
                return { EntitySetName: metadata?.EntitySetName, PrimaryNameAttribute: metadata?.PrimaryNameAttribute };
            }),

        /**
         * Q3, the authoritative route: every many-to-one on this table with the
         * navigation property name the bind key has to use. Same-origin fetch,
         * because `context.webAPI` cannot address `EntityDefinitions`.
         */
        navProps: () =>
            timed('ManyToOneRelationships', async () => {
                const url =
                    `${clientUrl(ctx)}/api/data/v9.2/EntityDefinitions(LogicalName='${entity}')` +
                    `/ManyToOneRelationships?$select=ReferencingAttribute,ReferencedEntity,` +
                    `ReferencingEntityNavigationPropertyName,ReferencedEntityNavigationPropertyName`;
                const response = await fetch(url, {
                    headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
                    credentials: 'same-origin',
                });
                const body = await response.json();
                const rows = (body.value ?? [])
                    .filter((row: any) => lookups.some((column) => column.name === row.ReferencingAttribute))
                    .map((row: any) => ({
                        column: row.ReferencingAttribute,
                        target: row.ReferencedEntity,
                        navProp: row.ReferencingEntityNavigationPropertyName,
                    }));
                console.table(rows);
                return { status: response.status, rows };
            }),

        /**
         * Q2 / Q5: the write. `key` is passed raw so the same call can try the
         * logical name and the schema-cased navigation property. `setName` is
         * the target's entity set (from `setName()` above).
         */
        bind: (recordId: string, key: string, setName: string, guid: string) =>
            timed(`updateRecord ${key}@odata.bind = /${setName}(${bareGuid(guid)})`, () =>
                ctx.webAPI.updateRecord(entity, bareGuid(recordId), {
                    [`${key}@odata.bind`]: `/${setName}(${bareGuid(guid)})`,
                }),
            ),

        /** Q6a: does `updateRecord` accept `null` on a bind key as a clear? */
        clearViaBind: (recordId: string, key: string) =>
            timed(`updateRecord ${key}@odata.bind = null`, () =>
                ctx.webAPI.updateRecord(entity, bareGuid(recordId), { [`${key}@odata.bind`]: null }),
            ),

        /** Q6b: the Web API's own disassociate — a DELETE on `$ref`, outside `context.webAPI`. */
        clearViaRef: (recordId: string, entitySet: string, navProp: string) =>
            timed(`DELETE ${entitySet}(${bareGuid(recordId)})/${navProp}/$ref`, async () => {
                const response = await fetch(
                    `${clientUrl(ctx)}/api/data/v9.2/${entitySet}(${bareGuid(recordId)})/${navProp}/$ref`,
                    {
                        method: 'DELETE',
                        headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
                        credentials: 'same-origin',
                    },
                );
                return { status: response.status, body: response.status === 204 ? '' : await response.text() };
            }),

        /** Q7: the truth, read back through the Web API — `_x_value` plus its formatted and logical-name annotations. */
        readBack: (recordId: string, column: string) =>
            timed(`retrieveRecord _${column}_value`, async () => {
                const row = await ctx.webAPI.retrieveRecord(entity, bareGuid(recordId), `?$select=_${column}_value`);
                return Object.fromEntries(Object.entries(row).filter(([name]) => name.includes(column)));
            }),

        /**
         * Q8: what the dataset record says now, then after a `refresh()`,
         * read from the *latest* context each second for 30 s — and whether
         * that is even the same object as the one parked on the first pass.
         */
        after: async (recordId: string, column: string) => {
            const id = bareGuid(recordId);
            const read = (label: string) => {
                const live = latest?.parameters.records;
                const parked = dataset.records[id]?.getValue(column);
                const fresh = live?.records[id]?.getValue(column);
                console.log(TAG, label, {
                    passes,
                    sameDatasetObject: live === dataset,
                    sameRecordsObject: live?.records === dataset.records,
                    parked,
                    latest: fresh,
                    loading: live?.loading,
                });
                return fresh;
            };
            const before = read('before refresh');
            const started = Date.now();
            latest?.parameters.records.refresh();
            for (let second = 1; second <= 30; second += 1) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const now = read(`t+${second}s`);
                if (JSON.stringify(now) !== JSON.stringify(before) && !latest?.parameters.records.loading) {
                    console.log(TAG, 'latest context changed after', Date.now() - started, 'ms');
                    return;
                }
            }
            console.log(TAG, 'no change in the latest context after 30 s');
        },

        /** Q9: the dialog for a Customer lookup — both targets at once. */
        pick: (targets: string[]) =>
            timed(`lookupObjects(${targets.join('|')})`, () =>
                ctx.utils.lookupObjects({ entityTypes: targets, allowMultiSelect: false }),
            ),
    };

    (window as any).__pcfDataTableProbe = api;

    console.log(
        TAG,
        'window.__pcfDataTableProbe is parked. 0.4.3 asks Q8 again with the live context:\n' +
            '  const p = window.__pcfDataTableProbe;\n' +
            "  const REC = '990d527b-45ae-f111-aaac-6045bd06056e';\n" +
            "  const [c] = await p.pick(['contact']);            // pick a DIFFERENT contact from the one shown\n" +
            "  await p.bind(REC, 'cll_primarycontact', 'contacts', c.id);\n" +
            "  await p.after(REC, 'cll_primarycontact');         // polls the latest context for 30 s\n" +
            'Paste every line this prints back.',
    );
}
