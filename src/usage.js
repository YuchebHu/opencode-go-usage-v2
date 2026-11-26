// Parsing and state helpers for the OpenCode Go usage payload.
// This module intentionally has no GNOME imports so it can be unit-tested
// with plain Node.js.

import {
    METER_IDS,
    METER_TIE_ORDER,
    STATE_RANK,
    WARNING_PERCENT,
    CRITICAL_PERCENT,
} from './constants.js';

export class UsageParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UsageParseError';
    }
}

function normalizePercent(value, meterId) {
    const percent = Number(value);
    if (!Number.isFinite(percent))
        throw new UsageParseError(`额度响应中的 ${meterId}.percent 无效`);

    return Math.min(100, Math.max(0, Math.round(percent)));
}

function normalizeMeter(meterId, raw) {
    if (!raw || typeof raw !== 'object')
        throw new UsageParseError(`额度响应缺少 ${meterId} 窗口`);

    let resetsAt = null;
    if (typeof raw.resetsAt === 'string') {
        const timestamp = Date.parse(raw.resetsAt);
        if (Number.isFinite(timestamp))
            resetsAt = new Date(timestamp).toISOString();
    }

    return {
        id: meterId,
        status: raw.status === 'rate-limited' ? 'rate-limited' : 'ok',
        percent: normalizePercent(raw.percent, meterId),
        resetsAt,
        resetsAtMs: resetsAt ? Date.parse(resetsAt) : null,
    };
}

/**
 * Accepts the parsed JSON response (or the JSON text) from
 * GET /inference/go/v1/usage and returns normalized meters.
 */
export function parseUsagePayload(payload) {
    let data = payload;

    if (typeof payload === 'string') {
        try {
            data = JSON.parse(payload);
        } catch {
            throw new UsageParseError('服务器返回了无法解析的 JSON');
        }
    }

    if (!data || typeof data !== 'object')
        throw new UsageParseError('额度响应格式无效');

    const root = data.usage && typeof data.usage === 'object' ? data.usage : data;
    const usage = {};

    for (const meterId of METER_IDS)
        usage[meterId] = normalizeMeter(meterId, root[meterId]);

    return usage;
}

export function meterState(meter, {
    warning = WARNING_PERCENT,
    critical = CRITICAL_PERCENT,
} = {}) {
    if (!meter)
        return 'muted';
    if (meter.status === 'rate-limited' || meter.percent >= 100)
        return 'limited';
    if (meter.percent >= critical)
        return 'critical';
    if (meter.percent >= warning)
        return 'warning';
    return 'ok';
}

export function overallState(usage, thresholds = {}) {
    if (!usage)
        return 'muted';

    let state = 'ok';
    for (const meterId of METER_IDS) {
        const next = meterState(usage[meterId], thresholds);
        if (STATE_RANK[next] > STATE_RANK[state])
            state = next;
    }
    return state;
}

/**
 * Chooses which meter the panel label represents.
 * In auto mode the most constrained meter wins; ties prefer the longest window.
 */
export function selectPanelMeter(usage, metric = 'auto') {
    if (!usage)
        return null;

    if (metric !== 'auto' && METER_IDS.includes(metric))
        return usage[metric] ?? null;

    // A rate-limited window is the most constrained state even if the server
    // reports a percentage below 100.
    for (const meterId of METER_TIE_ORDER) {
        const meter = usage[meterId];
        if (meter && (meter.status === 'rate-limited' || meter.percent >= 100))
            return meter;
    }

    let selected = null;
    for (const meterId of METER_TIE_ORDER) {
        const meter = usage[meterId];
        if (!meter)
            continue;
        if (!selected || meter.percent > selected.percent)
            selected = meter;
    }
    return selected;
}

export function meterLabel(meterId) {
    const labels = {
        rolling: '5 小时',
        weekly: '本周',
        monthly: '本月',
    };
    return labels[meterId] ?? meterId;
}

export function usageSummary(usage) {
    if (!usage)
        return '暂无额度数据';

    return METER_IDS
        .map(meterId => `${meterLabel(meterId)} ${usage[meterId].percent}%`)
        .join('，');
}
