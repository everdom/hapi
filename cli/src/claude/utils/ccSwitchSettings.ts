import axios from 'axios'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { logger } from '@/ui/logger'

interface HubSettingsLike {
    ccSwitchDbPath?: string
}

/**
 * Read the hub's settings.json (single-machine deployment: the hub shares this
 * machine) to pick up the optional `ccSwitchDbPath` override. Falls back to
 * the cc-switch default location when the hub is unreachable or the field is
 * unset.
 */
async function resolveCcSwitchDbPath(): Promise<string> {
    const fallback = join(homedir(), '.cc-switch', 'cc-switch.db')
    try {
        const response = await axios.get<HubSettingsLike>(`${configuration.apiUrl}/api/hub-settings`, {
            headers: buildHubRequestHeaders({ Authorization: `Bearer ${getAuthToken()}` }),
            timeout: 5000
        })
        const configured = response.data?.ccSwitchDbPath?.trim()
        if (!configured) return fallback
        if (configured === '~') return homedir()
        if (configured.startsWith('~/') || configured.startsWith('~\\')) {
            return join(homedir(), configured.slice(2))
        }
        return configured
    } catch {
        return fallback
    }
}

/**
 * Materialize a cc-switch provider's `settings_config` (a settings.json-shaped
 * object stored in cc-switch's SQLite database) into a real settings file on
 * disk so the regular `--settings` merge path in runClaude can consume it.
 *
 * The file lives under `~/.hapi/cc-switch/<providerId>.json` — same trust
 * domain as hapi's other generated session settings (which also carry
 * provider tokens). The materialized copy is a cache: it is refreshed from
 * the database on every spawn so edits made in cc-switch take effect on the
 * next session without any manual sync.
 *
 * Returns the path to the materialized file, or null when the provider
 * cannot be read (missing db / unknown id / unparsable config) — callers
 * surface that as a spawn failure.
 */
export async function materializeCcSwitchSettings(providerId: string): Promise<string | null> {
    const dbPath = await resolveCcSwitchDbPath()
    if (!existsSync(dbPath)) {
        logger.warn(`[CcSwitchSettings] cc-switch database not found at ${dbPath}`)
        return null
    }
    let settings: Record<string, unknown> | null = null
    try {
        // `bun:sqlite` ships with the bundled Bun runtime (hapi.exe is a Bun
        // single-executable); required lazily so node-targeted tooling that
        // imports this module graph does not fail at load time.
        const { Database } = require('bun:sqlite') as { Database: new (path: string, options?: { readonly?: boolean }) => {
            query<Row>(sql: string): { all(): Row[]; get(...params: string[]): Row | null }
            close(): void
        } }
        const db = new Database(dbPath, { readonly: true })
        try {
            const row = db
                .query<{ settings_config: string }>(
                    "SELECT settings_config FROM providers WHERE app_type = 'claude' AND id = ?"
                )
                .get(providerId)
            if (!row?.settings_config) {
                logger.warn(`[CcSwitchSettings] Provider ${providerId} not found in ${dbPath}`)
                return null
            }
            const parsed = JSON.parse(row.settings_config) as unknown
            settings = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
        } finally {
            db.close()
        }
    } catch (error) {
        logger.warn(`[CcSwitchSettings] Failed to read provider ${providerId} from ${dbPath}: ${error}`)
        return null
    }
    if (!settings) {
        logger.warn(`[CcSwitchSettings] Provider ${providerId} has an unparsable settings_config`)
        return null
    }

    const outDir = join(configuration.happyHomeDir, 'cc-switch')
    mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, `${providerId}.json`)
    // Refresh the cache only when the content changed — keeps the mtime stable
    // for tooling that watches the file.
    if (existsSync(outFile)) {
        try {
            if (readFileSync(outFile, 'utf-8') === JSON.stringify(settings, null, 2)) {
                return outFile
            }
        } catch {
            // Fall through to rewrite.
        }
    }
    writeFileSync(outFile, JSON.stringify(settings, null, 2), 'utf-8')
    logger.debug(`[CcSwitchSettings] Materialized provider ${providerId} to ${outFile}`)
    return outFile
}
