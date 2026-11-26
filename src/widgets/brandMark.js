// The small gauge mark shown next to the product name.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';

export const BrandMark = GObject.registerClass({
    GTypeName: 'OpenCodeGoBrandMark',
}, class BrandMark extends St.DrawingArea {
    _init(params = {}) {
        super._init({
            ...params,
            width: 24,
            height: 24,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.connect('repaint', area => this._draw(area));
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
            const centerX = width / 2;
            const centerY = height / 2;
            const radius = Math.min(width, height) / 2 - 4;
            const start = Math.PI * 0.75;
            const end = Math.PI * 2.25;

            cr.save();
            cr.scale(scale, scale);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(2.1);
            cr.setSourceRGBA(1, 1, 1, 0.96);
            cr.arc(centerX, centerY, radius, start, end);
            cr.stroke();

            const dotX = centerX + Math.cos(end) * radius;
            const dotY = centerY + Math.sin(end) * radius;
            cr.arc(dotX, dotY, 1.6, 0, Math.PI * 2);
            cr.fill();

            cr.setSourceRGBA(1, 1, 1, 0.55);
            cr.arc(centerX, centerY, 1.5, 0, Math.PI * 2);
            cr.fill();
        } finally {
            cr.restore();
            cr.$dispose();
        }
    }
});
