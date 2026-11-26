// Shared constants for the OpenCode Go usage indicator.

export const VERSION = '2.1.0';
export const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.opencode-go-usage-v2';

export const USAGE_ENDPOINT = 'https://opencode.ai/inference/go/v1/usage';
export const CONSOLE_URL = 'https://opencode.ai/console/go';
export const USER_AGENT = `opencode-go-usage-v2/${VERSION} (GNOME Shell extension)`;

export const METERS = [
    { id: 'rolling', label: '5 小时', longLabel: '5 小时窗口' },
    { id: 'weekly', label: '本周', longLabel: '每周额度' },
    { id: 'monthly', label: '本月', longLabel: '每月额度' },
];

export const METER_IDS = METERS.map(meter => meter.id);
export const METER_TIE_ORDER = ['monthly', 'weekly', 'rolling'];


// Percent thresholds used for the visual tone. They are intentionally fixed:
// the configurable notification threshold should not change the dashboard colors.
export const WARNING_PERCENT = 70;
export const CRITICAL_PERCENT = 90;

export const STATE_LABELS = {
    ok: '正常',
    warning: '注意',
    critical: '接近上限',
    limited: '已达上限',
    muted: '未知',
};

export const STATE_RANK = {
    ok: 0,
    warning: 1,
    critical: 2,
    limited: 3,
    muted: -1,
};

// Start/end colours for the progress arc (RGB, 0..1).
export const STATE_COLORS = {
    ok: {
        start: [0.16, 0.78, 0.85],
        end: [0.22, 0.82, 0.60],
    },
    warning: {
        start: [0.96, 0.62, 0.04],
        end: [0.98, 0.75, 0.14],
    },
    critical: {
        start: [0.96, 0.26, 0.37],
        end: [0.98, 0.45, 0.53],
    },
    limited: {
        start: [0.88, 0.11, 0.28],
        end: [0.96, 0.26, 0.37],
    },
    muted: {
        start: [0.60, 0.63, 0.68],
        end: [0.70, 0.73, 0.77],
    },
};

export const CACHE_VERSION = 2;
