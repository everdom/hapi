import type { ClaudeModelSummary } from './apiTypes'

// Fallback aliases in Claude Code's /model order, used until its live catalog
// arrives. Each resolves to the newest model of its family.
export const CLAUDE_MODEL_LABELS = {
    opus: 'Opus',
    fable: 'Fable',
    sonnet: 'Sonnet',
    haiku: 'Haiku'
} as const

export type ClaudeModelPreset = keyof typeof CLAUDE_MODEL_LABELS
export const CLAUDE_MODEL_PRESETS = Object.keys(CLAUDE_MODEL_LABELS) as ClaudeModelPreset[]

export const GEMINI_MODEL_LABELS = {
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
} as const

export type GeminiModelPreset = keyof typeof GEMINI_MODEL_LABELS
export const GEMINI_MODEL_PRESETS = Object.keys(GEMINI_MODEL_LABELS) as GeminiModelPreset[]
export const DEFAULT_GEMINI_MODEL: GeminiModelPreset = 'gemini-2.5-pro'

// Order and labels mirror `agy models` output (the agy CLI's own listing) so the
// HAPI picker matches what users see in the terminal. IDs follow agy's
// `<model>-<effort>` convention (e.g. `gemini-3.5-flash-low` verified accepted by
// `agy --model`). NOTE: agy fetches the live list server-side and `agy models`
// needs an interactive keyring unlock, so this stays a hand-maintained mirror —
// update it when agy's listing changes.
export const AGY_MODEL_LABELS = {
    'gemini-3.7-flash-high': 'Gemini 3.7 Flash (High)',
    'gemini-3.7-flash-medium': 'Gemini 3.7 Flash (Medium)',
    'gemini-3.7-flash-low': 'Gemini 3.7 Flash (Low)',
    'gemini-3.6-flash-high': 'Gemini 3.6 Flash (High)',
    'gemini-3.6-flash-medium': 'Gemini 3.6 Flash (Medium)',
    'gemini-3.6-flash-low': 'Gemini 3.6 Flash (Low)',
    'gemini-3.5-flash-medium': 'Gemini 3.5 Flash (Medium)',
    'gemini-3.5-flash-high': 'Gemini 3.5 Flash (High)',
    'gemini-3.5-flash-low': 'Gemini 3.5 Flash (Low)',
    'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
    'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6 (Thinking)',
    'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
    'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
} as const

export type AgyModelPreset = keyof typeof AGY_MODEL_LABELS
export const AGY_MODEL_PRESETS = Object.keys(AGY_MODEL_LABELS) as AgyModelPreset[]

export function getAgyModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) return null
    return AGY_MODEL_LABELS[trimmedModel as AgyModelPreset] ?? null
}

export function isClaudeModelPreset(model: string | null | undefined): model is ClaudeModelPreset {
    return typeof model === 'string' && Object.hasOwn(CLAUDE_MODEL_LABELS, model)
}

export function getClaudeModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) {
        return null
    }

    return CLAUDE_MODEL_LABELS[trimmedModel as ClaudeModelPreset] ?? null
}

/**
 * The model a Claude launch config pins a session to, plus every model it
 * exposes.
 *
 * A Claude settings file selects the model through the `env` block Claude Code
 * reads: `ANTHROPIC_MODEL` is the session default and the
 * `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` entries map the family aliases onto
 * concrete models. cc-switch stores exactly this shape, so the same reading
 * covers hapi profiles and cc-switch providers.
 */
export type ClaudeSettingsModels = {
    /** The model the config pins the session to. */
    model: string | null
    /** Every model the config exposes, the session default first. */
    models: string[]
}

const CLAUDE_MODEL_ALIAS_ENV_KEYS = [
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL'
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

/**
 * Reads the model(s) out of a Claude settings-shaped object.
 *
 * Accepts the parsed settings JSON, so the hub (which has a cc-switch provider's
 * `settings_config` in its database) and the CLI (which has the materialized
 * settings file) share one reading.
 */
export function readClaudeSettingsModels(settings: unknown): ClaudeSettingsModels {
    const parsed = asRecord(settings)
    if (!parsed) {
        return { model: null, models: [] }
    }
    const env = asRecord(parsed.env) ?? {}
    const readEnv = (key: string): string | undefined => {
        const value = env[key]
        return typeof value === 'string' && value.trim() ? value.trim() : undefined
    }
    const topLevelModel = typeof parsed.model === 'string' && parsed.model.trim()
        ? parsed.model.trim()
        : undefined
    // Claude Code's own precedence: the env block wins over the settings' `model`.
    const model = readEnv('ANTHROPIC_MODEL') ?? topLevelModel ?? null

    const models: string[] = []
    for (const value of [model ?? undefined, ...CLAUDE_MODEL_ALIAS_ENV_KEYS.map(readEnv)]) {
        if (value && !models.includes(value)) {
            models.push(value)
        }
    }
    return { model, models }
}

/**
 * A Claude model the user can pick.
 *
 * `value` is stored on the session and passed to `claude --model` unchanged.
 * An alias (`opus`) is resolved by the CLI each time the session's claude
 * process starts, so the session moves to a newer model on its next start;
 * a full id (`claude-opus-4-7`) stays on that model.
 */
export type ClaudeModelChoice = {
    value: string
    label: string
    /** `main` is each family's newest model; `other` is every earlier version. */
    section: 'main' | 'other'
}

/** `opus`, `opus[1m]`, `claude-opus-4-7` → `opus`. */
function getClaudeModelFamily(value: string): string {
    return value.replace(/^claude-/, '').split(/[-[]/)[0] ?? value
}

/**
 * Picker choices for a catalog reported by the `claude` CLI: its own `/model`
 * rows, with its display names, split the way Claude Code's model sheet
 * splits them. The CLI lists each family's newest model before its earlier
 * versions, so the first row of a family is `main` and later ones are
 * `other`; within each section the CLI order is kept. The `default` row is
 * omitted; callers represent it as "no model".
 */
export function getClaudeModelChoices(catalog: readonly ClaudeModelSummary[]): ClaudeModelChoice[] {
    const families = new Set<string>()
    const choices: ClaudeModelChoice[] = catalog
        .filter((model) => model.value !== 'default')
        .map((model) => {
            const family = getClaudeModelFamily(model.value)
            const section = families.has(family) ? 'other' : 'main'
            families.add(family)
            return { value: model.value, label: model.displayName ?? model.value, section }
        })
    return [
        ...choices.filter((choice) => choice.section === 'main'),
        ...choices.filter((choice) => choice.section === 'other'),
    ]
}

/**
 * Effort levels the CLI offers for `model` (`null` = the session default).
 * Undefined when the catalog is missing or does not list the model.
 */
export function getClaudeEffortLevelsForModel(
    model: string | null,
    catalog: readonly ClaudeModelSummary[] | null | undefined
): readonly string[] | undefined {
    if (!catalog) {
        return undefined
    }
    if (model === null) {
        return catalog.find((row) => row.value === 'default')?.effortLevels
    }
    return catalog.find((row) => row.value === model)?.effortLevels
}

/**
 * The effort to keep when switching to `model`: an effort the model does not
 * offer is cleared rather than left for the CLI to reject or ignore. Unknown
 * support keeps the current effort.
 */
export function resolveClaudeEffortForModel(
    effort: string | null,
    model: string | null,
    catalog: readonly ClaudeModelSummary[] | null | undefined
): string | null {
    const levels = getClaudeEffortLevelsForModel(model, catalog)
    if (effort === null || levels === undefined || levels.includes(effort)) {
        return effort
    }
    return null
}
