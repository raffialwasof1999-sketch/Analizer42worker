/**
 * Deploy apps-script/ to the live Active Analyzer Apps Script project.
 *
 * GitHub is the source of truth. A deploy writes only when the live project
 * still matches the previously deployed GitHub version, so an edit made
 * directly in Google's editor is never silently overwritten: the deploy
 * stops and says which files differ. Every write is preceded by a numbered
 * version backup in Google and followed by a read-back check.
 *
 * The project manifest (appsscript.json) is kept as it is live, except for
 * its "webapp" settings, which publish the refresh web app (doGet in
 * Code.gs). After each upload the web app deployment is pointed at the new
 * code. Its address is never logged: this repository is public, and the
 * address alone lets someone trigger a refresh. It is kept in the sheet's
 * private developer metadata (aaRefreshUrl) instead; the deployment is
 * updated in place, so the address stays the same.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { credentials, SafeError, SCRIPT_ID, PARENT_ID } from './apps-script-readonly.mjs';

const TYPES = { '.gs': 'SERVER_JS', '.js': 'SERVER_JS', '.html': 'HTML' };

/** Source files in a directory, as Apps Script API file objects. */
export function localFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap(file => {
    const ext = Object.keys(TYPES).find(e => file.endsWith(e));
    if (!ext) return [];
    return [{ name: file.slice(0, -ext.length), type: TYPES[ext], source: readFileSync(join(dir, file), 'utf8') }];
  });
}

// Google's editor may store CRLF and no final newline; Git stores LF and
// usually a final newline. Neither difference changes how the code runs.
const normalize = source => source.replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** Fingerprint of the code files (manifest excluded), order-independent. */
export function digest(files) {
  const code = files.filter(f => f.type !== 'JSON')
    .map(f => ({ name: f.name, type: f.type, source: normalize(f.source) }))
    .sort((a, b) => (a.type + ':' + a.name).localeCompare(b.type + ':' + b.name));
  return createHash('sha256').update(JSON.stringify(code)).digest('hex');
}

/** Names of code files that differ between two file sets. */
export function changedFiles(a, b) {
  const key = f => f.type + ':' + f.name;
  const map = files => new Map(files.filter(f => f.type !== 'JSON').map(f => [key(f), normalize(f.source)]));
  const ma = map(a), mb = map(b);
  return [...new Set([...ma.keys(), ...mb.keys()])].filter(k => ma.get(k) !== mb.get(k))
    .map(k => k.split(':')[1]).sort();
}

/**
 * What a deploy should do:
 *  - 'in-sync': live already equals the new GitHub version;
 *  - 'deploy':  live equals the previous GitHub version (safe to replace);
 *  - 'drift':   live was changed outside GitHub; do not overwrite.
 */
export function decide({ live, previous, next, overwrite = false }) {
  if (!next.length) throw new SafeError('No Apps Script source files found in apps-script/.');
  if (digest(live) === digest(next)) return 'in-sync';
  if (overwrite) return 'deploy';
  if (previous.length && digest(live) === digest(previous)) return 'deploy';
  return 'drift';
}

async function request(fetcher, url, method, body, token, label) {
  let response;
  try {
    response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(45000),
      headers: token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(body === undefined ? {} : { body: token ? JSON.stringify(body) : body })
    });
  } catch { throw new SafeError(label + ': network failure; no private response logged.'); }
  if (!response.ok) throw new SafeError(label + ': HTTP ' + response.status + '; no private response logged.');
  try { return await response.json(); }
  catch { throw new SafeError(label + ': invalid response; no private content logged.'); }
}

export const WEBAPP = Object.freeze({ executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
export const WEBAPP_DESCRIPTION = 'Active Analyzer refresh (GitHub)';

/** The live manifest with the web app settings set (other keys unchanged). */
export function withWebApp(manifest) {
  let json;
  try { json = JSON.parse(manifest.source); } catch { throw new SafeError('Project manifest is not valid JSON.'); }
  json.webapp = { ...WEBAPP };
  return { ...manifest, source: JSON.stringify(json, null, 2) };
}

/**
 * Point the web app deployment at a new version of the uploaded code,
 * creating it the first time. Returns 'created' or 'updated'; never returns
 * or logs the deployment id (it is the web app's address).
 */
async function publishWebApp(fetcher, base, token, note) {
  const version = await request(fetcher, base + '/versions', 'POST',
    { description: ('GitHub deploy ' + note).trim().slice(0, 200) }, token, 'Web app version');
  if (!Number.isInteger(version.versionNumber)) throw new SafeError('Web app version response invalid.');
  const list = await request(fetcher, base + '/deployments?pageSize=50', 'GET', undefined, token, 'Web app lookup');
  const existing = (list.deployments || []).find(d => d?.deploymentConfig?.description === WEBAPP_DESCRIPTION);
  const config = { scriptId: SCRIPT_ID, versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: WEBAPP_DESCRIPTION };
  if (existing) {
    await request(fetcher, base + '/deployments/' + encodeURIComponent(existing.deploymentId), 'PUT',
      { deploymentConfig: config }, token, 'Web app update');
    return 'updated';
  }
  await request(fetcher, base + '/deployments', 'POST', config, token, 'Web app creation');
  return 'created';
}

function projectFiles(content) {
  if (content?.scriptId !== SCRIPT_ID || !Array.isArray(content.files) || !content.files.length)
    throw new SafeError('Invalid project source returned by Google.');
  const files = content.files.map(f => {
    if (typeof f.name !== 'string' || typeof f.source !== 'string' || !['SERVER_JS', 'HTML', 'JSON'].includes(f.type))
      throw new SafeError('Invalid source file returned by Google.');
    return { name: f.name, type: f.type, source: f.source };
  });
  if (!files.some(f => f.name === 'appsscript' && f.type === 'JSON')) throw new SafeError('Project manifest missing.');
  return files;
}

/**
 * Run a check ('check': read-only) or a deploy. Returns a summary string.
 * `fetcher` is injectable for tests.
 */
export async function run({ raw, next, previous = [], mode = 'deploy', overwrite = false, note = '', fetcher = fetch }) {
  const c = credentials(raw);
  const auth = await request(fetcher, 'https://oauth2.googleapis.com/token', 'POST',
    new URLSearchParams({ ...c, grant_type: 'refresh_token' }).toString(), null, 'Google authorization');
  const token = auth.access_token;
  if (typeof token !== 'string' || !token) throw new SafeError('Google returned no access token.');
  const base = 'https://script.googleapis.com/v1/projects/' + SCRIPT_ID;
  const project = await request(fetcher, base, 'GET', undefined, token, 'Project identity');
  if (project.scriptId !== SCRIPT_ID || project.parentId !== PARENT_ID)
    throw new SafeError('Script or parent spreadsheet mismatch; nothing was written.');
  const live = projectFiles(await request(fetcher, base + '/content', 'GET', undefined, token, 'Live source read'));

  const action = decide({ live, previous, next, overwrite });
  if (action === 'in-sync') return 'The live Apps Script already matches GitHub. Nothing to deploy.';
  if (action === 'drift') {
    const msg = 'The live Apps Script was changed outside GitHub (differs in: ' +
      changedFiles(live, previous.length ? previous : next).join(', ') + '). ' +
      'Copy the live version into apps-script/ first, or rerun the deploy manually with "overwrite live" to replace it.';
    if (mode === 'check') return 'WARNING: ' + msg;
    throw new SafeError(msg + ' Nothing was written.');
  }
  if (mode === 'check') return 'Merging will deploy changes to: ' + changedFiles(live, next).join(', ') + '.';

  const backup = await request(fetcher, base + '/versions', 'POST',
    { description: ('Backup before GitHub deploy ' + note).trim().slice(0, 200) }, token, 'Version backup');
  if (backup.scriptId !== SCRIPT_ID || !Number.isInteger(backup.versionNumber) || backup.versionNumber < 1)
    throw new SafeError('Backup response invalid; nothing was written.');
  const latest = projectFiles(await request(fetcher, base + '/content', 'GET', undefined, token, 'Concurrent edit check'));
  if (digest(latest) !== digest(live)) throw new SafeError('The live script changed during the deploy; nothing was written.');

  const manifest = withWebApp(live.find(f => f.type === 'JSON' && f.name === 'appsscript'));
  const changed = changedFiles(live, next);
  await request(fetcher, base + '/content', 'PUT', { files: [manifest, ...next] }, token, 'Source upload');
  const after = projectFiles(await request(fetcher, base + '/content', 'GET', undefined, token, 'Post-upload verification'));
  if (digest(after) !== digest(next))
    throw new SafeError('Post-upload source differs from GitHub; restore backup version ' + backup.versionNumber + ' in Project history if needed.');
  let webapp;
  try { webapp = 'Refresh web app ' + await publishWebApp(fetcher, base, token, note) + '.'; }
  catch (error) { webapp = 'WARNING: the code deployed, but the refresh web app was not updated (' +
    (error instanceof SafeError ? error.message : 'details suppressed') + ').'; }
  return 'Deployed to the live Apps Script: ' + changed.join(', ') +
    '. Backup saved in Google as version ' + backup.versionNumber + ' (Project history). ' + webapp;
}

async function main() {
  const raw = process.env.CLASPRC_JSON;
  delete process.env.CLASPRC_JSON;
  const summary = await run({
    raw,
    next: localFiles(process.env.NEXT_DIR || 'apps-script'),
    previous: localFiles(process.env.PREVIOUS_DIR),
    mode: process.env.MODE === 'check' ? 'check' : 'deploy',
    overwrite: process.env.OVERWRITE === 'true',
    note: process.env.NOTE || ''
  });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  // Annotations stay visible on the pull request and commit.
  console.log(summary.includes('WARNING') ? '::warning title=Apps Script::' + summary
    : '::notice title=Apps Script::' + summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('::error title=Apps Script deploy::' + (error instanceof SafeError ? error.message : 'Deploy failed; details suppressed to protect private data.'));
    process.exitCode = 1;
  });
}
