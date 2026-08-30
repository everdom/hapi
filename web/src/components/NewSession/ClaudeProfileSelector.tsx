import { useEffect, useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ClaudeProfile } from '@/lib/claude-profiles'
import {
    CLAUDE_CUSTOM_PROFILE_ID,
    createClaudeProfile,
    loadClaudeProfiles,
    mergeClaudeProfiles,
    saveClaudeProfiles
} from '@/lib/claude-profiles'
import { useTranslation } from '@/lib/use-translation'
import { stripEnclosingQuotes } from '@/lib/path-input'
import type { AgentType } from './types'

function argsToText(args: string[]): string {
    return args.join('\n')
}

function textToArgs(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
}

function deriveCustomName(settingsPath: string, args: string[], fallback: string): string {
    const parts = settingsPath.split(/[\\/]/).filter(Boolean)
    const fileName = parts[parts.length - 1]
    if (fileName) return fileName
    if (args[0]) return args[0].slice(0, 40)
    return fallback
}

export function ClaudeProfileSelector(props: {
    api?: ApiClient | null
    agent: AgentType
    selectedProfileId: string
    isDisabled: boolean
    onSelectedProfileIdChange: (profileId: string) => void
    onSelectedProfileChange?: (profile: ClaudeProfile | null) => void
}) {
    const { t } = useTranslation()
    const onSelectedProfileChange = props.onSelectedProfileChange
    const [profiles, setProfiles] = useState<ClaudeProfile[]>(() => loadClaudeProfiles())
    const [editingId, setEditingId] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [settingsPath, setSettingsPath] = useState('')
    const [argsText, setArgsText] = useState('')
    const [error, setError] = useState<string | null>(null)
    const selectedProfileId = props.selectedProfileId === CLAUDE_CUSTOM_PROFILE_ID ? 'default' : props.selectedProfileId

    useEffect(() => {
        if (props.agent !== 'claude' || !props.api) return
        let cancelled = false
        void (async () => {
            try {
                const localProfiles = loadClaudeProfiles()
                const remote = await props.api?.getClaudeProfiles()
                if (!remote || cancelled) return

                const mergedProfiles = mergeClaudeProfiles(remote.profiles, localProfiles)
                setProfiles(mergedProfiles)
                saveClaudeProfiles(mergedProfiles)
                if (mergedProfiles.length !== remote.profiles.length || localProfiles.length > 0) {
                    await props.api?.saveClaudeProfiles(mergedProfiles)
                }
            } catch {
                // Keep local profiles when the hub is unreachable or older.
            }
        })()
        return () => {
            cancelled = true
        }
    }, [props.agent, props.api])

    const draftProfile = useMemo<ClaudeProfile | null>(() => {
        if (editingId !== '') {
            return null
        }
        const trimmedSettingsPath = stripEnclosingQuotes(settingsPath)
        const args = textToArgs(argsText)
        if (!trimmedSettingsPath && args.length === 0) {
            return null
        }
        return {
            id: CLAUDE_CUSTOM_PROFILE_ID,
            name: name.trim() || deriveCustomName(trimmedSettingsPath, args, t('newSession.claudeProfile.custom')),
            settingsPath: trimmedSettingsPath,
            args,
            createdAt: 0,
            updatedAt: 0
        }
    }, [argsText, editingId, name, settingsPath, t])

    const selectedProfile = useMemo(
        () => {
            return profiles.find((profile) => profile.id === selectedProfileId) ?? null
        },
        [profiles, selectedProfileId]
    )

    useEffect(() => {
        onSelectedProfileChange?.(draftProfile ?? selectedProfile)
    }, [draftProfile, onSelectedProfileChange, selectedProfile])

    if (props.agent !== 'claude') {
        return null
    }

    const beginCreate = () => {
        setEditingId('')
        setName('')
        setSettingsPath('')
        setArgsText('')
        setError(null)
    }

    const beginEdit = () => {
        if (!selectedProfile || selectedProfile.id === CLAUDE_CUSTOM_PROFILE_ID) return
        setEditingId(selectedProfile.id)
        setName(selectedProfile.name)
        setSettingsPath(selectedProfile.settingsPath)
        setArgsText(argsToText(selectedProfile.args))
        setError(null)
    }

    const cancelEdit = () => {
        setEditingId(null)
        setError(null)
    }

    const handleProfileSelect = (profileId: string) => {
        props.onSelectedProfileIdChange(profileId)
        setEditingId(null)
        setError(null)
    }

    const persistProfiles = (nextProfiles: ClaudeProfile[]) => {
        setProfiles(nextProfiles)
        saveClaudeProfiles(nextProfiles)
        void props.api?.saveClaudeProfiles(nextProfiles).catch(() => {})
    }

    const saveProfile = () => {
        const trimmedSettingsPath = stripEnclosingQuotes(settingsPath)
        const args = textToArgs(argsText)
        const trimmedName = name.trim() || deriveCustomName(trimmedSettingsPath, args, t('newSession.claudeProfile.custom'))
        if (!trimmedName) {
            setError(t('newSession.claudeProfile.error.name'))
            return
        }
        if (!trimmedSettingsPath && args.length === 0) {
            setError(t('newSession.claudeProfile.error.empty'))
            return
        }

        if (editingId) {
            const nextProfiles = profiles.map((profile) => profile.id === editingId
                ? {
                    ...profile,
                    name: trimmedName,
                    settingsPath: trimmedSettingsPath,
                    args,
                    updatedAt: Date.now()
                }
                : profile)
            persistProfiles(nextProfiles)
            props.onSelectedProfileIdChange(editingId)
        } else {
            const profile = createClaudeProfile({ name: trimmedName, settingsPath: trimmedSettingsPath, args })
            persistProfiles([...profiles, profile])
            props.onSelectedProfileIdChange(profile.id)
        }
        setEditingId(null)
        setError(null)
    }

    const deleteSelected = () => {
        if (!selectedProfile) return
        const nextProfiles = profiles.filter((profile) => profile.id !== selectedProfile.id)
        persistProfiles(nextProfiles)
        props.onSelectedProfileIdChange('default')
        setEditingId(null)
    }

    return (
        <div className="flex flex-col gap-2 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.claudeProfile')}
            </label>
            <div className="flex gap-2">
                <select
                    value={selectedProfileId}
                    onChange={(event) => handleProfileSelect(event.target.value)}
                    disabled={props.isDisabled}
                    className="min-w-0 flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                >
                    <option value="default">{t('newSession.claudeProfile.default')}</option>
                    {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                            {profile.name}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={beginCreate}
                    disabled={props.isDisabled}
                    className="shrink-0 rounded-lg border border-[var(--app-divider)] px-3 py-2 text-sm text-[var(--app-link)] disabled:opacity-50"
                >
                    {t('newSession.claudeProfile.add')}
                </button>
                {selectedProfile && selectedProfile.id !== CLAUDE_CUSTOM_PROFILE_ID ? (
                    <button
                        type="button"
                        onClick={beginEdit}
                        disabled={props.isDisabled}
                        className="shrink-0 rounded-lg border border-[var(--app-divider)] px-3 py-2 text-sm text-[var(--app-link)] disabled:opacity-50"
                    >
                        {t('newSession.claudeProfile.edit')}
                    </button>
                ) : null}
            </div>
            {selectedProfile && selectedProfile.id !== CLAUDE_CUSTOM_PROFILE_ID ? (
                <div className="text-xs text-[var(--app-hint)]">
                    {selectedProfile.settingsPath || selectedProfile.args.join(' ')}
                </div>
            ) : null}
            {editingId !== null ? (
                <div className="flex flex-col gap-2 rounded-lg border border-[var(--app-divider)] p-3">
                    {editingId === '' ? (
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('newSession.claudeProfile.customDesc')}
                        </div>
                    ) : null}
                    <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder={editingId === '' ? t('newSession.claudeProfile.nameOptional') : t('newSession.claudeProfile.name')}
                        disabled={props.isDisabled}
                        className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <input
                        value={settingsPath}
                        onChange={(event) => setSettingsPath(event.target.value)}
                        onBlur={() => setSettingsPath(stripEnclosingQuotes(settingsPath))}
                        placeholder={t('newSession.claudeProfile.settingsPath')}
                        disabled={props.isDisabled}
                        className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <textarea
                        value={argsText}
                        onChange={(event) => setArgsText(event.target.value)}
                        placeholder={t('newSession.claudeProfile.args')}
                        rows={3}
                        disabled={props.isDisabled}
                        className="w-full resize-y rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    {error ? <div className="text-xs text-red-600">{error}</div> : null}
                    <div className="flex justify-between gap-2">
                        {editingId ? (
                            <button
                                type="button"
                                onClick={deleteSelected}
                                disabled={props.isDisabled}
                                className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 disabled:opacity-50"
                            >
                                {t('newSession.claudeProfile.delete')}
                            </button>
                        ) : <span />}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={props.isDisabled}
                                className="rounded-lg border border-[var(--app-divider)] px-3 py-2 text-sm text-[var(--app-text)] disabled:opacity-50"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={saveProfile}
                                disabled={props.isDisabled}
                                className="rounded-lg bg-[var(--app-button)] px-3 py-2 text-sm text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                                {t('common.save')}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
