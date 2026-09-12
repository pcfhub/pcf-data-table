---
title: Migration
description: Moving between released versions.
order: 9
appliesTo: ">=0.2.0"
---

# Migration

## 0.3.x → 0.4.1

0.4.0 adds a choice editor, a New button, and date and choice filter boxes.
**Nothing was renamed and nothing was removed.** One new input is off by
default; the filter row changes on upgrade for date columns, and for choice
columns on a model-driven app.

| Property | Default | What it does |
| --- | --- | --- |
| `enableCreate` | **off** | A **New** button that opens the table's quick create form |
| `createdRecordId` | *(output)* | The row most recently added through it |

### The import asks for a permission this time

:::callout{type=warning}
**0.4.0 declares the `Utility` feature**, the first feature this control has
ever declared, so re-importing the solution raises a permission prompt where
0.1.0 through 0.3.4 raised none. It buys `getEntityMetadata`, which is where
the option list for a choice column's editor and filter box comes from — the
platform does not hand a dataset control that list any other way.

It is declared `required="false"`: an environment that declines it still
loads the control, and choice cells and choice filters simply stay as they were
in 0.3.x. Nothing else is asked for. Writes still go through the dataset
record, and the New button uses a navigation call no feature gates.
:::

### What changes on upgrade without touching anything

- **Date columns get a filter box** — a date picker with an **On / From /
  Until** chip beside it — wherever `enableFiltering` is on, which it is by
  default. Turn filtering off if you would rather keep the row as it was.
- **Choice columns get a dropdown filter** on a model-driven app, with **Any**
  at the top. On canvas they keep the dash.
- **Choice cells get an editor** wherever `enableEditing` was already on and
  the platform reports the cell editable. State and status columns do not: the
  platform says no, and the control asks.

### Turning the New button on

Set **Allow adding rows** to Yes. The table needs *Allow quick create* enabled
and a quick create form, or the platform has nothing to open. The button sits
beside the pager rather than above the table, because a model-driven subgrid
already has a command bar up there — see [Model-driven apps](model-driven.md).

### What did not change, and why

Lookup cells are still read-only. 0.4.0 was specified to edit them through the
platform's own lookup dialog and the measurement removed the feature rather
than the specification: the dialog works, and `record.setValue()` on a lookup
column stages nothing on the host it was tried on. [Limitations](limitations.md)
has the detail.

## 0.2.0 → 0.3.0

0.3.0 adds pinned columns and inline editing. **Nothing was renamed and nothing
was removed**, and every new property is off or unset by default — so an
upgraded table renders exactly as it did before, and writes nothing, until you
turn something on.

| Property | Default | What it does |
| --- | --- | --- |
| `pinnedStart` | *(unset)* | How many of the view's first columns stay put while the table scrolls sideways |
| `pinnedEnd` | *(unset)* | The same at the other end |
| `enableEditing` | **off** | Edit a cell in place and save it |
| `editableColumns` | *(unset)* | Narrow editing to named columns |
| `editedRecordId` | *(output)* | The row most recently saved |

### Turning editing on

Set **Inline editing** to Yes. Nothing else is required — the control asks
Dataverse which cells this user may write, per column and per record, and offers
an editor only where the answer is yes. **Editable columns** narrows that
further if you want only some of them; it cannot widen it, so a column locked by
column-level security stays read-only however it is listed.

Text, number, yes/no and date columns get an editor. Choice and lookup columns
do not — see [Limitations](limitations.md) for why that is a refusal rather
than an omission.

:::callout{type=info}
**Editing still asks nothing of the environment.** The write goes through the
dataset record rather than the Web API, so re-importing the solution raises no
new permission prompt — the same as every previous release of this control.
:::

Both take a **count**, not a list of column names: the view designer already
decides which columns come first, so `1` pins whichever column the view puts at
the front. Move the column in the view and the pinning follows it, which is the
reason for counts — a name would keep pointing at a column that had moved, or at
one no longer in the view at all.

Three behaviours to expect, none of which is an error:

- Pinning at the start **pins the selection checkboxes too**. They are the first
  column; left loose they would slide under the column pinned beside them.
- **One column is always left unpinned.** Ask for more than the view has and the
  count at the end is trimmed first.
- **Pinning switches itself off on a narrow host** — a phone-width subgrid where
  the pinned columns would leave less than one column's worth of table still
  moving renders unpinned instead. The same configuration pins on a wide screen.

### Nothing new is asked of the environment

The control still declares no features, so re-importing the solution raises no
new permission prompt. Pinning is layout and nothing else.


## 0.1.x → 0.2.0

0.2.0 adds a filter row, a jump-to-page box, a rows-per-page picker and a CSV
export. **Nothing was renamed and nothing was removed**, so an existing
configuration keeps working and existing canvas formulas keep resolving. Three
new properties are all there is to decide about, and two of them are off until
you say otherwise.

### The three new properties

| Property | Default | What it does |
| --- | --- | --- |
| `enableFiltering` | **on** | A filter box under each text and numeric column heading |
| `enableExport` | off | An **Export CSV** button in the pager |
| `pageSizeOptions` | empty | A comma-separated list, e.g. `10,25,50,100`, shown as a rows-per-page picker |

`enableFiltering` is the only one that changes an existing table's appearance on
upgrade. Set it to **off** if you would rather keep the header as it was, or if
the view already filters to exactly what its readers need.

:::callout{type=info}
The other two are opt-in on purpose. `pageSizeOptions` carries no default so
that a table nobody has configured still adopts the page size the host is
already using; and `enableExport` is off because the export covers the rows
loaded so far rather than the whole view — see
[Limitations](limitations.md) — which is a thing to opt into knowingly rather
than to discover from a colleague's short spreadsheet.
:::

### What the filter row will not filter

Text and numeric columns get a box. Date, choice, two-options and lookup columns
do not, and it is deliberate rather than unfinished — the reasons are in
[Limitations](limitations.md). If your readers filter on a choice column today
through the view selector or a quick find, they still should.

### Nothing new is asked of the environment

The control still declares no features, so re-importing the solution raises no
new permission prompt. Filtering goes through the dataset the control already
had, and the export uses a navigation method that is not gated.

### The page size now resets the page

Changing the number of rows per page returns the reader to page one. This was
always the right behaviour and was previously unreachable, because the page size
could only be set at configuration time. It matters now that a reader can change
it mid-view: "page 3" means something different once the pages are recut.
