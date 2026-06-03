# CSDN to Obsidian

一个 Manifest V3 浏览器扩展，用来把 CSDN 文章页抽取成 Markdown，并一键复制、下载或导入 Obsidian。

## 功能

- 在 `*.csdn.net` 页面注入内容脚本，自动识别正文区域。
- 抽取标题、作者、发布时间、原文链接、正文、代码块、表格和图片链接。
- 生成带 YAML frontmatter 的 Markdown。
- 支持复制 Markdown、下载 `.md` 文件。
- 支持通过 `obsidian://new` 打开 Obsidian，并先把 Markdown 放入剪贴板，避免超长 URI 失败。

## 安装

1. 打开 Chrome / Edge 的扩展管理页面。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录：`C:\Users\徐zx\Documents\Codex\2026-06-03\csdn-obsidian-2`。

## 使用

1. 打开一篇 CSDN 文章。
2. 点击浏览器工具栏里的 `CSDN to Obsidian`。
3. 可选填写 Obsidian vault 和目标文件夹。
4. 点击“复制 Markdown”“下载 .md”或“导入 Obsidian”。

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

## 后续可增强

- 增加批量导出收藏夹或搜索结果页。
- 通过 Obsidian 插件接收 Markdown 和图片附件，实现真正的本地化导入。
- 引入 Readability / Turndown 作为可替换转换引擎。
- 为常见 CSDN 文章模板添加回归测试样例。
