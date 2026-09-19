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

      // Get the tavern's active card
      //
      // Which preset is active has exactly one source of truth: the tavern
      // plugin's own selection, which it publishes on these DOM nodes (and
      // mirrors to localStorage). `lastPresetId` was previously only set by a
      // `tavern-preset-changed` event, which does not fire on page load — so the
      // first request carried no preset and the server fell back to a hardcoded
      // one, showing an unrelated card.
      //
      // Reading the DOM here rather than caching an event value matters: the
      // panel polls, and the user can switch presets at any time. An earlier
      // revision cached the first answer and never re-checked, which pinned the
      // panel to whatever preset happened to be active when it opened.
      const readActivePresetFromDom = () => {
        try {
          for (const id of ['tavern-session-preset-label', 'tavern-session-preset-btn']) {
            const el = document.getElementById(id)
            const pid = el && el.dataset && el.dataset.presetId
            if (pid) return pid
          }
          const item = document.querySelector('#tavern-session-preset-panel [data-preset-id]')
          const aid = item && item.getAttribute && item.getAttribute('data-preset-id')
          if (aid) return aid
        } catch (_) {}
        try { return localStorage.getItem('dsh-tavern-active-preset') || '' } catch (_) { return '' }
      }

      const resolveActivePreset = async () => {
        // Tavern's DOM is authoritative and updates the moment the user switches.
        const fromDom = readActivePresetFromDom()
        if (fromDom) { lastPresetId = fromDom; return lastPresetId }
        // The DOM nodes are absent outside the tavern UI; ask the server, which
        // resolves the preset from the most recently active session.
        try {
          const r = await fetch('/api/muv-table/active-preset')
          const d = await r.json()
          if (d && d.ok && d.presetId) lastPresetId = d.presetId
        } catch (_) {}
        return lastPresetId
      }

      const fetchTavernCard = async () => {
        await resolveActivePreset()
        let url = '/api/muv-table/tavern-card'
        if (lastPresetId) url += '?presetId=' + encodeURIComponent(lastPresetId)
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
                setState({status:'loaded',cardName:d.name,schemas:d.schemas,initvarData:d.initvarData,edits:{},generatedBlock:'',error:'',search:''})
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
          setCollapsed(new Set()); setState({status:'loaded',cardName:d.name,schemas,initvarData:d.initvarData||{},edits:{},generatedBlock:'',error:'',search:''})
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
        const val = data?.[field.name]
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
          state.status==='loaded' && jsx.jsx('input', { type:'text', placeholder:'🔍 搜索变量...', value:state.search, onChange:e=>setState(s=>({...s,search:e.target.value})), style:{width:160,padding:'4px 10px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,fontSize:12,fontFamily:'inherit',outline:'none'} }),
          editCount>0 && jsx.jsx('span', { style:{fontSize:11,color:C.sub,background:'rgba(197,160,101,0.12)',padding:'2px 8px',borderRadius:10}, children: editCount+' 修改' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:()=>showMacroPanel(), style:{padding:'5px 10px',borderRadius:6,border:'1px solid '+C.accent,background:'rgba(74,191,171,0.1)',color:C.accent,cursor:'pointer',fontSize:11,fontFamily:'inherit'}, children: '📐 宏' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:loadFromTavern, style:{padding:'5px 8px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:13,fontFamily:'inherit'}, children: '🔄' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:toggleAll, style:{padding:'5px 10px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:11,fontFamily:'inherit'}, children: collapsed.size>0?'📖 展开全部':'📕 折叠全部' }),
          state.status==='loaded' && jsx.jsx('button', { onClick:handleGenerate, style:{padding:'7px 18px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#c5a065,#d4a76a)',color:'#1a1a1a',cursor:'pointer',fontSize:13,fontWeight:700,fontFamily:'inherit',boxShadow:'0 2px 8px rgba(197,160,101,0.25)'}, children: '⚡ 生成 MUV 块' }),
          jsx.jsx('button', { onClick:onClose, style:{padding:'5px 12px',borderRadius:6,border:'1px solid '+C.border,background:C.bg3,color:C.text,cursor:'pointer',fontSize:12,fontFamily:'inherit'}, children: '✕' })
        ] }),

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
    let lastPresetId = ''

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
      const onPresetChanged = (e) => {
        forceReload = true
        lastPresetId = e.detail?.presetId || ''
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