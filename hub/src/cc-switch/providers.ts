import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readClaudeSettingsModels } from '@hapi/protocol'

export interface CcSwitchProvider {
    id: string
    name: string
    isCurrent: boolean
    /** The model this provider's config pins a session to. */
    model: string | null
    /** Every model this provider's config exposes. */
    models: string[]
}

/**
 * Resolve the cc-switch SQLite database path. Defaults to
 * `~/.cc-switch/cc-switch.db`; operators can override it in hub settings via
 * `ccSwitchDbPath` (absolute path, or `~`-prefixed which we expand here).
 */
export function resolveCcSwitchDbPath(configuredPath?: string): string {
    const raw = configuredPath?.trim() || join(homedir(), '.cc-switch', 'cc-switch.db')
    if (raw === '~') return homedir()
    if (raw.startsWith('~/') || raw.startsWith('~\\')) {
        return join(homedir(), raw.slice(2))
    }
    return raw
}

/**
 * Read the Claude providers registered in cc-switch. cc-switch stores full
 * settings.json contents per provider in its `providers` table — only the
 * provider's id, name and the model names its config selects ever leave the
 * hub process, so provider tokens stay here; the actual config is
 * materialized to a file at spawn time by the CLI side
 * (`cli/src/claude/utils/ccSwitchSettings.ts`).
 *
 * The models matter to the web: the machine's Claude catalog belongs to
 * whichever provider the machine currently uses, so without them a picker
 * would offer another provider's models for the provider picked here.
 *
 * Returns an empty list (not an error) when the database does not exist —
 * cc-switch is optional. Read errors also degrade to empty so the selector
 * stays usable.
 */
export function listCcSwitchClaudeProviders(configuredPath?: string): CcSwitchProvider[] {
    const dbPath = resolveCcSwitchDbPath(configuredPath)
    if (!existsSync(dbPath)) {
        return []
    }
    try {
        // Dynamic require: `bun:sqlite` is only available under the Bun runtime
        // (hub runs on Bun); the compile-time import would break typecheck for
        // node-targeted packages. Minimal local shape keeps this self-contained.
        const { Database } = require('bun:sqlite') as { Database: new (path: string, options?: { readonly?: boolean }) => {
            query<Row>(sql: string): { all(): Row[]; get(...params: string[]): Row | null }
            close(): void
        } }
        const db = new Database(dbPath, { readonly: true })
        try {
            const rows = db
                .query<{ id: string; name: string; is_current: number; settings_config: string | null }>(
                    "SELECT id, name, is_current, settings_config FROM providers WHERE app_type = 'claude' ORDER BY sort_index, created_at"
                )
                .all()
            return rows.map((row) => {
                const { model, models } = readClaudeSettingsModels(parseSettingsConfig(row.settings_config))
                return {
                    id: row.id,
                    name: row.name,
                    isCurrent: row.is_current === 1,
                    model,
                    models
                }
            })
        } finally {
            db.close()
        }
    } catch {
        return []
    }
}

/** The provider's stored settings config, or null when it is missing/unparsable. */
function parseSettingsConfig(settingsConfig: string | null): unknown {
    if (!settingsConfig) {
        return null
    }
    try {
        return JSON.parse(settingsConfig) as unknown
    } catch {
        return null
    }
}

/**
 * Read one provider's full settings config (a settings.json-shaped object)
 * from the cc-switch database. Returns null when the db or the provider row
 * is missing / unparsable — callers surface that as a spawn-time error.
 */
export function readCcSwitchProviderSettings(
    providerId: string,
    configuredPath?: string
): Record<string, unknown> | null {
    const dbPath = resolveCcSwitchDbPath(configuredPath)
    if (!existsSync(dbPath)) {
        return null
    }
    try {
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
                return null
            }
            const parsed = JSON.parse(row.settings_config) as unknown
            return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
        } finally {
            db.close()
        }
    } catch {
        return null
    }
}
