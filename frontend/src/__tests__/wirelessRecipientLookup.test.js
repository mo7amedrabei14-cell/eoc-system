import test from 'node:test';
import assert from 'node:assert/strict';
import { findWirelessRecipient, normalizeWirelessNationalId } from '../wirelessRecipientLookup.js';

const id = '29801011234567';

test('normalizes Arabic and Persian digits', () => {
  assert.equal(normalizeWirelessNationalId('٢٩٨٠١٠١١٢٣٤٥٦٧'), id);
  assert.equal(normalizeWirelessNationalId('۲۹۸۰۱۰۱۱۲۳۴۵۶۷'), id);
});

test('normalizes spaces and separators', () => {
  assert.equal(normalizeWirelessNationalId('2980 101 123-4567'), id);
});

test('matches an exact normalized ID', () => {
  const person = { full_name: 'Test Person', national_id: id, employee_number: 'ERC-01' };
  assert.equal(findWirelessRecipient([{ ...person, national_id: '29801011234568' }, person], id), person);
});

test('rejects partial or different IDs', () => {
  const rows = [{ national_id: id }];
  assert.equal(findWirelessRecipient(rows, id.slice(0, 13)), null);
  assert.equal(findWirelessRecipient(rows, '29801011234568'), null);
});

test('handles invalid ID and invalid collection shapes', () => {
  assert.equal(findWirelessRecipient([], '123'), null);
  assert.equal(findWirelessRecipient(null, id), null);
  assert.equal(findWirelessRecipient([{ national_id: 'not-an-id' }], id), null);
});
