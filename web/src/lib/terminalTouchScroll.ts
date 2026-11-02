import type { Terminal } from '@xterm/xterm'

// Movement before the gesture is classified as a vertical scroll. Below it,
// the touch stays owned by xterm (tap-to-focus, text selection).
const TOUCH_SCROLL_START_THRESHOLD_PX = 8

// Marks a terminal that has scrollback worth scrolling to. The web stylesheet
// uses it to keep xterm's scrollbar on screen on touch devices.
const SCROLLBACK_ATTRIBUTE = 'data-hapi-has-scrollback'

// xterm does not expose the cell size publicly, but the fit addon reads the
// same private measurement, so this stays consistent with how the terminal
// was sized.
type TerminalCellMetrics = {
    _core?: {
        _renderService?: {
            dimensions?: {
                css?: {
                    cell?: {
                        height?: number
                    }
                }
            }
        }
    }
}

/**
 * Height of one terminal row in CSS pixels, or 0 when it cannot be measured.
 */
function getCellHeight(terminal: Terminal): number {
    const metrics = terminal as unknown as TerminalCellMetrics
    const cellHeight = metrics._core?._renderService?.dimensions?.css?.cell?.height
    if (typeof cellHeight === 'number' && cellHeight > 0) {
        return cellHeight
    }
    const viewport = terminal.element?.querySelector<HTMLElement>('.xterm-viewport')
    if (viewport && viewport.clientHeight > 0 && terminal.rows > 0) {
        return viewport.clientHeight / terminal.rows
    }
    return 0
}

/**
 * Marks the terminal element while it has scrollback to scroll to.
 *
 * xterm's vertical scrollbar defaults to an auto-hiding visibility: it is
 * revealed on hover or scroll and fades out again. A phone has no hover, so
 * the scrollbar is effectively invisible there — the stylesheet keeps it
 * visible instead as long as this marker is present.
 */
export function applyTerminalScrollbackState(terminal: Terminal): void {
    const element = terminal.element
    if (!element) {
        return
    }
    const hasScrollback = terminal.buffer.active.baseY > 0
    if (hasScrollback) {
        // Only touch the DOM on a transition: this runs on every parsed write.
        if (element.getAttribute(SCROLLBACK_ATTRIBUTE) !== 'true') {
            element.setAttribute(SCROLLBACK_ATTRIBUTE, 'true')
        }
    } else if (element.hasAttribute(SCROLLBACK_ATTRIBUTE)) {
        element.removeAttribute(SCROLLBACK_ATTRIBUTE)
    }
}

/**
 * Makes the xterm scrollback reachable with a one-finger vertical swipe.
 *
 * xterm only scrolls on wheel events and consumes touch drags for text
 * selection, so on phones the scrollback was only reachable through the thin
 * native scrollbar strip — which mobile browsers page but refuse to drag.
 * We watch touches on the terminal root, and once a single-finger gesture
 * clearly moves vertically past a small threshold we own it: the default
 * gesture is suppressed and the travelled distance is converted into whole
 * rows, which xterm scrolls through its own `scrollLines()` API.
 *
 * Writing to the viewport's `scrollTop` would not work: xterm v6 replaced
 * native viewport scrolling with its own scrollable element, so the viewport
 * never overflows and its `scrollTop` stays at 0.
 *
 * Horizontal drags and short taps are left untouched so xterm's selection and
 * tap-to-focus (opening the on-screen keyboard) keep working. Gestures that
 * start on xterm's own scrollbar are left alone as well, so the slider stays
 * draggable.
 */
export function attachTerminalTouchScroll(terminal: Terminal): () => void {
    const root = terminal.element
    if (!root) {
        return () => {}
    }

    // The browser must not claim the vertical pan natively (on the page
    // behind the terminal) — we drive the scroll ourselves.
    const previousTouchAction = root.style.getPropertyValue('touch-action')
    root.style.setProperty('touch-action', 'none')

    let startX = 0
    let startY = 0
    let lastY = 0
    /** Travel that did not add up to a full row yet. */
    let pendingPixels = 0
    let tracking = false
    let scrolling = false

    const isScrollbarTarget = (target: EventTarget | null): boolean =>
        target instanceof Element && target.closest('.scrollbar') !== null

    const onTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1 || isScrollbarTarget(event.target)) {
            tracking = false
            scrolling = false
            return
        }
        const touch = event.touches[0]
        startX = touch.clientX
        startY = touch.clientY
        lastY = touch.clientY
        pendingPixels = 0
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

        // Swiping up scrolls toward newer output, swiping down toward older.
        pendingPixels += lastY - touch.clientY
        lastY = touch.clientY

        const cellHeight = getCellHeight(terminal)
        if (cellHeight <= 0) {
            return
        }
        const rows = Math.trunc(pendingPixels / cellHeight)
        if (rows !== 0) {
            pendingPixels -= rows * cellHeight
            terminal.scrollLines(rows)
        }
    }

    const onTouchEnd = () => {
        tracking = false
        scrolling = false
        pendingPixels = 0
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
