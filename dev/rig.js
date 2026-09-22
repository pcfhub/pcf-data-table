/*
 * The rig, asserted against the platform it stands in for.
 *
 *     npm run rig
 *
 * A stand-in host is the one file in a repository that nothing else checks.
 * `dev/smoke.js` drives the control *through* it, so a rig that is wrong in
 * the same direction as the control produces a green suite and a broken form —
 * which is how five separate defects reached production from this repository's
 * own history (SPEC.md 0.3.x).
 *
 * So these assertions point the other way: they check that `dev/host.js`
 * reproduces **what a real server actually sent**, and every expected value
 * here was read off a live subgrid on 2026-09-20 (SPEC.md 0.6.0) rather than
 * decided here. Where the platform and the documentation disagree, these
 * follow the platform.
 *
 * The four that chart-view's rig does not have, each a shape a control would
 * otherwise get wrong on a form while passing locally: an `AttributeName`
 * annotation on every alias, a `FormattedValue` on the count, a lookup's
 * `lookuplogicalname`, and `min`/`max` over dates.
 *
 * And the one that matters most for paging: **`loadExactPage` and
 * `loadNextPage(true)` behave differently and are now modelled differently.**
 * Treating them alike was the rig applying one method's misbehaviour to both.
 */

const fixture = require('./fixture.js');
const host = require('./host.js');

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok    ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n          got      ' + a + '\n          expected ' + e); }
};

const h = (opts) => host.createHost(fixture, Object.assign({ getString: (k) => k }, opts || {}));

(async () => {
  /*
   * **The rig's input list against the manifest's.**
   *
   * `dev/host.js` builds a parameter for every property the manifest declares,
   * because the platform does and a control may read any of them. But it reads
   * no manifest — the list is kept in step by hand, and a property added there
   * and forgotten here is a control that **throws in this suite and works on a
   * form**. That happened twice in one release, both times discovered as a
   * crash rather than as a failure, which is the wrong way round: a rig should
   * fail an assertion, not take the suite down.
   */
  console.log('');
  console.log('the rig knows every property the manifest declares');
  {
    const xml = require('fs').readFileSync('DataTable/ControlManifest.Input.xml', 'utf8');
    const declared = (xml.match(/<property [^>]*>/g) || [])
      .filter((tag) => tag.indexOf('usage="input"') > -1)
      .map((tag) => (/name="([^"]+)"/.exec(tag) || [])[1])
      .filter(Boolean);
    const known = Object.keys(h().context.parameters);
    const missing = declared.filter((name) => known.indexOf(name) === -1);

    check('every declared input reaches the control as a parameter',
      { declared: declared.length, missing }, { declared: declared.length, missing: [] });
  }

  console.log('\nthe rig answers an aggregate the way the server did');
  const api = h().context.webAPI;
  const xml = "<fetch aggregate='true'><entity name='account'>"
    + "<attribute name='industrycode' groupby='true' alias='g0'/>"
    + "<attribute name='accountid' aggregate='count' alias='n'/></entity></fetch>";
  const r = await api.retrieveMultipleRecords('account', '?fetchXml=' + xml);
  const rows = r.entities;

  const withG0 = rows.filter((x) => Object.prototype.hasOwnProperty.call(x, 'g0'));
  const blank = rows.filter((x) => !Object.prototype.hasOwnProperty.call(x, 'g0'));

  check('a group per distinct value, plus one blank', [withG0.length, blank.length], [4, 1]);
  check('the blank group omits its alias entirely, and its annotations', Object.keys(blank[0]).sort(),
    ['n', 'n@OData.Community.Display.V1.AttributeName', 'n@OData.Community.Display.V1.FormattedValue']);
  check('a Choice group is an integer, not a string', typeof withG0[0].g0, 'number');
  check('every group alias carries AttributeName', withG0.every((x) => x['g0@OData.Community.Display.V1.AttributeName'] === 'industrycode'), true);
  check('and a FormattedValue', typeof withG0[0]['g0@OData.Community.Display.V1.FormattedValue'], 'string');
  check('the count alias carries one too', typeof rows[0]['n@OData.Community.Display.V1.FormattedValue'], 'string');

  console.log('\na lookup group carries its target table');
  const lx = "<fetch aggregate='true'><entity name='account'>"
    + "<attribute name='ownerid' groupby='true' alias='g0'/>"
    + "<attribute name='accountid' aggregate='count' alias='n'/></entity></fetch>";
  const lr = (await api.retrieveMultipleRecords('account', '?fetchXml=' + lx)).entities;
  check('the value is a bare GUID', /^[0-9a-f-]{36}$/.test(lr[0].g0), true);
  check('the third annotation names the target', lr[0]['g0@Microsoft.Dynamics.CRM.lookuplogicalname'], 'systemuser');
  check('and the label is the name', lr[0]['g0@OData.Community.Display.V1.FormattedValue'], 'Sam Vaziri');

  console.log('\nmeasures');
  const mx = "<fetch aggregate='true'><entity name='account'>"
    + "<attribute name='industrycode' groupby='true' alias='g0'/>"
    + "<attribute name='revenue' aggregate='sum' alias='m0'/>"
    + "<attribute name='revenue' aggregate='avg' alias='m1'/>"
    + "<attribute name='lastcontacted' aggregate='min' alias='m2'/>"
    + "<attribute name='accountid' aggregate='count' alias='n'/></entity></fetch>";
  const mr = (await api.retrieveMultipleRecords('account', '?fetchXml=' + mx)).entities;
  const one = mr.filter((x) => x.g0 === 1)[0];
  check('two functions over one column both answer', [typeof one.m0, typeof one.m1], ['number', 'number']);
  check('min over a date answers an ISO string', typeof one.m2, 'string');
  const blankM = mr.filter((x) => !Object.prototype.hasOwnProperty.call(x, 'g0'))[0];
  check('a measure over no values is omitted while count stands', [Object.prototype.hasOwnProperty.call(blankM, 'm0'), blankM.n], [false, 1]);

  console.log('\nthe refusals');
  const refused = await h({ quirks: { aggregateRefused: true } }).context.webAPI
    .retrieveMultipleRecords('account', '?fetchXml=' + xml).then(() => null, (e) => e);
  check('aggregateRefused rejects in the payload-fault shape', [refused.errorCode, typeof refused.message], [2147164195, 'string']);
  const limited = await h({ quirks: { aggregateLimit: 3 } }).context.webAPI
    .retrieveMultipleRecords('account', '?fetchXml=' + xml).then(() => null, (e) => e.errorCode);
  check('aggregateLimit reaches the same refusal on a small fixture', limited, 2147164195);

  console.log('\nthe view definition');
  const view = await h().context.webAPI.retrieveRecord('savedquery', '50901766-ba1b-46e0-850b-e1a3991ade2e', '?$select=fetchxml');
  check('savedquery answers', /^<fetch /.test(view.fetchxml), true);
  const miss = await h().context.webAPI.retrieveRecord('userquery', '50901766-ba1b-46e0-850b-e1a3991ade2e', '?$select=fetchxml').then(() => null, (e) => e.errorCode);
  check('userquery 404s, as measured', miss, 2147746327);
  const unread = await h({ quirks: { viewsReadable: false } }).context.webAPI
    .retrieveRecord('savedquery', '50901766-ba1b-46e0-850b-e1a3991ade2e', '?$select=fetchxml').then(() => null, (e) => e.errorCode);
  check('viewsReadable off makes it unreadable', unread, 2147746327);
  check('getViewId answers bare and lower-case', h().context.parameters.records.getViewId(), '50901766-ba1b-46e0-850b-e1a3991ade2e');
  check('and null where the host has no view', h({ quirks: { viewId: null } }).context.parameters.records.getViewId(), null);

  console.log('\npaging: the two methods model differently, as measured');
  const p = h({ pageSize: 5 });
  const ds = () => p.context.parameters.records;
  ds().paging.loadExactPage(2);
  check('loadExactPage does not accumulate', ds().sortedRecordIds.length, 5);
  check('and sets hasPreviousPage', ds().paging.hasPreviousPage, true);
  ds().paging.reset();
  ds().paging.loadNextPage(true);
  check('loadNextPage still accumulates, as measured on the stepping call', ds().sortedRecordIds.length, 10);
  check('and still strands hasPreviousPage', ds().paging.hasPreviousPage, false);

  console.log('');
  if (fail > 0) { console.log('  ' + fail + ' failed, ' + pass + ' passed'); process.exit(1); }
  console.log('  ' + pass + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
