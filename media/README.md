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

Every screenshot is captured from `dev/preview.html` served by `npm run
preview`, in headless Chrome, at the width named. The query parameters are the
whole recipe, so a picture can be retaken after any change:

| File | Width | Query |
| --- | --- | --- |
| `screenshot.png` | 960 | `?fixture=demo&export=1` |
| `screenshot-pinned.png` | 640 | `?fixture=demo&pinStart=1&pinEnd=1&scroll=200` |
| `screenshot-editing.png` | 960 | `?edit=1&open=industrycode` — the choice editor open on the first row |
| `screenshot-filters.png` | 960 | `?date=2026-03-01&dateOp=from&create=1` — the date box with its chip, the choice dropdowns, and the New button |
| `screenshot-narrow.png` | 320 | `?fixture=demo` |

`screenshot-form.png` is the exception: a real Accounts subgrid on 0.1.x,
kept because only a real form has a command bar.
