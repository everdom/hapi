import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shellJoin, windowsCommandQuote } from './shellQuote';

describe('Windows hook command quoting', () => {
    it('quotes executable paths with spaces for cmd /c', () => {
        expect(shellJoin(['C:\\Program Files\\HAPI\\hapi.exe', 'hook-forwarder'], 'win32'))
            .toBe('"C:\\Program Files\\HAPI\\hapi.exe" hook-forwarder');
    });

    it('preserves trailing backslashes and embedded quotes', () => {
        expect(windowsCommandQuote('C:\\path with space\\')).toBe('"C:\\path with space\\\\"');
        expect(windowsCommandQuote('say"hi')).toBe('"say\\"hi"');
    });

    it('quotes backslash-bearing paths so git bash does not strip them', () => {
        // Claude Code on Windows invokes hooks through git bash. An unquoted
        // `C:\Users\...\hapi.exe` becomes `C:Users...hapi.exe` and yields
        // `command not found`. Verify the quoting covers the no-whitespace,
        // backslash-only case.
        expect(windowsCommandQuote('C:\\Users\\everdom\\AppData\\Roaming\\npm\\hapi.exe'))
            .toBe('"C:\\Users\\everdom\\AppData\\Roaming\\npm\\hapi.exe"');
        expect(shellJoin(['C:\\Users\\everdom\\AppData\\Roaming\\npm\\hapi.exe', 'hook-forwarder', '--flavor', 'claude'], 'win32'))
            .toBe('"C:\\Users\\everdom\\AppData\\Roaming\\npm\\hapi.exe" hook-forwarder --flavor claude');
    });

    it('fails closed for cmd expansions that cannot be safely quoted', () => {
        expect(() => windowsCommandQuote('C:\\Users\\%USERNAME%\\hapi.exe')).toThrow();
        expect(() => windowsCommandQuote('C:\\Users\\name!\\hapi.exe')).toThrow();
    });

    it.runIf(process.platform === 'win32')('round-trips argv through the hook shell Claude Code uses', () => {
        // Claude Code on Windows executes hook commands via Git Bash, not cmd /c.
        // Locate the bundled bash.exe (Git for Windows installs it under
        // `C:\Program Files\Git\usr\bin\bash.exe`) and round-trip through it so
        // the test reflects the actual consumer.
        const gitBashCandidates = [
            'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
            'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe'
        ];
        const shell = gitBashCandidates.find((p) => existsSync(p)) ?? (process.env.ComSpec || 'cmd.exe');
        const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
        const expected = ['space & paren()', 'embedded"quote', 'trailing\\'];
        const command = shellJoin([process.execPath, '-e', script, ...expected], 'win32');
        const argv = shell.endsWith('bash.exe') ? ['-c', command] : ['/d', '/s', '/c', command];
        const output = execFileSync(shell, argv, { encoding: 'utf8' });
        expect(JSON.parse(output)).toEqual(expected);
    });
});
