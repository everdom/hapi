import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVirtualKeyboardOpen } from './useVirtualKeyboardOpen'

class FakeVisualViewport extends EventTarget {
    width = 390
    height = 800

    resizeTo(width: number, height: number) {
        this.width = width
        this.height = height
        this.dispatchEvent(new Event('resize'))
    }
}

let viewport: FakeVisualViewport | undefined

beforeEach(() => {
    viewport = new FakeVisualViewport()
    Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: viewport,
    })
})

afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: undefined,
    })
})

describe('useVirtualKeyboardOpen', () => {
    it('is closed initially at full height', () => {
        const { result } = renderHook(() => useVirtualKeyboardOpen())
        expect(result.current).toBe(false)
    })

    it('opens when height shrinks with unchanged width (keyboard)', () => {
        const { result } = renderHook(() => useVirtualKeyboardOpen())
        act(() => viewport!.resizeTo(390, 520))
        expect(result.current).toBe(true)

        act(() => viewport!.resizeTo(390, 800))
        expect(result.current).toBe(false)
    })

    it('ignores small height dips (browser chrome, not a keyboard)', () => {
        const { result } = renderHook(() => useVirtualKeyboardOpen())
        act(() => viewport!.resizeTo(390, 690))
        expect(result.current).toBe(false)
    })

    it('re-baselines on width changes instead of reporting a keyboard', () => {
        const { result } = renderHook(() => useVirtualKeyboardOpen())
        // Portrait 390x800 -> landscape 800x390: huge height drop, width moved.
        act(() => viewport!.resizeTo(800, 390))
        expect(result.current).toBe(false)

        // Keyboard on top of the landscape baseline still detected.
        act(() => viewport!.resizeTo(800, 150))
        expect(result.current).toBe(true)
    })

    it('raises the baseline when the viewport grows (URL bar retract)', () => {
        const { result } = renderHook(() => useVirtualKeyboardOpen())
        act(() => viewport!.resizeTo(390, 850)) // chrome hid, taller viewport
        expect(result.current).toBe(false)
        act(() => viewport!.resizeTo(390, 550)) // keyboard over the new stable height
        expect(result.current).toBe(true)
    })

    it('stays closed when visualViewport is unavailable', () => {
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
        const { result } = renderHook(() => useVirtualKeyboardOpen())
        expect(result.current).toBe(false)
    })
})
