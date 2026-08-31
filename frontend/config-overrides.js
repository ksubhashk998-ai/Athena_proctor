// config-overrides.js
const webpack = require('webpack');

module.exports = {
  webpack: function override(config, env) {
    // Disable sourcemap generation to prevent memory exhaustion and drastically speed up compilation
    config.devtool = false;

    // Use persistent filesystem caching for ultra-fast startup and hot reloads
    config.cache = {
      type: 'filesystem',
      allowCollectingMemory: true,
    };

    // Remove source-map-loader which severely slows down processing heavy packages like @tensorflow & face-api
    if (config.module && config.module.rules) {
      config.module.rules = config.module.rules.filter(rule => {
        if (rule.loader && rule.loader.includes('source-map-loader')) return false;
        if (rule.use && Array.isArray(rule.use) && rule.use.some(u => (typeof u === 'string' ? u : u.loader || '').includes('source-map-loader'))) return false;
        return true;
      });
    }

    // Remove ESLint plugin from webpack in dev mode if present (already checked or handled)
    config.plugins = (config.plugins || []).filter(p => {
      const name = p && p.constructor && p.constructor.name;
      return name !== 'ESLintWebpackPlugin' && name !== 'ForkTsCheckerWebpackPlugin';
    });

    // Add fallbacks for Node.js core modules in Webpack 5
    config.resolve = config.resolve || {};
    config.resolve.symlinks = false;
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "buffer": require.resolve("buffer/"),
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "process": require.resolve("process/browser.js"),
      "fs": false,
      "vm": false
    };
    
    // Add plugins
    config.plugins.push(
      new webpack.ProvidePlugin({
        process: 'process/browser.js',
        Buffer: ['buffer', 'Buffer']
      })
    );
    
    // Ignore warnings for TensorFlow, @vladmandic/face-api, node_modules, asn1.js, fs, vm
    config.ignoreWarnings = [
      /Failed to parse source map/,
      /node_modules\/@tensorflow/,
      /node_modules\/@vladmandic/,
      /Critical dependency/,
      /node_modules\/axios/,
      /node_modules\/asn1.js/,
      /node_modules\/tfjs-image-recognition-base/
    ];
    
    return config;
  },
  devServer: function(configFunction) {
    return function(proxy, allowedHost) {
      const config = configFunction(proxy, allowedHost);
      config.allowedHosts = ['all'];
      config.open = false;
      config.historyApiFallback = true;
      return config;
    };
  }
};