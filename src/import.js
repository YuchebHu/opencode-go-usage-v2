// Helpers for importing an existing OpenCode Go credential from
// `opencode auth export`. Pure JavaScript (no GNOME imports).

export function parseAuthExport(text) {
    let data = text;
    if (typeof text === 'string') {
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('无法解析 opencode auth export 的输出');
        }
    }

    if (Array.isArray(data))
        return data;

    if (data && Array.isArray(data.credentials))
        return data.credentials;

    throw new Error('opencode auth export 返回了未知格式');
}

function usableGoCredentials(accounts) {
    return accounts.filter(account => {
        return account?.integrationID === 'opencode-go' &&
            account?.value?.type === 'key' &&
            typeof account.value.key === 'string' &&
            account.value.key.trim().length > 0;
    });
}

/**
 * Returns the active Go key, or the only stored Go key when none is active.
 * Throws when no usable credential can be found.
 */
export function pickGoCredential(accounts) {
    const credentials = usableGoCredentials(accounts);
    if (credentials.length === 0)
        throw new Error('OpenCode 中没有找到 OpenCode Go 密钥');

    const active = credentials.find(account => account.active === true);
    if (active) {
        return {
            key: active.value.key.trim(),
            label: active.label || 'OpenCode Go',
            active: true,
        };
    }

    if (credentials.length === 1) {
        const only = credentials[0];
        return {
            key: only.value.key.trim(),
            label: only.label || 'OpenCode Go',
            active: false,
        };
    }

    throw new Error('OpenCode 中有多个 Go 密钥，请先在 OpenCode 中启用一个');
}

export function importGoCredentialFromExport(text) {
    return pickGoCredential(parseAuthExport(text));
}
