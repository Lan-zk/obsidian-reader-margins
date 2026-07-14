# Reader Margins

> 在 Obsidian 内置 PDF 阅读器的页边距上叠加批注卡片。

Reader Margins 是一个 Obsidian 插件，为 PDF 阅读器增加"页边批注"能力：选中正文即可高亮/下划线，并在页面两侧的页边距里生成可编辑、可拖动的批注卡片，用虚线连接线指向原文。批注随 PDF 持久化，可导出为 Markdown。

- 桌面端专用（`isDesktopOnly: true`）
- 最低 Obsidian 版本：1.12.0
- 当前版本：0.1.0（MVP）

---

## 功能

### 标注
- **高亮 / 下划线**：选中文本后，用工具栏色块或命令创建标注。
- **页边卡片**：每条标注在对应页的左右页边距生成一张卡片，显示高亮原文（引文）与你的批注。
- **连接线**：卡片与原文之间用虚线连接，带锚点圆点；悬停卡片时连接线流动高亮。
- **多色**：可配置颜色集（默认黄/蓝/绿/红），每条标注独立着色；卡片边框、选中态背景按标注色区分。

### 卡片交互
- **悬停即选中**：鼠标移上卡片即进入选中态（按色 tint 背景 + 加深的标注色边框），无需点击。
- **可拖动**：卡片右上角的 grip 手柄可拖动，**纵向限定在本页内、横向限定在页边距内**，不会跑到其他页或压到正文。落位后位置随批注持久化。
- **自动避让**：未拖动的卡片按阅读顺序自动 push-down 排版；拖动过的卡片"钉死"在用户放置的位置，其余卡片绕开它。
- **双击 grip** 复位（回到自动排版）。
- **点击原文高亮** 闪烁定位其卡片。

### 编辑
- 点击卡片正文进入编辑，写批注；`Cmd/Ctrl+Enter` 保存，`Esc` 取消。
- 卡片底栏（悬停显现）：色块切换颜色、删除。

### 持久化与同步
- 批注写入插件 `data.json`，按 PDF 指纹（fingerprint + 页数）绑定，跨会话保留。
- **乐观并发**：多窗口同改一条批注时，后提交者收到冲突提示，保护数据。
- 持久化状态指示（保存中/失败/待写）显示在工具栏。
- PDF 被替换（指纹不匹配）时，旧批注暂不显示，防止错位。

### 导出
- 一键导出当前 PDF 的全部批注为 Markdown（带 frontmatter、页码链接、按色着色的引用块）。

### 命令
- **Highlight selected text (default color)**：用默认色高亮选中文本。
- **Underline and comment selected text**：下划线并批注选中文本。

---

## 安装

> 该插件尚未发布到 Obsidian 社区插件市场，需从源码构建。

```bash
git clone <repo-url>
cd obsidian-reader-margins
npm install
npm run build        # 产物：main.js（+ manifest.json、styles.css）
```

将以下三个文件复制到你的 Obsidian 库的插件目录：

```
<vault>/.obsidian/plugins/reader-margins/
├── main.js
├── manifest.json
└── styles.css
```

然后在 Obsidian：设置 → 第三方插件 → 关闭"安全模式"→ 启用 "Reader Margins"。

### 开发

```bash
npm run dev          # esbuild watch，改动自动重打包
npm test             # 运行单元 / 契约测试（vitest）
npm run test:watch   # 测试监听
```

开发时可把插件目录软链到仓库根，或在 `npm run dev` 运行时手动复制 `main.js` 到库插件目录。Obsidian 内 `Cmd/Ctrl+P` → "Reload app without saving" 可重载插件。

---

## 使用

1. 在 Obsidian 打开一个 PDF。
2. 选中正文文本。
3. 执行任一操作：
   - 点击 PDF 工具栏右侧的色块（高亮）、下划线图标、或导出图标。
   - 命令面板运行 "Highlight selected text" / "Underline and comment"。
4. 批注卡片出现在页边距；悬停可拖动、编辑、换色、删除。
5. 工具栏导出图标 → 导出 Markdown。

### 设置

设置 → Reader Margins：

- **批注颜色**：增删、改名、改色（校验为 `#RRGGBB`，至少保留一个，默认色不可删）。
- **默认颜色**：选中文本命令使用的默认色。

---

## 设计

视觉系统为 **Atomic Minimalism**：扁平、无阴影、1px 边框、色调分层、4px/8px 圆角、Hanken Grotesk 字体。颜色克制（克制策略），标注色仅用于状态/标识，不做装饰。设计细节见 `docs/design.md`（本地工作文档）。

---

## 架构

分层、可测试，纯逻辑与 Obsidian/PDF.js 宿主访问隔离。

```
src/
├── main.ts                  # 插件入口：加载、命令、设置注册
├── domain/                  # 纯领域逻辑（无 DOM/宿主依赖）
│   ├── annotation.ts        #   批注记录、位置（CardPositionV1）
│   ├── colors.ts            #   颜色配置、校验
│   ├── pdf-text-anchor.ts   #   文本锚点几何、引文规范化
│   └── anchor-resolver.ts   #   选区 → 锚点
├── store/                   # 持久化与状态
│   ├── durable-annotation-store.ts   #   读写、乐观并发、设置变更
│   ├── persistence-coordinator.ts    #   防抖写盘、状态机
│   ├── plugin-data-schema.ts         #   data.json schema、加载校验
│   └── indexes.ts                    #   按页/按路径索引
├── host/                    # Obsidian / PDF.js 私有访问（全部防御式，失败返回 null）
│   ├── obsidian-pdf-host.ts
│   └── host-capabilities.ts
├── session/                 # 视图生命周期
│   ├── viewer-session.ts    #   核心：渲染、拖动、悬停、选区、编辑回调
│   ├── pdf-view-manager.ts
│   ├── draft-controller.ts
│   └── selection-snapshot-controller.ts
├── render/                  # 渲染（纯函数，jsdom 可测）
│   ├── mark-renderer.ts     #   高亮/下划线
│   ├── annotation-card-rail.ts  # 卡片构建
│   ├── connector-renderer.ts    # 连接线
│   ├── card-layout-engine.ts    # 排版（pin + 避让）
│   ├── page-projection.ts   #   点击命中测试
│   └── icons.ts             #   内联 SVG 图标
├── toolbar/                 # 工具栏（色块/下划线/导出/状态）
├── export/                  # Markdown 导出
├── settings/                # 设置面板
└── diagnostics/             # 诊断上报
```

关键设计：
- **纯逻辑可测**：领域、排版、渲染、编解码均为纯函数，在 jsdom/vitest 下测试；Obsidian 私有访问集中在 `host/`。
- **乐观并发**：每条批注带 `revision`，更新带 `baseRevision` 校验。
- **稳定坐标系**：拖动位置存页内未缩放坐标（`page-css-v1`），缩放/滚动稳定。详见 `docs/card-dragging.md`。
- **reconcile 合并**：渲染经 rAF 合并，避免缩放等连续事件反复重绘。

测试：`src/tests/` 下 unit（纯逻辑）与 host-contract（宿主契约）双轨。

---

## 限制

- 桌面端 only（移动端不支持）。
- 卡片横向拖动范围限于页边距宽度（不压到 PDF 正文）。
- 拖动时邻居不实时避让（落位后才重排）。
- 依赖 Obsidian 内置 PDF 阅读器的内部 DOM 结构；Obsidian 大版本升级可能需要适配 `host/`。
- 批注锚定到 PDF 文本层；无文本层的扫描件（纯图片 PDF）无法精确定位。

---

## 许可证

[MIT](./LICENSE)。可自由复制、修改、分发、商用，仅需保留版权声明与本许可声明。
