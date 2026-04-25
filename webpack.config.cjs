const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CleanCSS = require('clean-css');
// FIX: Add TerserPlugin for production log stripping and bundle optimization
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

class CssMinifyPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CssMinifyPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'CssMinifyPlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
        },
        () => {
          for (const assetName of Object.keys(compilation.assets)) {
            if (!assetName.endsWith('.css')) {
              continue;
            }

            const source = compilation.assets[assetName].source().toString();
            const result = new CleanCSS({ level: 2 }).minify(source);

            if (!result.errors.length) {
              compilation.updateAsset(assetName, new webpack.sources.RawSource(result.styles));
            }
          }
        }
      );
    });
  }
}

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  const commonConfig = {
    mode: isDev ? 'development' : 'production',
    devtool: isDev ? 'source-map' : false,
    ignoreWarnings: [
      {
        module: /onnxruntime-web[\\/]dist[\\/]ort\.wasm\.min\.js$/,
        message: /Critical dependency: require function is used in a way/,
      },
    ],
    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename],
      },
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@popup': path.resolve(__dirname, 'src/popup'),
        '@components': path.resolve(__dirname, 'src/popup/components'),
        '@content': path.resolve(__dirname, 'src/content'),
        '@services': path.resolve(__dirname, 'src/services'),
        '@utils': path.resolve(__dirname, 'src/utils'),
        '@types': path.resolve(__dirname, 'src/types'),
        'onnxruntime-web': path.resolve(
          __dirname,
          'node_modules/onnxruntime-web/dist/ort.wasm.min.js'
        ),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
            },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
        {
          test: /\.(png|jpg|jpeg|gif|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: 'assets/[name][ext]',
          },
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/,
          type: 'asset/resource',
          generator: {
            filename: 'fonts/[name][ext]',
          },
        },
        {
          test: /\.mp3$/,
          type: 'asset/resource',
          generator: {
            filename: 'sounds/[name][ext]',
          },
        },
      ],
    },
    // FIX: Global optimization - disable splitChunks for extension compatibility
    optimization: {
      minimize: !isDev,
      splitChunks: false, // DISABLED - Chrome Extensions can't load chunks properly
      runtimeChunk: false,
      // Keep extension logs visible in production so runtime issues can be
      // debugged from Chrome DevTools and the extensions error panel.
      minimizer: !isDev
        ? [
            new TerserPlugin({
              terserOptions: {
                format: {
                  comments: false, // Remove all comments
                },
                compress: {
                  drop_debugger: true, // Remove debugger statements
                },
              },
              extractComments: false,
            }),
          ]
        : [],
    },
    // FIX: Performance budgets with warnings for large bundles
    performance: {
      hints: 'warning', // Show warnings for large bundles
      maxEntrypointSize: 620000,
      maxAssetSize: 620000,
      assetFilter: (assetFilename) => !/\.(onnx|onnx\.data|wasm)$/i.test(assetFilename),
    },
  };

  // Configuration for Background Script (Service Worker) -> Target: webworker
  const bgConfig = Object.assign({}, commonConfig, {
    name: 'background',
    target: 'webworker', // CRITICAL: No DOM access
    entry: {
      background: './src/background/index.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: false,
      // FIX: Explicitly disable chunk loading for service worker
      chunkLoading: false,
      chunkFormat: false,
      // FIX: Skip the `new Function('return this')()` global-detection shim.
      // Service workers have native `globalThis` — no shim needed.
      globalObject: 'globalThis',
      // FIX: Must match webConfig — Chrome enforces the extension_pages
      // CSP (require-trusted-types-for 'script') on the service worker too.
      // Without this, webpack's runtime uses bare string assignments that
      // violate the Trusted Types policy, crashing background.js on load.
      trustedTypes: {
        policyName: 'webpack#ghostfill-bg',
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        global: 'globalThis',
        'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      ...(!isDev ? [new CssMinifyPlugin()] : []),
    ],
    // FIX: Ensure no split chunks for background
    optimization: {
      minimize: !isDev,
      splitChunks: false,
      runtimeChunk: false,
      minimizer: commonConfig.optimization.minimizer,
    },
  });

  // Configuration for UI and Content Scripts -> Target: web
  const webConfig = Object.assign({}, commonConfig, {
    name: 'web',
    target: 'web', // Standard DOM environment
    entry: {
      content: './src/content/index.ts',
      popup: './src/popup/index.tsx',
      options: './src/options/index.tsx',
      offscreen: './src/offscreen/offscreen.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: false, // Avoid deleting background.js
      publicPath: '', // HARDCODE publicPath to prevent dynamic GlobalRuntime injection!
      // FIX: Tell webpack the global object is already `globalThis`.
      // Without this, webpack's target:'web' runtime emits:
      //   var g = new Function('return this')();
      // to detect the global scope. That bare `new Function` string
      // violates `require-trusted-types-for 'script'` in the manifest
      // CSP, crashing popup.js, content.js, etc. on load.
      // All Chrome 88+ extension pages have native `globalThis` support.
      globalObject: 'globalThis',
      // Satisfy `require-trusted-types-for 'script'` in manifest CSP.
      // Webpack will use trustedTypes.createPolicy() when injecting chunks
      // instead of bare string assignment to script.src / innerHTML.
      trustedTypes: {
        policyName: 'webpack#ghostfill',
      },
    },
    optimization: {
      minimize: !isDev,
      // DISABLED: Chrome Extensions cannot load async split-chunks.
      // The webpack chunk-runtime does `t.push.bind(t)` on self.webpackChunk
      // before it is initialized, crashing with:
      //   "Cannot read properties of undefined (reading 'bind')"
      // Bundling everything into per-entry files avoids this entirely.
      splitChunks: false,
      runtimeChunk: false,
      minimizer: commonConfig.optimization.minimizer,
    },
    plugins: [
      new webpack.DefinePlugin({
        global: 'globalThis',
        'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      ...(!isDev ? [new CssMinifyPlugin()] : []),

      new HtmlWebpackPlugin({
        template: './src/popup/index.html',
        filename: 'popup.html',
        chunks: ['popup'],
        cache: false,
        meta: {
          'Content-Security-Policy': false,
        },
      }),

      new HtmlWebpackPlugin({
        template: './src/options/index.html',
        filename: 'options.html',
        chunks: ['options'],
        cache: false,
        meta: {
          'Content-Security-Policy': false,
        },
      }),

      new HtmlWebpackPlugin({
        template: './src/offscreen/offscreen.html',
        filename: 'offscreen.html',
        chunks: ['offscreen'],
        cache: false,
        meta: {
          'Content-Security-Policy': false,
        },
      }),

      // Copy assets only once
      new CopyWebpackPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'public/assets', to: 'assets' },
          { from: 'public/_locales', to: '_locales' },
          // Copy ML model + class metadata to dist/models/
          { from: 'models', to: 'models', noErrorOnMissing: true },
          // Copy only the WASM runtime used by the extension.
          {
            from: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
            to: '[name][ext]',
            noErrorOnMissing: true,
          },
        ],
      }),
    ],
  });

  return [bgConfig, webConfig];
};
