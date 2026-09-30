/**
 * Origin gate for Socket.IO (engine.io) handshake requests.
 *
 * Browsers attach an `Origin` header to EVERY POST and to every WebSocket
 * handshake — even when the page itself was served from this very hub. The
 * corsOrigins list alone (derived from publicUrl by default) therefore locks
 * out perfectly legitimate clients that opened the app via a different local
 * address, e.g. `http://127.0.0.1:3006` while publicUrl is
 * `http://192.168.6.184:3006`: the initial polling GET (same-origin GETs
 * carry no Origin) succeeds, but the first POST / WS upgrade gets a 403 and
 * socket.io surfaces "transport error" to the user.
 *
 * So: allow when there is no Origin (non-browser clients), when the list
 * matches (including `*`), or when the Origin is SAME-ORIGIN with the request
 * (origin host equals the request Host header). A cross-site page cannot
 * forge that equality: its Origin is its own site, not the hub's address.
 */
export function isSocketOriginAllowed(
    origin: string | null,
    host: string | null,
    corsOrigins: string[]
): boolean {
    if (!origin) {
        return true
    }
    if (corsOrigins.includes('*') || corsOrigins.includes(origin)) {
        return true
    }
    if (host) {
        try {
            const originHost = new URL(origin).host
            if (originHost.toLowerCase() === host.toLowerCase()) {
                return true
            }
        } catch {
            // Malformed Origin header — fall through to rejection.
        }
    }
    return false
}
