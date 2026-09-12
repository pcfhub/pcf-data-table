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

## What is absent here

Canvas has no entity metadata and no quick create form, so three things a
model-driven app gets are not offered:

- **Choice cells stay read-only** and **choice columns get no filter box** —
  the option list comes from `getEntityMetadata`, which canvas does not have,
  whatever the manifest declares.
- **There is no New button**, whatever `enableCreate` is set to:
  `navigation.openForm` is not on this host.

The **date filter box** does appear, because it needs no metadata. It has been
measured on a model-driven subgrid and not yet in a canvas app; if your data
source refuses the `On`, `OnOrAfter` or `OnOrBefore` operators, the box
narrows nothing and the fallback is a `Filter()` on `Items`.

## No command bar, view selector or quick find

The control asks for all three through `cds-data-set-options`, but that is a
model-driven-only attribute — a canvas app has no subgrid chrome to show and
ignores it. Sorting, paging and filtering all come from the control itself.

Whether the filter row does anything here depends on your data source. The
control filters through `dataset.filtering`, which a Dataverse connector
supports and a static collection does not; where it is absent the row is not
rendered at all rather than accepting keystrokes that change nothing. A
`Filter()` or `Search()` on `Items` remains the alternative, and is the only
option for the column types the row does not cover.

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
