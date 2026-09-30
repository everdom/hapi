import { describe, expect, it } from 'bun:test'
import { isSocketOriginAllowed } from './originPolicy'

describe('socket origin policy', () => {
    const LAN = ['http://192.168.6.184:3006']

    it('allows requests without an Origin header (non-browser / same-origin GET)', () => {
        expect(isSocketOriginAllowed(null, '192.168.6.184:3006', LAN)).toBe(true)
    })

    it('allows everything under a wildcard list', () => {
        expect(isSocketOriginAllowed('https://anything.example', 'evil-host', ['*'])).toBe(true)
    })

    it('allows origins explicitly present in the list', () => {
        expect(isSocketOriginAllowed('http://192.168.6.184:3006', '192.168.6.184:3006', LAN)).toBe(true)
    })

    it('allows same-origin requests whose Origin host equals the request Host', () => {
        // The regression this guards: a browser opened the app via 127.0.0.1
        // while publicUrl (and thus corsOrigins) is the LAN address. POST and
        // WS handshakes carry Origin and used to 403 — the terminal socket
        // died with "Disconnected: transport error".
        expect(isSocketOriginAllowed('http://127.0.0.1:3006', '127.0.0.1:3006', LAN)).toBe(true)
        expect(isSocketOriginAllowed('http://localhost:3006', 'localhost:3006', LAN)).toBe(true)
    })

    it('compares host case-insensitively', () => {
        expect(isSocketOriginAllowed('http://LOCALHOST:3006', 'localhost:3006', LAN)).toBe(true)
    })

    it('rejects cross-origin hosts even when the port matches', () => {
        expect(isSocketOriginAllowed('https://evil.test:3006', 'localhost:3006', LAN)).toBe(false)
    })

    it('rejects same host with a different port', () => {
        expect(isSocketOriginAllowed('http://127.0.0.1:3006', '127.0.0.1:9999', LAN)).toBe(false)
    })

    it('rejects malformed Origin headers and missing Host', () => {
        expect(isSocketOriginAllowed('not a url', '192.168.6.184:3006', LAN)).toBe(false)
        expect(isSocketOriginAllowed('https://evil.test', null, LAN)).toBe(false)
    })
})
