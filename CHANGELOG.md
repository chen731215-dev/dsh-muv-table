# Changelog

## v0.2.2 (2026-09-13)

### 🐛 修复

- **exports 放开 `./lib/*` 子路径**：`dsh-muv-engine` 需要导入本包的
  `lib/muv-parser.js`、`lib/block-generator.js`、`lib/initvar-parser.js`，
  但 `exports` 只映射了 `.` 与 `./client`，子路径导入会被 Node 的 exports 门禁拦住：

  ```
  import('dsh-muv-table/lib/muv-parser.js')
    -> ERR_PACKAGE_PATH_NOT_EXPORTED
  ```

  新增 `"./lib/*": "./lib/*"` 后即可正常解析。

### 🔧 改进

- **`panel.html` 读取改为容错**：原先在模块加载时直接
  `const PANEL_HTML = fs.readFileSync(...)`，一旦文件缺失就抛 `ENOENT`。
  由于模块加载失败会让所在 loader 行激活失败，而 DSH 启动时会校验每一行，
  这会让**整个 DSH 起不来**。改为 `let PANEL_HTML = ''` + `try/catch` 兜底。
  此改动与已发布的 0.2.1 npm 包保持一致（git 仓库此前落后于发布版）。

### 📝 注意

- `lib/panel.html` 被 `.gitignore` 排除，因此**从 `git clone` 的目录直接
  `dsh plugin add <路径>` 安装时该文件不存在**。容错改动后不会再导致启动失败，
  但面板内容会为空 —— 请走 npm registry 安装。

---

## v0.2.0 (2026-08-27)

### ✨ 新功能
- **宏测试浮窗**：点击面板 header 的「📐 宏」按钮弹出
  - 输入宏语法 → 展开测试 → 实时看结果
  - 展开结果支持「📋 复制」和「⬆ 填入」（回填到输入框继续编辑）
  - 🎲 快捷骰子栏：d4/d6/d8/d10/d12/d20/2d6/3d6/1d100 一键掷骰
  - 📌 Pick 缓存列表：展示所有缓存 key→值，单个重抽或全部清除
  - 📖 语法帮助折叠区

### 🔧 改进
- Header 按钮精简：去掉重复的「🍺 酒馆」按钮（与 🔄 刷新功能重复），替换为「📐 宏」
- 依赖 muv-engine 升级到 `^0.2.0`

---

## v0.1.0 (2026-08-26)

- 初始版本：树形变量表格编辑器、酒馆侧边栏入口、从酒馆加载角色卡、MUV 块生成