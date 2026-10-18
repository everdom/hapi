import axios from 'axios'
import React from 'react'
import { render } from 'ink'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { logger } from '@/ui/logger'
import { ClaudeConfigPicker } from '@/ui/ink/ClaudeConfigPicker'

// Mirrors the web-side ClaudeProfile shape (hub GET /api/claude-profiles).
export interface ClaudeProfileLike {
    id: string
    name: string
    settingsPath: string
    args: string[]
}

// Mirrors the hub's cc-switch listing: safe fields only (no tokens).
export interface CcSwitchProviderLike {
    id: string
    name: string
    isCurrent: boolean
}

/** What the user picked in the interactive menu, mapped onto StartOptions fields. */
export interface SelectedClaudeConfig {
    kind: 'default' | 'profile' | 'cc-switch'
    profile?: ClaudeProfileLike
    ccSwitchProviderId?: string
}

// The hub's /api/* routes require a JWT (web-session style), not the raw CLI
// access token — same flow as pingPeer: exchange the access token at
// POST /api/auth, then use the returned JWT as Bearer.
async function exchangeJwt(): Promise<string | null> {
    const accessToken = getAuthToken()
    if (!accessToken) {
        return null
    }
    try {
        const response = await axios.post<{ token?: string }>(
            `${configuration.apiUrl}/api/auth`,
            { accessToken },
            {
                headers: buildHubRequestHeaders({ 'Content-Type': 'application/json' }),
                timeout: 5000,
                validateStatus: () => true
            }
        )
        const token = typeof response.data?.token === 'string' ? response.data.token : ''
        if (response.status < 200 || response.status >= 300 || !token) {
            logger.warn(`[ConfigSelector] JWT exchange failed (HTTP ${response.status}): skipping config menu`)
            return null
        }
        return token
    } catch (error) {
        logger.warn(`[ConfigSelector] JWT exchange failed: ${error instanceof Error ? error.message : error}`)
        return null
    }
}

async function fetchClaudeProfiles(jwt: string): Promise<ClaudeProfileLike[]> {
    try {
        const response = await axios.get<{ profiles: ClaudeProfileLike[] }>(
            `${configuration.apiUrl}/api/claude-profiles`,
            {
                headers: buildHubRequestHeaders({ Authorization: `Bearer ${jwt}` }),
                timeout: 5000
            }
        )
        return Array.isArray(response.data?.profiles) ? response.data.profiles : []
    } catch (error) {
        logger.warn(`[ConfigSelector] Failed to fetch claude profiles: ${error instanceof Error ? error.message : error}`)
        return []
    }
}

async function fetchCcSwitchProviders(jwt: string): Promise<CcSwitchProviderLike[]> {
    try {
        const response = await axios.get<{ providers: CcSwitchProviderLike[] }>(
            `${configuration.apiUrl}/api/cc-switch/claude-providers`,
            {
                headers: buildHubRequestHeaders({ Authorization: `Bearer ${jwt}` }),
                timeout: 5000
            }
        )
        return Array.isArray(response.data?.providers) ? response.data.providers : []
    } catch (error) {
        logger.warn(`[ConfigSelector] Failed to fetch cc-switch providers: ${error instanceof Error ? error.message : error}`)
        return []
    }
}

/**
 * Interactive terminal menu for picking a Claude startup config. Lists saved
 * claude profiles and cc-switch providers in two Tab-switchable groups —
 * the same three groups the web NewSession selector shows.
 *
 * Returns null when nothing can be offered (non-TTY, fetch failed and lists
 * empty) or the user aborted — the caller then just starts with defaults.
 */
export async function selectClaudeConfigInteractively(): Promise<SelectedClaudeConfig | null> {
    if (!process.stdin.isTTY) {
        return null
    }

    const jwt = await exchangeJwt()
    if (!jwt) {
        return null
    }

    const [profiles, ccSwitchProviders] = await Promise.all([
        fetchClaudeProfiles(jwt),
        fetchCcSwitchProviders(jwt)
    ])

    if (profiles.length === 0 && ccSwitchProviders.length === 0) {
        return null
    }

    return await new Promise<SelectedClaudeConfig | null>((resolve) => {
        let settled = false
        const complete = (callback: () => void) => {
            if (settled) return
            settled = true
            instance.unmount()
            callback()
        }
        const instance = render(React.createElement(ClaudeConfigPicker, {
            profiles,
            ccSwitchProviders,
            onSelect: (selection: SelectedClaudeConfig) => complete(() => resolve(selection)),
            onCancel: () => complete(() => resolve(null))
        }), {
            patchConsole: false,
            exitOnCtrlC: false
        })
    })
}
