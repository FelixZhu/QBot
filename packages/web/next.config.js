/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@qbot/core', '@qbot/ui'],
  
  // Webpack 配置
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 服务端：将数据库相关模块标记为外部依赖
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push({
          '@qbot/core/db': 'commonjs @qbot/core/db',
          '@qbot/core/auth': 'commonjs @qbot/core/auth',
          '@qbot/core/repository': 'commonjs @qbot/core/repository',
        });
      }
    }
    
    // 忽略非代码文件
    config.module.rules.push({
      test: /\.md$|LICENSE$|\.d\.ts$/,
      use: 'null-loader',
    });
    
    return config;
  },
};

module.exports = nextConfig;
