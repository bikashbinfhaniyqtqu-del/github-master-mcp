import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerTokenMatches, getBearerToken } from '../src/auth.js';

const secret = 'this-is-a-test-access-token-that-is-long-enough';

test('extracts a bearer token case-insensitively', () => {
  assert.equal(getBearerToken(`Bearer ${secret}`), secret);
  assert.equal(getBearerToken(`bearer ${secret}`), secret);
  assert.equal(getBearerToken('Basic abc'), '');
});

test('accepts only the exact configured bearer token', () => {
  assert.equal(bearerTokenMatches(`Bearer ${secret}`, secret), true);
  assert.equal(bearerTokenMatches(`Bearer ${secret}x`, secret), false);
  assert.equal(bearerTokenMatches('Bearer wrong-token', secret), false);
  assert.equal(bearerTokenMatches('', secret), false);
});

test('rejects missing or short server access tokens', () => {
  assert.equal(bearerTokenMatches(`Bearer ${secret}`, ''), false);
  assert.equal(bearerTokenMatches(`Bearer ${secret}`, 'too-short'), false);
});
