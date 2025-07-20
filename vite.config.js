import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig(async () => {
  const format = process.env.BUILD_FORMAT || 'es';
  let outputDir;

  if (format === 'umd') {
    outputDir = 'dist/umd';
  } else if (format === 'cjs') {
    outputDir = 'dist/cjs';
  } else {
    outputDir = 'dist/es';
  }

  const externalDependencies = [
    'hedera-agent-kit',
    '@hashgraph/proto',
    '@hashgraph/sdk',
    'fetch-retry',
  ];

  const plugins = [
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts'],
      outputDir: outputDir,
    }),
  ];

  // Only add nodePolyfills for UMD build
  if (format === 'umd') {
    const { nodePolyfills } = await import('vite-plugin-node-polyfills');
    plugins.push(
      nodePolyfills({
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
        protocolImports: true,
        modules: {
          buffer: true,
        },
      }),
    );
  }

  return {
    plugins,
    build: {
      outDir: outputDir,
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: format === 'umd' ? 'StandardsSDK' : undefined,
        fileName: fmt => `standards-sdk.${fmt === 'cjs' ? 'cjs' : fmt + '.js'}`,
        formats: [format],
      },
      rollupOptions: {
        external: id => {
          if (id.startsWith('@kiloscribe/inscription-sdk')) {
            return false;
          }
          if (format === 'umd') {
            return false;
          }
          return (
            externalDependencies.some(
              dep => id === dep || id.startsWith(dep + '/'),
            ) ||
            (!id.startsWith('.') &&
              !id.startsWith('/') &&
              !id.includes(__dirname))
          );
        },
        output:
          format === 'cjs'
            ? {
              exports: 'named',
              format: 'cjs',
            }
            : {
              globals: id => id,
              preserveModules: format === 'es',
              preserveModulesRoot: format === 'es' ? 'src' : undefined,
              exports: 'named',
              inlineDynamicImports: format === 'umd',
              name: format === 'umd' ? 'StandardsSDK' : undefined,
            },
      },
      minify: 'terser',
      sourcemap: true,
      target: 'es2020',
    },
    define: {
      VITE_BUILD_FORMAT: JSON.stringify(format),
      ...(format === 'cjs' ? { Buffer: 'globalThis.Buffer' } : {}),
    },
    resolve: {
      alias: {
        util: 'util',
      },
    },
    ssr: {
      noExternal: [
        '@hashgraphonline/hashinal-wc',
        '@kiloscribe/inscription-sdk',
      ],
      external: externalDependencies,
    },
  };
});
