const esbuild = require("esbuild");
const { copy } = require("esbuild-plugin-copy");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log(`[watch] build started: ${build.initialOptions.outfile}`);
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log(`[watch] build finished: ${build.initialOptions.outfile}`);
        });
    },
};

// Common configuration shared by both bundles
const baseConfig = {
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    external: ['vscode', 'electron'],
    logLevel: 'silent',
};

async function main() {
    const extensionCtx = await esbuild.context({
        ...baseConfig,
        entryPoints: ['src/extension.ts'],
        outfile: 'dist/extension.js',
        plugins: [esbuildProblemMatcherPlugin],
    });

    const electronCtx = await esbuild.context({
        ...baseConfig,
        entryPoints: ['src/electron/electron.ts'],
        outfile: 'dist/electron.js',
        plugins: [
            esbuildProblemMatcherPlugin,
            copy({
                assets: {
                    from: ['src/electron/views/**/*'],
                    to: ['views'],
                    watch
                },
            })],
    });

    const electronAppCtx = await esbuild.context({
        ...baseConfig,
        entryPoints: ['src/electron/app/index.ts'],
        outfile: 'dist/app.js',
        // plugins: [esbuildProblemMatcherPlugin],
        format: 'esm',
    });

    if (watch) {
        await Promise.all([
            extensionCtx.watch(),
            electronCtx.watch(),
            electronAppCtx.watch()
        ]);
        console.log('Watching for changes...');
    } else {
        await Promise.all([
            extensionCtx.rebuild(),
            electronCtx.rebuild(),
            electronAppCtx.rebuild()
        ]);
        await Promise.all([
            extensionCtx.dispose(),
            electronCtx.dispose(),
            electronAppCtx.dispose()
        ]);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});