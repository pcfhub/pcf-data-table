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
