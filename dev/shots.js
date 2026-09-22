/*
 * Retake every screenshot in `media/`.
 *
 *     npm run preview          # in one shell, or via the launch config
 *     node dev/shots.js
 *
 * **The recipes live here, not in a person's shell history.** `media/README.md`
 * used to be the only record of how each picture was taken, which made a
 * retake an exercise in archaeology — and a stale screenshot is a documented
 * claim about a version that no longer exists. The table below is the whole
 * recipe: a name, a width, and the query string that puts the control into the
 * state worth photographing.
 *
 * Each shot is taken twice: once with `--dump-dom` to read back the height the
 * control actually rendered at, and once at exactly that height. So a picture
 * is tight against the control rather than padded out to whatever the window
 * happened to be, and it stays tight when the control's layout changes.
 *
 * `screenshot-form.png` is deliberately absent. It is a real Accounts subgrid
 * on a real form, and only a real form has a command bar — nothing headless can
 * reproduce it, so it is kept rather than regenerated.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const media = path.join(root, 'media');

const CHROME = process.env.CHROME || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => fs.existsSync(candidate));

const PORT = process.env.PORT || 8099;
const BASE = 'http://localhost:' + PORT + '/dev/preview.html';

/** name, width, query — and what the picture is for. */
const SHOTS = [
    ['screenshot.png', 960, 'fixture=demo&export=1',
        'the table as an unconfigured install renders it, plus the export button'],
    // Wider than the rest on purpose: nine columns at 960 clip the headings
    // and cut the measures in half, and a stacked sum and average need the
    // room. A screenshot that crops the thing it is about is worth nothing.
    ['screenshot-grouped.png', 1400, 'groupBy=industrycode&aggregates=sum:revenue,avg:revenue',
        '0.6.0: group headers, two measures over one column, and the caption naming the scope'],
    ['screenshot-sorted.png', 1280, 'multiSort=1&sorted=industrycode,revenue',
        '0.6.0: two columns in the sort order, with the rank beside each arrow'],
    ['screenshot-pinned.png', 640, 'fixture=demo&pinStart=1&pinEnd=1&scroll=200',
        'pinned columns, which only read as pinned once something has scrolled past'],
    ['screenshot-editing.png', 960, 'edit=1&open=industrycode',
        'the choice editor open on the first row'],
    ['screenshot-filters.png', 960, 'date=2026-03-01&dateOp=from&create=1',
        'the date box with its chip, the choice dropdowns, and the New button'],
    ['screenshot-narrow.png', 320, 'fixture=demo',
        'a phone-width subgrid: sideways scroll, wrapped pager'],
    ['screenshot-lookup.png', 1280, 'lookups=1&edit=1&open=primarycontactid',
        'the lookup editor open: name, Choose…, Clear'],
];

if (!CHROME) {
    console.error('\n  No Chrome found. Set CHROME to its path.\n');
    process.exit(1);
}

function chrome(args) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf-shot-'));

    try {
        return execFileSync(CHROME, [
            '--headless',
            '--disable-gpu',
            '--no-sandbox',
            '--hide-scrollbars',
            '--force-device-scale-factor=1',
            // Generous on purpose. The interactions that put the control
            // into a photographable state are chained through timers — a
            // sort clicks, waits for the re-render, then clicks again — and
            // a budget that runs out mid-chain captures a half-applied state.
            // The first multi-sort capture showed one arrow of two.
            '--virtual-time-budget=12000',
            // Without this the screenshot pass paints before the virtual
            // clock has finished: the multi-sort capture showed one arrow of
            // two while `--dump-dom` at the same budget showed both. It makes
            // the compositor run every stage before the frame is taken.
            '--run-all-compositor-stages-before-draw',
            '--user-data-dir=' + dir,
            ...args,
        ], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

let failed = 0;

for (const [name, width, query, why] of SHOTS) {
    const url = BASE + '?' + query;

    try {
        // Pass one: what height did it actually render at?
        const dom = chrome(['--window-size=' + width + ',2400', '--dump-dom', url]);
        const measured = dom.match(/data-measured-height="(\d+)"/);

        if (!measured) {
            console.log('  FAIL  ' + name + ' — the control never rendered');
            failed += 1;
            continue;
        }

        // A little air below the control, matching what the old captures had.
        const height = Number(measured[1]) + 16;
        const out = path.join(media, name);

        // Pass two: the picture, at exactly that size.
        chrome(['--window-size=' + width + ',' + height, '--screenshot=' + out, url]);

        const size = fs.statSync(out).size;

        console.log('  ok    ' + name.padEnd(24) + width + '×' + height
            + '  ' + String(Math.round(size / 1024)).padStart(4) + ' KB   ' + why);
    } catch (error) {
        console.log('  FAIL  ' + name + ' — ' + String(error.message).split('\n')[0].slice(0, 90));
        failed += 1;
    }
}

console.log('');

if (failed > 0) {
    console.log('  ' + failed + ' of ' + SHOTS.length + ' failed');
    process.exit(1);
}

console.log('  ' + SHOTS.length + ' screenshots retaken into media/');
