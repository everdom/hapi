import { Hono } from 'hono'
import { getConfiguration } from '../../configuration'
import { getSettingsFile, readSettingsOrThrow } from '../../config/settings'
import { listCcSwitchClaudeProviders } from '../../cc-switch/providers'
import type { WebAppEnv } from '../middleware/auth'

/**
 * Read-only listing of Claude providers from the local cc-switch database.
 * Only safe fields (id / name / isCurrent) leave the hub — provider
 * `settings_config` holds API tokens and never crosses this endpoint.
 */
export function createCcSwitchRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/cc-switch/claude-providers', async (c) => {
        c.header('Cache-Control', 'no-store')
        const configuration = getConfiguration()
        const settings = await readSettingsOrThrow(getSettingsFile(configuration.dataDir))
        const providers = listCcSwitchClaudeProviders(settings.ccSwitchDbPath)
        return c.json({ providers })
    })

    return app
}
