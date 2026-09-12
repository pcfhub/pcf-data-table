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
| `npm run build` | `out/controls/DataTable/bundle.js`, **33,263 bytes** (32.1 KiB). Webpack externals `Reactv16` and `FluentUIReactv940`. |
| `msbuild /t:build /restore /p:configuration=Release` | **9,020 bytes** packed. `Solution.zip` 10,330 bytes, `Solution_managed.zip` 10,331 bytes. |

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
- **English only.** One `.resx` (1033); the other four locales the sibling
  controls carry are a follow-up.
- **No multi-column sort.** Sorting replaces the order rather than appending,
  which is what `dataset.sorting` holds as the view's `ORDER BY`.
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
