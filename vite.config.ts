import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
    resolve: {
        dedupe: ["yjs"],
    },
    fmt: {
        ignorePatterns: ["docs/**", "dist/**", "node_modules/**"],
        tabWidth: 4,
    },
    lint: {
        ignorePatterns: ["docs/**", "dist/**", "node_modules/**"],
        jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
        options: {
            typeAware: true,
            typeCheck: true,
        },
        rules: {
            "no-unassigned-vars": "off",
            "vite-plus/prefer-vite-plus-imports": "error",
        },
    },
    base: "./",
    build: {
        outDir: "docs",
        emptyOutDir: true,
    },
    plugins: [svelte(), tailwindcss()],
});
