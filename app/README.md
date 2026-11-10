# 共振星门 · 联机试玩

需要 Node.js 22.12 以上。打开两个终端，从仓库根目录分别启动服务端和客户端。

```powershell
cd server
npm ci
npm run build
npm start
```

```powershell
cd app
npm ci
npm run dev -- --host 0.0.0.0
```

本机访问 Vite 输出的 Local 地址。同一受信任 Wi-Fi 的另一台设备可访问 Network 地址，浏览器请求由 Vite 转发至本机联机服务。各自注册游戏账号，一方建房，另一方输入六位房间码。开发环境的 HTTP 连接仅用于测试账号。公网部署需要由 HTTPS 反向代理转发 `/api` 与 WebSocket `/ws`。

拖动星图或使用方向键移动自己的球。粉色和薄荷色各有三个符文。屏幕给出的是搭档的线索，可以点击「给搭档报点」把解出的符文发送给对方，也可以通过通话交换线索。按本关要求沿月、潮、花的循环推算落点。双方站对、调整光带长度后，在 300 毫秒内各按一次共振。完成全部三关可重玩。断线暂停，返回同一账号、同一房间可恢复；任一人点离开房间会结束整间房。

## Android 调试版

调试包使用包名 `games.qiuqiu.planet`。应用内填写联机服务的根地址。用同一 Wi-Fi 测试时可填电脑的 Vite Network 地址（含端口），两端须连到同一个服务。异地使用需要公网 HTTPS 服务。构建时可用 `VITE_SERVER_URL` 提供默认地址。

本地需要 JDK 21、Android SDK Platform 35。以下命令在 app 目录执行。

```powershell
npm run build
cd android
.\gradlew.bat assembleDebug
```

安装包位于 android/app/build/outputs/apk/debug/app-debug.apk。正式发行使用独立发布签名。
