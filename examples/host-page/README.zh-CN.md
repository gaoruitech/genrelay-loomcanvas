# host-page：把整个应用嵌进你的页面

[English](README.md)

[docs/integration.zh-CN.md](../../docs/integration.zh-CN.md) 里的形态一：在一个纯 HTML 页面里调 `mountLoomCanvas(el, options)`，不用框架，也不用打包工具（它引的是 `dist-lib/standalone/app.js`，Vue 已经打在里面）。

按 [../README.zh-CN.md](../README.zh-CN.md) 里写的步骤跑起来，然后打开 `http://127.0.0.1:4173/host-page/`。

`main.js` 里值得看的地方：

- `hostSignIn()` 是宿主自己的登录。LoomCanvas 的登录页从头到尾不会出现；`getAuth` 把宿主的会话交给每一个请求，API 返回 401 时 `onAuthRequired` 把宿主的登录表单带回来（点「Expire my session」就能触发）。
- `shell: 'none'`：红色的页头和上面的按钮都是宿主的，它们通过 `lc.navigate()`、`lc.setTheme()`、`lc.setLocale()` 驱动 LoomCanvas。
- `pages: ['canvases', 'canvas', 'assets', 'brand-kits']`：「Models」按钮要去的页面不在这个清单里，点了什么都不会发生。
- `features`、`brand`、`messages`（列表的标题被改成了「Boards」）、`storagePrefix`。
- 宿主页头里的「Space」选择列出个人空间和当前账号所在的团队（宿主自己去调 `GET /api/teams`）。选一个，应用就先卸载，再带着 `space` 选项重新挂载：应用被固定在那个空间里，不再显示自己的空间切换器，画布、素材、模型和 Key 都是那个空间的。`features.teamAdmin: false` 把「团队」页去掉了，成员由自己管理的产品就该这么做。加 `?space=<团队 id>` 可以直接从某个团队开始。
- 「Second instance」在第二个盒子里再挂一个视图，用的是同一个运行时。
- 「Narrow box」把盒子缩到 520 px：布局跟着盒子走，不跟着窗口走。
- 加 `?router=hash`，导航就体现在地址栏里（`#/canvas/<id>`），深链接和后退按钮都能用。

`index.html` 里值得看的地方：宿主的样式表用了 `* { box-sizing: content-box }`、`button { all: revert }`、`a { color: red }`，基础字体是 20 px 的衬线体。两边互不干扰；这种隔离的边界写在集成文档的「样式隔离」一节。

页面最下面的 Events 框把宿主收到的事件打出来（`ready`、`route`、`space`、`canvas:saved`、`run:*`、`result`、`error`）。
