import type { ClaudeConfig } from '@/types/api'

const PROFILES_STORAGE_KEY = 'hapi:claudeProfiles'
export const CLAUDE_CUSTOM_PROFILE_ID = 'custom'

export type ClaudeProfile = {
    id: string
    name: string
    settingsPath: string
    args: string[]
    createdAt: number
    updatedAt: number
}

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

export function findMatchingClaudeProfile(
    profiles: ClaudeProfile[],
    input: { settingsPath: string; args: string[] }
): ClaudeProfile | null {
    const settingsPath = input.settingsPath.trim()
    const args = input.args.map((arg) => arg.trim()).filter(Boolean)
    return profiles.find((profile) => (
        profile.settingsPath === settingsPath
        && profile.args.length === args.length
        && profile.args.every((arg, index) => arg === args[index])
    )) ?? null
}

export function profileToClaudeConfig(profile: ClaudeProfile | null | undefined): ClaudeConfig | null {
    if (!profile) return null
    if (!profile.settingsPath && profile.args.length === 0) return null
    return {
        profileId: profile.id,
        profileName: profile.name,
        settingsPath: profile.settingsPath || undefined,
        args: profile.args.length > 0 ? profile.args : undefined
    }
}