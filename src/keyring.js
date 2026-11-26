// API key storage backed by the freedesktop Secret Service (GNOME Keyring).
// The key is never written to GSettings or the extension cache.

import Secret from 'gi://Secret';

import { SETTINGS_SCHEMA } from './constants.js';

const ATTRIBUTE = 'provider';
const ATTRIBUTE_VALUE = 'opencode-go';
const LABEL = 'OpenCode Go API key';

let schema = null;

function getSchema() {
    if (!schema) {
        schema = new Secret.Schema(
            SETTINGS_SCHEMA,
            Secret.SchemaFlags.NONE,
            { [ATTRIBUTE]: Secret.SchemaAttributeType.STRING }
        );
    }
    return schema;
}

function attributes() {
    return { [ATTRIBUTE]: ATTRIBUTE_VALUE };
}

export function lookupApiKey(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(
            getSchema(),
            attributes(),
            cancellable,
            (source, result) => {
                try {
                    resolve(Secret.password_lookup_finish(result) ?? null);
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

export function storeApiKey(apiKey, cancellable = null) {
    const key = String(apiKey ?? '').trim();
    if (!key)
        return Promise.reject(new Error('API 密钥不能为空'));

    return new Promise((resolve, reject) => {
        Secret.password_store(
            getSchema(),
            attributes(),
            Secret.COLLECTION_DEFAULT,
            LABEL,
            key,
            cancellable,
            (source, result) => {
                try {
                    resolve(Secret.password_store_finish(result));
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

export function clearApiKey(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(
            getSchema(),
            attributes(),
            cancellable,
            (source, result) => {
                try {
                    resolve(Secret.password_clear_finish(result));
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}
