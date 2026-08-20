---
title: Canvas apps
description: Adding Data Table to a canvas app or custom page.
order: 3
---

# Canvas apps

::steps
1. **Insert → Get more components → Code**, then add **Data Table**.
2. Set **Items** to a data source — `Accounts`, a collection, a filtered table.
3. Open the **Fields** flyout on `Items` and pick the columns to show. This step
   is not optional; see below.
4. Set `pageSize`, `selectionMode`, `enableSorting` and `openOnRowClick` in the
   properties pane.
::

## No command bar, view selector or quick find

The control asks for all three through `cds-data-set-options`, but that is a
model-driven-only attribute — a canvas app has no subgrid chrome to show and
ignores it. Sorting and paging still come from the control itself; filtering and
searching are yours to build with `Filter()` and `Search()` on `Items`.

## Columns come from the Fields flyout

A canvas app has no view, so there is no column layout for the control to
inherit. `dataset.columns` reflects exactly what you picked in the Fields
flyout, and if you pick nothing the control says so rather than rendering an
empty grid.

Two consequences worth knowing before you file a bug:

- **Column widths are the browser's.** Canvas reports no `visualSizeFactor`, so
  there is nothing to distribute and the table lays itself out from its content.
- **Column order is the flyout's order**, not something you can set on the
  control.

## Opening a record does nothing here

:::callout{type=info}
`openOnRowClick` has no visible effect in a canvas app. Opening a record calls
`openDatasetItem()`, which needs a model-driven form to navigate to.

The `openedRecordId` output still updates on every row click, so wire your own
navigation to it:

```
// OnChange of the Data Table
Navigate(DetailScreen, ScreenTransition.Cover, {SelectedId: Self.openedRecordId})
```
:::

## Reading the selection

`selectedRecordIds` is newline-separated:

```
Split(DataTable1.selectedRecordIds, Char(10))
```
