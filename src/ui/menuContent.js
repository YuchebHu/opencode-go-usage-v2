// Contents of the dropdown: product header, three quota cards and footer.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { BrandMark } from '../widgets/brandMark.js';
import { MeterCard } from '../widgets/meterCard.js';
import {
    METERS,
    STATE_LABELS,
} from '../constants.js';
import {
    formatUpdatedAgo,
    statusText,
    isStale,
} from '../format.js';
import { overallState, usageSummary } from '../usage.js';
import { errorNeedsSettings, friendlyError } from '../errors.js';

const CONTENT_WIDTH = 416;

function iconButton(iconName, accessibleName, callback) {
    const button = new St.Button({
        style_class: 'ocgo-icon-btn',
        can_focus: true,
        track_hover: true,
        accessible_name: accessibleName,
        child: new St.Icon({
            icon_name: iconName,
            icon_size: 15,
            style_class: 'ocgo-icon',
        }),
    });
    button.connect('clicked', callback);
    return button;
}

function textButton(label, { primary = false, destructive = false, callback } = {}) {
    const classes = ['ocgo-btn'];
    if (primary)
        classes.push('ocgo-btn-primary');
    if (destructive)
        classes.push('ocgo-btn-destructive');

    const button = new St.Button({
        style_class: classes.join(' '),
        can_focus: true,
        track_hover: true,
        accessible_name: label,
        child: new St.Label({
            text: label,
            style_class: 'ocgo-btn-label',
        }),
    });
    if (callback)
        button.connect('clicked', callback);
    return button;
}

function sectionLabel(text, styleClass) {
    const label = new St.Label({
        text,
        style_class: styleClass,
    });
    label.clutter_text.set_line_wrap(true);
    return label;
}

export const UsageMenuContent = GObject.registerClass({
    GTypeName: 'OpenCodeGoUsageMenuContent',
}, class UsageMenuContent extends St.BoxLayout {
    _init(params = {}) {
        super._init({
            vertical: true,
            style: 'spacing: 14px;',
            style_class: 'ocgo-content',
            width: CONTENT_WIDTH,
        });

        this._onRefresh = params.onRefresh ?? (() => {});
        this._onOpenSettings = params.onOpenSettings ?? (() => {});
        this._state = null;
        this._lastRenderedUsage = null;
        this._cards = new Map();

        this._buildHeader();
        this._buildBody();
        this._buildFooter();
        this._syncColorScheme();

        const settings = St.Settings.get();
        this._settingsSignal = settings.connect('notify::color-scheme', () => this._syncColorScheme());
        this._styleSignal = this.connect('style-changed', () => this._syncColorScheme());
        this._mappedSignal = this.connect('notify::mapped', () => {
            if (this.mapped)
                this._syncColorScheme();
        });
        this.connect('destroy', () => {
            if (this._settingsSignal) {
                settings.disconnect(this._settingsSignal);
                this._settingsSignal = 0;
            }
            if (this._styleSignal) {
                this.disconnect(this._styleSignal);
                this._styleSignal = 0;
            }
            if (this._mappedSignal) {
                this.disconnect(this._mappedSignal);
                this._mappedSignal = 0;
            }
        });
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 11px;',
            x_expand: true,
        });
        this.add_child(header);

        const brand = new St.Bin({
            style_class: 'ocgo-brand',
            width: 40,
            height: 40,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            child: new BrandMark(),
        });
        header.add_child(brand);

        // Keep the status pill on the subtitle row. That leaves the full
        // header width for the product name, which matters with large text
        // scaling factors.
        const titles = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 2px;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(titles);

        const titleRow = new St.BoxLayout({
            x_expand: true,
            style: 'spacing: 8px;',
        });
        titles.add_child(titleRow);

        titleRow.add_child(new St.Label({
            text: 'OpenCode Go',
            style_class: 'ocgo-title',
            x_expand: true,
        }));

        const metaRow = new St.BoxLayout({
            x_expand: true,
            style: 'spacing: 8px;',
        });
        titles.add_child(metaRow);

        this._subtitle = new St.Label({
            text: '额度使用',
            style_class: 'ocgo-dim ocgo-subtitle',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        metaRow.add_child(this._subtitle);

        this._statusPill = new St.Label({
            text: '',
            style_class: 'ocgo-pill ocgo-pill-muted',
            y_align: Clutter.ActorAlign.CENTER,
        });
        metaRow.add_child(this._statusPill);

        this._refreshButton = iconButton(
            'view-refresh-symbolic',
            '立即刷新额度',
            () => this._onRefresh()
        );
        header.add_child(this._refreshButton);
    }

    _buildBody() {
        this._body = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 10px;',
            x_expand: true,
        });
        this.add_child(this._body);

        this._banner = this._buildBanner();
        this._body.add_child(this._banner);

        this._dashboard = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 8px;',
            x_expand: true,
        });
        this._body.add_child(this._dashboard);

        for (const meter of METERS) {
            const card = new MeterCard({
                meterId: meter.id,
                label: meter.label,
            });
            this._cards.set(meter.id, card);
            this._dashboard.add_child(card);
        }

        this._setupView = this._buildSetupView();
        this._body.add_child(this._setupView.actor);

        this._loadingView = this._buildLoadingView();
        this._body.add_child(this._loadingView.actor);

        this._errorView = this._buildErrorView();
        this._body.add_child(this._errorView.actor);
    }

    _buildBanner() {
        const banner = new St.BoxLayout({
            style_class: 'ocgo-banner',
            vertical: false,
            style: 'spacing: 8px;',
            x_expand: true,
            visible: false,
        });

        banner.add_child(new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            icon_size: 15,
            style_class: 'ocgo-banner-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._bannerText = sectionLabel('', 'ocgo-banner-text');
        this._bannerText.x_expand = true;
        this._bannerText.y_align = Clutter.ActorAlign.CENTER;
        banner.add_child(this._bannerText);

        this._bannerRetry = textButton('重试', {
            callback: () => this._onRefresh(),
        });
        this._bannerRetry.add_style_class_name('ocgo-btn-small');
        banner.add_child(this._bannerRetry);

        this._bannerSettings = textButton('设置', {
            callback: () => this._onOpenSettings(),
        });
        this._bannerSettings.add_style_class_name('ocgo-btn-small');
        banner.add_child(this._bannerSettings);

        return banner;
    }

    _messageView(iconName) {
        const actor = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 10px;',
            style_class: 'ocgo-empty',
            x_expand: true,
            visible: false,
        });

        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: 30,
            style_class: 'ocgo-empty-icon',
            x_align: Clutter.ActorAlign.CENTER,
        });
        actor.add_child(icon);

        const title = new St.Label({
            text: '',
            style_class: 'ocgo-empty-title',
            x_align: Clutter.ActorAlign.CENTER,
        });
        actor.add_child(title);

        const body = sectionLabel('', 'ocgo-dim ocgo-empty-body');
        body.x_align = Clutter.ActorAlign.CENTER;
        actor.add_child(body);

        const actions = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_align: Clutter.ActorAlign.CENTER,
        });
        actor.add_child(actions);

        return { actor, icon, title, body, actions };
    }

    _buildSetupView() {
        const view = this._messageView('dialog-password-symbolic');
        view.title.text = '连接 OpenCode Go';
        view.body.text = '在设置中粘贴 API 密钥，或一键从 OpenCode 导入。密钥只保存在系统密钥环中。';
        view.body.set_width(CONTENT_WIDTH - 48);
        view.actions.add_child(textButton('打开设置', {
            primary: true,
            callback: () => this._onOpenSettings(),
        }));
        return view;
    }

    _buildLoadingView() {
        const view = this._messageView('content-loading-symbolic');
        view.title.text = '正在获取额度';
        view.body.text = '正在连接 opencode.ai…';
        return view;
    }

    _buildErrorView() {
        const view = this._messageView('dialog-warning-symbolic');
        view.icon.add_style_class_name('ocgo-empty-icon-error');
        view.title.text = '无法获取额度';

        this._errorRetry = textButton('重试', {
            primary: true,
            callback: () => this._onRefresh(),
        });
        view.actions.add_child(this._errorRetry);

        this._errorSettings = textButton('打开设置', {
            callback: () => this._onOpenSettings(),
        });
        view.actions.add_child(this._errorSettings);

        return view;
    }

    _buildFooter() {
        const footer = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 10px;',
            x_expand: true,
        });
        this.add_child(footer);

        footer.add_child(new St.Widget({
            style_class: 'ocgo-divider',
            x_expand: true,
            height: 1,
        }));

        const row = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_expand: true,
        });
        footer.add_child(row);

        this._footerText = new St.Label({
            text: '尚未更新',
            style_class: 'ocgo-footer-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(this._footerText);

        const button = new St.Button({
            style_class: 'ocgo-footer-btn',
            can_focus: true,
            track_hover: true,
            accessible_name: '打开扩展设置',
            child: (() => {
                const box = new St.BoxLayout({ style: 'spacing: 5px;' });
                box.add_child(new St.Icon({
                    icon_name: 'emblem-system-symbolic',
                    icon_size: 13,
                }));
                box.add_child(new St.Label({
                    text: '设置',
                    style_class: 'ocgo-footer-btn-label',
                }));
                return box;
            })(),
        });
        button.connect('clicked', () => this._onOpenSettings());
        row.add_child(button);
    }

    _syncColorScheme() {
        let light = null;

        // The actual popup background is more reliable than the St settings
        // default, especially in test sessions and custom themes.
        if (this.get_stage()) {
            try {
                // Walk up to the popup's opaque background (popup-menu-content).
                // The foreground colour is a mid grey in both themes, so it is
                // not a reliable way to tell light from dark.
                let actor = this;
                for (let depth = 0; actor && depth < 8; depth++) {
                    const background = actor.get_theme_node?.()?.get_background_color?.();
                    if (background && background.alpha > 0) {
                        const luminance = (
                            0.2126 * (background.red ?? 0) +
                            0.7152 * (background.green ?? 0) +
                            0.0722 * (background.blue ?? 0)
                        ) / 255;
                        light = luminance > 0.5;
                        break;
                    }
                    actor = actor.get_parent?.();
                }
            } catch {
                // Fall back to the St colour scheme below.
            }
        }

        if (light === null) {
            try {
                light = St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_LIGHT;
            } catch {
                light = false;
            }
        }

        const hasLightClass = this.has_style_class_name('ocgo-light');
        if (light && !hasLightClass)
            this.add_style_class_name('ocgo-light');
        else if (!light && hasLightClass)
            this.remove_style_class_name('ocgo-light');
    }

    _showView(name) {
        this._dashboard.visible = name === 'dashboard';
        this._setupView.actor.visible = name === 'setup';
        this._loadingView.actor.visible = name === 'loading';
        this._errorView.actor.visible = name === 'error';
    }

    _setPill(text, tone) {
        this._statusPill.text = text;
        this._statusPill.set_style_class_name(`ocgo-pill ocgo-pill-${tone}`);
    }

    _renderStatus(state) {
        const { keyPresent, usage, error, loading } = state;

        if (!keyPresent && !error && !loading) {
            this._setPill('未配置', 'muted');
            return;
        }

        if (!keyPresent && loading) {
            this._setPill('同步中', 'muted');
            return;
        }

        if (!keyPresent && error) {
            this._setPill('离线', 'critical');
            return;
        }

        if (usage) {
            const tone = overallState(usage);
            this._setPill(statusText(tone), tone);
            return;
        }

        if (loading) {
            this._setPill('同步中', 'muted');
            return;
        }

        if (error) {
            this._setPill('离线', 'critical');
            return;
        }

        this._setPill(STATE_LABELS.muted, 'muted');
    }

    _renderViews(state) {
        const { keyPresent, usage, error, loading } = state;

        let view;
        if (keyPresent && usage)
            view = 'dashboard';
        else if (!keyPresent && !error && !loading)
            view = 'setup';
        else if (error && !loading)
            view = 'error';
        else
            view = 'loading';

        this._showView(view);

        const needsSettings = errorNeedsSettings(error);
        if (error) {
            this._errorView.body.text = friendlyError(error);
            this._errorView.body.set_width(CONTENT_WIDTH - 48);
            this._errorRetry.visible = !needsSettings;
            this._errorSettings.visible = needsSettings;
            this._errorRetry.set_style_class_name(
                `ocgo-btn${needsSettings ? '' : ' ocgo-btn-primary'}`
            );
            this._errorSettings.set_style_class_name(
                `ocgo-btn${needsSettings ? ' ocgo-btn-primary' : ''}`
            );
        }

        const showBanner = Boolean(usage && error);
        this._banner.visible = showBanner;
        if (showBanner) {
            this._bannerText.text = friendlyError(error);
            this._bannerRetry.visible = !needsSettings;
            this._bannerSettings.visible = needsSettings;
            if (needsSettings && !this._bannerSettings.has_style_class_name('ocgo-btn-primary'))
                this._bannerSettings.add_style_class_name('ocgo-btn-primary');
            else if (!needsSettings)
                this._bannerSettings.remove_style_class_name('ocgo-btn-primary');
        }

        this._refreshButton.reactive = !loading;
        this._refreshButton.opacity = loading ? 130 : 255;
    }

    _renderFooter(state, now) {
        const { keyPresent, usage, error, loading, intervalMinutes = 5 } = state;
        let text = '尚未更新';
        let warning = false;

        if (!keyPresent && !error) {
            text = '尚未连接账户';
        } else if (!keyPresent && error) {
            text = '同步失败';
            warning = true;
        } else if (usage) {
            text = formatUpdatedAgo(state.fetchedAt, now);
            if (loading)
                text += ' · 正在刷新…';
            if (isStale(state.fetchedAt, intervalMinutes, now)) {
                warning = true;
                text = `数据可能已过期 · ${text}`;
            }
        } else if (loading) {
            text = '正在获取额度…';
        } else if (error) {
            text = '同步失败';
            warning = true;
        }

        this._footerText.text = text;
        this._footerText.set_style_class_name(
            `ocgo-footer-text${warning ? ' ocgo-footer-warn' : ''}`
        );
    }

    render(state, { animate = false } = {}) {
        this._state = state;
        const now = Date.now();
        const interval = Math.max(1, Number(state.intervalMinutes) || 5);
        this._subtitle.text = `额度使用 · 每 ${interval} 分钟刷新`;

        this._renderStatus(state);
        this._renderViews(state);
        this._renderFooter(state, now);

        if (state.usage) {
            // Loading/error/status changes keep the same usage object; don't
            // re-render the rings and cancel a running entrance animation.
            if (state.usage !== this._lastRenderedUsage) {
                for (const meter of METERS) {
                    const card = this._cards.get(meter.id);
                    const data = state.usage[meter.id];
                    if (data)
                        card.update(data, { animate });
                }
                this._lastRenderedUsage = state.usage;
            }
            this.accessible_name = `OpenCode Go：${usageSummary(state.usage)}`;
        } else {
            this._lastRenderedUsage = null;
            this.accessible_name = 'OpenCode Go 额度';
        }
    }

    updateTimes(now = Date.now()) {
        if (!this._state)
            return;

        for (const card of this._cards.values())
            card.updateTime(now);
        this._renderFooter(this._state, now);
    }

    playEntrance() {
        if (!this._state?.usage)
            return;

        for (const meter of METERS) {
            const data = this._state.usage[meter.id];
            const card = this._cards.get(meter.id);
            if (data)
                card.playEntrance(data);
        }
    }

    syncTheme() {
        this._syncColorScheme();
    }
});
