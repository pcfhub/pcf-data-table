---
title: Limitations
description: What Data Table does not do.
order: 7
---

# Limitations

## What filtering covers

- **Only text and numeric columns get a filter box.** Text columns match with a
  SQL `LIKE`; numeric ones take a bare number or a comparison such as `>1000`.
- **Dates have no filter box.** Expressing "on or after this day" needs the
  `On`, `OnOrAfter` and `OnOrBefore` condition operators, and those are not
  documented as supported on both canvas and model-driven apps. A `GreaterThan`
  against a date column compares the wrong thing, so the box is withheld rather
  than made to look like it works.
- **Choices, two-options and lookups have no filter box either**, for a
  different and firmer reason: the server filters those on an integer or a GUID,
  and the dataset does not hand the control the option list to offer. Reading it
  means entity metadata, which is model-driven only and would add an
  install-time permission prompt to every environment — a poor trade for one
  filter box. Filter those in the view instead.
- **Two filled boxes mean *both*.** Each column narrows the result further; the
  filter row is not a search across columns.
- **A jump past the last page lands on the last page**, and on a host that does
  not support `loadExactPage` a jump of more than one page is refused rather
  than half-performed — stepping once while the pager claims page 7 would be
  worse than not moving.

## What the CSV export covers

- **It exports the rows loaded so far, not the whole view.** The dataset holds
  the pages that have been fetched; pages nobody has opened are not in it. Read
  a bigger page size, or page through, before exporting a long view.
- **Values are the formatted ones**, matching the table rather than the raw
  values underneath — so a choice exports as its label and a currency with its
  symbol.
- **Cells beginning `=`, `+`, `-` or `@` are prefixed with an apostrophe**,
  because a spreadsheet treats them as formulas. Numbers are left alone, so a
  negative figure stays a number.

## Not in this release

- **No column resizing or reordering by the user.** The widths and order are the
  view's, and changing them is a view-designer job.
- **No grouping, no aggregate row, no inline editing.**
- **No multi-column sort.** Sorting one column replaces the order rather than
  adding to it, which is what the view's own `ORDER BY` holds.

## Behaviour worth knowing

- **Selection is not persisted across a form reload.** It lives in the control
  for the lifetime of the page. Reopen the form and nothing is ticked.
- **Page size may be clamped.** The control asks for what you configure, capped
  at 250; the platform may return fewer rows per page on a large view, and the
  pager reflects what actually arrived.
- **The row count can be absent.** When the platform does not count the result
  set it reports `-1`, and the pager reads "Page 3" instead of "51–75 of 240".
  That is the platform declining to count, not the control failing to.

## On a narrow host

- **The table scrolls sideways rather than squeezing the columns.** Below about
  100 pixels a column it stops dividing the space and starts overflowing, and
  the scrollbar sits inside the control — the form itself does not widen. A
  phone subgrid at 320px shows two or three columns and scrolls to the rest.
- **The proportions are still the view's.** The widths divide whatever the table
  ends up being, so a column the view designer made narrow stays proportionally
  narrow when scrolling starts; the minimum buys the total width, not a floor
  under each column.
- **The pager wraps.** It needs roughly 520 pixels to sit on one line, so under
  that the paging buttons keep the first line and the page box, rows-per-page
  and export move below them. Every control stays reachable — nothing is cut
  off the end.

## Canvas apps

- Opening a record does nothing — there is no form to open. Use the
  `openedRecordId` output. See [Canvas apps](canvas.md).
- Column widths are the browser's, because canvas reports no
  `visualSizeFactor`.
- Columns come from the Fields flyout on `Items`. Pick none and the control says
  so rather than rendering an empty grid.

## In the hub's demo

The demo runs against a fixed 24-row fixture with no server behind it, so
paging, sorting, filtering and selection cannot do what they do on a real view.
Each dead interaction is named on the component's demo page.

Filtering is the one worth calling out, because it is the feature that most
looks like it should work in a browser: it is applied by the server across every
page, and there is no server behind the demo. Typing in a filter box there
narrows nothing.
