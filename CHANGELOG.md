# Changelog

## v0.2.10 (2026-09-20)
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
>
> **更新（下一节「变量块来源」）**：世界书/脚本里**带 `<initvar>` / `<VariableInsert>`
> 标签**的块现在能读了。但 `异世界农场` 那条世界书条目是**没有标签的裸 YAML**
> （content 里只有 `时间:`、`种族好感度:` 这样的裸文本），按标签扫描依然扫不到，
> 它的 `schemas` 仍是 0 —— 这一条需要一条**新规则**才能接住，见下一节末尾
> 「仍未修 / 待决定」。

---

### 🔴 修复：initvar 列表值被吞成空对象（内容静默丢失）

**现象**（`苍玄界` 实测，已复现）：卡里写的是

```
最近互动记录:
  - 因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。
```

解析结果却是 `最近互动记录 = {}` —— **内容消失，且不进 schema**。该卡 initvar 共 65 个
叶子行，`人际交往.结识道友录.沈慕微.最近互动记录` 与 `人际交往.结识道友录.江念.最近互动记录`
两条路径**都不在 schema 里**（含这两条路径的叶子 = 0）。

**根因**：`lib/initvar-parser.js` 两处配合出事——

- 空值建空对象：`键: ` 后面为空就被当成「嵌套对象的开始」；
- 无冒号的行直接丢弃：紧随其后的 `- item` 是列表项、没有冒号，被整行 `continue` 掉。

于是「空值 + 下一行 `- `」这种写法（`苍玄界`、以及 MUV 原生卡的常规形态）必然退化成空对象。

**修法**（`lib/initvar-parser.js` 为主）：

- 栈帧改为记录「开启它的键 + 持有它的父对象」。`- item` 行归属**最内层待定键**：
  该键若仍是空对象，就说明它其实是列表 → 原地替换成数组再追加。判定放在出栈**之前**
  （列表允许与它的键同缩进）。
- 列表项按标量解析（`- 3` → `3`）；列表下再出现的 `键: 值` 保留成条目文本，不静默丢行。
- `serializeInitvar()` 把数组写回 `键:` + `  - item`（空数组写 `[]`），`parseValue('[]')` → `[]`，
  列表**往返一致**。
- `inferSchemaFromData()` / `index.js: inferSchemas()` / `client.js: renderField`：
  列表行按换行拼接显示并带 `isList: true`；`applyEditsAndGenerate()` 把「编辑成多行文本」的列表行
  再切回数组，生成块仍是 `- ` 列表，不会被拍平成 `a,b`。

**实测数据**：

- `repro-initvar-list.mjs`：改前 **7 项不通过** → 改后全通过；叶子行 **65 → 67**。
- 真实卡往返一致性：`苍玄界`（16 个 initvar 块）+ 其 `.json` 共 **34 块**，
  解析 → 序列化 → 解析 **逐字节一致**（改前 34 块里 32 块不一致）。
- 引擎端到端（不改 `dsh-muv-engine`，只调用它）：`parseLatestInitvar → mergeState → generateBlock`
  用 `苍玄界` 真实问候语跑通，合并后列表仍在，生成行是
  `        - 因为想吃灵鹤被{{user}}抓包，目前心虚加不知所措。`，回读一致。

### 🔴 附带发现：`键: ""` 往返变成 `{}`（类型静默翻转）

**现象**：`苍玄界` 的 `世界系统.在场角色: ""`，生成块时被写成裸的 `在场角色: `，
下次解析回来变成 `{}`（空对象）—— 同一个字段的形状在往返中变了。
**根因**：`parseValue('""') → ''`，而 `formatValue('') → ''`；写出去的那一行看起来正是「空值 = 嵌套对象开始」。
**修法**：`formatValue('')` 输出 `""`（卡片自己就是这么写的，等于沿用卡的惯例）。
**实测**：上面那条 34 块往返一致性用例就是它的哨兵 —— 改前所有不一致都出自这一处，改后为 0。

### 🔴 修复：`presetId` 不存在时静默返回另一张卡

**现象**（已复现）：`GET /api/muv-table/tavern-card?presetId=does-not-exist`

```
HTTP 200 { ok:true, found:true, cardName:'川上富江', presetDir:'tavern-lite' }
```

用户以为在看自己的卡，其实拿到的是 tavern-lite 的卡。预设改名（历史上「深渊区」→「精简酒馆」）
或重名，一样中招。

**根因**：`lib/index.js` 里 `let presetDir = …; if (!fs.existsSync(presetDir)) presetDir = TAVERN_PRESET_DIR`
—— 任何一步定位失败都**无条件**换成硬编码的 tavern-lite，而且响应里没有任何字段说明「这不是你要的那张」。

**修法**：定位结果分来源，且**失败就明说**：

| 请求 | 行为 |
| --- | --- |
| `presetId` 存在 | 用它，`presetSource: 'explicit'` |
| `presetId` 不存在 | `found:false`，`error: preset not found: <id>`，附 `availablePresets` 清单 |
| `sessionId` 绑定到真实预设 | 用它，`presetSource: 'session'` |
| `sessionId` 绑定**已消失**（改名） | `found:false`，`error: preset bound to session … not found: <旧名>` |
| `sessionId` 绑定为 `default` / 无绑定 | 用酒馆自己的默认（tavern-lite），`presetSource: 'session-default'` |
| 两个定位参数都没给 | 按「最近写入的会话」猜，`presetSource: 'active'`；猜不到才用默认，`presetSource: 'default'` |

- `default` 这条**是照抄酒馆的规则**，不是猜：`dsh-tavern` 的
  `lib/index.js:2404` 就是 `if (currentPresetId === 'default') currentPresetId = 'tavern-lite'`，
  `GET /api/tavern/presets` 也返回 `defaultPresetId: 'tavern-lite'`。
  区别在于现在响应里**标明了**来源，而不是混在 `found:true` 里让人看不出来。
- `presetId` / `sessionId` 一律当**目录名**解析，带 `\` `/` 或 `..` 的直接判不存在（顺带收紧路径穿越）。
- 成功响应统一新增 `presetSource`；`/api/muv-table/active-preset` 不再返回
  `fallback: 'tavern-lite'`（那个字段暗示仍会回退到固定预设，已不成立）。

**实测数据**：`repro-preset-not-found.mjs` 改前 **4 项不通过**（复现「静默换卡」）→ 改后全通过；
新增 `test-preset-resolve.mjs` 用**临时 DSH_HOME** 造 6 个假预设/假卡，**30 项全通过**
（含 `?sessionId=` 的四种绑定形态，以及畸形卡不再 500）。

### 🟠 修复：变量块的来源只扫 4 个字段，世界书 / helper 脚本读不到

**现象**：`<initvar>` / `<VariableInsert>` 只可能在 `first_mes` / `description` / `scenario` /
`alternate_greetings` 里被找到。写在 `character_book.entries[].content` 或
`tavern_helper` 脚本里的变量块，整张卡的变量表就是空的。

**修法**（`lib/muv-parser.js`）：新增 `variableTextCandidates(data)`，把四个字段、世界书条目
（`character_book.entries[].content`，`where` 带上 `comment` 便于排查）、
`extensions.tavern_helper.scripts[].content` 一起纳入候选集，并给每个候选打**分组**，
让调用方能按「问候语级来源优先」取用。优先级（**先到先得**）：

1. `alternate_greetings` 里的 `<initvar>`（16 个都要，行为不变）
2. `first_mes` → `description` → `scenario` 里的 `<initvar>`（顺带把 `scenario` 补上 ——
   `<VariableInsert>` 一直认它，`<initvar>` 不认，两条路本来就不对称）
3. 任意来源（含世界书/脚本）里的 `<VariableInsert>`，第一个能 `JSON.parse` 成对象的块
4. **最后**才看世界书/脚本里的 `<initvar>`

第 4 步排在 `<VariableInsert>` 之后是刻意的：世界书和脚本里塞满了**引用标签的示例**
（`苍玄界` 的 `[mvu_update]变量输出格式`、`_足控天堂2` 的 `ERA 变量操作规则/意图说明`），
示例更可能是「能解析成垃圾、但不会抛异常」的裸 `<initvar>` 骨架，所以把它压到最后。
**非法 JSON 继续往后找、全程不抛异常**这条行为有专门的用例守着。

**实测数据**：`repro-parser-robustness.mjs` 改前 9 项不通过 → 改后全通过。
`_足控天堂2` 的 8 组 schema、`公司.总现金 = 40000` 与 `主播档案.$template` 剔除全部不变
（世界书里那两份文档块**没有**被误命中）。

### 🟠 修复：畸形卡让端点 500

**现象**：`alternate_greetings` 是**对象**（不是数组）时，`data.alternate_greetings || []`
之后的 `for...of` 抛 `TypeError: greetings is not iterable` →
`/api/muv-table/tavern-card` 直接 500。同理还有两处：`tavern_helper.scripts` 不是数组时
`scripts.find is not a function`；世界书 `entries` 不是数组时同样炸。

**修法**：`asArray()` 统一归一化 `alternate_greetings` / `character_book.entries` /
`tavern_helper.scripts`；条目为 `null` 也跳过。

**实测数据**：改前抛 3 个 TypeError（脚本里的 `scripts.find` 是复现时才发现的第三处），
改后 `parseMuvCard(null)`、对象版 `alternate_greetings`、`entries: [null, 7, …]` 全部不抛异常；
端点用例里那张畸形卡从 **500 → 200 + `schemas: []`**（同张卡别的内容照旧返回）。

### 🟠 修复：扁平 V1 JSON 卡读成 0 字段

**现象**：`findJsonMatch` 能按卡名找到**没有 `data` 包装**的扁平 V1 卡（`{name, description,
first_mes, …}`），但 `parseMuvCard` 只认 `cardJson.data` → 卡名对了、变量表 0 字段。
`regexScriptsOf()` 同样只认 `cardJson.data.extensions.regex_scripts`，扁平卡的正则脚本也一起丢。

**修法**：新增 `cardData(cardJson)`：有对象型 `data` 就用它，否则**把卡本身当 data**
（规格 v1 就是这样）。`regexScriptsOf()` 用同一套判定。

**实测数据**：扁平卡的 `<initvar>` / `<VariableInsert>` 从 0 → 正常建表；
有 `data` 包装的卡仍然以 `data` 为准（回归用例守住）。

### 🧪 本轮新增的哨兵 / 回归

| 文件 | 作用 |
| --- | --- |
| `repro-initvar-list.mjs` | ① 最小复现（`苍玄界` 真实卡）。改前 7 失败 → 改后 0 |
| `repro-preset-not-found.mjs` | ② 最小复现。改前 4 失败 → 改后 0 |
| `repro-parser-robustness.mjs` | ③④⑤ 最小复现。改前 9 失败 → 改后 0 |
| `test-muv-parser.mjs` | 解析器回归 **56 项**（含真实卡往返一致性、列表 schema 形状、编辑回写、畸形卡） |
| `test-preset-resolve.mjs` | 端点回归 **30 项**（临时 DSH_HOME，不碰真实环境） |
| `test-cards.mjs` | 测试用的真实卡定位辅助（找不到就 SKIP，不失败） |

原有基线不变：`node test-png-card.mjs` **28 通过**；
`node C:\dsh-muv-engine\test-status-cascade.mjs` **84 通过**。

### ⏭ 仍未修 / 待决定：世界书里**没有标签**的 `[initvar]` 条目

`异世界农场.png` 的初始值放在世界书条目 `[initvar]变量初始化勿开` 的 content 里，
但那份 content 是**裸 YAML、没有 `<initvar>` 标签**：

```
时间:
  日期: '05-20'
  …
种族好感度: …
个人好感度: {}
```

所以按标签扫描（本节这套）扫不到它，该卡 `schemas` 仍是 0（它的变量表实际由
`tavern_helper` 里的 Zod 结构定义，`zodSource` 953 字符，已能读到，但面板是用
`initvarData` 建行的）。要接住它需要一条**新**规则，例如：

> 彻底找不到变量块时，再找 `comment` 以 `[initvar]` 开头的世界书条目，把 `content`
> 当 initvar 块解析（预计 `异世界农场` 会从 0 变成 `时间` / `种族好感度` / `个人好感度` 三组）。

**本轮没做**：它超出「扫这两个来源里的标签」的范围，而且会引入「注释前缀」这一层新判定
（`苍玄界` 的对应条目叫 `[mvu_update]变量输出格式`，是文档不是数据 —— 两个前缀是有区别的，
但 `[initvar]` 万一也是文档就会解析出垃圾表）。留待决定。现状已用
`test-muv-parser.mjs` 的第 [10] 节**钉住**（含「没有标签」这条断言），改动必然是有意的。

## v0.2.9 (2026-09-20)
### 🐛 修复：面板「不管点哪个会话都显示同一张卡」

服务端无问题（按 `presetId` 请求时每个预设都返回各自的卡）。根因在客户端：它一直发同一个
预设——因为它依赖酒馆 DOM，而 `#tavern-session-preset-label` 的 `dataset.presetId`
在切换会话时不一定更新（酒馆自己 `bundle.js:1655` 用 `savedPid || 旧值`，`savedPid`
为空时**保留旧值**），`localStorage` 那份更是切换预设时才写。**切换会话根本不会更新它们。**

改为**优先用当前 DSH 会话 id 请求**：服务端按 `session-bindings.json` 查出该会话绑定的预设，
切换会话必然跟着变，不会粘。实测 4/5 会话正确解析（第 5 个 `minimal-gitbash` 本身无卡）。

注意只传一个定位参数且会话 id 优先——服务端判定顺序是 `if (presetId) … else if (sessionId) …`，
两个都传时**可能粘住的那个会盖掉可靠的**。
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