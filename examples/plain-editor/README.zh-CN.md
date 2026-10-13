# plain-editor：不用框架、不要服务端的 `mountEditor`

[English](README.md)

[docs/integration.zh-CN.md](../../docs/integration.zh-CN.md) 里的形态二，放在一个纯 HTML 页面里。它用的是 `createMemoryAdapter`，所以能证明编辑器只依赖它的适配器：不会去连任何 LoomCanvas 服务端，运行是假的，结果是一张生成出来的图片。

在 `web/` 里执行过 `npm run build:lib` 之后，运行 `node examples/serve.mjs`，然后打开 `http://127.0.0.1:4173/plain-editor/`。

`main.js` 里值得看的地方：

- `document: sample`：宿主把一份[公开格式](../../docs/integration.zh-CN.md#文档格式)的文档交给编辑器，改动通过 `onChange` 拿回来（按 `changeDebounceMs` 防抖）。编辑器自己不加载也不保存任何东西。
- 那排按钮调的是句柄上的方法：`addNode`、`runAll`、`runNode`、`undo`、`redo`、`fitView`、`getDocument`、`setDocument`、`setReadOnly`、`setTheme`、`setLocale`、`setNodeLayout`、`unmount`。
- 工具面板里没有工具节点（切图、拼图等）：内存适配器没有 `runTool`，而编辑器只提供适配器跑得了的东西。
- 「narrow box」把编辑器缩到 440 px。

要接你自己的后端，就把适配器换掉。必须实现的成员有 `loadCanvas`、`saveCanvas`、`listModels`、`submitRun`、`getRuns`、`cancelRun`、`submitLlm`、`getLlm`、`upload`、`resolveFileUrl`；`web/test/adapterContract.ts` 是一套测试，可以拿来跑你的实现。

React 宿主做的是同一件事，只是写在 effect 里：见 [react-host](../react-host/README.zh-CN.md)，那个示例项目自己跑过。
