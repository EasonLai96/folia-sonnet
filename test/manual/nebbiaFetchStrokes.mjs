import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NEBBIA_PROBE_CASES, NEBBIA_STROKE_COMMIT } from './nebbiaFixtures.ts';

// Optional second arm only: pin actual AnimCJK medians and preserve provenance/license documents.
const out = path.resolve(process.argv[2] ?? '../artifacts/nebbia-mobile-20261107/baseline/stroke-data');
await fs.mkdir(out, { recursive: true });
const wanted = new Set(Object.values(NEBBIA_PROBE_CASES).flat().join(''));
const data = {};
const provenance = [];
for (const name of ['graphicsZhHant.txt', 'graphicsZhHans.txt']) {
    const url = `https://raw.githubusercontent.com/parsimonhi/animCJK/${NEBBIA_STROKE_COMMIT}/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const source = await response.text();
    provenance.push({ url, sha256: createHash('sha256').update(source).digest('hex') });
    for (const line of source.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        const glyph = JSON.parse(line);
        if (!wanted.has(glyph.character) || data[glyph.character] || !glyph.medians) continue;
        // AnimCJK graphics medians use y-up coordinates; runtime requires y-down (0..1024).
        data[glyph.character] = glyph.medians.map(stroke => stroke.map(([x, y]) => [x, 900 - y]));
    }
    console.log(`[Nebbia strokes] ${name} covered=${Object.keys(data).length}/${wanted.size}`);
}
const licenseListing = await fetch(`https://api.github.com/repos/parsimonhi/animCJK/contents/licenses?ref=${NEBBIA_STROKE_COMMIT}`).then(response => response.json());
for (const entry of licenseListing) {
    if (entry.type !== 'file' || !entry.download_url) continue;
    const response = await fetch(entry.download_url);
    if (!response.ok) throw new Error(`License download failed ${entry.name}`);
    await fs.writeFile(path.join(out, `license-${entry.name}`), await response.text());
}
const serialized = JSON.stringify(data);
await fs.writeFile(path.join(out, 'nebbia-strokes.json'), serialized);
await fs.writeFile(path.join(out, 'provenance.json'), JSON.stringify({ commit: NEBBIA_STROKE_COMMIT, testSuppliedData: true, coordinateTransform: '[x,900-y] from graphics y-up to runtime y-down', provenance, wanted: [...wanted], missing: [...wanted].filter(ch => !data[ch]), outputSha256: createHash('sha256').update(serialized).digest('hex') }, null, 2));
