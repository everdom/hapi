import { join } from 'node:path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import { shellJoin } from '@/modules/common/shellQuote';
import { LOCAL_PERMISSION_TIMEOUT_SECONDS } from '@/claude/utils/localPermissionProtocol';

type HookCommandConfig = {
    matcher?: string;
    hooks: Array<{
        type: 'command';
        command: string;
        /** Per-command timeout in SECONDS (claude's hook schema). */
        timeout?: number;
    }>;
};

type HookSettings = {
    hooksConfig?: {
        enabled?: boolean;
    };
    hooks: {
        SessionStart: HookCommandConfig[];
        UserPromptSubmit?: HookCommandConfig[];
        PreToolUse?: HookCommandConfig[];
        PermissionRequest?: HookCommandConfig[];
        PostToolUse?: HookCommandConfig[];
        PostToolUseFailure?: HookCommandConfig[];
        SessionEnd?: HookCommandConfig[];
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
    /** Mirror main-session permissions without suppressing the native dialog. Local only. */
    includeLocalPermissions?: boolean;
};

export function buildHookSettings(
    command: string,
    hooksEnabled?: boolean,
    trackPermissionMode?: boolean,
    includeLocalPermissions?: boolean
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
    if (trackPermissionMode || includeLocalPermissions) {
        hooks.UserPromptSubmit = [commandHook];
        hooks.PreToolUse = [{ matcher: '*', ...commandHook }];
    }

    if (includeLocalPermissions) {
        hooks.PermissionRequest = [{
            matcher: '*',
            hooks: [{ type: 'command', command, timeout: LOCAL_PERMISSION_TIMEOUT_SECONDS }]
        }];
        hooks.PostToolUse = [{ matcher: '*', ...commandHook }];
        hooks.PostToolUseFailure = [{ matcher: '*', ...commandHook }];
        hooks.SessionEnd = [{ matcher: '*', ...commandHook }];
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
        options.includeLocalPermissions
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
 * Result of merging a user-supplied Claude settings file with hapi's
 * auto-generated hooks. `path` is the merged settings file hapi hands to
 * Claude Code via `--settings`; `envVars` is the `env.*` block lifted out of
 * the user's file so the caller can also push it into the spawn env (Claude
 * Code reads settings.json's `env` as a process-env seed, and the merged
 * `--settings` file alone isn't enough — Claude Code still reads
 * `~/.claude/settings.json` first, and that file's `env` block can shadow the
 * one we passed through `--settings`).
 */
export type MergedClaudeSettings = {
    path: string
    envVars: Record<string, string>
}

/**
 * Merge a user-provided Claude settings file with hapi's auto-generated hook
 * settings. The user's settings are loaded first; then hapi's hooks (and any
 * hapi-only keys like `hooksConfig.enabled`) are overlaid on top. The result
 * is written to a fresh temp file under `<happyHomeDir>/tmp/hooks/` so the
 * user's source file is left untouched.
 *
 * Returns the merged file path + the user-supplied env block lifted out as a
 * flat key→value map. If the user file cannot be read, returns the hook
 * settings path unchanged and an empty env map (so we still ship working
 * hooks, just without user-supplied customisations).
 */
export function mergeClaudeSettingsFile(
    userSettingsPath: string,
    hookSettingsPath: string,
    options: { filenamePrefix: string; logLabel: string }
): MergedClaudeSettings {
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
        return { path: hookSettingsPath, envVars: {} };
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

    // Lift the user-supplied `env` block into a flat key→value map so the
    // caller can push it into the spawn env. We deliberately do NOT include
    // hapi-injected vars here — those are managed by the caller.
    const userEnvRecord = userSettings.env as Record<string, unknown> | undefined;
    const envVars: Record<string, string> = {};
    if (userEnvRecord && typeof userEnvRecord === 'object' && !Array.isArray(userEnvRecord)) {
        for (const [key, value] of Object.entries(userEnvRecord)) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                envVars[key] = String(value);
            }
        }
    }

    try {
        writeFileSync(mergedPath, JSON.stringify(merged, null, 4));
        logger.debug(`[${options.logLabel}] Merged user settings into: ${mergedPath}`);
        return { path: mergedPath, envVars };
    } catch (error) {
        logger.debug(`[${options.logLabel}] Failed to write merged settings: ${error}`);
        return { path: hookSettingsPath, envVars };
    }
}
