# QBot App

安卓 App「QBot」的 Expo 源码（SDK 58）。应用本身是一个 WebView，打开的是线上只读网盘页 [Qian's Drive](https://felixzhu.github.io/qian-drive/)。改网页或往 OSS 加文件后，打开 App 或下拉刷新即可看到最新内容，一般不用重装。

当前版本：1.0.3（versionCode 4）。图标用的是方案 C（奶白底、黑色圆润方块加橙色小圆点），备选图在 `icon-options/`。

## 本地预览

```bash
npm install
npx expo start
```

打包正式 APK（需要 `EXPO_TOKEN`，不要把令牌写进仓库）：

```bash
npx eas-cli@latest build -p android --profile preview --non-interactive
```

`eas.json` 使用 `appVersionSource: local`，版本号以 `app.json` 为准。不要把 `node_modules`、`.expo`、APK、日志、密钥库或任何令牌提交上来。
