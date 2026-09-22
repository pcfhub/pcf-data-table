---
title: Overview
description: What Data Table does, and when to reach for it.
order: 1
---

# Data Table

A sortable, filterable table over any Dataverse view — with grouping and totals, inline editing, pinned columns and a New button.

::image{src=media/screenshot.png alt="Data Table over an Accounts view: a checkbox column, eight columns with a filter row beneath the headings, five rows of formatted currency and dates, and a pager reading 1 to 5 of 24 with a Go to page box" zoom}

::image{src=media/screenshot-grouped.png alt="The same table grouped by Industry: one header per industry showing its record count and the sum and average of Annual revenue, a blank group for the record with no industry, and a caption reading 5 groups, 12 records, the whole view" zoom}

::image{src=media/screenshot-pinned.png alt="The same table scrolled sideways in a narrow container: Account name held at the left with a hairline seam and the scrolled columns passing underneath it, Modified on held at the right with its own seam, and Annual revenue, City and Owner moved between them" zoom}

::image{src=media/screenshot-editing.png alt="Inline editing: a pencil beside each account name, the Industry cell of the first row open as a dropdown of its options, and Status left as plain text because the platform reports state read-only" zoom}

::image{src=media/screenshot-filters.png alt="The filter row: text boxes under the text columns, a dropdown reading Any under Status and Industry, and under Modified on a date box with a ≥ chip beside it standing for From, the table narrowed to the four rows on or after 1 March 2026" zoom}

Drop it on a subgrid and it renders the view the maker already chose — the same
columns, in the same order, at the same widths — as a semantic HTML table with a
pager underneath. Sorting a column re-queries the view. Selecting rows tells the
form's command bar what the ribbon should act on.

## Why this one

- **It renders the view, not a configuration of the view.** There are no
  "column 1 / column 2" properties to fill in. The control reads
  `dataset.columns` and honours `order`, `visualSizeFactor`, `isHidden`,
  `isPrimary` and `disableSorting` — so the person who arranged the view has
  already configured this control.
- **Sorting and paging are server-side.** Both go back through the dataset API,
  so they apply across the whole result set. A control that sorts in the browser
  reorders the page you can see — twenty-five rows out of two hundred and forty
  — which is a wrong answer that looks right.
- **It answers about the whole view, and says when it cannot.** Grouping asks
  the server for one aggregate over every record, so *14 groups · 4,120 records
  · the whole view* means all 4,120 — and when that query is not available the
  caption reads *the records loaded so far* instead. A page-sized total
  presented as a whole-view total is a wrong answer that looks right, and the
  caption exists so that it cannot happen quietly.
- **It is a real table.** `<table>`, `<th scope="col">`, `aria-sort`, a focusable
  control in every cell that does something. Screen readers and keyboards get
  the structure for free, rather than an emulation of it.

## What it works with

:::callout{type=info}
**Model-driven apps** are the primary host: subgrids and custom pages both work,
and row selection is wired to the command bar.

**Canvas apps** work with two caveats. The columns come from the Fields flyout
on `Items` rather than from a view, so an empty selection renders an explicit
message; and opening a record does nothing, because there is no form to open —
use the `openedRecordId` output instead. See [Canvas apps](canvas.md).
:::

Filtering is applied by the server across the whole result set, not to the rows
on screen — so it narrows a 4,000-row view rather than the twenty-five rows in
front of you. Text, numeric and date columns get a box everywhere; choice
columns get one on a model-driven app; lookups do not, and
[Limitations](limitations.md) says why.

Grouping draws one header per group with its count and any measures you ask
for, and expanding a group filters the view to it rather than scrolling to it —
so a group never spans a page boundary. Sorting by several columns is off until
a maker turns it on, and the CSV export covers the loaded pages by default or
the whole view on request.

Inline editing covers text, number, yes/no, date and — on a model-driven app —
choice and lookup cells, one cell at a time. Every column but a lookup writes
through the dataset record; a lookup is picked in the platform's own dialog and
saved through the Web API. A **New** button opens the table's quick create form
and reports the row it made. Both are off until a maker turns them on.
