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
 *
 * Loaded by `harness.html` in a browser and by `smoke.js` in Node, so it
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
             * `GreaterThan` is built over; `modifiedon` is the column that gets
             * no filter input at all, because the date operators are not
             * documented as supported on both hosts.
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
        ],

        records: [
            { id: 'a01', values: { name: 'Fabrikam Manufacturing', accountnumber: 'ACC-1042', primarycontactname: 'Dana Whitfield', statecode: 'Active', ownerid: 'Sam Vaziri', revenue: 4200000, modifiedon: '2026-01-14' } },
            { id: 'a02', values: { name: 'Contoso Logistics', accountnumber: 'ACC-1087', primarycontactname: 'Ravi Menon', statecode: 'Active', ownerid: 'Sam Vaziri', revenue: 1850000, modifiedon: '2026-02-03' } },
            { id: 'a03', values: { name: 'Northwind Traders', accountnumber: 'ACC-1103', primarycontactname: 'Erin Boyle', statecode: 'Active', ownerid: 'Jo Park', revenue: 960000, modifiedon: '2025-11-22' } },
            { id: 'a04', values: { name: 'Adventure Works Cycles', accountnumber: 'ACC-1155', primarycontactname: 'Marcus Feld', statecode: 'Active', ownerid: 'Jo Park', revenue: 7300000, modifiedon: '2026-03-18' } },
            { id: 'a05', values: { name: 'Litware Consulting', accountnumber: 'ACC-1178', primarycontactname: 'Priya Raman', statecode: 'Inactive', ownerid: 'Jo Park', revenue: 210000, modifiedon: '2025-09-30' } },
            { id: 'a06', values: { name: 'Tailspin Toys', accountnumber: 'ACC-1201', primarycontactname: 'Owen Brackett', statecode: 'Active', ownerid: 'Sam Vaziri', revenue: 1450000, modifiedon: '2026-01-07' } },
            { id: 'a07', values: { name: 'Proseware Systems', accountnumber: 'ACC-1233', primarycontactname: 'Alice Nakamura', statecode: 'Active', ownerid: 'Jo Park', revenue: 3050000, modifiedon: '2026-02-25' } },
            { id: 'a08', values: { name: 'Wingtip Analytics', accountnumber: 'ACC-1260', primarycontactname: 'Tomas Ehrlich', statecode: 'Active', ownerid: 'Sam Vaziri', revenue: 880000, modifiedon: '2025-12-11' } },

            // The edges start here.

            // A column with no value at all, which is not the same as one with
            // an empty string — and both reach `getFormattedValue`.
            { id: 'a09', values: { name: 'Blue Yonder Airlines', accountnumber: null, primarycontactname: '', statecode: 'Active', ownerid: 'Jo Park', revenue: null, modifiedon: '2026-03-01' } },

            // Long enough to overflow whatever width `visualSizeFactor` bought.
            { id: 'a10', values: { name: 'Consolidated Messenger Intercontinental Freight and Warehousing', accountnumber: 'ACC-1288', primarycontactname: 'Margarethe Kowalczyk-Fitzgerald', statecode: 'Active', ownerid: 'Sam Vaziri', revenue: 12500000, modifiedon: '2026-04-02' } },

            // Leading punctuation and a lowercase start: the two that show a
            // sort comparing raw strings rather than formatted values.
            { id: 'a11', values: { name: '(pending) Woodgrove Bank', accountnumber: 'ACC-0007', primarycontactname: 'Ines Duarte', statecode: 'Inactive', ownerid: 'Jo Park', revenue: 0, modifiedon: '2025-08-19' } },
            { id: 'a12', values: { name: 'école Numérique', accountnumber: 'ACC-1310', primarycontactname: 'LucRousseau', statecode: 'Active', ownerid: 'Sam Vaziri', revenue: 640000, modifiedon: '2026-03-27' } },
        ],
    };
});
