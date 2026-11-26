import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidEndpoint, normalizeEndpoint } from '../src/endpoint.js';
import { USAGE_ENDPOINT } from '../src/constants.js';

test('accepts the official HTTPS endpoint', () => {
    assert.equal(isValidEndpoint(USAGE_ENDPOINT), true);
    assert.equal(normalizeEndpoint(USAGE_ENDPOINT), USAGE_ENDPOINT);
});

test('accepts http endpoints and paths', () => {
    assert.equal(isValidEndpoint('http://127.0.0.1:8080/v1/usage'), true);
    assert.equal(isValidEndpoint('https://example.com/proxy/go?x=1#frag'), true);
});

test('rejects malformed endpoints', () => {
    assert.equal(isValidEndpoint(''), false);
    assert.equal(isValidEndpoint('example.com/v1/usage'), false);
    assert.equal(isValidEndpoint('ftp://example.com/usage'), false);
    assert.equal(isValidEndpoint('https://'), false);
    assert.equal(isValidEndpoint('https://example.com/has space'), false);
});

test('normalizes whitespace and invalid values', () => {
    assert.equal(
        normalizeEndpoint('  https://example.com/usage  '),
        'https://example.com/usage'
    );
    assert.equal(normalizeEndpoint(''), USAGE_ENDPOINT);
    assert.equal(normalizeEndpoint('not-a-url'), USAGE_ENDPOINT);
});
