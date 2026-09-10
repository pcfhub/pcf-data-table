/*
 * Serves the repository so `dev/preview.html` can load the built bundle.
 *
 *     npm run build && npm run preview
 *
 * **This is not the template's `dev/serve.js`, and that is a gap rather than a
 * decision.** The template ships `serve.js` alongside `dev/harness.html` — an
 * interactive stand-in for a host, with switches for field-level security, a
 * missing theme, right-to-left and the rest — and this repository has never
 * adopted either. Its `serve.js` exits when `harness.html` is absent, correctly,
 * so it cannot be copied in on its own.
 *
 * What lives here instead is the narrower job: serve the repository so the
 * *capture* page can render. Adopting the template's harness is worth doing and
 * is not this change; when it happens, this file should be deleted in favour of
 * the template's.
 *
 * **Why a server at all, when `preview.html` is a plain file.** Over `file://`
 * a `fetch` of `demo/records.json` is refused as a cross-origin read against a
 * `null` origin — quietly, as an empty control and a CORS line in a console
 * nobody has open. The preview renders the demo fixture, so it needs `http://`.
 *
 * No dependency: `node:http` and nothing else, in a `dev/` that has none.
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = path.join(__dirname, 'preview.html');

if (!fs.existsSync(page)) {
    console.error('\n  No dev/preview.html in this repository.\n');
    process.exit(1);
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

const args = process.argv.slice(2);
const at = args.indexOf('--port');
const port = Number(at !== -1 ? args[at + 1] : process.env.PORT) || 8080;

const server = http.createServer((request, response) => {
    /*
     * Parsed rather than string-sliced, and that is the security-relevant line
     * in this file — lifted from the template's `serve.js`, which explains it at
     * length. `URL` applies the standard's own path normalisation, which
     * resolves `..` **and** its percent-encoded spellings, so
     * `/%2e%2e/%2e%2e/package.json` arrives as `/package.json`. Do not simplify
     * it into a `split('?')`.
     */
    const url = new URL(request.url, 'http://localhost');
    const requested = url.pathname === '/' ? '/dev/preview.html' : url.pathname;
    const file = path.join(root, decodeURIComponent(requested));

    // Second line of defence, after normalisation: nothing outside the repo.
    if (!file.startsWith(root + path.sep) && file !== root) {
        response.writeHead(403).end('Outside the repository.');

        return;
    }

    fs.readFile(file, (error, content) => {
        if (error) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end(
                `Not found: ${requested}\n\n`
                + 'If this is the control bundle, run `npm run build` first.\n',
            );

            return;
        }

        response.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            // A cached bundle is a screenshot of the previous build, which is
            // the worst way to find out a change did not take.
            'Cache-Control': 'no-store',
        });
        response.end(content);
    });
});

server.listen(port, '127.0.0.1', () => {
    const base = `http://localhost:${port}/dev/preview.html`;

    console.log(`\n  Preview:  ${base}`);
    console.log(`  Pinned:   ${base}?fixture=demo&pinStart=1&pinEnd=1&scroll=400`);
    console.log(`  Editing:  ${base}?fixture=demo&edit=1&open=1\n`);
    console.log('  Rebuild with `npm run build`, then reload. Ctrl+C to stop.\n');
});
