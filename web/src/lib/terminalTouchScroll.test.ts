import { describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { attachTerminalTouchScroll, applyTerminalScrollbackState } from './terminalTouchScroll'

const CELL_HEIGHT = 14

function setup(options: { cellHeight?: number; baseY?: number } = {}) {
    const root = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'
    root.appendChild(viewport)
    const scrollLines = vi.fn()
    const terminal = {
        element: root,
        rows: 24,
        scrollLines,
        buffer: { active: { baseY: options.baseY ?? 0 } },
        _core: {
            _renderService: {
                dimensions: { css: { cell: { height: options.cellHeight ?? CELL_HEIGHT } } }
            }
        }
    } as unknown as Terminal
    const detach = attachTerminalTouchScroll(terminal)
    return { root, viewport, terminal, scrollLines, detach }
}

describe('attachTerminalTouchScroll', () => {
    it('scrolls the terminal by whole rows when a vertical swipe is recognized', () => {
        const { viewport, scrollLines, detach } = setup()
        try {
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 300 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 200 }] })

            // 100px of travel at 14px per row.
            expect(scrollLines).toHaveBeenCalledWith(7)
        } finally {
            detach()
        }
    })

    it('carries leftover pixels into the next move instead of dropping them', () => {
        const { viewport, scrollLines, detach } = setup()
        try {
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 300 }] })
            // 50px -> 3 rows (42px), 8px left over.
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 250 }] })
            expect(scrollLines).toHaveBeenLastCalledWith(3)

            // +20px -> 70px total -> 5 rows.
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 230 }] })
            expect(scrollLines).toHaveBeenLastCalledWith(2)
            expect(scrollLines).toHaveBeenCalledTimes(2)
        } finally {
            detach()
        }
    })

    it('scrolls back toward older output when the swipe goes down', () => {
        const { viewport, scrollLines, detach } = setup()
        try {
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 300 }] })

            expect(scrollLines).toHaveBeenCalledWith(-7)
        } finally {
            detach()
        }
    })

    it('leaves horizontal drags to xterm (text selection)', () => {
        const { viewport, scrollLines, detach } = setup()
        try {
            const bubbleHandler = vi.fn()
            viewport.addEventListener('touchmove', bubbleHandler)

            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 80, clientY: 204 }] })

            expect(scrollLines).not.toHaveBeenCalled()
            expect(bubbleHandler).toHaveBeenCalled()
        } finally {
            detach()
        }
    })

    it('leaves taps (below the threshold) untouched and keeps focus behavior', () => {
        const { viewport, scrollLines, detach } = setup()
        try {
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 12, clientY: 203 }] })
            expect(scrollLines).not.toHaveBeenCalled()
            fireEvent.touchEnd(viewport, { touches: [] })

            // A new gesture starts clean after touchend.
            fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 300 }] })
            fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
            expect(scrollLines).toHaveBeenCalledWith(7)
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

    it('does not steal gestures that start on xterm own scrollbar', () => {
        const { root, scrollLines, detach } = setup()
        try {
            const scrollbar = document.createElement('div')
            scrollbar.className = 'scrollbar vertical'
            const slider = document.createElement('div')
            slider.className = 'slider'
            scrollbar.appendChild(slider)
            root.appendChild(scrollbar)

            fireEvent.touchStart(slider, { touches: [{ clientX: 10, clientY: 300 }] })
            fireEvent.touchMove(slider, { touches: [{ clientX: 10, clientY: 200 }] })

            expect(scrollLines).not.toHaveBeenCalled()
        } finally {
            detach()
        }
    })

    it('stops handling touches after detach', () => {
        const { viewport, scrollLines, detach } = setup()
        detach()

        fireEvent.touchStart(viewport, { touches: [{ clientX: 10, clientY: 200 }] })
        fireEvent.touchMove(viewport, { touches: [{ clientX: 10, clientY: 120 }] })
        expect(scrollLines).not.toHaveBeenCalled()
    })
})

describe('applyTerminalScrollbackState', () => {
    it('marks the terminal while it has scrollback to scroll to', () => {
        const { terminal } = setup({ baseY: 12 })
        applyTerminalScrollbackState(terminal)
        expect(terminal.element?.getAttribute('data-hapi-has-scrollback')).toBe('true')
    })

    it('clears the marker when the terminal has no scrollback', () => {
        const { terminal } = setup({ baseY: 0 })
        applyTerminalScrollbackState(terminal)
        expect(terminal.element?.hasAttribute('data-hapi-has-scrollback')).toBe(false)
    })
})
