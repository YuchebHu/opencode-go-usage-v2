// Top-panel button and its dropdown menu.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { PanelGauge } from '../widgets/panelGauge.js';
import { UsageMenuContent } from './menuContent.js';
import { selectPanelMeter, meterState, overallState, usageSummary } from '../usage.js';
import { formatPercent, statusText } from '../format.js';

export const UsageIndicator = GObject.registerClass({
    GTypeName: 'OpenCodeGoUsageIndicator',
}, class UsageIndicator extends PanelMenu.Button {
    _init(params = {}) {
        super._init(0.0, 'OpenCode Go 额度', false);

        this._settings = params.settings;
        this._onRefresh = params.onRefresh ?? (() => {});
        this._onOpenSettings = params.onOpenSettings ?? (() => {});
        this._keyPresent = false;
        this._usage = null;
        this._fetchedAt = 0;
        this._error = null;
        this._loading = false;
        this._menuOpen = false;
        this._tickerId = 0;
        this._destroyed = false;

        this.add_style_class_name('ocgo-panel-button');

        const panelBox = new St.BoxLayout({
            style_class: 'ocgo-panel-box',
            style: 'spacing: 5px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(panelBox);

        this._gauge = new PanelGauge();
        panelBox.add_child(this._gauge);

        this._panelLabel = new St.Label({
            text: 'Go',
            style_class: 'ocgo-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        panelBox.add_child(this._panelLabel);

        this._content = new UsageMenuContent({
            onRefresh: () => this._onRefresh(),
            onOpenSettings: () => this._openSettings(),
        });

        this._menuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'ocgo-menu-item',
        });
        this._menuItem.add_child(this._content);
        this.menu.addMenuItem(this._menuItem);

        if (this.menu.box)
            this.menu.box.add_style_class_name('ocgo-menu');

        this.menu.connect('open-state-changed', (menu, open) => {
            this._menuOpen = open;
            if (open) {
                this._content.render(this._state(), { animate: false });
                this._content.playEntrance();
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (!this._destroyed)
                        this._content?.syncTheme();
                    return GLib.SOURCE_REMOVE;
                });
                this._startTicker();
                if (this._shouldRefreshOnOpen())
                    this._onRefresh();
            } else {
                this._stopTicker();
            }
        });

        this._render();
    }

    _state() {
        return {
            keyPresent: this._keyPresent,
            usage: this._usage,
            fetchedAt: this._fetchedAt,
            error: this._error,
            loading: this._loading,
            intervalMinutes: this._refreshInterval(),
        };
    }

    _refreshInterval() {
        try {
            return this._settings.get_int('refresh-interval');
        } catch {
            return 5;
        }
    }

    _showPercentage() {
        try {
            return this._settings.get_boolean('show-percentage');
        } catch {
            return true;
        }
    }

    _panelMetric() {
        try {
            return this._settings.get_string('panel-metric');
        } catch {
            return 'auto';
        }
    }

    _shouldRefreshOnOpen() {
        if (this._loading)
            return false;
        if (!this._keyPresent && !this._error)
            return false;
        if (!this._usage || this._error)
            return true;
        return Date.now() - this._fetchedAt > 60 * 1000;
    }

    _startTicker() {
        this._stopTicker();
        this._tickerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._content.updateTimes(Date.now());
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTicker() {
        if (this._tickerId) {
            GLib.source_remove(this._tickerId);
            this._tickerId = 0;
        }
    }

    _openSettings() {
        this.menu.close();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this._destroyed)
                this._onOpenSettings();
            return GLib.SOURCE_REMOVE;
        });
    }

    _render({ animate = false } = {}) {
        const state = this._state();
        this._content.render(state, { animate });
        this._renderPanel(state);
    }

    _renderPanel(state) {
        const stateName = overallState(state.usage);
        const selected = selectPanelMeter(state.usage, this._panelMetric());
        const showPercentage = this._showPercentage();

        if (!state.keyPresent) {
            this._gauge.setValue(0, state.error ? 'critical' : 'muted');
            this._panelLabel.text = state.error ? '!' : 'Go';
            this._panelLabel.visible = true;
            this._panelLabel.set_style_class_name(
                `ocgo-panel-label${state.error ? ' ocgo-panel-label-critical' : ''}`
            );
            this.accessible_name = state.error
                ? 'OpenCode Go 额度：无法读取配置'
                : 'OpenCode Go 额度：尚未配置';
            return;
        }

        if (!state.usage || !selected) {
            const tone = state.error ? 'critical' : 'muted';
            this._gauge.setValue(0, tone);
            this._panelLabel.text = state.error ? '!' : (state.loading ? '…' : 'Go');
            this._panelLabel.visible = true;
            this._panelLabel.set_style_class_name(
                `ocgo-panel-label${state.error ? ' ocgo-panel-label-critical' : ''}`
            );
            this.accessible_name = state.error
                ? `OpenCode Go 额度：${statusText('muted')}`
                : 'OpenCode Go 额度：正在获取';
            return;
        }

        const tone = meterState(selected);
        const fraction = selected.status === 'rate-limited' ? 1 : selected.percent / 100;
        this._gauge.setValue(fraction, tone);

        const limited = tone === 'limited';
        this._panelLabel.text = limited ? '限流' : formatPercent(selected.percent);
        this._panelLabel.visible = showPercentage || limited;
        this._panelLabel.set_style_class_name(
            `ocgo-panel-label ocgo-panel-label-${tone}`
        );

        this.accessible_name =
            `OpenCode Go 额度：${usageSummary(state.usage)}，${statusText(stateName)}`;
    }

    setKeyPresent(value) {
        this._keyPresent = Boolean(value);
        this._render();
    }

    setLoading(value) {
        this._loading = Boolean(value);
        this._render();
    }

    setUsage(usage, fetchedAt) {
        this._usage = usage;
        this._fetchedAt = Number(fetchedAt) || 0;
        this._render({ animate: this._menuOpen });
    }

    setError(error) {
        this._error = error;
        this._render();
    }

    updateSettings() {
        this._render();
    }

    destroy() {
        this._destroyed = true;
        this._stopTicker();
        super.destroy();
    }
});
