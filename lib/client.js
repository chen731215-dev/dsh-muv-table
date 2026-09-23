// dsh-muv-table client v2: card-based tree view with modern DSH design
window.__ModuleLoader__.load({
  id: 'dsh-muv-table',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react'), jsx = require('react/jsx-runtime'), ReactDOM = require('react-dom/client')

    const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M1.5 6.5h13M6 6.5v6.5M11 6.5v6.5"/></svg>`

    // ============ persistence ============
    const SK = 'dsh-muv-table-state'
    const loadSS = () => { try { const s=localStorage.getItem(SK); return s?JSON.parse(s):null } catch(_){return null} }
    const saveSS = (s) => { try { localStorage.setItem(SK,JSON.stringify({...s,savedAt:Date.now()})) } catch(_){} }
    let savedState = loadSS()
// ============ debounce utility ============
      function debounce(fn, delay) {
        let timer = null
        return function (...args) {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => { timer = null; fn.apply(this, args) }, delay)
        }
      }

    // ============ color tokens ============
    const C = {
      bg: 'var(--dsw-alias-bg-base)', bg1: 'var(--dsw-alias-bg-layer-1)', bg2: 'var(--dsw-alias-bg-layer-2)', bg3: 'var(--dsw-alias-bg-layer-3)',
      border: 'var(--dsw-alias-border-l2)', borderL: 'var(--dsw-alias-border-l1)',
      text: 'var(--dsw-alias-label-primary)', sub: 'var(--dsw-alias-label-secondary)', dim: 'var(--dsw-alias-label-tertiary)',
      accent: 'var(--dsw-alias-label-accent)', gold: 'var(--dsw-alias-label-accent,#c5a065)', danger: 'var(--dsw-alias-label-danger)',
      hover: 'var(--dsw-specific-sidebar-nav-item-hover)',
      font: 'var(--dsw-font-family)'
    }

    // ============ 卡运维（卡相关的运维入口，全部挂在 muv-table 自己的面板里）============
    //
    // 用户口径（2026-09-23）：「我有 muv-table 面板，不需要做到酒馆面板里面，**集成到
    // muv-table 面板里面就行了**」⇒ 这一块的入口只出现在侧边栏「MUV 表格」打开的这个
    // 视图里（面板内「🧰 卡运维」），不在酒馆的管理面板里再放一份。
    //
    // 数据源全是 DSH 同源 HTTP，**本仓库不改服务端**：
    //   POST /api/tavern/greeting/insert { sessionId? }        （dsh-tavern-v2）
    //        → 把当前卡的开场白注入**当前会话末尾**（旧会话也能用）。
    //        · 已注入过 ⇒ 200 { ok:false, error:'greeting-already-present' } —— 不是错误；
    //        · 路由不存在 / 酒馆没启动 ⇒ 降级提示，**不许抛错崩面板**。
    //   GET  /api/muv-engine/card-scripts?cardName=&presetDir= （dsh-muv-engine）
    //        → { ok, scripts:[…], total, enabled, source, fileName, reason }
    //   GET  /api/muv-engine/state?sessionId=…
    //        → { ok, state:{ data, updatedAt } }（无状态时 state 为 null）
    const CARD_OPS_BUILD = 'dsh-muv-table 0.2.12 (card-ops)'

    // ★ 下面这段被 test-card-ops.mjs **逐字提取执行**（验"手势 → 请求体"）。
    //   因此这段里禁止引用 React / DOM / 外层闭包变量，只许用入参 + 全局 fetch；
    //   两端标记行也要保持原样。
    // [[card-ops-greeting-start]]
    async function cardOpsInsertGreeting(input) {
      const inp = input || {}
      const callFetch = inp.fetch || (typeof fetch === 'function' ? fetch : null)
      const sessionId = String(inp.sessionId || '')
      if (!callFetch) return { kind: 'degrade', message: '⚠ 当前环境不支持 fetch，无法注入开场白' }
      let res = null
      try {
        res = await callFetch('/api/tavern/greeting/insert', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // 只带会话 id：服务端按会话**权威**解析 preset。presetId（酒馆 DOM / localStorage
          // 那份）会「粘住」上一个会话的值，本仓库已整条删除该读取路径（见文件上方注释与
          // docs/04 排错手册的串台条目）——不把猜出来的预设发出去。
          body: JSON.stringify({ sessionId: sessionId || undefined })
        })
      } catch (e) {
        return { kind: 'degrade', message: '⚠ 开场白接口不可达（酒馆插件未启动？）—— ' + ((e && e.message) || String(e)) }
      }
      let d = null
      try { d = await res.json() } catch (_) { d = null }
      if (!d || typeof d !== 'object') {
        // 路由没实现时拿到的是 404/405 的**非 JSON** 响应 ⇒ 降级（面板不许崩）。
        // 注意：真正的「会话不活跃」是 404 + JSON { ok:false, error:'session-not-live…' }，
        // 走下面的 error 分支照原样显示服务端原因，不会被误判成"接口不存在"。
        if (res && (res.status === 404 || res.status === 405)) {
          return { kind: 'degrade', message: '⚠ 酒馆未提供开场白注入接口（需更新/重启 dsh-tavern-v2）' }
        }
        return { kind: 'error', message: '❌ 注入失败（HTTP ' + ((res && res.status) || '?') + '）' }
      }
      if (d.ok) {
        return { kind: 'ok', message: '✅ 已注入「' + String(d.cardName || '') + '」的开场白（' +
          String(d.greetingLen || 0) + ' 字，第 ' + String(d.turn == null ? '?' : d.turn) + ' 回合）——回到会话刷新可见' }
      }
      // 防重复：会话里已有 source.model==='character-card' 的开场白楼 ⇒ 无事可做，非报错。
      if (d.error === 'greeting-already-present') {
        return { kind: 'present', message: '本会话已有开场白，无需重复注入' }
      }
      return { kind: 'error', message: '❌ ' + String(d.error || '注入失败') }
    }
    // [[card-ops-greeting-end]]

    /**
     * 只读诊断取值：每条都走同源 HTTP，**单项失败只影响它自己那一行**。
     * 卡脚本接口不可用（引擎没这路由）⇒ 直接不产出该行（不显示假的 0/0）。
     */
    async function cardOpsLoadStatus(input) {
      const inp = input || {}
      const callFetch = inp.fetch || (typeof fetch === 'function' ? fetch : null)
      const sessionId = String(inp.sessionId || '')
      const cardName = String(inp.cardName || '')
      const presetDir = String(inp.presetDir || '')
      const rows = []
      rows.push({ key: 'card', label: '当前会话绑定的卡', value: cardName || '（未识别，本会话可能未绑卡）' })
      if (callFetch && cardName) {
        try {
          const qs = '?cardName=' + encodeURIComponent(cardName) +
            (presetDir ? '&presetDir=' + encodeURIComponent(presetDir) : '')
          const r = await callFetch('/api/muv-engine/card-scripts' + qs)
          const d = await r.json()
          if (d && d.ok) {
            rows.push({
              key: 'scripts', label: '卡脚本',
              value: Number(d.enabled || 0) + '/' + Number(d.total || 0) + ' 条启用',
              hint: '来源 ' + String(d.source || '?') + (d.fileName ? ' · ' + String(d.fileName) : '') +
                (d.reason ? '\n' + String(d.reason) : '')
            })
          }
          // !ok ⇒ 引擎没有这个接口：隐藏该行（如实"不显示"好过显示一个假的数字）
        } catch (_) { /* 同上：接口不可用 ⇒ 隐藏该行 */ }
      } else if (callFetch) {
        rows.push({ key: 'scripts', label: '卡脚本', value: '（先识别到卡名才能查）' })
      }
      if (callFetch) {
        try {
          const r = await callFetch('/api/muv-engine/state?sessionId=' + encodeURIComponent(sessionId || 'default'))
          const d = await r.json()
          const tree = d && d.ok && d.state ? d.state.data : null
          if (d && d.ok) {
            rows.push({
              key: 'vars', label: '运行时变量树顶层键',
              value: (tree && typeof tree === 'object') ? Object.keys(tree).length + ' 个' : '0 个（本会话还没有运行时变量）'
            })
          } else {
            rows.push({ key: 'vars', label: '运行时变量树顶层键', value: '不可用（muv-engine 未响应）' })
          }
        } catch (_) {
          rows.push({ key: 'vars', label: '运行时变量树顶层键', value: '不可用（muv-engine 未响应）' })
        }
      }
      rows.push({ key: 'build', label: '客户端构建', value: CARD_OPS_BUILD })
      return rows
    }

    // ── 🧰 卡运维（React 只是壳，逻辑在上面两个纯函数里）──────────────────
    // 交互风格沿用本视图既有写法：内联 style + C 里的 token，不引入任何新框架。
    function CardOpsPanel({ sessionId, cardName, presetDir }) {
      const [open, setOpen] = React.useState(false)
      const [rows, setRows] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [greet, setGreet] = React.useState(null)   // { kind, message }
      const [statusBusy, setStatusBusy] = React.useState(false)

      const boundFetch = () => (typeof fetch === 'function' ? fetch.bind(window) : null)

      const refresh = async () => {
        setStatusBusy(true)
        try {
          setRows(await cardOpsLoadStatus({ sessionId, cardName, presetDir, fetch: boundFetch() }))
        } finally { setStatusBusy(false) }
      }
      // 展开即刷新一次（收起时不打扰）
      React.useEffect(() => { if (open) refresh() }, [open, sessionId, cardName, presetDir])

      const doInsertGreeting = async () => {
        setBusy(true)
        setGreet({ kind: 'busy', message: '⏳ 注入中…' })
        try {
          setGreet(await cardOpsInsertGreeting({ sessionId, fetch: boundFetch() }))
        } catch (e) {
          // 兜底：纯函数自身吞异常，这里只是"再保险"，绝不让异常冒到 React 渲染里
          setGreet({ kind: 'error', message: '❌ ' + ((e && e.message) || String(e)) })
        } finally { setBusy(false) }
      }

      // ★ 第 40 轮：这四个状态色原来是写死的（#27ae60 / #3498db / #e67e22 / #e74c3c）。
      //   深色模式下红/绿压在深底上偏暗；改成 DSH 的主题状态色（回退值 = 原值），
      //   两个主题都跟宿主，浅色下观感不变。
      const GC = { ok: 'var(--dsw-alias-state-success-primary,#27ae60)', present: 'var(--dsw-alias-state-business-primary,#3498db)', degrade: 'var(--dsw-alias-state-warn-primary,#e67e22)', error: 'var(--dsw-alias-state-error-primary,#e74c3c)', busy: C.dim }
      const GBG = { ok: 'rgba(39,174,96,0.10)', present: 'rgba(52,152,219,0.12)', degrade: 'rgba(230,126,34,0.10)', error: 'rgba(231,76,60,0.10)', busy: 'transparent' }
      const btn = { padding: '5px 12px', borderRadius: 6, border: '1px solid ' + C.border, background: C.bg3, color: C.text, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }

      return jsx.jsxs('div', {
        'data-dsh-muv-card-ops': '',
        style: { flexShrink: 0, borderBottom: '1px solid ' + C.border, background: C.bg2 },
        children: [
          // 标题行（点击展开/收起）
          jsx.jsxs('div', {
            'data-dsh-card-ops-toggle': '',
            onClick: () => setOpen(o => !o),
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer', userSelect: 'none' },
            onMouseEnter: e => { e.currentTarget.style.background = C.hover },
            onMouseLeave: e => { e.currentTarget.style.background = 'transparent' },
            children: [
              jsx.jsx('span', { style: { fontSize: 10, color: C.dim, width: 12 }, children: open ? '▾' : '▸' }),
              jsx.jsx('span', { style: { fontWeight: 600, fontSize: 12, flex: 1 }, children: '🧰 卡运维' }),
              jsx.jsx('span', { style: { fontSize: 10, color: C.dim }, children: '开场白 · 卡与脚本状态' })
            ]
          }),
          open && jsx.jsxs('div', { style: { padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }, children: [
            // ── 📌 开场白 ──
            jsx.jsxs('div', { children: [
              jsx.jsx('div', { style: { fontSize: 11, color: C.dim, marginBottom: 6 }, children: '📌 开场白' }),
              jsx.jsx('button', {
                'data-dsh-card-ops-greeting-insert': '',
                type: 'button', disabled: busy, onClick: doInsertGreeting,
                title: '把当前卡的开场白注入当前会话末尾（旧会话也能用）\n请求只带 sessionId，预设由服务端按会话权威解析',
                style: { ...btn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' },
                children: '➕ 把当前卡的开场白注入会话末尾'
              }),
              jsx.jsx('div', {
                'data-dsh-card-ops-greeting-status': '',
                style: {
                  marginTop: 6, padding: '5px 10px', borderRadius: 6, fontSize: 11, lineHeight: 1.6,
                  color: GC[greet ? greet.kind : 'busy'] || C.dim,
                  background: greet ? (GBG[greet.kind] || 'transparent') : 'transparent'
                },
                children: greet ? greet.message : '未注入（本会话需要开场白时点上面的按钮）'
              })
            ] }),
            // ── 🧩 卡与脚本状态（只读诊断）──
            jsx.jsxs('div', { children: [
              jsx.jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }, children: [
                jsx.jsx('div', { style: { fontSize: 11, color: C.dim, flex: 1 }, children: '🧩 卡与脚本状态（只读）' }),
                jsx.jsx('button', {
                  'data-dsh-card-ops-refresh': '', type: 'button', disabled: statusBusy, onClick: refresh,
                  style: { ...btn, fontSize: 10, padding: '2px 8px', opacity: statusBusy ? 0.6 : 1 },
                  children: statusBusy ? '⏳ 刷新中' : '🔄 刷新'
                })
              ] }),
              jsx.jsx('div', {
                'data-dsh-card-ops-rows': '',
                style: { border: '1px solid ' + C.border, borderRadius: 8, background: C.bg1, overflow: 'hidden' },
                children: rows.length === 0
                  ? jsx.jsx('div', { style: { padding: '6px 10px', fontSize: 11, color: C.dim }, children: '（点「🔄 刷新」读取）' })
                  : rows.map(r => jsx.jsxs('div', {
                      key: r.key,
                      style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 10px', borderBottom: '1px solid ' + C.borderL },
                      children: [
                        jsx.jsx('span', { style: { fontSize: 11, color: C.sub, flexShrink: 0, width: 150 }, children: r.label }),
                        jsx.jsx('span', {
                          title: r.hint || undefined,
                          style: { fontSize: 11, color: C.text, wordBreak: 'break-all', cursor: r.hint ? 'help' : 'default' },
                          children: r.value
                        })
                      ]
                    }, r.key))
              })
            ] })
          ] })
        ]
      })
    }

    // ============ MacroPanel ============
    function MacroPanel({ onClose }) {
      const [input, setInput] = React.useState('')
      const [result, setResult] = React.useState('')
      const [picks, setPicks] = React.useState([])
      const [diceResult, setDiceResult] = React.useState('')

      const refreshPicks = () => {
        if (typeof window._tavernListPicks === 'function') {
          setPicks(window._tavernListPicks())
        }
      }
      React.useEffect(() => { refreshPicks() }, [])

      const handleExpand = () => {
        if (typeof window._tavernExpandMacros === 'function') {
          setResult(window._tavernExpandMacros(input))
        } else {
          setResult('⚠ muv-engine 插件未加载')
        }
        refreshPicks()
      }
      const handleReroll = (key) => {
        if (typeof window._tavernRerollPick === 'function') {
          window._tavernRerollPick(key)
          refreshPicks()
        }
      }
      const handleClearAll = () => {
        picks.forEach(p => { if (typeof window._tavernRerollPick === 'function') window._tavernRerollPick(p.key) })
        refreshPicks()
      }
      const quickDice = (expr) => {
        if (typeof window._tavernExpandMacros === 'function') {
          setDiceResult(window._tavernExpandMacros('{[roll::'+expr+']}'))
        }
      }

      const DICE = ['d4','d6','d8','d10','d12','d20','2d6','3d6','1d100']

      return jsx.jsxs('div', { style:{position:'fixed',inset:0,zIndex:70,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}, onClick:onClose, children: [
        jsx.jsxs('div', { onClick:e=>e.stopPropagation(), style:{width:'min(90vw,520px)',background:C.bg,display:'flex',flexDirection:'column',color:C.text,fontFamily:C.font,fontSize:13,borderRadius:12,border:'1px solid '+C.border,boxShadow:'0 20px 60px rgba(0,0,0,0.5)',overflow:'hidden'}, children: [
          // Header
          jsx.jsxs('div', { style:{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg1}, children: [
            jsx.jsx('span', { style:{fontWeight:700,fontSize:15,flex:1}, children: '📐 宏测试' }),
            jsx.jsx('button', { onClick:onClose, style:{padding:'5px 12px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:12,fontFamily:'inherit'}, children: '✕' })
          ] }),
          // Body
          jsx.jsxs('div', { style:{padding:16,display:'flex',flexDirection:'column',gap:14,overflow:'auto'}, children: [
            // Input
            jsx.jsxs('div', { children: [
              jsx.jsx('div', { style:{fontSize:11,color:C.dim,marginBottom:6}, children: '输入宏语法（支持 random / pick / roll）' }),
              jsx.jsx('textarea', { value:input, onChange:e=>setInput(e.target.value), placeholder:'{[random::选项A::选项B::选项C]}\n{[pick::宝箱::灵石x50::破旧剑谱::神秘丹药]}\n{[roll::2d6+3]}', rows:4, style:{width:'100%',padding:10,borderRadius:8,border:'1px solid '+C.border,background:C.bg3,color:C.text,fontSize:13,fontFamily:'monospace',resize:'vertical',outline:'none',boxSizing:'border-box'} }),
              jsx.jsx('button', { onClick:handleExpand, style:{marginTop:8,padding:'8px 20px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#c5a065,#d4a76a)',color:'#1a1a1a',cursor:'pointer',fontSize:13,fontWeight:700,fontFamily:'inherit',width:'100%'}, children: '⚡ 展开测试' })
            ] }),
            // Result
            result && jsx.jsxs('div', { children: [
              jsx.jsxs('div', { style:{display:'flex',alignItems:'center',gap:8,marginBottom:4}, children: [
                jsx.jsx('div', { style:{fontSize:11,color:C.dim,flex:1}, children: '展开结果' }),
                jsx.jsx('button', { onClick:()=>navigator.clipboard.writeText(result), style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.border,background:C.bg3,color:C.sub,cursor:'pointer',fontSize:10,fontFamily:'inherit'}, children: '📋 复制' }),
                jsx.jsx('button', { onClick:()=>setInput(result), style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.border,background:C.bg3,color:C.sub,cursor:'pointer',fontSize:10,fontFamily:'inherit'}, children: '⬆ 填入' })
              ] }),
              jsx.jsx('div', { style:{padding:10,borderRadius:8,border:'1px solid '+C.accent,background:'rgba(74,191,171,0.06)',color:C.text,fontSize:13,fontFamily:'monospace',whiteSpace:'pre-wrap',wordBreak:'break-all',minHeight:20}, children: result })
            ] }),
            // Dice quick
            jsx.jsxs('div', { children: [
              jsx.jsx('div', { style:{fontSize:11,color:C.dim,marginBottom:6}, children: '🎲 快捷骰子' }),
              jsx.jsx('div', { style:{display:'flex',flexWrap:'wrap',gap:6}, children: DICE.map(d =>
                jsx.jsx('button', { onClick:()=>quickDice(d), style:{padding:'4px 10px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:12,fontFamily:'monospace'}, children: d }, d)
              ) }),
              diceResult && jsx.jsx('div', { style:{marginTop:8,padding:'6px 12px',borderRadius:6,background:'rgba(197,160,101,0.1)',color:C.gold,fontSize:13,fontWeight:600}, children: '结果: '+diceResult })
            ] }),
            // Pick cache
            jsx.jsxs('div', { children: [
              jsx.jsxs('div', { style:{display:'flex',alignItems:'center',gap:8,marginBottom:6}, children: [
                jsx.jsx('div', { style:{fontSize:11,color:C.dim,flex:1}, children: '📌 Pick 缓存 ('+picks.length+')' }),
                picks.length>0 && jsx.jsx('button', { onClick:handleClearAll, style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.danger,background:'transparent',color:C.danger,cursor:'pointer',fontSize:10,fontFamily:'inherit'}, children: '清除全部' })
              ] }),
              picks.length===0 && jsx.jsx('div', { style:{fontSize:11,color:C.dim,fontStyle:'italic'}, children: '暂无缓存（使用 {[pick::key::...]} 后自动出现）' }),
              picks.map(p => jsx.jsxs('div', { key:p.key, style:{display:'flex',alignItems:'center',gap:8,padding:'4px 8px',borderRadius:6,background:C.bg3,marginBottom:4}, children: [
                jsx.jsx('span', { style:{fontSize:11,color:C.gold,fontWeight:600,fontFamily:'monospace',flex:1}, children: p.key }),
                jsx.jsx('span', { style:{fontSize:12,color:C.text}, children: '→ '+p.value }),
                jsx.jsx('button', { onClick:()=>handleReroll(p.key), style:{padding:'2px 8px',borderRadius:4,border:'1px solid '+C.border,background:C.bg1,color:C.sub,cursor:'pointer',fontSize:10,fontFamily:'inherit'}, children: '重抽' })
              ] }))
            ] }),
            // Syntax help
            jsx.jsxs('details', { style:{fontSize:11}, children: [
              jsx.jsx('summary', { style:{color:C.dim,cursor:'pointer',marginBottom:4}, children: '📖 语法帮助' }),
              jsx.jsx('div', { style:{color:C.sub,lineHeight:1.8,padding:'4px 0'}, children: [
                jsx.jsx('div', { children: '{[random::A::B::C]} → 每次随机选一个' }),
                jsx.jsx('div', { children: '{[pick::key::A::B::C]} → 固定结果，缓存为 key' }),
                jsx.jsx('div', { children: '{[roll::2d6]} → 掷 2 个 6 面骰' }),
                jsx.jsx('div', { children: '{[roll::1d20+3]} → d20 + 3 调整值' }),
                jsx.jsx('div', { style:{marginTop:4,color:C.dim}, children: '在聊天输入框里直接写宏，按 Enter 自动展开后发送给 AI。' })
              ] })
            ] })
          ] })
        ] })
      ] })
    }

    let macroVc = null, macroVr = null
    function showMacroPanel() {
      if (macroVc) { macroVc.style.display = ''; return }
      macroVc = document.createElement('div')
      macroVc.setAttribute('data-dsh-macro-panel', '')
      document.body.appendChild(macroVc)
      macroVr = ReactDOM.createRoot(macroVc)
      macroVr.render(jsx.jsx(MacroPanel, { onClose: () => { if (macroVc) macroVc.style.display = 'none' } }))
    }

    // ============ MuvTableView ============
    function MuvTableView({ onClose }) {
      const initial = savedState && savedState.cardName
        ? { status:'loaded', cardName:savedState.cardName, schemas:savedState.schemas, initvarData:savedState.initvarData, edits:savedState.edits||{}, generatedBlock:'', error:'', search:'' }
        : { status:'idle', cardName:'', schemas:[], initvarData:{}, edits:{}, generatedBlock:'', error:'', search:'' }
      const [state, setState] = React.useState(initial)
      const [collapsed, setCollapsed] = React.useState(new Set())
      const fileRef = React.useRef(null)
      const hasAutoLoaded = React.useRef(false)

      // 「我在哪个会话 / 该显示哪张卡」的权威依据 = **当前 DSH 会话 id**。
      //
      // 起因：用户报告「不管点哪个会话，面板永远显示同一张卡」。查下来服务端没问题
      // （按 presetId 请求，每个预设都返回各自的卡），是客户端一直在发同一个预设。
      // 根因是过度依赖酒馆的 DOM：`#tavern-session-preset-label` 的 dataset.presetId
      // 在切换会话时不一定跟着更新（酒馆自己在 bundle.js:1655 就是
      // `savedPid || lbl.dataset.presetId` —— savedPid 为空时会**保留旧值**），
      // 而 localStorage 那份更是切换预设时才写。
      // 会话 id 则不会撒谎：服务端按它查出该会话绑的预设。
      //
      // ★ 注意（2026-09 修）：这里原先把「酒馆 DOM / localStorage 上的当前预设」当成
      //   "唯一真实来源"，并在认不出会话时拿它当 `presetId` 发给服务端。那是个陷阱：
      //   ① 它本身会「粘住」（切会话后仍是上一个会话的值）；
      //   ② 服务端会对 presetId 调 `fromExplicit()`，于是这个"猜"被标成
      //      `presetSource='explicit'` —— 听起来像"用户明确指定"，其实是猜，
      //      串台向量只是从服务端搬到了客户端，标签还更自信了。
      //   现在：DOM/localStorage 这条读取路径**已整条删除**（`readActivePresetFromDom`
      //   一并移除），认不出会话就什么都不带，由服务端落到稳定默认并如实上报来源。
      const currentSessionId = () => {
        try {
          const svc = window.__DSH_TAVERN_SESSIONS__
          if (svc && svc.list && typeof svc.list.getSnapshot === 'function') {
            const snap = svc.list.getSnapshot()
            const cur = snap && snap.current
            if (cur && /^(session-)?[a-f0-9-]{20,}$/i.test(String(cur))) {
              return 'session-' + String(cur).replace(/^session-/, '')
            }
          }
        } catch (_) {}
        try {
          const m = location.href.match(/session[/=:-]([a-f0-9-]{20,})/i)
          if (m && m[1]) return 'session-' + m[1].replace(/^session-/, '')
        } catch (_) {}
        try {
          const cached = document.documentElement.getAttribute('data-dsh-current-session')
          if (cached) return cached
        } catch (_) {}
        return ''
      }

      // ★ 已删除 `readActivePresetFromDom()`（原来读 `#tavern-session-preset-label`
      //   / `#tavern-session-preset-btn` 的 dataset.presetId，再退到
      //   localStorage 的 `dsh-tavern-active-preset`）。
      //   删除原因见上：它提供的是**会粘住的猜**，而它唯一的消费者（把猜出来的值当
      //   `presetId` 发给服务端）已经移除，留着就是一段"看起来还在生效"的死代码。
      //   如果将来真的需要「用户此刻在酒馆面板里选了哪个预设」（例如给 UI 显示用），
      //   请从**服务端权威解析**取值（酒馆的 `GET /api/tavern/current-session`），
      //   不要再回到 DOM/localStorage。

      // 本次请求要带的定位参数。**会话 id 是唯一可用的依据** —— 它随会话切换而变，
      // 是唯一不会「粘住」的东西。
      //
      // ★ 这里原来有三级兜底（localStorage → 酒馆 DOM → 服务端 `/api/muv-table/active-preset`
      //   按「最近写入的会话」猜），并把猜出来的值当 `presetId` 发出去。**这条路已整条删除**：
      //   服务端在 `!preferPreset` 分支里会对 presetId 调 `fromExplicit()`，于是同一个"猜"
      //   只是从服务端的 `presetSource='active'` 换成客户端的 `'explicit'` —— 标签更自信、
      //   串台向量却分毫未减（`activePresetId()` 按会话文件 mtime 取"最近写入的会话"，
      //   开发/被测会话在不停写文件时这个值会漂移：实测它当时返回的是「安装 dsh-tavern-v2
      //   及其附属插件」那个**开发会话**的绑定）。**猜的链条不能只堵一半。**
      //
      //   现在的语义（与酒馆侧 `client.manager.bundle.js` 的状态栏取卡对齐）：
      //   认不出会话 ⇒ **什么都不带** ⇒ 服务端落到稳定默认（tavern-lite），
      //   并在 `presetSource` 里如实标 `default`。
      //   确实想看某个预设的卡（卡库检查、诊断脚本）请显式加 `preferPreset=1`，语义不混。
      let lastSessionId = ''
      const resolveActivePreset = async () => {
        lastSessionId = currentSessionId()
      }

      const fetchTavernCard = async () => {
        await resolveActivePreset()
        let url = '/api/muv-table/tavern-card'
        // 只带会话 id：两个参数都传时服务端 presetId 会盖掉会话，而 presetId 恰恰是
        // 可能「粘住」的那个 —— 会话 id 随会话切换必然变，这正是「不管点哪个会话都显示
        // 同一张卡」的解药。
        if (lastSessionId) url += '?sessionId=' + encodeURIComponent(lastSessionId)
        const r = await fetch(url)
        return r.json()
      }

      // Auto-load from tavern on first open
      React.useEffect(() => {
        if (!hasAutoLoaded.current && state.status === 'idle') {
          hasAutoLoaded.current = true
          loadFromTavern()
        }
      }, [state.status])

      // Poll tavern card changes every 2s (debounced 500ms) → auto-resync when session or card changes
      const lastSyncKey = React.useRef('')
        const checkingRef = React.useRef(false)
      React.useEffect(() => {
        if (state.status !== 'loaded' && state.status !== 'idle') return
        const check = async () => {
          if (checkingRef.current) return
          checkingRef.current = true
          try {
            const d = await fetchTavernCard()
            if (d.ok && d.name) {
              const syncKey = d.name + '|' + (d.presetDir || '')
              if (syncKey !== lastSyncKey.current || forceReload) {
                forceReload = false
                lastSyncKey.current = syncKey
                savedState = { cardName:d.name, schemas:d.schemas, initvarData:d.initvarData, edits:{} }; saveSS(savedState)
                setCollapsed(new Set())
                setState({status:'loaded',cardName:d.name,schemas:d.schemas,initvarData:d.initvarData,edits:{},generatedBlock:'',error:'',search:'',presetSource:d.presetSource||'',presetDir:d.presetDir||''})
              }
            }
          } catch (_) {}
          finally { checkingRef.current = false }
        }
        const debouncedCheck = debounce(check, 500)
        check()
        const timer = setInterval(debouncedCheck, 2000)
        return () => clearInterval(timer)
      }, [state.status])

      const parseCard = async (json) => {
        setState(s=>({...s,status:'loading',error:''}))
        try {
          const r = await fetch('/api/muv-table/parse-card',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(json)})
          const d = await r.json(); if(!d.ok) throw new Error(d.error)
          savedState = { cardName:d.name, schemas:d.schemas, initvarData:d.initvarData, edits:{} }; saveSS(savedState)
          setCollapsed(new Set()); setState({status:'loaded',cardName:d.name,schemas:d.schemas,initvarData:d.initvarData,edits:{},generatedBlock:'',error:'',search:''})
        } catch(e) { setState(s=>({...s,status:'error',error:e.message})) }
      }
      const readFile = (f) => { const r=new FileReader(); r.onload=()=>{ try{parseCard(JSON.parse(r.result))}catch(e){setState(s=>({...s,error:'JSON error: '+e.message}))} }; r.readAsText(f) }
      const handleDrop = (e) => { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) readFile(f) }
      const loadFromTavern = async () => {
        setState(s=>({...s,status:'loading',error:''}))
        try {
          const d = await fetchTavernCard()
          if(!d.ok) throw new Error(d.error)
          const schemas = d.schemas || []
          savedState = { cardName:d.name, schemas, initvarData:d.initvarData||{}, edits:{} }; saveSS(savedState)
          setCollapsed(new Set()); setState({status:'loaded',cardName:d.name,schemas,initvarData:d.initvarData||{},edits:{},generatedBlock:'',error:'',search:'',presetSource:d.presetSource||'',presetDir:d.presetDir||''})
        } catch(e) { setState(s=>({...s,status:'error',error:e.message})) }
      }
      const handleEdit = (path, val) => setState(s=>{ const e={...s.edits,[path]:val}; savedState={...savedState,edits:e}; saveSS(savedState); return {...s,edits:e} })
      const handleGenerate = async () => {
        const edits = Object.entries(state.edits).map(([p,v])=>({path:p,value:v}))
        try {
          const r = await fetch('/api/muv-table/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({originalData:state.initvarData,edits})})
          const d = await r.json(); if(!d.ok) throw new Error(d.error)
          setState(s=>({...s,generatedBlock:d.block}))
        } catch(e) { setState(s=>({...s,error:e.message})) }
      }
      const toggleCollapse = (path) => setCollapsed(c=>{ const n=new Set(c); n.has(path)?n.delete(path):n.add(path); return n })
      const toggleAll = () => setCollapsed(c=>c.size>0?new Set():new Set(state.schemas.map(f=>f.name)))
      const editCount = Object.keys(state.edits).length
      const typeName = { number:'数字', string:'文本', object:'对象', record:'字典' }

      // ============ render a field node recursively ============
      const renderField = (field, data, prefix, depth) => {
        const path = prefix?prefix+'.'+field.name:field.name
        const raw = data?.[field.name]
        // A `- item` list arrives as an array; this row is one input, so join the
        // items with newlines instead of letting React render "a,b".
        const val = Array.isArray(raw)?raw.join('\n'):raw
        const isContainer = field.type==='object' && field.children && field.children.length>0
        const isCollapsed = collapsed.has(path)
        const changed = state.edits[path]!==undefined
        const indent = depth * 16

        return jsx.jsxs('div', { key:path, children: [
          // Row
          jsx.jsxs('div', {
            onClick: isContainer ? ()=>toggleCollapse(path) : undefined,
            style: {
              display:'flex', alignItems:'center', gap:8, padding:'5px 8px 5px '+(8+indent)+'px',
              cursor: isContainer?'pointer':'default', userSelect:'none',
              borderLeft: changed?'3px solid '+C.gold:'3px solid transparent',
              background: changed?'rgba(197,160,101,0.06)':'transparent',
              borderRadius: '0 6px 6px 0', marginBottom:1,
              transition: 'background 0.12s'
            },
            onMouseEnter: e => { if(isContainer) e.currentTarget.style.background=changed?'rgba(197,160,101,0.12)':C.hover },
            onMouseLeave: e => { e.currentTarget.style.background=changed?'rgba(197,160,101,0.06)':'transparent' },
            children: [
              jsx.jsx('span', { style:{width:14,fontSize:10,color:C.dim,flexShrink:0}, children: isContainer?(isCollapsed?'▸':'▾'):'' }),
              jsx.jsx('span', { style:{fontWeight:isContainer?600:400,color:isContainer?C.text:C.sub,fontSize:13,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}, children: field.name }),
              jsx.jsx('span', { style:{fontSize:10,padding:'1px 6px',borderRadius:3,background:field.type==='number'?'rgba(74,191,171,0.15)':'rgba(197,160,101,0.1)',color:field.type==='number'?C.accent:C.sub,flexShrink:0}, children: typeName[field.type]||field.type }),
              !isContainer && jsx.jsx('input', {
                type: field.type==='number'?'number':'text',
                value: state.edits[path]!==undefined?state.edits[path]:(val??''),
                onChange: e => handleEdit(path, e.target.value),
                onClick: e => e.stopPropagation(),
                style: {
                  width: field.type==='number'?80:'100%', maxWidth:260,
                  background:C.bg3, border:'1px solid '+(changed?C.gold:'var(--dsw-alias-border-l2)'),
                  borderRadius:4, padding:'3px 8px', color:C.text, fontSize:12, fontFamily:'inherit', outline:'none',
                  flexShrink:1
                }
              })
            ]
          }),
          // Children
          isContainer && !isCollapsed && field.children.map(c => renderField(c, val||{}, path, depth+1))
        ] })
      }

      // ============ main render ============
      return jsx.jsxs('div', { style:{position:'fixed',inset:0,zIndex:60,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}, onClick:onClose, children: [
        jsx.jsxs('div', { onClick:e=>e.stopPropagation(), style:{width:'min(92vw,820px)',height:'min(90vh,700px)',background:C.bg,display:'flex',flexDirection:'column',color:C.text,fontFamily:C.font,fontSize:13,borderRadius:12,border:'1px solid '+C.border,boxShadow:'0 20px 60px rgba(0,0,0,0.5)',overflow:'hidden'}, children: [
        // Header
        jsx.jsxs('div', { style:{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderBottom:'1px solid '+C.border,flexShrink:0,background:C.bg1}, children: [
          jsx.jsx('span', { style:{fontWeight:700,fontSize:15,flex:1}, children: state.cardName?'📊 '+state.cardName:'📊 MUV 变量表格' }),
          // ★ 卡片来源指示（presetSource）——服务端一直在如实上报，但**从来没人消费它**，
          //   于是用户在未绑定会话里只看到"一张不知从哪来的卡"，看不出问题在哪。
          //   这里把它显式化：`session-default` / `default` = 该会话**没有绑定角色卡**，
          //   面板当前用的是酒馆默认预设（tavern-lite）⇒ 必须让用户看见，而不是静默。
          //   其余取值（explicit/session/active）只做中性提示，方便排障。
          state.status==='loaded' && state.presetSource && (function () {
            var unbound = state.presetSource === 'default' || state.presetSource === 'session-default'
            return jsx.jsx('span', {
              title: 'presetSource=' + state.presetSource + '\n预设目录: ' + (state.presetDir || '(未知)') +
                     (unbound ? '\n\n本会话没有绑定角色卡，当前显示的是酒馆默认预设。\n要换卡：在酒馆面板选好预设后**新开一个对话**（已开始的会话角色卡已锁定）。' : ''),
              style:{fontSize:11,padding:'2px 8px',borderRadius:10,whiteSpace:'nowrap',cursor:'help',
                background: unbound ? 'rgba(231,76,60,0.15)' : 'rgba(74,191,171,0.12)',
                color: unbound ? 'var(--dsw-alias-state-error-primary,#e74c3c)' : C.accent,
                border: '1px solid ' + (unbound ? 'rgba(231,76,60,0.35)' : 'rgba(74,191,171,0.3)')},
              children: unbound ? '⚠️ 本会话未绑卡（默认预设）' : '来源: ' + state.presetSource
            })
          })(),
          state.status==='loaded' && jsx.jsx('input', { type:'text', placeholder:'🔍 搜索变量...', value:state.search, onChange:e=>setState(s=>({...s,search:e.target.value})), style:{width:160,padding:'4px 10px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,fontSize:12,fontFamily:'inherit',outline:'none'} }),
          editCount>0 && jsx.jsx('span', { style:{fontSize:11,color:C.sub,background:'rgba(197,160,101,0.12)',padding:'2px 8px',borderRadius:10}, children: editCount+' 修改' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:()=>showMacroPanel(), style:{padding:'5px 10px',borderRadius:6,border:'1px solid '+C.accent,background:'rgba(74,191,171,0.1)',color:C.accent,cursor:'pointer',fontSize:11,fontFamily:'inherit'}, children: '📐 宏' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:loadFromTavern, style:{padding:'5px 8px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:13,fontFamily:'inherit'}, children: '🔄' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:toggleAll, style:{padding:'5px 10px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:11,fontFamily:'inherit'}, children: collapsed.size>0?'📖 展开全部':'📕 折叠全部' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:handleGenerate, style:{padding:'7px 18px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#c5a065,#d4a76a)',color:'#1a1a1a',cursor:'pointer',fontSize:13,fontWeight:700,fontFamily:'inherit',boxShadow:'0 2px 8px rgba(197,160,101,0.25)'}, children: '⚡ 生成 MUV 块' }),
          jsx.jsx('button', { onClick:onClose, style:{padding:'5px 12px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:12,fontFamily:'inherit'}, children: '✕' })
        ] }),

        // 🧰 卡运维（卡相关入口，按用户要求挂在 **muv-table 自己的面板** 里，不放酒馆面板）
        //    只读 + 一个动作，全部失败都降级成文字提示，不影响下方的变量树。
        state.status==='loaded' && jsx.jsx(CardOpsPanel, {
          sessionId: currentSessionId(),
          cardName: state.cardName || '',
          presetDir: state.presetDir || ''
        }),

        // Content
        state.status==='idle' && jsx.jsxs('div', { style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,padding:24}, children: [
          savedState && savedState.cardName && jsx.jsxs('div', { style:{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'14px 24px',textAlign:'center',maxWidth:400,width:'100%'}, children: [
            jsx.jsx('div', { style:{fontSize:14,fontWeight:600,marginBottom:4}, children: '📌 '+savedState.cardName }),
            jsx.jsx('div', { style:{fontSize:11,color:C.dim,marginBottom:10}, children: savedState.schemas.length+' 个分组 · '+(savedState.edits?Object.keys(savedState.edits).length:0)+' 个修改' }),
            jsx.jsx('button', { onClick:()=>{ setCollapsed(new Set()); setState({status:'loaded',cardName:savedState.cardName,schemas:savedState.schemas,initvarData:savedState.initvarData,edits:savedState.edits||{},generatedBlock:'',error:'',search:''}) }, style:{padding:'6px 20px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#c5a065,#d4a76a)',color:'#1a1a1a',cursor:'pointer',fontSize:13,fontWeight:700,fontFamily:'inherit',boxShadow:'0 2px 8px rgba(197,160,101,0.25)'}, children: '📂 继续编辑' })
          ] }),
          jsx.jsxs('div', { onClick:()=>fileRef.current?.click(), onDragOver:e=>e.preventDefault(), onDrop:handleDrop, style:{padding:40,border:'2px dashed '+C.border,borderRadius:12,textAlign:'center',cursor:'pointer',color:C.dim,maxWidth:400,width:'100%'}, children: [
            jsx.jsx('div', { style:{fontSize:28,marginBottom:8}, children: '📁' }),
            jsx.jsx('div', { children: '拖放 MUV 角色卡 JSON 到此处' }),
            jsx.jsx('input', { ref:fileRef, type:'file', accept:'.json', style:{display:'none'}, onChange:e=>{const f=e.target.files[0];if(f)readFile(f)} })
          ] }),
          jsx.jsx('button', { onClick:loadFromTavern, style:{padding:'10px 24px',borderRadius:8,border:'1px solid '+C.gold,background:'rgba(197,160,101,0.1)',color:C.gold,cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit'}, children: '🍺 从酒馆加载当前角色卡' })
        ] }),
        state.status==='loading' && jsx.jsx('div', { style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:C.dim}, children: '⏳ 解析中...' }),
        state.error && jsx.jsx('div', { style:{padding:12,color:C.danger}, children: '⚠ '+state.error }),

        // Tree
        state.status==='loaded' && state.schemas.length===0 && jsx.jsxs('div', { style:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,padding:24,color:C.dim}, children: [
          jsx.jsx('div', { style:{fontSize:14,fontWeight:600,color:C.text}, children: '📋 '+state.cardName }),
          jsx.jsx('div', { style:{fontSize:12}, children: '此卡没有预设初始变量' }),
          jsx.jsx('div', { style:{fontSize:11,textAlign:'center',lineHeight:1.6}, children: '玩起来后 LLM 输出 &lt;UpdateVariable&gt; 块时，变量会自动出现在这里。' }),
          jsx.jsx('div', { style:{fontSize:11,color:C.gold}, children: '也可以手动拖放角色卡 JSON 文件加载初始数据。' })
        ] }),
        state.status==='loaded' && state.schemas.length>0 && jsx.jsx('div', { style:{flex:1,overflow:'auto',padding:'8px 12px'}, children:
          state.schemas.filter(f=>!state.search||f.name.includes(state.search)||JSON.stringify(f).includes(state.search)).map(field =>
            jsx.jsxs('div', { key:field.name, style:{marginBottom:10,background:C.bg1,border:'1px solid '+C.border,borderRadius:8,overflow:'hidden'}, children: [
              jsx.jsxs('div', { onClick:()=>toggleCollapse(field.name), style:{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',cursor:'pointer',userSelect:'none',background:collapsed.has(field.name)?C.bg1:C.bg2,borderBottom:collapsed.has(field.name)?'none':'1px solid '+C.border}, onMouseEnter:e=>e.currentTarget.style.background=C.hover, onMouseLeave:e=>e.currentTarget.style.background=collapsed.has(field.name)?C.bg1:C.bg2, children: [
                jsx.jsx('span', { style:{fontSize:12,color:C.dim,width:16}, children: collapsed.has(field.name)?'▸':'▾' }),
                jsx.jsx('span', { style:{fontWeight:700,fontSize:14,flex:1}, children: field.name }),
                jsx.jsx('span', { style:{fontSize:10,padding:'2px 8px',borderRadius:10,background:'rgba(197,160,101,0.12)',color:C.sub}, children: field.children.length+' 项' })
              ] }),
              !collapsed.has(field.name) && jsx.jsx('div', { style:{padding:'4px 0'}, children:
                field.children.map(c => renderField(c, state.initvarData[field.name]||{}, field.name, 1))
              })
            ] })
          )
        }),

        // Generated block
        state.generatedBlock && jsx.jsxs('div', { style:{flexShrink:0,borderTop:'2px solid '+C.accent}, children: [
          jsx.jsxs('div', { style:{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',background:C.bg1}, children: [
            jsx.jsx('span', { style:{fontWeight:600,fontSize:12,color:C.accent,flex:1}, children: '✅ MUV 块 ('+state.generatedBlock.split('\n').length+' 行)' }),
            jsx.jsx('button', { onClick:()=>navigator.clipboard.writeText(state.generatedBlock), style:{padding:'4px 12px',borderRadius:4,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:11,fontFamily:'inherit'}, children: '📋 复制' }),
            jsx.jsx('button', { onClick:()=>setState(s=>({...s,generatedBlock:''})), style:{padding:'4px 10px',borderRadius:4,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:11,fontFamily:'inherit'}, children: '✕' })
          ] }),
          jsx.jsx('pre', { style:{background:'#0d0e12',padding:12,fontSize:11,fontFamily:'monospace',whiteSpace:'pre-wrap',wordBreak:'break-all',maxHeight:180,overflow:'auto',margin:0,color:'#c0c0c0',borderTop:'1px solid '+C.border}, children: state.generatedBlock })
        ] })
      ] })
    ] })
    }

    // ============ Sidebar entry ============
    function sidebarRoot() { const col=document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]'); return col?col.querySelector('[class*="logoRow"]')?.parentElement??col.firstElementChild:undefined }
    function newSessionBtn(root) { const n=root.querySelector('button[class*="newSession"]'); if(n)return n; for(const c of root.children) if(c.tagName==='BUTTON') return c }
    function createEntry() {
      const e=document.createElement('button'); e.type='button'; e.dataset.dshMuvEntry=''
      const ex=document.querySelector('[data-dsh-taskboard-entry], [data-dsh-ssh-entry]'); e.className=ex?ex.className:''
      e.setAttribute('aria-label','MUV 表格'); e.innerHTML=`<span style="flex:none;display:inline-flex;justify-content:center;align-items:center">${ICON}</span><span style="text-overflow:ellipsis;overflow:hidden">MUV 表格</span>`
      Object.assign(e.style,{width:'100%',height:'32px',color:'var(--dsw-alias-label-secondary)',cursor:'pointer',whiteSpace:'nowrap',background:'none',border:'none',borderRadius:'8px',alignItems:'center',gap:'8px',padding:'0 12px',fontSize:'13px',display:'flex'})
      e.addEventListener('mouseenter',()=>{e.style.background='var(--dsw-specific-sidebar-nav-item-hover)';e.style.color='var(--dsw-alias-label-primary)'})
      e.addEventListener('mouseleave',()=>{e.style.background='none';e.style.color='var(--dsw-alias-label-secondary)'})
      return e
    }
    function placeEntry(root, entry) {
      const btn=newSessionBtn(root); if(!btn) return false
      if(entry.parentElement!==root){const row=btn.closest('[class*="logoRow"]');const base=row&&row.parentElement===root?row:btn;const family=Array.from(root.children).filter(el=>el instanceof HTMLElement&&el.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry]'));const anchor=family.length>0?family[0]:base.nextElementSibling;root.insertBefore(entry,anchor)}
      return true
    }
    let vc=null, vr=null
    function showView(){if(vc){vc.style.display='';return};vc=document.createElement('div');vc.setAttribute('data-dsh-muv-view','');document.body.appendChild(vc);vr=ReactDOM.createRoot(vc);vr.render(jsx.jsx(MuvTableView,{onClose:()=>{if(vc)vc.style.display='none'}}))}
    function mountSidebarEntry(){if(document.querySelector('[data-dsh-muv-entry]'))return()=>{};const e=createEntry();e.addEventListener('click',showView);let root,placed=false;const tp=()=>{if(root&&!root.isConnected){root=undefined;placed=false}if(placed){if(document.body.contains(e))return;root=undefined;placed=false}root??=sidebarRoot();if(!root)return;placed=placeEntry(root,e)};const o=new MutationObserver(tp);o.observe(document.body,{childList:true,subtree:true});tp();return()=>{o.disconnect();e.remove();if(vc)vc.remove();vr=null;vc=null}}

    // ============ apply ============
    let forceReload = false

    // ── DOM observer: detect session / preset switches by watching the URL ──
    let _lastPath = window.location.pathname + window.location.search
    function detectSessionChange() {
      try {
        const currentPath = window.location.pathname + window.location.search
        if (currentPath !== _lastPath) {
          _lastPath = currentPath
          document.dispatchEvent(new CustomEvent('tavern-session-changed', {
            detail: { path: currentPath }
          }))
          forceReload = true
        }
      } catch (_) {}
    }

    exports.inject = []
    exports.apply = function () {
      // Listen for tavern preset changes (dispatched by other plugins or DSH internals)
      // ★ 只用来触发重载 —— 事件里的 `presetId` **不再**被记住、更不会当"当前预设"
      //   发出去。切会话时这个事件可能带着上一个会话的预设（粘住），而定位依据已统一
      //   为会话 id（见上面 currentSessionId 的说明）。
      const onPresetChanged = () => {
        forceReload = true
      }
      document.addEventListener('tavern-preset-changed', onPresetChanged)

      // Listen for tavern session changes
      const onSessionChanged = () => {
        forceReload = true
      }
      document.addEventListener('tavern-session-changed', onSessionChanged)

      let d=null; const tm=()=>{if(d)return;if(sidebarRoot())d=mountSidebarEntry()}; tm()
      const o=new MutationObserver(() => { tm(); detectSessionChange() })
      o.observe(document.body,{childList:true,subtree:true})
      // Initial detection
      detectSessionChange()
      return () => {
        o.disconnect()
        document.removeEventListener('tavern-preset-changed', onPresetChanged)
        document.removeEventListener('tavern-session-changed', onSessionChanged)
        if (d) d()
        if (macroVc) { macroVc.remove(); macroVc = null; macroVr = null }
      }
    }
    return module.exports
  }
})