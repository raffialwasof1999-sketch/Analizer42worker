import { createCipheriv, createHash, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCRIPT_ID = '1OjO2rJxCB6jXC5BMeb-JxyvUx4pcdzwcJh16eHFzJIfGQvo3GJW8doab';
export const PARENT_ID = '1ryLKPxrVoxSVhac7HpVR_l8ARSjn0E65DhTz082PlXY';
export class SafeError extends Error {}

export function credentials(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new SafeError('CLASPRC_JSON is missing or is not valid JSON.'); }
  const selected = value?.tokens?.default;
  const legacy = value?.token && value?.oauth2ClientSettings;
  const c = selected || (legacy ? {
    ...value.token, client_id: value.oauth2ClientSettings.clientId,
    client_secret: value.oauth2ClientSettings.clientSecret,
  } : value);
  if (c?.type && c.type !== 'authorized_user') throw new SafeError('An authorized-user clasp credential is required.');
  if (![c?.client_id, c?.client_secret, c?.refresh_token].every(x => typeof x === 'string' && x.length > 0)) {
    throw new SafeError('The saved clasp credential lacks client configuration or a refresh token.');
  }
  return { client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token };
}

async function request(fetcher, url, options, label) {
  let response;
  try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45000) }); }
  catch { throw new SafeError(`${label}: network request failed; no response content was logged.`); }
  if (!response.ok) {
    // Intentionally do not print response bodies, headers, tokens, or remote messages.
    throw new SafeError(`${label}: HTTP ${response.status}. Check authorization and Apps Script API enablement.`);
  }
  try { return await response.json(); }
  catch { throw new SafeError(`${label}: response was not valid JSON.`); }
}

export async function readProject(raw, fetcher = fetch) {
  const c = credentials(raw);
  const result = await request(fetcher, 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...c, grant_type: 'refresh_token' }).toString(),
  }, 'Google token refresh');
  if (typeof result.access_token !== 'string' || !result.access_token) throw new SafeError('Google returned no access token.');
  const options = { method: 'GET', headers: { Authorization: `Bearer ${result.access_token}` } };
  const base = `https://script.googleapis.com/v1/projects/${SCRIPT_ID}`;
  const project = await request(fetcher, base, options, 'Project metadata read');
  if (project.scriptId !== SCRIPT_ID || project.parentId !== PARENT_ID) {
    throw new SafeError('Target mismatch: the supplied script is not bound to the expected Active Analyzer spreadsheet. No source was exported.');
  }
  const content = await request(fetcher, `${base}/content`, options, 'Project source read');
  if (content.scriptId !== SCRIPT_ID || !Array.isArray(content.files) || content.files.length === 0) {
    throw new SafeError('Project source was empty or the returned Script ID did not match.');
  }
  const files = content.files.map(f => {
    if (typeof f.name !== 'string' || typeof f.source !== 'string' || !['SERVER_JS', 'HTML', 'JSON'].includes(f.type)) {
      throw new SafeError('A source file is invalid or has an unsupported type.');
    }
    return { name: f.name, type: f.type, source: f.source };
  });
  if (!files.some(f => f.name === 'appsscript' && f.type === 'JSON')) throw new SafeError('Project manifest is missing.');
  if (new Set(files.map(f => `${f.type}:${f.name}`)).size !== files.length) throw new SafeError('Duplicate project files were returned.');
  return { project: { scriptId: SCRIPT_ID, parentId: PARENT_ID, title: project.title, updateTime: project.updateTime }, files };
}

export function encryptSource(project, publicKey) {
  const plaintext = Buffer.from(JSON.stringify(project));
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const wrappedKey = publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key);
  key.fill(0);
  return { version: 1, algorithm: 'RSA-OAEP-SHA256+A256GCM', wrappedKey: wrappedKey.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export async function main() {
  const raw = process.env.CLASPRC_JSON;
  delete process.env.CLASPRC_JSON;
  const project = await readProject(raw);
  const encrypted = encryptSource(project, readFileSync('scripts/apps-script-review-public.pem', 'utf8'));
  writeFileSync('apps-script-source.encrypted.json', JSON.stringify(encrypted), { mode: 0o600 });
  const digest = createHash('sha256').update(JSON.stringify(project.files)).digest('hex');
  const message = `Apps Script read-only verification PASSED.\nGoogle refresh token: accepted.\nScript and parent spreadsheet: exact match.\nSource files retrieved: ${project.files.length}.\nSource SHA-256: ${digest}.\nSource exported only as encrypted ciphertext for private review.\nNo Google content, properties, triggers, or deployments were modified.\n`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof SafeError ? error.message : 'Read-only check failed; detailed error suppressed to protect private data.'); process.exitCode = 1; });
}
