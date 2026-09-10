---
title: Overview
description: What Data Table does, and when to reach for it.
order: 1
---

# Data Table

A sortable, filterable table over any Dataverse view, with inline editing and pinned columns.

::image{src=media/screenshot.png alt="Data Table over an Accounts view: a checkbox column, eight columns with a filter row beneath the headings, five rows of formatted currency and dates, and a pager reading 1 to 5 of 24 with a Go to page box" zoom}

::image{src=media/screenshot-pinned.png alt="The same table scrolled sideways in a narrow container: Account name held at the left with a hairline seam and the scrolled columns passing underneath it, Modified on held at the right with its own seam, and Annual revenue, City and Owner moved between them" zoom}

::image{src=media/screenshot-editing.png alt="Inline editing: a pencil beside each account name, the Primary contact cell of the first row open as a text input with its value selected, and Account number left as plain text because the fixture marks it read-only" zoom}

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
front of you. Text and numeric columns get a box; dates, choices and lookups do
not, and [Limitations](limitations.md) says why.
