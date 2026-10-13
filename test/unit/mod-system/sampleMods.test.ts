import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

// test/unit/mod-system/sampleMods.test.ts
// Every mod shipped in the repository's mods/ directory is Folium 1: its
// manifest validates and the entry files it declares exist. Samples are the
// first thing mod authors copy, so they must never drift from the contract.
//
// They are also normally officially signed, which is what the last suite
// asserts — editing a sample means re-signing it (folium-compound:
// tools/sign.mjs). The private keys are not in this repository, so the two
// entries below are the ones that ship unsigned and are expected to stay that
// way; everything else still has to verify. Adding to this list means taking
// responsibility for explaining why in the comment next to it.

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');
const { verifyModSignature } = require('../../../electron/modSystem/modSignature.cjs');

const MODS_DIR = path.resolve(__dirname, '../../../mods');
const modDirectories = fs.readdirSync(MODS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(MODS_DIR, entry.name));

/*
 * `lyric-ai-director` was edited here to ask through the host's own AI settings
 * (`folium.ai`, Folium 1.5) instead of keeping a credential of its own, which
 * is also why its Node entry is gone. It cannot be re-signed from this
 * repository, so it ships without a signature and the host shows it as
 * "unverified" — the panel still asks the user to confirm before enabling it.
 */
const UNSIGNED_MOD_IDS = new Set(['lyric-ai-director']);

describe('repository sample mods', () => {
    it('has samples to check', () => {
        expect(modDirectories.length).toBeGreaterThan(0);
    });

    it.each(modDirectories.map((directory) => [path.basename(directory), directory]))('%s is a valid Folium 1 mod', (_name, directory) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        const result = validateManifest(manifest);
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok) return;
        if (result.value.main) expect(fs.existsSync(path.join(directory, result.value.main))).toBe(true);
        if (result.value.client) {
            const clientPath = path.join(directory, result.value.client);
            expect(fs.existsSync(clientPath)).toBe(true);
            expect(fs.readFileSync(clientPath, 'utf8')).toMatch(/export default function activate\(folium\)/);
        }
    });

    it.each(modDirectories.map((directory) => [path.basename(directory), directory]))('%s carries a valid official signature', (_name, directory) => {
        const id = path.basename(directory);
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        if (UNSIGNED_MOD_IDS.has(id)) {
            // Unsigned on purpose, but never *mislabelled*: a signature file that
            // does not check out is a worse failure than not having one.
            expect(fs.existsSync(path.join(directory, 'folium.sig.json'))).toBe(false);
            expect(verifyModSignature(directory, manifest)).toMatchObject({ status: 'unsigned' });
            return;
        }
        expect(verifyModSignature(directory, manifest)).toMatchObject({ status: 'verified' });
    });
});
