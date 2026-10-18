import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsPageContent, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import { queryKeys } from '@/lib/query-keys'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
    { value: 'ru', label: 'Русский' },
]

function getNamespace(token: string | null): string | null {
    if (!token) return null
    try {
        const payload = token.split('.')[1]
        if (!payload) return null
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
        const decoded = JSON.parse(atob(base64)) as { ns?: unknown }
        return typeof decoded.ns === 'string' ? decoded.ns : null
    } catch {
        return null
    }
}

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { api, baseUrl, token } = useAppContext()
    const queryClient = useQueryClient()
    const isOwner = getNamespace(token) === 'default'

    const hubSettingsQuery = useQuery({
        queryKey: queryKeys.hubSettings,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getHubSettings()
        },
        enabled: Boolean(api) && isOwner,
        staleTime: 30_000,
        retry: false,
    })

    const hubSettingsMutation = useMutation({
        mutationFn: async (patch: { sessionSummaryContract?: boolean; sessionSummaryInChat?: boolean; ccSwitchDbPath?: string | null }) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateHubSettings(patch)
        },
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.hubSettings, data)
        },
    })

    const [ccSwitchDbPathDraft, setCcSwitchDbPathDraft] = useState<string | null>(null)
    const savedCcSwitchDbPath = hubSettingsQuery.data?.ccSwitchDbPath ?? ''
    const ccSwitchDbPathValue = ccSwitchDbPathDraft ?? savedCcSwitchDbPath

    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
            </SettingsSection>
            {isOwner ? (
                <SettingsSection
                    title={t('settings.general.sessionSummary.title')}
                    description={t('settings.general.sessionSummary.description')}
                >
                    {hubSettingsQuery.data ? (
                        <>
                            <SettingsSwitch
                                label={t('settings.general.sessionSummaryContract')}
                                description={t('settings.general.sessionSummaryContract.desc')}
                                checked={hubSettingsQuery.data.sessionSummaryContract}
                                onChange={(checked) => {
                                    if (hubSettingsMutation.isPending) return
                                    hubSettingsMutation.mutate({ sessionSummaryContract: checked })
                                }}
                            />
                            <SettingsSwitch
                                label={t('settings.general.sessionSummaryInChat')}
                                description={t('settings.general.sessionSummaryInChat.desc')}
                                checked={hubSettingsQuery.data.sessionSummaryInChat}
                                onChange={(checked) => {
                                    if (hubSettingsMutation.isPending) return
                                    hubSettingsMutation.mutate({ sessionSummaryInChat: checked })
                                }}
                            />
                        </>
                    ) : null}
                </SettingsSection>
            ) : null}
            {isOwner ? (
                <SettingsSection
                    title={t('settings.general.ccSwitch.title')}
                    description={t('settings.general.ccSwitch.description')}
                >
                    <div className="flex flex-col gap-2 px-3 py-3">
                        <input
                            value={ccSwitchDbPathValue}
                            onChange={(event) => setCcSwitchDbPathDraft(event.target.value)}
                            placeholder={t('settings.general.ccSwitch.placeholder')}
                            className="w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={hubSettingsMutation.isPending || ccSwitchDbPathDraft === null || ccSwitchDbPathDraft === savedCcSwitchDbPath}
                                onClick={() => {
                                    hubSettingsMutation.mutate({ ccSwitchDbPath: ccSwitchDbPathValue.trim() || null })
                                    setCcSwitchDbPathDraft(null)
                                }}
                                className="rounded-lg bg-[var(--app-button)] px-3 py-2 text-sm text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                                {t('common.save')}
                            </button>
                            {ccSwitchDbPathDraft !== null ? (
                                <button
                                    type="button"
                                    onClick={() => setCcSwitchDbPathDraft(null)}
                                    className="rounded-lg border border-[var(--app-divider)] px-3 py-2 text-sm text-[var(--app-text)]"
                                >
                                    {t('common.cancel')}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </SettingsSection>
            ) : null}
            <SettingsSection title={t('settings.companion.title')}>
                <div className="px-3 py-3">
                    <CompanionPairing baseUrl={baseUrl} />
                </div>
            </SettingsSection>
        </SettingsPageContent>
    )
}
