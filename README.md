# 📊 dsh-muv-table

MUV 变量表格编辑器 —— 酒馆伴生插件。

> 🍺 本插件是 [dsh-tavern-v2](https://github.com/chen731215-dev/dsh-tavern-v2) 的扩展，需配合酒馆使用。

## 🆕 v0.3.1 更新内容

> 注：当前包版本 **0.3.2 是纯文档修正版**——运行时代码与依赖声明均未改动，仅版本号抬到 0.3.2，
> 功能内容止于 v0.3.1，所以下面的要点仍以 v0.3.1 为准。

### 修复：世界书 `[initvar]` 装的是 JSON 时，整棵变量树读不出来

症状是**状态栏三项恒显示「未知」、角色网格一个角色都没有**。

- 现象离病因很远：卡自带的状态栏取值是 `_.get(sys, '日期', ['未知'])[0]`，「未知」是模板的兜底值
  ⇒ 说明脚本**跑到了**，只是喂给它的变量树是空的。
- 真因：这类卡把整棵树（`系统.日期/时间/地点` + 全体角色档案）按 MVU 的 `$meta` 约定写在一个
  `[InitVar]` 世界书条目里，**内容是从 `{` 开始的 JSON**。此前只认三种形态（`<initvar>` 标签 /
  `<VariableInsert>` / 裸 **YAML**），JSON 在最后那条兜底上被判「不像变量映射」否决
  （`{` / `},` / `}` 不匹配 `键: 值`），于是 `schemaSource = 'none'`、`initvarData = {}`。
- 修法：新增 `parseJsonInitvarMapping()`，在 YAML 闸门**之前**先试 JSON——顺序必须如此，
  反过来 JSON 永远进不来。认可是**结构性**的：`JSON.parse` 成功且结果是纯对象才采用，
  散文 / 半截 JSON / 顶层数组统统退回 `none`，所以「带大括号的说明文档」混不进来。
- **`$meta` 已剔除**：它是 MVU 对变量树的控制元数据、不是变量，留着会在面板多出两个假字段。
- 新来源标 `schemaSource: 'worldbook-initvar-json'`，面板徽标同步可见——它和 `worldbook-initvar`
  一样是**启发式**来源，必须可见，否则「猜错」和「这卡确实没变量」长得一样。
- 安全：JSON 里的 `__proto__` 会被当普通键解析出来，朴素赋值会真的改写对象原型，
  已用 `Object.defineProperty` 规避（有突变测试钉住）。

### v0.3.0：面板内「🧰 卡运维」区块

卡相关的运维入口只挂在**本插件自己的视图**里（侧边栏「MUV 表格」→ 面板顶部「🧰 卡运维」，默认收起）。

- **📌 开场白**：「➕ 把当前卡的开场白注入会话末尾」——请求体**只带 `sessionId`**，
  由服务端按会话权威解析预设，不把「会粘住的猜」发出去。
- **🧩 卡与脚本状态（只读）**：当前会话绑定的卡名 / 卡脚本 `enabled/total`。

## 🆕 v0.2.6 更新内容

### 新增：读取 SillyTavern 的 PNG 角色卡

这是本次最重要的能力。SillyTavern（及整个 TavernAI 系生态）的角色卡就是**一张 PNG**——
卡数据以 base64 存在图片的 `tEXt` 元数据里。一张 3.5 MB 的「卡」实际是封面图 +
约 1.5 MB 的卡数据。

**为什么必须读它**：DSH 自己的导入器只把 `{name, desc, first}` 写进 `characters.json`，
**正则脚本、世界书、tavern_helper 全部丢失**。于是一张拖进酒馆的卡，在 DSH 这边只剩
3 KB 文本残影，卡自带的插画、视频、状态栏渲染全都不工作。现在直接读原始 PNG 文件。

- 新增 `lib/png-card.js`：解析 PNG 的 `tEXt`/`iTXt` 元数据，取出 `chara` 块
- 卡库搜索路径自动接入 `<SillyTavern>/data/<user>/characters`
  （含 `~/SillyTavern`、`~/Documents/SillyTavern`、`C:/MySpecialFolder/SillyTavern`），
  可用环境变量 `DSH_SILLYTAVERN_DIR` 覆盖
- 预设目录里直接放 `.png` 也会被识别

实测：SillyTavern 卡库 5 张 PNG 卡全部读出，带回了完整的正则脚本与上百条世界书。

### 修复：变量面板显示错误的卡

两个独立原因都会让面板拿到**别的预设**的卡：

- 面板在首次加载时不知道自己在哪个预设（预设切换事件不会在页面加载时触发），
  请求不带参数，服务端回退到**硬编码的** `tavern-lite`，把那个预设的卡显示出来。
  现在新增 `/api/muv-table/active-preset`，面板主动询问当前预设。
- 面板会把首次解析出的预设**缓存住永不更新**，切换预设后卡死在旧卡上。现在每次
  轮询都重读。
- 预设里的 `muv-tables/card.json` 可能是过期残留（卡名与 `characters.json` 不符），
  现在会被识别并忽略。

### 新增：从 `characters.json` 提取变量表

酒馆把导入的卡存在 `<预设目录>/characters.json`。当原始卡文件不在本机时，
**这是变量数据唯一还存在的地方**。现在会从这里提取，支持
`<VariableInsert>{…JSON…}` 与 MUV 原生的 `<UpdateVariable><initvar>…</initvar>` 两种编码。

> 回归测试：`node test-png-card.mjs`（28 项，含真实卡库验证）


## 是什么

把酒馆角色卡的 MUV 变量渲染成结构化表格，Agent 直接编辑表格即可生成格式100%正确的 `<UpdateVariable>` 块，彻底避免 DeepSeek 漏变量、缩进错、标签不闭合的问题。

## 安装

```bash
# 前提：已安装 dsh-tavern-v2
dsh plugin --profile web add dsh-muv-table
```

或手动编辑 `~/.dsh/profiles/web/package.json`：

```json
{
  "dependencies": {
    "dsh-muv-table": "github:chen731215-dev/dsh-muv-table"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-muv-table"]
    }
  }
}
```

## 使用

### 1. 打开面板
左侧边栏点击「MUV 表格」，弹出变量编辑窗口。

### 2. 加载角色卡
- **自动同步**：面板打开时自动读取酒馆当前角色卡
- **手动加载**：点击「🍺 酒馆」按钮
- **拖放**：将角色卡 JSON 文件拖入面板

### 3. 编辑变量
- 点击容器行展开/折叠子变量
- 直接修改数值或文本
- 修改过的字段金色高亮

### 4. 生成 MUV 块
点击「⚡ 生成 MUV 块」→ 复制 → 粘贴到酒馆对话末尾。

## 支持的角色卡

| 类型 | 说明 |
|------|------|
| 有 `<initvar>` 默认数据 | 直接显示完整变量表 |
| 有 `<VariableInsert>{…JSON…}`（如足控天堂2） | 直接显示完整变量表（`主播档案.$template` 不算条目） |
| 两者都没有（如瑟瑟提瓦特） | 显示空表，LLM 输出 UpdateVariable 后自动填充 |

## 协议

PolyForm-Noncommercial-Copyleft-1.0.0 — 详见 [LICENSE](./LICENSE)