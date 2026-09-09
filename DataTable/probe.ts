/**
 * **TEMPORARY. Delete this file, and its two lines in `index.ts`, before 0.3.0
 * is released.** It exists to answer one question that nothing below a real
 * Dataverse form can answer, and it ships no behaviour.
 *
 * The question: **does a dataset record support being written to?**
 *
 * `EntityRecord` in `@types/powerapps-component-framework@1.3.18`
 * (`componentframework.d.ts:2675`) declares exactly four methods —
 * `getFormattedValue`, `getRecordId`, `getValue`, `getNamedReference`.
 * `setValue`, `save`, `isDirty` and `getColumnInfo` are all documented on
 * Microsoft Learn and none of them is in the typings, and neither is
 * `DataSet.newRecord`. That is the inverse of the `fluentDesignLanguage`
 * finding in SPEC.md, where the types turned out to be *ahead* of the comment
 * claiming they lagged.
 *
 * Nothing in this catalogue has ever written through a dataset record.
 * `pcf-kanban-board` writes with `webAPI.updateRecord`, which costs an
 * install-time permission prompt and does nothing at all in a canvas app. If
 * `setValue`/`save` are really there, inline editing costs neither — which is
 * the entire argument for building it this way, and it rests on an API that
 * this repository has never seen answer.
 *
 * So: measure first. The dev rig cannot settle it, because the rig is a model
 * of the platform written from its documentation — it would report whatever we
 * chose to write into it.
 */

import { IInputs } from './generated/ManifestTypes';

/** Log once per control instance rather than once per `updateView`. */
let reported = false;

/**
 * Print the live shape of a dataset record, and park the dataset on `window`
 * so a write can be tried by hand.
 *
 * Deliberately one `console.log` of one object: it collapses in the browser's
 * console into a single expandable line that copies and pastes whole, which is
 * what makes a console measurement something a person will actually send back.
 */
export function probe(context: ComponentFramework.Context<IInputs>): void {
    if (reported) {
        return;
    }

    const dataset = context.parameters.records;
    const firstId = (dataset.sortedRecordIds ?? [])[0];
    const record = firstId ? dataset.records[firstId] : undefined;

    // Nothing has arrived yet. `updateView` runs before the first fetch lands,
    // and reporting "no methods" from that pass would be a measurement of the
    // wrong moment — the exact mistake that makes a probe worse than none.
    if (!record) {
        return;
    }

    reported = true;

    const shapeOf = (value: object): string[] =>
        [
            ...Object.keys(value),
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(value) ?? {}),
        ].filter((name) => name !== 'constructor');

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const asAny = record as any;
    const datasetAny = dataset as any;

    console.log('[pcf-data-table probe]', {
        recordShape: shapeOf(record),
        setValue: typeof asAny.setValue,
        save: typeof asAny.save,
        isDirty: typeof asAny.isDirty,
        getColumnInfo: typeof asAny.getColumnInfo,

        datasetShape: shapeOf(dataset),
        newRecord: typeof datasetAny.newRecord,
        deleteRecord: typeof datasetAny.delete,
        getDataSetCapabilities: typeof datasetAny.getDataSetCapabilities,

        // The pinning clamp reads this, and a main grid is documented to answer
        // the width and leave the height at -1 forever. Worth confirming on the
        // same trip rather than on a second one.
        allocatedWidth: context.mode.allocatedWidth,
        allocatedHeight: context.mode.allocatedHeight,

        targetEntityType: dataset.getTargetEntityType(),

        /*
         * **Round two: the per-column methods nobody documented.**
         *
         * Round one came back with a record carrying `isEditable`, `isSecured`,
         * `isReadable`, `getFieldRequiredLevel`, `isValid`, `getValidationError`
         * and `getCurrencyDecimalPrecision` — none of them in the typings, none
         * of them on Microsoft Learn, and every one of them the answer to a
         * question this control had already decided it could not ask.
         *
         * The editing design was going to offer an editor on every column of a
         * writable type and let the server refuse the ones the user cannot
         * write, because column-level security is invisible on `Column`. If
         * `isEditable(name)` answers, that whole compromise goes away.
         *
         * So: call each one against each column and report what comes back,
         * including the throw. A method whose *signature* is a guess is not a
         * measurement — `undefined` from a wrong argument list looks exactly
         * like `false`.
         */
        columns: (dataset.columns ?? []).map((column) => {
            const ask = (method: string): unknown => {
                try {
                    return typeof asAny[method] === 'function'
                        ? asAny[method](column.name)
                        : `no such method (${typeof asAny[method]})`;
                } catch (error) {
                    return `threw: ${(error as Error).message}`;
                }
            };

            return {
                name: column.name,
                dataType: column.dataType,
                visualSizeFactor: column.visualSizeFactor,
                isEditable: ask('isEditable'),
                isSecured: ask('isSecured'),
                isReadable: ask('isReadable'),
                requiredLevel: ask('getFieldRequiredLevel'),
                isValid: ask('isValid'),
                validationError: ask('getValidationError'),
                currencyPrecision: ask('getCurrencyDecimalPrecision'),
            };
        }),
    });

    /*
     * Parked so the write itself can be tried by hand, on a column and a record
     * the person at the keyboard picks — rather than this file guessing at one
     * and writing to somebody's live data on load.
     *
     *   const { record } = window.__pcfDataTableProbe;
     *   await record.setValue('name', 'probe');
     *   await record.save();
     *
     * What to report back: whether each call resolves, whether the row on
     * screen changes, whether the value survives a browser refresh, and what a
     * write to a column you cannot edit rejects with.
     */
    (window as any).__pcfDataTableProbe = { record, dataset, context };
    /* eslint-enable @typescript-eslint/no-explicit-any */
}
