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

Yes, once a maker turns on **Allow sorting by several columns**. It is off by
default, so a plain click still replaces the whole order and every existing
install behaves exactly as it did — the alternative is a three-deep sort after
three clicks, which is rarely what anyone meant.

With it on, **shift-click** a heading to add that column after the ones already
in the order, and a small rank appears beside each arrow. A third shift-click
removes a column from the order.

Shift-click is the only way in, and it is not discoverable: there is no visible
affordance for it, so a reader who does not know the gesture will not find it.
That is accepted for this release rather than solved.

## How do I group the rows?

Set **Group by** to one or more logical column names. The table then draws one
header per group — its label, its record count, and any measures you asked for
under their own columns — and a caption underneath saying what was counted.

**Read that caption.** *the whole view* means a single aggregate query answered
over every record in the view. *the records loaded so far* means it could not,
and the numbers describe only the pages currently in the browser.

Add **Aggregates** as `function:column` pairs — `sum:revenue, avg:revenue` — to
put measures in the group headers. Several over one column stack in that
column, each labelled.

## Why does my group header say "the records loaded so far"?

Because the whole-view query was not available or was refused, so the control
fell back to counting the rows it already had — and said so rather than
presenting a page-sized total as a whole-view one.

The usual reasons: the host has no Web API (every canvas app), the view's
FetchXML could not be read, a runtime filter could not be translated into a
server query, or the control is in a subgrid whose parent relationship it could
not resolve. That last one is what **Parent lookup** is for.

## My export only wrote the rows I had already paged through.

That is the default. **Export covers** is *the rows loaded so far*; set it to
*the whole view* and the control reads the rest first, one request per page, at
the page size the view is already using.

A subgrid often pages four rows at a time, which makes a 1,200-record export
300 requests. Raise **Page size** if you export large views: at 100 a page the
same view is 12 requests. There is a ceiling of 500 requests or 10,000 rows,
whichever comes first, and the file says when it was reached.

## Why did the import ask for a permission?

Because 0.4.0 declares the `Utility` feature — the first this control has
declared. It buys the option list for a choice column's editor and filter box,
which the platform hands a dataset control no other way. Declining it is safe:
choice cells and choice filters stay as they were in 0.3.x, and nothing else in
the control depends on it. There is still no Web API in this control.

## Why does the import ask for the Web API?

Because a lookup cell is the one column the dataset record cannot write.
`record.setValue()` on a lookup column stages nothing — measured, five value
shapes — so a lookup pick is saved with `webAPI.updateRecord`, and that needs
the `WebAPI` feature declared. Every other column still writes through the
record. Declining the feature at import leaves lookup cells read-only and
changes nothing else.

## Why is a lookup cell read-only in my canvas app?

A canvas app has no `webAPI`, and no lookup dialog to pick from either. The
control offers the editor only where all of it works; on canvas the cell shows
the reference and the lookup is edited on the form.

## How do I clear a lookup?

Open the cell and press **Clear**. It is offered only while the cell holds
something, and it writes `null` through the same call a pick does.

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
