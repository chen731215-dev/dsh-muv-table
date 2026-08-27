# 📊 dsh-muv-table

MUV 变量表格编辑器 —— 酒馆伴生插件。

> 🍺 本插件是 [dsh-tavern-v2](https://github.com/chen731215-dev/dsh-tavern-v2) 的扩展，需配合酒馆使用。

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
| 无 `<initvar>`（如瑟瑟提瓦特） | 显示空表，LLM 输出 UpdateVariable 后自动填充 |

## 协议

PolyForm-Noncommercial-Copyleft-1.0.0 — 详见 [LICENSE](./LICENSE)