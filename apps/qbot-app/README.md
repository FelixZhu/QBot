# QBot App

安卓 App「QBot」的 Expo 源码（SDK 58，React Native 0.88，React 19.3）。当前源码版本：1.0.8（versionCode 10）。已安装的上一版是 1.0.5（versionCode 7），包名仍是 `io.github.felixzhu.qiandrive`。升级必须用原来的签名。本仓库没有签名文件，也不提交 `EXPO_TOKEN`。

1.0.8 把底栏、返回、会话列表和聊天做成本地原生界面，主动服务改成和网页一致的六课竖向 Feed。聊天用官方 `@assistant-ui/react-native`。回复走本地传输，三条 Info / English / Study 仍是演示，没有接通真实后端；新输入的句子留在这台设备上。六课可以上下滑，第 3 课白面板可以左右滑；点赞、收藏和打卡留在本机。视频是静态海报，标「演示」；问 AI 标「模拟」。知识库仍打开 `https://felixzhu.github.io/QBot/`。不要把网页端的 React 18 装进这个包。界面只用系统字体，不提交字体文件。

## 本地预览

```bash
cd apps/qbot-app
npm install
npm run typecheck
npm test
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
