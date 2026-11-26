// Minimal HTTP client for the OpenCode Go usage endpoint.

import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { USAGE_ENDPOINT, USER_AGENT } from './constants.js';
import { parseUsagePayload, UsageParseError } from './usage.js';
import { ApiError } from './errors.js';

const REQUEST_TIMEOUT_SECONDS = 20;

export function createSession() {
    return new Soup.Session({
        timeout: REQUEST_TIMEOUT_SECONDS,
        idle_timeout: REQUEST_TIMEOUT_SECONDS,
        user_agent: USER_AGENT,
    });
}

function isGioError(error, code) {
    try {
        return error?.matches?.(Gio.io_error_quark(), code) === true;
    } catch {
        return false;
    }
}

function decodeBytes(bytes) {
    if (!bytes)
        return '';
    try {
        return new TextDecoder('utf-8').decode(bytes.get_data());
    } catch {
        return '';
    }
}

function parseJson(text) {
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function serverMessage(json) {
    if (!json || typeof json !== 'object')
        return null;

    const message = json.error?.message ?? json.message;
    if (typeof message !== 'string' || !message.trim())
        return null;
    return message.trim().slice(0, 240);
}

function httpError(status, json, reason) {
    const detail = serverMessage(json);

    if (status === 401) {
        return new ApiError('API 密钥无效或已过期，请在设置中更新密钥。', {
            code: 'unauthorized',
            status,
            detail,
        });
    }

    if (status === 403) {
        return new ApiError('此 API 密钥没有有效的 OpenCode Go 订阅。请在 Console 中检查订阅状态。', {
            code: 'entitlement',
            status,
            detail,
        });
    }

    if (status === 429) {
        return new ApiError('请求过于频繁，请稍后再试。', {
            code: 'rate-limit',
            status,
            detail,
        });
    }

    if (status >= 500) {
        return new ApiError(`额度服务暂时不可用（HTTP ${status}）。`, {
            code: 'server',
            status,
            detail,
        });
    }

    return new ApiError(`请求失败（HTTP ${status}${reason ? ` ${reason}` : ''}）。`, {
        code: 'http',
        status,
        detail,
    });
}

/**
 * Fetch and normalize the three usage meters.
 *
 * @param {string} apiKey OpenCode Go key.
 * @param {object} options
 * @param {Soup.Session} [options.session] Reusable session.
 * @param {Gio.Cancellable} [options.cancellable]
 * @param {string} [options.endpoint]
 * @returns {Promise<object>} Normalized usage object.
 */
export async function fetchUsage(apiKey, {
    session = null,
    cancellable = null,
    endpoint = USAGE_ENDPOINT,
} = {}) {
    const key = String(apiKey ?? '').trim();
    if (!key)
        throw new ApiError('尚未配置 API 密钥。', { code: 'no-key' });

    const ownSession = !session;
    const soupSession = session ?? createSession();

    const message = Soup.Message.new('GET', endpoint);
    if (!message) {
        if (ownSession)
            soupSession.abort();
        throw new ApiError('额度接口地址无效。', { code: 'invalid-endpoint' });
    }

    message.request_headers.append('Authorization', `Bearer ${key}`);
    message.request_headers.append('Accept', 'application/json');
    message.request_headers.append('Cache-Control', 'no-cache');
    message.request_headers.append('Pragma', 'no-cache');
    message.request_headers.append('User-Agent', USER_AGENT);

    let bytes;
    try {
        bytes = await new Promise((resolve, reject) => {
            soupSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (source, result) => {
                    try {
                        resolve(source.send_and_read_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    } catch (error) {
        if (ownSession)
            soupSession.abort();

        if (cancellable?.is_cancelled() ||
            isGioError(error, Gio.IOErrorEnum.CANCELLED)) {
            throw new ApiError('请求已取消。', { code: 'cancelled' });
        }

        if (isGioError(error, Gio.IOErrorEnum.TIMED_OUT)) {
            throw new ApiError('连接额度端点超时，请检查网络。', {
                code: 'network',
                detail: error.message,
            });
        }

        throw new ApiError('无法连接额度端点，请检查网络连接。', {
            code: 'network',
            detail: error?.message ?? String(error),
        });
    }

    if (ownSession)
        soupSession.abort();

    const status = message.get_status();
    const text = decodeBytes(bytes);
    const json = parseJson(text);

    if (status !== Soup.Status.OK)
        throw httpError(status, json, message.get_reason_phrase());

    if (!json) {
        throw new ApiError('额度接口返回了无法解析的数据。', {
            code: 'invalid-response',
            status,
        });
    }

    try {
        return parseUsagePayload(json);
    } catch (error) {
        if (error instanceof UsageParseError) {
            throw new ApiError(error.message, {
                code: 'invalid-response',
                status,
                detail: text.slice(0, 240),
            });
        }
        throw error;
    }
}
