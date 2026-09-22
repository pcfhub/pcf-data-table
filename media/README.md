# media

Screenshots, GIFs and video referenced from `docs/*.md` and from `pcfhub.json`.

PCFHub mirrors these onto its own CDN while it compiles a doc page, and writes
the mirrored URL into the page. Anything it cannot mirror keeps pointing at
`raw.githubusercontent.com`, so a large file still renders — it is just served
from GitHub instead.

Two things follow from that:

- **Keep them small.** There is a per-file ceiling and a per-sync file count on
  the hub's side. Screenshots in the tens of kilobytes mirror; a 40 MB video
  does not.
- **Paths are repository-relative and permanent-ish.** The mirror key is derived
  from the path, so replacing an image at the same path replaces the mirrored
  object. Renaming it strands the old one until the next full sync.

Reference them from a doc page with the `image` and `video` directives, which
take repository-relative paths:

```markdown
::image{src=media/screenshot.png alt="What it shows" zoom}
::video{src=media/walkthrough.mp4 poster=media/walkthrough-poster.png}
```

A video without a poster renders as a blank box until it loads, so always ship
one.

`pcfhub.json` also names a `logo` and up to twelve `screenshots` from here.

## What is here, and how each was taken

**The recipes live in [`dev/shots.js`](../dev/shots.js), and that file retakes
every picture.** Start the preview, then run it:

```bash
npm run preview
node dev/shots.js
```

Each shot is taken twice — once with `--dump-dom` to read back the height the
control actually rendered at, then once at exactly that height — so a picture is
tight against the control rather than padded out to whatever the window was, and
it stays tight when the layout changes.

| File | Width | Query | What it shows |
| --- | --- | --- | --- |
| `screenshot.png` | 960 | `?fixture=demo&export=1` | The table as an unconfigured install renders it |
| `screenshot-grouped.png` | 1400 | `?groupBy=industrycode&aggregates=sum:revenue,avg:revenue` | 0.6.0: group headers, two measures over one column, and the caption naming the scope |
| `screenshot-sorted.png` | 1280 | `?multiSort=1&sorted=industrycode,revenue` | 0.6.0: two columns in the sort order, rank beside each arrow |
| `screenshot-pinned.png` | 640 | `?fixture=demo&pinStart=1&pinEnd=1&scroll=200` | Pinned columns, which only read as pinned once something has scrolled past |
| `screenshot-editing.png` | 960 | `?edit=1&open=industrycode` | The choice editor open on the first row |
| `screenshot-filters.png` | 960 | `?date=2026-03-01&dateOp=from&create=1` | The date box with its chip, the choice dropdowns, the New button |
| `screenshot-narrow.png` | 320 | `?fixture=demo` | A phone-width subgrid: sideways scroll, wrapped pager |
| `screenshot-lookup.png` | 1280 | `?lookups=1&edit=1&open=primarycontactid` | The lookup editor open: name, Choose…, Clear |

Two of these are wider than the rest deliberately. Nine columns at 960 clip the
headings, and a stacked sum and average need the room; a screenshot that crops
the thing it is about is worth nothing.

**`screenshot-sorted.png` seeds the sort rather than clicking it.** A click
refreshes the dataset and rebuilds the header row, so a headless capture races
the re-render and photographs one arrow of two. `?sorted=` opens on a view that
is already ordered, which has no race and is also the more honest picture — it
is what a reader sees on opening a sorted view.

### `screenshot-form.png` is the exception

A real Accounts subgrid, captured on 0.1.x. It is **not** retaken by
`dev/shots.js` and cannot be: only a real form has a command bar, and nothing
headless reproduces one. It is stale by version and kept on purpose, because the
thing it shows has not changed and no generated picture can replace it.

### What taking these found

Three defects, none of which any assertion in this repository could reach,
because each one was correct markup drawn wrongly:

- **Two aggregates over one column rendered as one.** `sum:revenue, avg:revenue`
  drew the sum and dropped the average silently.
- **Measures on the browser route were computed and never labelled**, so a
  grouped canvas table showed empty cells where the numbers should be.
- **A sorted column could show no sort arrow at all.** A heading wider than its
  column carried the arrow and the rank out past the cell's `overflow: hidden`.

All three are now covered by assertions, and the screenshots are why they are
known at all. This is the step that looks at the thing.
