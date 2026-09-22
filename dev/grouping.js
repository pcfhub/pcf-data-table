/*
 * The grouping decisions, asserted directly.
 *
 *     npm run grouping
 *
 * These drive the pure modules through `dev/modules.js` — no bundle, no
 * control, no DOM. What they cover is the half of grouping that is strings and
 * arithmetic: the query text a server would receive, the rule that withholds
 * the server route, and the reading of a response.
 *
 * **Every fixture in the "as the server answers" section is a row measured on
 * a real subgrid on 2026-09-20** (SPEC.md 0.6.0), pasted rather than invented.
 * That is the point of them: a reader written against imagined shapes passes
 * its own suite and fails on the first form. The three that would have been
 * imagined wrong are the blank group (alias absent, not null), the Choice type
 * (a number here, a string from a record), and the lookup's third annotation.
 *
 * What passing here does NOT mean: that `index.ts` calls any of it with the
 * right column, that a real view's FetchXML looks like the fixture's, or that
 * the platform still answers this way. Those stay with `npm run smoke`, with a
 * real form, and with SPEC.md's *Not verified*.
 */

'use strict';

const { load } = require('./modules.js');

const fx = load('query/fetchXml');
const types = load('group/types');
const rows = load('query/rows');
const grouping = load('group/group');

/* ---------------------------------------------------------------- asserts */

let passed = 0;
let failed = 0;
const pending = [];

function check(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);

    if (a === e) {
        passed += 1;
        console.log('  ok    ' + label);
    } else {
        failed += 1;
        console.log('  FAIL  ' + label + '\n          got      ' + a + '\n          expected ' + e);
    }
}

function section(title) {
    console.log('\n' + title);
}

/* ------------------------------------------------------------- the fixtures */

const CHOICE = 'OptionSet';
const LOOKUP = 'Lookup.Simple';

const spec = (groups, measures) => ({
    entity: 'cll_account',
    primaryId: 'cll_accountid',
    groups: groups.map((column) => ({ column, kind: types.groupKindFor(column === 'cll_primarycontact' ? LOOKUP : CHOICE) })),
    measures: measures || [],
});

/**
 * The view's own FetchXML, copied from the probe's G1 answer.
 *
 * Kept verbatim — including the `<order>` and `<filter>` sitting *between*
 * `<attribute>` elements rather than after them, which is the thing
 * `stripView` has to survive and which no invented fixture would have had.
 */
const VIEW_XML =
    '<fetch version="1.0" mapping="logical" savedqueryid="50901766-BA1B-46E0-850B-E1A3991ADE2E">' +
    '<entity name="cll_account">' +
    '<attribute name="cll_accountid"/><attribute name="cll_accountname"/>' +
    '<order attribute="cll_accountname" descending="false"/>' +
    '<filter type="and"><condition attribute="statecode" operator="eq" value="0"/></filter>' +
    '<attribute name="createdon"/><attribute name="cll_industry"/>' +
    '</entity></fetch>';

/* ----------------------------------------------------------- the alias plan */

section('the alias plan');

{
    const one = fx.aliasPlan(spec(['cll_industry']));

    check('one group, no measure', one, {
        groups: [{ alias: 'g0', column: 'cll_industry', kind: 'choice' }],
        count: 'n',
        measures: [],
    });

    const two = fx.aliasPlan(spec(['cll_industry', 'cll_priority'], [
        { column: 'cll_amount', aggregate: 'sum' },
        { column: 'cll_amount', aggregate: 'avg' },
    ]));

    check('two groups, two measures over one column — aliases distinct', two, {
        groups: [
            { alias: 'g0', column: 'cll_industry', kind: 'choice' },
            { alias: 'g1', column: 'cll_priority', kind: 'choice' },
        ],
        count: 'n',
        measures: [
            { alias: 'm0', column: 'cll_amount', aggregate: 'sum' },
            { alias: 'm1', column: 'cll_amount', aggregate: 'avg' },
        ],
    });

    check('count is always asked for, whatever the measures', [one.count, two.count], ['n', 'n']);
}

/* ------------------------------------------------------------- the query text */

section('the query text');

{
    const s = spec(['cll_industry', 'cll_priority']);
    const plan = fx.aliasPlan(s);

    check(
        'two groupby plus count over the primary key',
        fx.aggregateAttributes(plan, s.primaryId),
        "<attribute name='cll_industry' groupby='true' alias='g0'/>" +
        "<attribute name='cll_priority' groupby='true' alias='g1'/>" +
        "<attribute name='cll_accountid' aggregate='count' alias='n'/>",
    );

    // Exactly the query the probe sent and the server accepted, minus the two
    // aggregates it refused over a primary key.
    check(
        'the whole query, no view',
        fx.aggregateFetchXml(s, plan, null, ''),
        "<fetch aggregate='true'><entity name='cll_account'>" +
        "<attribute name='cll_industry' groupby='true' alias='g0'/>" +
        "<attribute name='cll_priority' groupby='true' alias='g1'/>" +
        "<attribute name='cll_accountid' aggregate='count' alias='n'/>" +
        '</entity></fetch>',
    );
}

section('stripView, against the real view');

{
    const stripped = fx.stripView(VIEW_XML);

    check('every <attribute> is gone, at every depth', /<attribute\b/.test(stripped), false);
    check('every <order> is gone', /<order\b/.test(stripped), false);
    check('the view\'s own <filter> is kept', /<condition attribute="statecode"/.test(stripped), true);
    check('the root entity is still readable', fx.rootEntityOf(stripped), 'cll_account');

    const s = spec(['cll_industry']);
    const query = fx.aggregateFetchXml(s, fx.aliasPlan(s), VIEW_XML, "<filter type='and'><condition attribute='cll_priority' operator='eq' value='1'/></filter>");

    check('the view\'s filter and the runtime filter are two siblings', (query.match(/<filter /g) || []).length, 2);
    check('aggregate=true is on the root', query.indexOf("<fetch aggregate='true'>"), 0);
    check('the group attribute comes before the carried-over content', query.indexOf("alias='g0'") < query.indexOf('statecode'), true);

    check(
        'a view of another table is ignored rather than aggregated',
        fx.aggregateFetchXml(s, fx.aliasPlan(s), VIEW_XML.replace('cll_account"', 'contact"'), ''),
        "<fetch aggregate='true'><entity name='cll_account'>" +
        "<attribute name='cll_industry' groupby='true' alias='g0'/>" +
        "<attribute name='cll_accountid' aggregate='count' alias='n'/>" +
        '</entity></fetch>',
    );
}

/* ------------------------------------------------------- the runtime filter */

section('the runtime filter, and the rule that withholds the route');

{
    const t = (filter) => fx.filterToFetchXml(filter);

    check('nothing to translate', t(null), { xml: '', translatable: true });

    check('a plain equality', t({ filterOperator: 0, conditions: [{ attributeName: 'cll_industry', conditionOperator: 0, value: '1' }] }), {
        xml: "<filter type='and'><condition attribute='cll_industry' operator='eq' value='1'/></filter>",
        translatable: true,
    });

    check('an operator taking no value', t({ filterOperator: 0, conditions: [{ attributeName: 'cll_industry', conditionOperator: 12, value: '' }] }), {
        xml: "<filter type='and'><condition attribute='cll_industry' operator='null'/></filter>",
        translatable: true,
    });

    check('a list operator becomes <value> children', t({ filterOperator: 0, conditions: [{ attributeName: 'cll_industry', conditionOperator: 8, value: ['1', '2'] }] }), {
        xml: "<filter type='and'><condition attribute='cll_industry' operator='in'><value>1</value><value>2</value></condition></filter>",
        translatable: true,
    });

    check('Contains wraps its value in percent signs', t({ filterOperator: 0, conditions: [{ attributeName: 'cll_accountname', conditionOperator: 49, value: 'works' }] }).xml,
        "<filter type='and'><condition attribute='cll_accountname' operator='like' value='%works%'/></filter>");

    check('Or is honoured', t({ filterOperator: 1, conditions: [{ attributeName: 'cll_industry', conditionOperator: 0, value: '1' }] }).xml.indexOf("type='or'"), 8);

    check('a nested filter rides along', (t({
        filterOperator: 0,
        conditions: [{ attributeName: 'cll_industry', conditionOperator: 0, value: '1' }],
        filters: [{ filterOperator: 1, conditions: [{ attributeName: 'cll_priority', conditionOperator: 0, value: '2' }] }],
    }).xml.match(/<filter /g) || []).length, 2);

    // The one that matters most: a condition this control cannot spell must
    // withhold the whole route, not quietly disappear from the query.
    check('an unknown operator makes the filter untranslatable',
        t({ filterOperator: 0, conditions: [{ attributeName: 'cll_industry', conditionOperator: 9999, value: '1' }] }).translatable, false);

    check('an attribute that is not a logical name does too',
        t({ filterOperator: 0, conditions: [{ attributeName: 'Cll Industry', conditionOperator: 0, value: '1' }] }).translatable, false);

    check('an untranslatable nested filter poisons the parent',
        t({
            filterOperator: 0,
            conditions: [],
            filters: [{ filterOperator: 0, conditions: [{ attributeName: 'x', conditionOperator: 9999, value: '' }] }],
        }).translatable, false);

    check('a value with a quote in it is escaped',
        t({ filterOperator: 0, conditions: [{ attributeName: 'cll_accountname', conditionOperator: 0, value: "O'Brien & Co" }] }).xml.indexOf('&apos;') > -1, true);
}

/* ------------------------------------------------------- as the server answers */

section('reading a row, as the server actually answered');

{
    const s = spec(['cll_industry', 'cll_priority']);
    const plan = fx.aliasPlan(s);

    // Measured 2026-09-20, pasted verbatim.
    const real = {
        'n@OData.Community.Display.V1.AttributeName': 'cll_accountid',
        'n@OData.Community.Display.V1.FormattedValue': '2',
        n: 2,
        'g0@OData.Community.Display.V1.AttributeName': 'cll_industry',
        'g0@OData.Community.Display.V1.FormattedValue': 'Retail',
        g0: 1,
        'g1@OData.Community.Display.V1.AttributeName': 'cll_priority',
        'g1@OData.Community.Display.V1.FormattedValue': 'Low',
        g1: 1,
    };

    check('a two-group row', rows.toGroupReading(real, plan, '(blank)'), {
        key: '1 1',
        values: [1, 1],
        labels: ['Retail', 'Low'],
        count: 2,
        measures: [],
        measureLabels: [],
    });

    // Measured: the blank group's alias is absent from the row entirely.
    const blank = {
        'n@OData.Community.Display.V1.AttributeName': 'cll_accountid',
        'n@OData.Community.Display.V1.FormattedValue': '2',
        n: 2,
    };

    const single = fx.aliasPlan(spec(['cll_primarycontact']));

    check('the blank group — alias absent, not null', rows.toGroupReading(blank, single, '(blank)'), {
        key: '',
        values: [null],
        labels: ['(blank)'],
        count: 2,
        measures: [],
        measureLabels: [],
    });

    // Measured: a lookup group is a bare GUID with three annotations.
    const lookup = {
        n: 1,
        'g0@OData.Community.Display.V1.AttributeName': 'cll_primarycontact',
        'g0@OData.Community.Display.V1.FormattedValue': 'Susanna Stubberod (sample)',
        'g0@Microsoft.Dynamics.CRM.lookuplogicalname': 'contact',
        g0: '8fe84297-9486-ec11-93b0-000d3a5c8441',
    };

    check('a lookup group', rows.toGroupReading(lookup, single, '(blank)').values, ['8fe84297-9486-ec11-93b0-000d3a5c8441']);
    check('its label is free', rows.toGroupReading(lookup, single, '(blank)').labels, ['Susanna Stubberod (sample)']);
    check('and the third annotation names the target table', rows.lookupTableOf(lookup, 'g0'), 'contact');
    check('which is absent on a choice group', rows.lookupTableOf(real, 'g0'), null);

    // Measured: a date measure is UTC, its formatted value is the user's zone.
    const dated = {
        n: 3,
        g0: 2,
        'g0@OData.Community.Display.V1.FormattedValue': 'Manufacturing',
        'm0@OData.Community.Display.V1.FormattedValue': '9/11/2026 8:00 AM',
        m0: '2026-09-11T13:00:00Z',
    };
    const datePlan = fx.aliasPlan({ ...spec(['cll_industry']), measures: [{ column: 'cll_lastcontacted', aggregate: 'min' }] });
    const read = rows.toGroupReading(dated, datePlan, '(blank)');

    check('a date measure keeps the raw', read.measures, ['2026-09-11T13:00:00Z']);
    check('and the formatted value beside it, because they differ by the user\'s offset', read.measureLabels, ['9/11/2026 8:00 AM']);

    check('the response is checked against the plan it was built from', rows.describesPlan([real], plan), true);
    check('a mis-built query is caught rather than mislabelled',
        rows.describesPlan([real], fx.aliasPlan(spec(['cll_priority', 'cll_industry']))), false);
    check('no rows is not a disagreement', rows.describesPlan([], plan), true);
}

/* --------------------------------------------------------- the two routes agree */

section('the two routes agree');

{
    const s = spec(['cll_industry']);
    const plan = fx.aliasPlan(s);

    /** Five records, the shapes a dataset hands over — a Choice as a string. */
    const records = [
        { cll_industry: '1', label: 'Retail' },
        { cll_industry: '1', label: 'Retail' },
        { cll_industry: '2', label: 'Manufacturing' },
        { cll_industry: null, label: '' },
    ].map((row) => ({
        getValue: (column) => (column === 'cll_industry' ? row.cll_industry : null),
        getFormattedValue: () => row.label,
    }));

    const client = grouping.groupRecords(records, plan, '(blank)');

    // The same four records as the server would have aggregated them.
    const server = [
        { g0: 1, 'g0@OData.Community.Display.V1.FormattedValue': 'Retail', n: 2 },
        { g0: 2, 'g0@OData.Community.Display.V1.FormattedValue': 'Manufacturing', n: 1 },
        { n: 1 },
    ].map((row) => rows.toGroupReading(row, plan, '(blank)'));

    const shape = (readings) => readings.map((r) => [r.key, r.labels[0], r.count]).sort();

    // This is the assertion the whole seam exists for: a Choice is the string
    // "1" on one route and the number 1 on the other, and both have to produce
    // the same key or the routes disagree about what a group is.
    check('the same records, both routes, same keys and counts', shape(client), shape(server));
    check('and the browser route normalises "1" to 1', client.map((r) => r.values[0]).sort(), [1, 2, null]);
}

/* ------------------------------------------------------------- group ordering */

section('group ordering');

{
    const reading = (key, label, count) => ({ key, values: [key === '' ? null : Number(key)], labels: [label], count, measures: [], measureLabels: [] });

    const unsorted = [
        reading('4', 'Technology', 2),
        reading('1', 'Retail', 5),
        reading('', '(blank)', 9),
        reading('2', 'Manufacturing', 3),
    ];

    // Measured: the platform sorts an OptionSet by its LABEL. Retail is option
    // value 1 and Manufacturing is 2, and ascending puts Manufacturing first.
    // Ordering headers by option value would contradict the rows below them.
    check('by label, not by option value',
        grouping.sortGroups(unsorted, 'label').map((r) => r.labels[0]),
        ['Manufacturing', 'Retail', 'Technology', '(blank)']);

    check('the blank group sorts last whatever the order',
        grouping.sortGroups(unsorted, 'count').map((r) => r.labels[0]),
        ['Retail', 'Manufacturing', 'Technology', '(blank)']);
}

/* ------------------------------------------------------------- expanding */

section('expanding a group is a filter');

{
    const choice = fx.aliasPlan(spec(['cll_industry']));

    check('a choice group expands to one Equal condition',
        grouping.expandConditions({ values: [1] }, choice),
        [{ attributeName: 'cll_industry', conditionOperator: 0, value: '1' }]);

    check('a blank group expands to Null, which takes no value',
        grouping.expandConditions({ values: [null] }, choice),
        [{ attributeName: 'cll_industry', conditionOperator: 12, value: '' }]);

    const two = fx.aliasPlan(spec(['cll_industry', 'cll_priority']));

    check('two group columns mean two conditions',
        grouping.expandConditions({ values: [1, 2] }, two).length, 2);

    // A kind that cannot be spelled gets no chevron rather than a dead one.
    const dated = fx.aliasPlan({ entity: 'cll_account', primaryId: 'cll_accountid', groups: [{ column: 'cll_startdate', kind: 'date' }], measures: [] });

    check('a date group cannot be expanded, so it is refused',
        grouping.expandConditions({ values: ['2026-09-01'] }, dated), null);

    const bad = fx.aliasPlan({ entity: 'cll_account', primaryId: 'cll_accountid', groups: [{ column: 'cll_tags', kind: 'unsupported' }], measures: [] });

    check('and so is an unsupported one', grouping.expandConditions({ values: ['x'] }, bad), null);
}

/* ------------------------------------------------------ what may be grouped */

section('what may be grouped, and measured');

{
    check('a choice groups', types.groupKindFor('OptionSet'), 'choice');
    check('a lookup groups', types.groupKindFor('Lookup.Customer'), 'lookup');

    // Measured: the server refuses this, and its refusal carries an
    // unsubstituted {0}, so the question is never asked.
    check('a multi-select does not', types.groupKindFor('MultiSelectPicklist'), 'unsupported');
    check('nor does anything unrecognised', types.groupKindFor('Whatever.New'), 'unsupported');

    // Measured: sum/avg over a primary key refuses the WHOLE query.
    check('sum needs a numeric column', types.measurableWith('OptionSet', 'sum'), false);
    check('and accepts one', types.measurableWith('Currency', 'sum'), true);
    check('min accepts a date, which is how M measures were proven', types.measurableWith('DateAndTime.DateAndTime', 'min'), true);
    check('but sum does not', types.measurableWith('DateAndTime.DateAndTime', 'sum'), false);
}

/* ------------------------------------------- a message fit to show a maker */

section('a server message fit to show a maker');

{
    check('an ordinary refusal renders',
        fx.isRenderableMessage('Aggregate AVG or SUM is not supported for attribute of type primarykey.'), true);

    // Measured: the multi-select refusal arrived with its parameter never
    // substituted. Rendering it verbatim shows somebody a formatting
    // placeholder, which reads as a bug in this control.
    check('a message with an unsubstituted placeholder does not',
        fx.isRenderableMessage('The specified XML file "{0}" is not valid as attribute of type multiselect optionset is not allowed as groupby attribute.'), false);

    check('nor does an empty one', fx.isRenderableMessage('   '), false);
}


/* --------------------------------------------------------- the parent lookup */

section('resolving the subgrid\'s parent');

{
    const parent = load('data/parent');
    const data = load('data/GroupData');

    const reading = (over) => Object.assign({
        record: { entityType: 'account', id: '7de84297-9486-ec11-93b0-000d3a5c8441' },
        explicit: null,
        candidates: () => Promise.resolve(['cll_customer']),
        confirmed: () => null,
    }, over);

    const resolved = [];
    const run = (label, over, expected) => resolved.push(
        parent.resolveParentLookup(reading(over)).then((r) => check(label, [r.column, r.by], expected)),
    );

    run('the maker naming a column wins', { explicit: 'cll_other' }, ['cll_other', 'explicit']);
    run('the maker saying "none" means no condition at all', { explicit: 'none' }, [null, 'unrelated']);
    run('exactly one candidate settles it', {}, ['cll_customer', 'only-candidate']);
    run('no candidates withholds the route', { candidates: () => Promise.resolve([]) }, [null, 'no-candidates']);
    run('a metadata read that rejects is not an error', { candidates: () => Promise.reject(new Error('403')) }, [null, 'no-candidates']);

    // Measured 2026-09-20, before the subgrid was switched to related-records
    // only: every lookup carried by the rows pointed elsewhere, the table held
    // 56 and the subgrid reported 56. No condition is the right answer.
    run('every candidate denied by the rows means an unrelated subgrid',
        { candidates: () => Promise.resolve(['a_id', 'b_id']), confirmed: () => false }, [null, 'unrelated']);

    // The branch the probe environment could not reach: two lookups to the
    // same table. SPEC.md records it as unmeasured.
    run('two candidates the rows cannot separate withholds the route',
        { candidates: () => Promise.resolve(['a_id', 'b_id']), confirmed: () => null }, [null, 'unresolved']);
    run('two candidates, one confirmed by the rows',
        { candidates: () => Promise.resolve(['a_id', 'b_id']), confirmed: (c) => c === 'b_id' }, ['b_id', 'rows']);

    pending.push(Promise.all(resolved));

    /*
     * Withhold, or send no condition? Both arrive as `column: null`, and the
     * whole difference is `by` — measured 2026-09-20 with neither candidate
     * loaded: the fixed reader answers `unresolved` and withholds, the old one
     * answered `unrelated` and counted the whole table. Same configuration,
     * opposite behaviour, one word apart.
     */
    const res = (by, column) => ({ by, column, candidates: [] });

    check('unresolved withholds the route', parent.withholdsRoute(res('unresolved', null)), true);
    check('no-candidates withholds it too', parent.withholdsRoute(res('no-candidates', null)), true);
    check('unrelated does NOT — the rows said so, and no condition is the right answer',
        parent.withholdsRoute(res('unrelated', null)), false);
    check('a resolved column never withholds', parent.withholdsRoute(res('rows', 'cll_site')), false);
    check('nor does an explicit one', parent.withholdsRoute(res('explicit', 'cll_site')), false);

    /* rowsConfirm is three-valued, and the middle value is the point. */
    const row = (value) => ({ getValue: () => value });
    const ID = '7de84297-9486-ec11-93b0-000d3a5c8441';
    const ref = { etn: 'account', id: { guid: ID }, name: 'Adventure Works (sample)' };

    const IN = ['c'];

    check('the measured EntityReference shape confirms', parent.rowsConfirm([row(ref), row(ref)], 'c', ID, IN), true);
    check('a bare GUID confirms too', parent.rowsConfirm([row(ID)], 'c', ID, IN), true);
    check('braces and case are ignored', parent.rowsConfirm([row('{7DE84297-9486-EC11-93B0-000D3A5C8441}')], 'c', ID, IN), true);
    check('a row pointing elsewhere denies', parent.rowsConfirm([row(ref), row({ id: { guid: 'other' } })], 'c', ID, IN), false);

    /*
     * A loaded column that is empty **denies** — the row genuinely points
     * nowhere.
     */
    check('a loaded but empty lookup denies', parent.rowsConfirm([row(null)], 'c', ID, IN), false);

    /*
     * And the distinction that stops `unrelated` firing on a column the view
     * simply did not load.
     *
     * **Measured 2026-09-20: `getValue` cannot tell these apart.** It answers
     * `null` for an unloaded column, for a column that does not exist on the
     * table, and for an empty one alike — so the question is asked of the
     * dataset's column list instead. The first version asked `getValue` and
     * denied every unfetched candidate, which is how a resolver ends up
     * counting the whole table through the branch meant to be safe.
     */
    check('a column the dataset did not load cannot speak',
        parent.rowsConfirm([row(ref)], 'missing', ID, IN), null);
    check('even when its value would have confirmed',
        parent.rowsConfirm([row(ref)], 'missing', ID, []), null);
    check('nor can no rows at all', parent.rowsConfirm([], 'c', ID, IN), null);
    check('nor can a getValue that throws',
        parent.rowsConfirm([{ getValue: () => { throw new Error('x'); } }], 'c', ID, IN), null);

    /* A server message, and whether it may be shown. */
    check('a payload fault is reduced to its sentence',
        data.messageOf({ message: 'Outer\nInnerException : middle\nInnerException : Aggregate AVG or SUM is not supported.\nat X' }),
        'Aggregate AVG or SUM is not supported.');
    check('a refusal that can be shown', data.refusalOf({ message: 'Record Is Unavailable' }).renderable, true);
    check('and one that cannot, because the server left {0} in it',
        data.refusalOf({ message: 'The specified XML file "{0}" is not valid.' }).renderable, false);
}


/* ------------------------------------------------------- the export machine */

section('the full-view export machine');

{
    const collect = load('export/collect');
    const restore = { page: 3, pageSize: 5 };
    const row = (id) => [id, 'x'];

    const started = collect.begin(['A', 'B'], restore);

    check('it begins waiting for page one', [started.phase, started.awaitingPage, started.nextPage],
        ['collecting', 1, 1]);

    const firstArrival = collect.harvest(started, ['a', 'b', 'c'], row);
    const first = firstArrival.state;

    check('a harvest reports a page and takes its rows', firstArrival.kind, 'page');
    check('it clears the wait and advances',
        [first.rows.length, first.awaitingPage, first.nextPage], [3, null, 2]);

    /*
     * **The dedupe, which is not belt-and-braces.** A host without
     * `loadExactPage` falls back to `loadNextPage(true)`, which on the measured
     * platform returns the whole range from page one — so page two arrives
     * holding pages one and two, and a naive append doubles the first page.
     */
    const second = collect.harvest(first, ['a', 'b', 'c', 'd'], row).state;

    check('an accumulating host does not double-count', second.rows.length, 4);
    check('and arrival order is kept', second.rows.map((r) => r[0]), ['a', 'b', 'c', 'd']);

    /*
     * **The 250 rows this cost.** Measured on a real form, 2026-09-21: an
     * export started from page 2 wrote 972 of 1,222 records, missing one whole
     * page out of the middle with the tail intact and no duplicates.
     *
     * `beginExport` calls `setPageSize(250)` and then `loadExactPage(1)`, and
     * the platform answered with two `updateView` passes rather than one. Both
     * satisfied `shouldHarvest`. The second still held page one, the dedupe ate
     * all of it — and the old `harvest` advanced the page counter regardless,
     * so page two was never asked for.
     *
     * A pass that brings nothing new is not the page that was asked for. It
     * must not advance, and it must not ask again, because a request is already
     * outstanding.
     */
    const repeat = collect.harvest(second, ['a', 'b', 'c', 'd'], row);

    check('a pass carrying only rows already held is a repeat, not a page',
        repeat.kind, 'repeat');
    check('and it leaves the wait in place, so the page is still asked for',
        [second.awaitingPage, second.nextPage], [null, 3]);

    const waiting = { ...second, awaitingPage: 3 };
    const stillWaiting = collect.harvest(waiting, ['a', 'b'], row);

    check('the same holds while a page is genuinely outstanding',
        stillWaiting.kind, 'repeat');

    /*
     * A page that arrives empty is the end of the view, not a repeat — treating
     * it as a repeat would wait on a page that is never coming.
     */
    check('an empty page ends the export', collect.harvest(second, [], row).kind, 'end');

    /*
     * The one case that must still count as a page: a partial overlap. An
     * accumulating host hands back pages 1..N, so a real new page always
     * carries something new alongside what is already held.
     */
    check('a partial overlap is a real page',
        collect.harvest(second, ['a', 'b', 'c', 'd', 'e'], row).kind, 'page');

    /* Which page to ask for next, counted and uncounted. */
    /*
     * 300 rows at a page size of 250 is two pages. The first version of this
     * used 250 and expected page two to be offered — which is one page, so the
     * refusal was right and the assertion was wrong. Worth keeping the
     * arithmetic visible.
     */
    check('with a known total it offers the last page',
        collect.nextPageFor({ ...second, nextPage: 2 }, true), 2);
    check('and refuses to go past it',
        collect.nextPageFor({ ...second, nextPage: 3 }, false), null);
    check('a view inside one page never loops',
        collect.nextPageFor({ ...second, cancelled: true }, true), null);

    /*
     * `totalResultCount` is **-1 when the platform declines to count** — a real
     * state, not an error. Then there is no last page to compute and the loop
     * runs on `hasNextPage` instead.
     */
    check('uncounted, it follows hasNextPage',
        collect.nextPageFor({ ...second, nextPage: 9 }, true), 9);
    check('and stops when the platform says there is no more',
        collect.nextPageFor({ ...second, nextPage: 9 }, false), null);

    check('a cancelled export asks for nothing more',
        collect.nextPageFor({ ...second, cancelled: true }, true), null);

    /* The ceiling. */
    const many = { ...started, rows: new Array(collect.EXPORT_MAX_ROWS).fill(['x']) };

    check('the ceiling stops the loop', collect.nextPageFor(many, true), null);

    /*
     * **The round-trip ceiling, which the row ceiling stopped covering.** The
     * export reads at the view's own page size now, and a subgrid's default was
     * measured at four on a real form — 1,222 records in 306 requests. At that
     * size the row ceiling alone would permit 2,500.
     */
    const deep = { ...started, nextPage: collect.EXPORT_MAX_PAGES + 1 };

    check('and so does the round-trip ceiling', collect.nextPageFor(deep, true), null);
    check('one page short of it still walks',
        collect.nextPageFor({ ...started, nextPage: collect.EXPORT_MAX_PAGES }, true),
        collect.EXPORT_MAX_PAGES);
    check('a capped run is reported as capped', collect.wasCapped(deep), true);
    check('and is reported, so the completion message can say so', collect.wasCapped(many), true);
    check('an ordinary export is not capped', collect.wasCapped(second), false);

    /*
     * The re-entry guard. `updateView` fires on every dataset change including
     * the ones this machine caused, so without it the export asks for the same
     * page forever.
     */
    check('a pass harvests only when a page was asked for and has landed',
        collect.shouldHarvest(started, false), true);
    check('not while the platform is still loading',
        collect.shouldHarvest(started, true), false);
    check('not when nothing is outstanding',
        collect.shouldHarvest(first, false), false);
    check('and never when the machine is idle',
        collect.shouldHarvest({ phase: 'idle' }, false), false);

    check('the restore point survives every transition',
        collect.restorePlan(second), restore);
}

/* ------------------------------------------------------------------ report */

Promise.all(pending).then(function () {
console.log('');

if (failed > 0) {
    console.log('  ' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
}

console.log('  ' + passed + ' passed — the grouping decisions only; the control calling them correctly is npm run smoke');
});
