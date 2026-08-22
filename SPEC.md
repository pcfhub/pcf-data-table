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

`media/screenshot.png` is the control on an Accounts subgrid, and it settles
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
- **A mark renders after every selection checkbox**, in the header row and each
  body row alike, visible in `media/screenshot.png`. It is consistent enough to
  look systematic rather than a scaling artifact, but nothing in
  `DataTableControl.tsx` emits a character there — the cell contains only the
  `<input>`. Unresolved: it may be a host stylesheet applying `content` to a
  descendant, or something in `DataTable.css`. Reproduce on a form and inspect
  the cell before guessing.
- **Not opened in a canvas app.** `docs/canvas.md` claims columns come from the
  Fields flyout, that widths are absent, and that `openDatasetItem` is a no-op.
  All three are reasoned rather than observed. `addColumn` is typed as optional
  (`addColumn?:`), which is why nothing calls it.
- **`media/logo.png` is still the template placeholder**, and there is no
  screenshot. `docs/overview.md` had its `::image` directive removed rather than
  left pointing at a file that does not exist — `npm run check` validates the
  media paths in `pcfhub.json` but not images referenced from the docs, so a
  broken one there ships silently.
- **English only.** One `.resx` (1033); the other four locales the sibling
  controls carry are a follow-up.
- **No filtering, no jump-to-page, no multi-column sort.** `loadExactPage` is
  guarded with `typeof … === 'function'` and unused; the pager is Next/Previous
  only.
