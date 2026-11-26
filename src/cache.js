// Small on-disk cache so the panel can show the last known values while
// offline or immediately after login. It contains no secrets.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { CACHE_VERSION } from './constants.js';
import { parseUsagePayload } from './usage.js';

const CACHE_DIR_NAME = 'opencode-go-usage-v2';
const CACHE_FILE_NAME = 'usage.json';

export function cacheDirectory() {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), CACHE_DIR_NAME]);
}

export function cachePath() {
    return GLib.build_filenamev([cacheDirectory(), CACHE_FILE_NAME]);
}

function normalizedNotified(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};

    const result = {};
    for (const [key, timestamp] of Object.entries(value)) {
        if (typeof key === 'string' && Number.isFinite(Number(timestamp)))
            result[key] = Number(timestamp);
    }
    return result;
}

export function loadCache(endpoint = null) {
    return new Promise(resolve => {
        const file = Gio.File.new_for_path(cachePath());
        file.load_contents_async(null, (source, result) => {
            try {
                const [, contents] = source.load_contents_finish(result);
                const text = new TextDecoder('utf-8').decode(contents);
                const data = JSON.parse(text);

                if (data?.version !== CACHE_VERSION)
                    return resolve(null);

                const fetchedAt = Number(data.fetchedAt);
                if (!Number.isFinite(fetchedAt) || fetchedAt <= 0)
                    return resolve(null);

                if (endpoint && data.endpoint !== endpoint)
                    return resolve(null);

                const usage = parseUsagePayload(data.usage);
                resolve({
                    fetchedAt,
                    usage,
                    notified: normalizedNotified(data.notified),
                });
            } catch {
                resolve(null);
            }
        });
    });
}

export function saveCache({ endpoint, fetchedAt, usage, notified = {} }) {
    try {
        GLib.mkdir_with_parents(cacheDirectory(), 0o700);
        const payload = JSON.stringify({
            version: CACHE_VERSION,
            endpoint,
            fetchedAt,
            usage,
            notified: normalizedNotified(notified),
        });
        const ok = GLib.file_set_contents(cachePath(), payload);
        if (ok) {
            try {
                GLib.chmod(cachePath(), 0o600);
            } catch {
                // Best effort only.
            }
        }
        return ok;
    } catch (error) {
        console.warn(`[opencode-go-usage-v2] failed to save cache: ${error.message}`);
        return false;
    }
}

export function clearCache() {
    try {
        const file = Gio.File.new_for_path(cachePath());
        file.delete(null);
    } catch {
        // ENOENT and permission errors are both harmless here.
    }
}
