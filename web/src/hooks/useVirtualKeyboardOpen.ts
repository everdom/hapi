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
export function useVirtualKeyboardOpen(threshold = KEYBOARD_MIN_HEIGHT_PX): boolean {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        const viewport = window.visualViewport
        if (!viewport) {
            return
        }

        let stableHeight = viewport.height
        let stableWidth = viewport.width

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
            setOpen(stableHeight - height > threshold)
        }

        update()
        viewport.addEventListener('resize', update)
        viewport.addEventListener('scroll', update)
        return () => {
            viewport.removeEventListener('resize', update)
            viewport.removeEventListener('scroll', update)
        }
    }, [threshold])

    return open
}
