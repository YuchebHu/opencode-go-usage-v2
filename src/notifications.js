// Decides which quota warnings should be shown. Pure JavaScript so the
// de-duplication logic can be tested.

import { METERS } from './constants.js';
import { formatReset } from './format.js';

function template(meter, level, percent, resetsAt, now) {
    const reset = formatReset(resetsAt, now);
    const percentText = `${Math.round(percent)}%`;

    if (level === 'limit') {
        return {
            title: `OpenCode Go · ${meter.label}额度已限流`,
            body: `${meter.label}额度已用尽，${reset}。`,
        };
    }

    if (level === 'critical') {
        return {
            title: `OpenCode Go · ${meter.label}额度即将用尽`,
            body: `${meter.label}额度已使用 ${percentText}，${reset}。`,
        };
    }

    return {
        title: `OpenCode Go · ${meter.label}额度提醒`,
        body: `${meter.label}额度已使用 ${percentText}，${reset}。`,
    };
}

/**
 * @param {object} usage Normalized meters.
 * @param {object} notified Previous notifications: {key: timestamp}.
 * @param {object} options
 * @param {number} options.threshold Warning threshold (percent).
 * @param {boolean} options.rateLimit Notify when a meter is rate-limited.
 * @param {number} options.now Current timestamp.
 * @returns {{due: object[], next: object}}
 */
export function planNotifications(usage, notified = {}, {
    threshold = 80,
    rateLimit = true,
    now = Date.now(),
} = {}) {
    const due = [];
    const next = {};
    const warningThreshold = Math.min(100, Math.max(1, Number(threshold) || 80));

    for (const meter of METERS) {
        const data = usage?.[meter.id];
        if (!data)
            continue;

        const cycle = data.resetsAt ?? 'no-reset';
        const prefix = `${meter.id}:${cycle}:`;

        if (data.status === 'rate-limited') {
            if (!rateLimit)
                continue;

            const key = `${prefix}limit`;
            if (!notified[key]) {
                due.push({
                    key,
                    meterId: meter.id,
                    level: 'limit',
                    ...template(meter, 'limit', data.percent, data.resetsAt, now),
                });
                next[key] = now;
            } else {
                next[key] = notified[key];
            }
            continue;
        }

        if (data.percent < warningThreshold)
            continue;

        const level = data.percent >= 95 ? 'critical' : 'warning';
        const key = `${prefix}${level}`;
        if (!notified[key]) {
            due.push({
                key,
                meterId: meter.id,
                level,
                ...template(meter, level, data.percent, data.resetsAt, now),
            });
            next[key] = now;
        } else {
            next[key] = notified[key];
        }
    }

    return { due, next };
}
