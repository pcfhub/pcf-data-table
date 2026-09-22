/*
 * Load the **pure** modules — the ones that decide things — straight from
 * TypeScript, so a suite can assert them without a bundle and without the
 * control around them.
 *
 * Why this exists here, when 130 assertions already drive the built bundle
 * -------------------------------------------------------------------------
 * The bundle suite is the right tool for anything the platform touches: it
 * loads what a form loads, webpack and the externals and the manifest
 * included. But grouping's hardest parts are *strings and arithmetic* —
 * `aggregateFetchXml`'s exact query text, `filterToFetchXml`'s decision that a
 * filter is untranslatable, `toGroupReading`'s handling of an omitted alias.
 * Reaching those through the control means building the whole feature first
 * and then asserting them at one remove, through props, where a wrong query
 * looks like a missing group.
 *
 * So these are driven directly. `pcf-code-editor` established the shape for a
 * bundle that *cannot* load in Node; the same shape is worth having for
 * modules that do not need it to.
 *
 * **The boundary is enforced, not trusted.** A module loaded here may import
 * other pure modules and nothing else: an import of `react`, of anything under
 * `components/`, or of a platform global throws by name. That is what keeps
 * "pure" true a year from now, when somebody needs one small thing from
 * `context` and the file has no reason left not to have it.
 *
 * **Mutation-testing that boundary has a trap in it.** Adding
 * `import * as React from 'react'` to a pure module and expecting a throw gets
 * you a clean load instead, and it looks exactly like a guard that does not
 * work. It is not: TypeScript **elides an import nothing uses**, so the
 * transpiled output contains no `require` at all and there is nothing to
 * catch. Use the import — `export const leak = React;` — and it throws. The
 * guard covers real usage, which is the thing worth covering, and it was
 * verified that way on 2026-09-20 rather than assumed.
 *
 * What passing here does NOT mean: that `index.ts` asked the right question.
 * These functions can be perfect and the control can still call them with the
 * wrong column. That half stays with the bundle suite and with SPEC.md's
 * *Not verified*.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const src = path.join(root, 'DataTable');

/** Imports a decision module may not make, and what to say when it does. */
const FORBIDDEN = [
    [/^react/, 'React'],
    [/^@fluentui/, 'Fluent'],
    [/components\//, 'the component tree'],
    [/generated\//, 'the generated manifest types'],
];

const cache = new Map();

/**
 * Transpile one `.ts` under `DataTable/` and evaluate it as its own CommonJS
 * module. Relative imports come back through here, so the whole reachable
 * graph gets the same treatment and the same refusals.
 *
 * `name` is the path under `DataTable/` without the extension —
 * `load('query/fetchXml')`.
 */
function load(name) {
    if (cache.has(name)) {
        return cache.get(name).exports;
    }

    const file = path.join(src, name + '.ts');

    if (!fs.existsSync(file)) {
        throw new Error('dev/modules.js: no such module ' + name + '.ts');
    }

    const source = fs.readFileSync(file, 'utf8');
    const { outputText, diagnostics } = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            esModuleInterop: true,
        },
        reportDiagnostics: true,
    });

    if (diagnostics && diagnostics.length > 0) {
        throw new Error(
            name + '.ts: ' + diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'),
        );
    }

    const mod = new Module(file, module);

    mod.filename = file;
    mod.paths = Module._nodeModulePaths(src);
    cache.set(name, mod);

    mod.require = function (request) {
        for (const [pattern, what] of FORBIDDEN) {
            if (pattern.test(request)) {
                throw new Error(
                    name + '.ts imports ' + request + ' — a decision module must stay free of ' + what +
                    '. Move the decision out, or assert it through dev/smoke.js instead.',
                );
            }
        }

        if (request.startsWith('.')) {
            // Resolve relative to this module's own directory, so
            // `query/rows.ts` importing `../group/types` lands correctly.
            const resolved = path.relative(src, path.resolve(path.dirname(file), request)).replace(/\\/g, '/');

            return load(resolved);
        }

        return Module.prototype.require.call(this, request);
    };

    mod._compile(outputText, file);

    return mod.exports;
}

module.exports = { load };
