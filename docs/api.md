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
| `visualSizeFactor` | Distributed as percentage widths. When every factor is 0 — which canvas reports — the browser lays the table out instead. A **pinned** column reads the same number as a pixel width, because Dataverse stores it in `layoutxml` as one, and a sticky column cannot take a share of a width it is holding still against. |

## Grouping in practice

`groupBy` takes logical names, comma-separated. `aggregates` takes
`function:column` pairs — `sum:revenue, avg:revenue` — and a record count is
always shown whether you ask for one or not.

**Several aggregates over one column stack in that column**, each labelled with
the keyword you wrote:

::image{src=media/screenshot-grouped.png alt="A table grouped by Industry, each group header showing a record count and the sum and average of Annual revenue, above a caption reading '5 groups · 12 records · the whole view'" zoom}

Four things are worth knowing before you configure it.

**The caption always says what it counted.** *the whole view* means one
aggregate query answered over every record the view holds. *the records loaded
so far* means it did not, and the numbers describe the pages that happen to be
in the browser. A page-sized total presented as a whole-view total is the exact
mistake this caption exists to prevent, so read it rather than assuming.

**Expanding a group filters; it does not scroll.** The chevron ANDs a condition
onto the view's filter and re-reads, so the members arrive as ordinary paged
rows with the pager scoped to that group. One group is open at a time, because
two would mean ORed conditions and interleaved rows.

**A group whose key cannot be expressed as a condition gets no chevron**, rather
than one that does nothing.

**`parentLookup` matters only in a subgrid**, and usually not even then. A
subgrid's relationship to the record it sits under is invisible to a control —
`getFilter()` is null and `getLinkedEntities()` empty — so an aggregate over
"the whole view" would count every record in the table rather than the ones
under this parent. The control resolves the lookup itself and withholds the
whole-view route when it cannot. Set it when the table has **several lookups to
the same table** and the guess would be a coin toss, or to `none` when the
subgrid is genuinely unrelated to its host record.

## Sorting by several columns

`enableMultiSort` is off by default, so an existing install behaves exactly as
it did. With it on, shift-clicking a heading appends that column to the order
rather than replacing it, and a rank appears beside each arrow once more than
one column is in play:

::image{src=media/screenshot-sorted.png alt="A table sorted by Industry then Annual revenue, each heading showing an arrow and a small rank numeral" zoom}

A plain click still replaces the whole order. A third shift-click removes a
column from it — with a rank on screen there is a meaningful "not sorted by
this" state, and no other way to reach it.

The rank lives in the heading's accessible name, not in `aria-sort`: that
attribute takes ascending, descending or none and carries no position, so a
screen reader told only `aria-sort` would hear several columns each "sorted
ascending" and nothing about which one wins.

## Outputs in practice

`selectedRecordIds` is one record ID per line, not comma-separated: a GUID
contains no newline, so the split is unambiguous. In a canvas app,
`Split(DataTable1.selectedRecordIds, Char(10))`.

`openedRecordId` updates *before* the record is opened, so it is observable even
on a host where opening does nothing. That is what makes it the canvas
substitute for row navigation.

`editedRecordId` is the row most recently saved by an inline edit, and
`createdRecordId` the row most recently added through the New button. They are
separate outputs on purpose: "which row was edited" and "which row was created"
are different questions, and a form reacts to them differently. Both are
unbraced, lower-case GUIDs like the other two — the platform hands the created
one back braced and upper-case, and the control normalises it.

All four outputs emit an empty string rather than nothing when they are cleared
— returning `undefined` from `getOutputs()` means "no change", which would
make a cleared selection impossible for a form to observe.
