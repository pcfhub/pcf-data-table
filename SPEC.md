# Data Table

A sortable, pageable table over any Dataverse view, with row selection.

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
