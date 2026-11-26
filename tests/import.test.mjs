import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseAuthExport,
    pickGoCredential,
    importGoCredentialFromExport,
} from '../src/import.js';

const accounts = [
    {
        id: 'cred_1',
        integrationID: 'opencode-go',
        label: 'OpenCode Go',
        active: false,
        value: { type: 'key', key: 'test-key-old-000000' },
    },
    {
        id: 'cred_2',
        integrationID: 'opencode-go',
        label: 'OpenCode Go 2',
        active: true,
        value: { type: 'key', key: 'test-key-active-1111' },
    },
    {
        id: 'cred_3',
        integrationID: 'opencode',
        label: 'Personal',
        active: true,
        value: { type: 'oauth', access: 'secret' },
    },
];

test('parses an auth export array', () => {
    const parsed = parseAuthExport(JSON.stringify(accounts));
    assert.equal(parsed.length, 3);
});

test('parses an export wrapped in a credentials object', () => {
    const parsed = parseAuthExport({ credentials: accounts });
    assert.equal(parsed.length, 3);
});

test('prefers the active Go credential', () => {
    const credential = pickGoCredential(accounts);
    assert.equal(credential.key, 'test-key-active-1111');
    assert.equal(credential.label, 'OpenCode Go 2');
    assert.equal(credential.active, true);
});

test('uses a single inactive Go credential', () => {
    const only = pickGoCredential([accounts[0]]);
    assert.equal(only.key, 'test-key-old-000000');
    assert.equal(only.active, false);
});

test('refuses ambiguous credentials without an active one', () => {
    assert.throws(
        () => pickGoCredential([accounts[0], {
            ...accounts[0],
            id: 'cred_4',
            label: 'Other',
            value: { type: 'key', key: 'test-key-other' },
        }]),
        /多个 Go 密钥/
    );
});

test('reports when no Go key exists', () => {
    assert.throws(() => pickGoCredential([accounts[2]]), /没有找到/);
    assert.throws(() => importGoCredentialFromExport('{}'), /未知格式/);
    assert.throws(() => importGoCredentialFromExport('not json'), /无法解析/);
});
