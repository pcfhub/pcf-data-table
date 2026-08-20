---
title: Limitations
description: What Data Table does not do.
order: 7
---

# Limitations

## Not in this release

- **No filtering.** `dataset.filtering` is a second design — condition
  operators, a filter UI, and a canvas story that does not exist yet. Use the
  view's own filters, or a canvas `Filter()` on `Items`.
- **No column resizing or reordering by the user.** The widths and order are the
  view's, and changing them is a view-designer job.
- **No grouping, no aggregate row, no inline editing.**
- **No jump-to-page.** Next and Previous only. The dataset API has
  `loadExactPage`, but it is guarded as optional here because it is not present
  on every host.

## Behaviour worth knowing

- **Selection is not persisted across a form reload.** It lives in the control
  for the lifetime of the page. Reopen the form and nothing is ticked.
- **Page size may be clamped.** The control asks for what you configure, capped
  at 250; the platform may return fewer rows per page on a large view, and the
  pager reflects what actually arrived.
- **The row count can be absent.** When the platform does not count the result
  set it reports `-1`, and the pager reads "Page 3" instead of "51–75 of 240".
  That is the platform declining to count, not the control failing to.

## Canvas apps

- Opening a record does nothing — there is no form to open. Use the
  `openedRecordId` output. See [Canvas apps](canvas.md).
- Column widths are the browser's, because canvas reports no
  `visualSizeFactor`.
- Columns come from the Fields flyout on `Items`. Pick none and the control says
  so rather than rendering an empty grid.

## In the hub's demo

The demo runs against a fixed 24-row fixture with no server behind it, so
paging, sorting and selection cannot do what they do on a real view. Each dead
interaction is named on the component's demo page.
