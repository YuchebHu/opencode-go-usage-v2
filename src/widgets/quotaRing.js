// A striped, rounded arc gauge drawn directly with Cairo. No image assets.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Cairo from 'gi://cairo';

import { STATE_COLORS } from '../constants.js';

const DEFAULT_SIZE = 58;
const DEFAULT_STROKE = 5.5;
const ANIMATION_MS = 420;

function clamp01(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
}

export const QuotaRing = GObject.registerClass({
    GTypeName: 'OpenCodeGoQuotaRing',
}, class QuotaRing extends St.DrawingArea {
    _init(params = {}) {
        const {
            size = DEFAULT_SIZE,
            strokeWidth = DEFAULT_STROKE,
            style_class: styleClass = null,
            ...rest
        } = params;

        super._init({
            ...rest,
            width: size,
            height: size,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._size = size;
        this._strokeWidth = strokeWidth;
        this._fraction = 0;
        this._state = 'muted';
        this._animationId = 0;
        this._animationFrom = 0;
        this._animationTo = 0;
        this._animationStartedAt = 0;

        this.add_style_class_name('ocgo-ring');
        if (styleClass)
            this.add_style_class_name(styleClass);

        this.connect('repaint', area => this._draw(area));
        this.connect('style-changed', () => this.queue_repaint());
        this.connect('destroy', () => this._stopAnimation());
    }

    setValue(percent, state = 'ok', { animate = false } = {}) {
        const target = clamp01(Number(percent) / 100);
        const nextState = STATE_COLORS[state] ? state : 'muted';
        const changed = Math.abs(target - this._fraction) > 0.0001 ||
            nextState !== this._state;

        this._state = nextState;

        const animationsEnabled = St.Settings.get().enable_animations !== false;
        if (animate && animationsEnabled) {
            this._animateTo(target);
        } else {
            this._stopAnimation();
            this._fraction = target;
            if (changed)
                this.queue_repaint();
        }
    }

    playEntrance(percent, state = 'ok') {
        this._stopAnimation();
        this._fraction = 0;
        this._state = STATE_COLORS[state] ? state : 'muted';
        this.queue_repaint();
        this.setValue(percent, state, { animate: true });
    }

    _animateTo(target) {
        this._stopAnimation();

        if (Math.abs(target - this._fraction) < 0.0001)
            return;

        this._animationFrom = this._fraction;
        this._animationTo = target;
        this._animationStartedAt = GLib.get_monotonic_time() / 1000;

        this._animationId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            16,
            () => {
                const now = GLib.get_monotonic_time() / 1000;
                const progress = Math.min(1, (now - this._animationStartedAt) / ANIMATION_MS);
                const eased = 1 - Math.pow(1 - progress, 3);
                this._fraction = this._animationFrom +
                    (this._animationTo - this._animationFrom) * eased;
                this.queue_repaint();

                if (progress >= 1) {
                    this._animationId = 0;
                    this._fraction = this._animationTo;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopAnimation() {
        if (this._animationId) {
            GLib.source_remove(this._animationId);
            this._animationId = 0;
        }
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
            const stroke = this._strokeWidth;
            const glowWidth = stroke * 1.9;
            const radius = Math.max(1, (size - Math.max(glowWidth, 8) - 2) / 2);
            const start = -Math.PI / 2;
            const end = start + Math.PI * 2 * Math.min(1, this._fraction);

            const themeNode = this.get_theme_node();
            const foreground = themeNode.get_foreground_color();
            const fg = {
                red: (foreground?.red ?? 255) / 255,
                green: (foreground?.green ?? 255) / 255,
                blue: (foreground?.blue ?? 255) / 255,
            };

            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(stroke);
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.13);
            cr.arc(centerX, centerY, radius, 0, Math.PI * 2);
            cr.stroke();

            const colors = STATE_COLORS[this._state] ?? STATE_COLORS.muted;
            const [startR, startG, startB] = colors.start;
            const [endR, endG, endB] = colors.end;

            if (this._fraction <= 0.0001) {
                cr.setSourceRGBA(startR, startG, startB, 0.9);
                cr.arc(centerX, centerY - radius, stroke * 0.42, 0, Math.PI * 2);
                cr.fill();
                return;
            }

            const gradient = new Cairo.LinearGradient(
                centerX - radius,
                centerY + radius,
                centerX + radius,
                centerY - radius
            );
            gradient.addColorStopRGBA(0, startR, startG, startB, 1);
            gradient.addColorStopRGBA(1, endR, endG, endB, 1);

            const glow = new Cairo.LinearGradient(
                centerX - radius,
                centerY + radius,
                centerX + radius,
                centerY - radius
            );
            glow.addColorStopRGBA(0, startR, startG, startB, 0.20);
            glow.addColorStopRGBA(1, endR, endG, endB, 0.20);

            cr.setLineWidth(glowWidth);
            cr.setSource(glow);
            cr.arc(centerX, centerY, radius, start, end);
            cr.stroke();

            cr.setLineWidth(stroke);
            cr.setSource(gradient);
            cr.arc(centerX, centerY, radius, start, end);
            cr.stroke();

            if (this._fraction < 0.999) {
                const dotX = centerX + Math.cos(end) * radius;
                const dotY = centerY + Math.sin(end) * radius;
                cr.setSourceRGBA(endR, endG, endB, 1);
                cr.arc(dotX, dotY, stroke * 0.42, 0, Math.PI * 2);
                cr.fill();
            }
        } finally {
            cr.restore();
            cr.$dispose();
        }
    }
});
