// config-overrides.js
const webpack = require('webpack');

module.exports = {
  webpack: function override(config, env) {
    // Enable Webpack 5 persistent filesystem cache for ultrafast startup
    if (env === 'development') {
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__filename],
        },
      };
    }

    // Add fallbacks for Node.js core modules in Webpack 5
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
    config.plugins = [
      ...config.plugins,
      new webpack.ProvidePlugin({
        process: 'process/browser.js',
        Buffer: ['buffer', 'Buffer']
      })
    ];
    
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