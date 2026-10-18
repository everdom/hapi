import React, { useMemo, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { SelectedClaudeConfig } from '@/claude/utils/configSelector'

type ClaudeProfileLike = NonNullable<SelectedClaudeConfig['profile']>

type CcSwitchProviderLike = {
    id: string
    name: string
    isCurrent: boolean
}

export type ClaudeConfigPickerProps = {
    profiles: ClaudeProfileLike[]
    ccSwitchProviders: CcSwitchProviderLike[]
    onSelect: (selection: SelectedClaudeConfig) => void
    onCancel: () => void
}

type Tab = 'profiles' | 'cc-switch'

interface Entry {
    label: string
    detail?: string
    current?: boolean
    selection: SelectedClaudeConfig
}

// Same wide-codepoint ranges as ResumeSessionPicker, for CJK-safe padding.
const WIDE_RANGES: Array<[number, number]> = [
    [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3],
    [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60],
    [0xffe0, 0xffe6], [0x1f300, 0x1faff]
]

function columnWidth(value: string): number {
    let width = 0
    for (const char of value) {
        const codePoint = char.codePointAt(0) ?? 0
        const wide = WIDE_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi)
        width += wide ? 2 : 1
    }
    return width
}

function truncateColumns(value: string, maxWidth: number): string {
    if (columnWidth(value) <= maxWidth) return value
    if (maxWidth <= 3) return '.'.repeat(maxWidth)
    let width = 0
    let result = ''
    for (const char of value) {
        const codePoint = char.codePointAt(0) ?? 0
        const wide = WIDE_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi)
        const charWidth = wide ? 2 : 1
        if (width + charWidth > maxWidth - 3) break
        result += char
        width += charWidth
    }
    return `${result}...`
}

export const ClaudeConfigPicker: React.FC<ClaudeConfigPickerProps> = ({
    profiles,
    ccSwitchProviders,
    onSelect,
    onCancel
}) => {
    const { stdout } = useStdout()
    const terminalWidth = stdout.columns || 80
    const width = Math.max(40, terminalWidth - 4)
    // cc-switch first: it's the more convenient daily choice. Fall back to
    // profiles when no providers were detected.
    const [tab, setTab] = useState<Tab>(ccSwitchProviders.length > 0 ? 'cc-switch' : 'profiles')
    const [query, setQuery] = useState('')
    const [index, setIndex] = useState(0)

    // Tab order matches the web NewSession selector: cc-switch first.
    const tabs: Tab[] = useMemo(() => {
        const list: Tab[] = []
        if (ccSwitchProviders.length > 0) list.push('cc-switch')
        if (profiles.length > 0) list.push('profiles')
        return list
    }, [profiles.length, ccSwitchProviders.length])

    const entries: Record<Tab, Entry[]> = useMemo(() => ({
        profiles: [
            { label: 'Default (no settings override)', selection: { kind: 'default' } },
            ...profiles.map((profile) => ({
                label: profile.name,
                detail: profile.settingsPath,
                selection: { kind: 'profile', profile } as SelectedClaudeConfig
            }))
        ],
        'cc-switch': ccSwitchProviders.map((provider) => ({
            label: provider.name,
            current: provider.isCurrent,
            selection: { kind: 'cc-switch', ccSwitchProviderId: provider.id } as SelectedClaudeConfig
        }))
    }), [profiles, ccSwitchProviders])

    const filtered = useMemo(() => {
        const q = query.toLowerCase()
        return entries[tab].filter((entry) => !q || entry.label.toLowerCase().includes(q))
    }, [entries, tab, query])

    const selectedIndex = Math.min(index, Math.max(0, filtered.length - 1))
    const active = filtered[selectedIndex]

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            onCancel()
            return
        }
        if (key.tab && tabs.length > 1) {
            setTab((current) => tabs[(tabs.indexOf(current) + 1) % tabs.length] ?? current)
            setQuery('')
            setIndex(0)
            return
        }
        if (key.upArrow) {
            setIndex(Math.max(0, selectedIndex - 1))
            return
        }
        if (key.downArrow) {
            setIndex(Math.min(filtered.length - 1, selectedIndex + 1))
            return
        }
        if (key.pageUp || key.home) {
            setIndex(0)
            return
        }
        if (key.pageDown || key.end) {
            setIndex(Math.max(0, filtered.length - 1))
            return
        }
        if (key.return) {
            if (active) onSelect(active.selection)
            return
        }
        if (key.escape) {
            if (query.length > 0) {
                setQuery('')
                setIndex(0)
            } else {
                onCancel()
            }
            return
        }
        if (key.backspace || key.delete) {
            setQuery((current) => current.slice(0, -1))
            setIndex(0)
            return
        }
        if (input && input.length === 1 && input >= ' ' && input !== '\u007f') {
            setQuery((current) => current + input)
            setIndex(0)
        }
    })

    return (
        <Box flexDirection="column" width={terminalWidth}>
            <Text bold>Select a Claude configuration</Text>
            <Box marginTop={1}>
                {tabs.map((t) => (
                    <Box key={t} marginRight={1}>
                        <Text
                            bold={t === tab}
                            color={t === tab ? 'cyan' : 'gray'}
                            inverse={t === tab}
                        >
                            {' '}{t === 'profiles' ? `Profiles (${entries.profiles.length})` : `cc-switch (${entries['cc-switch'].length})`}{' '}
                        </Text>
                    </Box>
                ))}
            </Box>
            {tab === 'cc-switch' ? (
                <Text color="gray">
                    cc-switch — Search: <Text color={query ? 'cyan' : 'gray'}>{query || 'type to filter'}</Text>
                </Text>
            ) : (
                <Text color="gray">
                    Profiles — Search: <Text color={query ? 'cyan' : 'gray'}>{query || 'type to filter'}</Text>
                </Text>
            )}
            <Box flexDirection="column" marginTop={1}>
                {filtered.length === 0 ? (
                    <Text color="gray">No matching configurations</Text>
                ) : (
                    filtered.map((entry, i) => {
                        const selected = i === selectedIndex
                        const suffix = entry.current ? '  (in use)' : ''
                        const detail = entry.detail
                            ? truncateColumns(entry.detail, Math.max(10, width - columnWidth(entry.label + suffix) - 8))
                            : ''
                        const line = `${entry.label}${suffix}${detail ? `  —  ${detail}` : ''}`
                        return (
                            <Text
                                key={`${entry.selection.kind}-${entry.label}-${i}`}
                                color={selected ? 'cyan' : entry.current ? 'green' : undefined}
                            >
                                {selected ? '❯ ' : '  '}{line}
                            </Text>
                        )
                    })
                )}
            </Box>
            <Box marginTop={1}>
                <Text color="gray">Tab switch group | ↑/↓ move | type to filter | Enter select | Esc cancel</Text>
            </Box>
        </Box>
    )
}
