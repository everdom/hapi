import { Hono } from 'hono'
import { z } from 'zod'
import { getConfiguration } from '../../configuration'
import { getSettingsFile, readSettingsOrThrow, writeSettings } from '../../config/settings'
import type { WebAppEnv } from '../middleware/auth'

const claudeProfileSchema = z.object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(120),
    settingsPath: z.string().max(4096),
    args: z.array(z.string().max(1024)).max(64),
    createdAt: z.number(),
    updatedAt: z.number()
}).refine((value) => Boolean(value.settingsPath || value.args.length > 0), {
    message: 'Claude profile cannot be empty'
})

const updateBodySchema = z.object({
    profiles: z.array(claudeProfileSchema).max(100)
})

type ClaudeProfile = z.infer<typeof claudeProfileSchema>

function namespaceKey(namespace: string): string {
    return namespace || 'default'
}

function stripEnclosingQuotes(value: string): string {
    let result = value.trim()
    while (result.length >= 2) {
        const first = result[0]
        const last = result[result.length - 1]
        if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
            result = result.slice(1, -1).trim()
            continue
        }
        break
    }
    return result
}

function normalizeProfiles(profiles: ClaudeProfile[]): ClaudeProfile[] {
    const seen = new Set<string>()
    const normalized: ClaudeProfile[] = []
    for (const profile of profiles) {
        if (seen.has(profile.id)) continue
        seen.add(profile.id)
        normalized.push({
            ...profile,
            name: profile.name.trim(),
            settingsPath: stripEnclosingQuotes(profile.settingsPath),
            args: profile.args.map((arg) => arg.trim()).filter(Boolean)
        })
    }
    return normalized
}

export function createClaudeProfilesRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/claude-profiles', async (c) => {
        const configuration = getConfiguration()
        const settings = await readSettingsOrThrow(getSettingsFile(configuration.dataDir))
        const profiles = settings.claudeProfiles?.[namespaceKey(c.get('namespace'))] ?? []
        return c.json({ profiles })
    })

    app.put('/claude-profiles', async (c) => {
        const configuration = getConfiguration()
        const body = await c.req.json().catch(() => null)
        const parsed = updateBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const settingsFile = getSettingsFile(configuration.dataDir)
        const settings = await readSettingsOrThrow(settingsFile)
        settings.claudeProfiles ??= {}
        settings.claudeProfiles[namespaceKey(c.get('namespace'))] = normalizeProfiles(parsed.data.profiles)
        await writeSettings(settingsFile, settings)
        return c.json({ profiles: settings.claudeProfiles[namespaceKey(c.get('namespace'))] })
    })

    return app
}
