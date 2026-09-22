/*
 * The stylesheet, checked against the markup the control actually renders.
 *
 *     npm run styles
 *
 * **Why this exists, and what it is not.**
 *
 * Every other assertion in this repository is over markup, and markup is not
 * where CSS bugs live. 0.6.0 shipped a group caption with the right text, in
 * the right place in the DOM, carrying `className="DataTable-pager
 * DataTable-caption"` — and `.DataTable-caption` has been the
 * `<table><caption>`'s class since 0.2.0, where it is *visually hidden*:
 * `position: absolute`, one pixel square, `clip: rect(0 0 0 0)`. So the caption
 * was clipped to nothing on the form while every assertion passed, and finding
 * it cost two screenshots and a DOM query.
 *
 * This is **not** the `getComputedStyle` rig the skill describes under
 * *Styling*. That needs a browser, and a browser is a dependency and a second
 * way to load the control. This is the much narrower check that would have
 * caught the actual bug: **no element may carry a visually-hidden class
 * alongside any other class of ours**, because that is always either a
 * collision or a contradiction.
 *
 * What it cannot see: a selector that matches nothing, a token name spelled
 * wrong, a colour with no contrast, anything about layout. Those still need
 * eyes on a real form, and `SPEC.md` says so.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'DataTable', 'css', 'DataTable.css'), 'utf8');

let passed = 0;
let failed = 0;

const check = (label, ok, detail) => {
    if (ok) {
        passed += 1;
        console.log('  ok    ' + label);
    } else {
        failed += 1;
        console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : ''));
    }
};

/* ------------------------------------------------- the visually-hidden set */

/**
 * The classes this stylesheet hides from sight while leaving them to a screen
 * reader. Detected by the signature rather than by name, so a third one added
 * later is covered without anybody remembering to list it.
 */
function hiddenClasses() {
    const found = new Set();
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}');

    for (const rule of rules) {
        const [selector, body] = rule.split('{');

        if (!body) {
            continue;
        }

        const hidden = /clip\s*:\s*rect\(\s*0/.test(body)
            || (/position\s*:\s*absolute/.test(body) && /width\s*:\s*1px/.test(body));

        if (!hidden) {
            continue;
        }

        /*
         * **Only a bare class selector counts**, and that narrowing is not
         * cosmetic. `.DataTable-table .is-pinnedEdge::after` is a one-pixel
         * absolutely-positioned divider line — it matches the signature
         * perfectly and says nothing about `.DataTable-table`, which the first
         * version duly reported as visually hidden. A hidden *utility* class
         * is always written as its own bare rule; a descendant or
         * pseudo-element selector is describing a decoration.
         */
        for (const part of selector.split(',')) {
            const name = part.trim();

            if (/^\.DataTable-[A-Za-z0-9_-]+$/.test(name)) {
                found.add(name.slice(1));
            }
        }
    }

    return found;
}

const hidden = hiddenClasses();

console.log('\n  visually-hidden classes: ' + [...hidden].join(', '));

check(
    'the stylesheet still has a visually-hidden class to check against',
    hidden.size > 0,
    'none found — the signature may have changed, and this check is now inert',
);

/* --------------------------------------------- every class list in the tsx */

/**
 * Read the `className` literals out of the component rather than rendering it.
 *
 * A rendered pass would be better and is not available: `renderDeep` needs the
 * built bundle, and this has to run before a build so a collision is caught at
 * the moment it is written. Template literals with an expression in them are
 * split on the static parts, which is enough — the bug being hunted is a
 * *static* pair of names.
 */
const tsx = fs.readFileSync(path.join(root, 'DataTable', 'components', 'DataTableControl.tsx'), 'utf8');
const lists = [];

for (const match of tsx.matchAll(/className=(?:"([^"]*)"|\{'([^']*)'\}|\{`([^`$]*)`\})/g)) {
    const value = match[1] || match[2] || match[3] || '';
    const classes = value.split(/\s+/).filter((name) => name.startsWith('DataTable-'));

    if (classes.length > 1) {
        lists.push(classes);
    }
}

const collisions = lists.filter((classes) => classes.some((name) => hidden.has(name)));

check(
    'no element carries a visually-hidden class beside another of ours',
    collisions.length === 0,
    collisions.map((c) => c.join(' + ')).join('; ')
        + '\n          A hidden class clips its element to one pixel. Pairing it with a layout'
        + '\n          class is always either a collision or a contradiction.',
);

/* ------------------------------------ the sort indicator cannot be clipped */

/*
 * **A sorted column with no visible arrow.** The heading button is a flex
 * container carrying the label, the arrow and the rank; a heading wider than
 * its column overflowed, and because `text-overflow: ellipsis` does nothing to
 * flex *children*, the arrow and rank were carried out past the cell's
 * `overflow: hidden` and simply vanished.
 *
 * Measured: "Annual revenue" in a 107px column put its arrow at x=717 inside a
 * cell ending at 708. Every assertion passed throughout — the markup, the
 * `aria-sort` and the accessible name were all correct — and the feature was
 * invisible. It was found by looking at a screenshot.
 *
 * Nothing that reads the DOM can see this, so the guard is on the rules that
 * prevent it: the label is the flex item that gives way, and the marks hold
 * their size.
 */
const ruleFor = (selector) => {
    const at = css.indexOf(selector);

    return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
};

const labelRule = ruleFor('.DataTable-sortLabel');

check('the sort heading label is the part that truncates',
    labelRule.indexOf('overflow: hidden') > -1
    && labelRule.indexOf('text-overflow: ellipsis') > -1
    && labelRule.indexOf('min-width: 0') > -1,
    labelRule ? labelRule.replace(/\s+/g, ' ').slice(0, 110) : 'no .DataTable-sortLabel rule');

check('and the arrow and rank keep their size beside it',
    ruleFor('.DataTable-arrow,').indexOf('flex: none') > -1
    || ruleFor('.DataTable-sortRank {').indexOf('flex: none') > -1,
    'flex: none on the marks');

/* ------------------------------------- every string the control asks for */

/*
 * **A key the rig cannot resolve renders as the key itself**, and `getString`
 * falls back silently — so `DataTable_GroupExpand` appears verbatim on screen.
 * That is invisible to an assertion counting elements and glaring in a
 * screenshot, which is exactly how it was found: the 0.6.0 grouping strings
 * were all missing from `dev/host.js` and the first grouped capture showed
 * resource keys where the words should be.
 *
 * `host.js`'s own comment had predicted this failure in those words. A note is
 * not a guard, so here is the guard.
 */
const strings = require('./host.js').STRINGS;
const resx = fs.readFileSync(
    path.join(root, 'DataTable', 'strings', 'DataTable.1033.resx'), 'utf8',
);
const shipped = {};

for (const match of resx.matchAll(/<data name="([^"]+)" xml:space="preserve">\s*<value>([\s\S]*?)<\/value>/g)) {
    shipped[match[1]] = match[2]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/*
 * **Every quoted literal that names a shipped key**, not just the ones sitting
 * directly inside `getString(`. The first version of this guard anchored on
 * that call and passed while the grouped screenshot still showed
 * `DataTable_GroupExpand` on screen — because the component asks for it through
 * a ternary, `getString(open ? 'DataTable_GroupCollapse' : 'DataTable_GroupExpand')`.
 * A guard with a hole exactly the shape of the bug is worse than none.
 */
const sources = [];
const collect = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
        return collect(full);
    }

    if (/\.tsx?$/.test(entry.name)) {
        sources.push(fs.readFileSync(full, 'utf8'));
    }
});

collect(path.join(root, 'DataTable'));

const asked = new Set();

for (const source of sources) {
    for (const match of source.matchAll(/'([A-Za-z0-9_]+)'/g)) {
        if (shipped[match[1]] !== undefined) {
            asked.add(match[1]);
        }
    }
}

const unresolved = [...asked].filter((key) => strings[key] === undefined).sort();

check('every string the control asks for resolves in the preview rig',
    unresolved.length === 0,
    unresolved.length + ' would render as their own key: ' + unresolved.join(', '));

const drifted = [...asked]
    .filter((key) => strings[key] !== undefined && strings[key] !== shipped[key])
    .sort();

check('and matches what the .resx ships',
    drifted.length === 0,
    drifted.map((key) => key + ': rig ' + JSON.stringify(strings[key])
        + ' vs resx ' + JSON.stringify(shipped[key])).join('; '));

/* --------------------------------------- classes used but never styled */

/*
 * A class the markup uses and the stylesheet never mentions is usually a
 * rename that landed in one file only. Reported as a warning rather than a
 * failure: a class can legitimately exist as a hook for a suite or a
 * screenshot rig without carrying any style of its own.
 */
const used = new Set();

for (const match of tsx.matchAll(/DataTable-[A-Za-z0-9_-]+/g)) {
    used.add(match[0]);
}

const unstyled = [...used].filter((name) => css.indexOf('.' + name) === -1).sort();

if (unstyled.length > 0) {
    console.log('\n  note: used in markup, never styled — ' + unstyled.join(', '));
}

/* ------------------------------------------------------------------ report */

console.log('');

if (failed > 0) {
    console.log('  ' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
}

console.log('  ' + passed + ' passed — class collisions only; layout and colour still need a real form');
