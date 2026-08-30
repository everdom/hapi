export function stripEnclosingQuotes(value: string): string {
    let result = value.trim()
    while (result.length >= 2) {
        const first = result[0]
        const last = result[result.length - 1]
        if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
            result = result.slice(1, -1).trim()
            continue
        }
        break
    }
    return result
}
