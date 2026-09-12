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

## Why did the import ask for a permission?

Because 0.4.0 declares the `Utility` feature — the first this control has
declared. It buys the option list for a choice column's editor and filter box,
which the platform hands a dataset control no other way. Declining it is safe:
choice cells and choice filters stay as they were in 0.3.x, and nothing else in
the control depends on it. There is still no Web API in this control.

## Why can I edit a choice cell but not a lookup?

Because the lookup write was tried and did not work. The platform's lookup
dialog opens and hands back a reference; `record.setValue()` on a lookup
column then stages nothing, and the save is refused. Rather than offer an
editor that fails on save, the cell stays read-only and the lookup is edited on
the form. A choice saves as its integer through the same call, and that was
measured to persist.

## I typed a time into a date-and-time cell and the cell shows a different one.

The editor takes the time in your *browser's* zone; the platform displays it
in your *Dataverse user* zone, set under personal options. When the two
differ the saved value is right and the display is shifted by the offset
between them. Set the Dataverse zone to match the machine and they agree.

## The New button does nothing on my table.

Check two settings on the table itself: *Allow quick create* must be on, and
the table needs a quick create form. The control opens that form; it cannot
create one. In a canvas app the button never appears at all.

## Why does the date filter match a record from the next day?

Because it compares calendar days in *your* time zone, the way the platform's
own filter pane does. A record stamped 04:30 UTC on 2 March is 11:30 PM on
1 March for a user five hours west of Greenwich, and "On 1 March" includes it.

## Nothing happens when I click a row in my canvas app.

Expected. `openDatasetItem()` needs a model-driven form. Wire your navigation to
the `openedRecordId` output instead — it updates on every row click.
