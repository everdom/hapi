import { useCallback, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ClaudeConfig } from '@/types/api'
import type { ClaudeProfile } from '@/lib/claude-profiles'
import { profileToClaudeConfig } from '@/lib/claude-profiles'
import { useTranslation } from '@/lib/use-translation'
import { ClaudeProfileSelector } from '@/components/NewSession/ClaudeProfileSelector'

export function ClaudeResumeConfigDialog(props: {
    api: ApiClient | null
    open: boolean
    onClose: (config: ClaudeConfig | null) => void
}) {
    const { t } = useTranslation()
    const { open, onClose } = props
    const [selectedProfileId, setSelectedProfileId] = useState('default')
    const [selectedProfile, setSelectedProfile] = useState<ClaudeProfile | null>(null)

    const handleDefault = useCallback(() => {
        onClose(null)
    }, [onClose])

    const handleSelected = useCallback(() => {
        onClose(profileToClaudeConfig(selectedProfile))
    }, [onClose, selectedProfile])

    if (!open) {
        return null
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] shadow-xl">
                <div className="border-b border-[var(--app-divider)] px-4 py-3">
                    <div className="font-semibold text-[var(--app-text)]">
                        {t('newSession.claudeProfile.resumeTitle')}
                    </div>
                    <div className="mt-1 text-sm text-[var(--app-hint)]">
                        {t('newSession.claudeProfile.resumeBody')}
                    </div>
                </div>
                <div className="max-h-[70vh] overflow-y-auto">
                    <ClaudeProfileSelector
                        api={props.api}
                        agent="claude"
                        selectedProfileId={selectedProfileId}
                        isDisabled={false}
                        onSelectedProfileIdChange={setSelectedProfileId}
                        onSelectedProfileChange={setSelectedProfile}
                    />
                </div>
                <div className="flex justify-end gap-2 border-t border-[var(--app-divider)] px-4 py-3">
                    <button
                        type="button"
                        onClick={handleDefault}
                        className="rounded-lg border border-[var(--app-divider)] px-3 py-2 text-sm text-[var(--app-text)]"
                    >
                        {t('newSession.claudeProfile.useDefault')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSelected}
                        className="rounded-lg bg-[var(--app-button)] px-3 py-2 text-sm text-[var(--app-button-text)] transition-opacity hover:opacity-90"
                    >
                        {t('newSession.claudeProfile.useSelected')}
                    </button>
                </div>
            </div>
        </div>
    )
}
