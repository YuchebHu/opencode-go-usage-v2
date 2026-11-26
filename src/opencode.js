// Reads the active OpenCode Go credential from the local `opencode` CLI.
// Only used for explicit imports, optional first-run auto-import, and the CLI.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { importGoCredentialFromExport } from './import.js';

const EXPORT_TIMEOUT_SECONDS = 15;

export function findOpencodeExecutable() {
    const override = GLib.getenv('OPENCODE_BIN');
    if (override && GLib.file_test(override, GLib.FileTest.IS_EXECUTABLE | GLib.FileTest.IS_REGULAR))
        return override;

    const inPath = GLib.find_program_in_path('opencode');
    if (inPath)
        return inPath;

    const candidates = [
        GLib.build_filenamev([GLib.get_home_dir(), '.opencode', 'bin', 'opencode']),
        '/usr/local/bin/opencode',
        '/usr/bin/opencode',
    ];
    return candidates.find(path => GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE | GLib.FileTest.IS_REGULAR)) ?? null;
}

export function runAuthExport(cancellable = null) {
    return new Promise((resolve, reject) => {
        const executable = findOpencodeExecutable();
        if (!executable) {
            reject(new Error('未找到 opencode 命令。请安装 OpenCode，或手动粘贴 API 密钥。'));
            return;
        }

        let process;
        try {
            process = Gio.Subprocess.new(
                [executable, 'auth', 'export'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (error) {
            reject(new Error(`无法运行 opencode：${error.message}`));
            return;
        }

        let cancelId = 0;
        if (cancellable) {
            cancelId = cancellable.connect(() => {
                try {
                    process.force_exit();
                } catch {
                    // Already exited.
                }
            });
        }

        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, EXPORT_TIMEOUT_SECONDS, () => {
            timeoutId = 0;
            try {
                process.force_exit();
            } catch {
                // Already exited.
            }
            return GLib.SOURCE_REMOVE;
        });

        process.communicate_utf8_async(null, cancellable, (source, result) => {
            if (cancelId && cancellable)
                cancellable.disconnect(cancelId);
            if (timeoutId) {
                GLib.source_remove(timeoutId);
                timeoutId = 0;
            }

            try {
                const [, stdout, stderr] = source.communicate_utf8_finish(result);
                if (!source.get_successful()) {
                    const detail = String(stderr ?? '').trim() ||
                        `退出码 ${source.get_exit_status()}`;
                    reject(new Error(`opencode auth export 失败：${detail}`));
                    return;
                }
                resolve(stdout);
            } catch (error) {
                if (cancellable?.is_cancelled())
                    reject(new Error('读取 OpenCode 凭据已取消'));
                else
                    reject(error);
            }
        });
    });
}

export async function importFromOpencode(cancellable = null) {
    const stdout = await runAuthExport(cancellable);
    return importGoCredentialFromExport(stdout);
}
