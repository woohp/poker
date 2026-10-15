/** Installs an in-memory Web Storage stand-in for unit tests running under Node. */
export function installMemoryStorage(name: "localStorage" | "sessionStorage"): void {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, name, {
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key),
        },
        configurable: true,
    });
}
