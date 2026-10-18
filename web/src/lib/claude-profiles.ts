import type { ApiClient } from '@/api/client'
import type { ClaudeConfig, ClaudeProfile } from '@/types/api'

const PROFILES_STORAGE_KEY = 'hapi:claudeProfiles'
// Marks that this device already synced against the hub at least once. The
// one-time local→hub migration must only seed from the device that still has
// legacy localStorage data; without this flag a device whose cache holds stale
// entries could resurrect profiles another device deleted from the hub.
const MIGRATION_DONE_KEY = 'hapi:claudeProfiles.migrated'
export const CLAUDE_CUSTOM_PROFILE_ID = 'custom'

/** Prefix for selector option ids backed by a cc-switch provider. */
export const CLAUDE_CC_SWITCH_PROFILE_PREFIX = 'cc-switch:'

export function isCcSwitchProfileId(profileId: string): boolean {
    return profileId.startsWith(CLAUDE_CC_SWITCH_PROFILE_PREFIX)
}

export type { ClaudeProfile }

function makeId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeProfile(value: unknown): ClaudeProfile | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const id = typeof record.id === 'string' && record.id ? record.id : makeId()
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const settingsPath = typeof record.settingsPath === 'string' ? record.settingsPath.trim() : ''
    const args = Array.isArray(record.args)
        ? record.args.filter((arg): arg is string => typeof arg === 'string').map((arg) => arg.trim()).filter(Boolean)
        : []
    if (!name || (!settingsPath && args.length === 0)) return null
    const now = Date.now()
    return {
        id,
        name,
        settingsPath,
        args,
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now
    }
}

export function loadClaudeProfiles(): ClaudeProfile[] {
    try {
        const raw = localStorage.getItem(PROFILES_STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.map(normalizeProfile).filter((profile): profile is ClaudeProfile => profile !== null)
    } catch {
        return []
    }
}

export function saveClaudeProfiles(profiles: ClaudeProfile[]): void {
    try {
        localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles))
    } catch {
        // Ignore storage errors
    }
}

function hasProfileMigrationDone(): boolean {
    try {
        return localStorage.getItem(MIGRATION_DONE_KEY) === '1'
    } catch {
        return false
    }
}

function markProfileMigrationDone(): void {
    try {
        localStorage.setItem(MIGRATION_DONE_KEY, '1')
    } catch {
        // Ignore storage errors
    }
}

/**
 * Upload the full profile list to the hub and refresh the local cache with the
 * hub-normalized result. Returns null when the hub rejected/failed the write —
 * the caller keeps the optimistic local copy and can retry on the next save.
 */
export async function pushClaudeProfiles(api: ApiClient, profiles: ClaudeProfile[]): Promise<ClaudeProfile[] | null> {
    try {
        const response = await api.saveClaudeProfiles(profiles)
        const saved = Array.isArray(response?.profiles) ? response.profiles : profiles
        saveClaudeProfiles(saved)
        return saved
    } catch {
        return null
    }
}

/**
 * Hub-backed profile list with localStorage as cache.
 *
 * - Hub has profiles → hub wins, cache refreshed (devices converge on edits/deletes).
 * - Hub empty and this device still holds legacy localStorage profiles →
 *   one-time migration: upload local as the seed (guarded by a migrated flag
 *   so deleted-from-hub profiles cannot resurrect from another device's stale cache).
 * - Hub unreachable → serve cache.
 */
export async function fetchClaudeProfiles(api: ApiClient): Promise<ClaudeProfile[]> {
    try {
        const response = await api.getClaudeProfiles()
        const remote = Array.isArray(response?.profiles) ? response.profiles : []
        if (remote.length === 0 && !hasProfileMigrationDone()) {
            const local = loadClaudeProfiles()
            if (local.length > 0) {
                markProfileMigrationDone()
                await pushClaudeProfiles(api, local)
                return loadClaudeProfiles()
            }
        }
        markProfileMigrationDone()
        saveClaudeProfiles(remote)
        return remote
    } catch {
        return loadClaudeProfiles()
    }
}

export function createClaudeProfile(input: { name: string; settingsPath: string; args: string[] }): ClaudeProfile {
    const now = Date.now()
    return {
        id: makeId(),
        name: input.name.trim(),
        settingsPath: input.settingsPath.trim(),
        args: input.args.map((arg) => arg.trim()).filter(Boolean),
        createdAt: now,
        updatedAt: now
    }
}

/**
 * Normalize a settings path so cross-platform comparisons ignore trailing
 * separators, slash direction, and case (Windows file paths are case-
 * insensitive and hapi forwards whatever the operator typed, e.g. `C:\Users\…`
 * vs `c:/users/…`). We deliberately do NOT touch the string's substance
 * (no `path.resolve`) because we want to mirror whatever the session actually
 * uses, not the cwd-relative interpretation.
 */
export function normalizeSettingsPath(value: string): string {
    return value.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function findMatchingClaudeProfile(
    profiles: ClaudeProfile[],
    input: { settingsPath: string; args: string[] }
): ClaudeProfile | null {
    const settingsPath = normalizeSettingsPath(input.settingsPath)
    if (!settingsPath) return null
    // Match on settings path alone. CLI-spawned sessions carry whatever args
    // the operator passed (`--hapi-claude-arg`), which may differ from what the
    // web profile saved (e.g. profile has empty args but CLI added a `--model`),
    // so requiring exact arg equality would defeat the whole purpose of the
    // lookup for the common "started from terminal, but I do have a profile
    // saved with the same settings file" case.
    return profiles.find((profile) => normalizeSettingsPath(profile.settingsPath) === settingsPath) ?? null
}

/**
 * Build the spawn-time claudeConfig. cc-switch selections (synthetic profiles
 * with a `cc-switch:` id prefix) resolve to a `ccSwitchProviderId` instead of a
 * settings path — the CLI materializes the settings file from the cc-switch db
 * at launch, so no secret ever round-trips through the web UI.
 */
export function profileToClaudeConfig(profile: ClaudeProfile | null | undefined): ClaudeConfig | null {
    if (!profile) return null
    const ccSwitchProviderId = isCcSwitchProfileId(profile.id)
        ? profile.id.slice(CLAUDE_CC_SWITCH_PROFILE_PREFIX.length)
        : null
    if (ccSwitchProviderId) {
        return {
            profileId: profile.id,
            profileName: profile.name,
            ccSwitchProviderId
        }
    }
    if (!profile.settingsPath && profile.args.length === 0) return null
    return {
        profileId: profile.id,
        profileName: profile.name,
        settingsPath: profile.settingsPath || undefined,
        args: profile.args.length > 0 ? profile.args : undefined
    }
}