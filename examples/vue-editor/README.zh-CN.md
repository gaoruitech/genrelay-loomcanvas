# vue-editor：Vue 应用里的 `<LoomCanvasEditor>`

[English](README.md)

[docs/integration.zh-CN.md](../../docs/integration.zh-CN.md) 里的形态二，宿主是 Vue 3，后端是自带的 LoomCanvas 服务端，经 `createHttpAdapter` 对接。

按 [../README.zh-CN.md](../README.zh-CN.md) 里写的步骤跑起来，然后打开 `http://127.0.0.1:4173/vue-editor/`。

值得看的地方：

- `index.html`：import map。`loomcanvas-web/editor` 把 `vue` 留给宿主（对等依赖），所以宿主和编辑器用的是同一份 Vue。用打包工具时它会从 `node_modules` 里解析出来；这个页面是手工映射的。
- `main.js` 的 `signIn()`：宿主按自己的方式登录，然后用 `createHttpAdapter({ apiBase, getAuth })` 建**一个**适配器。有哪些画布、新建一张、打开哪一张，都是宿主的事（它自己去调 `/api/workflow`）；编辑器只编辑 `canvas-id` 指的那一张。
- `main.js` 的 `enterSpace()`：空间选择列出个人空间和当前账号所在的团队。一个适配器只属于一个空间，所以换空间就要用 `createHttpAdapter({ space })` 另建一个（它的每个请求都带 `X-Space`），再用它重新挂载编辑器（`:key="space"`）。宿主自己发给 `/api/workflow` 的请求带的是同一个头。
- 在团队空间里，编辑器会让大家轮流编辑，宿主什么都不用多做：别人正在编辑这张画布时，它以只读打开并说明是谁，同时给出「复制一份」和「接管编辑」；从旧版本出发的保存会问用户怎么处理。用同一个团队的两个账号、开两个浏览器试试。
- 编辑器把自己的文档存成一张新画布时（「复制一份」「把我的版本另存为副本」）会发 `created` 事件；宿主收到后重新拉一次画布列表。
- 模板里：`canvas-id`、`theme`、`locale`、`node-layout` 和 `read-only` 是响应式的 props；事件以组件事件的形式到达；`ref="editor"` 上暴露了 `addNode`、`runAll`、`undo`、`redo`、`fitView`、`getDocument`。
- `features: { cost: true, templates: true }` 打开了两项 HTTP 适配器撑得起来的功能。产品的其余部分（分享、品牌包、素材库、批量运行、模型管理、主题和语言菜单）都不出现。
- 编辑器填满 `.box`；勾上「narrow」把它缩到 480 px，编辑器随之换成窄屏布局。

这个组件是 `mountEditor` 外面的一层薄封装：编辑器在那个元素里作为自己的 Vue 应用运行，所以 LoomCanvas 的任何东西（Pinia、vue-i18n、路由）都不会装到宿主应用上。

在用打包工具的真实项目里：

```js
import { LoomCanvasEditor, createHttpAdapter } from 'loomcanvas-web/editor'
import 'loomcanvas-web/editor.css'
import 'loomcanvas-web/fonts.css' // 可选
```
