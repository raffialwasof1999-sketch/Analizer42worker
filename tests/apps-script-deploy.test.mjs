import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localFiles, digest, decide, changedFiles, run, withoutWebApp, RETIRED_WEBAPP } from '../scripts/apps-script-deploy.mjs';
import { SCRIPT_ID, PARENT_ID } from '../scripts/apps-script-readonly.mjs';

const manifest = { name: 'appsscript', type: 'JSON', source: '{"timeZone":"America/Los_Angeles"}' };
const code = src => ({ name: 'Code', type: 'SERVER_JS', source: src });
const html = src => ({ name: 'TickerSearch2', type: 'HTML', source: src });
const raw = JSON.stringify({ tokens: { default: { client_id: 'id', client_secret: 's', refresh_token: 'r', type: 'authorized_user' } } });

// Simulated Google: tracks the live project, versions and uploads.
function google(liveFiles, { mangleUpload = false, deployments = [], liveManifest = manifest } = {}) {
  const state = { live: [liveManifest, ...liveFiles], versions: 0, uploads: [], deleted: [] };
  const fetcher = async (url, opts) => {
    const reply = body => ({ ok: true, json: async () => body });
    if (url.includes('oauth2')) return reply({ access_token: 't' });
    if (url.includes('/deployments')) {
      if (opts.method === 'DELETE') { state.deleted.push(url.split('/deployments/')[1]); return { ok: true, json: async () => { throw Error('empty'); } }; }
      return reply({ deployments });
    }
    if (url.endsWith('/versions')) { state.versions++; return reply({ scriptId: SCRIPT_ID, versionNumber: 40 + state.versions }); }
    if (url.endsWith('/content') && opts.method === 'PUT') {
      const files = JSON.parse(opts.body).files;
      state.uploads.push(files);
      state.live = mangleUpload ? files.map(f => ({ ...f, source: f.source + ' x' })) : files;
      return reply({ scriptId: SCRIPT_ID, files: state.live });
    }
    if (url.endsWith('/content')) return reply({ scriptId: SCRIPT_ID, files: state.live });
    return reply({ scriptId: SCRIPT_ID, parentId: PARENT_ID });
  };
  return { state, fetcher };
}

test('reads .gs and .html files, ignores README; line endings do not matter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-'));
  writeFileSync(join(dir, 'Code.gs'), 'a\nb\n');
  writeFileSync(join(dir, 'TickerSearch2.html'), '<p>');
  writeFileSync(join(dir, 'README.md'), '# docs');
  const files = localFiles(dir);
  assert.deepEqual(files.map(f => [f.name, f.type]), [['Code', 'SERVER_JS'], ['TickerSearch2', 'HTML']]);
  assert.equal(digest([code('a\r\nb')]), digest([code('a\nb\n')]));
  assert.equal(digest([manifest, code('a')]), digest([code('a')]));      // manifest excluded
  assert.deepEqual(localFiles(join(dir, 'missing')), []);
});

test('decide: in sync, safe deploy, or drift', () => {
  const v1 = [code('v1')], v2 = [code('v2')], edited = [code('edited in Google')];
  assert.equal(decide({ live: v1, previous: [], next: v1 }), 'in-sync');
  assert.equal(decide({ live: v1, previous: v1, next: v2 }), 'deploy');
  assert.equal(decide({ live: edited, previous: v1, next: v2 }), 'drift');
  assert.equal(decide({ live: edited, previous: [], next: v2 }), 'drift');
  assert.equal(decide({ live: edited, previous: v1, next: v2, overwrite: true }), 'deploy');
  assert.deepEqual(changedFiles([code('a'), html('x')], [code('b'), html('x')]), ['Code']);
});

test('deploy backs up, uploads GitHub code, keeps the manifest, verifies', async () => {
  const g = google([code('v1'), html('h')]);
  const msg = await run({ raw, previous: [code('v1'), html('h')], next: [code('v2'), html('h')], fetcher: g.fetcher });
  assert.match(msg, /Deployed to the live Apps Script: Code\. Backup saved in Google as version 41/);
  assert.equal(g.state.versions, 1);
  assert.deepEqual(g.state.uploads[0], [manifest, code('v2'), html('h')]);
});

test('already in sync: nothing written', async () => {
  const g = google([code('v2\r\n')]);
  const msg = await run({ raw, previous: [code('v1')], next: [code('v2\n')], fetcher: g.fetcher });
  assert.match(msg, /already matches/);
  assert.equal(g.state.versions + g.state.uploads.length, 0);
});

test('an edit made in Google is never overwritten without being asked', async () => {
  const g = google([code('edited in Google')]);
  await assert.rejects(run({ raw, previous: [code('v1')], next: [code('v2')], fetcher: g.fetcher }),
    /changed outside GitHub \(differs in: Code\).*Nothing was written/);
  assert.equal(g.state.versions + g.state.uploads.length, 0);
  const check = await run({ raw, previous: [code('v1')], next: [code('v2')], mode: 'check', fetcher: g.fetcher });
  assert.match(check, /^WARNING: The live Apps Script was changed outside GitHub/);
  const forced = await run({ raw, previous: [code('v1')], next: [code('v2')], overwrite: true, fetcher: g.fetcher });
  assert.match(forced, /Deployed/);
  assert.equal(g.state.versions, 1);                                     // still backed up first
});

test('check mode is read-only', async () => {
  const g = google([code('v1')]);
  const msg = await run({ raw, previous: [code('v1')], next: [code('v2')], mode: 'check', fetcher: g.fetcher });
  assert.equal(msg, 'Merging will deploy changes to: Code.');
  assert.equal(g.state.versions + g.state.uploads.length, 0);
});

test('a read-back mismatch fails loudly and names the backup', async () => {
  const g = google([code('v1')], { mangleUpload: true });
  await assert.rejects(run({ raw, previous: [code('v1')], next: [code('v2')], fetcher: g.fetcher }),
    /restore backup version 41/);
});

test('the retired refresh web app is deleted and its manifest setting removed; nothing else changes', async () => {
  const live = { ...manifest, source: '{"timeZone":"America/Los_Angeles","webapp":{"executeAs":"USER_DEPLOYING","access":"ANYONE_ANONYMOUS"}}' };
  const g = google([code('v1')], { liveManifest: live, deployments: [
    { deploymentId: 'SECRET-ID', deploymentConfig: { description: RETIRED_WEBAPP } },
    { deploymentId: 'keep', deploymentConfig: { description: 'something else' } }] });
  const msg = await run({ raw, previous: [code('v1')], next: [code('v2')], fetcher: g.fetcher });
  assert.match(msg, /Retired refresh web app removed\./);
  assert.deepEqual(g.state.deleted, ['SECRET-ID']);
  assert.ok(!msg.includes('SECRET-ID'));
  assert.deepEqual(JSON.parse(g.state.uploads[0][0].source), { timeZone: 'America/Los_Angeles' });
  assert.equal(withoutWebApp(manifest), manifest);                       // no webapp: untouched
});
