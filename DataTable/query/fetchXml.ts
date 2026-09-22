/**
 * The aggregate query, as a string. Pure: nothing here touches `context`, so
 * the smoke suite drives every function directly and asserts the exact text a
 * server would receive.
 *
 * Ported from `pcf-chart-view/ChartView/query/fetchXml.ts` and generalised
 * from one group column and one measure to N and M. The operator table and the
 * `translatable` rule are that file's, unchanged — they are a table of measured
 * enum numbers and not worth rediscovering.
 *
 * **The shape of the idea: the view already knows which records it means.**
 * Its `<filter>`s and `<link-entity>`s say so, and the dataset knows what the
 * user has narrowed it to since. So the query is the view's own FetchXML with
 * every `<attribute>` and `<order>` taken out, the group and measure
 * attributes put in, the runtime filter appended, and `aggregate='true'` on
 * the root. Rewriting the view rather than composing a fresh query is what
 * keeps a link-entity filter honoured without this control understanding it.
 *
 * Three things measured on a real subgrid, 2026-09-20 (SPEC.md 0.6.0), which
 * this file is built around rather than defended against:
 *
 * - **`<order>` and `<filter>` sit *between* `<attribute>` elements**, not
 *   after them — the view designer emits them where the maker put them. There
 *   is no positional structure, which is why `stripView` uses global regexes
 *   and why "everything after the last attribute" would silently drop most of
 *   a view.
 * - **The view's own `<filter>` rides along inside `<entity>`**, so the
 *   runtime filter lands as a *second sibling* `<filter>`. FetchXML ANDs
 *   siblings, which is the wanted answer — but the generated query has two
 *   filter elements, not one merged, and a reader should expect that.
 * - **Two `groupby` attributes are accepted**, and every alias comes back with
 *   its own `FormattedValue` and `AttributeName`. Nothing about N is special.
 */

import { AliasPlan, GroupSpec } from '../group/types';

/** A Dataverse logical name: lower-case, starts with a letter, `[a-z0-9_]`. */
export const isLogicalName = (value: string): boolean => /^[a-z][a-z0-9_]*$/.test(value);

/** The five characters XML cares about, in attribute values. */
export const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * The aliases for one query, generated from the spec.
 *
 * Positional — `g0`, `g1`, `m0`, `m1`, and `n` for the count — so the reader
 * loops instead of switching, and so a second group column needs no new name.
 * Built once and handed to both the builder and the reader, which is what
 * stops the two disagreeing about what `g1` means.
 */
export function aliasPlan(spec: GroupSpec): AliasPlan {
    return {
        groups: spec.groups.map((group, index) => ({
            alias: `g${index}`,
            column: group.column,
            kind: group.kind,
        })),
        count: 'n',
        measures: spec.measures.map((measure, index) => ({
            alias: `m${index}`,
            column: measure.column,
            aggregate: measure.aggregate,
        })),
    };
}

/**
 * The `<attribute>` elements: one per group column, one per measure, and the
 * count.
 *
 * **`count` is over the primary key and is always asked for.** `count` counts
 * rows where `countcolumn` counts non-nulls, and the header's number is a row
 * count whatever the measures are. It is also the one aggregate a primary key
 * accepts — `sum` and `avg` over one are refused, and the refusal takes the
 * whole query with it.
 */
export function aggregateAttributes(plan: AliasPlan, primaryId: string): string {
    const groups = plan.groups.map(
        (group) => `<attribute name='${group.column}' groupby='true' alias='${group.alias}'/>`,
    );

    const measures = plan.measures.map(
        (measure) => `<attribute name='${measure.column}' aggregate='${measure.aggregate}' alias='${measure.alias}'/>`,
    );

    return `${groups.join('')}${measures.join('')}<attribute name='${primaryId}' aggregate='count' alias='${plan.count}'/>`;
}

/**
 * The view's FetchXML with everything that is not "which records" removed:
 * `<attribute>` (self-closing or not, at every depth — a link-entity's
 * attributes would make the aggregate refuse), `<all-attributes>`, and
 * `<order>` (which in an aggregate may only name aliases). Comments go too.
 */
export function stripView(viewXml: string): string {
    return viewXml
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<attribute\b[^>]*\/>/g, '')
        .replace(/<attribute\b[^>]*>[\s\S]*?<\/attribute>/g, '')
        .replace(/<all-attributes\s*\/>/g, '')
        .replace(/<order\b[^>]*\/>/g, '')
        .replace(/<order\b[^>]*>[\s\S]*?<\/order>/g, '');
}

/** The `name` of the root `<entity>` in a FetchXML document, or `null`. */
export function rootEntityOf(xml: string): string | null {
    const found = /<entity\b[^>]*\bname=['"]([^'"]+)['"]/.exec(xml);

    return found ? found[1].toLowerCase() : null;
}

/**
 * The whole query.
 *
 * `viewXml` is the saved query's FetchXML, or `null` when it could not be
 * read — then the query is the bare table. A view whose root `<entity>` is not
 * this table is ignored the same way rather than aggregating the wrong one;
 * measured as a real case on a dataset bound through a relationship whose view
 * id resolves elsewhere.
 *
 * `filterXml` is the dataset's runtime filter plus any parent condition, as
 * `<filter>` elements or `''`.
 */
export function aggregateFetchXml(
    spec: GroupSpec,
    plan: AliasPlan,
    viewXml: string | null,
    filterXml: string,
): string {
    const attributes = aggregateAttributes(plan, spec.primaryId);
    const stripped = viewXml !== null ? stripView(viewXml) : null;

    if (stripped !== null && rootEntityOf(stripped) === spec.entity) {
        const open = /<entity\b[^>]*>/.exec(stripped);
        const close = stripped.lastIndexOf('</entity>');

        if (open && close > open.index) {
            const head = stripped.slice(open.index + open[0].length, close);

            return `<fetch aggregate='true'><entity name='${spec.entity}'>${attributes}${head}${filterXml}</entity></fetch>`;
        }
    }

    return `<fetch aggregate='true'><entity name='${spec.entity}'>${attributes}${filterXml}</entity></fetch>`;
}

/**
 * The subgrid's relationship as a condition: the lookup on this table equal to
 * the form's record.
 *
 * **Measured 2026-09-20 and this is the whole reason the parent resolver
 * exists.** `filtering.getFilter()` returns `null` on a subgrid *whether or
 * not* it is set to show related records only, so the control cannot see the
 * relationship under any configuration. Without this condition an aggregate
 * reported 56 above a grid holding 38; with it, 38 exactly.
 *
 * A GUID goes in bare, unbraced and lower-case, which is what `contextInfo`
 * supplies.
 */
export const parentFilterXml = (column: string, id: string): string =>
    `<filter type='and'><condition attribute='${column}' operator='eq' value='${escapeXml(id)}'/></filter>`;

/**
 * Whether the FetchXML is URL-encoded inside `?fetchXml=`. Measured on the
 * Accounts form 2026-09-17 and again 2026-09-20: the platform accepts both.
 * Raw, as documented, and decided in one place.
 */
export const FETCHXML_ENCODED = false;

export const queryString = (xml: string): string =>
    `?fetchXml=${FETCHXML_ENCODED ? encodeURIComponent(xml) : xml}`;

/* ------------------------------------------------------------------------- */
/* The dataset's runtime filter, as FetchXML                                  */
/* ------------------------------------------------------------------------- */

/**
 * `dataset.filtering.getFilter()` speaks in the SDK's `ConditionOperator`
 * numbers. These are that enum's values spelled as FetchXML's operator names.
 *
 * **An operator not in this table makes the whole filter untranslatable**, and
 * an untranslatable filter withholds the server route rather than sending a
 * query that means something else. That rule is the most valuable thing in
 * this file: a dropped condition is a wrong answer that looks completely
 * right.
 */
export const CONDITION_OPERATORS: Record<number, string> = {
    0: 'eq', 1: 'ne', 2: 'gt', 3: 'lt', 4: 'ge', 5: 'le', 6: 'like', 7: 'not-like',
    8: 'in', 9: 'not-in', 10: 'between', 11: 'not-between', 12: 'null', 13: 'not-null',
    14: 'yesterday', 15: 'today', 16: 'tomorrow', 17: 'last-seven-days', 18: 'next-seven-days',
    19: 'last-week', 20: 'this-week', 21: 'next-week', 22: 'last-month', 23: 'this-month',
    24: 'next-month', 25: 'on', 26: 'on-or-before', 27: 'on-or-after', 28: 'last-year',
    29: 'this-year', 30: 'next-year', 31: 'last-x-hours', 32: 'next-x-hours', 33: 'last-x-days',
    34: 'next-x-days', 35: 'last-x-weeks', 36: 'next-x-weeks', 37: 'last-x-months',
    38: 'next-x-months', 39: 'last-x-years', 40: 'next-x-years', 41: 'eq-userid',
    42: 'ne-userid', 43: 'eq-businessid', 44: 'ne-businessid', 49: 'like', 52: 'not-on',
    54: 'begins-with', 55: 'not-begin-with', 56: 'ends-with', 57: 'not-end-with',
    70: 'in-fiscal-period-and-year', 73: 'eq-userteams', 74: 'eq-useroruserteams',
    75: 'under', 76: 'not-under', 77: 'eq-or-under', 78: 'above', 79: 'eq-or-above',
    87: 'contain-values', 88: 'not-contain-values',
};

/** `Contains` (49) is a `like` over `%value%`; the others send the value as given. */
const WRAPS_VALUE: Record<number, boolean> = { 49: true };

/** The operators that take no `value` at all. */
const NO_VALUE = new Set([
    'null', 'not-null', 'yesterday', 'today', 'tomorrow', 'last-seven-days', 'next-seven-days',
    'last-week', 'this-week', 'next-week', 'last-month', 'this-month', 'next-month', 'last-year',
    'this-year', 'next-year', 'eq-userid', 'ne-userid', 'eq-businessid', 'ne-businessid',
    'eq-userteams', 'eq-useroruserteams',
]);

/** The operators whose value is a list of `<value>` children. */
const LIST_VALUE = new Set(['in', 'not-in', 'between', 'not-between', 'contain-values', 'not-contain-values']);

/** The dataset filter shapes, as the typings declare them (no import: the file stays pure). */
export interface Condition {
    attributeName: string;
    conditionOperator: number;
    value: string | string[];
    entityAliasName?: string;
}

export interface Filter {
    conditions: Condition[];
    /** 0 = And, 1 = Or */
    filterOperator: number;
    filters?: Filter[];
}

export interface FilterXml {
    xml: string;
    /** Whether every condition could be spelled. `false` means "do not send this". */
    translatable: boolean;
}

/**
 * A dataset `FilterExpression` → one `<filter>` element, nested filters
 * included. An empty expression is `''`. Any condition whose operator is
 * unknown, or whose attribute is not a logical name, makes the result
 * untranslatable — better no server route than a query with a condition
 * quietly dropped.
 */
export function filterToFetchXml(filter: Filter | null | undefined): FilterXml {
    if (!filter) {
        return { xml: '', translatable: true };
    }

    let translatable = true;

    const conditions = (filter.conditions ?? []).map((condition) => {
        const operator = CONDITION_OPERATORS[condition.conditionOperator];
        const attribute = String(condition.attributeName ?? '').toLowerCase();

        if (!operator || !isLogicalName(attribute)) {
            translatable = false;

            return '';
        }

        const entity = condition.entityAliasName
            ? ` entityname='${escapeXml(String(condition.entityAliasName))}'`
            : '';
        const open = `<condition attribute='${attribute}' operator='${operator}'${entity}`;

        if (NO_VALUE.has(operator)) {
            return `${open}/>`;
        }

        const values = Array.isArray(condition.value) ? condition.value : [condition.value];

        if (LIST_VALUE.has(operator)) {
            return `${open}>${values.map((value) => `<value>${escapeXml(String(value ?? ''))}</value>`).join('')}</condition>`;
        }

        let value = String(values[0] ?? '');

        if (WRAPS_VALUE[condition.conditionOperator] && value.indexOf('%') === -1) {
            value = `%${value}%`;
        }

        return `${open} value='${escapeXml(value)}'/>`;
    });

    const nested = (filter.filters ?? []).map((child) => {
        const answer = filterToFetchXml(child);

        if (!answer.translatable) {
            translatable = false;
        }

        return answer.xml;
    });

    const body = conditions.join('') + nested.join('');

    if (body === '') {
        return { xml: '', translatable };
    }

    return { xml: `<filter type='${filter.filterOperator === 1 ? 'or' : 'and'}'>${body}</filter>`, translatable };
}

/**
 * Whether a rendered server message is safe to show a maker.
 *
 * **Measured 2026-09-20 and the reason grouping refuses some columns locally.**
 * The multi-select refusal arrived as *"The specified XML file \"{0}\" is not
 * valid as attribute of type multiselect optionset is not allowed as groupby
 * attribute"* — a message template whose parameter the server never
 * substituted. Rendering it verbatim shows somebody a formatting placeholder,
 * which reads as a bug in this control.
 *
 * Note this cuts against the other measurement in the same session: the
 * primary-key refusal's caught message was perfect while the *platform's own
 * console log* scrubbed it to `Aggregate _scrubbedSensitiveData_`. So there is
 * no rule of the form "prefer the rejection" or "prefer the log" — each can be
 * the useless one. All that can be said locally is whether what is in hand is
 * renderable.
 */
export const isRenderableMessage = (message: string): boolean =>
    message.trim() !== '' && !/\{\d+\}/.test(message);
