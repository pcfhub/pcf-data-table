/*
 * _template/variants/lib/related-rows — a FetchXML link fragment, parsed
 *
 * SHARED. Copied into a control as <Control>/lib/related-rows/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Written 2026-10-17 for pcf-data-table 0.8.0, whose SPEC.md (0.8.0, P1–P11)
 * carries every measurement cited below.
 */

/**
 * Rows related to the form's record by a path the subgrid's one relationship
 * cannot express, said the way a maker already says it: one or more FetchXML
 * `<link-entity>` elements, each with a `<filter>`, and `{id}` where the
 * record's id goes —
 *
 *     <link-entity name='account' from='accountid' to='cll_customer'>
 *       <filter><condition attribute='accountid' operator='eq-or-under' value='{id}'/></filter>
 *     </link-entity>
 *
 * — answered as a plan with two halves that mean the same thing: the dataset
 * route (`links` for `linking.addLinkedEntity`, `conditionsFor(id)` for
 * `setFilter`, each naming its link by `entityAliasName`), which keeps the rows
 * the platform's; and the FetchXML route (`fetchXml(id)`), for an aggregate that
 * has to count what the dataset shows. Pure: no `context`, so a suite drives it
 * directly.
 *
 * **It refuses rather than guesses**, and by name, because the platform's own
 * refusal names nothing (*0x80041103 Query Builder Error*, P11). What it
 * refuses and why:
 *
 *   - **A link inside a link.** The platform refused a link chained from
 *     another link's alias (P6). Several sibling links are honoured.
 *   - **An outer link**, which narrows nothing, so it cannot say which rows
 *     are related.
 *   - **A link with no condition.** Whether the dataset narrows by an inner
 *     link alone is unmeasured, while the FetchXML route would — the two
 *     halves would disagree. Every measured link carried a condition.
 *   - **An `or` filter, or a filter inside a filter.** Every measured
 *     condition on a link sat at the root of the expression, ANDed.
 *   - **`<attribute>`, `<order>`, `<all-attributes>`.** A related link narrows
 *     the rows; the view decides the columns and the order.
 *   - **An operator a dataset filter does not take**, by the list the
 *     typings publish, minus the canvas-only and full-text ones.
 *   - **A name that cannot be a logical name.** A plausible but wrong one is
 *     the platform's to refuse, and a caller can check names against the
 *     table definitions first (`names`).
 *
 * **The hierarchy operators are numbered the dataset's way**: 75 Above, 76
 * Under, 77 NotUnder, 78 AboveOrEqual, 79 UnderOrEqual — not the SDK's, where
 * 75 is Under. Measured (P2): 79 took a subgrid to the account's rows and its
 * child's; 76 to the child's alone.
 */

/** A link for `linking.addLinkedEntity`. Always inner; the alias is the fragment's or `rel<n>`. */
export interface RelatedLink {
    name: string;
    from: string;
    to: string;
    linkType: 'inner';
    alias: string;
}

/** A condition for `filtering.setFilter`, naming its link. Same three fields as the typings' `ConditionExpression`, plus the alias. */
export interface RelatedCondition {
    attributeName: string;
    conditionOperator: number;
    value: string | string[];
    entityAliasName: string;
}

/** A name the fragment uses, for checking against the table definitions before the platform refuses it unexplained. */
export interface RelatedName {
    table: string;
    column: string;
    /** `to` is a column of the bound table; `from` and `condition` are columns of the linked one. */
    role: 'to' | 'from' | 'condition';
    alias: string;
}

export interface RelatedPlan {
    links: RelatedLink[];
    /** Whether `{id}` appears anywhere — then a record is required. */
    usesRecord: boolean;
    /** The conditions with `{id}` replaced by `recordId` (bare, lower-case). */
    conditionsFor(recordId: string): RelatedCondition[];
    /** The links as FetchXML, `{id}` replaced — to append inside an aggregate's `<entity>`. */
    fetchXml(recordId: string): string;
    names: RelatedName[];
}

export type RelatedProblem =
    | 'empty'
    | 'not-xml'
    | 'not-a-link'
    | 'missing-attribute'
    | 'unknown-attribute'
    | 'outer'
    | 'nested'
    | 'no-condition'
    | 'or-filter'
    | 'nested-filter'
    | 'columns'
    | 'operator'
    | 'name'
    | 'alias-taken'
    | 'value';

export type RelatedParse =
    | { ok: true; plan: RelatedPlan }
    | { ok: false; problem: RelatedProblem; detail: string };

/**
 * FetchXML's operator names onto the numbers a dataset filter takes — the
 * typings' `ConditionOperator` union, minus `not-like` (canvas only) and
 * `like` with `%…%` spelled as `contains` (full-text columns only). 75–79 are
 * the dataset's numbering, measured.
 */
export const RELATED_OPERATORS: Readonly<Record<string, number>> = {
    'eq': 0, 'ne': 1, 'neq': 1, 'gt': 2, 'lt': 3, 'ge': 4, 'le': 5, 'like': 6, 'in': 8,
    'null': 12, 'not-null': 13, 'yesterday': 14, 'today': 15, 'tomorrow': 16,
    'last-seven-days': 17, 'next-seven-days': 18, 'last-week': 19, 'this-week': 20,
    'last-month': 22, 'this-month': 23, 'on': 25, 'on-or-before': 26, 'on-or-after': 27,
    'last-year': 28, 'this-year': 29, 'last-x-days': 33, 'next-x-days': 34,
    'last-x-months': 37, 'next-x-months': 38, 'in-fiscal-period-and-year': 70,
    'above': 75, 'under': 76, 'not-under': 77, 'eq-or-above': 78, 'eq-or-under': 79,
    'contain-values': 87,
};

/** The operators that take no value. */
const NO_VALUE = new Set(['null', 'not-null', 'yesterday', 'today', 'tomorrow', 'last-seven-days', 'next-seven-days', 'last-week', 'this-week', 'last-month', 'this-month', 'last-year', 'this-year']);

/** The operators whose value is a list of `<value>` children. */
const LIST_VALUE = new Set(['in', 'contain-values', 'in-fiscal-period-and-year']);

const LOGICAL = /^[a-z][a-z0-9_]*$/;
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Where the record's id goes. */
export const RECORD_PLACEHOLDER = '{id}';

const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const unescapeXml = (value: string): string =>
    value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/* ---- a tokenizer for the small subset this reads -------------------------- */

interface Tag {
    kind: 'open' | 'close' | 'self';
    name: string;
    attributes: Record<string, string>;
}

type Token = Tag | { kind: 'text'; text: string };

class Refusal {
    constructor(public readonly problem: RelatedProblem, public readonly detail: string) {}
}

function tokenize(text: string): Token[] {
    const out: Token[] = [];
    const source = text.replace(/<!--[\s\S]*?-->/g, '');
    const pattern = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+\s*=\s*(?:'[^']*'|"[^"]*"))*)\s*(\/?)>|([^<]+)|(<)/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
        if (match[6] !== undefined) {
            throw new Refusal('not-xml', 'a "<" that does not open a tag');
        }

        if (match[5] !== undefined) {
            out.push({ kind: 'text', text: match[5] });
            continue;
        }

        const attributes: Record<string, string> = {};
        const attributePattern = /([\w:-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
        let pair: RegExpExecArray | null;

        while ((pair = attributePattern.exec(match[3])) !== null) {
            attributes[pair[1]] = unescapeXml(pair[2] !== undefined ? pair[2] : pair[3]);
        }

        if (match[1] === '/' && match[4] === '/') {
            throw new Refusal('not-xml', `</${match[2]}/> is not a tag`);
        }

        out.push({ kind: match[1] === '/' ? 'close' : match[4] === '/' ? 'self' : 'open', name: match[2], attributes });
    }

    return out;
}

/* ---- the reader ----------------------------------------------------------- */

interface ParsedCondition {
    attribute: string;
    operator: string;
    values: string[];
    list: boolean;
}

interface ParsedLink {
    name: string;
    from: string;
    to: string;
    alias: string | null;
    conditions: ParsedCondition[];
}

const LINK_ATTRIBUTES = new Set(['name', 'from', 'to', 'alias', 'link-type', 'intersect', 'visible']);

function expectAttributes(tag: Tag, allowed: Set<string>, where: string): void {
    for (const key of Object.keys(tag.attributes)) {
        if (!allowed.has(key)) {
            throw new Refusal('unknown-attribute', `${where} has an attribute "${key}" this does not read`);
        }
    }
}

function readCondition(tag: Tag, tokens: Token[], at: { i: number }): ParsedCondition {
    expectAttributes(tag, new Set(['attribute', 'operator', 'value', 'entityname', 'uitype', 'uiname']), '<condition>');

    if (tag.attributes.entityname !== undefined) {
        throw new Refusal('unknown-attribute', '<condition entityname> names another link; put the condition inside that link instead');
    }

    const attribute = tag.attributes.attribute;
    const operator = tag.attributes.operator;

    if (attribute === undefined || operator === undefined) {
        throw new Refusal('missing-attribute', `<condition> needs ${attribute === undefined ? 'attribute' : 'operator'}`);
    }

    if (!LOGICAL.test(attribute)) {
        throw new Refusal('name', `"${attribute}" cannot be a column's logical name`);
    }

    if (!Object.prototype.hasOwnProperty.call(RELATED_OPERATORS, operator)) {
        throw new Refusal('operator', `"${operator}" is not an operator a related filter can use`);
    }

    const values: string[] = [];

    if (tag.kind === 'open') {
        for (;;) {
            const token = tokens[at.i++];

            if (!token) {
                throw new Refusal('not-xml', '<condition> is never closed');
            }

            if (token.kind === 'text') {
                if (token.text.trim() !== '') {
                    throw new Refusal('not-xml', 'text inside <condition> outside a <value>');
                }
                continue;
            }

            if (token.kind === 'close' && token.name === 'condition') {
                break;
            }

            if (token.kind === 'open' && token.name === 'value') {
                const inner = tokens[at.i++];
                const close = inner && inner.kind === 'text' ? tokens[at.i++] : inner;
                values.push(inner && inner.kind === 'text' ? unescapeXml(inner.text) : '');

                if (!close || close.kind !== 'close' || close.name !== 'value') {
                    throw new Refusal('not-xml', '<value> is never closed');
                }
                continue;
            }

            throw new Refusal('not-xml', `<${(token as Tag).name}> inside <condition>`);
        }
    }

    const list = LIST_VALUE.has(operator);

    if (tag.attributes.value !== undefined) {
        if (values.length > 0) {
            throw new Refusal('value', `<condition attribute="${attribute}"> has both a value and <value> children`);
        }
        values.push(tag.attributes.value);
    }

    if (NO_VALUE.has(operator) && values.length > 0) {
        throw new Refusal('value', `"${operator}" takes no value`);
    }

    if (!NO_VALUE.has(operator) && values.length === 0) {
        throw new Refusal('value', `"${operator}" on ${attribute} needs a value`);
    }

    if (!list && values.length > 1) {
        throw new Refusal('value', `"${operator}" takes one value, not ${values.length}`);
    }

    return { attribute, operator, values, list };
}

function readFilter(tag: Tag, tokens: Token[], at: { i: number }): ParsedCondition[] {
    expectAttributes(tag, new Set(['type']), '<filter>');

    if ((tag.attributes.type ?? 'and').toLowerCase() !== 'and') {
        throw new Refusal('or-filter', 'an "or" filter on a related link is not supported; every condition is ANDed');
    }

    const conditions: ParsedCondition[] = [];

    if (tag.kind === 'self') {
        return conditions;
    }

    for (;;) {
        const token = tokens[at.i++];

        if (!token) {
            throw new Refusal('not-xml', '<filter> is never closed');
        }

        if (token.kind === 'text') {
            if (token.text.trim() !== '') {
                throw new Refusal('not-xml', 'text inside <filter>');
            }
            continue;
        }

        if (token.kind === 'close' && token.name === 'filter') {
            return conditions;
        }

        if ((token.kind === 'open' || token.kind === 'self') && token.name === 'condition') {
            conditions.push(readCondition(token, tokens, at));
            continue;
        }

        if (token.name === 'filter') {
            throw new Refusal('nested-filter', 'a <filter> inside a <filter> is not supported');
        }

        throw new Refusal('not-xml', `<${token.name}> inside <filter>`);
    }
}

function readLink(tag: Tag, tokens: Token[], at: { i: number }): ParsedLink {
    expectAttributes(tag, LINK_ATTRIBUTES, '<link-entity>');

    const { name, from, to } = tag.attributes;

    if (name === undefined || from === undefined || to === undefined) {
        const missing = ['name', 'from', 'to'].filter((key) => tag.attributes[key] === undefined).join(', ');
        throw new Refusal('missing-attribute', `<link-entity> needs ${missing}`);
    }

    for (const value of [name, from, to]) {
        if (!LOGICAL.test(value)) {
            throw new Refusal(value.indexOf('.') !== -1 ? 'nested' : 'name', value.indexOf('.') !== -1
                ? `"${value}" reaches through another link; the platform refuses a link chained from one`
                : `"${value}" cannot be a logical name`);
        }
    }

    if ((tag.attributes['link-type'] ?? 'inner').toLowerCase() !== 'inner') {
        throw new Refusal('outer', `<link-entity name="${name}"> is ${tag.attributes['link-type']}; an outer link says nothing about which rows are related`);
    }

    const alias = tag.attributes.alias ?? null;

    if (alias !== null && !ALIAS.test(alias)) {
        throw new Refusal('name', `"${alias}" cannot be an alias`);
    }

    const conditions: ParsedCondition[] = [];

    if (tag.kind === 'open') {
        for (;;) {
            const token = tokens[at.i++];

            if (!token) {
                throw new Refusal('not-xml', '<link-entity> is never closed');
            }

            if (token.kind === 'text') {
                if (token.text.trim() !== '') {
                    throw new Refusal('not-xml', 'text inside <link-entity>');
                }
                continue;
            }

            if (token.kind === 'close' && token.name === 'link-entity') {
                break;
            }

            if (token.name === 'link-entity') {
                throw new Refusal('nested', 'a <link-entity> inside another; the platform refuses a link chained from one — write it as its own link');
            }

            if (token.name === 'filter' && token.kind !== 'close') {
                conditions.push(...readFilter(token, tokens, at));
                continue;
            }

            if (token.name === 'attribute' || token.name === 'order' || token.name === 'all-attributes') {
                throw new Refusal('columns', `<${token.name}> in a related link; the view decides the columns and the order`);
            }

            throw new Refusal('not-xml', `<${token.name}> inside <link-entity>`);
        }
    }

    if (conditions.length === 0) {
        throw new Refusal('no-condition', `<link-entity name="${name}"> has no condition; add a <filter> saying which ${name} rows`);
    }

    return { name, from, to, alias, conditions };
}

/** The record's id as a condition wants it: bare and lower-case. */
const bareId = (id: string): string => id.replace(/[{}]/g, '').trim().toLowerCase();

/**
 * Read a fragment. `boundTable` is the dataset's table, for `names`. Never
 * throws: a fragment that cannot be used is a `problem` and a sentence.
 */
export function parseRelated(text: string, boundTable: string): RelatedParse {
    const source = text.trim();

    if (source === '') {
        return { ok: false, problem: 'empty', detail: 'nothing to read' };
    }

    try {
        const tokens = tokenize(source);
        const at = { i: 0 };
        const parsed: ParsedLink[] = [];

        while (at.i < tokens.length) {
            const token = tokens[at.i++];

            if (token.kind === 'text') {
                if (token.text.trim() !== '') {
                    throw new Refusal('not-a-link', 'text outside a <link-entity>');
                }
                continue;
            }

            if (token.name !== 'link-entity' || token.kind === 'close') {
                throw new Refusal('not-a-link', `<${token.kind === 'close' ? '/' : ''}${token.name}> where a <link-entity> should be`);
            }

            parsed.push(readLink(token, tokens, at));
        }

        if (parsed.length === 0) {
            throw new Refusal('not-a-link', 'no <link-entity>');
        }

        const taken = new Set(parsed.map((link) => link.alias).filter((alias): alias is string => alias !== null));

        if (taken.size !== parsed.filter((link) => link.alias !== null).length) {
            throw new Refusal('alias-taken', 'two links share an alias');
        }

        let next = 0;
        const named = parsed.map((link) => {
            if (link.alias !== null) {
                return { ...link, alias: link.alias };
            }

            while (taken.has(`rel${next}`)) {
                next += 1;
            }

            const alias = `rel${next}`;
            taken.add(alias);
            return { ...link, alias };
        });

        const usesRecord = named.some((link) => link.conditions.some((c) => c.values.some((v) => v.indexOf(RECORD_PLACEHOLDER) !== -1)));
        const fill = (value: string, id: string): string => value.split(RECORD_PLACEHOLDER).join(bareId(id));

        const plan: RelatedPlan = {
            links: named.map((link) => ({ name: link.name, from: link.from, to: link.to, linkType: 'inner' as const, alias: link.alias })),
            usesRecord,
            conditionsFor: (recordId) => named.flatMap((link) => link.conditions.map((condition) => ({
                attributeName: condition.attribute,
                conditionOperator: RELATED_OPERATORS[condition.operator],
                value: condition.list ? condition.values.map((v) => fill(v, recordId)) : fill(condition.values[0] ?? '', recordId),
                entityAliasName: link.alias,
            }))),
            fetchXml: (recordId) => named.map((link) => {
                const conditions = link.conditions.map((condition) => {
                    const head = `<condition attribute='${condition.attribute}' operator='${condition.operator}'`;

                    if (NO_VALUE.has(condition.operator)) {
                        return `${head}/>`;
                    }

                    if (condition.list) {
                        return `${head}>${condition.values.map((v) => `<value>${escapeXml(fill(v, recordId))}</value>`).join('')}</condition>`;
                    }

                    return `${head} value='${escapeXml(fill(condition.values[0], recordId))}'/>`;
                }).join('');

                return `<link-entity name='${link.name}' from='${link.from}' to='${link.to}' alias='${link.alias}' link-type='inner'><filter type='and'>${conditions}</filter></link-entity>`;
            }).join(''),
            names: named.flatMap((link) => [
                { table: boundTable, column: link.to, role: 'to' as const, alias: link.alias },
                { table: link.name, column: link.from, role: 'from' as const, alias: link.alias },
                ...link.conditions.map((condition) => ({ table: link.name, column: condition.attribute, role: 'condition' as const, alias: link.alias })),
            ]),
        };

        return { ok: true, plan };
    } catch (error) {
        if (error instanceof Refusal) {
            return { ok: false, problem: error.problem, detail: error.detail };
        }

        throw error;
    }
}

/** Whether a property's text is a fragment (inline) rather than the name of a web resource holding one. */
export const isInlineFragment = (text: string): boolean => text.trim().startsWith('<');
