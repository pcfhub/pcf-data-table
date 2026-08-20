---
title: Model-driven apps
description: Adding Data Table to a form.
order: 4
---

# Model-driven apps

This is the host the control was built for.

::steps
1. Open the form editor and select the **subgrid** you want to replace, or add
   one.
2. On the subgrid, choose the table and the **view**. The view is the
   configuration — its columns, their order and their widths are what the
   control renders.
3. **Components → Add component → Data Table**, and enable it for Web.
4. Set the four input properties. Defaults are a 25-row page, single selection,
   sorting on, and row click opens the record.
5. Save and publish.
::

## The view is the configuration

There is nothing to map. Rearranging the columns in the view designer, changing
a width, hiding a column or marking one non-sortable all change what the control
renders on the next load — no republish of the component required.

The primary column of the view gets the open-record link and names the row for
screen readers.

## The subgrid keeps its own chrome

The control declares
`cds-data-set-options="displayCommandBar:true;displayViewSelector:true;displayQuickFind:true"`,
so the subgrid keeps the three pieces of furniture it would have had with the
out-of-the-box grid:

| | What it does here |
| --- | --- |
| **Command bar** | The ribbon above the grid, acting on the rows you tick. |
| **View selector** | Switch view, and the columns change with it — the control re-reads `dataset.columns` on the next render, so a different view is a different table with no reconfiguration. |
| **Quick find** | The platform filters the result set; the control renders whatever comes back, and the pager follows. |

:::callout{type=info}
This is a manifest attribute, read by the host when the form loads, so it is not
something a maker can toggle in the properties pane — and it has no effect in a
canvas app, which has no subgrid chrome to show.
:::

## Selection and the command bar

Ticking rows calls `setSelectedRecordIds()`, which is the contract with the
form's command bar: the ribbon buttons above the subgrid act on the rows you
tick, exactly as they would with the out-of-the-box grid. That contract is the
reason the command bar is worth displaying — without it, selection would be a
value the control reports and nothing acts on.

:::callout{type=info}
Selection persists as you page. The IDs are stable, and a user who ticks three
rows on page 1 and then pages forward has not changed their mind about them.
The header checkbox is scoped to the current page — with paging, "select all"
can only honestly mean the rows you can see.
:::

## Sorting

Clicking a column header writes into `dataset.sorting` and re-queries, so the
sort applies across the whole result set and paging resets to page 1. A column
the view marks non-sortable gets no sort control.
