# Data Table

A sortable, filterable table over any Dataverse view, with inline editing and pinned columns.

## What it does

Binds a dataset and renders it as a semantic HTML table with a pager, sortable
headers and optional row selection. The decision that shaped everything else is
that it declares **no `property-set` roles**: a property-set is a fixed-arity
declaration, so a role-based table is capped at whatever N the manifest
hard-codes, and roles carry none of the `order`, `visualSizeFactor`, `isPrimary`
or `disableSorting` a layout actually needs. Those live on real view columns. So
the control reads `dataset.columns` and renders the view as the maker arranged
it.

## What was verified

Commands run on Windows 11, Node 22.13.1, against
`@types/powerapps-component-framework@1.3.18`.

| Step | Result |
| --- | --- |
| `npm run refreshTypes` | Succeeded. `IInputs.records` typed as `ComponentFramework.PropertyTypes.DataSet`; four inputs and two outputs generated as declared. |
| `npm run lint` | Clean, no output. |
| `npm run check` | "Template adopted, pcfhub.json readable, control shape agrees with the manifest, docs named correctly, media present." |
| `npm run smoke` | 130 assertions, all passing. |
| `npm run build` | `out/controls/DataTable/bundle.js`, **177,021 bytes** (173 KiB), development mode. Webpack externals `Reactv16` and `FluentUIReactv940`. |
| `msbuild /t:build /restore /p:configuration=Release /p:PcfAlwaysNpmRunBuild=true` | **41,347 bytes** packed — 0.8% of the 5 MB web-resource ceiling. `Solution.zip` 29,304 bytes, `Solution_managed.zip` 29,305 bytes. |

The two bundle figures are different builds, not the same one measured twice —
only the msbuild pack compiles in production mode. The production bundle opens
`/*! For license information … */` followed by one long minified line, which is
how to tell the two apart by eye.

Bundle externals confirmed by grep rather than by assumption:
`grep -c 'griffel\|react-dom.production'` returns **0**, and both
`Reactv16` and `FluentUIReactv940` appear as externals. React and Fluent really
are coming from the platform.

`demo/` is absent from the packed solution. **This was originally recorded here
as confirming the `<ExcludeDirectories Include="…\demo\**" />` line added to
`DataTable.pcfproj`, and that was wrong** — an absence attributed to a cause
that had never been tested against its own absence. Corrected 2026-08-21, when
building `pcf-compact-list` made it cheap to run the control case:

| Pack | `demo/` in the zip? |
| --- | --- |
| `pcf-compact-list`, **with** the line | No — 8 files |
| `pcf-compact-list`, **line deleted** | No — 8 files |
| `pcf-tag-list`, which never had the line | No — 12 files, 15,124 bytes |
| `pcf-tag-list`, line added | No — 12 files, 15,124 bytes |

The pack takes `out/controls/<Control>/**` plus the solution XMLs, and never
considers loose project files — so `demo/` was never a candidate and there was
nothing for the exclude to exclude. The `<None Include>` / `ExcludeDirectories`
pair shapes the msbuild *project*'s item list, which is not what gets packaged.

The line is harmless and worth keeping for uniformity, but do not cite it, or
this repository's zip, as the reason a fixture is not shipping. The template's
comment on that entry repeated the same claim and has been corrected too.

## What the build disagreed with

**Nothing.** The first `npm run build` compiled clean, which is worth recording
precisely because three things were expected to need casts and did not:

- `dataset.sorting.push({ name, sortDirection })` type-checks against the
  `SortDirection` numeric union with no cast. `SortDirection` is
  `-1 | 0 | 1` (None / Ascending / Descending) — a type, not an importable enum
  object, so there is no `SortDirection.Ascending` to reference. The constants in
  `components/resolve.ts` exist for that reason.
- **`context.fluentDesignLanguage?.tokenTheme` needs no cast.** This contradicts
  the comment in `pcf-choices-picker/ChoicesPicker/index.ts:112-124`, which says
  the property "is absent from `@types/powerapps-component-framework` … so
  reaching it needs a cast". In 1.3.18 it is present:
  `componentframework.d.ts:792` declares `fluentDesignLanguage?: FluentDesignState`,
  with `tokenTheme: Theme` on it. The cast choices-picker carries is now
  redundant rather than wrong, and the skill's copy of the same claim has been
  corrected.
- `paging.loadNextPage(true)`, `loadPreviousPage(true)`, `reset()`,
  `setPageSize()`, `loadExactPage()`, `totalResultCount`, `firstPageNumber` and
  `setSelectedRecordIds()` are all present on the installed types.

## Platform behaviour worth knowing

**`dataset.sorting` is `undefined` in the local test harness, and the types say
it is required.** So `dataset.sorting.find(...)` throws, and this control
rendered as nothing at all under `npm start` from its first release until the
`?? []` in `sortFor` and the guard in `sortBy` landed. Verified against
`pcf-start` 1.51.1: the harness's dataset mock literally sets `sorting: void 0`,
alongside `hasNextPage: false`, `hasPreviousPage: false`, `loading: false`,
`error: false`, and paging mutators that are `console.log` calls and nothing
else — so `setPageSize(25)` logs as `Invoked method loadNextPage on Paging
interface. Parameters: 25.` and moves no data.

Being virtual is what made it findable: React's error boundary reported the
TypeError in the console. The standard dataset variant in `_template` hit the
same crash and the harness swallowed it completely — blank control, empty
console.

This is general rather than specific to this control, and it now lives in the
skill's `SKILL.md` under *Prove it with the dev rig*. `dev/smoke.js` asserts it
here through the `sortingAbsent` quirk, and that assertion renders the returned
element with `react-dom/server` rather than only reading its props — a virtual
control's component body does not run until something renders it, so a
props-only check passes against the broken control. That was found the hard way,
on this repo.

**`updateView` fires on every dataset change, including the ones this control
caused.** For a field control that shows up as a jumping caret. For a dataset
control it is an infinite loop, because a dataset has mutators:

`setPageSize()` does nothing until the next fetch, so it has to be followed by
`refresh()` — and `refresh()` fires `updateView`. The guard has to be on a
control-instance field (`this.appliedPageSize`), **not** on `ds.paging.pageSize`,
because the platform's own value will not equal the requested one until the
refresh lands, so comparing against it re-fires at least once more. If the
platform also clamps the request, comparing against it never converges at all.

**`loadNextPage()` with no argument is infinite scroll, not paging.** Read from
the type definition, which says it "Returns results for the whole page range"
and documents `loadOnlyNewPage` as limiting the return value to the newly loaded
page. Called bare, `sortedRecordIds` accumulates pages 1..N and the table grows
instead of turning. Passing `true` is not an optimisation.

**Passing `true` is also not sufficient — the platform ignores it.** Corrected
2026-08-21. Observed on a real model-driven form against `pcf-compact-list`,
which makes the identical call: `loadNextPage(true)` from page 1 of a 6-record
view at page size 3 returned all six ids, and page 2 rendered under page 1. Two
things came with it. `hasPreviousPage` stayed false after paging forward, so
Previous never unlocked and there was no way back — the platform treats the load
as the *range* pages 1..N, and a range beginning at page 1 truthfully has
nothing before it. And `firstPageNumber` reported 2 while the ids held both
pages, which is how the list printed "4–9 of 6".

This control had all three and they were never noticed here, because nothing
below a real environment can page: the demo harness serves one page. What is now
in `index.ts` is the local counter as the only page number, `this.page > 1`
gating Previous, `loadExactPage` preferred where the host has it, and
`pageIds()` slicing the accumulated array back to one page.

**`totalResultCount` is `-1` when the platform did not count**, which is common
on large views. `pagerLabel()` in `components/resolve.ts` falls back to naming
the page rather than printing "of -1".

**Slicing `sortedRecordIds` to the page size is normally wrong, and is what
`pageIds()` now does anyway.** The rule holds wherever the platform honours
`loadOnlyNewPage` — that array is then already the current page, and slicing
hides records it paged for. The demo tempts you into it for a different and
still-wrong reason: the harness serves all 24 fixture rows at once, which is why
the preset's `pageSize` is 25 rather than 10. The exception is the repair above,
and it is guarded on `ids.length > pageSize`, so on a platform that behaves it
does nothing at all.

**Sorting is server-side across every page.** `dataset.sorting` is a plain array
you mutate in place and then `refresh()`; it is the whole `ORDER BY`, so
replacing rather than appending is what stops three clicks building a three-deep
sort. A client-side sort would reorder the 25 rows on screen out of 240, which
is a wrong answer that looks completely right.

**`setSelectedRecordIds()` is not bookkeeping.** On a model-driven subgrid it is
the contract with the form's command bar — it is how the ribbon knows which
records to act on. The control keeps its own copy anyway, because the platform's
does not survive a refresh or a page change.

**`cds-data-set-options` is an attribute of `<data-set>`, not `<control>`.**
Worth stating because it is easy to assume otherwise — it configures the *host's*
chrome, which sounds like a control-level concern. `pcf-scripts`'
`ManifestSchema.json` settles it: the key appears only under
`definitions.dataSetAttribs`. Put it on `<control>` and the build rejects it.

Two further notes on it. The schema types the value as a **plain string**, so
the option names inside it are not validated — a misspelled `displayCommandBar`
compiles clean and silently does nothing. And Microsoft's own reference table
marks the attribute `Required: Yes`, which the tooling contradicts:
`dataSetAttribs.required` is `["name", "display-name-key"]`, and this control
built and packed without it for its first several builds. Treat it as optional
in fact and defaulting to off.

**The msbuild zips are named after the `.cdsproj` file, not the solution's
`<UniqueName>`.** The pack produces `Solution.zip` and `Solution_managed.zip`,
so `docs/installation.md` names those; the release workflow renames the
unmanaged one to `*_unmanaged.zip` to match the hub's default globs. A doc that
promised `DataTableSolution_managed.zip` would have been wrong from the first
release — and nothing would have caught it.

## Demo

`fidelity: "limited"`, and the reason is structural rather than a matter of
effort.

Nothing in this control leaves the browser, which is normally what earns `full`.
But three of its four features call back into the dataset, and the harness's
`DataSet` mock only simulates it. Read from
`pcfhub/resources/js/demo-harness/context/DataSet.ts`: `hasNextPage` and
`hasPreviousPage` are hard-coded `false`, `lastPageNumber` is `1`, and
`setPageSize` is an empty function with a comment saying a single-page fixture
has nothing to repaginate. And `main.ts`'s `renderView()` rebuilds the context on
every render, so `createDataSet` runs again and any mutation to
`dataset.sorting` or through `setSelectedRecordIds` is discarded.

So paging is inert, sorting moves the arrow but not the rows, selection does not
survive a re-render, and `openDatasetItem` logs a mock call. Each is named in
`demo.limitations`.

**The line between `limited` and `mocked`, stated once so the next control does
not have to rediscover it:** `pcf-tag-list` is `mocked` because its interactions
genuinely work against the fixture — a chip in the fixture can be clicked,
removed, and read back. This control is `limited` because its interactions call
*back into* a dataset the harness only pretends to own. "Is there a server" is
not the question; "can the harness answer truthfully" is.

The fixture sets `alias === name` on every column, which is a deliberate
departure from the rule `pcf-tag-list` established. That rule — give `name` a
realistic schema name distinct from the role `alias` — exists to catch the
property-set alias/name inversion. With no roles declared there is no second
candidate key, `alias` is never consulted, and `alias === name` is what a real
non-linked view column reports.

## On a real form

`media/screenshot-form.png` — named `media/screenshot.png` until 0.2.0 renamed
it — is the control on an Accounts subgrid, and it settles
several claims that were previously reasoned rather than observed:

- **`cds-data-set-options` works.** The platform's command bar — New, Refresh,
  the overflow menu — renders above the control. That is the host's chrome, not
  the control's, and it appears only because the attribute asks for it.
- **Paging is live.** The pager reads "1–5 of 6" with Previous disabled and Next
  enabled, against `pageSize` 5. So `setPageSize` took effect, the guard did not
  deadlock, and `hasNextPage`/`hasPreviousPage` are being reported.
- **`totalResultCount` came back counted** — 6, not `-1` — so the range branch of
  `pagerLabel()` is the one that rendered.
- **`dataset.getTitle()` resolves** to the view name ("Accounts").
- The sort control, its ascending indicator, the selection checkboxes and the
  primary-column open-record links all render.

What the screenshot does **not** settle is anything about the second page: it
shows page 1. That was called the sharpest open question here, and it was —
`pcf-compact-list` hit it on a real form on 2026-08-21 and the answer was the
bad one. See the paging notes above; this control had the same three faults and
has been corrected.

## Still open

### The canvas host, measured

Every surface below was asked about on a **real canvas app, 2026-09-22**, with
each method called through its owner. This replaces every inference this file
previously carried about canvas.

| Surface | Present | Called |
| --- | --- | --- |
| `page.getClientUrl` | yes | **throws** `Method not implemented.` |
| `utils.getEntityMetadata` | yes | **throws** `Method not implemented.` |
| `utils.lookupObjects` | yes | not called — would open a dialog |
| `webAPI.retrieveRecord` | yes | **throws** `Method not implemented.` |
| `webAPI.retrieveMultipleRecords` | yes | **throws** `Method not implemented.` |
| `webAPI.createRecord` / `updateRecord` / `deleteRecord` | yes | not called — would change data |
| `navigation.openForm` / `openFile` / `openAlertDialog` | yes | not called — would take the screen |
| `mode.trackContainerResize` | yes | works |
| `formatting.formatDateShort` / `formatCurrency` | yes | **works** |
| `dataset.getViewId` | yes | works, and answers **`undefined`** |

**Fifteen of fifteen are published.** `typeof x.method === 'function'` is true
of every one of them, so it is not a capability test on this host — it is a test
that always passes. Every gate in this estate built on it is wrong on canvas,
in the direction that offers a feature which can only fail.

What does work is **testing an answer rather than a method**. `getClientUrl`
refuses by *throwing*, and a thrown refusal is an answer once it is caught;
`clientUrlOf` is that test and `formOpener` now uses it. `lookupHost` was
accidentally safe from the same defect all along, because it needed a client-URL
*string*.

`dataset.getViewId` answering `undefined` is why the grouping route withholds
its server half here without any host check: no view id, no FetchXML to rewrite.

### Corrections this measurement forced

- **`Formatting` works on canvas**, as documented. The first probe run reported
  it throwing `Cannot read properties of undefined (reading '_formattingData')`
  — that was the probe calling the method **unbound**, so `this` was undefined
  inside the platform's own code. A probe that changes what it measures is
  worse than no probe. The `Method not implemented.` verdicts were unaffected
  only because those stubs throw before touching `this`, which is luck.
- **`dataset.getViewId` works**, for the same reason.
- **The rig had canvas backwards.** It modelled these surfaces as *absent*,
  which inverts the guard: a `typeof` test failed locally and passed on the
  platform. It now publishes and refuses, and the New-button defect surfaced on
  the first run after that landed.

### Still unmeasured

`createRecord`, `updateRecord`, `deleteRecord`, `openForm`, `openFile`,
`openAlertDialog` and `lookupObjects` are **published on canvas but were not
called**, because calling them would write data or take over the screen. Whether
they throw or do something worse is unknown, and a probe that damages the thing
it measures is not a measurement. Presence is enough to condemn any `typeof`
gate built on them.

### The estate

`pcf-chart-view`, `pcf-calendar-view`, `pcf-kanban-board`,
`pcf-attachment-list`, `pcf-geo-stamp` and `pcf-row-commands` all still model
canvas as absent in their rigs, and all gate features on `typeof`. Given
`canCreate` was wrong here, expect the same in at least `pcf-row-commands`
(Delete, gated on `webAPI`) and `pcf-geo-stamp` (the photo button, gated on
`webAPI.createRecord` **and** `utils.getEntityMetadata` — both published here).

- **Canvas publishes every surface and refuses on the call.** Measured with the
  host probe on a real canvas app, 2026-09-22. **All fifteen surfaces asked
  about came back `present: true`** — `webAPI.retrieveRecord`,
  `webAPI.updateRecord`, `navigation.openForm`, `utils.lookupObjects`, the lot —
  and the ones safe to call threw `Method not implemented.` from the call
  itself.

  **So `typeof x.method === 'function'` is not a capability test on canvas.** It
  is true of everything. Every gate in this estate built on it is wrong there,
  and wrong in the direction that offers a feature which can only fail.

  The one discriminator that does work is **an answer, not a method**:
  `page.getClientUrl` refuses by *throwing*, and a thrown refusal is an answer
  once it is caught. `clientUrlOf` is that test, and `formOpener` now uses it.

- **The New button was drawn on canvas.** `canCreate` gated on
  `typeof navigation.openForm === 'function'`, which passes there, so the
  control offered a quick create that could only refuse.
  `docs/canvas.md` had asserted since 0.4.0 that this could not happen because
  "`navigation.openForm` is not on this host" — and the second half of that
  sentence was never true. Fixed and mutation-tested.

  `lookupHost` was accidentally safe from the same defect, because it needed a
  **client URL string** rather than a method. That accident is now the pattern.

- **Two of the probe's first verdicts were the probe's own bug.** It captured
  `formatting.formatDateShort` into a variable and called it unbound, so the
  platform answered `Cannot read properties of undefined (reading
  '_formattingData')` — which reads exactly like a refusal and is nothing of
  the kind. `Formatting` works on canvas, as documented. Every call in the
  probe now goes through its owner; the `Method not implemented.` verdicts were
  unaffected because those stubs throw before touching `this`, which is luck
  rather than design.

- **The rig modelled canvas by omitting these surfaces**, which inverted the
  guard: a `typeof` test *failed* locally and *passed* on the platform. It now
  publishes and refuses. That correction is what surfaced the New button, on
  the first run after it landed.

- **The other repositories' rigs still omit them.** `pcf-chart-view`,
  `pcf-calendar-view`, `pcf-kanban-board`, `pcf-attachment-list`,
  `pcf-geo-stamp` and `pcf-row-commands` all model canvas as absent, so any
  `typeof`-gated feature in them is unasserted in the direction that matters.
  **This is the next sweep**, and it is now a measurement rather than a theory.

- **The host-surface probe exists, and it already corrected the rig.**
  `DataTable/probe.ts`, parked on `window.__pcfDataTableProbe`:

      await __pcfDataTableProbe.hosts()

  It reports, per surface, what the documentation claims and what the host
  actually does — `WORKS`, `ABSENT`, `REJECTS` or **`THROWS (synchronously)`**.
  Only the last gets past a `typeof x === 'function'` guard, which is the whole
  reason it exists.

  **It reads and never writes.** `createRecord`, `updateRecord` and
  `deleteRecord` would change data in the environment it runs in, and
  `openForm`, `openFile` and `lookupObjects` would take over the screen — none
  are called, and the report says *PRESENT, NOT CALLED* with the reason rather
  than leaving a blank that reads like a pass. The safe reads are genuinely
  attempted, because "it exists" and "it works" are the two answers this exists
  to tell apart.

  Run against the rig's canvas host (`?host=canvas` in the preview) it came
  back with `mode.trackContainerResize: THROWS` — **a refusal this rig had
  invented**. It was added on the assumption that canvas refuses every optional
  surface; Microsoft's reference gives `Mode` an *Available for* of
  "Model-driven apps, canvas apps, & portals", and the control called it
  unguarded in `init` through 0.6.11 on a canvas app that then errored in
  `updateView` — so `init` had completed. The rig now models it working. **A
  harsher rig invents defects as surely as a friendlier one hides them**, and
  this is the first time this estate has made that mistake in that direction.

  Consequence worth stating: the `ask()` around `trackContainerResize` is
  cheap insurance rather than a fix, and its earlier mutation test no longer
  demonstrates anything. `formatDateShort` is the same — documented available.

- **`WebAPI` and `Navigation` remain unmeasured on canvas.** The rigs model
  them absent; the probe will say which. That is the last open question of this
  class, and it is one run away.

- **`probe.ts` and its import in `index.ts` come out before the tag.**

- **What the documentation actually says, read 2026-09-22.** Every API
  reference page carries an *Available for* section, and it is authoritative
  about **whether** a surface works. It says nothing about **how it fails**,
  which is the half that broke this control.

  | Surface | Available for | Canvas |
  | --- | --- | --- |
  | `WebAPI` (`retrieveRecord`, `updateRecord`, …) | Model-driven apps & portals | no |
  | `Utility` (`getEntityMetadata`, `lookupObjects`) | Model-driven apps | no |
  | `Navigation` (`openForm`, `openFile`) | Model-driven apps | no |
  | `Mode` (`trackContainerResize`) | Model-driven, canvas & portals | **yes** |
  | `Formatting` (`formatDateShort`, `formatCurrency`) | Model-driven and canvas | **yes** |

  `page.getClientUrl` appears nowhere in the reference — it is undocumented,
  which is its own warning.

  Two corrections follow. **`trackContainerResize` is documented available on
  canvas**, which confirms the deduction made from the lifecycle ordering rather
  than resting on it. And **`formatDateShort` is documented available**, so the
  fallback added to it is belt-and-braces rather than a fix; it is kept because
  it costs nothing and preserves behaviour where the platform answers.

- **"Not available for canvas" is implemented as publish-and-refuse, not as
  absent.** Measured: `utils.getEntityMetadata` and `page.getClientUrl` both
  *exist* on canvas and throw `Method not implemented.` from the call.

  That generalises further than this control has assumed. **Every
  model-driven-only surface in the table above is a candidate**, which makes
  `typeof x.method === 'function'` an unreliable capability test for all of
  them — not just the two that were caught. A control gating a feature on
  `typeof context.webAPI?.updateRecord === 'function'` would *offer* that
  feature on canvas and fail on use.

  **`WebAPI` and `Navigation` have not been measured this way.** Both are
  documented model-driven-only; whether canvas omits them or publishes them
  refusing is unknown, and the rigs across the estate model them as absent —
  which is the friendlier of the two and therefore the one that hides defects.
  This is the next thing to measure, and it should be measured rather than
  reasoned about.

- **Canvas publishes platform methods and refuses to run them, and the refusal
  is synchronous.** Two seen in two builds, 2026-09-21 —
  `getClientUrl: Method not implemented.` and then, one build later,
  `getEntityMetadata: Method not implemented.` Fixing the first did not fix the
  second; it revealed it.

  **`typeof … === 'function'` is a test of the wrong thing.** A method existing
  is not a promise that it works, and a *synchronous* throw is not a rejected
  promise anybody can catch — it escapes the call, escapes `updateView`, and the
  studio renders *Error loading control* in place of the table.

  Every eager call is now hardened: `page.getClientUrl` and
  `mode.trackContainerResize` through `ask()`, `dataset.getViewId` the same, and
  `utils.getEntityMetadata` through a Promise executor that turns a synchronous
  throw into the rejection its callers were already written for. The rejection
  is **not** swallowed — a refused read must stay distinguishable from a column
  with no options, which `dev/smoke.js` asserts.

  `formatting.formatDateShort` is hardened defensively rather than on a
  measurement: it runs inside render, and it now falls back to the browser's own
  formatting. Whether canvas actually refuses it is **unmeasured**.

  The rig modelled canvas by *omitting* `page` and `utils`, which is a friendlier
  host than the platform and is why none of this was caught. Both are now
  published and refusing.

- **The rendering suite cannot see this class of defect on its own.**
  `renderDeep` is `react-dom/server` and runs no effects, so the first
  assertion written for the metadata refusal rendered the control, never called
  `loadOptions`, and passed against the broken build. The assertion that works
  calls it and checks the refusal arrives as a rejection rather than a throw.

- **Worth a sweep across the estate.** Any control guarding an optional platform
  method by `typeof` alone has this defect shape, and on canvas it is fatal
  rather than degrading.

- **A canvas app published `page.getClientUrl` and threw when it was called**,
  which took the whole control down with *Error loading control*. Reported from
  a real studio, 2026-09-21. `lookupHost` probes for it on every `updateView`
  pass, and the guard was `typeof … === 'function'` — a test of the wrong
  thing, because **a method existing is not a promise that it works**. The probe
  now takes a refusal for an answer, and canvas gets the read-only lookup cell
  it was always documented to get.

  `dev/host.js` said `page` was simply *absent* on canvas, which is why nothing
  caught it — the rig was a friendlier host than the platform for the seventh
  time. It now publishes the object and throws the platform's own message.
  Mutation-tested: without the fix the suite dies with
  `getClientUrl: Method not implemented.`

  **Worth a sweep across the estate.** Any control guarding an optional
  platform method by `typeof` alone has this defect shape, and it is fatal
  rather than degrading.

- **A zero page size drew one row.** Canvas shows an unset whole number as `0`,
  `applyPageSize` clamped it with `Math.max(raw, 1)`, and the reader got twenty
  rows fetched and one drawn. The comment beside `paging.pageSize` had said
  `0` means "the host did not say" since 0.2.0; the property's clamp disagreed
  with it. Zero and negatives now adopt the host.

- **`pcf-chart-view` does *not* carry the defects this repository attributed to
  it, and that claim was made twice.** Checked line by line, 2026-09-21: its
  call site guards `rowsConfirm` against an unfetched column
  (`columns.has(column) ? … : null`), and its consumer withholds the server
  route on any unresolved parent while letting `by: 'unrelated'` through — which
  is exactly what `withholdsRoute` encodes here. What produced the false alarm
  was a doc comment on `rowsConfirm` claiming a guarantee the *caller* provides;
  that comment is now accurate.

  The one real difference stands and is a robustness point rather than a bug:
  this control takes the fetched-column list as a parameter, so the guard cannot
  be forgotten by a future caller. Chart-view's call site is correct, and a
  shipped control is not worth churning for symmetry.

- **Taking the 0.6.0 screenshots found three defects no assertion could
  reach**, each one correct markup drawn wrongly:

  1. **Two aggregates over one column rendered as one.** The group row picked
     its measure with `findIndex`, so `sum:revenue, avg:revenue` drew the sum
     and dropped the average silently. `aliasPlan` had supported M measures over
     one column since the first commit; only the rendering could not.
  2. **Measures on the browser route were computed and never labelled.**
     `groupRecords` initialised `measureLabels` to empty strings and nothing
     filled them, so a grouped **canvas** table — where that is the only route —
     showed right answers in blank cells. It looked fine on a model-driven form
     because the server route brings formatted values back with the FetchXML.
  3. **A sorted column could show no sort arrow at all.** The heading button is
     a flex container and `text-overflow: ellipsis` does nothing to flex
     *children*, so a heading wider than its column carried the arrow and rank
     out past the cell's `overflow: hidden`. Measured: "Annual revenue" in a
     107px column put its arrow at x=717 inside a cell ending at 708. Markup,
     `aria-sort` and accessible name were all correct throughout.

  All three now have assertions; the third is guarded in `dev/styles.js`,
  because nothing that reads the DOM can see a clipped element. **This is the
  argument for the screenshot step**, and it is the same argument the export
  made for tracing: some classes of defect are only visible by looking.

- **`dev/host.js`'s string table had drifted and nothing noticed.** Every 0.6.0
  key was missing, so the first grouped capture rendered `DataTable_GroupExpand`
  where the words should be. The file's own comment had predicted that failure
  in those words. It is now generated from the `.resx` and guarded both ways —
  a key the source asks for that the rig cannot resolve, and a value that has
  drifted from what ships.

  The first version of that guard had a hole the exact shape of the bug: it
  matched only literals sitting directly inside `getString(`, and the component
  asks for those two keys through a ternary.

- **Screenshots are reproducible now.** `npm run shots` retakes all eight from
  `dev/preview.html`, measuring each one's rendered height first so the picture
  is tight. `media/screenshot-form.png` is deliberately excluded: only a real
  form has a command bar, so it is stale by version and kept on purpose.

- **The multi-sort capture seeds the sort rather than clicking it.** A click
  refreshes the dataset and rebuilds the header row, so a headless capture
  raced the re-render and photographed one arrow of two — through three
  attempts at fixing the timing. `?sorted=` opens on an already-ordered view,
  which has no race and is the more honest picture anyway.

- **The export works, and costs one request per page at the view's page size.**
  Confirmed on a real subgrid, 2026-09-21: 1,222 of 1,222 records. The subgrid
  pages at **four**, so it took **306 requests**. Correct, bounded and slow.

  `EXPORT_MAX_PAGES = 500` now bounds the round trips, because the 10,000-row
  ceiling stopped bounding cost the moment the export stopped resizing — at four
  rows a page it would have permitted 2,500.

- **Whether a page size applied at load is safe has not been measured.** The
  resize that broke paging was applied *mid-session*, after the reader had
  already paged. `applyPageSize` calls `setPageSize` when the `pageSize`
  property is set, at first render and before any paging has happened, and the
  page-size picker calls it later. Neither has been watched on the form where
  the mid-session resize failed. If a load-time page size is safe, setting
  `pageSize` to 100 turns 306 requests into 13 and is the whole answer to the
  cost; if it is not, the picker has the same defect as the export had.

  **This is the one remaining question, and it should be measured rather than
  reasoned about.**

- **A view too large to read a page at a time wants a different route
  entirely.** `data/GroupData.ts` already reads a view's FetchXML and calls
  `retrieveMultipleRecords`; a 5,000-row page through the Web API would be one
  request rather than 306. It needs `WebAPI`, the parent resolver and a
  model-driven host, so it is a 0.7.0 shape rather than a patch.

- **The export raised the page size, and that was the whole bug.** Traced on a
  real subgrid, 2026-09-21, across two builds. After `setPageSize(250)`:
  `loadExactPage(1)` was honoured — 250 rows, `pageSize` 250, `hasNextPage`
  true, `totalResultCount` 1222 — and everything after it failed.
  `loadExactPage(2)` was ignored; `loadNextPage(true)` threw into the
  platform's own global error handler, which then failed parsing an empty
  response. Both left page one's rows and `loading: false`.

  The same view pages perfectly from the control's own pager, and `goToPage`
  calls the identical methods. **The resize was the only difference.** So the
  export no longer resizes: it walks the view at the page size already in
  effect, through the same call the reader's pager uses, and restores only the
  page.

  `quirks.pagingBreaksAfterResize` models it. Mutation-tested, and the mutation
  reproduces *both* historical failures from the one cause — putting the resize
  back gives **9 of 12 rows** on one host and **40 passes, 0 files** on the
  other, which are the short file and the stall respectively.

- **The cost is round trips, and it is now the reader's page size that sets
  them.** 1,222 records at 25 a page is 49 requests rather than 5. Bounded by
  `EXPORT_MAX_ROWS`, the page counter and Stop; mitigated by a maker offering a
  larger page through `pageSizeOptions`. No measurement of how that feels on a
  slow connection.

- **Four fixes were shipped on inference before anyone instrumented.**
  `firstPageNumber`, then page size, then the stale-pass theory, then stepping
  instead of jumping — each one reasoned from a CSV and a network tab, each one
  wrong, and the third built on a premise (`skipped: false`, `pageSize: 250` on
  the first pass) that one trace line disproved outright. Where a feature's
  correctness depends on what the platform does *between* lifecycle calls, the
  rig cannot be asked and reasoning does not substitute. Instrument first.

- **`goToPage` may carry the same weakness.** It jumps with `loadExactPage`,
  which is fine at the reader's own page size — but the page-size picker calls
  `setPageSize`, and nothing has watched a multi-page jump after one.

- **`traceExport` and its `console.log`s are scaffolding and come out before the
  tag.**

- **`loadExactPage` was the cause all along, and two fixes were shipped before
  anyone looked.** Traced on a real subgrid, 2026-09-21: `loadExactPage(1)` was
  honoured — 250 rows, `pageSize` 250, `hasNextPage` true, `totalResultCount`
  1222 — and `loadExactPage(2)` was not. The platform re-rendered holding page
  one, left `firstPageNumber` at 1 and reported `loading: false`. It was not
  fetching and nothing more came.

  That one fact explains both failures. The stall is direct. The earlier short
  file — 972 of 1,222, holding pages one, three, four and five — is the same
  refusal before the guards existed: an ignored request was harvested as though
  it had answered, the counter advanced past a page nobody asked for again, and
  whichever later jumps happened to land left the gaps. **No spurious
  page-size pass was ever involved**; the trace shows `skipped: false` and
  `pageSize: 250` on the very first pass, so the theory two fixes were built on
  was wrong in its premise.

  The walk now steps with `loadNextPage` and only page one and the restore use
  `loadExactPage`. `quirks.exactPageIgnored` models the measured host;
  mutation-tested, restoring the jump gives 40 passes and 0 files, which is
  exactly what the reader saw.

  **The lesson is the expensive one.** Three fixes were shipped on inference
  about what the platform hands back between passes, and each was wrong. One
  line of tracing per pass settled it in a single run. Where a feature's
  correctness depends on platform behaviour between lifecycle calls, instrument
  first — the rig cannot be asked about behaviour nobody has watched.

- **The two measurements of `loadExactPage` disagree and nobody knows why.**
  The 2026-09-20 probe watched it land for n = 1..8; the 2026-09-21 trace
  watched it ignored at n = 2. Page size, record count and view all differ
  between them. The export no longer depends on the answer, but `goToPage` still
  does.

- **`traceExport` and its `console.log`s are scaffolding and come out before the
  tag.**

- **The export reaches page one and stops, and nobody knows why yet.** Measured
  on a real subgrid, 2026-09-21: 0.6.6 collected page one cleanly — 250 rows,
  contiguous, no contamination from the page-size pass — then waited for page
  two and never got it. Two fixes have now been shipped on inference about what
  the platform hands back between passes (`firstPageNumber`, then page size) and
  **both were wrong**. 0.6.7 stops guessing and logs one line per pass instead:
  ids, first and last id, page size, `firstPageNumber`, `hasNextPage`,
  `totalResultCount`, `loading`, and the decision taken. `traceExport` comes out
  before the tag.

- **A repeat pass starved the watchdog, which is why the stall was silent.**
  `driveExport` cleared the watchdog at the top of every pass and re-armed it on
  every `repeat`, so a host that kept re-rendering while a page failed to land
  pushed the thirty seconds out indefinitely. The watchdog now belongs to the
  request: only `askForExportPage` and `finishExport` touch it. Mutation-tested
  — restoring the re-arm leaves 0 files 40 seconds after the request.

  This is why the previous round read as "nothing happens": the stall had no
  bound at all, so the failure path that would have written a partial file and
  named the page was never reached.

- **0.6.5's export fix was wrong, and shipped.** It gated the harvest on
  `paging.firstPageNumber` — a declared platform property that had never been
  measured, and which SPEC.md said so about in the same breath as relying on
  it. On a real subgrid, 2026-09-21, the export stalled on page two: when pages
  accumulate the platform keeps reporting the *first* page held, so every page
  after the first failed the check. `dev/host.js`'s own comment beside that
  getter had said exactly this for weeks.

  Two further defects only became visible because of it. The watchdog set
  `phase: 'failed'` and called `notifyOutputChanged()` — which announces
  *outputs* changed and gives the platform no reason to call `updateView` — so
  a stalled export recorded its failure, rendered nothing and wrote no file.
  `cancelExport` had the same shape, which is why Stop did nothing at all.
  Both now finish the export where they stand. This is the `pcf-kanban-board`
  loader lesson, reached a second time from the other direction: **anything set
  outside `updateView` must carry itself to completion.**

  The gate is now the page size, a fact the export sets itself, and it is
  bounded — **at most one pass may be discarded**, and the request is re-issued
  when it is, so it cannot strand an export on a host that sent no spurious
  pass. All three fixes are mutation-tested: removing them gives, respectively,
  9 of 12 rows, 0 files, and 0 files.

- **The remaining unmeasured assumption is that only one pass is ambiguous.**
  It rests on the export asking for the next page only after folding in the
  current one, so exactly one request is ever outstanding. That is true of this
  code; whether a platform can interleave two answers to one request is not
  something anyone has watched.

- **The export lost a page, and the rig could not have caught it.** Measured on
  a real form, 2026-09-21: a full-view export over 1,222 records wrote 972 — one
  whole page missing from the middle, tail intact, no duplicates. `beginExport`
  calls `setPageSize` then `loadExactPage(1)`, the platform answers each with an
  `updateView`, and the first arrives before any fetch has landed. The machine
  counted it as page one and asked for page two; the real page one then arrived
  and was counted as page two, so **page three was requested while page two was
  still in flight — and the platform serves only the latest request**, so page
  two was never delivered.

  Two things now stand between that and a short file. `harvest` refuses to
  advance on a pass that brings nothing new, and — the one that actually catches
  this shape — it checks `paging.firstPageNumber` against the page it asked for,
  so a pass carrying *genuinely new* rows from the wrong page is still refused.
  Both are mutation-tested; removing either turns the rig's twelve rows into
  nine.

  The rig needed three separate corrections before it could reproduce any of
  it: `setPageSize` emitted no `updateView` at all, `renderOwed` was a flag so
  two owed passes collapsed into one, and fetches were queued and all delivered
  in order — which gives a one-pass lag that *cancels* an off-by-one in the
  caller. `quirks.asyncFetch` models the real thing: one fetch outstanding, a
  new one supersedes it, and the superseded page never arrives.

- **`asyncFetch` is off by default, so the other features have not been
  re-verified under it.** 168 assertions were written against synchronous
  fetches. The export turns it on because the export is the only feature whose
  correctness depends on fetch timing — but "no other feature depends on it" is
  reasoning, not a measurement.

- **Whether `firstPageNumber` is trustworthy mid-export is unmeasured.** It is
  declared by the platform and the control now relies on it for the export
  only. A host reporting it wrongly would stall the export into a named
  watchdog failure rather than a short file, which is the right way round, but
  nobody has watched one do it.


- **Paging past page 1 is unobserved *in this control*.** The behaviour is now
  known — the flag is ignored, `hasPreviousPage` stays false, `firstPageNumber`
  is unusable — and the fix is written against it, but it was verified in
  `pcf-compact-list` (compiled with `tsc` and driven under jsdom against a fake
  dataset reproducing the platform) rather than by paging this table on a form.
  A React control and a DOM control sharing an approach is not the same as
  sharing a test.
- **Still genuinely unknown:** whether `reset()` before `refresh()` costs two
  round trips, and whether the platform clamps `setPageSize` and echoes the
  clamped value back.
- ~~**A mark renders after every selection checkbox**~~ — **closed in 0.2.0, and
  it was an ellipsis.** `.DataTable-table th, .DataTable-table td` sets
  `overflow: hidden` with `text-overflow: ellipsis`, which is right for a column
  of text and wrong for a cell holding a control. The select column is 40px with
  12px of padding a side, so its content box is 16px — and a checkbox is 13px
  wide with a user-agent margin of 4px left and 3px right, i.e. 20px. It
  overflowed by 4px, so the browser drew the ellipsis it had been told to,
  clipped at that width to a single dot.

  Every earlier guess was wrong in the same way: the markup is innocent. The
  cell holds an `<input>` and nothing else, no rule in the page matches that
  input, and it has no pseudo-elements — so three passes looking for a stray
  character found none, because the character was the UA's.

  **What settled it was rendering the built bundle to a static page with only
  this control's stylesheet and probing it**, which also disproves the
  host-stylesheet theory this file carried: there is no host. The sequence that
  named it: hiding the `<input>` removed the mark, so it belonged to the
  checkbox; resizing the checkbox to 40px removed it too, which is not how a
  glyph behaves but is exactly how an overflow does; and `text-overflow: clip`
  on the cell removed it outright.

  The fix qualifies its selector as `th.DataTable-selectCell` /
  `td.DataTable-selectCell`, and that matters: `.DataTable-table td` is one type
  selector more specific than a bare `.DataTable-selectCell`, so the first
  version of the fix changed nothing and looked identical. `width` and
  `text-align` had worked there all along only because that rule does not set
  them.

- **`overflow-x: auto` on the scroll wrapper was inert from the first release,
  and measuring at 320px is what showed it.** `table-layout: fixed` with
  `width: 100%` makes the table exactly as wide as its container, so it can
  never overflow and the wrapper never scrolls; the columns absorb the shortfall
  instead. In a 320px box the seven-column fixture drew columns of 40, 63, 38,
  47, 28, 35 and 35 — most of them an ellipsis and nothing else — with no
  scrollbar, because as far as the browser was concerned everything fitted.

  This is the same finding `pcf-row-commands` brought back from a real phone
  subgrid ("the command column and slivers of everything else"), reached from
  the other direction. Every dataset control in the catalogue carries the same
  pair of rules and is worth checking.

  A `min-width` is what turns the overflow back on. It is inline on the table
  rather than in the stylesheet because it depends on the column count, which
  CSS cannot read: `columns.length × 100 + 40` for the select column. The
  `<colgroup>` percentages then divide the minimum instead of the container, so
  the view designer's proportions survive — which also means the budget is not a
  per-column floor. The narrowest column went from 28px to 69px, not to 100.

- **The pager needs about 520px and was being clipped, not scrolled.** With
  `flex-wrap: nowrap` the tools group — jump box, page size, export — was pushed
  past the right edge of a 320px box and simply gone: no scrollbar, because the
  row does not scroll, and no shrink, because the controls have intrinsic
  widths. `flex-wrap: wrap` puts them on their own line and leaves the paging
  buttons on the first, which is the half a reader on a phone needs most. Four
  lines at 320px, two at 768, one at 1180.

  **No media query, and a code component should not reach for one.** It is sized
  by its host, so the width that matters is the box it was handed rather than
  the screen — a form can put this control in a 300px column on a 27-inch
  monitor. `flex-wrap` and an `auto` margin respond to the box for free.

### The published screenshots are harness renders, and that is a trade

`media/screenshot.png` and `media/screenshot-narrow.png` are captured from the
preview rig — headless Chrome at a device scale factor of 2 against a page
carrying the built bundle and `DataTable.css` — rather than from a form. The
real-form picture is kept as `media/screenshot-form.png` and is still what
`docs/model-driven.md` uses, because the command bar above the table is the
host's and only a real form has one.

**What the trade buys:** a picture of the current design, at a chosen width, in
a known state — a filter typed, the clear cross showing, and a pager whose count
agrees with it. **What it costs:** the screenshot is no longer evidence. The old
one settled five claims at once just by existing; this one proves only that the
bundle renders, which the smoke suite already says.

Two details that keep it from misrepresenting the control. The fixture's values
are pre-formatted — `$2,450,000.00`, `14/08/2026` — because the rig's
`getFormattedValue` is `String(value)` and a real platform's is not, so raw
numbers would have shown a control that does not exist. And the filter is `in`
rather than something narrower on purpose: it leaves 12 of 24 records and three
pages, so the jump box is in the picture. A filter matching one page hides it,
which is correct behaviour and a screenshot missing a feature.

- **The rendered-preview rig is worth keeping in mind, and is not in the repo.**
  It is ~90 lines: install `dev/dom.js`, evaluate the built bundle with the
  platform globals read out of it by word-boundary regex, render with
  `react-dom/server`, replace the Fluent stub's `<FluentProvider>` with a
  `<div>`, and write the markup under `DataTable.css`. Every token then resolves
  to its literal fallback, which is the light theme — so it checks layout and
  the fallbacks, and nothing about the real Fluent palette. `dev/smoke.js` reads
  props and markup; this reads pixels, and the ellipsis was only ever visible in
  pixels.
- **Not opened in a canvas app.** `docs/canvas.md` claims columns come from the
  Fields flyout, that widths are absent, and that `openDatasetItem` is a no-op.
  All three are reasoned rather than observed. `addColumn` is typed as optional
  (`addColumn?:`), which is why nothing calls it.
- **Five locales, four of them unreviewed by a speaker.** 0.6.0 adds 1031,
  1036, 1041 and 3082 beside 1033, all 117 keys, generated in one pass rather
  than translated by a person. `check-template.mjs` proves the *shape* — every
  key present, every `{0}` set matching — and proves nothing about the wording.
  Power Platform has settled house terms in each of these languages (a
  *Datensatz*, an *enregistrement*, a *registro*) which the strings follow where
  known; the sentences around them are the part worth a native read before
  anyone quotes them as localised. A wrong string here is cosmetic and
  correctable in a patch, which is why it ships rather than waits.
- **Nothing in 0.2.0 has been seen on a real form.** Filtering, the jump box and
  the page-size picker all land on the paging path above, which is the one thing
  here that measurement has already corrected three times. Until that happens,
  every claim about them rests on `dev/host.js`.

## 0.2.0

Three features, and the arguments that shaped them.

**Filtering ANDs across columns, and `pcf-view-filter` ORs.** Not a preference:
that control takes one term and asks for it in *any* of several columns, which
is an `Or`; this one gives every column its own box, so two filled boxes have to
mean "both". With `Or` a second filter returns more rows than the first, which
reads as the control ignoring what was typed. The skill's Filtering section
teaches the `Or` shape and says multi-column search is "always `Or`" — true of
the shape it describes and wrong for this one, so the section has been extended
rather than corrected.

**Only text and numeric columns get a box, and the two exclusions are not the
same strength of argument.** Dates are deferred: `On`, `OnOrAfter` and
`OnOrBefore` are not documented as supported on both hosts, and nothing here has
watched a server accept them. Choices, two-options and lookups are refused: they
filter on an integer or a GUID, and `Column` carries neither — the whole
interface is `name`, `displayName`, `dataType`, `alias`, `order`,
`visualSizeFactor`, `isHidden`, `isPrimary`, `disableSorting`, confirmed by
reading `componentframework.d.ts:2625-2669`.

**Considered and declined: harvesting choice options from the loaded rows.**
`getValue()` on an OptionSet returns the integer and `getFormattedValue()` the
label, so a dropdown could be built from the page in hand with no metadata call.
It is rejected because it would list only the options present in the rows
already loaded — two of seven statuses on page one, fewer once a filter is on —
and a reader has no way to tell a short list from a complete one. That is the
failure this repo already refuses for client-side sorting. The honest version
needs `utils.getEntityMetadata()`, which is model-driven only and would add a
`<uses-feature>` entry, i.e. an install-time prompt on every environment.

**`applyPageSize` never reset the page, and `sortBy` always did.** A real bug
rather than a missing feature, and unreachable until now: the size could only
come from a property, which changes once at configuration time and almost always
while the reader is on page 1. A picker makes it one click from page 3, against
a result set that has been recut underneath. The same gap is in `_template`'s
two dataset variants and is fixed there.

**A multi-page jump is refused on a host without `loadExactPage`.** Stepping
once and setting `page = 7` gives a pager reading "page 7" over page 2's rows,
which is worse than not moving. Looping the calls is the other answer and is not
obviously right — each step is a round trip, and `loadNextPage(true)` accumulates
the whole range on the platform that ignores its argument, which nothing has
watched past page two on a real form.

**The export covers loaded rows, and the button says so.** Paging the whole
result set means raising the page size, looping `loadExactPage` and
reassembling, on a lifecycle that re-enters `updateView` on every fetch. Worth
doing; not worth doing quietly. Declined alongside it: an `exportedCsv` output
on the `downloadedRecordId` precedent in `pcf-attachment-list` — a whole CSV
through a `Multiple` output is the wrong shape for the value.

**The empty-state early return now carries `&& !filtered`.** The filter boxes
live in `<thead>`, so returning a bare message when nothing matched deleted the
only UI that could clear it: one character too many and the control was a dead
end. This is general to any dataset control with UI in its header, and has been
promoted to the skill.

### What the rig now proves, and what it did not

`dev/host.js` had a `filtering` stub that logged the call and discarded the
expression, so an assertion against it could only prove a call happened — the
class of test that passes a control which never calls `refresh()`. It now
evaluates filters for real, ported from the template: `LIKE` to RegExp including
the `[c]` bracket escape, `passes()` recursing over child `filters` with the
`And` default, and the `requestedFilter`/`filter` split that keeps `setFilter`
from being a fetch. `totalResultCount` and `hasNextPage` follow the filter,
because on the server they count the result set rather than the table.

The three load-bearing assertions were mutation-tested rather than trusted, and
one of them was wrong. **The And/Or check was written against `statecode` and
passed while proving nothing** — an OptionSet contributes no condition, so only
one filter ever existed and flipping the constant to `Or` still passed. It now
uses two filterable columns and fails under `Or`. The refresh guards fail under
a removed signature check; the filter row fails under the old early return.

`dev/host.js` also gains `context.navigation` with `openFile`, and quirks
removing the method and the bag independently, because that is how they are
absent in the world. It records the *decoded* file content rather than only the
metadata: for an export the bytes are the behaviour, and a control that quotes a
cell wrongly logs an identical call.

Operators `GreaterEqual` (4) and `LessEqual` (5) were added to the rig's map.
They are in the skill's both-host list and were missing from the six the
template models, so a `>=` filter would have passed by the "unhonoured operators
pass rather than fail" rule — looking filtered while filtering nothing.

### Not verified in 0.2.0

- **No filter has been applied on a real form.** Everything above rests on
  `dev/host.js`, which is a model of the platform written from its
  documentation and from what sibling controls observed — not from this feature.
- **Whether the server accepts `GreaterEqual` and `LessEqual` on a Currency
  column** on both hosts. They are in the skill's table; nothing here has seen
  one answered.
- **Whether `navigation.openFile` saves a CSV without a viewer prompt** on a
  model-driven form, and whether the Blob fallback survives the canvas iframe's
  sandbox at all. Both paths compile and are exercised in the rig; neither has
  produced a file on a real host.
- **Whether Excel opens the export correctly.** The BOM and CRLF are what RFC
  4180 and Excel's UTF-8 handling call for, and no one has double-clicked the
  file.

## 0.3.0

Two features. Pinned columns are done and asserted; inline editing is blocked on
a measurement, and the reason is worth more than the feature.

### The typings do not admit that a dataset record can be written to

`EntityRecord` in `@types/powerapps-component-framework@1.3.18`
(`componentframework.d.ts:2675`) declares **four** methods: `getFormattedValue`,
`getRecordId`, `getValue`, `getNamedReference`. `setValue`, `save`, `isDirty`
and `getColumnInfo` are documented on Microsoft Learn and **none of them is
there**, and neither is `DataSet.newRecord` or `DataSet.delete`.

This is the exact inverse of the `fluentDesignLanguage` finding above, where the
types turned out to be *ahead* of a comment claiming they lagged. The rule that
covers both: **the typings are a claim about the type definitions, not about the
host.** It is already how this control treats `paging.loadExactPage` and
`dataset.sorting`; it now has to be how it treats the whole write surface.

The stake is not academic. `pcf-kanban-board` writes with
`webAPI.updateRecord`, which costs a `<uses-feature name="WebAPI">` — an
install-time permission prompt in every environment — and does nothing at all in
a canvas app. If `setValue`/`save` are really on the record, editing costs
neither, and this control keeps the "no `<feature-usage>` at all" property its
manifest closes with. That is the entire argument for building editing this way,
and it rests on an API nothing in this catalogue has ever called.

So editing was **not** written against a guess. `DataTable/probe.ts` — temporary,
deleted before release — reports the live shape of a record on a real subgrid and
parks the dataset on `window.__pcfDataTableProbe` so a write can be tried by
hand. The rig cannot settle this: `dev/host.js` is a model of the platform
written from its documentation, so it would report whatever we chose to write
into it.

### `pcf-scripts build` exits 0 when ESLint fails

Found while mutation-testing the new assertions, and it invalidated the first
result. `npm run build` prints `[pcf-1065] [Error] ESLint validation error`,
**emits no bundle**, and returns a success code. So `npm run build && npm run
smoke` runs the suite against the bundle from the last *successful* build, and
every assertion passes because it is testing the previous code.

The first mutation here — replacing the pinning clamp's condition with
`if (false)` — tripped `no-constant-condition`, which is in `eslint:recommended`.
The suite came back green and read exactly like "this assertion proves nothing".
It proved plenty; it had simply never seen the mutation. Every mutation test
below therefore compares an `md5sum` of `out/controls/DataTable/bundle.js` across
the rebuild and refuses to report a result if it did not change.

CI is not exposed, because `build-reusable.yml` runs `npm run lint` as its own
step before the build. A local `build && smoke` chain has no such protection.
Promoted to the skill.

### Pinned columns

`pinnedStart` and `pinnedEnd` are **counts, not names**, and carry no
`default-value`. Counts because the view designer is already the configuration UI
here — the same argument that made this control declare no `property-set` roles.
A list of logical names is more expressive and fails silently the day somebody
removes that column from the view. No default because unset has to mean "lay out
exactly as 0.2.0 did", or every existing installation takes the new layout at
upgrade.

Four things about `position: sticky` in a table that were defects before they
were designs:

- **`border-collapse: collapse` kills sticky borders.** Collapsed borders belong
  to the table, not the cells, so a pinned column loses its horizontal rules
  while the table is scrolled and gets them back when it is not. Moved to
  `separate` with `border-spacing: 0` — the spacing has to be stated, its initial
  value is 2px. Safe here because only `border-bottom` is ever set on a cell, so
  nothing doubles.
- **A sticky offset has to be pixels and the `<colgroup>` is percentages.**
  `inset-inline-start` resolves against the table, not against the columns to the
  left of the cell. So a pinned column leaves the proportional pool and takes a
  fixed px width, and the loose columns divide **what is left**:
  `calc((100% - 240px) * share)`. Bare percentages ask for the pinned pixels
  twice, and the table drifts wider on every render that changes the pinned set.
  `visualSizeFactor` is read as px for a pinned column and as a ratio for the
  rest, and both are right: Dataverse stores it in `layoutxml` as a pixel width.
- **A sticky cell needs an opaque ground, and it has to track the row.** Hover
  and selection are `tr` rules; the cell's own background paints over them, so
  the pinned column stayed white down a highlighted row and the row appeared to
  break in half at the seam. `tbody tr:hover td.is-pinned` and
  `tr.is-selected td.is-pinned` restate them, in that order — `:hover` and a
  class carry equal specificity, so source order decides a row that is both.
- **Pinning switches itself off where it cannot be afforded.** A 320px subgrid
  with a 200px column pinned beside the 40px select column leaves 80px of moving
  table, which is narrower than the 100px budget one column gets. Clamped against
  `mode.allocatedWidth` — the half of the pair a main grid actually reports, per
  `quirks.heightUnmeasured`. `-1` and `0` mean "the host did not measure" and get
  the pinning they asked for; reading them as "no room" would unpin the control
  everywhere, `npm start` included.

Two smaller decisions. The seam at the end of a run is a pseudo-element rather
than a border, because under `border-spacing: 0` a border takes part in layout
and would shift every offset after it. And the select column is pinned whenever
anything at the start is — left loose it slides underneath the column pinned
beside it.

All of it lives in `pinPlan()` in `components/resolve.ts`, out of the render, so
the clamping can be asserted without React.

### What the mutation tests proved

Five mutations, each rebuilt and hash-checked:

| Mutation | Caught by |
| --- | --- |
| Clamp can never fire | *pinning switches itself off* |
| Select column not pinned | five assertions, including the exact cell count |
| Loose columns divide the whole table rather than the remainder | *pinned takes pixels, the rest divide what is left* |
| No room clamp — every column pinnable | *at least one column is always left to scroll* |
| No seam | *the seam is drawn once per pinned run* |

The cell counts are exact rather than "more than none" on purpose: the failure
worth catching is a pinned **header** over unpinned **cells**, which separates a
column into a heading that stays and a body that scrolls away. That is one
missing class and it looks like two different bugs.

### Inline editing, and what the probe answered

The probe of 2026-09-09 came back with more than it was sent for.

**The write path exists.** `setValue`, `save` and `isDirty` are all functions on
a live record. Driven from the console against a real row, the value committed
and survived a reload. So editing writes through the dataset and this control
still declares **no `<uses-feature>`** — confirmed by grepping the *built*
manifest, which has zero, and by grepping the bundle, where `webAPI` appears
only inside comments.

**`getColumnInfo` and `DataSet.newRecord` are absent**, matching Microsoft's
"canvas apps" annotation on both. So a dataset control can write to rows it
already holds on either host, and can only *create* rows in canvas. Row creation
is therefore out of scope rather than deferred.

**The record answers `isEditable(column)`, and that changed the design.** The
approved plan conceded that column-level editability is invisible on `Column` —
the interface is name, displayName, dataType, alias, order, visualSizeFactor,
isHidden, isPrimary, disableSorting and nothing else — and settled for offering
an editor on every column of a writable *type*, letting the server refuse the
rest. It does not have to. On the measured subgrid two columns answered `true`
and `statuscode` answered `false` **on the same record**, so editability is per
column and per record, and the control asks rather than infers.

Also present and unmeasured beyond their existence: `isSecured`, `isReadable`,
`getFieldRequiredLevel`, `isValid`, `getValidationError`, `reformatValue`,
`getCurrencyDecimalPrecision`, `getFileObject`, `isRecordValid`, and three
persona methods. Twenty-three methods on the record against four in the typings.

### Three traps, each measured rather than reasoned

**The per-column methods are async and the others are not.** `isEditable`,
`isSecured`, `isReadable` and `getFieldRequiredLevel` return Promises; `isValid`
and `getCurrencyDecimalPrecision` return values. Nothing distinguishes them by
name. An unawaited call returns a Promise, which is **truthy** — so
`if (record.isEditable(name))` is true for every column including the ones that
are not editable, a bug shaped like working code. It is how the first
measurement came back: `{}` four times, which is what `JSON.stringify` does to a
Promise. `dev/host.js` returns Promises for exactly these four so the rig cannot
let that pass.

**A wrong column name throws `UciError: Invalid snapshot with id undefined`**,
naming neither the column nor the record. Microsoft documents that exact string
on the `save` reference page as the symptom. Reproduced here by writing to
`name` on a table whose primary column is `cll_accountname`.

**`isDirty()` returned `false` immediately after a resolved `setValue`, and the
write still committed.** Unexplained, and recorded as unexplained. Nothing in
this control gates on it.

### The design that came out of it

Editing is off by default, on the `enableExport` precedent. `editableColumns`
is an allow-list that only ever **narrows** what the platform permits — the
order matters, because a list that was trusted on its own would offer an editor
over a column locked by column-level security.

Commit is cell-level, on blur, with Enter to commit and Escape to revert.
Escape has to set a flag before the blur handler runs, or blurring the input
commits the value that was being cancelled.

**Absent means read-only.** `isEditable` is a fetch, so the first render after
editing is switched on knows nothing about any cell. Rendering an editor there
would mean offering one on every writable *type* — the behaviour asking the
platform was meant to replace — and withdrawing it a frame later.

The resolution terminates on `editableAsked`, a set that only grows. The last
answer home calls `notifyOutputChanged()` for the render that shows the editors,
and that render re-enters `updateView`; a version that re-asked would notify
forever. Same shape as the `setPageSize` loop, same shape of guard.

The primary column keeps its open-record link and gets a pencil beside it,
rather than having editing folded into the link. Two behaviours on one target is
the ambiguity, and the column that names the row is exactly the one people most
want to rename.

### The rig was more generous than the platform, twice

Both were found by mutation testing, and both had certified a bug as working.

**`allocatedWidth` was answered whether or not anything asked.** On a real form
it is `-1` until `trackContainerResize(true)` is called, which this control never
did — so the pinning clamp shipped in 0.3.0's first commit was dead code on
every host. Now a getter behind `quirks.resizeUntracked`, defaulted on.

**`save()` applied its values synchronously before resolving.** So a control
that retired its optimistic override the moment `save()` resolved passed every
assertion: the record already agreed and there was no window in which the old
value could come back. On a form there is one — a resolved save means Dataverse
accepted the write, not that the dataset has re-read — and the cell visibly
jumps back and then forward. Committed values now wait for `handle.reread()`,
and the mutation is caught.

The lesson is one line and it is now in the skill: **a rig more generous than
the platform does not fail safe, it certifies the failure.**

### Two stale-bundle incidents, same root cause

`pcf-scripts build` exits 0 when ESLint fails, emitting no bundle. Twice a
mutation tripped `no-constant-condition` and the suite reported green against
the previous build. The bundle hash check caught both.

A third came from the other direction: restoring a mutated source file without
rebuilding left the *mutated* bundle in `out/`, and half an hour went into
theorising about why an override was being retired early. It was being retired
early — by the mutation still in the bundle. **Rebuild after restoring, not just
after mutating.**

### Not verified in 0.3.0's editing

- **No edit has been made through the control's own UI on a real form.** The
  write path was driven from the console against a live record; the control's
  editor, its rollback and its `isEditable` gating are asserted only against
  `dev/host.js`.
- **Canvas is unmeasured.** Microsoft annotates `setValue`/`save` as canvas
  **experimental**, and documents Decimal and Floating Point as unsupported
  there. This control attempts the write and reports the refusal rather than
  special-casing the host, which is a decision that has never been watched.
- **`isEditable` was measured on three columns of one table.** Whether it
  reflects column-level security, form-level locking, or something else is not
  established — only that it varies per column and is not a function of
  `dataType`.
- **The `UciError` rejection shape.** The control reads `(error as Error)?.message`
  with a fallback, because a rejected platform call is typed `unknown`. Whether
  a refused *privilege* rejects with a useful message, rather than that opaque
  snapshot string, is unknown.

### Not verified in 0.3.0's pinning

- **Nothing about pinning has been seen on a real form.** The offsets, the
  clamp and the cell counts are asserted against `dev/host.js` and rendered
  markup. Whether a sticky cell actually sticks is a browser behaviour that
  neither the rig nor `react-dom/server` can observe. The clamp itself is
  finally *reachable* there — `allocatedWidth` came back 2454 on a real subgrid
  once `trackContainerResize(true)` was called — but reachable is not observed.
- **Right-to-left is reasoned, not rendered.** The assertion proves the control
  writes `inset-inline-start` rather than `left`; it does not prove a
  right-to-left form pins the correct edge. Logical inset properties on sticky
  elements are the part to watch.
- **The pinned-cell background over a hovered row is a pixel claim**, and
  pixels are where the select-column ellipsis hid for three reviews. It has not
  been through the rendered-preview rig yet.
- ~~**Whether `setValue` and `save` exist at all**~~ — **answered.** They do,
  they write, and the value survived a reload. See *Inline editing, and what the
  probe answered* above; the open questions that replaced it are listed there.

## 0.3.1

0.3.0 was put on a real Accounts subgrid and three things were wrong. Two of
them were one cause.

### `notifyOutputChanged()` does not repaint a React control

**The pencil rendered, the click ran, the class field was set, and nothing
happened on screen.**

`notifyOutputChanged()` tells the platform that an **output** changed, and the
platform answers by calling `getOutputs()`. A React control repaints when
`updateView` runs and returns a new element — and that is the platform's
decision, not the control's. There is no "please re-render" call.

0.3.0 kept every piece of editing state in the control class — which cell is
open, what the platform answered about each cell, the optimistic overrides, the
in-flight writes, the last refusal — and called `notifyOutputChanged()` after
each change expecting a repaint. On a form, none came.

All of it now lives in `DataTableControl` as React state, where a `setState`
repaints and the platform is not involved. The state survives the platform's own
`updateView` passes because the element type does not change, so React
reconciles rather than remounting. What crosses back into the class is only what
the platform genuinely needs: the write itself, and the edited row id — which is
an output, and the one thing `notifyOutputChanged` is actually for.

**This is general to every React (virtual) control**, not to this one, and it is
now in the skill. The rule: if changing it has to repaint, it is component
state; if the platform has to hear about it, it is an output.

### The rig hid it, for the fourth time this release

`dev/host.js` has `settle()`, which re-drives the control explicitly. So a test
that called `onBeginEdit` and then `settle()` was modelling a repaint the
platform never performs, and every editing assertion passed against a control
that could not open an editor on a form.

That is the fourth time in 0.3.x that the rig was more generous than the
platform and certified a bug: `allocatedWidth` answered unasked, `save()`
applying synchronously, `settle()` standing in for a repaint — and the
`resizeUntracked` gap before them. The line is worth repeating rather than
paraphrasing: **a rig more generous than the platform does not fail safe; it
certifies the failure.**

### What the rig can no longer say about editing, stated plainly

`renderDeep` uses `react-dom/server`, which **runs no effects and dispatches no
events**. Now that editing's interactive state is React state driven by effects
and clicks, the rig cannot see an editor open, cannot see editability answers
arrive, and cannot see a cell roll back.

Rather than leave assertions that pass because nothing ran — the failure this
suite has been burned by twice — the editing checks were rewritten against the
boundary the control class actually owns: `canEdit` returns the platform's
promise or `null` where the host cannot write; `onCommitEdit` calls `setValue`
then `save` in that order, reports the edited row, and rejects rather than
resolving quietly when the platform refuses. Everything above that line is
verified on a real form and nowhere else. It is listed under *Not verified*
below, honestly rather than as a formality.

### Reading `allocatedWidth` is not the same as applying it

0.3.0 added `trackContainerResize(true)` and used the answer **only** for the
pinning clamp. The number never reached the layout, so `overflow-x: auto` on the
scroll wrapper stayed inert: the table drew wider than its box, an ancestor
clipped it, and no scrollbar appeared. An end-pinned column could therefore
never be seen to pin, because nothing ever scrolled past it.

That is the documented symptom, and the skill already carried the fix — *apply
it as a pixel `max-width` on the control's root*. Half the fix was implemented
and the half that mattered was not. The root now carries
`max-width: <allocatedWidth>px` when the host measured, and nothing when it did
not.

Worth noting for whoever reads the number: `allocatedWidth` came back **2454**
on that subgrid, which is far wider than the subgrid appears. It is applied as a
ceiling rather than as a width, so an over-wide value costs nothing — but do not
read it as "the box this control is in".

### A cell that did two different things depending on where you clicked

`.DataTable-editTrigger` was an inline button sized to its text, so the rest of
the cell was bare `<td>` — and a `<td>` is inside the row, which opens the
record. Clicking a short value edited; clicking two millimetres to its right
navigated away. Worst on empty cells, where the target was the width of the word
"(empty)".

It is now `display: block; width: 100%`, so the whole cell is the target and the
only click that reaches the row is one outside every cell.

### Not verified in 0.3.1

- **The three fixes have not themselves been seen on a real form.** They were
  each written against a specific observed failure, and each has an assertion
  where one is possible, but the loop is not closed until the build is back on
  that subgrid.
- **Interactive editing is not covered by the rig at all**, for the reason
  above. Opening an editor, an editability answer revealing a cell, an
  optimistic value holding while the dataset is stale, and a rollback naming its
  refusal are all real-form-only.
- **Whether `allocatedWidth` is the right ceiling.** 2454 on a subgrid that
  renders far narrower suggests it may be the form's width rather than the
  control's. Applied as a ceiling it is harmless, but a control that needed the
  number to be *accurate* would be wrong here.

## 0.3.3

**`EntityRecord.setValue()` does not return a promise. It returns `undefined`.**

Microsoft's reference page types it `Promise`. The samples that actually work
call it synchronously — several `setValue`s in a row, then one
`await record.save()`, then `dataset.refresh()`. 0.3.0 read the documentation,
typed it as a promise, and wrote:

```ts
record.setValue(column, value).then(() => record.save())
```

which against a real record is `.then` on `undefined`: a **`TypeError` thrown
synchronously**, outside every `.catch` in the chain and — once 0.3.2 added one
— outside the timeout wrapper too, because it threw before the wrapper was
reached. The cell had already been marked saving. Nothing caught it. It read
"Saving…" for ever, with no rollback, no message, and no write.

Three releases shipped that. It was found by reading a working sample, not by
any measurement this repository made.

### The rig returned a promise, which is why nothing caught it

`dev/host.js` had `record.setValue` return `Promise.resolve()`. So the control's
chain behaved perfectly here, and every editing assertion passed against code
that could not work on a form. `setValue` now returns `undefined`, and the old
shape fails the suite with the identical error the form produced —
`Cannot read properties of undefined (reading 'then')` — confirmed by mutation.

**Fifth time in 0.3.x, and the most expensive.** The others: `allocatedWidth`
answered unasked, `save()` applying synchronously, `settle()` standing in for a
repaint, `resizeUntracked` absent. The pattern is not carelessness in any one
of them — it is that a rig is written from the same understanding as the control,
so it encodes the same mistakes and then certifies them. **Where the platform
and the documentation disagree, the rig has to follow the platform**, and the
rig is the only place that disagreement can be written down as something a test
can fail against.

### `refresh()` is part of the write

`save()` commits; nothing re-reads until something asks. The working samples call
`dataset.refresh()` straight after saving, and 0.3.0–0.3.2 did not. Without it
the optimistic override is the only thing holding the new value on screen, so
the cell shows the edit until the next platform-driven fetch and then appears to
lose it — which is what "after refresh the values are the previous values"
described.

### What is asserted now

- `setValue` returning `undefined` does not break the commit.
- `refresh` is called after `save`.
- Both mutation-tested; the first reproduces the shipped failure exactly.

### Verified on a real form

**Editing works end to end**, observed on the Accounts subgrid on 2026-09-09:
the cell saved, "Saving…" cleared, and the value survived a browser reload. So
`save()` does resolve on a subgrid — the question left open an hour earlier — and
the whole write path is confirmed: `setValue` synchronously, `await save()`,
`dataset.refresh()`, with **no `<uses-feature>` and no install-time permission
prompt**, which was the entire argument for building it this way.

Pinned columns and the horizontal scroll were confirmed on the same form at
0.3.1.

### Not verified in 0.3.3
- **Whether `isDirty()` means anything.** It answered `false` immediately after
  a resolved `setValue` — but that `setValue` was awaited rather than called,
  and awaiting `undefined` is not the same as staging a change. The earlier
  reading is void; nothing gates on it.

### The preview rig is in the repository now, and so is a gap it exposed

`dev/preview.html` renders the built bundle in a real browser, and
`dev/serve.js` serves the repository so it can fetch `demo/records.json`. Every
screenshot in `media/` is captured from it with headless Chrome at a device
scale factor of 2.

**It had to be a browser page rather than `react-dom/server`.** `smoke.js`
renders with `renderToStaticMarkup`, which runs no effects and dispatches no
events — and since 0.3.1 the editing state is React state driven by an effect
(asking the platform which cells are writable) and a click. A server-rendered
picture of this control can only ever show the state before any of that has run,
which is the read-only fallback. Here effects run, and `?open=1` clicks a cell so
a headless capture can photograph an open editor.

Two rig changes came with it, both about the pictures being honest:

- **`host.js` now carries every string the control asks for.** `getString` falls
  back to the key, so the missing two-thirds rendered as `DataTable_Export` —
  invisible to an assertion that counts elements, and glaring in a screenshot.
- **`getFormattedValue` can format.** It was `String(value)`, so a Currency
  rendered as `2450000` and a DateOnly as `2026-08-14` — a control that does not
  exist, since a real platform formats both before the control sees them. Opt-in
  via `format: true`, used by the preview page only: the CSV assertions read
  exact cell contents, where `-1500` says more about quoting and formula
  defusing than `-$1,500.00` does.

**The gap: this repository never adopted the template's `dev/harness.html` or
its `dev/serve.js`.** The template ships an interactive host stand-in with
switches for field-level security, a missing theme and right-to-left, and its
`serve.js` exits when that page is absent — so it cannot be copied in on its
own. What is here is the narrower capture server, and `dev/serve.js` says so at
the top. Adopting the template's harness is worth doing and was not this change.
`dev/preview.html` has been copied up to `_template/dev/` so the next control
gets the capture page without rebuilding it — SPEC has described it as "~90
lines, not in the repo" through two releases, and it has now been written three
times.

## 0.3.4

Two fixes, both found by looking at the control rather than at the code.

### An untouched editor wrote, and the write failed

Open a cell, change nothing, click away: a red *"Score could not be saved.
Invalid snapshot with id undefined"* under a cell nobody had edited. Observed on
a real subgrid, 2026-09-09.

The blur handler committed unconditionally. Committing an unchanged value calls
`setValue` with what the record already holds, which stages nothing — and
`save()` with nothing staged throws. **That error string does not mean "wrong
column name"; it means "there is no pending change to save",** and a wrong column
name is only one way to have none. The 0.3.3 note that reads it as the former is
narrower than the truth.

An untouched editor now closes without writing, on both blur and Enter. Compared
as the strings the editor holds — `props.initial` is what `editorValue` put in
the box — so the test is exactly "did the user alter what they were shown", with
no coercion and no `20` versus `20.00` argument.

**Measured in a browser rather than reasoned**, because the suite cannot see it:
opening and leaving an untouched editor closes it with no error and no write;
typing and leaving commits and shows the new value. Both driven through
`dev/preview.html`.

Two things went wrong while measuring, and both are worth more than the fix:

- **`chrome --headless --dump-dom` returned zero bytes**, and PowerShell's
  `-match` against `$null` answers `False` without complaint. So the first
  "verified" run read nothing and reported the absence of an error as proof
  there was none. It is the `img.src` bug in `dev/dom.js` all over again: *a
  check that silently reads the wrong thing reports its own blindness as proof.*
- **`element.blur()` does nothing when the document itself is not focused**, so
  the gesture never fired. Dispatching the `blur` event directly is what
  reaches React's handler in a background pane.

### The pager's tools could not wrap, so they were clipped

`.DataTable-pagerTools` is pushed right by `margin-inline-start: auto` and had no
width constraint, so `flex-wrap: wrap` — which only engages against a constrained
width — never did. On a narrow host the group sized itself to its content,
overflowed the row and was cut off. `max-width: 100%` turns the content-sized
item into a constrained one. Verified across 320, 368, 400, 520 and 900px.

**Still open below about 400px**: the pager row itself can exceed the control's
width, so the jump box clips at the far right even with the tools group
constrained. The `max-width` fix is necessary and not sufficient, and this is
recorded rather than hidden — `media/screenshot-narrow.png` is captured at 480px,
which is honest about being the width where the layout is clean.

### What the screenshots are, and one way they lied

All four in `media/` are captured from `dev/preview.html` with headless Chrome at
a device scale factor of 2.

The first attempt passed `--hide-scrollbars`, which hides the horizontal
scrollbar inside `.DataTable-scroll` — **the single thing the narrow screenshot
exists to show.** The picture was of a table clipped at the right edge with no
indication it could scroll, which is what a broken control looks like. The narrow
and pinned captures now run without it; the two wide ones keep it, having nothing
to scroll.

`enableExport` defaults to **off**, and the preview page was forcing it on. A
narrow capture now shows what an unconfigured control looks like rather than one
with every switch flipped.

## 0.4.0

Five additions, chosen by looking outward for once. An audit of what the
community actually asks an editable grid for — the starred repositories, the
gallery, the forum threads — came back with three things, and all three were
sitting in `docs/limitations.md` as refusals: editing a Choice or a Lookup,
adding a row, filtering a date. This release takes each refusal apart and keeps
the part of the argument that was right. Four of the five shipped; the fifth
was measured out, and the section that says so is below.

### What it adds

- **Choice cells edit in place.** A native `<select>` of the column's options,
  read from entity metadata, with an empty entry to clear.
- **A New button** that opens the table's quick create form and reports the row
  it made through a fourth output, `createdRecordId`.
- **A date box on date columns**, with a toggle beside it that reads On, From or
  Until.
- **A choice box on Choice columns**, from the same metadata the editor uses.

### What it was going to add

- **Lookup cells editing through the platform's own lookup dialog.** Specified,
  probed, and cut: the dialog works exactly as hoped, and `record.setValue()` on
  a Lookup column stages nothing on this host — see 6 under *What must be
  measured first*. The design below is kept as written, because the next
  release with a write path for lookups would build it unchanged.

### The Utility trade, and why it is now taken

0.2.0 and 0.3.0 declined `utils.getEntityMetadata()` on the same arithmetic each
time: one install-time prompt in exchange for one filter box, on a control that
had earned none. The arithmetic has changed rather than the principle. The same
prompt now buys a Choice editor and two filter boxes — it was specified to buy a
Lookup editor and the lookup dialog as well, and the probe took those back
(6 below), which leaves the trade thinner than planned and still positive:
Choice is the column the outward audit found users most want to edit, and the
prompt is paid once.

So the manifest declares its first feature:

```xml
<uses-feature name="Utility" required="false" />
```

`required="false"` because a host without the surface should leave it absent
rather than refuse to load the control. Canvas never had `utils` whatever the
manifest said, so nothing is lost there — `pcf-kanban-board` found that
declining Utility bought canvas exactly nothing, and this control has been
paying the price of that finding without collecting on it.

**No WebAPI.** The write path is still `record.setValue()` then `record.save()`;
`navigation.openForm` sits on a bag no feature gates; `lookupObjects` sits on the
one already paid for. A second prompt would buy nothing this release needs.

**The 0.2.0 refusal of harvesting options from loaded rows stands.** Metadata is
the honest source of an option list and is the only one used here. A dropdown
built from the page in hand still cannot tell a short list from a complete one.

### Design decisions

**Quick create over an inline blank row.** `DataSet.newRecord` is measured
absent on model-driven (0.3.0 above), so an inline row can only reach the server
through `webAPI.createRecord` — a second feature, a payload that bypasses every
business rule and required-field check the form would apply, and a row that
cannot fill a Choice or a Lookup until the pickers exist. `openForm` with
`useQuickCreateForm: true` is the platform's own create surface, honours all of
that, and `createFromEntity` seeds the parent relationship from
`mode.contextInfo` so the row lands in the subgrid it was asked for from.

**The native dialog over a type-ahead.** `pcf-lookup-search` is the type-ahead
and it costs `retrieveMultipleRecords`, a metadata call for the name column, and
a portalled Fluent listbox — inside a table cell, on a control that has never
mounted a Fluent input. `utils.lookupObjects` costs one feature already
declared, and a cancelled dialog resolves empty, which is a no-op rather than a
branch.

**An operator toggle beside the date box, not two boxes and not a typed
prefix.** `<input type="date">` cannot carry `>=` the way the number box does;
two boxes double the height of the filter row, which the 320px measurements
already fight; and On / From / Until is the vocabulary of the platform's own
filter pane. The toggle's label is component state, because an operator change
with an empty box triggers no refresh and nothing else would repaint it.

**The choice filter sends `Equal` on the integer, as a string.**
`ConditionExpression.value` is typed `string | string[]`; the numeric filter
already sends a number through a cast and the server has not objected. The probe
below settles whether it cares.

**Metadata is resolved inside the component**, on the `canEdit` precedent:
`notifyOutputChanged()` does not repaint a React control (0.3.1), so the class
hands down a thunk and caches the promise, and the component owns the answer.
One difference, stated so nobody reads it as drift: `loadOptions` and
`pickLookup` are **function-or-null** where `canEdit` is **per-call null**. The
fact behind `canEdit` is about a *record* — this one may lack the methods — and
has to be asked per row. The fact behind the new two is about the *host*,
decided once in `updateView`, and the component needs it before it renders a
trigger or asks `isEditable` for a cell that can never get an editor.

**A lookup edit has no `<input>`.** Trigger → dialog → commit. The existing
`commit` splits into the coercion it already does and a `write` the dialog path
can call with a reference instead of a string.

**Everything degrades to 0.3.4.** Where `utils` is absent the Choice cells stay
read-only and the Choice column stays unfilterable; where `openForm`
is absent there is no New button. The date box needs no metadata, so it appears
wherever `filtering` exists. Detection is per method, not per bag — the
`pcf-row-commands` rule.

**The boolean editor's Yes and No were hardcoded**, the only two user-visible
strings in the control that were. They move to the `.resx` while the editor is
open.

### What must be measured first

Every design decision above rests on at least one claim nothing in this
repository has watched a platform make. The probe build asks these, in this
order, and the answers are written back here as *Measured* before a line of the
feature exists. A question answered the wrong way removes the feature that
depends on it rather than being worked around.

1. **Import.** With `Utility` declared `required="false"`, what does the import
   prompt say, verbatim? On the `cll_account` subgrid afterwards, is
   `context.utils` an object with `getEntityMetadata` and `lookupObjects` as
   functions?

   *Measured 2026-09-11.* `context.utils` is an object; `getEntityMetadata`
   and `lookupObjects` are functions, and so is `navigation.openForm`. The
   prompt text was not captured — the probe build went in as an upgrade of a
   solution already installed, and the import surfaced nothing worth quoting.
   Recorded under *Not verified* rather than invented.
2. **Column type strings.** For every column in the view, the exact
   `Column.dataType` — in particular for the Choice column, a multi-select
   Choice, and the Lookup (`Lookup.Simple`? `Lookup.Customer`? `Lookup.Owner`?).

   *Measured.* `SingleLine.Text`; `OptionSet` for `cll_industry`,
   `cll_priority`, `statecode` **and** `statuscode` — state and status are not
   distinguishable from a choice by `dataType`, which is why `isEditable` and
   not the type string decides whether a cell gets an editor;
   `MultiSelectPicklist` for `cll_tags`; `Lookup.Simple` for
   `cll_primarycontact`; `Lookup.Customer` for `cll_customer`;
   `DateAndTime.DateOnly` for `cll_startdate`; `DateAndTime.DateAndTime` for
   `cll_lastcontacted`. No `Lookup.Owner` in the view.
3. **Choice metadata.** `getEntityMetadata('cll_account', [choiceColumn])` →
   does `metadata.Attributes.get(choiceColumn)` return a node? Are the options
   at `OptionSet.Options`, `GlobalOptionSet.Options`, or both? Is each `Label` a
   string or `{ UserLocalizedLabel: { Label } }`? Is `Value` a number? Is
   `Color` present?

   *Measured, and the kanban-derived assumption was wrong.* The node comes
   back, but **`node.OptionSet` is a map keyed by value**, not an object with
   an `Options` array: `{ 1: { text: 'Retail', value: 1 }, …, 4: { text:
   'Technology', value: 4 } }`. `OptionSet.Options` and `GlobalOptionSet` are
   both `undefined`. The array lives one level down, at
   `node.attributeDescriptor.OptionSet`, as `[{ Label, Value, TransitionData,
   IsHidden }]` — state options add `DefaultStatus` and `InvariantName`,
   status options add `State`. `Label` is a plain string on both routes; no
   `UserLocalizedLabel` anywhere; `Value` is a number; **`Color` is absent** on
   both. `AttributeType` is numeric (11 picklist, 17 multi-select, 6 lookup,
   1 customer, 2 datetime, 12 state, 13 status) beside an `AttributeTypeName`
   string. Datetime nodes carry `Behavior` (2 DateOnly, 1 UserLocal) and
   `Format` (`'date'` / `'dateandtime'`). `parseOptions` reads the descriptor
   array first — it is the one that carries the maker's order and `IsHidden`
   — and the map when that is absent, sorted by value.
4. **Lookup targets.** On the lookup attribute's node, is `Targets` a populated
   array of logical names? If not, which key carries them? If none does, the
   lookup editor cannot ship and this section says so.

   *Measured.* `cll_primarycontact` → `Targets: ['contact']` at the top of the
   node, and again at `attributeDescriptor.Targets`. `cll_customer` → the
   top-level `Targets` is **`undefined`** and only
   `attributeDescriptor.Targets: ['account', 'contact']` carries them. So a
   reader has to try the top-level key and fall through to the descriptor,
   and a `Lookup.Customer` dialog would offer both tables. Recorded, not
   coded: 0.4.0 ships nothing that needs a target (6).
5. **Lookup read shape.** What does `record.getValue(lookupColumn)` return: an
   `EntityReference` `{ id: { guid }, etn, name }`, a `LookupValue`
   `{ id, entityType, name }`, an array of either, or a string?

   *Measured.* An `EntityReference`: `{ etn: 'contact', id: { guid:
   'a1e84297-…' }, name: 'Patrick Sands (sample)' }`, GUID unbraced and
   lower-case; the Customer column is the same shape with `etn: 'account'`.
   Not an array, not a string. For the record: a choice reads back as the
   **string** `"3"` (formatted `"Services"`), a multi-select as `"1"`, a
   DateOnly as `"2026-08-31T00:00:00.000Z"`, a DateAndTime as
   `"2026-09-01T04:30:00.000Z"` (formatted `8/31/2026 11:30 PM` in the user's
   UTC-5), `statecode` as `"0"`. `sameValue('choice')` therefore compares
   numbers after coercion, never the raw strings.
6. **Lookup write shape.** Which of `{ id, name, entityType }`,
   `[{ id, name, entityType }]` and `{ id: { guid }, etn, name }` does
   `record.setValue(lookupColumn, x); await record.save()` persist across a
   reload? Does `setValue(lookupColumn, null)` clear it?

   *Measured: none of them.* On record `4748f046…` every shape — the plain
   `LookupValue`, the same in an array, the `EntityReference` the column reads
   back as, the braced upper-case shape the dialog resolves with, and `null` —
   was accepted by `setValue` (returns `undefined`, no throw) and then
   **refused by `save()` with `UciError: Invalid snapshot with id
   undefined`**, the message this host uses for "nothing is staged". One call
   in the first run resolved — the plain shape, the first `setValue` on a
   fresh record — and a Web API read-back of `_cll_primarycontact_value` before
   the second run showed `null`, so it saved nothing. **`record.setValue` on a
   Lookup column stages nothing on this host.** The plan's rule applies: the
   lookup *editor* is cut from 0.4.0. What stays is the record above — the
   dialog shapes (8), where the targets live (4) and the read shape (5),
   which are what a later release with a write path would need — and
   `docs/limitations.md` keeps saying lookups are read-only, now with the
   reason measured rather than assumed.
7. **Choice write.** Does `setValue(choiceColumn, <integer>); await save()`
   persist? Does `null` clear it? Does `isEditable(choiceColumn)` answer `true`,
   and do `isEditable('statecode')` and `isEditable('statuscode')` answer
   `false`?

   *Measured.* `setValue('cll_industry', 4); await save()` → the Web API reads
   `cll_industry: 4`; `setValue('cll_industry', null); await save()` → reads
   `null`. Both survived a hard reload. `isEditable` answers `true` for
   `cll_industry`, `cll_priority`, `cll_tags`, `cll_primarycontact`,
   `cll_customer`, `cll_startdate` and `cll_lastcontacted`, and `false` for
   `statecode` and `statuscode` — so the gate the 0.3.x editor already applies
   keeps state and status read-only without a type check. Note the asymmetry
   with 6: `isEditable('cll_primarycontact')` is `true` and the write still
   stages nothing, so `isEditable` is a necessary condition, not proof of a
   write path.
8. **Lookup dialog.** `utils.lookupObjects({ entityTypes: [target],
   allowMultiSelect: false })` — does it open? On a pick, what is the resolved
   shape? On cancel, does it resolve `[]`, resolve `undefined`, or reject?

   *Measured.* Opens. A pick resolves `[{ id:
   "{8FE84297-9486-EC11-93B0-000D3A5C8441}", entityType: "contact", name:
   "Susanna Stubberod (sample)" }]` — an array of `LookupValue`, GUID **braced
   and upper-case**, the opposite of what `getValue` returns (5). Cancel
   resolves `[]`, not `undefined`, and does not reject. Kept for the record
   although 0.4.0 has no caller.
9. **Date operators.** `setFilter({ filterOperator: 0, conditions: [{
   attributeName: dateColumn, conditionOperator: 25, value: 'yyyy-MM-dd' }] })`
   then `refresh()` — do the rows narrow with `dataset.error` false? The same
   for 26 and 27, and the same on a `DateAndTime.DateAndTime` column. Is the
   day compared in the user's zone or in UTC — a record stamped near midnight
   decides.

   *Measured, with one gap.* All three operators are accepted with
   `value: 'yyyy-MM-dd'` and `dataset.error` stays `false`. On the DateOnly
   column, `OnOrBefore` (26) and `OnOrAfter` (27) both narrowed to the rows
   the fixture predicted. On the DateAndTime column, `On` (25) for
   `2026-08-31` returned the record stamped `2026-09-01T04:30:00Z` — 11:30 PM
   on the 31st in the user's UTC-5 — so **the day is compared in the user's
   zone, not UTC**, and the rig models it that way. 27 and 26 on the same
   column agreed. **`On` (25) on the DateOnly column is unresolved:** the
   first run read during the loading blip and the third issued its `refresh()`
   inside the ~12 s window of the previous `clear()`'s refresh, and the count
   never moved. It goes to the live walkthrough at release, run alone; the
   day-in-user-zone answer from the DateAndTime column is what the
   implementation rests on meanwhile.

   Two things about `refresh()` itself, learnt by getting them wrong: it
   takes **3–14 s** on this subgrid, and a `refresh()` issued while one is in
   flight appears to be **dropped rather than queued**. So the control never
   chains them — one `setFilter` → one `refresh()`, debounced, exactly as the
   0.2.0 filter already does — and the loading state briefly reports **0
   rows**, so nothing reads `sortedRecordIds.length` as an answer while
   `dataset.loading` is true.
10. **Choice filter value type.** `Equal` on the Choice column with
    `value: '3'` — accepted? With `3`? Either?

    *Measured.* Either. `3` as a number returned the one row holding it; `'3'`
    as a string returned the same row after the fixture had moved on. The
    control sends the string, which is what `ConditionExpression.value` is
    typed as.
11. **Quick create.** `navigation.openForm({ entityName: 'cll_account',
    useQuickCreateForm: true, createFromEntity })` — does the quick create form
    open? On Save, does the promise resolve with `savedEntityReference[0].id`?
    On cancel, does it resolve, and with what, or reject? After
    `dataset.refresh()`, is the new row in the subgrid?

    *Measured.* The quick create form opens. Save resolves `{
    savedEntityReference: [{ id: "{436E09A8-…}", entityType: "cll_account",
    name: "5" }] }` — braced upper-case GUID again, so `createdRecordId` is
    normalised to the unbraced lower-case form every other output uses. After
    `refresh()` the row was in the subgrid (4 → 5). **Cancel resolves `{
    savedEntityReference: null }`** — not `[]`, not a rejection — so the
    reader is `result?.savedEntityReference?.[0]?.id ?? null`, and a cancel
    triggers no refresh.
12. **Context info.** Is `context.mode.contextInfo` present on the subgrid,
    with `entityTypeName` and `entityId` naming the parent Account? Does passing
    it as `createFromEntity` set the relationship so the row lands in this
    subgrid?

    *Measured.* Present: `{ entityTypeName: 'account', entityId:
    '85f67958-7637-f111-88b5-7ced8d3b545a', entityRecordName: 'Account Message
    Integration' }` — the parent, unbraced. Passed as `createFromEntity` the
    saved row landed in this subgrid, so the relationship was seeded. It stays
    optional in the code: a main grid has no parent to name.
13. **Prerequisite.** Does `cll_account` have *Allow quick create* on and a
    quick create form? If not, what does `openForm` do instead — open the main
    form, resolve with nothing, or reject?

    *Measured for the first half only.* `cll_account` has the setting on and a
    quick create form, so the form opened. What `openForm` does on a table
    without one was not exercised and is listed under *Not verified*;
    `docs/model-driven.md` names the prerequisite.

**What the measurements changed.** One feature out: the lookup editor (6).
One assumption corrected: choice options are a value-keyed map, not an
`Options` array (3). Three shapes pinned that the typings do not carry: cancel
is `[]` from the dialog and `{ savedEntityReference: null }` from the form;
the dialog and the form both return braced upper-case GUIDs where `getValue`
and `contextInfo` return unbraced lower-case. One host behaviour the rig now
refuses to hide: a `refresh()` during a `refresh()` is lost (9).

### What the rig models now

The dataset rig grew more in this release than in the three before it, because
three of the four features touch surfaces it had never stood in for. Each item
is a claim about the platform, with the measurement it rests on; each is
asserted in `dev/smoke.js`, and the mutation named beside it was applied and
caught before the item was written down.

- **`context.utils.getEntityMetadata`**, resolving a class instance whose
  `Attributes` is a prototype getter with `.get(column)` — the shape the field
  rig in `_template` already carried — and now returning per-attribute nodes
  in the measured shape: `attributeDescriptor.OptionSet` as an array for one
  fixture column and a value-keyed `OptionSet` map for the other, so a parser
  reading only one route is caught by the column that carries the other.
  Absent under `quirks.utilsAbsent` and under `host: 'canvas'` whatever the
  quirk says; rejecting under `quirks.metadataRejects`. *Mutation:*
  `parseOptions` reading the descriptor only → "options are read from the
  value-keyed map" fails with `[]`.
- **`navigation.openForm`**, logging its full options and resolving
  `o.openFormReturns`, whose default is the measured dismissal `{
  savedEntityReference: null }` — the branch a control forgets. Absent under
  `quirks.openFormAbsent` and on canvas. **`mode.contextInfo`** from the
  `contextInfo` host option, `undefined` when unset, as a main grid is
  expected to leave it.
- **`On` (25), `OnOrBefore` (26), `OnOrAfter` (27)** in `holds()`, compared
  as `yyyy-MM-dd` in the local zone, with an empty cell matching none of the
  three. The pass-through default that used to certify an unmodelled operator
  is still there for operators nothing sends, with a comment saying what it
  once let through. *Mutation:* the `On` case removed → "the rig models On by
  calendar day" reads twelve rows; `from`/`until` swapped in `DATE_OPERATOR` →
  both operator checks fail with the other's count.
- **The fixture's shapes.** `statecode` and the new `industrycode` hold
  integers, `ownerid` holds `{ id: { guid }, etn, name }`, and
  `getFormattedValue` turns both into text whether or not `format` is on —
  the platform never shows a choice as its number. `getValue` on a choice
  returns the **string**, as measured, so a control comparing what it wrote
  with what it reads has to coerce; `handle.stored(id, column)` is the rig's
  own back door for asserting the integer was written.
- **Every column-count baseline derives from the fixture** — `VISIBLE` in
  `smoke.js` — after the seventh visible column moved seven of them at once.
  Derived, not copied from the failing output.

Two limits of the rig, stated so nobody reads a green suite as more than it
is. `renderToStaticMarkup` runs no effects, so the choice editor and the choice
filter box never appear in the smoke markup; both are asserted on the props
the class hands down and photographed by `dev/preview.html`, which also gained
the poll that repaints when the rig owes a render — without it a filter typed
by `?date` showed in the box and narrowed nothing in the picture. And the
preview's editor-leaving now dispatches a synthetic `blur` beside the real
one, because `blur()` fires nothing in a document that is not focused, and a
preview pane behind another window is one.

### Verified on a real form

Two builds on the Accounts subgrid, 2026-09-11 and 12. The first (0.4.0)
confirmed **New → save lands the row** in the subgrid and **the filter row
filters**, date boxes and choice boxes alike — and exposed the three date
faults in the section below. The second (0.4.1, with those fixed) walked the
rest: a Choice pick persists across a reload, New → cancel does nothing, each
of On / From / Until narrows the count on both date columns — including `On`
on the DateOnly column, which the probe had never read cleanly — the choice
filter, an edited date cell reading like its neighbours once the refresh
lands, a date-and-time cell taking a time, and the filter row at phone width.
All reported working by the maker. What the import prompt said is still not
on record; it stays under *Not verified*.

### Found on the form, after the probe

The release is numbered **0.4.1**, and the reason is the second import trap:
0.4.0 was the number the first build carried onto the form, and Dataverse
accepts an import at the installed version while leaving the web resource
alone. The feature set is 0.4.0's; the tag is `v0.4.1`.

Three things the first build got wrong about dates, none of which the probe
asked because none of them was new to 0.4.0 — they were 0.3.x behaviour that
the first look at an edited date cell exposed.

**An edited date cell kept its pending text for the life of the page.** The
screenshot showed `2026-09-29` in a column of `9/1/2026 12:30 AM`. That text
is the optimistic override, and it is supposed to go the moment the refresh
lands; the retire test compared `String(record.getValue())` — the ISO string
`"2026-09-29T00:00:00.000Z"` — with `String(pendingDate)` — `"Tue Sep 29
2026 …"` — and the two are never equal. `sameValue` now compares per kind: a
date by the day, a date-and-time by the minute, through the same reader the
editor uses. And while the write is in flight the cell is formatted through
`context.formatting.formatDateShort`, which renders in the *user's* zone, so
the moment reads like the platform's own cell rather than as a different
format.

**A date-and-time cell was edited with a date box.** The 0.3.x comment said
the time half was "preserved rather than offered"; the code wrote local
midnight, which is why row 3 read `12:00 AM`. `DateAndTime.DateAndTime`
columns now edit through `<input type="datetime-local">`, in the browser's
zone — which is the one the reader is typing in, and may differ from the
Dataverse user's; the platform formats the result in the user's, and the two
disagreeing is a limitation stated rather than solved.

**A date-only editor opened a day early west of Greenwich.** The probe
measured `cll_startdate` reading back as `"2026-08-31T00:00:00.000Z"` — the
`pcf-date-range-picker` finding, a DateOnly column hands its day over at UTC
midnight — and `editorValue` read that value's *local* components, which at
UTC-5 is 30 August at 7 PM. The reader now takes the UTC components of a
value at exactly UTC midnight and the local ones of anything else; the write
side anchors a whole day at local **midday**, the range picker's rule, so a
DateOnly-behaviour column keeping the UTC date part and a UserLocal one
keeping the instant both land on the day typed from any zone within twelve
hours of Greenwich. The ambiguity the heuristic leaves — a UserLocal instant
that happens to fall on UTC midnight — is one `Column` cannot resolve, since
`Behavior` lives on the attribute metadata.

The dev rig had hidden all three: its fixture held bare `yyyy-MM-dd` strings
where the platform hands over the ISO instant, so nothing local ever met the
UTC-midnight shape, and its preview never re-read after a write, so the
override's retirement was never watched. Both fixtures — this repository's
and `_template`'s — now carry the measured shapes, the rig's own day reader
takes the UTC-midnight day, and `dev/preview.html` re-reads inside `paint`
where the owed render is consumed. Verified in a browser at UTC-6: the editor
opens on the stored day, a committed day retires its override and reads
`Mar 5, 2026`, and a committed `14:45` reads `2:45 PM`.

### Not verified in 0.4.0

- Nothing in this release has been opened in a canvas app, and the date box
  is the only part of it that would render there.
- A date-and-time edit from a browser whose zone differs from the Dataverse
  user's. The editor takes the time in the browser's zone and the platform
  displays it in the user's; the two were the same on the form this was
  walked on, so the offset case has not been seen.
- The import prompt text for `Utility` (1) — the probe went in as an upgrade
  and nothing was captured.
- `openForm` with `useQuickCreateForm` on a table that has no quick create
  form (13).
- `lookupObjects` with two `entityTypes`, the `Lookup.Customer` case (4, 8) —
  the dialog was opened for `['contact']` only, and nothing in 0.4.0 calls it.
- Whether `record.setValue` on a Lookup column stages on any host other than
  this one (6). One environment, one record, five shapes; the conclusion is
  strong for this host and unmeasured elsewhere.

## 0.5.0

### What it is for

The one feature every community editable grid is judged by that 0.4.0 could
not ship: **editing a Lookup cell.** It was picked outward, like 0.2.0 and
0.4.0 — the editable grid is the most-starred single control category in the
PCF community, and a grid whose lookups are read-only is the first thing a
comparison notices. 0.4.0's probe measured the dialog half working
(`utils.lookupObjects`: a pick is a `LookupValue[]` with a braced upper-case
GUID, a cancel is `[]`) and the write half dead (`record.setValue` on a Lookup
column stages nothing, five shapes tried). The design in *0.4.0 → What it was
going to add* is kept as written; what changes is the write, which has to be
`webAPI.updateRecord` with an `@odata.bind` key.

That costs what 0.3.0 was built to avoid — `<uses-feature name="WebAPI">`, one
more install-time prompt, and a write that does nothing in canvas, where
lookup cells will stay read-only. The trade is taken because the alternative
is no lookup editor at all, measured rather than assumed.

### What must be measured first

Probe build 0.4.2 — throwaway, `DataTable/probe.ts`, `window.__pcfDataTableProbe`
— asks these on the `cll_account` subgrid. Every answer goes here as
*Measured* before a line of the feature exists, and an answer that goes the
wrong way removes the feature that depends on it rather than being worked
around. The manifest already declares `WebAPI required="false"`, because the
prompt is itself a question (1) and a surface that is not declared is not
being measured.

1. **Import.** With `WebAPI` declared `required="false"` beside `Utility`,
   what does the import prompt say, verbatim? On the subgrid afterwards, is
   `context.webAPI` an object with `updateRecord` and `retrieveRecord` as
   functions? Is `context.page.getClientUrl` there?

   *Measured 2026-09-13, prompt still pending.* `context.webAPI` is an
   object; `updateRecord` and `retrieveRecord` are functions, as are
   `utils.getEntityMetadata` and `lookupObjects`. `page.getClientUrl` is a
   function and answers `https://cll365.crm.dynamics.com`; the `Xrm` global
   is present too. `mode.contextInfo` names the parent Account as in 0.4.0.

2. **Bind key case.** Does
   `updateRecord('cll_account', id, { 'cll_primarycontact@odata.bind': '/contacts(guid)' })`
   — the column's *logical* name — resolve and persist? Does the schema-cased
   navigation property `cll_PrimaryContact@odata.bind`? If only the second,
   the control needs a metadata read for every lookup column before it can
   write, and (3) decides where that read goes.

   *Measured, and the question was wrong-footed.* The logical name
   `cll_primarycontact@odata.bind` **resolved in 240 ms** and the Web API read
   back the new contact. `cll_PrimaryContact@odata.bind` was **rejected**,
   400, `errorCode 2147781913`: "An undeclared property 'cll_PrimaryContact'
   which only has property annotations in the payload but no property value".
   The reason is not that the server is case-insensitive — it is that on this
   table the navigation property *is* `cll_primarycontact` (3). So neither
   spelling is a rule: the key is whatever `ManyToOneRelationships` says it
   is, and the control reads it rather than deriving it.

3. **Where the navigation property name lives.** Does the
   `getEntityMetadata` node for a lookup column carry `SchemaName`, at the top
   or under `attributeDescriptor`? Does
   `EntityDefinitions(LogicalName='cll_account')/ManyToOneRelationships`
   answer through a same-origin `fetch`, and does it list one row for
   `cll_primarycontact` and **two** for `cll_customer` (one per target), each
   with `ReferencingEntityNavigationPropertyName`? For a Customer lookup the
   schema name cannot be the key — there are two keys — so this query is the
   only route unless (2) accepts the logical name.

   *Measured.* The `getEntityMetadata` node carries **no `SchemaName`** at
   either level: its own keys are `_attributeType`, `_clientApiExecutor`,
   `attributeDescriptor`, `_logicalName`, `_displayName`,
   `_entityLogicalName`, `_isValidForGrid`, `_attributeTypeName` and (Simple
   only) `_attributeTargets`; the descriptor has 48 keys, `Targets` among
   them, `SchemaName` not. `ManyToOneRelationships` answered 200 in 84 ms
   through a same-origin `fetch` with three rows for the view's two lookups:
   `cll_primarycontact → contact → cll_primarycontact`,
   `cll_customer → account → cll_customer_account`,
   `cll_customer → contact → cll_customer_contact`. That is the read the
   control makes, once per table, in `init`. A second route surfaced on the
   read-back: `_x_value@Microsoft.Dynamics.CRM.associatednavigationproperty`
   names the navigation property of the *current* value — useful for a
   populated cell, absent for an empty one, and silent about a Customer
   lookup's other target, so the relationship query stays the source.

4. **Entity set name.** Does `getEntityMetadata('contact').EntitySetName`
   answer `contacts`, and `getEntityMetadata('account')` → `accounts`? The
   bind value is `/<set>(<guid>)`; `pcf-tag-list` rests on this key and has
   never been on a form.

   *Measured.* `contacts`, `accounts`, and `cll_accounts` for the table
   itself — so `pcf-tag-list`'s key holds. The node also answers
   `PrimaryNameAttribute` (`fullname`, `name`), which is what a lookup filter
   box would search on if one is ever built.

5. **Customer write.** Does
   `{ 'cll_customer_contact@odata.bind': '/contacts(guid)' }` persist to
   `cll_customer`, and does the read-back's
   `_cll_customer_value@Microsoft.Dynamics.CRM.lookuplogicalname` say
   `contact`?

   *Measured.* Resolved in 127 ms; the read-back is `_cll_customer_value`
   = the contact's GUID, `lookuplogicalname: contact`,
   `associatednavigationproperty: cll_customer_contact`, formatted value the
   contact's name. The dialog's `entityType` on the pick (9) is what selects
   the key.

6. **Clear.** Does `updateRecord` with `{ 'cll_PrimaryContact@odata.bind': null }`
   resolve and clear the column, or reject — and with what? If it rejects,
   does a same-origin `DELETE …/cll_accounts(id)/cll_PrimaryContact/$ref`
   return 204 and clear it? The second is a write outside `context.webAPI`;
   whether the editor offers a clear at all depends on the first, and
   shipping the second is a decision to take on the answer, not a default.

   *First run measured the wrong key* — `cll_PrimaryContact`, which (2) and
   (3) had just shown is not a navigation property on this table, so both
   halves refused for that reason alone: `updateRecord` with `null` → 400
   "Invalid property 'cll_PrimaryContact' was found in entity"; the `$ref`
   DELETE → 400 `0x80060888` "The URI segment '$ref' is invalid after the
   segment 'cll_PrimaryContact'". Re-run with `cll_primarycontact`:

   *Measured — `null` clears.* `updateRecord('cll_account', id,
   { 'cll_primarycontact@odata.bind': null })` **resolved in 161 ms** with the
   usual `{ id, entityType }`, and the read-back was
   `_cll_primarycontact_value: null` — no annotations, which is how an empty
   lookup reads. The `$ref` DELETE also works (204 in 130 ms, run against an
   already-empty column), and is **not shipped**: the editor's clear stays
   inside `context.webAPI`, so the control makes no write the feature
   declaration does not cover. The fetch route is recorded here as the
   fallback that exists if a host ever refuses the `null` bind.

7. **Shapes.** What does `updateRecord` resolve with — `{ id, entityType }`,
   with a `name`? What does a write to a GUID that does not exist reject with —
   `{ errorCode, message }`, and is `message` readable, unlike the `UciError`
   snapshot string? Does `retrieveRecord` with `?$select=_x_value` return the
   `@OData.Community.Display.V1.FormattedValue` annotation, so the optimistic
   cell can be confirmed against the server's own name?

   *Measured, bad-GUID half pending.* `updateRecord` resolves
   `{ id: '990d527b-…', entityType: 'cll_account' }` — the record written,
   unbraced lower-case, **no `name`** — so the optimistic cell's label comes
   from the dialog's pick, not the write. A rejection is
   `{ errorCode, message, code, title, raw }`: `errorCode` numeric
   (`2147781913`), `message` a readable string that opens with the generic
   "Error identified in Payload provided by the user" and carries the useful
   sentence after `InnerException :`, `raw` the whole fault as JSON. Readable,
   unlike `UciError`, but the control shows the inner sentence rather than
   the first one. `retrieveRecord` with `?$select=_x_value` returns the value
   **and three annotations** — `FormattedValue`, `lookuplogicalname`,
   `associatednavigationproperty` — in ~80 ms. The non-existent-GUID write
   was sent with the wrong key (6) and measured the same undeclared-property
   error. Re-run with the right key: **rejected in 273 ms** with
   `{ errorCode: 2147746327, message: 'The requested record was not found.',
   title: 'Record Is Unavailable' }` — a one-sentence `message` and a
   `title`, with the specific text ("Entity 'Contact' With Id = … Does Not
   Exist", HTTP 404, `ApiExceptionMessageName: ObjectDoesNotExist`) only in
   `raw`. So the two rejections seen so far have different shapes of
   `message`: a payload fault buries the useful sentence after
   `InnerException :`, a server fault puts it first. The control shows
   `title` when present, then the first sentence of `message`, and never
   parses `raw`.

8. **What the subgrid shows.** After a resolved `updateRecord`, does
   `record.getValue(lookupColumn)` still return the old reference until
   `dataset.refresh()`? How long does the refresh take this time, and does
   the row then carry the new name? This decides whether the optimistic value
   from 0.3.x's editor holds through the same stale window.

   *0.4.2 could not answer it, and the reason is a probe finding.* After the
   write in (2) the Web API held the new contact; the dataset record said the
   old one before `refresh()` and still said it 15 s later with `loading`
   false. But the probe read `records[id]` off the dataset object it had
   parked on the **first** `updateView` — so the line cannot distinguish "the
   subgrid did not re-read" from "that object is a dead snapshot and each
   pass hands down a new one". 0.4.3 keeps the latest context, polls both
   each second for 30 s and reports whether they are the same object.

   *Half measured, by eye.* After the subgrid's own refresh the rows showed
   the contacts the probe had written — Patrick Sands on
   `cll_primarycontact`, Susanna Stubberod on `cll_customer` — so the
   subgrid **does** re-read after a write, and the 0.4.2 line was reading a
   dead snapshot. Which object is live, and how many seconds the control's
   own `refresh()` takes to hand the new value down, is what 0.4.3 answers.

   *Measured on 0.4.3.* **`context.parameters.records` is a new object on
   every `updateView`** — `sameDatasetObject: false`,
   `sameRecordsObject: false`, and the first-pass dataset's record read
   `null` before, during and after the refresh while the latest context's
   record went from `null` (the pre-write value, cleared in 6) to the new
   contact. So a control must read the dataset off the context it was just
   handed and never off one it kept; the 0.3.x editor already does, which is
   why this never bit it. The write resolved in 139 ms; `refresh()` produced
   one new pass and the new value was on it at **t+1 s** — one pass, ~1 s,
   against the 3–14 s a filter refresh took in 0.4.0. The optimistic cell
   therefore covers a window of about a second on this host, and the same
   `refresh()`-after-write rule 0.3.3 established (*`refresh()` is part of
   the write*) holds for a lookup.

**What the measurements changed.** Nothing was cut. Two assumptions in the
questions were wrong and both are now facts the control reads rather than
derives: the bind key is whatever `ManyToOneRelationships` names, which on
this table is the logical name and not the schema-cased one (2, 3); and a
clear is a `null` bind through `updateRecord`, so the `$ref` DELETE the
design had budgeted for is not needed (6). One probe fault found and fixed:
reading a dataset off a parked context (8). One trade confirmed: the write
resolves without a `name`, so the cell's label comes from the dialog's pick
until the refresh lands (7).

9. **Customer dialog.** Does `lookupObjects({ entityTypes: ['account',
   'contact'] })` open with a table switcher, and does the resolved
   `entityType` name the table picked — the value the bind key in (5) is
   chosen by?

   *Measured.* Opens (11.8 s to a pick, most of it the person choosing);
   resolves `[{ id: '{8FE84297-…}', entityType: 'contact', name: 'Susanna
   Stubberod (sample)' }]` — braced upper-case as in 0.4.0, and `entityType`
   names the table, which is what picks `cll_customer_contact` over
   `cll_customer_account`. Whether the dialog showed a table switcher was not
   reported; the pick was a contact, which is the half that matters.

Not asked, and listed here so they are not mistaken for answered: an
`Owner` lookup (none in the view; `ownerid` binds through
`ownerid@odata.bind` to `systemusers` or `teams` and is a separate
measurement); a write refused by privilege rather than by a bad GUID; and any
of this on canvas, which has no `webAPI` at all.

### What shipped, and the shape it took

Every measurement above turned into one line of design, and the design is
smaller than the one 0.4.0 had planned because two of the measurements
removed work rather than adding it.

- **The editor is two buttons, not an input.** A lookup cell in edit mode
  shows the current name, *Choose…* and — while there is something to clear —
  *Clear*, with a cross to close. Choose opens `utils.lookupObjects` with every
  table the column's metadata names (the Customer column's two, read from
  under `attributeDescriptor` because the top-level `Targets` is `undefined`
  there); the resolved `entityType` is what picks the navigation property. No
  type-ahead beside it: the platform's dialog carries the views, the search and
  the security, and `pcf-lookup-search` already records why a second picker is
  a worse one.
- **The write reads its key.** `writeLookup` fetches the bound table's
  `ManyToOneRelationships` once (same-origin, `page.getClientUrl` first and
  the `Xrm` global as fallback — the `pcf-grid-data-bars` rule), resolves the
  target's `EntitySetName` once per table, and calls `updateRecord(entity, id,
  { '<navigationProperty>@odata.bind': '/<set>(<guid>)' })`. A clear is the
  same call with `null`, on the navigation property of the value being
  cleared; clearing an empty cell writes nothing. The `$ref` DELETE that also
  works is not used — no write leaves `context.webAPI`.
- **Four host surfaces, one prop.** `pickLookup` is function-or-null on the
  `loadOptions` argument: `lookupHost()` in `index.ts` needs `utils.lookupObjects`,
  `utils.getEntityMetadata`, `webAPI.updateRecord` and an organisation URL, and
  any one missing withholds the editor. Canvas is all four. The rig removes
  them one at a time and the suite asserts each withholds.
- **The refusal is one sentence.** `faultMessage` takes the last segment after
  `InnerException :` or `--->`, strips the exception class, and keeps the first
  sentence — so a payload fault reads "An undeclared property 'x' …" and a
  server fault reads "The requested record was not found.", and `raw` is never
  shown.
- **The cell lets the editor out.** Four things need ~150px and a lookup
  column is often narrower; the first screenshot photographed the name and the
  cross clipped by the cell's `overflow: hidden`. The editing cell is now
  positioned, un-clipped and lifted (`z-index: 3`, over the pinned cells' 2),
  and the editor floats at `max-content` width — a transient surface, like the
  choice editor's dropdown. Found by looking, not by an assertion.
- **Owner stays read-only.** `Lookup.Owner` binds through `ownerid` to two
  tables and nothing here has watched that write; `editKindFor` returns
  `'none'` for it and says why.

The rig grew four surfaces to model this — `webAPI.updateRecord` applying a
bind the way the server did and refusing the way it did, `utils.lookupObjects`
resolving braced upper-case, `page.getClientUrl`, and a same-origin `fetch`
stub for `EntityDefinitions` — each with its absence as a quirk, and
`fixture.withLookups()` for a view with a `Lookup.Simple` and a
`Lookup.Customer` on it. Fifteen assertions; the load-bearing one (the key
comes from the fetch, not from the column name) was broken on purpose and
failed by name.

### Verified on a real form

Walked on the Accounts subgrid on 2026-09-13, the same day as the probe, with
the 0.5.0 build: a Primary contact cell opened as its name with *Choose…* and
*Clear*, the platform's dialog opened from it, a pick showed at once and the
refresh confirmed it; a Customer cell took an **account** through
`parentcustomer_account` — the navigation property the probe had only ever
asserted against the rig's table; a populated cell cleared; an empty cell
offered no *Clear*; Escape and the cross closed without writing. Released as
`v0.5.0` on the number the walkthrough build carried.

### Not verified in 0.5.0

- **The import prompt text for `WebAPI`** — the walkthrough build went in as
  an upgrade and the text was not recorded, as with `Utility` in 0.4.0.
- **A write refused by privilege**, as opposed to by a bad GUID. The shape
  is assumed to be the server-fault shape (7) and the sentence is whatever
  the platform sends.
- **The `Xrm` global fallback for the organisation URL.** `page.getClientUrl`
  answered on the probe form, so the fallback has never been the path taken.
- **On-premises**, where the organisation sits in a path and the
  `clientUrl` preference is the thing that matters.

## 0.6.0 — the whole view, rather than the page

### What it is for

Picked outward again, the way 0.2.0, 0.4.0 and 0.5.0 were. `docs/limitations.md`
has said **"No grouping and no aggregate row"** since 0.2.0, and grouping is
what every featured grid in the PCF gallery has that this one does not — *Smart
Grid*, *Dynamic Group Grid*, *Power Apps Grid Extensions*. It is the first thing
a comparison notices after the lookups 0.5.0 closed.

It ships beside full-view CSV export, and the pairing is not a coincidence:
**both are answers about the whole view rather than the page currently loaded.**
One idea, one caption vocabulary, one honesty rule — a page-sized number shown
as the whole is the bug the caption exists to prevent, and it is the same bug in
both features. Multi-column sort rides along because `docs/limitations.md` names
it in the same list and the code is four lines; whether it ships at all is a
measurement, not a decision (S1–S7 below).

### What must be measured first

Probe build **0.5.1** — throwaway, `DataTable/probe.ts`, `window.__pcfDataTableProbe`
— asks these on the `cll_account` subgrid. Same rule as 0.4.2 and 0.5.0's probe:
every answer goes here as *Measured* before a line of the feature exists, and an
answer that goes the wrong way **removes the feature that depends on it** rather
than being worked around.

Two of these are not new questions but new *hosts* for questions
`pcf-chart-view` answered on 2026-09-17 and 2026-09-19. Repeating them is
deliberate — that control renders no columns and binds a different dataset, and
"a sibling measured it" is not the same as "this control measured it", which is
the mistake the *Still open* note about paging already records.

1. **G1 — the view, and its definition.** Does `getViewId()` answer on this
   subgrid? Does `retrieveRecord('savedquery', id, '?$select=fetchxml')`, and
   does `userquery` answer for a personal view? chart-view measured `getViewId()`
   as `null` on a bound lookup's dataset; a view whose definition cannot be read
   sends no aggregate at all, so this gates the whole server route.

   ***Measured 2026-09-20, on the `cll_account` subgrid.*** `getViewId()`
   answered `"50901766-ba1b-46e0-850b-e1a3991ade2e"` — a `string`, **bare and
   lower-case**. So both this and chart-view's `null` are true; it is the host
   that differs, and the read has to cope with either.

   `retrieveRecord('savedquery', id, '?$select=fetchxml')` **resolved**, 664
   characters, containing `<fetch`. Four things in what came back matter more
   than the fact that it did:

   ```xml
   <fetch version="1.0" mapping="logical" savedqueryid="50901766-BA1B-46E0-850B-E1A3991ADE2E">
     <entity name="cll_account">
       <attribute name="cll_accountid"/>
       <attribute name="cll_accountname"/>
       <order attribute="cll_accountname" descending="false"/>
       <filter type="and"><condition attribute="statecode" operator="eq" value="0"/></filter>
       <attribute name="createdon"/>
       …nine more attributes…
     </entity>
   </fetch>
   ```

   - **`<order>` and `<filter>` sit *between* `<attribute>` elements, not after
     them.** The view designer emits them wherever the maker added them, so
     there is no positional structure to rely on: a rewriter that took
     "everything after the last `<attribute>`" would drop nine columns'
     worth of nothing and both the sort and the filter. `stripView`'s global
     regexes are not defensive coding, they are the only thing that works.
   - **`savedqueryid` in the XML is upper-case; `getViewId()` is lower-case.**
     Never compare the two without normalising. Nothing does yet, and nothing
     should start without this line in front of it.
   - **The root `<fetch>` carries `version` and `mapping`.** The aggregate is
     built as a fresh `<fetch aggregate='true'>`, so both are dropped;
     `mapping="logical"` is the default and `version` is decorative, so that is
     safe — recorded because it is safe *by luck* rather than by design.
   - **The view's own `<filter>` is inside `<entity>`**, so it rides along in
     the carried-over content, and the dataset's runtime filter is appended
     after it as a **second sibling `<filter>`**. FetchXML ANDs siblings, which
     is the wanted answer — but it is two filters, not one merged, and a reader
     of the generated query should expect that.

   `retrieveRecord('userquery', …)` **refused, 404**, in the payload-fault
   shape the control already knows:

   ```
   errorCode 2147746327, code 2147746327, title "Record Is Unavailable"
   message  "The requested record was not found."
   inner    "Entity 'userquery' With Id = 5090… Does Not Exist"
   ```

   **And the platform logs that 404 to the console itself, before the control
   sees it.** That is unavoidable — it happens inside the platform's own OData
   layer, above any `catch` here. In the probe it is noise, because the probe
   asks both tables unconditionally to find out what each does. In the shipped
   control the order is savedquery first and userquery only on failure, so a
   **system** view costs no 404 at all — but a **personal** view costs exactly
   one logged 404 per view read, with a red stack trace, on a form that is
   working correctly. That belongs in `docs/limitations.md` before the first
   person reports it as a bug.

2. **G2 — N groups and M measures.** The assumption most likely to be wrong, and
   the one the alias plan rests on. chart-view aggregates **one** group column
   with **one** measure and reads its label off
   `<alias>@OData.Community.Display.V1.FormattedValue`. Three separate things
   could fail here and they fail differently: Dataverse could refuse more than
   one `groupby`; a Choice group could arrive as an integer under one alias and
   a string under another (it is already known to be either on a dataset
   record); and **the formatted-value annotation could come for the first group
   alias only**, which would leave every group after the first labelled with a
   raw option-set number.

   ***Attempted 2026-09-20, and refused before it could answer.*** The first
   run passed `cll_accountid` — the primary key — as the measure, and the
   server declined the whole query rather than the one attribute:

   ```
   HTTP 400, 0x8004112f, errorCode 2147750191
   "Aggregate AVG or SUM is not supported for attribute of type primarykey."
   ```

   Three things worth keeping from a failed measurement:

   - **A refusal is whole-query, not per-attribute.** One unusable measure
     costs the group counts too. So `parseAggregates` refusing what it cannot
     spell is not tidiness — it is the difference between a table with no
     `avg` column and a table with no rows.
   - **`count` over the primary key is fine; `sum` and `avg` are not.** The
     alias plan asks for `count` on the PK unconditionally, which is correct
     and now known to be correct. Only the *measure* list has to exclude it.
   - **This is a G5 answer arriving early**, and a better-shaped one than G5
     was going to produce: a refusal naming the attribute *type* rather than
     the attribute, in the same payload-fault shape as every other server
     fault this control already reads. `messageOf` will render it as a
     sentence a maker can act on without changing.

   **And the platform's own console log scrubs the message.** The same refusal
   appears twice in the console, from two sources, saying different things:

   ```
   [storage] Error Messages:
   1: Aggregate _scrubbedSensitiveData_          ← the platform's log
   ```
   ```
   "Aggregate AVG or SUM is not supported for
    attribute of type primarykey."               ← the caught rejection
   ```

   This is the strongest argument yet for a design decision the control had
   already made for weaker reasons. **The caught error is the only place the
   real message exists** — the platform's log redacts it to a single word, so
   "check the console" is advice that leads a maker to less information than
   the control is already holding. Every refusal this feature can produce has
   to be rendered *in the control*, through `messageOf`, or it is effectively
   unreportable.

   It also means a support conversation that starts from a screenshot of the
   console is starting from `_scrubbedSensitiveData_`. Worth one line in
   `docs/faq.md`.

   **The view has no numeric column at all** — its twelve are a primary key, a
   name, three dates, two choices, a tag field, two lookups, `statecode` and
   `statuscode`. So the M-measure half of G2 cannot be asked from this view
   without either a numeric column on `cll_account` or a different table, and
   the N-group half is being asked separately with `count` alone.

   ***Measured 2026-09-20, count-only, on the same subgrid.*** All three parts
   answered, and the one most expected to fail was wrong in the useful
   direction.

   ```json
   {"n@…AttributeName":"cll_accountid","n@…FormattedValue":"2","n":2,
    "g0@…AttributeName":"cll_industry","g0@…FormattedValue":"Retail","g0":1,
    "g1@…AttributeName":"cll_priority","g1@…FormattedValue":"Low","g1":1}
   ```

   - **Two `groupby` attributes are accepted.** Five rows, one per present
     combination. The alias plan generalises; nothing about N is special-cased.
   - **A Choice group arrives as an `number`** — `"g0":1`, not `"1"`. **This is
     the opposite of the dataset route**, where a Choice read off a record can
     be the string `"1"` (measured on `pcf-chart-view`, and this control's own
     `parseOptions` already copes). So the two routes disagree about the type
     of the same value, and the `GroupReading` seam is the only place that can
     be reconciled. **Normalise to a number at both boundaries** — an assertion
     that the browser route and the server route produce the same keys over the
     same rows is what stops this drifting apart later.
   - **`FormattedValue` comes back for *every* alias**, not just the first —
     `g0` "Retail", `g1` "Low", and `n` "2". The label for every group column is
     free. That removes an entire dependency the design had budgeted for: the
     **server route needs no `getEntityMetadata` call to label groups.** It is
     still wanted for option *colour* and authored *order*, and the browser
     route still needs it — but a metadata read that fails no longer costs the
     group headers their names.
   - **`@OData.Community.Display.V1.AttributeName` comes back for every alias
     too**, naming the column each one came from. The response is
     self-describing, which buys a free integrity check: assert the returned
     `AttributeName` matches what the alias plan asked for, and a mis-built
     query becomes a caught error rather than a mislabelled column.

   **And `dataset.columns` does not contain the primary key.** G0 listed ten
   columns — text, four Choices, a multi-select, two lookups and two dates —
   while the view's own FetchXML selects `cll_accountid` and `createdon` as
   well. So `dataset.columns` is the grid's *layout*, not the view's selected
   attributes, and **the PK cannot be read from it**. The count attribute's
   name has to be derived or read from metadata; `{entity}id` was right here
   and is wrong for every activity table, which is why `pcf-chart-view` carries
   an `ACTIVITIES` set. Port it rather than deriving.

3. **G3 — the blank group.** chart-view assumes a null group value arrives with
   the alias **omitted from the row entirely** rather than present and null. The
   reader branches on that, and the browser route has to agree with it or the
   two routes disagree about which records are blank — which is the one
   disagreement a caption cannot explain away.

   ***Measured 2026-09-20, grouping by `cll_primarycontact`.*** Six rows, and
   the blank group came back **first**:

   ```json
   {"n@…AttributeName":"cll_accountid","n@…FormattedValue":"2","n":2}
   ```

   **The alias is omitted from the row entirely** — no `g0`, and no `g0@…`
   annotations either. chart-view's assumption holds exactly, so the reader
   branches on `hasOwnProperty` rather than on a null.

   **A lookup group carries a third annotation, and it is the useful one:**

   ```json
   "g0@…FormattedValue": "Susanna Stubberod (sample)",
   "g0@Microsoft.Dynamics.CRM.lookuplogicalname": "contact",
   "g0": "8fe84297-9486-ec11-93b0-000d3a5c8441"
   ```

   The value is a **bare lower-case GUID as a string**, the label is free as
   everywhere else, and `lookuplogicalname` names the *target table*. That was
   not asked for and is worth having: it is what an expand-as-filter condition
   would otherwise read from `ManyToOneRelationships`.

   So **the annotation count per alias is two or three depending on type**, and
   a reader assuming exactly two is wrong on every lookup.

4. **G4 — two functions over one column.** Asked separately from G2 so that a
   G2 failure has one fewer candidate reason. If the server refuses a duplicate
   attribute name, `aggregates` caps at one function per column and
   `parseAggregates` has to refuse the second rather than send it.

   ***Measured 2026-09-20, `min` and `max` over `cll_lastcontacted`*** — this
   table has no numeric column, and min/max over a date asks the same question.
   **Accepted.** Four rows, `m0` and `m1` both present with distinct values. The
   M-measure half of the alias plan stands: one attribute may appear twice under
   two aliases with two functions.

   And a second finding min/max produced for free, which `sum`/`avg` never
   would have: **a date aggregate comes back as a UTC ISO string, with the
   formatted value in the Dataverse user's zone.**

   ```json
   "m0": "2026-09-11T13:00:00Z",  "m0@…FormattedValue": "9/11/2026 8:00 AM"
   ```

   Five hours apart, consistently, across every row. So a measure is not simply
   a number to print — **rendering `m0` raw would be five hours wrong for this
   user and right for nobody.** Show `FormattedValue`, or convert through
   `offsetReader`; the date rules this repository already carries apply to
   aggregate results exactly as they do to record values.

5. **G5 — the two refusals.** The `AggregateQueryRecordLimit` refusal
   (`0x8004E023`, 50,000 records) and a column FetchXML will not group at all.
   The first **closes `pcf-chart-view`'s open P7** — nothing in this estate has
   seen it. Reaching it needs a table over 50,000 rows; if there is none, that
   is a finding to record rather than a number to guess, and the fallback stays
   reasoned.

   ***The multi-select half measured 2026-09-20; the record-limit half is
   still unreachable*** — no table here is over 50,000 rows, so
   `AggregateQueryRecordLimit` and `pcf-chart-view`'s open P7 both stay open.
   Recorded as unmeasured rather than guessed.

   Grouping by `cll_tags`, a `MultiSelectPicklist`, refused with HTTP 400 and
   `errorCode 2147811876`. **And the two sources disagreed about how useful the
   message was — the opposite way round from G2.**

   ```
   platform log:  groupby cannot be specified for attribute type
                  MultiSelectPickList. NodeXml: <attribute name="cll_tags"
                  groupby="true" alias="g0" />
   caught error:  The specified XML file "{0}" is not valid as attribute of
                  type multiselect optionset is not allowed as groupby attribute.
   ```

   **The caught message carries an unsubstituted `{0}`.** The server sent a
   message template with its parameter never filled in, so a control that
   renders the caught text verbatim — which is what `messageOf` does, and what
   the G2 finding argued *for* — shows a maker a sentence with a formatting
   placeholder in it. That reads as a bug in this control.

   So the two refusals measured so far point in opposite directions, and
   neither source can be trusted alone: **G2's log was scrubbed to one word
   while its caught error was perfect; G5's log names the attribute and the
   exact XML while its caught error is a broken template.** There is no rule
   here of the form "prefer the rejection" — which is what the first draft of
   this section was about to conclude.

   **The design answer is therefore not to render this refusal at all.**
   `MultiSelectPicklist` is visible in `dataset.columns` before any query is
   sent, so `parseGroupColumns` refuses it **client-side**, the same way
   `filterKindFor` already vetoes types it cannot filter, and the maker gets a
   sentence this repository wrote. The group-column allow-list is by
   `dataType`, decided locally, and the server is never asked a question whose
   refusal cannot be shown to anybody.

   That leaves server refusals for the cases a client cannot predict — the
   record limit, a privilege, a malformed view — where `messageOf` is still
   right and the `{0}` risk is worth one guard: **if a rendered message still
   contains `{\d}`, fall back to a sentence naming the operation rather than
   showing the template.**

6. **S1–S7 — multi-column sort.** `dataset.sorting` is typed `SortStatus[]`, and
   this repository's own rule is that a required member is a claim about the
   **type definitions** rather than about any host. So: does the platform honour
   a multi-entry array at all (S1); does it still hold both entries after the
   refresh (S2); does it survive `paging.reset()` and a page turn (S3); does it
   replace the view's `<order>` or prepend to it (S4); is there a ceiling (S5);
   does a `disableSorting` column poison the whole array (S6); and canvas (S7).

   **If S1 or S2 come back badly, `enableMultiSort` is deleted whole** — the
   decision 0.4.0 made about the Lookup editor. Nothing else in 0.6.0 depends on
   it, and a rank indicator over an order the platform quietly collapsed is a
   wrong answer that looks completely right.

   ***Partly measured 2026-09-20, and the headline result is a false pass.***

   | | |
   | --- | --- |
   | **S2** — does `sorting` still hold both entries after `refresh()`? | **Yes.** Both survived unchanged. |
   | **S3** — does it survive `paging.reset()` and a page turn? | **Yes.** Both still there. |
   | **S5** — is there a ceiling? | **Not in the array.** Four entries pushed, four retained. |
   | **S4** — replace or prepend? | `sorting` arrived holding **one** entry, `cll_accountname` ascending — which is the view's own `<order>`. So the platform seeds the array from the view, and clearing it before pushing **replaces** that order rather than adding to it. |
   | **S6** | Skipped — no `disableSorting` column in this view. |
   | **S1** — **does the platform honour the second entry?** | **Unanswered.** |

   **S1 is why this is recorded as a false pass.** The probe sorted by
   `cll_accountname` then `cll_lastcontacted`, and the rows came back in name
   order — which is exactly what a platform ignoring the second entry would
   also produce. Every `cll_accountname` in this view is distinct, so **the
   primary sort never produced a tie, and the secondary sort never had anything
   to break.** The rows agreeing with the request is not evidence the request
   was honoured.

   That is the same class of error as the historic `img.src` bug in
   `dev/dom.js`: *a check that cannot observe the thing it is checking reports
   its own blindness as proof.* It would have been very easy to read the three
   green rows above, conclude multi-sort works, and ship a rank indicator over
   an order the server had quietly collapsed — which is the exact failure S1
   exists to prevent.

   **The corrected measurement needs ties**: sort by a low-cardinality column
   first — `cll_industry` has four values across eight rows — then flip only
   the *second* entry's direction and compare. If the order within each industry
   reverses, the second entry is honoured; if the two runs are identical, it is
   ignored and `enableMultiSort` is deleted.

   ***The corrected tie-breaking test was run 2026-09-20, printed
   `IDENTICAL — the second entry is ignored`, and that verdict is withdrawn.***

   ```
   industry ASC, name ASC : Services/1  Retail/2  Retail/3  Technology/4  Manufacturing/5
   industry ASC, name DESC: Services/1  Retail/2  Retail/3  Technology/4  Manufacturing/5
   ```

   **Look at the industry column: 3, 1, 1, 4, 2.** That is not ascending. The
   *first* sort entry was not honoured either — so this is not "the second
   entry is ignored", it is *nothing was applied at all*. What the rows are in
   is `cll_accountname` ascending, which is the view's own `<order>`.

   Two explanations fit, and the test cannot separate them:

   - the platform ignores a mutated `dataset.sorting` on this host, in which
     case **v0.5.0's single-column sort does not work either** and that is a
     bug in a shipped release, not a finding about 0.6.0; or
   - the snippet captured `const d = ...held.host.dataset` once and mutated
     `d.sorting` across two refreshes — **the same stale-object defect as
     `E()`** — so the second run wrote to an array the platform had already
     replaced.

   The second is likelier, because the first run should still have worked. But
   "likelier" is not a measurement, and the question now reaches further than
   `enableMultiSort`: **it asks whether sorting works at all.** `docs/limitations.md`
   has claimed server-side sorting since 0.2.0 and this file's *Still open*
   already says nothing from 0.2.0 has been seen on a real form.

   Also void: the earlier `S()` run used the probe's defaults, `name` and
   `createdon`, neither of which is a column on `cll_account` — every row read
   back `null` for both. The array-retention observations (S2, S3, S5) survive,
   since they only assert what a JS array holds. Nothing about row order does.

   ***Re-measured 2026-09-20 against a dataset re-read on every pass. S1 is
   answered: the platform honours a multi-entry `sorting` array.***

   **Single-column sort works**, which clears v0.5.0 — there was no shipped
   bug, only a probe reading a stale snapshot:

   ```
   name ASC   Services/1  Retail/2  Retail/3  Technology/4  Manufacturing/5
   name DESC  Retail/ZZ Probe B 012  Technology/B 011  Services/B 010  …
   ```

   **And the second entry is honoured.** Grouping the sort by `cll_industry`
   produced ties, and flipping only the *second* entry reversed the order
   inside them:

   ```
   ind ASC / name ASC   Manufacturing/5  …/7  …/8  …/A 001  …/A 005
   ind ASC / name DESC  Manufacturing/B 009  …/B 005  …/B 001  …/A 033  …/A 029
   ```

   So **`enableMultiSort` ships.** S1 through S5 are all answered green; S6 has
   no `disableSorting` column here to try; S7 (canvas) is untouched.

   **One finding nobody asked for, and it decides a default.** Ascending by
   `cll_industry` put **Manufacturing first** — and Manufacturing is option
   value **2**, while Retail is **1**. So the platform sorts an OptionSet
   column by its **label**, alphabetically, not by its option value.

   That matters directly to grouping: the aggregate hands back `g0` as the
   *integer*, so a control ordering its group headers by that integer would
   produce Retail, Manufacturing, Services, Technology — while the rows
   underneath, sorted by the same column, come back Manufacturing, Retail,
   Services, Technology. **The headers and the rows would disagree about
   order, on the same column, in the same table.**

   `groupSort` defaulting to `label` was already the plan; it now has a
   measured reason rather than an aesthetic one, and `groupSort: 'value'`
   should probably not exist at all.

7. **E1 — `loadExactPage` in a loop.** The export machine steps forward up to
   forty times. `goToPage`'s own comment records that nothing has watched this
   past page two. Eight pages, timed, watching whether the row count climbs
   (the host accumulates) or holds.

   ***Run 2026-09-20 against 56 seeded rows — and the run is void.*** Recorded
   in full because what it got wrong is more useful than what it measured.

   ```
   hasLoadExactPage                true
   totalResultCount                56
   E2  pageSize after asking 250   5      ← unchanged
   E2  rows arrived                5
   E1  pages 1–8                  rows 5, hasNextPage true, and the SAME
                                   firstId 41f39f1a… on every one of the eight
   ```

   Read at face value this says `loadExactPage` is a no-op and `setPageSize` is
   ignored. **It says neither, because the probe drove all eight pages against
   a dataset object it captured once.**

   `E()` opens with `const dataset = need().dataset`, and
   **`context.parameters.records` is a new object on every pass** — measured on
   0.4.3, recorded in this file, and stated in the skill as *never write against
   a dataset you kept*. So after the first fetch the probe was calling
   `loadExactPage` on a stale object and reading `sortedRecordIds` off a frozen
   snapshot. An identical `firstId` across eight pages is exactly what a frozen
   snapshot looks like, and it is also exactly what a broken `loadExactPage`
   looks like. **The measurement cannot tell those apart.**

   The same defect is in `S()`, `P1()` and `G0()` — every function here opens
   the same way. It matters for `E()` and `S()` because they fetch; the others
   read once and are unaffected.

   **This is the third time in this release the same shape has appeared**: the
   stale bundle after a lint failure, the sibling version that passed by
   coincidence, and now a probe reading a snapshot of the thing it is
   mutating. *A check that cannot observe the thing it is checking reports its
   own blindness as proof.*

   ***Re-measured 2026-09-20 against a dataset re-read on every pass. Both
   answered, and both in the control's favour.***

   **E2 — `setPageSize` is honoured, not clamped and not ignored.** This closes
   the *genuinely unknown* that has sat in *Still open* since 0.2.0:

   ```
   baseline                 pageSize 5    rows 5    hasNext true
   setPageSize(250)         pageSize 250  rows 56   hasNext false
   setPageSize(5)           pageSize 5    rows 5    hasNext true
   ```

   The platform echoes the requested size back and returns that many rows. At
   56 records a request for 250 returned **all of them in one page**, which is
   the case the export cares about most.

   **E1 — `loadExactPage` moves, deterministically, in both directions.**

   ```
   loadExactPage(1)  first 41f39f1a  rows 5  hasPrev false
   loadExactPage(2)  first 990d527b  rows 5  hasPrev true
   loadExactPage(3)  first 42dbce26  rows 5
   loadExactPage(4)  first 47dbce26  rows 5
   loadExactPage(5)  first 4cdbce26  rows 5
   loadExactPage(2)  first 990d527b  rows 5   ← backwards, same page as before
   ```

   Four things, three of which the design had assumed the other way:

   - **It fetches on its own.** No `refresh()` after it; `goToPage` has always
     been right about that.
   - **It does not accumulate.** `rows` stays at 5 on every page. The export's
     dedupe-by-record-id was designed for a host that returns pages 1..N.
   - **`hasPreviousPage` becomes true after moving forward**, and stays true.
   - **A backwards jump lands on the same page it landed on before.** The
     export's restore step — `loadExactPage(capturedPage)` — is now proven
     rather than assumed.

   **This does not contradict `dev/host.js`'s defaults, and the distinction
   matters.** The rig defaults `accumulatePages` and `previousPageStuck` to
   **true** because that is what was measured — but it was measured on
   `loadNextPage(true)` in `pcf-compact-list`, and **this is `loadExactPage`,
   a different method.** Both can be true at once: the stepping call
   accumulates and strands `hasPreviousPage`, the exact-page call does neither.
   The rig should model them separately rather than applying one set of quirks
   to both, and the dedupe stays — it is what the `loadNextPage(true)` fallback
   needs on a host with no `loadExactPage`.

   **What this simplifies in the export.** With `setPageSize(250)` honoured,
   a view of 250 rows or fewer is **one fetch and no loop at all**, and the
   40-page ceiling only applies past 10,000 rows. The state machine still has
   to exist for the long case, but the common case stops being a state machine.

   **What it still does not say: how long a page actually takes.** Every
   reading above is `ms ≈ 7007`, which is the probe's own 7-second settle, not
   the fetch. Real latency is somewhere at or under that and was never
   isolated. A forty-page export's cost is therefore still unknown, which is
   precisely why the progress UI carries a page counter and a Cancel.

8. **E2 — is `setPageSize` clamped, and echoed back?** Already sitting in *Still
   open* as genuinely unknown. The export raises the page size to 250 and has to
   know what it actually got.

   *Answered together with E1 above: honoured, echoed back, not clamped.*

9. **P1 — the subgrid's parent.** Confirms here what chart-view measured on
   2026-09-19: `filtering.getFilter()` `null` and `linking.getLinkedEntities()`
   empty, so a subgrid's relationship to its parent is invisible. If it holds, a
   grouped subgrid needs `parentLookup` or it counts the whole table directly
   above six visible rows — a confidently wrong number, in the one place the
   reader can see it is wrong.

   ***Measured 2026-09-20.*** chart-view's 2026-09-19 finding reproduces here
   exactly:

   ```
   filtering.getFilter()          null
   linking.getLinkedEntities()    []
   mode.contextInfo               { entityTypeName: "account",
                                    entityId: "7de84297-…",
                                    entityRecordName: "Adventure Works (sample)" }
   target entity                  cll_account
   loaded rows 5, totalResultCount 8
   ```

   The relationship is invisible and the parent record is not, so the four-step
   resolver in `data/parent.ts` is required rather than inherited.

   **`canDisableRelationshipFilter` is a *function*, not a boolean.** It read
   back as `()=>!1` — minified `() => false`. So
   `if (filtering.canDisableRelationshipFilter)` is **always true**, on every
   host, because a function object is truthy. Nothing here tests it yet and
   nothing should start without calling it.

   **And the numbers coincide on this data, which is the part worth writing
   down.** The subgrid reports `totalResultCount: 8`, and the G2 aggregate —
   sent with **no parent condition and no view filter at all** — returned
   groups summing to 8 as well (2+2+1+1+2), as did G3's six groups. So on this
   environment, right now, **an aggregate that ignores the parent produces
   exactly the number a correct one would**, and the bug `parentLookup` exists
   to prevent is invisible.

   That is the dangerous shape: a defect that testing cannot see. It does not
   weaken the finding — `getFilter()` returning `null` is the finding, and it
   is unambiguous — but it does mean **this environment cannot demonstrate the
   fix working**. Proving `parentLookup` needs a second `account` with
   `cll_account` rows of its own, so that the whole-table count and the
   subgrid's count differ. Until that exists, the parent resolver is written
   against a measured mechanism and an unmeasured consequence, and
   `docs/limitations.md` should not claim otherwise.

   ***Confirmed 2026-09-20:*** an unfiltered count over the whole table
   answered **8**, against the subgrid's `totalResultCount` of **8**. The table
   holds eight rows and all eight belong to *Adventure Works (sample)*. So the
   coincidence is not a coincidence — there is only one parent in the data, and
   no query on this environment can currently distinguish a correct aggregate
   from one that ignores the parent entirely.

### What the probe environment cannot answer

Two questions are blocked by the size and shape of the data rather than by the
platform, and they are blocked for the same reason: **eight rows under one
parent.** Recorded here rather than left to look like oversights.

| Question | Needs | Why it matters |
| --- | --- | --- |
| **P1's consequence** — does an aggregate without a parent condition actually report the wrong number? | A second `account` with `cll_account` rows of its own | It is the whole justification for `parentLookup`, and for a grouped subgrid being withheld without one |
| **E1** — does `loadExactPage` behave past page two, and does the host accumulate? | ~40 rows, so eight pages exist at page size 5 | The full-view CSV export loops it up to forty times; at eight rows there are two pages and the loop never runs |
| **G5's record limit** | 50,000 rows | Not reasonable to create. Stays unmeasured; `pcf-chart-view`'s P7 stays open |

The first two are a few minutes of seeded data. The third is not, and the
fallback for it stays reasoned rather than measured — which is the honest
state, and is what `docs/limitations.md` will say.

**S1–S7 are not blocked**: sorting needs two pages, not forty, and eight rows
at page size five gives exactly that.

***After seeding, 2026-09-20:*** the table holds **56** rows and the subgrid
reports `totalResultCount` **56** — still equal, although twelve of the seeded
rows were bound to a *second* account. So the two numbers were never going to
diverge, and the reason is not the data:

**this subgrid is not parent-filtered at all.** It lists every `cll_account`
row regardless of which `account` it points at. That is consistent with
everything P1 read — `getFilter()` `null`, `getLinkedEntities()` `[]` — and it
is `pcf-chart-view`'s measured W3 case: *a subgrid configured without "Show
related records only" lists the whole table under a record.*

So this environment demonstrates the resolver's **`by: 'unrelated'`** branch
rather than its parent-filtered one — the step where every candidate lookup is
denied by the loaded rows and **no condition is added**, which here is the
correct answer. That branch is now measured, and it is the one most likely to
be got wrong by a resolver that assumes a subgrid is always related.

***Measured 2026-09-20, with the subgrid switched to "Show related records
only".*** The consequence is now proven, and the mechanism turns out to be
worse than chart-view recorded.

```
getFilter()                   null          ← still
getLinkedEntities()           []            ← still
canDisableRelationshipFilter  false         ← called, not read
whole table 56  |  subgrid 38               ← they differ
candidates -> account         ["cll_customer"]
cll_customer = parent -> 38                 ← matches the subgrid exactly
```

**`getFilter()` returns `null` whether or not the subgrid is related-records-only.**
That is the finding, and it is a stronger claim than the one inherited: the
relationship is invisible to the control **regardless of how the subgrid is
configured**, so there is no setting a maker can change that would let the
control see it. `pcf-chart-view`'s W3 note reads as though an unrelated subgrid
were the special case; both cases look identical from inside the control, and
only the *rows* can tell them apart.

**The consequence is real and now has numbers.** 56 against 38 — an aggregate
built from the view alone would print *56* directly above a grid holding 38
rows. That is the wrong number in the one place a reader can see it is wrong,
which is why the server route is withheld rather than approximated when the
parent cannot be resolved.

**All three resolver steps are measured, and the happy path is exact.**
`ManyToOneRelationships` returned **one** candidate, `cll_customer`, so step 2
resolves without ambiguity; the condition
`<condition attribute='cll_customer' operator='eq' value='7de84297…'/>`
reproduced **38**, the platform's own count, to the record. And the loaded rows
carry the column, so step 3 is available as a fallback rather than three-valued
`null` here:

```json
{"etn":"account","id":{"guid":"7de84297-9486-ec11-93b0-000d3a5c8441"},
 "name":"Adventure Works (sample)"}
```

**The GUID is nested at `.id.guid`, not a bare string**, and arrives unbraced
and lower-case. `rowsConfirm` reads that path; comparing `getValue()` directly
against an id would fail on every row.

**One caveat on the 38, stated so it is not read as more than it is.** The
probe's count carried no `statecode` condition while the view's own FetchXML
filters to active records — it matched anyway because every row here is active,
so the two agree by luck on this data. The shipped path does not rely on that:
`stripView` keeps the view's `<filter>`, so the view's own conditions ride along
and the parent condition is appended beside them.

### The ambiguous case, and the bug it found

***Measured 2026-09-20 on `cll_sitevisit`***, a **custom activity table** made
for the purpose — two lookups to `account`, `regardingobjectid` (inherited) and
`cll_site` (added). It answered three things at once.

**1. The primary key is not derivable.**

```
table        : cll_sitevisit   IsActivity: true
primary key  : activityid      the guess would be: cll_sitevisitid
primary name : subject
```

`guessPrimaryId` derives `{entity}id` with a hard-coded set of the seventeen
*system* activity tables as the exception, which is what `pcf-chart-view` does.
**No such list can cover a custom activity table**, and a maker can create one
in five minutes. So the guess is a fallback and `PrimaryIdAttribute` from
metadata is the mechanism. Recorded as a known gap in `index.ts` until the read
lands; until then a custom activity table's aggregate is refused by the server
rather than answered wrongly, which is the safe failure.

**2. The ambiguous branch resolves.** Two candidates, and the rows separated
them — `by: 'rows'`, `column: cll_site`. That branch is no longer unmeasured.

**3. And `rowsConfirm` was wrong, in the dangerous direction.**

```
regardingobjectid  in layout: false   getValue → null   rows said: false
cll_notacolumn     (does not exist)   getValue → null
server for that row: regardingobjectid_account → Adventure Works (sample)
```

**`getValue` answers `null` for a column absent from the view's layout, for a
column that does not exist on the table at all, and for one that is genuinely
empty.** There is no `undefined`. So the `undefined` branch — inherited from
`pcf-chart-view` and carried over here unexamined — was **dead code that could
never fire on a real host**, and every unfetched candidate was being *denied*
rather than left open.

The contradiction that exposed it: the rows said `regardingobjectid` was
`false` while a conditioned aggregate over it counted every row in the subgrid.
Both cannot be true, and the server was right.

It failed safe here only by luck — `cll_site` confirmed on its own merits, so
one candidate won. Invert the case, and the **correct** lookup is the one
missing from the layout: every candidate is denied, `open.length` is 0, the
resolver answers `unrelated`, no condition is added, and the aggregate counts
the whole table. The wrong number, reached through the branch that exists to
prevent it.

**The fix is the signal, not the shape.** The three-valued answer was right;
`getValue` simply cannot supply it. "Was this column loaded" is now asked of
`dataset.columns`, which is the only thing that knows, and `getValue` is asked
only about columns that were.

**4. And with `cll_site` pulled out of the view, the two readers diverge —
which is the finding stated as a difference rather than an argument.**

```
layout: subject, cll_visittype, cll_outcome, cll_durationhours,
        cll_cost, cll_visitdate, cll_engineer      (no cll_site)
candidates: regardingobjectid, cll_site

fixed  null,  null   -> unresolved -> route WITHHELD, caption "loaded so far"
old    false, false  -> unrelated  -> no condition  -> counts the WHOLE TABLE
```

Same configuration, and **both answer `column: null`**. The entire difference
is the `by` value, and `loadGroups` branches on `by !== 'unrelated'` to choose
between declining and proceeding. One word in one condition, standing between
an honest refusal and a number larger than the grid beneath it.

That was too load-bearing to be reachable only through a call needing a
`webAPI`, so the decision is now `withholdsRoute(resolution)` — pure, asserted
five ways, and mutation-tested: making it fire on `unrelated` too fails the
suite.

`unrelated` is a **positive** finding — the rows were asked and said this grid
is not narrowed to the record — so no condition is correct. `unresolved` is an
*absence* of knowledge, and guessing between two lookups is precisely what
produces a confidently wrong count.

**5. The guess failed live, and the metadata read replaced it.**

The probe's own `G2` derives `{entity}id`, so it sent `cll_sitevisitid`:

```
0x80041103, errorCode 2147750147, title "Query Builder Error"
"'cll_sitevisit' entity doesn't contain attribute with Name =
 'cll_sitevisitid' and NameMapping = 'Logical'"
```

**Exactly the predicted failure, and it is the safe one** — the server refused
the whole query and nothing wrong was reported. But a refusal is whole-query,
so it took the group counts with it: **grouping simply does not work on a
custom activity table while the key is guessed.** That moved
`primaryIdFor` from a known gap to a blocking defect, and it is now a cached
`EntityDefinitions` read on the same same-origin route the relationships use,
resolved in parallel with the parent inside `loadGroups` — so on every pass
after the first it costs nothing. `guessPrimaryId` is the fallback for a host
that refuses the read, which is the right way round: derive when you cannot
ask, rather than ask only when the derivation looks doubtful.

The refusal is also **renderable** — no `{0}` — so `messageOf` would show it
as written, unlike the multi-select case.

### `sum` and `avg`, measured at last

Sent with the real key over 41 records in 16 groups (the subgrid showing 21 —
**the counts finally diverge**, so the parent condition's consequence is
demonstrable on this table).

- **`avg` is `sum` ÷ the group's row count.** 26.25/4 = 6.5625, 17/3 =
  5.6666666666, 9.5/2 = 4.75 — every group. The browser route's `avg` must
  therefore divide by the same denominator, and it does; what the two cannot
  agree on is when the browser route holds only part of a group, which is what
  the caption is for.
- **The raw is truncated to ten decimal places** (`5.6666666666`) while the
  `FormattedValue` respects the column's precision (`"5.67"`). A measure
  rendered from the raw would show ten decimals of a two-decimal column.
- **A group whose every row has a null measure omits `m0` and `m1` entirely
  while `n` still stands.** Three Training groups, `n` of 4, 1 and 2, no
  measure aliases at all. That was asserted from `pcf-chart-view`'s behaviour
  and is now **measured** — `count` counts rows, an aggregate counts values.
- **Both group aliases can be absent from the same row.** The first row was
  `{n: 3}` and nothing else: no visit type *and* no outcome. The reader asks
  `hasOwnProperty` per alias rather than testing for a blank row, which is
  what makes that work.
- **Property order varies between rows.** One row arrived `m0, m1, n, g1` and
  another `n, g1, g0, m1, m0`. Nothing may depend on key order; the reader
  looks each alias up by name.

### The parent condition, proven on numbers

```
whole table 41  |  subgrid 21  |  with cll_site = the form's account: 21
```

**41 is what a grouped subgrid would have printed above 21 rows** without the
resolver — twice the truth, in the one place a reader can see it is wrong. With
the condition, 21 against 21, to the record.

That closes the parent resolver. Every branch is now exercised, and three of
them against measured numbers rather than a fixture:

| Branch | How it was reached |
| --- | --- |
| `explicit` / `none` | asserted |
| `only-candidate` | `cll_account`, one lookup — 38 against 38 |
| `rows` | `cll_sitevisit`, two lookups separated by the rows — 21 against 21 |
| `unresolved` | `cll_sitevisit` with neither lookup loaded — route withheld |
| `unrelated` | `cll_account` before the subgrid was set to related records |
| `no-candidates` | asserted |

The only thing left unmeasured in grouping is the `AggregateQueryRecordLimit`
refusal, which needs 50,000 rows and stays reasoned. `pcf-chart-view`'s P7
stays open with it.

### Verified on a real form

Walked on the Site Visits subgrid of an Account, 2026-09-20, with the 0.6.0
build — **the first time grouping has rendered anywhere but
`renderToStaticMarkup`**, which runs no effects, so `useGroups`, the server
route and expand-as-filter had no runtime coverage at all before this.

Configured `groupBy: cll_visittype`,
`aggregates: sum:cll_durationhours, avg:cll_durationhours`, `parentLookup`
empty.

**What the counts prove on their own.** Five headers — Inspection 4,
Installation 4, Maintenance 4, Training 3, (blank) 6 — summing to **21**, and
the subgrid holds 21 of the table's 41. The browser route sees the loaded page,
which was four records; **only the server route can produce 21**, and only with
the parent condition applied can it produce 21 rather than 41. So the aggregate
ran, the parent resolved through the rows, and the condition landed — three
things inferable from one row of numbers.

Everything else held: measures aligned under *Duration hours* rather than in a
run of text; **Training showed its count and no measures at all** (every row
null — rendered blank, not `0.00`); `(blank)` was named; the blank group sorted
last; expanding scoped the pager to *1–4 of 4* and the members summed to the
header's 21.75 exactly.

**One defect, and it was the pager.** A collapsed grouped table still rendered
the row pager — *"1–4 of 21"*, *"page 1 of 6"* — underneath five group headers,
counting rows that were not on screen in a vocabulary the table was not in. The
caption was written to replace it and nothing suppressed it. Fixed, asserted,
and mutation-tested.

**And the assertion written for that fix was broken in a way worth recording.**
It reported `pagers: 0` against markup that contained one, because the regex was
built in Python with `` in a non-raw string — which emits an actual backspace
character, not a word boundary. It failed *closed*, so the bug it hid was a
false failure rather than a false pass, but a suite that cannot count what it is
looking at is the same class of defect as `dev/dom.js`'s historic `img.src`. The
pattern now needs no escape at all.

**Not verified in 0.6.0, still:** whether the caption reads *"the whole view"*
on the form. The counts prove the server route answered; the sentence itself has
not been read off a screen.

### Two things the form said that no suite could

**The caption was invisible, and the markup was correct.** It carried
`className="DataTable-pager DataTable-caption"`, and `.DataTable-caption` has
been the `<table><caption>`'s class since 0.2.0 — *visually hidden*, one pixel
square, `clip: rect(0 0 0 0)`. So the group caption rendered with the right
text, in the right place, clipped to nothing. 246 assertions passed over it,
because every assertion in this repository is over **markup** and markup was not
what was wrong. Found by a DOM query after two screenshots.

Renamed to `DataTable-groupCaption`, and `dev/styles.js` now refuses **any
element carrying a visually-hidden class beside another of ours** — a pairing
that is always either a collision or a contradiction. The hidden classes are
found by signature rather than by name, so a third one added later is covered
without anybody remembering. Writing it turned up a false positive worth
keeping: `.DataTable-table .is-pinnedEdge::after` is a one-pixel absolute
divider that matches the signature perfectly and says nothing about
`.DataTable-table`, so only *bare* class selectors count.

**Expanding a group threw away every other group.** Reported from the form:
open one, the other four headers vanish, the pager appears, and getting back
needs a second click to collapse.

A design error rather than a bug, and the cause was one line: `groupRoute` read
its filter from `dataset.filtering`, which `applyFilter` had already composed
with the expansion's conditions. So expanding changed the aggregate's filter,
changed the route key, re-ran the query, and got back — correctly — only the
expanded group.

**The expansion narrows the rows; it must never narrow the group list.** The
group list answers *what is in this view*, and expanding does not change that.
The aggregate's filter is now built from the filter row alone, so the headers
stay on screen, the open group's rows nest under their own header, and
**expanding costs no round trip at all** — the route key no longer moves.

The caption stays visible with them now, since the thing it describes is always
on screen: it says what the group list covers, the pager below says what the
open group covers.

**Not assertable here:** the nesting itself. Expanding needs a click, and
`renderToStaticMarkup` dispatches no events. What the suite holds is the
collapsed invariant either side of it — headers and no rows.

**Walked again on 0.6.2 and it holds.** Five headers with their counts and
measures, one group open in place, the other four intact, the caption reading
*"5 groups · 21 records · the whole view"*. Grouping is done.

**One consequence to document rather than fix.** A group larger than the page
size pages *within itself*: Maintenance showed *5 records* in its header and
four rows beneath it, with the pager reading *1–4 of 5*. That is expand-as-filter
working — the group's rows are rows, and rows page — but the header count and
what is on screen disagree, and only the pager explains it. Raising the page
size on expand would trade one surprise for another; `docs/limitations.md` says
so instead.

## Multi-column sort

Shipped because S1–S5 came back green, and it very nearly shipped on a reading
that was wrong.

**The first measurement was a false pass.** The probe sorted by
`cll_accountname` then `cll_lastcontacted` and the rows came back in name order
— which is exactly what a platform ignoring the second entry would also
produce, because every name in that view was distinct and the secondary sort
never had a tie to break. Reading three green rows there and shipping would have
put a rank indicator over an order the platform had quietly collapsed: a wrong
answer that looks completely right, and the thing S1 exists to prevent.

The corrected measurement grouped the sort by a four-value Choice so the ties
were real, then flipped **only the second entry**. The order within each group
reversed, so the entry is honoured. The array also survived `paging.reset()` and
a page turn, and four entries were retained with no ceiling found.

**What shipped.** `enableMultiSort`, off by default. A plain click replaces the
order exactly as 0.5.0 did, so every existing installation is unchanged;
shift-click appends. The second activation of a column flips it, and the third
**removes** it — with a rank on screen there is a meaningful "not sorted by
this" state and no other way to reach it, while a single-column sort has no such
state and still cycles. The rank renders only once more than one column is in
the order.

**`aria-sort` cannot carry it.** The attribute takes ascending, descending or
none, so a screen reader told only that hears four columns each "sorted
ascending" and nothing about which wins. The rank goes in the button's
accessible name; the numeral beside the arrow is `aria-hidden`, because a reader
hearing both would hear it twice.

**The rig was wrong about this and had to be corrected.** `ordered()` honoured
only `sorting[0]`, with a comment arguing that a view's `ORDER BY` is what the
array holds and that a control pushing instead of replacing would build a sort
nobody asked for. Reasonable, and measured false. A rig modelling the platform
as somebody reasoned about it rather than as it was measured passes a control
that cannot work — which is the whole argument for the `quirks` defaults,
applied here to a quirk that turned out not to exist.
`quirks.sortingHonoursMultiple` now reaches the collapsing host deliberately.

### Verified on a real form

Walked on the Site Visits subgrid with 0.6.3, `groupBy` empty so sorting was the
only thing under test.

With the property **off**, a heading cycled ascending and descending with one
arrow and no rank, and shift-click behaved exactly as a plain click — the claim
that every existing installation is unchanged. With it **on**: a plain click
still replaced the order; shift-click appended and the ranks appeared; a second
shift-click flipped only that column; a third removed it and the ranks
disappeared with it, one column being left.

**The tie test passed**, which is the one that matters — flipping only the second
entry reversed the rows *within* each visit type while the visit types held
their order. That is the measurement the first probe run could not make, and the
reason it is worth making through the control rather than through a console
snippet.

The order survived a page turn, both ranks intact.

And the accessible names carried the position `aria-sort` cannot:

```
aria-label "Sorted by Outcome, 1 of 2"   aria-sort "ascending"
aria-label "Sorted by Subject, 2 of 2"   aria-sort "ascending"
dataset.sorting  [cll_outcome:0, subject:0]
```

Worth noting because it reads as a discrepancy and is not: the DOM lists Subject
first, because it is the leftmost **column**, while the ranks say Outcome is
first in the **sort**. Column order and sort order are different things, and the
rank tracks the sort.

### Not verified in multi-column sort

- **Canvas.** S7 was never asked. Whether `dataset.sorting` is honoured there at
  all is unknown, let alone with several entries.
- **A ceiling.** Four entries were retained; nobody pushed until something
  broke, so the UI imposes no cap and the docs claim none.
- **A `disableSorting` column in the order.** S6 was skipped at probe time and
  step 7 of the walkthrough could not be run either — **neither test view has a
  column the platform refuses to sort**. Whether one poisons the whole array is
  unmeasured. The control never offers those headings a sort control, so
  reaching it would take a deliberate push, which is the only reason this is not
  a blocker.
- **Discoverability.** Shift-click has no visible affordance, and no reader has
  been watched trying to find it.

## The full-view export

The last of the four, and the only one that re-enters `updateView` on purpose.

**The common case stopped being a state machine.** E2 measured
`setPageSize(250)` honoured and echoed back, so a view of 250 rows or fewer is
one request and no loop. The machine below runs only for the long case.

**The re-entry guard generalises `appliedPageSize`.** A field holding the page
already asked for, compared before asking again — exactly one fetch outstanding,
the page number strictly increasing. Without it `updateView`, which fires on
every dataset change including the ones the export caused, asks for the same
page forever.

### The bug the rig found, which the rig could not previously reach

`docs/limitations.md` has said since 0.2.0 that **the platform may return fewer
rows per page than asked for**. The rig had no way to model it, so the export
always finished in one fetch against a twelve-row fixture and the loop it exists
for was never driven round a second time.

Adding `quirks.maxPageSize` — modelling documented behaviour, not inventing a
hostile host — broke it immediately. `nextPageFor` computed the page count by
dividing `totalResultCount` by the size it had **requested**, so on any view the
platform paged more tightly it concluded one page covered everything and wrote a
**silently truncated file**. The worst shape this feature could fail in: the
export looks like it worked.

**The fix is to ask rather than compute.** `hasNextPage` is the platform's own
answer to the only question that matters, needs no arithmetic, and is right
whether or not the count is available — `totalResultCount` is `-1` when the
platform declines to count. The 10,000-row ceiling stays as the backstop for a
host whose `hasNextPage` never goes false.

### Not verified in the export

- **Anything on a form.** The whole feature is rig-only so far.
- **How long a page actually takes.** E1's readings were swamped by the probe's
  own settle, so a forty-page export's cost is genuinely unknown — which is why
  there is a page counter and a Stop at all.
- **The *Stopping* label.** Cancelling takes effect on the next pass, and in the
  rig a fetch resolves synchronously, so there is no pass between the cancel and
  the finish for the label to render in. On a form, where a page takes seconds,
  it is the whole point. What the suite does hold is that the cancel is obeyed:
  ten rows collected of twelve, and the page size restored.
- **The watchdog.** Thirty seconds is reasoned from the 3–14s refreshes measured
  on the probe subgrid; no page has ever actually stalled.
- **Whether `loadExactPage` is throttled in a tight loop.** E1 measured eight
  pages with a settle between each; forty in a row is a different regime.
