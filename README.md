# CSDN to Obsidian

一个 Manifest V3 浏览器扩展，用来把 CSDN 文章页抽取成 Markdown，并一键复制、下载或导入 Obsidian。

## 功能

打开任何 `*.csdn.net` 的文章页面后，它能自动找到文章的主体内容。
抓取标题、作者、发布时间、原文链接、正文、代码块、表格和图片。
生成带 YAML frontmatter 的 Markdown（YAML frontmatter 就是文件最上面用 `---` 包起来的那段元信息，比如标题、标签、创建时间，Obsidian 能用它来管理笔记）。
支持三种操作：复制成 Markdown 文本，下载成 `.md` 文件，打开 Obsidian 并自动把内容粘贴进去（通过剪贴板搞定，避免文章太长时链接失败）。

## 安装

推荐下载 Release 里的安装包，而不是 GitHub 右上角 `Code -> Download ZIP` 的源码包：

[下载 csdn-to-obsidian-v0.1.1.zip](https://github.com/xzx1003/csdn-to-obsidian/releases/download/v0.1.1/csdn-to-obsidian-v0.1.1.zip)

1. 下载上面的 zip。
2. 解压。
3. 打开 Chrome / Edge 的扩展管理页面。
4. 开启开发者模式。
5. 选择“加载已解压的扩展程序”。
6. 选择解压出来的文件夹。

正确的文件夹里应该能直接看到：

```text
manifest.json
src/
README.md
```

如果使用 GitHub 的 `Code -> Download ZIP`，Windows 解压时可能会多套一层目录。加载扩展时必须选择**直接包含 `manifest.json` 的那一层**，否则浏览器会提示“清单文件丢失或不可读取”。

## 使用

1. 打开一篇 CSDN 文章。
2. 点击浏览器工具栏里的 `CSDN to Obsidian`。
3. 可选填写 Obsidian vault 和目标文件夹。
4. 点击“复制 Markdown”“下载 .md”或“导入 Obsidian”。

## 打包

开发者可以用下面的命令生成 release 安装包。生成的 zip 根目录会直接包含 `manifest.json`，适合 Chrome / Edge 加载。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-extension.ps1
```

输出位置：

```text
dist/csdn-to-obsidian-v<version>.zip
```

## 技术难点

### 1. CSDN DOM 结构不稳定

CSDN 文章可能使用 `#content_views`、`#article_content`、`.article_content` 等不同容器，且页面会混入推荐、登录、广告、版权、代码工具栏等元素。扩展里用多选择器候选加评分机制挑正文，并在克隆节点后清理噪声节点，减少对单一 DOM 结构的依赖。

### 2. 正文折叠、登录墙和付费内容

部分页面会用“阅读全文”遮罩或 `max-height` 截断正文。内容脚本会尝试展开常见按钮并解除高度限制，但不会也不应该绕过登录、会员或付费限制。若页面本身没有向浏览器渲染完整正文，扩展只能导出可见内容。

### 3. HTML 到 Markdown 的保真度

CSDN 文章里常有代码块、表格、图片、内联代码和嵌套列表。扩展内置了轻量 DOM-to-Markdown 转换器，重点保证代码块、表格、图片链接和标题层级可用。极复杂的富文本样式、公式渲染和自定义组件仍可能需要人工整理。

### 4. 图片本地化

当前版本保留远程图片链接。若要把图片下载到 Obsidian 附件目录，需要处理跨域读取、文件命名、下载队列、附件路径重写、Obsidian vault 路径不可直接由浏览器扩展访问等问题。更可靠的方案通常需要配合 Obsidian 插件或本地 Native Messaging host。

### 5. Obsidian URI 长度限制

长文章直接放进 `obsidian://new?content=...` 可能超过浏览器、系统或协议处理器的 URL 长度限制。因此扩展先把 Markdown 写入剪贴板，再调用 `obsidian://new?...&clipboard=true` 让 Obsidian 从剪贴板创建笔记。

### 6. 权限和安全边界

扩展只声明 `*.csdn.net` 的 host 权限，并使用内容脚本读取当前页面 DOM。浏览器扩展不能任意写入本地 Obsidian vault，只能通过下载、剪贴板、Obsidian URI 或 Native Messaging 与本地应用协作。
