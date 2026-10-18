import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ClaudeProfile, CcSwitchProvider } from '@/types/api'
import {
    CLAUDE_CC_SWITCH_PROFILE_PREFIX,
    CLAUDE_CUSTOM_PROFILE_ID,
    createClaudeProfile,
    fetchClaudeProfiles,
    isCcSwitchProfileId,
    loadClaudeProfiles,
    pushClaudeProfiles,
    saveClaudeProfiles
} from '@/lib/claude-profiles'
import { useTranslation } from '@/lib/use-translation'
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

/** Tabs of the profile selector: saved/hapi-managed profiles vs cc-switch providers. */
type ProfileTab = 'profiles' | 'cc-switch'

type Props = {
    api: ApiClient
    agent: AgentType
    selectedProfileId: string
    isDisabled: boolean
    onSelectedProfileIdChange: (profileId: string) => void
    onSelectedProfileChange?: (profile: ClaudeProfile | null) => void
}

export function ClaudeProfileSelector(props: Props) {
    const { t } = useTranslation()
    const [profiles, setProfiles] = useState<ClaudeProfile[]>(() => loadClaudeProfiles())
    const [ccSwitchProviders, setCcSwitchProviders] = useState<CcSwitchProvider[]>([])
    const [editingId, setEditingId] = useState<string | null>(null)
    const [name, setName] = useState('')
    const [settingsPath, setSettingsPath] = useState('')
    const [argsText, setArgsText] = useState('')
    const [customName, setCustomName] = useState('')
    const [customSettingsPath, setCustomSettingsPath] = useState('')
    const [customArgsText, setCustomArgsText] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [syncWarning, setSyncWarning] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<ProfileTab>('profiles')
    const isCustomSelected = props.selectedProfileId === CLAUDE_CUSTOM_PROFILE_ID
    // Keep the latest push result in sync even if the hub normalizes entries;
    // track mount state so a slow first fetch cannot overwrite newer edits.
    const mountedRef = useRef(true)
    useEffect(() => {
        mountedRef.current = true
        void fetchClaudeProfiles(props.api).then((fetched) => {
            if (mountedRef.current) {
                setProfiles(fetched)
            }
        })
        // cc-switch providers are read-only and refreshed on every mount; a
        // failure (not installed / hub unreachable) just yields an empty group.
        void props.api.getCcSwitchProviders().then((response) => {
            if (mountedRef.current) {
                setCcSwitchProviders(Array.isArray(response?.providers) ? response.providers : [])
            }
        }).catch(() => {})
        return () => {
            mountedRef.current = false
        }
    }, [props.api])

    const customProfile = useMemo<ClaudeProfile | null>(() => {
        const trimmedSettingsPath = customSettingsPath.trim()
        const args = textToArgs(customArgsText)
        if (!trimmedSettingsPath && args.length === 0) {
            return null
        }
        return {
            id: CLAUDE_CUSTOM_PROFILE_ID,
            name: customName.trim() || deriveCustomName(trimmedSettingsPath, args, t('newSession.claudeProfile.custom')),
            settingsPath: trimmedSettingsPath,
            args,
            createdAt: 0,
            updatedAt: 0
        }
    }, [customArgsText, customName, customSettingsPath, t])

    // A cc-switch selection surfaces as a synthetic profile so the parent form's
    // spawn path (profileName display etc.) keeps working unchanged. The CLI
    // materializes the actual settings at spawn time from the cc-switch db.
    const selectedCcSwitchProvider = useMemo(() => {
        const providerId = isCcSwitchProfileId(props.selectedProfileId)
            ? props.selectedProfileId.slice(CLAUDE_CC_SWITCH_PROFILE_PREFIX.length)
            : null
        if (!providerId) return null
        return ccSwitchProviders.find((provider) => provider.id === providerId) ?? null
    }, [ccSwitchProviders, props.selectedProfileId])

    const selectedProfile = useMemo(() => {
        if (isCustomSelected) {
            return customProfile
        }
        if (selectedCcSwitchProvider) {
            return {
                id: props.selectedProfileId,
                name: selectedCcSwitchProvider.name,
                settingsPath: '',
                args: [],
                createdAt: 0,
                updatedAt: 0
            }
        }
        return profiles.find((profile) => profile.id === props.selectedProfileId) ?? null
    }, [customProfile, isCustomSelected, profiles, props.selectedProfileId, selectedCcSwitchProvider])

    // Follow the selection: a cc-switch id restored from localStorage or picked
    // elsewhere must land on the cc-switch tab, and vice versa.
    useEffect(() => {
        if (isCcSwitchProfileId(props.selectedProfileId)) {
            setActiveTab('cc-switch')
        }
    }, [props.selectedProfileId])

    if (props.agent !== 'claude') {
        // Surface the selection up so the parent form's claudeConfig stays in
        // sync even when the selector is hidden for non-Claude agents.
        props.onSelectedProfileChange?.(null)
        return null
    }

    props.onSelectedProfileChange?.(selectedProfile)

    const beginCreate = () => {
        setEditingId('')
        setName('')
        setSettingsPath('')
        setArgsText('')
        setError(null)
    }

    const beginEdit = () => {
        if (!selectedProfile || selectedProfile.id === CLAUDE_CUSTOM_PROFILE_ID || isCcSwitchProfileId(selectedProfile.id)) return
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

    const persistProfiles = (nextProfiles: ClaudeProfile[]) => {
        setProfiles(nextProfiles)
        saveClaudeProfiles(nextProfiles)
        void pushClaudeProfiles(props.api, nextProfiles).then((saved) => {
            if (!mountedRef.current) return
            if (saved) {
                setProfiles(saved)
                setSyncWarning(null)
            } else {
                setSyncWarning(t('newSession.claudeProfile.syncFailed'))
            }
        })
    }

    const saveProfile = () => {
        const trimmedName = name.trim()
        const trimmedSettingsPath = settingsPath.trim()
        const args = textToArgs(argsText)
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
        if (!selectedProfile || isCcSwitchProfileId(selectedProfile.id)) return
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
            <div className="flex gap-1">
                <button
                    type="button"
                    onClick={() => setActiveTab('profiles')}
                    disabled={props.isDisabled}
                    className={activeTab === 'profiles'
                        ? 'flex-1 rounded-lg bg-[var(--app-button)] px-3 py-1.5 text-xs font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:opacity-50'
                        : 'flex-1 rounded-lg border border-[var(--app-divider)] px-3 py-1.5 text-xs font-medium text-[var(--app-hint)] transition-opacity hover:opacity-80 disabled:opacity-50'}
                >
                    {t('newSession.claudeProfile.tab.profiles')}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('cc-switch')}
                    disabled={props.isDisabled || ccSwitchProviders.length === 0}
                    className={activeTab === 'cc-switch'
                        ? 'flex-1 rounded-lg bg-[var(--app-button)] px-3 py-1.5 text-xs font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:opacity-50'
                        : 'flex-1 rounded-lg border border-[var(--app-divider)] px-3 py-1.5 text-xs font-medium text-[var(--app-hint)] transition-opacity hover:opacity-80 disabled:opacity-50'}
                >
                    {t('newSession.claudeProfile.tab.ccSwitch')}
                </button>
            </div>
            {activeTab === 'profiles' ? (
                <div className="flex gap-2">
                    <select
                        value={props.selectedProfileId}
                        onChange={(event) => props.onSelectedProfileIdChange(event.target.value)}
                        disabled={props.isDisabled}
                        className="min-w-0 flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    >
                        <option value="default">{t('newSession.claudeProfile.default')}</option>
                        <option value={CLAUDE_CUSTOM_PROFILE_ID}>{t('newSession.claudeProfile.custom')}</option>
                        {profiles.length > 0 ? profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                                {profile.name}
                            </option>
                        )) : null}
                    </select>
                    <button
                        type="button"
                        onClick={beginCreate}
                        disabled={props.isDisabled}
                        className="shrink-0 rounded-lg border border-[var(--app-divider)] px-3 py-2 text-sm text-[var(--app-link)] disabled:opacity-50"
                    >
                        {t('newSession.claudeProfile.add')}
                    </button>
                    {selectedProfile && selectedProfile.id !== CLAUDE_CUSTOM_PROFILE_ID && !isCcSwitchProfileId(selectedProfile.id) ? (
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
            ) : ccSwitchProviders.length > 0 ? (
                <select
                    value={props.selectedProfileId}
                    onChange={(event) => props.onSelectedProfileIdChange(event.target.value)}
                    disabled={props.isDisabled}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                >
                    {ccSwitchProviders.map((provider) => (
                        <option
                            key={provider.id}
                            value={`${CLAUDE_CC_SWITCH_PROFILE_PREFIX}${provider.id}`}
                        >
                            {provider.name}{provider.isCurrent ? ` (${t('newSession.claudeProfile.ccSwitchCurrent')})` : ''}
                        </option>
                    ))}
                </select>
            ) : (
                <div className="rounded-lg border border-[var(--app-divider)] px-3 py-2 text-xs text-[var(--app-hint)]">
                    {t('newSession.claudeProfile.ccSwitchEmpty')}
                </div>
            )}
            {selectedProfile && selectedProfile.id !== CLAUDE_CUSTOM_PROFILE_ID && !isCcSwitchProfileId(selectedProfile.id) ? (
                <div className="text-xs text-[var(--app-hint)]">
                    {selectedProfile.settingsPath || selectedProfile.args.join(' ')}
                </div>
            ) : null}
            {selectedCcSwitchProvider ? (
                <div className="text-xs text-[var(--app-hint)]">
                    {t('newSession.claudeProfile.ccSwitchDesc')}
                </div>
            ) : null}
            {syncWarning ? (
                <div className="text-xs text-amber-600">{syncWarning}</div>
            ) : null}
            {isCustomSelected ? (
                <div className="flex flex-col gap-2 rounded-lg border border-[var(--app-divider)] p-3">
                    <div className="text-xs font-medium text-[var(--app-hint)]">
                        {t('newSession.claudeProfile.oneOff')}
                    </div>
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('newSession.claudeProfile.customDesc')}
                    </div>
                    <input
                        value={customName}
                        onChange={(event) => setCustomName(event.target.value)}
                        placeholder={t('newSession.claudeProfile.nameOptional')}
                        disabled={props.isDisabled}
                        className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <input
                        value={customSettingsPath}
                        onChange={(event) => setCustomSettingsPath(event.target.value)}
                        placeholder={t('newSession.claudeProfile.settingsPath')}
                        disabled={props.isDisabled}
                        className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <textarea
                        value={customArgsText}
                        onChange={(event) => setCustomArgsText(event.target.value)}
                        placeholder={t('newSession.claudeProfile.args')}
                        rows={4}
                        disabled={props.isDisabled}
                        className="w-full resize-y rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                </div>
            ) : null}
            {editingId !== null ? (
                <div className="flex flex-col gap-2 rounded-lg border border-[var(--app-divider)] p-3">
                    <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder={t('newSession.claudeProfile.name')}
                        disabled={props.isDisabled}
                        className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <input
                        value={settingsPath}
                        onChange={(event) => setSettingsPath(event.target.value)}
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