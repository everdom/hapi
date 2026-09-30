import { useEffect, useState } from 'react'

// A virtual keyboard eats far more height than a browser chrome retract, so a
// generous threshold keeps URL-bar / nav-bar show-hide changes from being
// mistaken for the keyboard.
const KEYBOARD_MIN_HEIGHT_PX = 140

/**
 * Tracks whether the on-screen keyboard is currently covering part of the
 * viewport.
 *
 * Detection deliberately uses ONLY `window.visualViewport` dimensions —
 * comparing against `window.innerHeight` fails on browsers where the keyboard
 * resizes the layout viewport itself (the app declares
 * `interactive-widget=resizes-content`, so on Chrome/Android both shrink
 * together and the classic diff would stay ~0). Instead we compare the current
 * visual-viewport height against the tallest height seen while the viewport
 * width stayed put; the keyboard shrinks height without changing width, while
 * rotation / split-screen / desktop window resize change the width too and
 * re-baseline the comparison instead of faking a keyboard.
 */
// A tap on a panel control can very briefly steal focus from the input and
// collapse the keyboard before it is re-asserted. Closing is therefore
// debounced: a transient dip that recovers within the window never flips the
// state (which would race UI that depends on "keyboard open"). Opens are
// reported immediately — the squeeze must be reacted to at once.
const DEFAULT_CLOSE_DELAY_MS = 200

export function useVirtualKeyboardOpen(threshold = KEYBOARD_MIN_HEIGHT_PX, closeDelayMs = DEFAULT_CLOSE_DELAY_MS): boolean {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        const viewport = window.visualViewport
        if (!viewport) {
            return
        }

        let stableHeight = viewport.height
        let stableWidth = viewport.width
        let currentOpen = false
        let closeTimer: ReturnType<typeof setTimeout> | null = null

        const update = () => {
            const { height, width } = viewport
            if (Math.abs(width - stableWidth) > 2) {
                // Orientation / layout change: re-baseline. A shorter viewport
                // after rotating to landscape is not the keyboard.
                stableWidth = width
                stableHeight = height
            } else if (height > stableHeight) {
                stableHeight = height
            }
            const rawOpen = stableHeight - height > threshold
            if (rawOpen) {
                if (closeTimer) {
                    clearTimeout(closeTimer)
                    closeTimer = null
                }
                if (!currentOpen) {
                    currentOpen = true
                    setOpen(true)
                }
            } else if (currentOpen && !closeTimer) {
                closeTimer = setTimeout(() => {
                    closeTimer = null
                    currentOpen = false
                    setOpen(false)
                }, closeDelayMs)
            }
        }

        update()
        viewport.addEventListener('resize', update)
        viewport.addEventListener('scroll', update)
        return () => {
            viewport.removeEventListener('resize', update)
            viewport.removeEventListener('scroll', update)
            if (closeTimer) {
                clearTimeout(closeTimer)
            }
        }
    }, [threshold, closeDelayMs])

    return open
}
