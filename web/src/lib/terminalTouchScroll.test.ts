import { describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { attachTerminalTouchScroll } from './terminalTouchScroll'

function setup() {
    const root = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'
    root.appendChild(viewport)
    const terminal = { element: root } as unknown as Terminal
    const detach = attachTerminalTouchScroll(terminal)
    return { root, viewport, detach }
}

describe('attachTerminalTouchScroll', () => {
    it('translates a vertical swipe into viewport scrolling', () => {
        const { viewport, detach } = setup()
        try {
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 150 }] })
            expect(viewport.scrollTop).toBe(50)

            // Swipe down returns toward the prompt.
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 190 }] })
            expect(viewport.scrollTop).toBe(10)
        } finally {
            detach()
        }
    })

    it('leaves horizontal drags to xterm (text selection)', () => {
        const { viewport, detach } = setup()
        try {
            const bubbleHandler = vi.fn()
            viewport.addEventListener('touchmove', bubbleHandler)

            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 80, clientY: 204 }] })

            expect(viewport.scrollTop).toBe(0)
            expect(bubbleHandler).toHaveBeenCalled()
        } finally {
            detach()
        }
    })

    it('leaves taps (below the threshold) untouched and keeps focus behavior', () => {
        const { viewport, detach } = setup()
        try {
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 12, clientY: 203 }] })
            expect(viewport.scrollTop).toBe(0)
            fireEvent.touchEnd(viewport, { touches: [] })

            // A new gesture starts clean after touchend.
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 300 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 250 }] })
            expect(viewport.scrollTop).toBe(50)
        } finally {
            detach()
        }
    })

    it('suppresses the browser gesture for owned scrolls', () => {
        const { viewport, detach } = setup()
        try {
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            const move = fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 150 }] })
            expect(move).toBe(false) // preventDefault called → defaultPrevented true
        } finally {
            detach()
        }
    })

    it('stops handling touches after detach', () => {
        // (touch-action itself is not modeled by jsdom's CSS parser, so we
        // assert the listener behavior instead; cleanup also restores the
        // inline property, guarded by its own get/set round-trip.)
        const { viewport, detach } = setup()
        detach()

        fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
        fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 120 }] })
        expect(viewport.scrollTop).toBe(0)
    })
})
