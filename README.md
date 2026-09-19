# 📊 dsh-muv-table

MUV 变量表格编辑器 —— 酒馆伴生插件。

> 🍺 本插件是 [dsh-tavern-v2](https://github.com/chen731215-dev/dsh-tavern-v2) 的扩展，需配合酒馆使用。

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