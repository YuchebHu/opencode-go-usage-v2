// Preferences window (GTK4 + libadwaita).

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    VERSION,
    USAGE_ENDPOINT,
    CONSOLE_URL,
} from './src/constants.js';
import { lookupApiKey, storeApiKey, clearApiKey } from './src/keyring.js';
import { fetchUsage, createSession } from './src/api.js';
import { importFromOpencode } from './src/opencode.js';
import { isValidEndpoint } from './src/endpoint.js';
import { clearCache } from './src/cache.js';
import { friendlyError } from './src/errors.js';
import { formatTestResult, maskApiKey } from './src/format.js';

const PANEL_METRICS = [
    { value: 'auto', label: '自动（最紧张的额度）' },
    { value: 'monthly', label: '本月' },
    { value: 'weekly', label: '本周' },
    { value: 'rolling', label: '5 小时' },
];

export default class OpenCodeGoUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._closed = false;

        window.set_default_size(700, 760);
        window.connect('close-request', () => {
            this._closed = true;
            this._cancellable?.cancel();
            return false;
        });

        const page = new Adw.PreferencesPage({
            title: 'OpenCode Go',
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        this._buildAccountGroup(page);
        this._buildDisplayGroup(page);
        this._buildNotificationsGroup(page);
        this._buildAdvancedGroup(page);
        this._buildAboutGroup(page);

        this._loadKey();
    }

    _buildAccountGroup(page) {
        const group = new Adw.PreferencesGroup({
            title: '账户',
            description: '密钥仅保存在 GNOME 密钥环中，不会写入设置或缓存。',
        });
        page.add(group);

        this._keyRow = new Adw.PasswordEntryRow({
            title: 'API 密钥',
        });
        group.add(this._keyRow);

        const importRow = new Adw.ActionRow({
            title: '从 OpenCode 导入',
            subtitle: '读取 opencode auth export 中启用的 Go 密钥',
        });
        this._importButton = new Gtk.Button({
            label: '导入',
            valign: Gtk.Align.CENTER,
        });
        this._importButton.connect('clicked', () => this._importKey());
        importRow.add_suffix(this._importButton);
        group.add(importRow);

        this._autoImportRow = new Adw.SwitchRow({
            title: '自动导入 OpenCode 密钥',
            subtitle: '密钥环为空时，启动时自动读取当前启用的 Go 凭据',
        });
        this._settings.bind(
            'auto-import-key',
            this._autoImportRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        group.add(this._autoImportRow);

        const actionsRow = new Adw.ActionRow({
            title: '密钥操作',
            subtitle: '保存后立即刷新顶栏；测试不会保存密钥',
        });
        const actions = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });

        this._testButton = new Gtk.Button({ label: '测试' });
        this._testButton.connect('clicked', () => this._testKey());
        actions.append(this._testButton);

        this._saveButton = new Gtk.Button({ label: '保存' });
        this._saveButton.add_css_class('suggested-action');
        this._saveButton.connect('clicked', () => this._saveKey());
        actions.append(this._saveButton);

        this._deleteButton = new Gtk.Button({ label: '删除' });
        this._deleteButton.add_css_class('destructive-action');
        this._deleteButton.connect('clicked', () => this._deleteKey());
        actions.append(this._deleteButton);

        actionsRow.add_suffix(actions);
        group.add(actionsRow);

        this._statusRow = new Adw.ActionRow({
            title: '状态',
            subtitle: '正在读取密钥…',
            subtitle_lines: 3,
        });
        this._statusIcon = new Gtk.Image({
            icon_name: 'dialog-information-symbolic',
            pixel_size: 16,
        });
        this._statusRow.add_prefix(this._statusIcon);
        this._statusSpinner = new Gtk.Spinner({
            visible: false,
            width_request: 16,
            height_request: 16,
            valign: Gtk.Align.CENTER,
        });
        this._statusRow.add_suffix(this._statusSpinner);
        group.add(this._statusRow);

        const consoleRow = new Adw.ActionRow({
            title: '获取 API 密钥',
            subtitle: '在 OpenCode Console 管理 Go 订阅和个人密钥',
        });
        const consoleButton = new Gtk.Button({
            label: '打开 Console',
            valign: Gtk.Align.CENTER,
        });
        consoleButton.connect('clicked', () => this._openUri(CONSOLE_URL));
        consoleRow.add_suffix(consoleButton);
        group.add(consoleRow);
    }

    _buildDisplayGroup(page) {
        const group = new Adw.PreferencesGroup({
            title: '显示',
            description: '调整顶栏指示器和自动刷新频率。',
        });
        page.add(group);

        this._metricRow = new Adw.ComboRow({
            title: '顶栏显示',
            subtitle: '自动模式会展示占用比例最高的额度窗口',
            model: Gtk.StringList.new(PANEL_METRICS.map(item => item.label)),
        });
        const metricIndex = Math.max(0, PANEL_METRICS.findIndex(
            item => item.value === this._settings.get_string('panel-metric')
        ));
        this._metricRow.selected = metricIndex;
        this._metricRow.connect('notify::selected', () => {
            const item = PANEL_METRICS[this._metricRow.selected];
            if (item && item.value !== this._settings.get_string('panel-metric'))
                this._settings.set_string('panel-metric', item.value);
        });
        group.add(this._metricRow);

        this._showPercentageRow = new Adw.SwitchRow({
            title: '显示百分比',
            subtitle: '关闭后顶栏只显示环形指示器',
        });
        this._settings.bind(
            'show-percentage',
            this._showPercentageRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        group.add(this._showPercentageRow);

        const refreshAdjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 60,
            step_increment: 1,
            page_increment: 5,
            value: this._settings.get_int('refresh-interval'),
        });
        this._refreshRow = new Adw.SpinRow({
            title: '自动刷新',
            subtitle: '分钟',
            adjustment: refreshAdjustment,
            digits: 0,
        });
        this._refreshRow.value = this._settings.get_int('refresh-interval');
        this._refreshRow.snap_to_ticks = true;
        this._refreshRow.connect('notify::value', () => {
            const value = Math.max(1, Math.min(60, Math.round(this._refreshRow.value)));
            if (value !== this._settings.get_int('refresh-interval'))
                this._settings.set_int('refresh-interval', value);
        });
        group.add(this._refreshRow);
    }

    _buildNotificationsGroup(page) {
        const group = new Adw.PreferencesGroup({
            title: '提醒',
            description: '提醒只在额度窗口的同一个重置周期内发送一次。',
        });
        page.add(group);

        this._notifyRow = new Adw.SwitchRow({
            title: '额度提醒',
            subtitle: '接近或达到额度上限时发送桌面通知',
        });
        this._settings.bind(
            'notify-enabled',
            this._notifyRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        group.add(this._notifyRow);

        const thresholdAdjustment = new Gtk.Adjustment({
            lower: 50,
            upper: 100,
            step_increment: 5,
            page_increment: 10,
            value: this._settings.get_int('notify-threshold'),
        });
        this._thresholdRow = new Adw.SpinRow({
            title: '提醒阈值',
            subtitle: '已使用百分比',
            adjustment: thresholdAdjustment,
            digits: 0,
        });
        this._thresholdRow.value = this._settings.get_int('notify-threshold');
        this._thresholdRow.snap_to_ticks = true;
        this._thresholdRow.connect('notify::value', () => {
            const value = Math.max(50, Math.min(100, Math.round(this._thresholdRow.value)));
            if (value !== this._settings.get_int('notify-threshold'))
                this._settings.set_int('notify-threshold', value);
        });
        this._settings.bind(
            'notify-enabled',
            this._thresholdRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );
        group.add(this._thresholdRow);

        this._rateLimitRow = new Adw.SwitchRow({
            title: '限流提醒',
            subtitle: '任一额度窗口用尽时通知',
        });
        this._settings.bind(
            'notify-rate-limit',
            this._rateLimitRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'notify-enabled',
            this._rateLimitRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );
        group.add(this._rateLimitRow);
    }

    _buildAdvancedGroup(page) {
        const group = new Adw.PreferencesGroup({
            title: '高级',
            description: `默认端点：${USAGE_ENDPOINT}。修改后扩展会清空缓存并重新获取额度；密钥会被发送到你配置的端点，请只使用可信地址。`,
        });
        page.add(group);

        this._endpointRow = new Adw.EntryRow({
            title: 'API 端点',
            text: this._settings.get_string('endpoint'),
            show_apply_button: true,
        });
        this._endpointRow.connect('apply', () => this._applyEndpoint());
        group.add(this._endpointRow);

        const resetRow = new Adw.ActionRow({
            title: '恢复默认端点',
            subtitle: USAGE_ENDPOINT,
            subtitle_selectable: true,
        });
        const resetButton = new Gtk.Button({
            label: '恢复',
            valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => this._resetEndpoint());
        resetRow.add_suffix(resetButton);
        group.add(resetRow);
    }

    _applyEndpoint() {
        const raw = String(this._endpointRow.text ?? '').trim();
        if (!raw) {
            this._resetEndpoint();
            return;
        }

        if (!isValidEndpoint(raw)) {
            this._showToast('API 端点必须是 http:// 或 https:// 地址');
            return;
        }

        this._endpointRow.text = raw;
        if (raw !== this._settings.get_string('endpoint')) {
            this._settings.set_string('endpoint', raw);
            this._showToast('API 端点已更新，额度缓存已清空');
        }
    }

    _resetEndpoint() {
        this._settings.reset('endpoint');
        this._endpointRow.text = this._settings.get_string('endpoint');
        this._showToast('已恢复默认 API 端点');
    }

    _showToast(message) {
        try {
            this._window?.add_toast(new Adw.Toast({ title: message, timeout: 3 }));
        } catch {
            // Toasts are best-effort; the setting still applies.
        }
    }

    _buildAboutGroup(page) {
        const group = new Adw.PreferencesGroup({ title: '关于' });
        page.add(group);

        group.add(new Adw.ActionRow({
            title: '版本',
            subtitle: VERSION,
        }));

        const endpointRow = new Adw.ActionRow({
            title: '默认数据接口',
            subtitle: USAGE_ENDPOINT,
            subtitle_selectable: true,
        });
        group.add(endpointRow);

        group.add(new Adw.ActionRow({
            title: '隐私',
            subtitle: '仅请求额度数据；缓存包含百分比和重置时间，不含 API 密钥。',
            subtitle_lines: 2,
        }));

        const consoleRow = new Adw.ActionRow({
            title: 'OpenCode Console',
            subtitle: '订阅、密钥和详细用量',
        });
        const button = new Gtk.Button({
            label: '打开',
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', () => this._openUri(CONSOLE_URL));
        consoleRow.add_suffix(button);
        group.add(consoleRow);
    }

    async _loadKey() {
        this._setBusy(true, '正在读取密钥…');
        try {
            const key = await lookupApiKey(this._cancellable);
            if (this._closed)
                return;

            if (key) {
                this._keyRow.text = key;
                this._setStatus(`已保存密钥（${maskApiKey(key)}）`, 'ok');
            } else {
                this._setStatus('尚未配置密钥。可以从 OpenCode 导入或粘贴 Console 密钥。', 'info');
            }
        } catch (error) {
            if (!this._closed)
                this._setStatus(`无法读取系统密钥环：${friendlyError(error)}`, 'error');
        } finally {
            if (!this._closed)
                this._setBusy(false);
        }
    }

    async _importKey() {
        if (this._busy || this._closed)
            return;

        this._setBusy(true, '正在从 OpenCode 读取密钥…');

        try {
            const credential = await importFromOpencode(this._cancellable);
            if (this._closed)
                return;

            this._keyRow.text = credential.key;
            await storeApiKey(credential.key, this._cancellable);
            if (this._closed)
                return;

            this._bumpRevision();
            clearCache();
            this._setStatus(`已导入并保存「${credential.label}」，正在验证…`, 'ok');
            await this._verifyKey(credential.key);
        } catch (error) {
            if (!this._closed)
                this._setStatus(friendlyError(error), 'error');
        } finally {
            if (!this._closed)
                this._setBusy(false);
        }
    }

    async _testKey() {
        if (this._busy || this._closed)
            return;

        const key = String(this._keyRow.text ?? '').trim();
        if (!key) {
            this._setStatus('请先输入 API 密钥。', 'error');
            return;
        }

        this._setBusy(true, '正在验证密钥…');
        try {
            await this._verifyKey(key);
        } finally {
            if (!this._closed)
                this._setBusy(false);
        }
    }

    async _saveKey() {
        if (this._busy || this._closed)
            return;

        const key = String(this._keyRow.text ?? '').trim();
        if (!key) {
            this._setStatus('请先输入 API 密钥。', 'error');
            return;
        }

        this._setBusy(true, '正在保存密钥…');

        try {
            await storeApiKey(key, this._cancellable);
            if (this._closed)
                return;

            this._bumpRevision();
            clearCache();
            this._setStatus('已保存，正在验证…', 'ok');
            await this._verifyKey(key);
        } catch (error) {
            if (!this._closed)
                this._setStatus(friendlyError(error), 'error');
        } finally {
            if (!this._closed)
                this._setBusy(false);
        }
    }

    async _verifyKey(key) {
        try {
            const usage = await fetchUsage(key, {
                session: createSession(),
                cancellable: this._cancellable,
            });
            if (!this._closed)
                this._setStatus(formatTestResult(usage), 'ok');
            return true;
        } catch (error) {
            if (!this._closed)
                this._setStatus(friendlyError(error), 'error');
            return false;
        }
    }

    async _deleteKey() {
        if (this._busy || this._closed)
            return;

        this._setBusy(true, '正在删除密钥…');
        try {
            await clearApiKey(this._cancellable);
            if (this._closed)
                return;

            this._keyRow.text = '';
            this._bumpRevision();
            clearCache();
            this._setStatus('已删除密钥。', 'info');
        } catch (error) {
            if (!this._closed)
                this._setStatus(`删除失败：${friendlyError(error)}`, 'error');
        } finally {
            if (!this._closed)
                this._setBusy(false);
        }
    }

    _bumpRevision() {
        const revision = this._settings.get_int('credentials-revision');
        this._settings.set_int('credentials-revision', revision + 1);
    }

    _setBusy(busy, message = null) {
        this._busy = Boolean(busy);

        const sensitive = !this._busy;
        for (const button of [this._testButton, this._saveButton, this._deleteButton, this._importButton])
            button.sensitive = sensitive;

        this._keyRow.sensitive = sensitive;

        if (busy) {
            this._statusSpinner.visible = true;
            this._statusSpinner.start();
            this._statusIcon.visible = false;
            if (message)
                this._statusRow.subtitle = message;
        } else {
            this._statusSpinner.stop();
            this._statusSpinner.visible = false;
            this._statusIcon.visible = true;
        }
    }

    _setStatus(message, tone = 'info') {
        if (this._closed)
            return;

        this._statusRow.subtitle = message;
        const icons = {
            info: 'dialog-information-symbolic',
            ok: 'emblem-ok-symbolic',
            error: 'dialog-error-symbolic',
        };
        this._statusIcon.icon_name = icons[tone] ?? icons.info;
    }

    _openUri(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (error) {
            this._setStatus(`无法打开链接：${error.message}`, 'error');
        }
    }
}
