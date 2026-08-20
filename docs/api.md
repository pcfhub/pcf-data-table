---
title: API reference
description: Properties and outputs, generated from the control manifest.
order: 5
---

# API reference

<!--
  Do not write the property tables by hand.

  `props-table` renders from what the hub parsed out of
  ControlManifest.Input.xml at the release being viewed, so it cannot drift from
  the control. A hand-written table is wrong the first time somebody adds a
  property and forgets this file, and a reader has no way to tell.

  kind: input | bound | output | dataset | dataset_column
  Omit `kind` to render every property in one table.

  There is no kind=dataset_column section here on purpose: this control declares
  no property-set roles, so the directive would render an empty table — which
  reads as "this control has no dataset columns" rather than as a section
  nobody wrote. The prose under Columns says it instead.
-->

## Input properties

::props-table{kind=input}

## Dataset

::props-table{kind=dataset}

## Outputs

::props-table{kind=output}

## Columns

The columns are the view's.

This control declares no `property-set` roles, so there is nothing to map and
nothing for a properties table to list. It renders whatever `dataset.columns`
reports — the columns the maker put in the view, in the view's `order`, at the
view's `visualSizeFactor` widths — and skips the ones the view marks hidden.

Three pieces of column metadata change what you see:

| Metadata | Effect |
| --- | --- |
| `isPrimary` | That cell becomes the open-record button, and its value is the row's accessible name. Falls back to the first visible column. |
| `disableSorting` | No sort control on that column, and no `aria-sort`. |
| `visualSizeFactor` | Distributed as percentage widths. When every factor is 0 — which canvas reports — the browser lays the table out instead. |

## Outputs in practice

`selectedRecordIds` is one record ID per line, not comma-separated: a GUID
contains no newline, so the split is unambiguous. In a canvas app,
`Split(DataTable1.selectedRecordIds, Char(10))`.

`openedRecordId` updates *before* the record is opened, so it is observable even
on a host where opening does nothing. That is what makes it the canvas
substitute for row navigation.

Both outputs emit an empty string rather than nothing when they are cleared —
returning `undefined` from `getOutputs()` means "no change", which would make a
cleared selection impossible for a form to observe.
