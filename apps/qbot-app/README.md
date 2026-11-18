# QBot App

安卓 App「QBot」的 Expo 源码（SDK 58）。应用是一个 WebView。这一版要打开的地址是 `https://felixzhu.github.io/QBot/`。在这个地址返回 `version.json` 之前，不要打包，否则装上的应用没有页面可开。

当前源码版本：1.0.5（versionCode 7）。上一版已安装包是 1.0.4（versionCode 6），包名仍是 `io.github.felixzhu.qiandrive`。升级必须用原来的签名。本仓库没有签名文件。图标用的是方案 C（奶白底、黑色圆润方块加橙色小圆点），备选图在 `icon-options/`。

## 本地预览

```bash
npm install
npx expo start
```

打包前先确认页面已经在线。这一步失败就不要打 APK：

```bash
python3 apps/qbot-app/preflight_home.py
```

打包正式 APK 需要原来的上传签名。不要把密钥库或 `EXPO_TOKEN` 写进仓库。付费的 EAS 构建不在这一版里触发：

```bash
npx eas-cli@latest build -p android --profile preview --non-interactive
```

`eas.json` 使用 `appVersionSource: local`，版本号以 `app.json` 为准。不要把 `node_modules`、`.expo`、APK、日志、密钥库或任何令牌提交上来。
