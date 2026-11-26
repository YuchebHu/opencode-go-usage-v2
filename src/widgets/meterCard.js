// One quota card: arc gauge plus label, percentage and reset countdown.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { QuotaRing } from './quotaRing.js';
import { formatPercent, formatReset, statusText } from '../format.js';
import { meterState } from '../usage.js';

export const MeterCard = GObject.registerClass({
    GTypeName: 'OpenCodeGoMeterCard',
}, class MeterCard extends St.BoxLayout {
    _init(params = {}) {
        super._init({
            style_class: 'ocgo-card',
            vertical: false,
            style: 'spacing: 13px;',
            x_expand: true,
        });

        this._meterId = params.meterId;
        this._meter = null;

        this._ring = new QuotaRing({ size: 58, y_align: Clutter.ActorAlign.CENTER });
        this.add_child(this._ring);

        const info = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 2px;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(info);

        const top = new St.BoxLayout({
            x_expand: true,
            style: 'spacing: 8px;',
        });
        info.add_child(top);

        this._title = new St.Label({
            text: params.label ?? '',
            style_class: 'ocgo-card-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        top.add_child(this._title);

        this._status = new St.Label({
            style_class: 'ocgo-card-state',
            y_align: Clutter.ActorAlign.CENTER,
        });
        top.add_child(this._status);

        const valueRow = new St.BoxLayout({
            style: 'spacing: 6px;',
            x_expand: true,
        });
        info.add_child(valueRow);

        this._percent = new St.Label({
            style_class: 'ocgo-percent',
            y_align: Clutter.ActorAlign.CENTER,
        });
        valueRow.add_child(this._percent);

        this._percentHint = new St.Label({
            text: '已使用',
            style_class: 'ocgo-dim ocgo-percent-hint',
            y_align: Clutter.ActorAlign.CENTER,
        });
        valueRow.add_child(this._percentHint);

        this._detail = new St.Label({
            style_class: 'ocgo-card-detail',
        });
        info.add_child(this._detail);
    }

    update(meter, { animate = false } = {}) {
        this._meter = meter;
        const state = meterState(meter);

        const ringPercent = meter.status === 'rate-limited' ? 100 : meter.percent;
        this._ring.setValue(ringPercent, state, { animate });
        this._percent.text = formatPercent(meter.percent);
        this._percent.set_style_class_name(`ocgo-percent ocgo-tone-${state}`);
        this._status.text = statusText(state);
        this._status.set_style_class_name(`ocgo-card-state ocgo-tone-${state}`);
        this._detail.text = this._detailText();
        this.accessible_name =
            `${this._title.text}额度 ${formatPercent(meter.percent)}，${statusText(state)}，${this._detailText()}`;
    }

    playEntrance(meter) {
        const state = meterState(meter);
        const percent = meter.status === 'rate-limited' ? 100 : meter.percent;
        this._ring.playEntrance(percent, state);
    }

    updateTime(now = Date.now()) {
        if (!this._meter)
            return;
        this._detail.text = this._detailText(now);
    }

    _detailText(now = Date.now()) {
        if (!this._meter)
            return '';

        // The API reports a 5-hour reset time even before the rolling window
        // has started; a zero percentage means there is nothing to count down.
        if (this._meterId === 'rolling' &&
            this._meter.status === 'ok' &&
            this._meter.percent === 0) {
            return '窗口空闲 · 使用后开始计时';
        }

        return formatReset(this._meter.resetsAt, now);
    }
});
