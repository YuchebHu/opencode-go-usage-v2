// Compact ring used in the top panel.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';

import { STATE_COLORS } from '../constants.js';

const SIZE = 18;
const STROKE = 2.6;

export const PanelGauge = GObject.registerClass({
    GTypeName: 'OpenCodeGoPanelGauge',
}, class PanelGauge extends St.DrawingArea {
    _init(params = {}) {
        super._init({
            ...params,
            width: SIZE,
            height: SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._fraction = 0;
        this._state = 'muted';

        this.connect('repaint', area => this._draw(area));
        this.connect('style-changed', () => this.queue_repaint());
    }

    setValue(fraction, state = 'muted') {
        const nextFraction = Math.min(1, Math.max(0, Number(fraction) || 0));
        const nextState = STATE_COLORS[state] ? state : 'muted';
        if (Math.abs(nextFraction - this._fraction) < 0.001 && nextState === this._state)
            return;

        this._fraction = nextFraction;
        this._state = nextState;
        this.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        if (!cr)
            return;

        try {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const [surfaceWidth, surfaceHeight] = area.get_surface_size();
            const width = surfaceWidth / scale;
            const height = surfaceHeight / scale;
            const size = Math.min(width, height);

            cr.save();
            cr.scale(scale, scale);

            const centerX = width / 2;
            const centerY = height / 2;
            const radius = Math.max(1, (size - STROKE * 2 - 2) / 2);
            const start = -Math.PI / 2;
            const end = start + Math.PI * 2 * this._fraction;

            const foreground = this.get_theme_node().get_foreground_color();
            const fg = {
                red: (foreground?.red ?? 255) / 255,
                green: (foreground?.green ?? 255) / 255,
                blue: (foreground?.blue ?? 255) / 255,
            };

            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(STROKE);
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.25);
            cr.arc(centerX, centerY, radius, 0, Math.PI * 2);
            cr.stroke();

            const colors = STATE_COLORS[this._state] ?? STATE_COLORS.muted;
            const [r, g, b] = colors.end;

            if (this._fraction <= 0.0001) {
                cr.setSourceRGBA(r, g, b, 1);
                cr.arc(centerX, centerY - radius, STROKE * 0.55, 0, Math.PI * 2);
                cr.fill();
                return;
            }

            cr.setSourceRGBA(r, g, b, 1);
            cr.arc(centerX, centerY, radius, start, end);
            cr.stroke();
        } finally {
            cr.restore();
            cr.$dispose();
        }
    }
});
