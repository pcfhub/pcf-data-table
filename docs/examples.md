---
title: Examples
description: Worked configurations of Data Table.
order: 6
---

# Examples

## A read-only reference grid

A list nobody edits — related records shown for context.

| Property | Value |
| --- | --- |
| `pageSize` | `10` |
| `selectionMode` | `none` |
| `enableSorting` | `true` |
| `openOnRowClick` | `true` |

With `selectionMode` set to `none` the checkbox column disappears entirely and
the control clears any selection it was holding. Sorting and the open-record
link still work, so the grid stays useful without offering an action it has no
command bar for.

## A picker that feeds the command bar

The subgrid case: tick rows, then hit a ribbon button.

| Property | Value |
| --- | --- |
| `pageSize` | `50` |
| `selectionMode` | `multiple` |
| `enableSorting` | `true` |
| `openOnRowClick` | `false` |

`openOnRowClick` is off so a stray click on a row does not navigate away
mid-selection. The primary column is still a link, so opening a record is one
deliberate click rather than an accident.

## Canvas: a master list beside a detail pane

| Property | Value |
| --- | --- |
| `pageSize` | `25` |
| `selectionMode` | `single` |
| `enableSorting` | `true` |
| `openOnRowClick` | `true` |

Then drive the detail pane from the output:

```
// Detail form's Item property
LookUp(Accounts, account = GUID(DataTable1.openedRecordId))
```

`openedRecordId` updates before the (no-op) navigation, so this works in canvas
even though nothing opens.

## A long view people search and export

The case the filter row and the export were built for: a few thousand records
that readers narrow themselves and occasionally take away.

| Property | Value |
| --- | --- |
| `pageSize` | *(leave empty)* |
| `pageSizeOptions` | `25,50,100,250` |
| `selectionMode` | `none` |
| `enableSorting` | `true` |
| `enableFiltering` | `true` |
| `enableExport` | `true` |

`pageSize` is deliberately empty so the control adopts whatever the host is
already paging at, and the picker lets a reader raise it. That pairing matters
for the export, which covers the rows loaded so far: a reader who wants the
whole view chooses 250 first, then exports.

Filters combine with `And`, so typing `contoso` under **Account name** and
`>50000` under **Annual revenue** asks the server for records matching both. The
work happens server-side across every page, so the count in the pager is the
count of the whole filtered result, not of what is on screen.

:::callout{type=warning}
A filter that matches nothing leaves the table standing with its filter row
intact and a **Clear filters** button in the body. That is on purpose — an empty
table with no way back to your own data is a dead end.
:::

## A wide view where the account name follows you across

Twenty columns of shipment detail on a subgrid four hundred pixels wide. The
table scrolls sideways, and by the third column the reader is looking at
numbers belonging to a row they can no longer name.

| Property | Value |
| --- | --- |
| `pinnedStart` | `1` |
| `pinnedEnd` | *(leave empty)* |
| `selectionMode` | `multiple` |
| `enableSorting` | `true` |

The view's first column stays put; everything else moves under it, with a hairline
seam marking the join. Because `selectionMode` is `multiple`, the checkbox column
is pinned along with it — otherwise it would be the one thing that scrolled away
from the row it belongs to.

Pin a status or an action column at the far end with `pinnedEnd` in the same way.
The two can be used together, as long as the view has a column left over to
scroll: ask for more than that and the end count is trimmed first, on the grounds
that the columns naming the row are the ones worth keeping still.

:::callout{type=info}
On a phone-width subgrid the same configuration renders **unpinned**. Holding a
200px column still inside a 320px box leaves a sliver of moving table, which is
worse than not pinning at all — so the control measures the space it was given
and declines. Nothing is reported, because on a wider screen the identical
configuration pins.
:::

Two things pinning is not. It does not let a reader drag a column somewhere else
— the order is the view's, and the view designer is where it changes. And it
cannot pin a column out of the middle: the properties take counts from each end,
so a column you want pinned has to be a column the view puts first or last.

## A grouped view someone reads for the totals

A manager who wants the shape of a pipeline rather than the rows in it: how much
is in each stage, and how many deals that is.

| Property | Value |
| --- | --- |
| `groupBy` | `industrycode` |
| `aggregates` | `sum:revenue, avg:revenue` |
| `groupSort` | `count` |
| `enableExport` | `true` |
| `exportScope` | `view` |

::image{src=media/screenshot-grouped.png alt="A table grouped by Industry: one header per industry with its record count and the sum and average of Annual revenue, and a caption reading 5 groups, 12 records, the whole view" zoom}

`groupSort` set to `count` puts the biggest group first, which is usually what
someone reading for totals wants. Leave it at `label` when the groups have a
natural order people already know.

**Check the caption before you quote a number.** *the whole view* means the
totals cover every record. *the records loaded so far* means they cover the
pages in the browser, and the difference is the whole reason the caption is
there.

:::callout{type=info}
**Expanding a group filters the view to it.** The rows arrive paged as usual
with the pager scoped to that group, so a group never spans a page boundary and
you never have to hunt for the rest of it. One group is open at a time.
:::

Pairing this with `exportScope: view` is deliberate: someone who reads totals
usually wants the rows behind them next, and the export covers the whole view
rather than the page. It costs one request per page at the view's own page
size, so raise **Page size** if the view is large — a subgrid paging four rows
at a time makes that expensive.

## A subgrid people correct without opening records

A team triaging rows: most of the work is fixing a name or a number, and opening
each record to change one field costs more than the change is worth.

| Property | Value |
| --- | --- |
| `enableEditing` | `true` |
| `editableColumns` | *(leave empty)* |
| `openOnRowClick` | `false` |
| `selectionMode` | `none` |

`openOnRowClick` is off on purpose. With editing on, a click is much more likely
to mean "change this" than "take me away from here", and a row that navigates
out from under a half-finished edit is the worst of both. The primary column
keeps its link, so opening a record is still one click — it is just a deliberate
one.

Leaving `editableColumns` empty is the usual answer. The control asks Dataverse
which cells this user may write, per column and per record, so an empty list
already means "everything they are allowed to change" rather than "everything".
Fill it in when a column is *technically* writable and you would still rather
nobody edited it here.

:::callout{type=warning}
**A refused write rolls the cell back and says why**, under the cell. That path
is the reason this control catches at all, and it is the one thing the demo on
this page cannot show — there is no Dataverse behind it to refuse anything.
:::

Editing and pinning work together, and the pairing is the point on a wide view:
pin the column that names the row, scroll to the column that needs fixing, and
the row you are editing is still identified.
