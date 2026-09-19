# Changelog

## v0.2.8 (2026-09-20)

### 🐛 修复：Zod「变量结构」整类读不到（覆盖面最大的一个）

parseMuvCard() 取 Zod schema 时用的是**精确等值** `s.name === 'zod'`，而真机上的卡
几乎不这么命名（「变量结构」「星辉zod」…）——**一个都对不上**，zodSource 恒为空。
Zod（`z.object({...})` / `registerMvuSchema`）是 MUV 最主流的 schema 载体，
读不到等于整张卡的变量表建不出来，而且是静默失败。

现在按两条线索找：**名字含 zod**，或**内容像 Zod schema**（`z.object(` /
`registerMvuSchema` / `prefault(` 等）。
实测：`_足控天堂2` 0 → **148106** 字符；`异世界农场` 0 → **953** 字符。

### 🐛 修复：面板把 `@deepseek-ai/dsh-persona` 当卡名显示

`extractMuvFromYml()` 的 `^\s*name:` 兜底会吃到 YAML 里的**服务声明**
（`name: '@deepseek-ai/dsh-persona'`）。隔壁 `extractCardNameFromYml()` 有
`@`/`/` 守卫，这里漏了。面板会把它显示成卡名并写进 localStorage 粘住。已补上同一守卫。

### 🐛 修复：`<VariableInsert>` 形态的卡建不出变量表

（由上一版引入的 `extractVariableInsert()` 修复，此处一并记录）
`_足控天堂2` 的变量树在 `first_mes` 的 `<VariableInsert>{JSON}</VariableInsert>` 里，
卡中**没有 `<initvar>`**，而 PNG 卡主路径走的 `parseMuvCard()` 只扫
`alternate_greetings` 的 `<initvar>` → `schemas: 0`。现在 `parseMuvCard()` 在
`initvarBlocks` 为空时回退到 `<VariableInsert>`，`<initvar>` 卡行为完全不变。
实测 `schemas` 0 → **8**（世界信息/主角信息/公司/道具系统/剧情事件/因特网/剧情选项/主播档案）。

> 回归：`node test-png-card.mjs` 12 → **28** 项；
> 复现脚本 `repro-variableinsert.mjs` 留在仓库里可直接跑（进程内挂真实路由，不需要重启 DSH）。

## Unreleased

### 🐛 修复：变量面板读不到「足控天堂2」这种卡的变量表

**现象**（已复现）：`GET /api/muv-table/tavern-card?presetId=…` 对这张卡返回

```
cardName    : _足控天堂2
cardSource  : library
fileName    : _足控天堂2.png
schemas     : 0        ← 面板靠 schemas 建表，为 0 就什么都显示不出来
initvarData : {}
initvarBlocks: 0
```

`lib/client.js` 里 `schemas.length === 0` 直接渲染空态，所以整张变量表是空的。

**根因**：这张卡把变量定义写在一句话的
`<VariableInsert>{ …JSON… }</VariableInsert>` 里（在 `first_mes` = 【主页】），
**卡里根本没有 `<initvar>`**。而 PNG 卡主路径调用的 `parseMuvCard()`
只扫 `alternate_greetings` 里的 `<initvar>`，扫不到就返回 0 个 schema。

仓库里本来就有能处理 `<VariableInsert>` 的 `extractMuvFromCharactersJson()`，
但它只在退路分支（`loadRawCardForPreset` 返回 null、退回 `characters.json`）里被调用。
主路径从卡库匹配到 PNG 后直接 `return`，把它整个跳过了 —— 数据就在卡里，没人读。

**修法**：把 `<VariableInsert>` 支持下沉到 `lib/muv-parser.js` 的 `parseMuvCard()`，
让主路径和退路共用同一份解析（`dsh-muv-engine` 也从这里 import `parseMuvCard`，一并受益）：

- 新增导出 `extractVariableInsert(data)`：按 `first_mes` → `description` →
  `scenario` → `alternate_greetings` 顺序找 `<VariableInsert>`，取第一个能
  `JSON.parse` 成对象的块；这一块不是 JSON 就继续往后找，全程不抛异常。
- **只有一个 `<initvar>` 都没找到时才走这条兜底**，所以原先正常的 `<initvar>` 卡
  行为完全不变（回归用例 [6] 守住这一点）。
- 顺带补上：`<initvar>` 也可能写在 `first_mes` / `description` 里，原先只看
  `alternate_greetings` 同样会漏。该分支也只在 `alternate_greetings` 没找到时才生效。
- 新增导出 `stripPlaceholderEntries(data)`：去掉 `主播档案.$template`。它是卡自己
  留下的「一个主播长什么样」的占位模板，不是真实主播，当角色渲染会在表里多出一行
  假主播。（这条规则原先只写在 `extractMuvFromCharactersJson()` 里，现在两处共用。）

**测试**：`test-png-card.mjs` 12 项 → **28 项**，新增 [5][6][7] 三节：

- **[5]** 合成一张 `<VariableInsert>` PNG 卡（不依赖本机卡库）验证：能建表、顶层键
  齐全、`$template` 不成行、数值仍是 `number` 不是 `string`。
- **[6]** 反向保护：`<initvar>` 卡不会被 `<VariableInsert>` 抢走、`first_mes` 里的
  `<initvar>` 也认、坏 JSON 不抛异常、没有变量块的卡照样返回有效结构。
- **[7]** 真实卡 `_足控天堂2.png`：`schemas` 非空、顶层键含
  `世界信息/主角信息/公司/道具系统/剧情事件/因特网/剧情选项/主播档案`、
  `主播档案` 下是 `超天酱`（不是 `$template`）、`数值.压力值` 可编辑。

新增 `repro-variableinsert.mjs`：用 `apply()` 挂载真实路由、在进程内请求
`/api/muv-table/tavern-card`（等价于浏览器那条路，但不需要重启 DSH）。
改前 5 项不通过（复现 `schemas: 0`），改后全通过。这个脚本留在仓库里，
以后再有人动 `parseMuvCard` 可以拿它当哨兵。

> 已知相邻问题（本次**未**修）：`异世界农场.png` 的初始变量不是放在卡文本里，
> 而是放在世界书条目 `[initvar]变量初始化勿开` 的 `content` 里，因此它的
> `schemas` 依然是 0。那是另一套投递方式（世界书），不是本次的
> `<VariableInsert>` 问题，需要单独决定是否要让面板读世界书。

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