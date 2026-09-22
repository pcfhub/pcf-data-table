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
4. Set the input properties you need. Leave **Page size** alone and the table
   pages the way the host already does — the *Rows per page* you set on a main
   grid, or the row count on the subgrid — and only overrides it if you fill it
   in. Selection, sorting and row-click-opens-record default on; **Inline
   editing**, **Allow adding rows** and **Export** default off.
5. Save and publish. If this is the first import of 0.4.0 or later, the
   solution import asks for the **Utility** feature — see below.
::

## The one permission it asks for

From 0.4.0 the control declares the `Utility` feature, so importing the
solution raises a permission prompt. It buys entity metadata — the option list
a choice column's editor and filter box are built from — and nothing else.
There is no Web API in this control: an edited cell is saved through the
dataset record, and the New button opens a form through a navigation call that
no feature gates.

Declining it is safe. The control loads, and choice cells and choice filters
behave as they did in 0.3.x — read-only, and a dash in the filter row.

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

::image{src=media/screenshot-form.png alt="An Accounts subgrid with the platform's command bar above the control's own table and pager" zoom}

Above the table in that screenshot — New, Refresh, the overflow menu — is the
platform's command bar, not the control's. Below it, the header row, the sort
indicator and the pager are the control's.

That picture is from a real form on 0.1.x, which is why it is the one used here:
the command bar is the host's and only a real form has one. It predates the
filter row, so the table under it is a version behind — see
[Overview](overview.md) for what the control looks like now.

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

## Grouping, and what makes the whole-view answer possible

A model-driven app is where grouping answers about the **whole view** rather
than the page. The control reads the view's own FetchXML, rewrites it as an
aggregate query and asks the Web API once — so a caption reading *14 groups ·
4,120 records · the whole view* is a statement about all 4,120 records, not
about the twenty-five on screen.

Three things have to be true for that, and the caption tells you when one is
not:

- **The Web API is available.** It is declared `required="false"`, so an
  environment that declined it still groups — over the loaded rows, and says so.
- **The view's FetchXML can be read.** The control tries `savedquery` and then
  `userquery`; a personal view the user cannot read falls back.
- **A subgrid's parent can be resolved.** See below, because this is the one
  that produces a confidently wrong number if it is got wrong.

### Parent lookup, in a subgrid

A subgrid's relationship to the record it sits under is **invisible** to the
control: `getFilter()` returns null and `getLinkedEntities()` is empty. So an
aggregate over "the whole view" would count every row in the table, and a
grouped subgrid of contacts under one account would claim 3,400 contacts above
a grid holding six.

The control resolves the lookup itself — matching the parent's table against
the child's lookups — and **withholds the whole-view route entirely** when the
answer is ambiguous. Set **Parent lookup** when the table has several lookups
to the same table, or to `none` when the subgrid is genuinely unrelated.

## Exporting the whole view

**Export covers** set to *the whole view* walks the view a page at a time and
writes one file. It pages exactly the way the pager does, at the size the view
is already using — it does not change your page size, because changing it
mid-session was measured to break paging on a real subgrid.

The practical consequence is that the request count follows the view's page
size. A subgrid paging four rows at a time turns 1,200 records into 300
requests; setting **Page size** to 100 turns the same view into 12. While it
runs, the table is replaced by a counter and a **Stop**, and wherever it stops
you are put back on the page you started from.

## Editing choice cells

With **Inline editing** on, a choice column's cells open as a dropdown of the
column's options, with an empty entry to clear. The value saved is the option's
integer, through the dataset record, exactly as a text cell is saved. Two
columns that look like choices stay read-only: **Status** (`statecode`) and
**Status reason** (`statuscode`). The platform reports them as not editable
and the control asks before offering anything, so nothing needs configuring.

A lookup column's cells open as the current name with two buttons. **Choose…**
opens the platform's own lookup dialog — the table's views, its search and its
security, exactly as on the form — and the pick is saved the moment the dialog
closes. **Clear** empties the cell, and is offered only while there is
something to clear. Escape or the cross closes the cell without writing. A
Customer lookup offers both tables in the dialog.

::image{src=media/screenshot-lookup.png alt="A lookup cell open for editing: the current contact's name, a Choose button, a Clear button and a cross" zoom}

This is the one editor that writes through the Web API rather than the dataset
record, which is why 0.5.0's import asks for that feature — see
[Limitations](limitations.md). Owner columns stay read-only.

## Adding rows

With **Allow adding rows** on, a **New** button appears beside the pager. It
opens the table's **quick create form**, seeded with the record the subgrid
sits on so the new row lands in this subgrid, and the control re-reads the view
when the form is saved. Dismissing the form does nothing.

Two prerequisites on the table, both set in the table's properties rather than
here:

- **Allow quick create** must be on.
- The table needs a **quick create form**.

The `createdRecordId` output carries the new row's ID for a form script or a
business rule to react to.
