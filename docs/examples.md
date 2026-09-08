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
