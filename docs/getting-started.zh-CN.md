# 快速上手

[English](getting-started.md)

这一页带你从一台空机器走到生成第一张图。

LoomCanvas 本身不带模型。你用自己的 API Key 添加一个服务商，画布替你去调用它的模型。

> 状态：早期开发中。内置的高瑞模型已经对着真实服务运行过；OpenAI 和 Google Gemini 按官方文档接入，项目还没有实际运行过。如果发现请求格式不对，请提 issue。

## 1. 准备

| 需要 | 说明 |
| --- | --- |
| Docker 和 Compose v2（`docker compose`） | Compose 文件会启动 LoomCanvas 和 MongoDB 7。 |
| Git | 拉取源码。镜像在本机构建。 |
| 高瑞、OpenAI 或 Google Gemini 的 API Key | 见第 4 步。 |

不用 Docker 的做法见[部署](deployment.zh-CN.md#不用-docker-运行)。

## 2. 启动

```bash
git clone https://gitee.com/jishulin/loomcanvas.git
cd loomcanvas
cp .env.example .env
```

编辑 `.env`：

1. 把 `SECRET_KEY` 设成一串足够长的随机字符（至少 16 位）。可以这样生成：

   ```bash
   openssl rand -base64 32
   ```

2. 本机或内网使用时，`PUBLIC_URL` 留空即可。上传和生成的文件按「当前打开的地址」寻址，换主机、换端口都能用。需要上游模型按地址读取参考素材时（本地存储下用视频做输入、或者给高瑞的图片模型传参考图就需要），再把它设成实例的公网地址（例如 `https://canvas.example.com`）。详见[部署](deployment.zh-CN.md#public_url)。

3. 如果别人也能访问这台机器，建议设置 `ACCESS_PASSWORD`。

然后启动：

```bash
docker compose up -d
```

第一次会构建镜像，需要几分钟。确认已经起来：

```bash
docker compose ps
docker compose logs app
```

日志里出现 `LoomCanvas server listening on :3000` 就是好了。

## 3. 打开页面

打开 <http://localhost:3000>。改过 `PORT` 就用改后的端口；从别的机器访问时，把 `localhost` 换成这台机器的地址。

- 设了 `ACCESS_PASSWORD` 的话，先输入口令。
- 新实例还没有添加服务商，会先进入引导页。

![引导页](images/01-setup.png)

## 4. 添加一个服务商

在引导页选一家服务商，填入你的 API Key，点「测试并保存」。系统会先保存，再做一次连通性测试，通过后进入画布列表。测试失败时不会保留这个服务商，并显示原因。

表单里列着「此服务商支持的模型」。这份列表是 LoomCanvas 自带的，不是从上游读取的。

| 服务商 | 要填什么 | 说明 |
| --- | --- | --- |
| 高瑞（推荐） | API Key | 一个 Key 可用图片、视频和对话模型。在 <https://gaorui.cc> 获取 Key。 |
| OpenAI | API Key | 走 OpenAI 官方接口。对话，图片生成与编辑。没有视频。 |
| Google Gemini | API Key | 走 Gemini 官方接口。图片生成与编辑、对话。没有视频。 |

每家服务商默认用它的官方地址。要用别的地址，展开「高级」修改「接口地址」；对方必须使用与官方完全相同的接口。

也可以点「先跳过」，稍后在「设置 → 服务商」里添加。服务商列表里没有的模型，之后可以作为自定义模型添加。详见[服务商](providers.zh-CN.md)。

## 5. 从模板新建画布

1. 在「我的画布」页点「从模板新建」。
2. 选「文生图」。打开的画布里已经有一个文本节点连着一个图片生成节点。

![画布编辑器](images/04-editor.png)

## 6. 运行节点

1. 想换提示词，直接改文本节点里的文字。
2. 在图片生成节点里打开模型下拉，选一个模型。如果下拉里显示「还没有可用的模型」，回到「设置 → 服务商」检查服务商和模型是否启用。
3. 点节点上的「运行」。

结果框角上的标记显示状态：排队中、运行中、完成、失败。

顶栏的「运行全部」要求画布上至少有一个成品节点。「文生图」模板里没有成品节点，所以这里用节点自己的「运行」按钮。

## 7. 结果与成本

![运行完成](images/06-editor-result.png)

- 结果显示在节点的结果框里。再次运行不会覆盖它，之前的结果留在节点的历史里。
- 结果文件会转存到你自己的存储里（默认是 `app_data` 数据卷），不依赖上游可能过期的链接。
- 运行按钮旁边显示这次运行的预估成本。新装的实例显示「成本未知」，因为还没有配置价格。在「设置 → 模型 → 设置价格」里填上你向上游实际支付的单价，见[服务商](providers.zh-CN.md#价格)。
- 「设置 → 用量」里有每一次运行的记录，以及按天、按模型的汇总。

## 接下来

- [使用指南](user-guide.zh-CN.md)：画布能做的所有事。
- [部署](deployment.zh-CN.md)：把实例放到公网之前先看。
- [常见问题](faq.zh-CN.md)：遇到问题时看。
