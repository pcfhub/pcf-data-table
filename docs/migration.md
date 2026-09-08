---
title: Migration
description: Moving from 0.1.x to 0.2.0.
order: 9
appliesTo: ">=0.2.0"
---

# Migration

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
