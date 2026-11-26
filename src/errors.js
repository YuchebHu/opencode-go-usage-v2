// Error types shared by the extension and preferences.

export class ApiError extends Error {
    constructor(message, { code = 'unknown', status = null, detail = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        this.detail = detail;
    }
}

export function isCancelledError(error) {
    return error?.code === 'cancelled';
}

export function errorNeedsSettings(error) {
    return error instanceof ApiError &&
        ['unauthorized', 'entitlement', 'no-key'].includes(error.code);
}

export function friendlyError(error) {
    if (error instanceof ApiError)
        return error.message;
    if (error?.message)
        return error.message;
    return String(error ?? '未知错误');
}

export function keyringError(message) {
    return new ApiError(message, { code: 'keyring' });
}
