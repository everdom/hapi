import { join } from 'node:path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import { shellJoin } from '@/modules/common/shellQuote';

type HookCommandConfig = {
    matcher?: string;
    hooks: Array<{
        type: 'command';
        command: string;
        /** Per-command timeout in SECONDS (claude's hook schema). */
        timeout?: number;
    }>;
};

// PreToolUse bridges a tool approval to the web and blocks the (synchronous)
// hook until the user answers on their phone — which can take minutes. claude's
// default command-hook timeout is 60s; on timeout the decision is dropped and
// claude falls back to its own permission prompt (which renders in the TUI
// and stalls the chat flow). Give the PreToolUse hook a generous timeout so a
// human has time to respond.
const PRE_TOOL_USE_TIMEOUT_SECONDS = 3600;

type HookSettings = {
    hooksConfig?: {
        enabled?: boolean;
    };
    hooks: {
        SessionStart: HookCommandConfig[];
        UserPromptSubmit?: HookCommandConfig[];
        PreToolUse?: HookCommandConfig[];
    };
};

export type HookSettingsOptions = {
    filenamePrefix: string;
    logLabel: string;
    hooksEnabled?: boolean;
    /**
     * Also forward UserPromptSubmit and PreToolUse hooks. Unlike SessionStart,
     * their payloads carry `permission_mode`, letting HAPI track the mode the
     * user picks inside the interactive TUI (shift+tab). Keep this off for the
     * remote SDK process: these hooks block Claude while the forwarder runs,
     * and remote permission state is owned by the hub/RPC path anyway.
     */
    trackPermissionMode?: boolean;
    /**
     * Register a PreToolUse hook (PTY mode only). The SDK path routes tool
     * approvals through the SDK's canUseTool callback, so it must NOT register
     * PreToolUse or every tool would be double-handled. PTY sessions have no
     * SDK callback, so they rely on this hook to bridge tool approvals to the
     * web. The same forwarder command serves both events; it branches on the
     * stdin `hook_event_name`.
     */
    includePreToolUse?: boolean;
};

export function buildHookSettings(
    command: string,
    hooksEnabled?: boolean,
    trackPermissionMode?: boolean,
    includePreToolUse?: boolean
): HookSettings {
    const commandHook = {
        hooks: [
            {
                type: 'command' as const,
                command
            }
        ]
    };
    const hooks: HookSettings['hooks'] = {
        SessionStart: [{ matcher: '*', ...commandHook }]
    };
    if (trackPermissionMode) {
        hooks.UserPromptSubmit = [commandHook];
        hooks.PreToolUse = [{ matcher: '*', ...commandHook }];
    }

    if (includePreToolUse) {
        // matcher '*' matches every tool name (claude's matcher: !q || q==='*' → all).
        // The same forwarder command serves both events; it branches on the
        // stdin hook_event_name. The long timeout keeps the (blocking) hook
        // alive while the user approves on their phone.
        hooks.PreToolUse = [
            {
                matcher: '*',
                hooks: [{ type: 'command', command, timeout: PRE_TOOL_USE_TIMEOUT_SECONDS }]
            }
        ];
    }

    const settings: HookSettings = { hooks };
    if (hooksEnabled !== undefined) {
        settings.hooksConfig = {
            enabled: hooksEnabled
        };
    }

    return settings;
}

export function generateHookSettingsFile(
    port: number,
    token: string,
    options: HookSettingsOptions
): string {
    const hooksDir = join(configuration.happyHomeDir, 'tmp', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    const filename = `${options.filenamePrefix}-${process.pid}.json`;
    const filepath = join(hooksDir, filename);

    const { command, args } = getHappyCliCommand([
        'hook-forwarder',
        '--flavor', 'claude',
        '--port',
        String(port),
        '--token',
        token
    ]);
    const hookCommand = shellJoin([command, ...args]);

    const settings = buildHookSettings(
        hookCommand,
        options.hooksEnabled,
        options.trackPermissionMode,
        options.includePreToolUse
    );

    writeFileSync(filepath, JSON.stringify(settings, null, 4));
    logger.debug(`[${options.logLabel}] Created hook settings file: ${filepath}`);

    return filepath;
}

export function cleanupHookSettingsFile(filepath: string, logLabel: string): void {
    try {
        if (existsSync(filepath)) {
            unlinkSync(filepath);
            logger.debug(`[${logLabel}] Cleaned up hook settings file: ${filepath}`);
        }
    } catch (error) {
        logger.debug(`[${logLabel}] Failed to cleanup hook settings file: ${error}`);
    }
}

/**
 * Merge a user-provided Claude settings file with hapi's auto-generated hook
 * settings. The user's settings are loaded first; then hapi's hooks (and any
 * hapi-only keys like `hooksConfig.enabled`) are overlaid on top. The result
 * is written to a fresh temp file under `<happyHomeDir>/tmp/hooks/` so the
 * user's source file is left untouched.
 *
 * Returns the merged file path. If the user file cannot be read, returns the
 * hook settings path unchanged (so we still ship working hooks, just without
 * user-supplied customisations).
 */
export function mergeClaudeSettingsFile(
    userSettingsPath: string,
    hookSettingsPath: string,
    options: { filenamePrefix: string; logLabel: string }
): string {
    const hooksDir = join(configuration.happyHomeDir, 'tmp', 'hooks');
    mkdirSync(hooksDir, { recursive: true });

    const filename = `${options.filenamePrefix}-${process.pid}.json`;
    const mergedPath = join(hooksDir, filename);

    let userSettings: Record<string, unknown> = {};
    try {
        const raw = readFileSync(userSettingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            userSettings = parsed as Record<string, unknown>;
        } else {
            logger.debug(`[${options.logLabel}] User settings at ${userSettingsPath} is not an object; ignoring.`);
        }
    } catch (error) {
        logger.debug(`[${options.logLabel}] Could not read user settings at ${userSettingsPath}: ${error}`);
        return hookSettingsPath;
    }

    let hookSettings: Record<string, unknown> = {};
    try {
        const raw = readFileSync(hookSettingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            hookSettings = parsed as Record<string, unknown>;
        }
    } catch (error) {
        logger.debug(`[${options.logLabel}] Could not read hook settings at ${hookSettingsPath}: ${error}`);
    }

    const merged: Record<string, unknown> = { ...userSettings, ...hookSettings };

    // Deep-merge the `hooks` key so user-defined and hapi-defined hook events
    // both survive.
    const userHooks = userSettings.hooks as Record<string, unknown> | undefined;
    const hookHooks = hookSettings.hooks as Record<string, unknown> | undefined;
    if (userHooks || hookHooks) {
        const mergedHooks: Record<string, unknown> = { ...(userHooks ?? {}) };
        if (hookHooks) {
            for (const [event, value] of Object.entries(hookHooks)) {
                const existing = mergedHooks[event];
                if (Array.isArray(existing) && Array.isArray(value)) {
                    mergedHooks[event] = [...(value as unknown[]), ...(existing as unknown[])];
                } else {
                    mergedHooks[event] = value;
                }
            }
        }
        merged.hooks = mergedHooks;
    }

    try {
        writeFileSync(mergedPath, JSON.stringify(merged, null, 4));
        logger.debug(`[${options.logLabel}] Merged user settings into: ${mergedPath}`);
        return mergedPath;
    } catch (error) {
        logger.debug(`[${options.logLabel}] Failed to write merged settings: ${error}`);
        return hookSettingsPath;
    }
}
