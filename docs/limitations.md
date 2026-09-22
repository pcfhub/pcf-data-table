---
title: Limitations
description: What Data Table does not do.
order: 7
---

# Limitations

## What filtering covers

- **Text, numeric, date and — in a model-driven app — choice columns get a
  filter box.** Text columns match with a SQL `LIKE`; numeric ones take a bare
  number or a comparison such as `>1000`; a date column gets a date picker with
  an **On / From / Until** toggle beside it — shown as **=, ≥, ≤** where the
  column is too narrow for the word; a choice column gets a dropdown of
  its options with **Any** at the top.
- **The date box compares whole days, in your time zone.** "On 1 March" is the
  calendar day where you sit, so a record stamped 04:30 UTC on 2 March matches
  On 1 March for a user five hours west of Greenwich — which is what the
  platform's own filter pane does. Measured on a model-driven subgrid; not yet
  opened in a canvas app.
- **The choice box needs entity metadata, so it is model-driven only.** The
  option list comes from `getEntityMetadata`, which is why 0.4.0 declares the
  `Utility` feature. On a host without it — canvas, or an environment that
  declined the feature — the column shows the dash it showed in 0.3.x.
- **Lookups, two-options and multi-select choices have no filter box.** A
  lookup filters on a GUID, and turning a typed name into one is a query this
  control does not make; a multi-select holds a list that `Equal` says nothing
  true about. Filter those in the view instead.
- **Two filled boxes mean *both*.** Each column narrows the result further; the
  filter row is not a search across columns.
- **A jump past the last page lands on the last page**, and on a host that does
  not support `loadExactPage` a jump of more than one page is refused rather
  than half-performed — stepping once while the pager claims page 7 would be
  worse than not moving.

## What the CSV export covers

- **What it covers is a setting.** *Export covers* is **the rows loaded so
  far** by default — the dataset holds the pages that have been fetched, and
  pages nobody opened are not in it. Set it to **the whole view** and the
  control reads the rest first.
- **Reading the whole view costs one request per page, at the view's own page
  size — and that page size is often very small.** A model-driven subgrid was
  measured at **four rows a page**, which turned 1,222 records into **306
  requests**. The export does not change it, for the reason in the next bullet.
- **Set `Page size` if you export large views.** It is the lever: it raises the
  page the *grid* uses, so the same 1,222 records become 13 requests at 100 a
  page or 5 at 250. It is applied when the grid loads rather than changed
  underneath it, which is the distinction that matters here.
- **At most 500 requests.** Whichever ceiling is reached first — 10,000 rows or
  500 pages — ends the export, and the file says it holds the first N rows
  rather than the view. Rows bound the file; pages bound the server, and at four
  rows a page the row ceiling alone would have permitted 2,500 round trips.
- **While it runs, the table is replaced by a page counter and a Stop.** The
  rows are not drawn at all. They would be pages nobody asked to see, replaced
  every round trip — and at a page size of 250 the table grew past the viewport
  faster than a reader could scroll, carrying **Stop** (which sits below the
  table, in the pager) off the bottom of the screen with it. The rows come back
  on the page you started from as soon as the file is written.
- **The export pages the view exactly as you do, and never resizes it.** It
  asks for the same pages, through the same call, at the same size the pager is
  already using. Measured on a real subgrid, 2026-09-21: after the export raised
  the page size to 250, page one arrived and **every request after it failed** —
  a jump to page two was ignored outright, and a step to the next page threw
  inside the platform. The same view pages perfectly from the pager. The resize
  was the only difference, so the resize is gone.
- **An export never asks for a page it has not been answered about.** The
  platform serves the most recent request and says nothing about the ones it
  dropped, so a control that asked for page 3 while page 2 was still in flight
  would simply never receive page 2 — and would write a file that looks
  complete. Each page is confirmed to have arrived, by `firstPageNumber`, before
  the next is requested.
- **Stop writes the file immediately.** The platform offers no way to abort the
  request already in flight, so the page being read still arrives — but nothing
  needs to wait for it: it arrives to a finished export and is discarded. The
  file holds what had been collected at the moment you pressed Stop.
- **A page that never arrives ends the export after 30 seconds.** The file is
  still written, holding what there was, and the control says which page it was
  waiting for. `loadExactPage` returns nothing to wait on and reports no error,
  so a timer is the only failure signal available.
- **At most 10,000 rows.** Past that the export stops and says so, and the file
  holds the first 10,000. The limit is the number of round trips rather than
  the size of the file.
- **Wherever it stops, you are put back on your page.** The export moves
  through the view to do its job; leaving a reader somewhere else would be a
  side effect of asking for a file. The page size is never touched, so there is
  nothing there to restore.
  On a host without `loadExactPage` the page cannot be restored and the reader
  lands on page one.
- **Values are the formatted ones**, matching the table rather than the raw
  values underneath — so a choice exports as its label and a currency with its
  symbol.
- **Cells beginning `=`, `+`, `-` or `@` are prefixed with an apostrophe**,
  because a spreadsheet treats them as formulas. Numbers are left alone, so a
  negative figure stays a number.

## Not in this release

- **No column resizing or reordering by the user.** The widths and order are the
  view's, and changing them is a view-designer job.
- **No grouping and no aggregate row.**
- **Inline editing covers text, number, yes/no, date and — in a model-driven
  app — choice columns.** The choice editor is a dropdown of the column's
  options, read from entity metadata; state and status columns look like
  choices and stay read-only because the platform reports them so.
- **A date-and-time cell is edited with a date-and-time input, in your
  browser's time zone.** The platform shows the saved value in your Dataverse
  user time zone; where the two differ, the time you typed and the time the
  cell then shows differ by that offset. A date-only cell takes a day and
  stores it as that day.
- **While a save is in flight the cell shows the value through the platform's
  formatter**, so it reads like its neighbours; once the view has re-read, the
  platform's own text replaces it.
- **A lookup cell is edited through the Web API, so it is the one editor that
  is model-driven only.** Every other column writes through the dataset record
  and works wherever the record can be written. `record.setValue()` on a
  lookup column stages nothing — measured, five value shapes, every save
  refused — so a lookup pick is written with `webAPI.updateRecord` instead,
  which a canvas app does not have. On canvas, lookup cells stay read-only.
  Canvas **publishes** `page.getClientUrl` and throws `Method not implemented.`
  when it is called, so the control asks and takes the refusal for an answer;
  until 0.6.12 the throw escaped and the studio rendered *Error loading
  control* instead of the table.
  The write also needs the organisation URL to read the table's relationship
  metadata from; a host that withholds it, such as the hub's demo, gets the
  same read-only cell.
- **Owner lookups and multi-select choices stay read-only.** An owner column
  points at two tables through a navigation property no measurement has
  watched, and a multi-select has no editor yet.
- **Adding a row opens the quick create form, not a blank row in the table.**
  The form is where the business rules and required fields live; an inline row
  would have to bypass both. The table needs *Allow quick create* on and a
  quick create form, and the button is model-driven only.
- **Two permissions are asked for at import: Utility and Web API.** `Utility`
  arrived in 0.4.0 and buys the option lists the choice editor and choice
  filter are built from. `WebAPI` arrived in 0.5.0 and buys exactly one call,
  `updateRecord`, for lookup cells only — every other column still writes
  through the dataset record, and the New button uses a navigation call no
  feature gates. Both are declared `required="false"`, so an environment that
  declines one loses only what that one buys.
- **Editing writes one cell at a time.** There is no row-level Save/Cancel and
  no batching: leaving a cell commits it. A column that is part of a rule
  spanning several columns is better edited on the form.
- **Columns can only be pinned from the ends.** `Pinned columns (start)` and
  `Pinned columns (end)` take counts, so a column out of the middle of the view
  cannot be pinned without moving it in the view designer first.
- **Sorting by several columns is off until a maker turns it on.** With
  **Allow sorting by several columns** on, shift-clicking a heading adds that
  column to the order after the ones already in it; a plain click still
  replaces the whole order, so every existing installation behaves exactly as
  it did. A rank appears beside each arrow once more than one column is in play.
- **Shift-click is the only way in, and it is not discoverable.** There is no
  visible affordance for adding a column to the sort — a reader who does not
  know the gesture will not find it. Accepted for this release rather than
  solved.
- **A third shift-click removes a column from the order** rather than cycling
  back to ascending. With a rank on screen there is a meaningful "not sorted by
  this" state and no other way to reach it; a single-column sort has no such
  state, which is why a plain click still cycles.
- **The rank is in the heading's accessible name, not in `aria-sort`.** That
  attribute takes ascending, descending or none and carries no position, so a
  screen reader told only `aria-sort` would hear several columns each "sorted
  ascending" and nothing about which one wins.
- **Unverified in a canvas app.** Whether `dataset.sorting` is honoured there at
  all, let alone with several entries, has not been measured.

## Behaviour worth knowing

- **A cell is editable only if the platform says so.** The control asks
  Dataverse about every cell it is about to offer an editor for, per column
  *and* per record — so a column locked by column-level security, or one the
  platform reports as read-only on that particular row, renders as plain text.
  The **Editable columns** property can narrow that further; it can never widen
  it.
- **Editors appear a moment after the rows do.** Asking whether a cell is
  editable is a call to the platform rather than something the control can work
  out for itself, so cells render read-only until the answers arrive. That is
  deliberate: offering an editor and taking it away is worse than showing it a
  moment late.
- **A refused write rolls the cell back and says why.** The value returns to
  what it was and the reason appears under the cell. This is the path worth
  knowing about, because it is the one the demo on this page cannot show.
- **Pinning switches itself off on a narrow host.** If the columns you pinned
  would leave less than one column's worth of table still moving — a wide
  column pinned in a phone-width subgrid, say — the table renders unpinned
  rather than pinned to a sliver. Nothing is reported: on a wide screen the
  same configuration pins, so this is a layout that adapts rather than a
  setting that failed.
- **Pinning the first column pins the selection checkboxes with it.** They are
  the first column, and left loose they would slide underneath the one pinned
  beside them.
- **You cannot pin every column.** One is always left to scroll, and the count
  at the end is reduced before the count at the start — the columns that name
  the row are the ones worth keeping.
- **Selection is not persisted across a form reload.** It lives in the control
  for the lifetime of the page. Reopen the form and nothing is ticked.
- **Page size may be clamped.** The control asks for what you configure, capped
  at 250; the platform may return fewer rows per page on a large view, and the
  pager reflects what actually arrived.
- **The row count can be absent.** When the platform does not count the result
  set it reports `-1`, and the pager reads "Page 3" instead of "51–75 of 240".
  That is the platform declining to count, not the control failing to.

## On a narrow host

- **The table scrolls sideways rather than squeezing the columns.** Below about
  100 pixels a column it stops dividing the space and starts overflowing, and
  the scrollbar sits inside the control — the form itself does not widen. A
  phone subgrid at 320px shows two or three columns and scrolls to the rest.
- **The proportions are still the view's.** The widths divide whatever the table
  ends up being, so a column the view designer made narrow stays proportionally
  narrow when scrolling starts; the minimum buys the total width, not a floor
  under each column.
- **The pager wraps.** It needs roughly 520 pixels to sit on one line, so under
  that the paging buttons keep the first line and the page box, rows-per-page
  and export move below them. Every control stays reachable — nothing is cut
  off the end.

## Canvas apps

- Opening a record does nothing — there is no form to open. Use the
  `openedRecordId` output. See [Canvas apps](canvas.md).
- Choice cells and choice filters are read-only, and there is no New button:
  canvas has neither entity metadata nor a quick create form to open. The date
  box appears — it needs no metadata — and has not been verified there.
- Column widths are the browser's, because canvas reports no
  `visualSizeFactor`.
- Columns come from the Fields flyout on `Items`. Pick none and the control says
  so rather than rendering an empty grid.

## In the hub's demo

The demo runs against a fixed 24-row fixture with no server behind it, so
paging, sorting, filtering and selection cannot do what they do on a real view.
Each dead interaction is named on the component's demo page.

Filtering is the one worth calling out, because it is the feature that most
looks like it should work in a browser: it is applied by the server across every
page, and there is no server behind the demo. Typing in a filter box there
narrows nothing.
