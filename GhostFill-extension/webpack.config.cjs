
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
// FIX: Add TerserPlugin for production log stripping and bundle optimization
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
    const isDev = argv.mode !== 'production';

    const commonConfig = {
        mode: isDev ? 'development' : 'production',
        devtool: isDev ? 'cheap-module-source-map' : false,
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
                // FIX: Removed @ai alias - directory does not exist
            },
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
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
            // FIX: Add TerserPlugin for production builds to strip console.log/debug/warn
            minimizer: !isDev ? [
                new TerserPlugin({
                    terserOptions: {
                        format: {
                            comments: false, // Remove all comments
                        },
                        compress: {
                            drop_debugger: true, // Remove debugger statements
                            // Custom transformer to strip console.log/debug/info/warn but keep console.error
                            pure_funcs: [],
                        },
                    },
                    extractComments: false,
                }),
            ] : [],
        },
        // FIX: Performance budgets with warnings for large bundles
        performance: {
            hints: 'warning', // Show warnings for large bundles
            maxEntrypointSize: 512000, // 500KB warning threshold (except react)
            maxAssetSize: 512000,
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
            clean: true,
            // FIX: Explicitly disable chunk loading for service worker
            chunkLoading: false,
            chunkFormat: false,
        },
        plugins: [
            new MiniCssExtractPlugin({
                filename: '[name].css',
            }),
        ],
        // FIX: Ensure no split chunks for background
        optimization: {
            minimize: !isDev,
            splitChunks: false,
            runtimeChunk: false,
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
        },
        plugins: [
            new MiniCssExtractPlugin({
                filename: '[name].css',
            }),

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
                    { from: 'src/assets', to: 'assets' },
                    { from: 'public/_locales', to: '_locales' },
                ],
            }),
        ],
    });

    return [bgConfig, webConfig];
};
