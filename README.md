# Data Table

A sortable, pageable table over any Dataverse view, with row selection.

[![Build](https://github.com/pcfhub/pcf-data-table/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-data-table/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-data-table/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-data-table/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-data-table), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

## What it does

Data Table binds a dataset — a subgrid, a view, a canvas collection — and renders
it as a semantic HTML table with a pager, sortable headers and optional row
selection.

The decision that shaped everything else: **it declares no `property-set`
roles.** A property-set is a fixed-arity declaration, one named role per line of
manifest, so a role-based table is capped at whatever N the manifest hard-codes
and the maker with N+1 columns is stuck. It also cannot carry the metadata a
table needs — `order`, `visualSizeFactor`, `isPrimary` and `disableSorting`
exist on real view columns and nowhere else. So the control reads
`dataset.columns` and renders what the view already says. There is nothing to
configure per column, and the view designer is the configuration UI.

The second decision: **paging and sorting go back through the dataset API**,
not through the array on screen. `sortedRecordIds` already *is* the current page
on a real platform, so slicing it client-side hides records the platform paged
for; and sorting the rows on screen reorders twenty-five out of two hundred and
forty, which is a wrong answer that looks completely right. Both cost a round
trip, and both are correct across the whole result set.

The third is a footgun rather than a design: **`updateView` fires on every
dataset change, including the ones this control caused.** `setPageSize()` does
nothing until the next fetch, so it has to be followed by `refresh()` — and
`refresh()` fires `updateView`. The guard is on a control-instance field rather
than on `ds.paging.pageSize`, because the platform's own value does not equal
the requested one until the refresh lands. Without it, the control spins. See
[SPEC.md](SPEC.md).

There is no `<feature-usage>` at all. `openDatasetItem()` is a method on the
dataset rather than on `context.navigation`, and nothing here touches Web API,
utils or device — so installing the control raises no permission prompt.

## Properties

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `records` | DataSet | dataset | — | The view or collection to render. No property-set roles: the columns are the view's |
| `pageSize` | Whole.None | input | `25` | Rows requested per page, clamped to 1–250 |
| `selectionMode` | Enum | input | `single` | `none`, `single` or `multiple` |
| `enableSorting` | TwoOptions | input | `true` | Show sort controls on the columns the view allows sorting on |
| `openOnRowClick` | TwoOptions | input | `true` | Open the record on row click, as well as from the primary column |
| `selectedRecordIds` | Multiple | output | — | Selected row IDs, one per line |
| `openedRecordId` | SingleLine.Text | output | — | The row most recently opened |

Strings ship in English (1033) only. React and Fluent UI come from the platform
as `<platform-library>` entries rather than from the bundle — the build confirms
it, emitting `Reactv16` and `FluentUIReactv940` as webpack externals.

## On the hub

`demo.fidelity` is **`limited`**, and the gap is not marginal.

Nothing in this control leaves the browser, which is normally what earns `full`.
But three of its four features call back into the dataset, and the hub's demo
harness only simulates one: its `DataSet` mock is hard-coded to a single page
(`hasNextPage` and `hasPreviousPage` are `false`, `setPageSize` is an empty
function), and it rebuilds the whole dataset on every render, so mutations to
`sorting` and calls to `setSelectedRecordIds` are discarded before the next
pass.

So paging is inert, sorting moves the arrow but not the rows, and
`openDatasetItem` logs a mock call. Each one is named in `demo.limitations`.

That is the line between this control and `pcf-tag-list`, which is `mocked`:
TagList's interactions genuinely work against its fixture, because a chip that is
in the fixture can be clicked and read back. This one asks the harness to do
something it only pretends to do.

One preset, against a 24-row account fixture. Its `pageSize` is 25 — above the
row count — deliberately: the harness serves every row regardless of page size
and the control correctly does not slice client-side, so a smaller page size
would render 24 rows under a pager reading "1–10 of 24", which reads as a bug in
the control rather than as a gap in the harness.

## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-data-table/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
```

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `DataTable/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `DataTable/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `demo/` | The dataset fixture the hub's demo harness runs against |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
