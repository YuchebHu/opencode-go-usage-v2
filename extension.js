// OpenCode Go quota indicator for the GNOME top bar.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { UsageIndicator } from './src/ui/indicator.js';
import { createSession, fetchUsage } from './src/api.js';
import { lookupApiKey, storeApiKey } from './src/keyring.js';
import { loadCache, saveCache, clearCache } from './src/cache.js';
import { ApiError, isCancelledError, keyringError } from './src/errors.js';
import { planNotifications } from './src/notifications.js';
import { importFromOpencode } from './src/opencode.js';
import { normalizeEndpoint } from './src/endpoint.js';
import { USAGE_ENDPOINT } from './src/constants.js';

const LOG_PREFIX = '[opencode-go-usage-v2]';

export default class OpenCodeGoUsageExtension extends Extension {
    enable() {
        this._destroyed = false;
        this._generation = 0;
        this._initializing = false;
        this._refreshing = false;
        this._lastAttemptAt = 0;
        this._apiKey = null;
        this._usage = null;
        this._fetchedAt = 0;
        this._error = null;
        this._notified = {};
        this._refreshTimerId = 0;

        this._settings = this.getSettings();
        this._session = createSession();
        this._cancellable = new Gio.Cancellable();

        this._indicator = new UsageIndicator({
            settings: this._settings,
            onRefresh: () => this._refresh({ force: true }),
            onOpenSettings: () => this._openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        this._settings.connectObject(
            'changed::refresh-interval',
            () => {
                this._scheduleRefresh();
                this._indicator?.updateSettings();
            },
            this
        );
        this._settings.connectObject(
            'changed::panel-metric',
            () => this._indicator?.updateSettings(),
            this
        );
        this._settings.connectObject(
            'changed::show-percentage',
            () => this._indicator?.updateSettings(),
            this
        );
        this._settings.connectObject(
            'changed::credentials-revision',
            () => this._onCredentialsChanged(),
            this
        );
        this._settings.connectObject(
            'changed::endpoint',
            () => this._onEndpointChanged(),
            this
        );
        this._settings.connectObject(
            'changed::auto-import-key',
            () => {
                if (this._settings.get_boolean('auto-import-key') && !this._apiKey) {
                    this._initializing = false;
                    this._refreshing = false;
                    this._lastAttemptAt = 0;
                    this._initialize();
                }
            },
            this
        );

        this._scheduleRefresh();
        this._initialize();
    }

    disable() {
        this._destroyed = true;
        this._generation++;

        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = 0;
        }

        try {
            this._cancellable?.cancel();
        } catch {
            // Ignore a cancelled/dead cancellable.
        }

        try {
            this._settings?.disconnectObject(this);
        } catch {
            // Older GJS versions without connectObject support.
        }

        try {
            this._session?.abort();
        } catch {
            // Ignore.
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._session = null;
        this._settings = null;
        this._cancellable = null;
    }

    _scheduleRefresh() {
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = 0;
        }

        const minutes = Math.max(1, this._settings?.get_int('refresh-interval') ?? 5);
        this._refreshTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            minutes * 60,
            () => {
                this._refresh({ force: false });
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    async _initialize() {
        if (this._destroyed || this._initializing)
            return;

        this._initializing = true;
        const generation = ++this._generation;

        try {
            this._cancellable?.cancel();
        } catch {
            // Ignore.
        }
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._lastAttemptAt = 0;
        this._apiKey = null;
        this._usage = null;
        this._fetchedAt = 0;
        this._error = null;
        this._notified = {};

        if (this._indicator) {
            this._indicator.setKeyPresent(false);
            this._indicator.setUsage(null, 0);
            this._indicator.setError(null);
            this._indicator.setLoading(true);
        }

        try {
            let apiKey = null;
            try {
                apiKey = await lookupApiKey(this._cancellable);
            } catch (error) {
                if (this._destroyed || generation !== this._generation)
                    return;
                const wrapped = keyringError(
                    `无法访问系统密钥环：${error?.message ?? String(error)}`
                );
                this._error = wrapped;
                this._indicator?.setKeyPresent(false);
                this._indicator?.setLoading(false);
                this._indicator?.setError(wrapped);
                return;
            }

            if (this._destroyed || generation !== this._generation)
                return;

            if (!apiKey && this._settings.get_boolean('auto-import-key')) {
                clearCache();
                try {
                    const credential = await importFromOpencode(this._cancellable);
                    if (this._destroyed || generation !== this._generation)
                        return;

                    apiKey = credential.key;
                    try {
                        await storeApiKey(apiKey, this._cancellable);
                    } catch (error) {
                        // The key still works for this session; it just won't
                        // survive a restart if the keyring is unavailable.
                        console.warn(`${LOG_PREFIX} could not save auto-imported key: ${error.message}`);
                    }
                    if (this._destroyed || generation !== this._generation)
                        return;
                } catch (error) {
                    if (this._destroyed || generation !== this._generation ||
                        this._cancellable?.is_cancelled()) {
                        return;
                    }
                    // No opencode CLI / no active Go credential. Show setup.
                }
            }

            if (!apiKey) {
                clearCache();
                this._indicator?.setLoading(false);
                this._indicator?.setKeyPresent(false);
                this._indicator?.setError(null);
                return;
            }

            this._apiKey = apiKey.trim();
            this._indicator?.setKeyPresent(true);

            const cached = await loadCache(this._usageEndpoint());
            if (this._destroyed || generation !== this._generation)
                return;

            if (cached) {
                this._usage = cached.usage;
                this._fetchedAt = cached.fetchedAt;
                this._notified = cached.notified;
                this._indicator?.setUsage(cached.usage, cached.fetchedAt);
            }

            await this._refresh({ generation });
        } finally {
            if (generation === this._generation)
                this._initializing = false;
        }
    }

    async _refresh({ force = false, generation = this._generation } = {}) {
        if (this._destroyed || generation !== this._generation || this._refreshing)
            return;

        if (!this._apiKey) {
            if (force || this._error?.code === 'keyring') {
                this._initializing = false;
                await this._initialize();
            }
            return;
        }

        const now = Date.now();
        if (now - this._lastAttemptAt < 1000)
            return;

        this._lastAttemptAt = now;
        this._refreshing = true;
        this._error = null;

        this._indicator?.setLoading(true);
        this._indicator?.setError(null);

        try {
            const usage = await fetchUsage(this._apiKey, {
                session: this._session,
                cancellable: this._cancellable,
                endpoint: this._usageEndpoint(),
            });

            if (this._destroyed || generation !== this._generation)
                return;

            this._usage = usage;
            this._fetchedAt = Date.now();
            this._error = null;

            this._indicator?.setUsage(usage, this._fetchedAt);
            this._indicator?.setError(null);

            this._handleNotifications(usage);
            this._saveCache();
        } catch (error) {
            if (this._destroyed || generation !== this._generation || isCancelledError(error))
                return;

            this._error = error instanceof ApiError
                ? error
                : new ApiError(error?.message ?? String(error), { code: 'unknown' });
            this._indicator?.setError(this._error);
            console.warn(`${LOG_PREFIX} refresh failed: ${this._error.message}`);
        } finally {
            if (generation === this._generation) {
                this._refreshing = false;
                this._indicator?.setLoading(false);
            }
        }
    }

    _usageEndpoint() {
        try {
            return normalizeEndpoint(this._settings.get_string('endpoint'));
        } catch {
            return USAGE_ENDPOINT;
        }
    }

    _onEndpointChanged() {
        if (this._destroyed)
            return;

        clearCache();
        this._initializing = false;
        this._refreshing = false;
        this._lastAttemptAt = 0;
        this._initialize();
    }

    _handleNotifications(usage) {
        if (!this._settings.get_boolean('notify-enabled')) {
            this._notified = {};
            return;
        }

        const { due, next } = planNotifications(usage, this._notified, {
            threshold: this._settings.get_int('notify-threshold'),
            rateLimit: this._settings.get_boolean('notify-rate-limit'),
            now: Date.now(),
        });

        this._notified = next;
        for (const item of due) {
            try {
                Main.notify(item.title, item.body);
            } catch (error) {
                console.warn(`${LOG_PREFIX} notification failed: ${error.message}`);
            }
        }
    }

    _saveCache() {
        if (!this._usage || !this._fetchedAt)
            return;

        saveCache({
            endpoint: this._usageEndpoint(),
            fetchedAt: this._fetchedAt,
            usage: this._usage,
            notified: this._notified,
        });
    }

    _onCredentialsChanged() {
        if (this._destroyed)
            return;

        this._cancellable?.cancel();
        this._initializing = false;
        this._refreshing = false;
        this._lastAttemptAt = 0;
        this._apiKey = null;
        this._usage = null;
        this._fetchedAt = 0;
        this._error = null;
        this._notified = {};

        clearCache();

        this._indicator?.setKeyPresent(false);
        this._indicator?.setUsage(null, 0);
        this._indicator?.setError(null);
        this._indicator?.setLoading(true);

        this._initialize();
    }

    _openPreferences() {
        try {
            Main.extensionManager.openExtensionPrefs(this.uuid, '', {});
            return;
        } catch (error) {
            console.warn(`${LOG_PREFIX} openExtensionPrefs failed: ${error.message}`);
        }

        try {
            Gio.Subprocess.new(
                ['gnome-extensions', 'prefs', this.uuid],
                Gio.SubprocessFlags.NONE
            );
        } catch (error) {
            console.error(`${LOG_PREFIX} could not open preferences: ${error.message}`);
        }
    }
}
