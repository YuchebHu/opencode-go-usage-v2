import test from 'node:test';
import assert from 'node:assert/strict';

import { planNotifications } from '../src/notifications.js';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');

function usage(overrides = {}) {
    return {
        rolling: {
            status: 'ok',
            percent: 20,
            resetsAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
        },
        weekly: {
            status: 'ok',
            percent: 85,
            resetsAt: new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
        monthly: {
            status: 'ok',
            percent: 10,
            resetsAt: new Date(NOW + 20 * 24 * 60 * 60 * 1000).toISOString(),
        },
        ...overrides,
    };
}

test('emits a warning once per reset cycle', () => {
    const first = planNotifications(usage(), {}, { threshold: 80, now: NOW });
    assert.equal(first.due.length, 1);
    assert.equal(first.due[0].meterId, 'weekly');
    assert.equal(first.due[0].level, 'warning');
    assert.match(first.due[0].body, /85%/);

    const second = planNotifications(usage(), first.next, { threshold: 80, now: NOW });
    assert.equal(second.due.length, 0);
});

test('does not warn below the threshold', () => {
    const result = planNotifications(usage(), {}, { threshold: 90, now: NOW });
    assert.equal(result.due.length, 0);
});

test('uses a critical level at 95 percent or more', () => {
    const result = planNotifications(
        usage({ monthly: {
            status: 'ok',
            percent: 96,
            resetsAt: new Date(NOW + 20 * 24 * 60 * 60 * 1000).toISOString(),
        } }),
        {},
        { threshold: 80, now: NOW }
    );
    assert.equal(result.due.length, 2);
    assert.equal(result.due[0].meterId, 'weekly');
    assert.equal(result.due[0].level, 'warning');
    assert.equal(result.due[1].level, 'critical');
});

test('rate-limited meters produce a distinct notification', () => {
    const limited = usage({ weekly: {
        status: 'rate-limited',
        percent: 100,
        resetsAt: new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString(),
    } });

    const result = planNotifications(limited, {}, {
        threshold: 80,
        rateLimit: true,
        now: NOW,
    });
    assert.equal(result.due.length, 1);
    assert.equal(result.due[0].level, 'limit');
    assert.match(result.due[0].title, /已限流/);

    const disabled = planNotifications(limited, {}, {
        threshold: 80,
        rateLimit: false,
        now: NOW,
    });
    assert.equal(disabled.due.length, 0);
});

test('prunes state from previous reset cycles', () => {
    const first = planNotifications(usage(), {}, { threshold: 80, now: NOW });
    const oldKeys = Object.keys(first.next);
    assert.ok(oldKeys.length > 0);

    const quiet = usage({
        weekly: {
            status: 'ok',
            percent: 10,
            resetsAt: new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
    });
    const second = planNotifications(quiet, first.next, { threshold: 80, now: NOW });
    assert.equal(second.due.length, 0);
    assert.equal(Object.keys(second.next).length, 0);
});
