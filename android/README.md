# 知政 Android

这是平台 Java + WebView 的轻量离线应用。没有第三方运行时、账号系统、广告 SDK 或后台服务。

## 构建

- JDK 17
- Android SDK platform 35 / build-tools 35.0.0
- Gradle wrapper 8.11.1 / Android Gradle Plugin 8.9.2
- Node.js：在上级工程目录先执行 `npm ci`

Android Studio 可直接打开本目录。命令行设置 SDK 路径（`ANDROID_HOME`，或本地 `local.properties` 的 `sdk.dir`）后：

```sh
./gradlew assembleRelease
```

`preBuild` 自动同步上级 `dist/` 至应用资源目录，并将 JavaScript 转译到 Chrome 74；`compat.js` 提供旧 WebView 所缺的 DOM 与弹窗方法。输出位于 `app/build/outputs/apk/release/`。默认 release 未签名，请在本机用私有 keystore 签名。签名资料禁止提交 Git。

## 数据与备份

WebView 仅载入固定本地 HTTPS 源，网络源内容不进入带桥接接口的页面。原题来源链接通过系统浏览器打开。

学习记录保存在本机应用数据内。备份走 Android 系统文件选择器；无需存储权限。JSON 与网页版兼容。卸载应用会删除本机记录，请先导出备份。

更新应用保持包名与签名证书不变并提高版本号，可以保留现有进度。
