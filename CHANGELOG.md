# Changelog

## v0.2.7 (2026-09-20)

### 📦 发布内容修正

- **把 `test-png-card.mjs` 纳入 npm 包**。0.2.6 的 README 让用户跑
  `node test-png-card.mjs`，但 `files` 字段没列它，从 npm 安装的人拿不到。
  现在一并发布，装完即可自测 PNG 卡解析是否正常（含真实卡库验证，卡库不存在时自动跳过）。
- `README.md` 显式列入 `files`。

> 0.2.6 的功能改动见下。

## v0.2.6 (2026-09-20)

### 🐛 修复：变量面板显示错误的卡（显示成苍玄界）

两个独立原因，都会让面板拿到**别的预设**的卡：

- **无 `presetId` 时回退到硬编码预设**：面板只在收到 `tavern-preset-changed`
  事件后才设置 `lastPresetId`，而页面首次加载时该事件不会触发，请求因此不带
  参数；服务端于是回退到写死的 `tavern-lite`，把那个预设的卡显示出来。
  现在新增 `/api/muv-table/active-preset`，面板在首次加载前先问服务端
  「当前是哪个预设」，服务端按**最近写入的会话**所绑定的预设来回答。
- **过期 managed copy**：`tavern-lite/muv-tables/card.json` 里是 8 月留下的
  苍玄界，而该预设的 `characters.json` 早已改成川上富江。现在 `card.json`
  的卡名与预设记录不一致时不再采用，转而走卡库匹配，避免张冠李戴。

### ✨ 支持读取 SillyTavern 的 PNG 角色卡

- **新增 `lib/png-card.js`**：从 PNG 的 `tEXt`/`iTXt` 元数据里解出 `chara` 块
  （base64 编码的卡 JSON）。这是 TavernAI 系生态的标准做法——图片本身就是卡，
  角色数据搭车存在文件里，所以一张 3.5 MB 的「卡」实际是封面图 + 约 1.5 MB 的
  base64 卡数据。
- **为什么需要**：DSH 自己的导入器只把 `{name, desc, first, enabled}` 写进
  `characters.json`，**正则脚本、世界书、tavern_helper 全部丢失**。所以一张拖进
  SillyTavern 的卡，在 DSH 这边只能拿到 3 KB 文本残影。现在直接读原始 PNG 文件。
- **卡库搜索路径接入 SillyTavern**：自动发现
  `<SillyTavern>/data/<user>/characters`（含 `C:/MySpecialFolder/SillyTavern`、
  `~/SillyTavern`、`~/Documents/SillyTavern`），可用 `DSH_SILLYTAVERN_DIR`
  覆盖。预设目录里直接放 `.png` 也会被识别。
- `findJsonMatch` 同时接受 `.json` 与 `.png`，按卡名匹配。

实测：SillyTavern 卡库 5 张 PNG 卡全部读出，其中 4 张带回完整正则脚本
（足控天堂 10 个、异世界农场 3 个、涩涩提瓦特 2 个、食人世界 2 个）。

### 🧪 测试

- 新增 `test-png-card.mjs`：12 项，覆盖合成 PNG 解析、无 `chara` 块拒绝、
  垃圾数据不抛异常，以及真实卡库验证（卡库不存在时自动跳过）。

## v0.2.5 (2026-09-20)

### 🐛 修复：变量面板读不到已导入的卡

- **新增 `extractMuvFromCharactersJson`**：酒馆把导入的卡存在
  `<预设目录>/characters.json`。此前面板只认两条路——预设里的
  `muv-tables/card.json`，或按卡名在外部卡库目录里找原始 JSON 文件。
  导入的卡往往两条都不满足（原始文件根本没下载到本机），于是接口返回
  `found:false`、变量面板空白，**而数据其实就在 characters.json 里**。
  现在第三条路直接从那里提取变量表。
- 同时支持两种编码：`<VariableInsert>{…纯 JSON…}`（社区卡常见）与
  MUV 原生的 `<UpdateVariable><initvar>…</initvar></UpdateVariable>`。
- 过滤掉 `主播档案.$template` 占位条目，它不是真实角色。

### 🐛 修复：角色卡读取路径过窄

- `MUV_CARD_DIRS` 之前硬编码了某一台机器的下载目录，换台机器就找不到卡。
  现在按顺序尝试：预设目录 `muv-tables/card.json`、`DSH_MUV_CARD_DIRS`
  环境变量、系统下载目录、桌面。
- 角色卡名可从酒馆的 `characters.json` 读取，不再依赖单一 yml 字段。
- `tavern-card` 接口支持按 `presetId` / `sessionId` 取卡，并返回
  `regexScripts` 与 `data.extensions.regex_scripts` 两种正则脚本形态。

## v0.2.4 (2026-09-13)

### 📝 文档

- `package.json` 的 `description` 补上「是 `dsh-muv-engine` 的伴生插件」。
  插件市场与 npm 的条目会带上这句，避免用户只装了引擎却奇怪变量表格为什么不显示。
- 同步收录到 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  精选列表（`category: ui`），与另外两个插件一起。

> 无代码改动。未改动许可证内容。

---

## v0.2.3 (2026-09-13)

### 🐛 修复

- **DSH 装到非默认位置时读不到预设**：`PRESETS_ROOT` 等路径写死为 `~/.dsh`。
  DSH 本体按 `$DSH_HOME`（非空）→ `~/.dsh` 解析 home，用户预设目录是
  `<dshHome>/.agent-presets`。`DSH_HOME` 非默认时本插件扫的是错误目录，
  角色卡列表恒为空。

  现在与酒馆插件保持一致：`apply()` 时优先取 DSH 的 `dshHomePath` 服务，
  拿不到再按环境变量解析，并同步绑定 `PRESETS_ROOT` / `TAVERN_PRESET_DIR`
  / `session-bindings.json`。

> 未改动任何许可证内容。

---

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