/*
 * This control's decision modules, loaded in Node through the template's
 * `dev/modules.js` — the one place that says where they live and what they
 * must stay free of, so `grouping.js` and `widths.js` hold the same rule.
 *
 * Until 0.8.1 this repository carried its own `modules.js` with these four
 * rules built in; the template's took the idea over as `createLoader`, and
 * this file is what is left of the local copy.
 */

'use strict';

const path = require('path');
const { createLoader } = require('./modules.js');

module.exports = {
    load: createLoader({
        root: path.join(__dirname, '..', 'DataTable'),
        forbid: [
            [/^react/, 'React'],
            [/^@fluentui/, 'Fluent'],
            [/components\//, 'the component tree'],
            [/generated\//, 'the generated manifest types'],
        ],
    }),
};
