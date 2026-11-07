import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dedicated managed Vite entry; can serve either baseline or fixed worktree without source edits.
const args = process.argv.slice(2);
const arg = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = path.resolve(arg('--root', process.cwd()));
const probeRoot = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const strokes = arg('--strokes', null);
const port = Number(arg('--port', '4317'));
const server = await createServer({
    root, configFile: path.join(root, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root, probeRoot] } },
    plugins: [{
        name: 'nebbia-manual-data',
        enforce: 'pre',
        configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
                if (req.url?.split('?')[0] === '/test/manual/nebbiaMobile.html') {
                    const html = await vite.transformIndexHtml(req.url, fs.readFileSync(path.join(probeRoot, 'nebbiaMobile.html'), 'utf8'));
                    res.setHeader('Content-Type', 'text/html');
                    res.end(html);
                    return;
                }
                if (req.url?.split('?')[0] !== '/nebbia-strokes.json' || strokes === 'native') return next();
                res.setHeader('Content-Type', 'application/json');
                if (strokes) res.end(fs.readFileSync(path.resolve(strokes)));
                else { res.statusCode = 404; res.end('null'); }
            });
        },
    }],
});
await server.listen();
console.log(`[Nebbia probe] root=${root} strokes=${strokes ?? 'production fallback (404)'} url=http://127.0.0.1:${port}/test/manual/nebbiaMobile.html`);
const close = async () => { await server.close(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
