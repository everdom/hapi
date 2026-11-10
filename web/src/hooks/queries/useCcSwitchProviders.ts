import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CcSwitchProvider } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

const NO_PROVIDERS: CcSwitchProvider[] = []

/**
 * The cc-switch providers the hub knows about.
 *
 * Only id/name and the models each provider's config selects leave the hub —
 * the provider's tokens stay there. The models matter to a session whose
 * launch config is a cc-switch provider: the machine's Claude catalog belongs
 * to the provider the machine currently uses, which is a different one.
 */
export function useCcSwitchProviders(args: {
    api: ApiClient | null
    enabled?: boolean
}): {
    providers: CcSwitchProvider[]
} {
    const { api } = args
    const enabled = Boolean(args.enabled && api)

    const query = useQuery({
        queryKey: queryKeys.ccSwitchProviders,
        queryFn: async () => {
            if (!api) return NO_PROVIDERS
            const response = await api.getCcSwitchProviders()
            return Array.isArray(response?.providers) ? response.providers : NO_PROVIDERS
        },
        enabled,
        staleTime: 60_000,
        retry: false,
    })

    return { providers: enabled ? (query.data ?? NO_PROVIDERS) : NO_PROVIDERS }
}
