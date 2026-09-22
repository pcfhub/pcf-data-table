/**
 * Which lookup on this table points at the record the subgrid sits on.
 *
 * Ported near-verbatim from `pcf-chart-view/ChartView/data/parent.ts`. The
 * four-step resolver and the three-valued `rowsConfirm` are not rewritten,
 * because they are measured, and this repository has now measured them again:
 *
 * **`filtering.getFilter()` returns `null` on a subgrid whether or not it is
 * set to "Show related records only"** (2026-09-20). That is a stronger claim
 * than the one inherited — chart-view's note reads as though an *unrelated*
 * subgrid were the special case, and both cases look identical from inside the
 * control. There is no configuration a maker can change that would let the
 * control see the relationship. Only the rows can tell them apart, which is
 * what step 3 is for.
 *
 * **And the consequence has numbers.** On the probe subgrid an aggregate built
 * from the view alone counted **56** while the grid held **38**; the condition
 * `cll_customer = <the form's account>` reproduced 38 exactly. A grouped
 * subgrid without this resolver prints the wrong number directly above the
 * rows that contradict it — which is why an unresolved parent **withholds the
 * server route** rather than approximating it.
 *
 * Pure: no `context`, no dataset. Everything it needs is handed in.
 */

import { isLogicalName } from '../query/fetchXml';

/** The record a form subgrid sits on, from `mode.contextInfo`. */
export interface FormRecord {
    entityType: string;
    id: string;
}

/** What the entry point hands over so the column can be resolved. */
export interface ParentReading {
    record: FormRecord;
    /** `parentLookup` as the maker typed it, lower-cased, or `null`. */
    explicit: string | null;
    /** The lookups on this table whose target is the form's table, or a rejection. */
    candidates: () => Promise<string[]>;
    /**
     * Whether every loaded row has this column pointing at the form's record:
     * `true`, `false`, or **`null` when the column is not in the dataset** or
     * there are no rows to ask.
     */
    confirmed: (column: string) => boolean | null;
}

export interface ParentResolution {
    /** The column, or `null` when nothing settles it — or when the subgrid is unrelated. */
    column: string | null;
    by: 'explicit' | 'only-candidate' | 'rows' | 'unrelated' | 'unresolved' | 'no-candidates';
    candidates: string[];
}

/**
 * The four steps, as one promise that never rejects.
 *
 * Measured on the probe table: exactly one candidate (`cll_customer`), so
 * step 2 settles it and the condition reproduces the platform's own count.
 * **The ambiguous case — two lookups to the same table — has no data behind
 * it here**, so steps 3 and 4 are written against a measured mechanism and an
 * unexercised branch. SPEC.md says so under *Not verified*.
 */
export async function resolveParentLookup(parent: ParentReading): Promise<ParentResolution> {
    if (parent.explicit === 'none') {
        // The maker says so: this subgrid is not related to the record.
        return { column: null, by: 'unrelated', candidates: [] };
    }

    if (parent.explicit !== null) {
        return { column: parent.explicit, by: 'explicit', candidates: [] };
    }

    let candidates: string[] = [];

    try {
        candidates = (await parent.candidates())
            .filter((name, index, all) => isLogicalName(name) && all.indexOf(name) === index);
    } catch {
        candidates = [];
    }

    if (candidates.length === 0) {
        return { column: null, by: 'no-candidates', candidates };
    }

    const verdicts = candidates.map((column) => ({ column, rows: parent.confirmed(column) }));
    const confirmed = verdicts.filter((verdict) => verdict.rows === true);
    const open = verdicts.filter((verdict) => verdict.rows !== false);

    if (confirmed.length === 1) {
        return { column: confirmed[0].column, by: 'rows', candidates };
    }

    /*
     * Every lookup to the parent's table is carried by the rows and none of
     * them points at the record — so this is not a related subgrid, and the
     * right answer is **no condition at all** rather than a wrong one.
     *
     * Measured 2026-09-20, before the subgrid was switched to related-records
     * only: the table held 56 rows, the subgrid reported 56, and a parent
     * condition would have narrowed a view that was never narrowed. This is
     * the branch that case exercises, and it is the one a resolver assuming
     * every subgrid is related gets wrong.
     */
    if (open.length === 0) {
        return { column: null, by: 'unrelated', candidates };
    }

    if (open.length === 1 && candidates.length === 1) {
        return { column: open[0].column, by: 'only-candidate', candidates };
    }

    return { column: null, by: 'unresolved', candidates };
}

/**
 * Whether an unsettled parent means **withhold the server route** or **send no
 * condition**.
 *
 * Both answers arrive as `column: null`, so this reads `by` and nothing else —
 * and the two are one word apart in a condition that decides whether the
 * control declines or reports a number larger than the grid beneath it.
 * Extracted from `loadGroups` purely so it can be asserted, because it was
 * previously reachable only through a call that needs a `webAPI`.
 *
 * **Measured 2026-09-20 on `cll_sitevisit`**, with `cll_site` pulled out of the
 * view so neither candidate was loaded:
 *
 * ```
 * fixed  regardingobjectid null, cll_site null  -> unresolved -> withheld
 * old    regardingobjectid false, cll_site false -> unrelated  -> whole table
 * ```
 *
 * Same configuration, same `column: null`, opposite behaviour. `unrelated` is
 * a *positive* finding — the rows were asked and said this grid is not
 * narrowed to the record — so no condition is the right answer. `unresolved`
 * is an absence of knowledge, and guessing between two lookups is exactly what
 * produces a confidently wrong count.
 */
export const withholdsRoute = (resolution: ParentResolution): boolean =>
    resolution.column === null && resolution.by !== 'unrelated';

/** A GUID without braces, lower-cased, or `''`. */
export const bareId = (value: unknown): string =>
    typeof value === 'string' ? value.replace(/[{}]/g, '').toLowerCase() : '';

/**
 * The rows' answer for one column: whether every loaded record's lookup is the
 * form's record.
 *
 * **Three-valued on purpose, and `fetched` is what makes the middle value
 * reachable.** `null` means *the rows cannot speak*, which is not the same as
 * `false` — a row pointing somewhere else drops the candidate, while a column
 * the dataset never loaded says nothing about it either way.
 *
 * The first version asked `getValue` for that distinction and was wrong.
 * **Measured 2026-09-20 on `cll_sitevisit`:** `getValue` answers `null` for a
 * column absent from the view's layout, `null` for a column that does not
 * exist on the table at all, and `null` for one that is genuinely empty. There
 * is no `undefined` — so the branch testing for it was dead code, and every
 * unfetched candidate was being **denied** rather than left open.
 *
 * That failed in the dangerous direction. `regardingobjectid` was not in the
 * layout and read `null`, so it was denied — while the server confirmed every
 * row pointed at the form's account through it. Invert the case and the
 * *correct* lookup is the one missing from the layout: every candidate gets
 * denied, the resolver answers `unrelated`, no condition is added, and the
 * aggregate counts the whole table. The wrong number, reached through the
 * branch meant to be safe.
 *
 * So the question "was this column loaded" is asked of `dataset.columns`,
 * which is the only thing that knows, and `getValue` is asked only about
 * columns that were.
 *
 * `getValue` on a lookup is an `EntityReference`: measured as
 * `{ etn, id: { guid }, name }` — **the GUID is nested at `.id.guid`**, so
 * comparing `getValue()` against an id directly fails on every row.
 */
export function rowsConfirm(
    records: { getValue(name: string): unknown }[],
    column: string,
    id: string,
    fetched: string[],
): boolean | null {
    // Not loaded, so the rows have nothing to say about it.
    if (fetched.indexOf(column) === -1) {
        return null;
    }

    if (records.length === 0) {
        return null;
    }

    const wanted = bareId(id);
    let seen = 0;

    for (const record of records) {
        let raw: unknown;

        try {
            raw = record.getValue(column);
        } catch {
            return null;
        }

        // The column *is* loaded, so an empty value is a real answer: this row
        // does not point at the form's record.
        if (raw === null || raw === undefined) {
            return false;
        }

        const reference = raw as { id?: { guid?: string } | string };
        const candidate = typeof reference === 'object' && reference !== null
            ? (typeof reference.id === 'object' && reference.id !== null ? reference.id.guid : reference.id)
            : raw;

        if (bareId(candidate) !== wanted) {
            return false;
        }

        seen += 1;
    }

    return seen > 0 ? true : null;
}
