---
title: Migration
description: Moving between released versions.
order: 9
appliesTo: ">=0.2.0"
---

# Migration

## 0.2.0 → 0.3.0

0.3.0 adds pinned columns. **Nothing was renamed and nothing was removed**, and
the two new properties are both unset by default — so an upgraded table renders
exactly as it did before until you pin something.

| Property | Default | What it does |
| --- | --- | --- |
| `pinnedStart` | *(unset)* | How many of the view's first columns stay put while the table scrolls sideways |
| `pinnedEnd` | *(unset)* | The same at the other end |

Both take a **count**, not a list of column names: the view designer already
decides which columns come first, so `1` pins whichever column the view puts at
the front. Move the column in the view and the pinning follows it, which is the
reason for counts — a name would keep pointing at a column that had moved, or at
one no longer in the view at all.

Three behaviours to expect, none of which is an error:

- Pinning at the start **pins the selection checkboxes too**. They are the first
  column; left loose they would slide under the column pinned beside them.
- **One column is always left unpinned.** Ask for more than the view has and the
  count at the end is trimmed first.
- **Pinning switches itself off on a narrow host** — a phone-width subgrid where
  the pinned columns would leave less than one column's worth of table still
  moving renders unpinned instead. The same configuration pins on a wide screen.

### Nothing new is asked of the environment

The control still declares no features, so re-importing the solution raises no
new permission prompt. Pinning is layout and nothing else.

:::callout{type=info}
Inline editing is **not** in 0.3.0. The write path it wants would also cost no
permission prompt, and it is waiting on a measurement rather than on the work —
see [Limitations](limitations.md).
:::

## 0.1.x → 0.2.0

0.2.0 adds a filter row, a jump-to-page box, a rows-per-page picker and a CSV
export. **Nothing was renamed and nothing was removed**, so an existing
configuration keeps working and existing canvas formulas keep resolving. Three
new properties are all there is to decide about, and two of them are off until
you say otherwise.

### The three new properties

| Property | Default | What it does |
| --- | --- | --- |
| `enableFiltering` | **on** | A filter box under each text and numeric column heading |
| `enableExport` | off | An **Export CSV** button in the pager |
| `pageSizeOptions` | empty | A comma-separated list, e.g. `10,25,50,100`, shown as a rows-per-page picker |

`enableFiltering` is the only one that changes an existing table's appearance on
upgrade. Set it to **off** if you would rather keep the header as it was, or if
the view already filters to exactly what its readers need.

:::callout{type=info}
The other two are opt-in on purpose. `pageSizeOptions` carries no default so
that a table nobody has configured still adopts the page size the host is
already using; and `enableExport` is off because the export covers the rows
loaded so far rather than the whole view — see
[Limitations](limitations.md) — which is a thing to opt into knowingly rather
than to discover from a colleague's short spreadsheet.
:::

### What the filter row will not filter

Text and numeric columns get a box. Date, choice, two-options and lookup columns
do not, and it is deliberate rather than unfinished — the reasons are in
[Limitations](limitations.md). If your readers filter on a choice column today
through the view selector or a quick find, they still should.

### Nothing new is asked of the environment

The control still declares no features, so re-importing the solution raises no
new permission prompt. Filtering goes through the dataset the control already
had, and the export uses a navigation method that is not gated.

### The page size now resets the page

Changing the number of rows per page returns the reader to page one. This was
always the right behaviour and was previously unreachable, because the page size
could only be set at configuration time. It matters now that a reader can change
it mid-view: "page 3" means something different once the pages are recut.
