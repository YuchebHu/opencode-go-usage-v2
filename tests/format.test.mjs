import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatPercent,
    formatReset,
    formatUpdatedAgo,
    formatTestResult,
    statusText,
    isStale,
    maskApiKey,
} from '../src/format.js';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('formats percentages', () => {
    assert.equal(formatPercent(34), '34%');
    assert.equal(formatPercent(34.6), '35%');
    assert.equal(formatPercent(-1), '0%');
    assert.equal(formatPercent(101), '100%');
    assert.equal(formatPercent(null), '—');
});

test('formats reset countdowns', () => {
    assert.equal(formatReset(NOW + 30 * 1000, NOW), '不到 1 分钟后重置');
    assert.equal(formatReset(NOW + 30 * MINUTE, NOW), '30 分钟后重置');
    assert.equal(formatReset(NOW + 2 * HOUR, NOW), '2 小时后重置');
    assert.equal(formatReset(NOW + (3 * HOUR + 12 * MINUTE), NOW), '3 小时 12 分后重置');
    assert.equal(formatReset(NOW + 2 * DAY, NOW), '2 天后重置');
    assert.equal(formatReset(NOW + (2 * DAY + 4 * HOUR), NOW), '2 天 4 小时后重置');
    assert.equal(formatReset(NOW - 1000, NOW), '即将重置');
});

test('falls back to a local date for distant resets', () => {
    const text = formatReset(NOW + 12 * DAY, NOW);
    assert.match(text, /^\d{1,2}月\d{1,2}日 \d{2}:\d{2} 重置$/);
});

test('handles missing reset timestamps', () => {
    assert.equal(formatReset(null, NOW), '重置时间未知');
    assert.equal(formatReset('not-a-date', NOW), '重置时间未知');
});

test('formats last-updated text', () => {
    assert.equal(formatUpdatedAgo(NOW - 5 * 1000, NOW), '刚刚更新');
    assert.equal(formatUpdatedAgo(NOW - 30 * 1000, NOW), '不到 1 分钟前更新');
    assert.equal(formatUpdatedAgo(NOW - 90 * 1000, NOW), '1 分钟前更新');
    assert.equal(formatUpdatedAgo(NOW - 2 * HOUR, NOW), '2 小时前更新');
    assert.equal(formatUpdatedAgo(NOW + HOUR, NOW), '刚刚更新');
    assert.equal(formatUpdatedAgo(0, NOW), '尚未更新');
});

test('formats verification results', () => {
    const usage = {
        rolling: { percent: 8 },
        weekly: { percent: 8 },
        monthly: { percent: 34 },
    };
    assert.equal(
        formatTestResult(usage),
        '连接成功 · 5 小时 8% · 本周 8% · 本月 34%'
    );
    assert.equal(formatTestResult(null), '连接成功');
});

test('maps states to Chinese labels', () => {
    assert.equal(statusText('ok'), '正常');
    assert.equal(statusText('warning'), '注意');
    assert.equal(statusText('critical'), '接近上限');
    assert.equal(statusText('limited'), '已达上限');
    assert.equal(statusText('muted'), '未知');
});

test('detects stale cache data', () => {
    assert.equal(isStale(NOW - 9 * MINUTE, 5, NOW), false);
    assert.equal(isStale(NOW - 16 * MINUTE, 5, NOW), true);
    assert.equal(isStale(0, 5, NOW), true);
});

test('masks keys', () => {
    assert.equal(maskApiKey(''), '未设置');
    assert.equal(maskApiKey('short'), '••••••');
    assert.equal(maskApiKey('test-1234567890abcd'), 'tes…abcd');
});
