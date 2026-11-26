import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseUsagePayload,
    meterState,
    overallState,
    selectPanelMeter,
    usageSummary,
    UsageParseError,
} from '../src/usage.js';

const fixture = {
    usage: {
        rolling: {
            status: 'ok',
            percent: 8,
            resetsAt: '2026-11-25T16:33:01.000Z',
        },
        weekly: {
            status: 'ok',
            percent: 8,
            resetsAt: '2026-11-30T00:00:00.000Z',
        },
        monthly: {
            status: 'ok',
            percent: 34,
            resetsAt: '2026-12-11T12:52:19.000Z',
        },
    },
};

test('normalizes the documented API payload', () => {
    const usage = parseUsagePayload(fixture);
    assert.equal(usage.rolling.percent, 8);
    assert.equal(usage.weekly.status, 'ok');
    assert.equal(usage.monthly.resetsAt, '2026-12-11T12:52:19.000Z');
    assert.equal(usage.monthly.resetsAtMs, Date.parse('2026-12-11T12:52:19.000Z'));
});

test('accepts the inner usage object and JSON text', () => {
    const inner = parseUsagePayload(fixture.usage);
    assert.equal(inner.rolling.percent, 8);

    const fromText = parseUsagePayload(JSON.stringify(fixture));
    assert.equal(fromText.monthly.percent, 34);
});

test('clamps and rounds percentages', () => {
    const payload = structuredClone(fixture);
    payload.usage.rolling.percent = 104.6;
    payload.usage.weekly.percent = -2;
    payload.usage.monthly.percent = 34.4;

    const usage = parseUsagePayload(payload);
    assert.equal(usage.rolling.percent, 100);
    assert.equal(usage.weekly.percent, 0);
    assert.equal(usage.monthly.percent, 34);
});

test('treats rate-limited status explicitly', () => {
    const payload = structuredClone(fixture);
    payload.usage.weekly.status = 'rate-limited';
    payload.usage.weekly.percent = 100;

    const usage = parseUsagePayload(payload);
    assert.equal(usage.weekly.status, 'rate-limited');
    assert.equal(meterState(usage.weekly), 'limited');
});

test('rejects malformed payloads', () => {
    assert.throws(() => parseUsagePayload('not json'), UsageParseError);

    const missing = structuredClone(fixture);
    delete missing.usage.weekly;
    assert.throws(() => parseUsagePayload(missing), /weekly/);

    const badPercent = structuredClone(fixture);
    badPercent.usage.monthly.percent = 'nope';
    assert.throws(() => parseUsagePayload(badPercent), /percent/);
});

test('calculates visual tones at the fixed thresholds', () => {
    assert.equal(meterState({ percent: 69, status: 'ok' }), 'ok');
    assert.equal(meterState({ percent: 70, status: 'ok' }), 'warning');
    assert.equal(meterState({ percent: 90, status: 'ok' }), 'critical');
    assert.equal(meterState({ percent: 100, status: 'ok' }), 'limited');
    assert.equal(meterState({ percent: 10, status: 'rate-limited' }), 'limited');
    assert.equal(meterState(null), 'muted');
});

test('overall state uses the worst meter', () => {
    const usage = parseUsagePayload(fixture);
    assert.equal(overallState(usage), 'ok');

    usage.weekly.percent = 91;
    assert.equal(overallState(usage), 'critical');

    usage.weekly.status = 'rate-limited';
    assert.equal(overallState(usage), 'limited');
});

test('auto panel metric selects the most constrained meter', () => {
    const usage = parseUsagePayload(fixture);
    assert.equal(selectPanelMeter(usage, 'auto').id, 'monthly');

    usage.weekly.percent = 91;
    assert.equal(selectPanelMeter(usage, 'auto').id, 'weekly');

    usage.weekly.percent = 34;
    assert.equal(selectPanelMeter(usage, 'auto').id, 'monthly');
});

test('auto panel selection prioritizes a rate-limited meter', () => {
    const usage = parseUsagePayload(fixture);
    usage.weekly.status = 'rate-limited';
    usage.weekly.percent = 40;
    assert.equal(selectPanelMeter(usage, 'auto').id, 'weekly');
});

test('pinned panel metric overrides auto selection', () => {
    const usage = parseUsagePayload(fixture);
    assert.equal(selectPanelMeter(usage, 'rolling').id, 'rolling');
    assert.equal(selectPanelMeter(usage, 'weekly').id, 'weekly');
});

test('builds a compact accessible summary', () => {
    const usage = parseUsagePayload(fixture);
    assert.equal(usageSummary(usage), '5 小时 8%，本周 8%，本月 34%');
});
