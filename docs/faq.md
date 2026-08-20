---
title: FAQ
description: Questions that come up more than once.
order: 8
---

# FAQ

## How do I choose which columns show?

In the view, not in the control. Data Table renders whatever the view or the
canvas Fields flyout supplies — there are no column properties to set. That is
deliberate: a control with fixed column slots is capped at however many slots
its manifest declares, and it cannot know the widths and order you already set.

## Why is a column not sortable?

The view marks it that way (`disableSorting`), so the control does not offer a
sort it cannot deliver. Calculated and some related-entity columns are the
common cases.

## Why does the pager say "Page 3" instead of a row range?

The platform did not count the result set and returned `-1` for the total. The
control shows the page number rather than printing "of -1".

## I set the page size to 100 and got fewer rows.

The platform clamps a page request on large views. The control asks for what you
configured (capped at 250) and renders what came back.

## Does ticking rows drive the ribbon buttons?

Yes, on a model-driven subgrid. The control calls `setSelectedRecordIds()`,
which is the same contract the out-of-the-box grid uses.

## Does the selection survive paging?

Yes. It does not survive a form reload.

## Can I sort by more than one column?

Not in this release. Each header click replaces the sort rather than adding to
it — the alternative is a three-deep sort after three clicks, which is rarely
what anyone meant.

## Nothing happens when I click a row in my canvas app.

Expected. `openDatasetItem()` needs a model-driven form. Wire your navigation to
the `openedRecordId` output instead — it updates on every row click.
