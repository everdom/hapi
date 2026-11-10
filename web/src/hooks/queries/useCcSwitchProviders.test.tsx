import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useCcSwitchProviders } from './useCcSwitchProviders'

function wrapper(queryClient: QueryClient) {
    return ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
}

describe('useCcSwitchProviders', () => {
    it('lists the providers with the models their config selects', async () => {
        const getCcSwitchProviders = vi.fn(async () => ({
            providers: [
                { id: 'provider-1', name: 'MiniMax', isCurrent: true, model: 'MiniMax-M3.1-Flash[1M]', models: ['MiniMax-M3.1-Flash[1M]'] }
            ]
        }))
        const api = { getCcSwitchProviders } as unknown as ApiClient
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

        const { result } = renderHook(() => useCcSwitchProviders({ api, enabled: true }), {
            wrapper: wrapper(queryClient)
        })

        await waitFor(() => expect(result.current.providers).toHaveLength(1))
        expect(result.current.providers[0]?.model).toBe('MiniMax-M3.1-Flash[1M]')
    })

    it('asks for nothing while disabled', () => {
        const getCcSwitchProviders = vi.fn()
        const api = { getCcSwitchProviders } as unknown as ApiClient
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

        const { result } = renderHook(() => useCcSwitchProviders({ api, enabled: false }), {
            wrapper: wrapper(queryClient)
        })

        expect(result.current.providers).toEqual([])
        expect(getCcSwitchProviders).not.toHaveBeenCalled()
    })

    it('keeps an empty list when the hub has no cc-switch database', async () => {
        const getCcSwitchProviders = vi.fn(async () => ({ providers: [] }))
        const api = { getCcSwitchProviders } as unknown as ApiClient
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

        const { result } = renderHook(() => useCcSwitchProviders({ api, enabled: true }), {
            wrapper: wrapper(queryClient)
        })

        await waitFor(() => expect(getCcSwitchProviders).toHaveBeenCalled())
        expect(result.current.providers).toEqual([])
    })
})
