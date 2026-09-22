/*
 * The view the dev harness binds: columns and records, chosen for the edges.
 *
 * **This is not `demo/records.json`, and the difference is deliberate.** That
 * one is the hub's demo fixture — it exists to look like a working control on a
 * public page, so it is tidy, short and fits on one screen. This one exists to
 * break things:
 *
 *   - **twelve records**, so a page size of five gives three pages. The single
 *     page the hub's harness supplies is why every dataset control in the
 *     catalogue is stuck at `fidelity: "limited"`, and it is the reason paging
 *     code has never been exercised anywhere before this file.
 *   - **a hidden column and columns out of order**, because `isHidden` and
 *     `order` are the maker's decisions in the view designer and a table that
 *     ignores either looks broken to whoever set them.
 *   - **a non-sortable column**, which a real view has and a hand-written
 *     fixture never does.
 *   - **a null value and an empty string in the same column**, the two that
 *     catch a cell renderer treating falsy as empty.
 *   - **a name long enough to overflow**, because column widths are decided by
 *     `visualSizeFactor` and nobody finds out until a customer has a long one.
 *   - **a numeric and a date column**, because a filter row chooses its
 *     operator from `dataType`, and a fixture of nothing but text exercises one
 *     branch of that choice and calls it covered. `revenue` also carries a
 *     `null` and a `0` — the two a falsy check cannot tell apart.
 *   - **two Choice columns holding integers, and a lookup holding a
 *     reference** — the shapes the platform actually hands over, measured
 *     2026-09-11. Until 0.4.0 both held label strings, which is why no
 *     scaffolded control had ever seen a choice cell read `3` or a lookup
 *     cell read `{ id: { guid }, etn, name }`. `statecode` is the choice the
 *     platform refuses to edit; `industrycode` is the one it allows. Their
 *     option lists live in `metadata` below, in the two shapes the metadata
 *     node was measured carrying, so the rig's `getEntityMetadata` can serve
 *     one of each.
 *
 * Loaded by `preview.html` in a browser and by `smoke.js` in Node, so it
 * assigns both ways and depends on neither.
 */

(function (root, factory) {
    'use strict';

    var fixture = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = fixture;
    }

    if (root) {
        root.__pcfFixture = fixture;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    return {
        targetEntityType: 'account',
        title: 'Active Accounts',

        /*
         * What `utils.getEntityMetadata('account', [column]).Attributes.get(
         * column)` carries for each Choice and Lookup column, in the shapes
         * measured on a model-driven subgrid 2026-09-11 — not the shape the
         * reference page or `pcf-kanban-board` describe.
         *
         * `shape: 'descriptor'` is `attributeDescriptor.OptionSet`, an array
         * of `{ Label, Value, IsHidden }` in the maker's order. `shape: 'map'`
         * is the node's own `OptionSet`, a **map keyed by value** of `{ text,
         * value }` with no `Options` array on it. A real node carries both;
         * the rig serves one per column so a control reading only one of the
         * two is caught by the other. `targets` is `Targets` for a lookup.
         */
        metadata: {
            statecode: {
                shape: 'descriptor',
                options: [
                    { value: 0, label: 'Active' },
                    { value: 1, label: 'Inactive' },
                ],
            },
            industrycode: {
                shape: 'map',
                options: [
                    { value: 1, label: 'Retail' },
                    { value: 2, label: 'Manufacturing' },
                    { value: 3, label: 'Services' },
                    { value: 4, label: 'Technology' },
                ],
            },
            ownerid: { targets: ['systemuser'] },

            /*
             * The two lookups `withLookups()` adds. **`descriptorOnly`
             * reproduces a measured asymmetry**: on the probe table a
             * `Lookup.Simple` carried `Targets` at the top of the node and
             * again under `attributeDescriptor`, while the `Lookup.Customer`
             * carried it only under the descriptor — the top-level key was
             * `undefined`. A reader that stops at the top level gets `[]` for
             * every Customer lookup and offers no dialog. SPEC.md 0.4.0 (4).
             */
            primarycontactid: { targets: ['contact'] },
            parentcustomerid: { targets: ['account', 'contact'], descriptorOnly: true },
        },

        /**
         * What `EntityDefinitions(...)/ManyToOneRelationships` returns for the
         * bound table, reduced to the three fields a lookup write needs.
         *
         * **The navigation property is not derivable and this is why it is a
         * table.** Measured 2026-09-13: `cll_primarycontact`'s was its logical
         * name, not the schema-cased `cll_PrimaryContact` the first design
         * assumed — and the Customer lookup had **two**, one per target,
         * `<column>_account` and `<column>_contact`. The rig serves these
         * through a same-origin `fetch`, because that is the only route a
         * control has: `context.webAPI` cannot address `EntityDefinitions`.
         */
        relationships: [
            { column: 'primarycontactid', target: 'contact', navigationProperty: 'primarycontactid' },
            { column: 'parentcustomerid', target: 'account', navigationProperty: 'parentcustomerid_account' },
            { column: 'parentcustomerid', target: 'contact', navigationProperty: 'parentcustomerid_contact' },
            { column: 'ownerid', target: 'systemuser', navigationProperty: 'ownerid' },
        ],

        /**
         * The tables a lookup can point at: entity set name — the plural the
         * `@odata.bind` value is spelled with, off `getEntityMetadata(table)
         * .EntitySetName` — and the rows a pick can land on. A bind to a GUID
         * not listed here is refused the way the platform refused one:
         * "The requested record was not found." (2147746327).
         */
        related: {
            contact: {
                entitySet: 'contacts',
                rows: [
                    { id: 'c1e84297-9486-ec11-93b0-000d3a5c8441', name: 'Dana Whitfield' },
                    { id: 'c2e84297-9486-ec11-93b0-000d3a5c8441', name: 'Ravi Menon' },
                    { id: 'c3e84297-9486-ec11-93b0-000d3a5c8441', name: 'Susanna Stubberod' },
                ],
            },
            account: {
                entitySet: 'accounts',
                rows: [
                    { id: 'a1e84297-9486-ec11-93b0-000d3a5c8441', name: 'Adventure Works' },
                    { id: 'a2e84297-9486-ec11-93b0-000d3a5c8441', name: 'Fabrikam' },
                ],
            },
            systemuser: {
                entitySet: 'systemusers',
                rows: [
                    { id: 'b3f1a0c2-0000-4000-8000-000000000001', name: 'Sam Vaziri' },
                    { id: 'b3f1a0c2-0000-4000-8000-000000000002', name: 'Jo Park' },
                ],
            },
        },

        /**
         * The view with two visible lookups on it — a `Lookup.Simple` to
         * contact and a `Lookup.Customer` to account-or-contact — for the
         * lookup-editing suite. **A separate shape rather than two more columns
         * on `columns`**, because the pinning assertions count cells per row
         * and the screenshots are framed for the eight that are there.
         */
        withLookups: function () {
            var self = this;
            var contacts = self.related.contact.rows;
            var accounts = self.related.account.rows;

            return {
                columns: self.columns.concat([
                    {
                        name: 'primarycontactid',
                        // Not 'Primary contact': the text column above already has that
                        // heading, and dev/preview.html finds a cell by its heading.
                        displayName: 'Contact',
                        dataType: 'Lookup.Simple',
                        alias: 'primarycontactid',
                        order: 9,
                        visualSizeFactor: 140,
                    },
                    {
                        name: 'parentcustomerid',
                        displayName: 'Customer',
                        dataType: 'Lookup.Customer',
                        alias: 'parentcustomerid',
                        order: 10,
                        visualSizeFactor: 140,
                    },
                ]),
                records: self.records.map(function (row, index) {
                    var values = {};

                    Object.keys(row.values).forEach(function (name) {
                        values[name] = row.values[name];
                    });

                    // Every row but the last carries a contact; the last is
                    // empty, so clearing an empty cell has a row to try on.
                    var contact = contacts[index % contacts.length];

                    values.primarycontactid = index === self.records.length - 1
                        ? null
                        : { id: { guid: contact.id }, etn: 'contact', name: contact.name };
                    // Alternating targets, so the Customer column has both
                    // navigation properties in play on one page.
                    var customer = index % 2 === 0 ? accounts[0] : contacts[1];

                    values.parentcustomerid = {
                        id: { guid: customer.id },
                        etn: index % 2 === 0 ? 'account' : 'contact',
                        name: customer.name,
                    };

                    return { id: row.id, values: values };
                }),
            };
        },

        /*
         * `order` is not the array order, on purpose: a view's columns arrive
         * in whatever order the platform hands them over and carry their
         * intended position in `order`. A control that renders them as supplied
         * looks correct against a fixture that agrees with itself and wrong
         * against a real view.
         */
        columns: [
            {
                name: 'accountnumber',
                displayName: 'Account number',
                dataType: 'SingleLine.Text',
                alias: 'accountnumber',
                order: 1,
                visualSizeFactor: 120,
            },
            {
                name: 'name',
                displayName: 'Account name',
                dataType: 'SingleLine.Text',
                alias: 'name',
                order: 0,
                visualSizeFactor: 200,
                isPrimary: true,
            },
            {
                name: 'statecode',
                displayName: 'Status',
                dataType: 'OptionSet',
                alias: 'statecode',
                order: 3,
                visualSizeFactor: 90,
            },
            {
                name: 'primarycontactname',
                displayName: 'Primary contact',
                dataType: 'SingleLine.Text',
                alias: 'primarycontactname',
                order: 2,
                visualSizeFactor: 150,
                // A computed or joined column a view can carry and a user
                // cannot order by. Its absence from a fixture is why a control
                // that renders every header as a sort button ships that way.
                disableSorting: true,
            },
            /*
             * A numeric and a date column, because a filter row picks its
             * operator from `dataType` and a fixture of nothing but text
             * exercises exactly one branch of that choice. `revenue` is what a
             * `GreaterThan` is built over; `modifiedon` is what `On`,
             * `OnOrBefore` and `OnOrAfter` are built over, and its values
             * straddle 2026-03-01 so that each of the three narrows to a
             * different count. They are held as the platform hands them over
             * — measured 2026-09-11, a DateOnly column reads as the ISO string
             * `2026-08-31T00:00:00.000Z`, its day at **UTC midnight** — so a
             * reader that takes local components sees the previous day west
             * of Greenwich, here as on a form.
             */
            {
                name: 'revenue',
                displayName: 'Annual revenue',
                dataType: 'Currency',
                alias: 'revenue',
                order: 4,
                visualSizeFactor: 110,
            },
            {
                name: 'modifiedon',
                displayName: 'Modified on',
                dataType: 'DateAndTime.DateOnly',
                alias: 'modifiedon',
                order: 5,
                visualSizeFactor: 110,
            },
            {
                name: 'ownerid',
                displayName: 'Owner',
                dataType: 'Lookup.Simple',
                alias: 'ownerid',
                order: 6,
                visualSizeFactor: 120,
                // Present in the view and not to be drawn. A table that ignores
                // this shows a column the maker deliberately turned off.
                isHidden: true,
            },
            /*
             * The Choice column the platform *allows* an edit on, where
             * `statecode` above is the one it refuses — `isEditable` answers
             * `false` for state and status, measured 2026-09-11, and nothing
             * in `dataType` tells the two apart. Both are `OptionSet`.
             */
            {
                name: 'industrycode',
                displayName: 'Industry',
                dataType: 'OptionSet',
                alias: 'industrycode',
                order: 7,
                visualSizeFactor: 110,
            },
            /*
             * A date *and time*, held as the instant the platform reads back —
             * `2026-09-01T04:30:00.000Z` on the measured subgrid, shown there as
             * 8/31/2026 11:30 PM to a user five hours west. The column the
             * `datetime-local` editor opens on; `modifiedon` above is the
             * date-only one.
             */
            {
                name: 'lastcontacted',
                displayName: 'Last contacted',
                dataType: 'DateAndTime.DateAndTime',
                alias: 'lastcontacted',
                order: 8,
                visualSizeFactor: 130,
            },
        ],

        records: [
            { id: 'a01', values: { name: 'Fabrikam Manufacturing', accountnumber: 'ACC-1042', primarycontactname: 'Dana Whitfield', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000001' }, etn: 'systemuser', name: 'Sam Vaziri' }, industrycode: 2, revenue: 4200000, modifiedon: '2026-01-14T00:00:00.000Z', lastcontacted: '2026-01-14T15:30:00.000Z' } },
            { id: 'a02', values: { name: 'Contoso Logistics', accountnumber: 'ACC-1087', primarycontactname: 'Ravi Menon', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000001' }, etn: 'systemuser', name: 'Sam Vaziri' }, industrycode: 3, revenue: 1850000, modifiedon: '2026-02-03T00:00:00.000Z', lastcontacted: '2026-02-03T09:00:00.000Z' } },
            { id: 'a03', values: { name: 'Northwind Traders', accountnumber: 'ACC-1103', primarycontactname: 'Erin Boyle', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000002' }, etn: 'systemuser', name: 'Jo Park' }, industrycode: 1, revenue: 960000, modifiedon: '2025-11-22T00:00:00.000Z', lastcontacted: '2025-11-22T18:45:00.000Z' } },
            { id: 'a04', values: { name: 'Adventure Works Cycles', accountnumber: 'ACC-1155', primarycontactname: 'Marcus Feld', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000002' }, etn: 'systemuser', name: 'Jo Park' }, industrycode: 2, revenue: 7300000, modifiedon: '2026-03-18T00:00:00.000Z', lastcontacted: '2026-03-18T13:15:00.000Z' } },
            { id: 'a05', values: { name: 'Litware Consulting', accountnumber: 'ACC-1178', primarycontactname: 'Priya Raman', statecode: 1, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000002' }, etn: 'systemuser', name: 'Jo Park' }, industrycode: 3, revenue: 210000, modifiedon: '2025-09-30T00:00:00.000Z', lastcontacted: null } },
            { id: 'a06', values: { name: 'Tailspin Toys', accountnumber: 'ACC-1201', primarycontactname: 'Owen Brackett', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000001' }, etn: 'systemuser', name: 'Sam Vaziri' }, industrycode: 1, revenue: 1450000, modifiedon: '2026-01-07T00:00:00.000Z', lastcontacted: '2026-01-07T22:00:00.000Z' } },
            { id: 'a07', values: { name: 'Proseware Systems', accountnumber: 'ACC-1233', primarycontactname: 'Alice Nakamura', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000002' }, etn: 'systemuser', name: 'Jo Park' }, industrycode: 4, revenue: 3050000, modifiedon: '2026-02-25T00:00:00.000Z', lastcontacted: '2026-02-25T08:30:00.000Z' } },
            { id: 'a08', values: { name: 'Wingtip Analytics', accountnumber: 'ACC-1260', primarycontactname: 'Tomas Ehrlich', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000001' }, etn: 'systemuser', name: 'Sam Vaziri' }, industrycode: 4, revenue: 880000, modifiedon: '2025-12-11T00:00:00.000Z', lastcontacted: '2025-12-11T17:00:00.000Z' } },

            // The edges start here.

            // A column with no value at all, which is not the same as one with
            // an empty string — and both reach `getFormattedValue`.
            { id: 'a09', values: { name: 'Blue Yonder Airlines', accountnumber: null, primarycontactname: '', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000002' }, etn: 'systemuser', name: 'Jo Park' }, industrycode: null, revenue: null, modifiedon: '2026-03-01T00:00:00.000Z', lastcontacted: '2026-03-01T04:30:00.000Z' } },

            // Long enough to overflow whatever width `visualSizeFactor` bought.
            { id: 'a10', values: { name: 'Consolidated Messenger Intercontinental Freight and Warehousing', accountnumber: 'ACC-1288', primarycontactname: 'Margarethe Kowalczyk-Fitzgerald', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000001' }, etn: 'systemuser', name: 'Sam Vaziri' }, industrycode: 2, revenue: 12500000, modifiedon: '2026-04-02T00:00:00.000Z', lastcontacted: '2026-04-02T11:00:00.000Z' } },

            // Leading punctuation and a lowercase start: the two that show a
            // sort comparing raw strings rather than formatted values.
            { id: 'a11', values: { name: '(pending) Woodgrove Bank', accountnumber: 'ACC-0007', primarycontactname: 'Ines Duarte', statecode: 1, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000002' }, etn: 'systemuser', name: 'Jo Park' }, industrycode: 3, revenue: 0, modifiedon: '2025-08-19T00:00:00.000Z', lastcontacted: '2025-08-19T20:15:00.000Z' } },
            { id: 'a12', values: { name: 'école Numérique', accountnumber: 'ACC-1310', primarycontactname: 'LucRousseau', statecode: 0, ownerid: { id: { guid: 'b3f1a0c2-0000-4000-8000-000000000001' }, etn: 'systemuser', name: 'Sam Vaziri' }, industrycode: 4, revenue: 640000, modifiedon: '2026-03-27T00:00:00.000Z', lastcontacted: '2026-03-27T14:00:00.000Z' } },
        ],

        /*
         * The view definitions, keyed by table then by id, as
         * `retrieveRecord('savedquery', id, '?$select=fetchxml')` answers them.
         *
         * **Copied from a real view on 2026-09-20** rather than written, and
         * the reason is the ordering: the `<order>` and `<filter>` sit
         * *between* the `<attribute>` elements, not after them, because the
         * view designer emits them where the maker put them. A fixture with
         * them tidily at the end would pass a rewriter that drops half a view.
         *
         * The `<link-entity>` is here for the same reason: `stripView` has to
         * take a linked table's attributes out too, at depth, or the aggregate
         * is refused — and it has to leave the link itself alone, because a
         * filter through it is what the view meant.
         *
         * Only `savedquery` is served. A `userquery` id 404s, which is how a
         * control learns to try the second table.
         */
        views: {
            savedquery: {
                '50901766-ba1b-46e0-850b-e1a3991ade2e':
                    '<fetch version="1.0" mapping="logical" savedqueryid="50901766-BA1B-46E0-850B-E1A3991ADE2E">'
                    + '<entity name="account">'
                    + '<attribute name="accountid"/><attribute name="name"/>'
                    + '<order attribute="name" descending="false"/>'
                    + '<filter type="and"><condition attribute="statecode" operator="eq" value="0"/></filter>'
                    + '<attribute name="industrycode"/><attribute name="revenue"/>'
                    + '<link-entity name="systemuser" from="systemuserid" to="ownerid">'
                    + '<attribute name="fullname"/></link-entity>'
                    + '</entity></fetch>',
            },
        },
    };
});
