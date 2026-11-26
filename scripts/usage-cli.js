#!/usr/bin/env -S gjs -m
// OpenCode Go quota CLI.
//
// Key lookup order:
//   1. OPENCODE_GO_API_KEY
//   2. GNOME Keyring (same item as the extension)
//   3. Active credential from `opencode auth export` (read-only)
//
// The key is never printed.

import System from 'system';
import GLib from 'gi://GLib';

import { fetchUsage } from '../src/api.js';
import { lookupApiKey } from '../src/keyring.js';
import { importFromOpencode } from '../src/opencode.js';
import { isValidEndpoint } from '../src/endpoint.js';
import { METERS, USAGE_ENDPOINT, VERSION } from '../src/constants.js';
import { formatPercent, formatReset } from '../src/format.js';
import { friendlyError } from '../src/errors.js';

const BAR_WIDTH = 18;

function helpText() {
    return `OpenCode Go 额度 ${VERSION}

用法:
  opencode-go-usage-v2 [选项]

选项:
  --json             输出 JSON
  --endpoint URL     覆盖 usage 端点（默认 ${USAGE_ENDPOINT}）
  -h, --help         显示帮助
  -v, --version      显示版本

环境变量:
  OPENCODE_GO_API_KEY             显式指定 API 密钥
  OPENCODE_GO_USAGE_ENDPOINT      覆盖 usage 端点
  OPENCODE_BIN                    指定 opencode 可执行文件

密钥查找顺序: 环境变量 → GNOME 密钥环 → opencode auth export
`;
}

function parseArgs(argv) {
    const options = {
        json: false,
        endpoint: GLib.getenv('OPENCODE_GO_USAGE_ENDPOINT') || USAGE_ENDPOINT,
        help: false,
        version: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--json') {
            options.json = true;
        } else if (arg === '--endpoint') {
            const value = argv[++index];
            if (!value)
                throw new Error('--endpoint 需要一个 URL');
            options.endpoint = value;
        } else if (arg.startsWith('--endpoint=')) {
            options.endpoint = arg.slice('--endpoint='.length);
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--version' || arg === '-v') {
            options.version = true;
        } else {
            throw new Error(`未知参数：${arg}`);
        }
    }

    options.endpoint = String(options.endpoint ?? '').trim();
    if (!isValidEndpoint(options.endpoint))
        throw new Error('API 端点必须是 http:// 或 https:// 地址');

    return options;
}

async function resolveKey() {
    const environmentKey = GLib.getenv('OPENCODE_GO_API_KEY');
    if (environmentKey && environmentKey.trim()) {
        return {
            key: environmentKey.trim(),
            source: '环境变量',
        };
    }

    try {
        const storedKey = await lookupApiKey();
        if (storedKey && storedKey.trim()) {
            return {
                key: storedKey.trim(),
                source: 'GNOME 密钥环',
            };
        }
    } catch {
        // Keyring may be locked or unavailable; try OpenCode below.
    }

    try {
        const credential = await importFromOpencode();
        return {
            key: credential.key,
            source: `OpenCode · ${credential.label}`,
        };
    } catch (error) {
        throw new Error(
            `未找到 API 密钥。${error?.message ?? ''}` +
            ' 请设置 OPENCODE_GO_API_KEY，或在扩展设置中导入。'
        );
    }
}

function progressBar(percent) {
    const filled = Math.min(
        BAR_WIDTH,
        Math.max(percent > 0 ? 1 : 0, Math.round(percent / 100 * BAR_WIDTH))
    );
    return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`;
}

async function main() {
    const options = parseArgs([...ARGV]);

    if (options.help) {
        print(helpText());
        return;
    }

    if (options.version) {
        print(`opencode-go-usage-v2 ${VERSION}`);
        return;
    }

    const { key, source } = await resolveKey();
    const usage = await fetchUsage(key, {
        session: null,
        cancellable: null,
        endpoint: options.endpoint,
    });

    if (options.json) {
        print(JSON.stringify({
            version: VERSION,
            endpoint: options.endpoint,
            keySource: source,
            fetchedAt: new Date().toISOString(),
            usage,
        }, null, 2));
        return;
    }

    print(`OpenCode Go ${VERSION}`);
    print(options.endpoint);
    print(`密钥：${source}`);
    print('');

    for (const meter of METERS) {
        const data = usage[meter.id];
        const status = data.status === 'rate-limited' ? '  [已达上限]' : '';
        print(
            `${meter.label.padEnd(6)} ${progressBar(data.percent)} ` +
            `${formatPercent(data.percent).padStart(4)}  ` +
            `${formatReset(data.resetsAt)}${status}`
        );
    }
}

try {
    await main();
} catch (error) {
    printerr(`错误：${friendlyError(error)}`);
    System.exit(1);
}
