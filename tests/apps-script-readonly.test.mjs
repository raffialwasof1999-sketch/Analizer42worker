import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { credentials, readProject, encryptSource, SCRIPT_ID, PARENT_ID } from '../scripts/apps-script-readonly.mjs';
const credential = { client_id: 'test-client', client_secret: 'test-secret', refresh_token: 'test-refresh', type: 'authorized_user' };
const raw = JSON.stringify({ tokens: { default: credential } });
const files = [{ name: 'appsscript', type: 'JSON', source: '{}' }, { name: 'Code', type: 'SERVER_JS', source: 'function onOpen() {}' }];
function mock(responses, requests = []) {
  return async (url, options) => {
    requests.push({ url, options });
    const item = responses.shift();
    assert.ok(item, 'No unexpected API request permitted');
    return { ok: !item.error, status: item.error || 200, json: async () => item.body || item };
  };
}
const replies = () => [{ access_token: 'test-access' }, { scriptId: SCRIPT_ID, parentId: PARENT_ID }, { scriptId: SCRIPT_ID, files }];
test('reads modern clasp credentials without returning access token or other identities', () => assert.deepEqual(credentials(raw), { client_id: 'test-client', client_secret: 'test-secret', refresh_token: 'test-refresh' }));
test('supports explicitly configured legacy credentials', () => assert.deepEqual(credentials(JSON.stringify({ token: { refresh_token: 'r' }, oauth2ClientSettings: { clientId: 'c', clientSecret: 's' } })), { client_id: 'c', client_secret: 's', refresh_token: 'r' }));
test('rejects invalid, incomplete and non-user credentials without exposing contents', () => {
  for (const value of ['not-json', '{}', JSON.stringify({ tokens: { other: credential } }), JSON.stringify({ tokens: { default: { ...credential, type: 'service_account' } } })]) {
    assert.throws(() => credentials(value), /CLASPRC_JSON|credential/);
  }
});
test('only refreshes a token and reads the exact authorized Google project', async () => {
  const requests = [];
  const result = await readProject(raw, mock(replies(), requests));
  assert.deepEqual(result.files, files);
  assert.deepEqual(requests.map(x => x.options.method), ['POST', 'GET', 'GET']);
  assert.ok(requests[0].url.startsWith('https://oauth2.googleapis.com/'));
  assert.ok(requests.slice(1).every(x => x.url.startsWith(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}`)));
  assert.ok(requests.every(x => x.options.redirect === 'error'));
});
test('fails before exporting source on a wrong parent', async () => {
  const responses = replies(); responses[1].parentId = 'wrong';
  await assert.rejects(readProject(raw, mock(responses)), /Target mismatch/);
  assert.equal(responses.length, 1);
});
test('rejects empty source', async () => {
  const responses = replies(); responses[2].files = [];
  await assert.rejects(readProject(raw, mock(responses)), /empty/);
});
test('requires full manifest', async () => {
  const responses = replies(); responses[2].files = [files[1]];
  await assert.rejects(readProject(raw, mock(responses)), /manifest/);
});
test('does not expose tokens or API error bodies', async () => {
  await assert.rejects(readProject(raw, mock([{ error: 401, body: { secret: 'sensitive' } }])), e => e.message.includes('401') && !e.message.includes('sensitive'));
});
test('source envelope is authenticated encryption and recoverable by private key only', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const project = { files };
  const envelope = encryptSource(project, publicKey);
  assert.ok(!JSON.stringify(envelope).includes('function onOpen'));
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.wrappedKey, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])), project);
});
