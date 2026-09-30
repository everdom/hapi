import type { Terminal } from '@xterm/xterm'

// Movement before the gesture is classified as a vertical scroll. Below it,
// the touch stays owned by xterm (tap-to-focus, text selection).
const TOUCH_SCROLL_START_THRESHOLD_PX = 8

/**
 * Makes the xterm scrollback reachable with a one-finger vertical swipe.
 *
 * xterm only scrolls on wheel events and consumes touch drags for text
 * selection, so on phones the scrollback was only reachable through the thin
 * native scrollbar strip — which mobile browsers page but refuse to drag.
 * We watch touches on the terminal root, and once a single-finger gesture
 * clearly moves vertically past a small threshold we own it: the default
 * gesture is suppressed and the delta is applied to the viewport's scrollTop
 * directly (xterm repaints from the resulting scroll event). Horizontal drags
 * and short taps are left untouched so xterm's selection and tap-to-focus
 * (opening the on-screen keyboard) keep working.
 */
export function attachTerminalTouchScroll(terminal: Terminal): () => void {
    const root = terminal.element
    if (!root) {
        return () => {}
    }
    const viewport = root.querySelector<HTMLElement>('.xterm-viewport')
    if (!viewport) {
        return () => {}
    }

    // The browser must not claim the vertical pan natively (on the viewport's
    // own overflow, or the page behind it) — we drive scrollTop ourselves, and
    // a committed native scroll would double up with our manual deltas.
    const previousTouchAction = root.style.getPropertyValue('touch-action')
    root.style.setProperty('touch-action', 'none')

    let startX = 0
    let startY = 0
    let lastY = 0
    let tracking = false
    let scrolling = false

    const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) {
            tracking = false
            scrolling = false
            return
        }
        const touch = event.touches[0]
        startX = touch.clientX
        startY = touch.clientY
        lastY = touch.clientY
        tracking = true
        scrolling = false
    }

    const onTouchMove = (event: TouchEvent) => {
        if (!tracking || event.touches.length !== 1) {
            return
        }
        const touch = event.touches[0]
        if (!scrolling) {
            const dx = touch.clientX - startX
            const dy = touch.clientY - startY
            if (Math.hypot(dx, dy) < TOUCH_SCROLL_START_THRESHOLD_PX) {
                return
            }
            if (Math.abs(dx) >= Math.abs(dy)) {
                // Horizontal: xterm's touch text selection keeps the gesture.
                tracking = false
                return
            }
            scrolling = true
        }
        event.preventDefault()
        event.stopPropagation()
        viewport.scrollTop -= touch.clientY - lastY
        lastY = touch.clientY
    }

    const onTouchEnd = () => {
        tracking = false
        scrolling = false
    }

    const capture = { capture: true } as const
    root.addEventListener('touchstart', onTouchStart, { ...capture, passive: true })
    root.addEventListener('touchmove', onTouchMove, { ...capture, passive: false })
    root.addEventListener('touchend', onTouchEnd, capture)
    root.addEventListener('touchcancel', onTouchEnd, capture)

    return () => {
        if (previousTouchAction) {
            root.style.setProperty('touch-action', previousTouchAction)
        } else {
            root.style.removeProperty('touch-action')
        }
        root.removeEventListener('touchstart', onTouchStart, capture)
        root.removeEventListener('touchmove', onTouchMove, capture)
        root.removeEventListener('touchend', onTouchEnd, capture)
        root.removeEventListener('touchcancel', onTouchEnd, capture)
    }
}
