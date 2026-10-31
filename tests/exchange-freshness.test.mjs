import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

test('exchange is hidden during refresh and after failed imports', () => {
  assert.match(
    source,
    /SEC REFRESHING — valuations hidden[\s\S]*?getRange\(AA\.exchangeCell\)\.clearContent\(\)/
  );
  assert.match(
    source,
    /function aaShowFailedImport_[\s\S]*?getRange\(AA\.exchangeCell\)\.clearContent\(\)/
  );
});

test('successful refresh writes exchange in uppercase', () => {
  assert.match(
    source,
    /getRange\(AA\.exchangeCell\)[\s\S]*?setValue\(String\(p\.exchange\|\|''\)\.trim\(\)\.toUpperCase\(\)\)/
  );
});
