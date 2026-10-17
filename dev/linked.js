/*
 * Dataset linking, stood in for: `dataset.linking`, the conditions that name a
 * link by `entityAliasName`, the hierarchy operators, and a `<link-entity>` in
 * a FetchXML query — as `pcf-data-table`'s 0.7.3 probe measured them on a
 * model-driven subgrid, 2026-10-17 (its SPEC.md 0.8.0, P1–P11).
 *
 * Shared by the dataset rig's `dev/host.js` (the template's and any control's
 * that requires it), and kept current by `sync-rig.mjs`. Loaded by `smoke.js`
 * in Node through `host.js`, and by `harness.html` in a browser **before**
 * `host.js`, which reads it off `window.__pcfLinked`. A host with no copy of
 * this file has no `linking` at all — which is what the rig was before it.
 *
 * What was measured, and what each part below reproduces:
 *
 *   - **A link narrows**: `addLinkedEntity` plus a condition on its alias took
 *     an unrelated subgrid from 52 rows to 31 (P1). The link is inner: a row
 *     with nothing at the other end is not in the result.
 *   - **The hierarchy operators are numbered the PCF reference's way, not the
 *     SDK's** (P2): 75 Above, 76 Under, 77 NotUnder, 78 AboveOrEqual, 79
 *     UnderOrEqual. The SDK's `ConditionOperator` has 75 Under … 79
 *     AboveOrEqual, and a control that trusted it filtered the wrong way.
 *   - **A link is for the page's life** (P5): an identical expression added
 *     again is kept once, a *different* one under an alias already used is
 *     appended — two entries — and the query is refused. There is no remove.
 *   - **Sibling links are honoured, nested ones refused** (P6): a second
 *     top-level link narrowed; a `to` naming another link's alias
 *     (`rel0.parentaccountid`) was refused.
 *   - **Every refusal is the same unexplained message** (P5, P6, P11):
 *     `error: true`, *0x80041103 Query Builder Error*, no rows, and
 *     `totalResultCount` left at whatever it was before. A column the table
 *     does not have names nothing.
 *   - `getLinkedEntities()` hands back each link with `filtering: { aliasMap:
 *     {} }`, `linking: {}` and `sorting: []` beside the five fields given.
 */

(function (root, factory) {
    'use strict';

    var api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.__pcfLinked = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    /** The dataset's own numbering for the five hierarchy operators — measured, P2. */
    var HIERARCHY = { Above: 75, Under: 76, NotUnder: 77, AboveOrEqual: 78, UnderOrEqual: 79 };

    /** FetchXML's names for the same five, onto the dataset's numbers. */
    var FETCH_NAMES = { 'above': 75, 'under': 76, 'not-under': 77, 'eq-or-above': 78, 'eq-or-under': 79 };

    /** What every measured refusal said, word for word. */
    var QUERY_BUILDER_ERROR = '0x80041103 Query Builder Error';

    function isHierarchy(operator) {
        return operator >= 75 && operator <= 79;
    }

    /** A GUID, an `EntityReference` or a fixture lookup → the bare lower-case id, or `''`. */
    function bare(value) {
        if (value === null || value === undefined) {
            return '';
        }

        if (typeof value === 'object') {
            if (value.id && typeof value.id === 'object' && typeof value.id.guid === 'string') {
                return bare(value.id.guid);
            }

            if (typeof value.id === 'string') {
                return bare(value.id);
            }

            return '';
        }

        return String(value).replace(/[{}]/g, '').toLowerCase();
    }

    /**
     * One host's linking: `{ linking, links }` — the object to hang on the
     * dataset, and the live list for the host to judge rows by. `log` is the
     * host's call log.
     */
    function createLinking(log) {
        var links = [];

        function sameAs(a, b) {
            return a.alias === b.alias && a.name === b.name && a.from === b.from && a.to === b.to && a.linkType === b.linkType;
        }

        return {
            linking: {
                getLinkedEntities: function () {
                    return links.map(function (link) {
                        return {
                            name: link.name,
                            from: link.from,
                            to: link.to,
                            linkType: link.linkType,
                            alias: link.alias,
                            filtering: { aliasMap: {} },
                            linking: {},
                            sorting: [],
                        };
                    });
                },

                addLinkedEntity: function (expression) {
                    var link = {
                        name: String(expression && expression.name),
                        from: String(expression && expression.from),
                        to: String(expression && expression.to),
                        linkType: String(expression && expression.linkType),
                        alias: String(expression && expression.alias),
                    };

                    log('linking.addLinkedEntity', link.alias + ' → ' + link.name + '.' + link.from + ' = ' + link.to);

                    // Identical: kept once. Different under the same alias: appended, and refused at the fetch.
                    if (!links.some(function (existing) { return sameAs(existing, link); })) {
                        links.push(link);
                    }
                },
            },

            links: function () {
                return links;
            },
        };
    }

    /**
     * The rows of a table, for joining and for walking a hierarchy: the bound
     * table's own rows when it is the bound table, plus `fixture.related[t]`
     * rows (`{ id, name, values? }`), keyed by `<table>id`.
     */
    function makeTables(fixture, boundRows) {
        function rows(table) {
            var out = [];

            if (table === fixture.targetEntityType) {
                boundRows().forEach(function (row) {
                    var values = Object.assign({}, row.values);
                    values[table + 'id'] = row.id;
                    out.push({ id: row.id, values: values });
                });
            }

            ((fixture.related || {})[table] || { rows: [] }).rows.forEach(function (row) {
                var values = Object.assign({ name: row.name }, row.values || {});
                values[table + 'id'] = row.id;
                out.push({ id: row.id, values: values });
            });

            return out;
        }

        function parentOf(table, id) {
            var column = (fixture.hierarchy || {})[table];

            if (!column) {
                return '';
            }

            var row = rows(table).filter(function (candidate) {
                return bare(candidate.id) === bare(id);
            })[0];

            return row ? bare(row.values[column]) : '';
        }

        /** Whether `table` has `column` at all: a key on any row, or a declared column. */
        function knows(table, column) {
            if (column === table + 'id') {
                return true;
            }

            if (table === fixture.targetEntityType && (fixture.columns || []).some(function (c) { return c.name === column; })) {
                return true;
            }

            return rows(table).some(function (row) {
                return Object.prototype.hasOwnProperty.call(row.values, column);
            });
        }

        return { rows: rows, parentOf: parentOf, knows: knows };
    }

    /** Every id above `id`, nearest first; a loop in the data stops the walk. */
    function ancestors(tables, table, id) {
        var seen = [];
        var at = tables.parentOf(table, id);

        while (at && seen.indexOf(at) === -1) {
            seen.push(at);
            at = tables.parentOf(table, at);
        }

        return seen;
    }

    /** One hierarchy condition: is `candidate` above / under / … `wanted`, in `table`? */
    function hierarchyHolds(tables, table, candidate, operator, wanted) {
        var c = bare(candidate);
        var w = bare(wanted);

        if (c === '') {
            return false;
        }

        var above = ancestors(tables, table, w).indexOf(c) !== -1;
        var under = ancestors(tables, table, c).indexOf(w) !== -1;

        switch (operator) {
            case HIERARCHY.Above: return above;
            case HIERARCHY.Under: return under;
            case HIERARCHY.NotUnder: return !under;
            case HIERARCHY.AboveOrEqual: return c === w || above;
            case HIERARCHY.UnderOrEqual: return c === w || under;
            default: return true;
        }
    }

    /**
     * Why a query with these links is refused, or `null`. The three measured
     * causes — two links under one alias, a `to` naming another link, a column
     * the table does not have — all answer the same sentence.
     */
    function refusal(links, tables, boundTable) {
        for (var i = 0; i < links.length; i += 1) {
            var link = links[i];
            var twice = links.filter(function (other) { return other.alias === link.alias; }).length > 1;

            if (twice || link.to.indexOf('.') !== -1 || !tables.knows(boundTable, link.to) || !tables.knows(link.name, link.from)) {
                return QUERY_BUILDER_ERROR;
            }
        }

        return null;
    }

    /**
     * A condition that names a link: judged against the row(s) at the other
     * end. Inner, as measured — nothing at the other end is no match. `holds`
     * is the host's own judge for an ordinary operator.
     */
    function holdsLinked(row, condition, links, tables, holds) {
        var link = links.filter(function (candidate) {
            return candidate.alias === condition.entityAliasName;
        })[0];

        if (!link) {
            return false;
        }

        var key = bare(row.values[link.to]);

        if (key === '') {
            return false;
        }

        var matches = tables.rows(link.name).filter(function (other) {
            return bare(other.values[link.from]) === key;
        });

        return matches.some(function (other) {
            if (isHierarchy(condition.conditionOperator)) {
                return hierarchyHolds(tables, link.name, other.values[condition.attributeName], condition.conditionOperator, condition.value);
            }

            return holds(other, { attributeName: condition.attributeName, conditionOperator: condition.conditionOperator, value: condition.value });
        });
    }

    /**
     * The top-level `<link-entity>` elements of a FetchXML `<entity>` body:
     * `{ name, from, to, alias, linkType, body, nested }`. `nested` says a
     * link sits inside this one — the rig judges none of those, and says so.
     */
    function parseLinks(xml) {
        var out = [];
        var tokens = xml.match(/<\/?link-entity\b[^>]*>|<[^>]+>|[^<]+/g) || [];
        var depth = 0;
        var current = null;

        function attr(tag, name) {
            var m = tag.match(new RegExp('\\b' + name + "=['\"]([^'\"]*)['\"]"));
            return m ? m[1] : undefined;
        }

        tokens.forEach(function (token) {
            if (/^<link-entity\b/.test(token)) {
                var selfClosing = /\/>$/.test(token);

                if (depth === 0) {
                    current = {
                        name: attr(token, 'name'),
                        from: attr(token, 'from'),
                        to: attr(token, 'to'),
                        alias: attr(token, 'alias'),
                        linkType: attr(token, 'link-type') || 'inner',
                        body: '',
                        nested: false,
                    };

                    if (selfClosing) {
                        out.push(current);
                        current = null;
                    } else {
                        depth = 1;
                    }
                } else {
                    current.nested = true;
                    current.body += token;

                    if (!selfClosing) {
                        depth += 1;
                    }
                }
            } else if (/^<\/link-entity>/.test(token)) {
                depth -= 1;

                if (depth === 0) {
                    out.push(current);
                    current = null;
                } else {
                    current.body += token;
                }
            } else if (depth > 0) {
                current.body += token;
            }
        });

        return out;
    }

    return {
        HIERARCHY: HIERARCHY,
        FETCH_NAMES: FETCH_NAMES,
        QUERY_BUILDER_ERROR: QUERY_BUILDER_ERROR,
        isHierarchy: isHierarchy,
        bare: bare,
        createLinking: createLinking,
        makeTables: makeTables,
        ancestors: ancestors,
        hierarchyHolds: hierarchyHolds,
        refusal: refusal,
        holdsLinked: holdsLinked,
        parseLinks: parseLinks,
    };
});
