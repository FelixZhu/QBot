# QBot App

安卓 App「QBot」的 Expo 源码（SDK 58，React Native 0.88，React 19.3）。当前源码版本：1.0.7（versionCode 9）。已安装的上一版是 1.0.5（versionCode 7），包名仍是 `io.github.felixzhu.qiandrive`。升级必须用原来的签名。本仓库没有签名文件，也不提交 `EXPO_TOKEN`。

1.0.7 把底栏、返回、会话列表、聊天和主动服务信息流做成本地原生界面。聊天用官方 `@assistant-ui/react-native`，三条 Info / English / Study 仍是本地演示。主动服务是虚构卡片，图片用 `expo-image`，短片用 `expo-video`，离开屏幕会暂停。知识库仍打开 `https://felixzhu.github.io/QBot/`。不要把网页端的 React 18 装进这个包。

## 本地预览

```bash
cd apps/qbot-app
npm install
npm run typecheck
node --experimental-strip-types --test src/host.test.ts
npx expo start
```

打包前先确认页面已经在线。这一步失败就不要打 APK：

```bash
python3 apps/qbot-app/preflight_home.py
```

确认原生依赖能打成 JS 包（不签名、不上传）：

```bash
cd apps/qbot-app
npx expo export --platform android --output-dir /tmp/qbot-android-export
```

打包正式 APK 需要原来的上传签名。不要把密钥库或打包令牌写进仓库。付费的 EAS 构建不在这一版里触发：

```bash
npx eas-cli@latest build -p android --profile preview --non-interactive
```

`eas.json` 使用 `appVersionSource: local`，版本号以 `app.json` 为准。不要把 `node_modules`、`.expo`、APK、日志、密钥库或任何令牌提交上来。
