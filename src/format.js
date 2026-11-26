// Human-readable formatting helpers. Pure JavaScript so they can be tested
// without a GNOME Shell session.

import { METERS, STATE_LABELS } from './constants.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toTimestamp(value) {
    if (value === null || value === undefined)
        return NaN;
    if (typeof value === 'number')
        return value;
    return Date.parse(value);
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function localDateParts(timestamp) {
    const date = new Date(timestamp);
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
    };
}

export function formatPercent(value) {
    if (value === null || value === undefined || value === '')
        return '—';

    const number = Number(value);
    if (!Number.isFinite(number))
        return '—';
    return `${Math.min(100, Math.max(0, Math.round(number)))}%`;
}

/**
 * Examples: "3 小时后重置", "2 天 4 小时后重置",
 * "12月11日 20:52 重置".
 */
export function formatReset(value, now = Date.now()) {
    const timestamp = toTimestamp(value);
    if (!Number.isFinite(timestamp))
        return '重置时间未知';

    const remaining = timestamp - now;
    if (remaining <= 0)
        return '即将重置';

    if (remaining < MINUTE)
        return '不到 1 分钟后重置';

    if (remaining < HOUR) {
        const minutes = Math.max(1, Math.ceil(remaining / MINUTE));
        return `${minutes} 分钟后重置`;
    }

    if (remaining < DAY) {
        const hours = Math.floor(remaining / HOUR);
        const minutes = Math.floor((remaining % HOUR) / MINUTE);
        return minutes > 0
            ? `${hours} 小时 ${minutes} 分后重置`
            : `${hours} 小时后重置`;
    }

    if (remaining < 7 * DAY) {
        const days = Math.floor(remaining / DAY);
        const hours = Math.floor((remaining % DAY) / HOUR);
        return hours > 0
            ? `${days} 天 ${hours} 小时后重置`
            : `${days} 天后重置`;
    }

    const parts = localDateParts(timestamp);
    const nowParts = localDateParts(now);
    const date = parts.year === nowParts.year
        ? `${parts.month}月${parts.day}日`
        : `${parts.year}年${parts.month}月${parts.day}日`;

    return `${date} ${pad2(parts.hour)}:${pad2(parts.minute)} 重置`;
}

export function formatUpdatedAgo(fetchedAt, now = Date.now()) {
    const timestamp = Number(fetchedAt);
    if (!Number.isFinite(timestamp) || timestamp <= 0)
        return '尚未更新';

    const elapsed = Math.max(0, now - timestamp);
    if (elapsed < 15 * 1000)
        return '刚刚更新';
    if (elapsed < MINUTE)
        return '不到 1 分钟前更新';
    if (elapsed < HOUR)
        return `${Math.floor(elapsed / MINUTE)} 分钟前更新`;
    if (elapsed < DAY)
        return `${Math.floor(elapsed / HOUR)} 小时前更新`;

    const parts = localDateParts(timestamp);
    return `${parts.month}月${parts.day}日 ${pad2(parts.hour)}:${pad2(parts.minute)} 更新`;
}


export function formatTestResult(usage) {
    if (!usage)
        return '连接成功';

    const values = METERS
        .map(meter => `${meter.label} ${formatPercent(usage[meter.id]?.percent)}`)
        .join(' · ');
    return `连接成功 · ${values}`;
}

export function statusText(state) {
    return STATE_LABELS[state] ?? STATE_LABELS.muted;
}

export function isStale(fetchedAt, intervalMinutes, now = Date.now()) {
    const timestamp = Number(fetchedAt);
    if (!Number.isFinite(timestamp) || timestamp <= 0)
        return true;

    const interval = Math.max(1, Number(intervalMinutes) || 5) * MINUTE;
    return now - timestamp > Math.max(interval * 3, 10 * MINUTE);
}

export function maskApiKey(key) {
    const value = String(key ?? '').trim();
    if (!value)
        return '未设置';
    if (value.length <= 8)
        return '••••••';
    return `${value.slice(0, 3)}…${value.slice(-4)}`;
}
