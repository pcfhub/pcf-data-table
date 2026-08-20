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

`demo/` is absent from the packed solution, which confirms the
`<ExcludeDirectories Include="…\demo\**" />` line added to `DataTable.pcfproj`.
The template ships no such line — it has no `demo/` to exclude — and
`pcf-tag-list`, which does have one, has never been packed. That gap was
unexercised rather than proven harmless, and this is the first evidence either
way.

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

**`totalResultCount` is `-1` when the platform did not count**, which is common
on large views. `pagerLabel()` in `components/resolve.ts` falls back to naming
the page rather than printing "of -1".

**Never slice `sortedRecordIds` to the page size in the browser.** On a real
platform that array already *is* the current page, so slicing hides records the
platform paged for. The demo actively tempts you into it, because the harness
serves all 24 fixture rows at once — which is why the preset's `pageSize` is 25
rather than 10.

**Sorting is server-side across every page.** `dataset.sorting` is a plain array
you mutate in place and then `refresh()`; it is the whole `ORDER BY`, so
replacing rather than appending is what stops three clicks building a three-deep
sort. A client-side sort would reorder the 25 rows on screen out of 240, which
is a wrong answer that looks completely right.

**`setSelectedRecordIds()` is not bookkeeping.** On a model-driven subgrid it is
the contract with the form's command bar — it is how the ribbon knows which
records to act on. The control keeps its own copy anyway, because the platform's
does not survive a refresh or a page change.

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

## Still open

- **Not loaded on a real form yet.** Everything under "Platform behaviour" that
  is read from the type definitions is solid; the *runtime* claims are not.
  Specifically unverified: that `loadNextPage(true)` is honoured (some platform
  builds have historically ignored the flag — the fallback is
  `loadExactPage(page + 1)`); whether `firstPageNumber` tracks the current page
  or the loaded range; whether `reset()` before `refresh()` costs two round
  trips; and whether the platform clamps `setPageSize` and echoes the clamped
  value back.
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
