import type { ServerResponse } from 'node:http';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bastion AI Gateway</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1117;color:#e1e4e8;padding:20px;max-width:1200px;margin:0 auto}
h1{font-size:20px;font-weight:600;margin-bottom:4px;color:#f0f3f6}
.subtitle{color:#7d8590;font-size:13px;margin-bottom:12px}
.tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #30363d;padding-bottom:0}
.tab{padding:8px 16px;cursor:pointer;color:#7d8590;font-size:13px;font-weight:500;border:none;background:none;border-bottom:2px solid transparent;transition:all .15s}
.tab:hover{color:#e1e4e8}
.tab.active{color:#58a6ff;border-bottom-color:#58a6ff}
.tab-content{display:none}
.tab-content.active{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{font-size:11px;text-transform:uppercase;color:#7d8590;letter-spacing:.5px;margin-bottom:4px}
.card .value{font-size:24px;font-weight:600;color:#f0f3f6}
.card .value.cost{color:#3fb950}
.card .value.warn{color:#d29922}
.card .value.blue{color:#58a6ff}
.section{margin-bottom:20px}
.section h2{font-size:14px;font-weight:600;color:#7d8590;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 10px;border-bottom:1px solid #30363d;color:#7d8590;font-weight:500}
td{padding:6px 10px;border-bottom:1px solid #21262d}
tr:hover{background:#1c2128}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
.tag.anthropic{background:#2a1f3d;color:#b388ff}
.tag.openai{background:#1a2f1a;color:#69db7c}
.tag.gemini{background:#2a2a1a;color:#ffd43b}
.tag.cached{background:#0d2818;color:#3fb950}
.tag.blocked{background:#3d1a1a;color:#f85149}
.tag.warn{background:#3d2e1a;color:#d29922}
.tag.redact{background:#2a1f3d;color:#b388ff}
.mono{font-family:"SF Mono",Monaco,monospace;font-size:12px}
.bar-container{height:6px;background:#21262d;border-radius:3px;overflow:hidden;margin-top:4px}
.bar{height:100%;border-radius:3px;transition:width .3s}
.bar.blue{background:#58a6ff}
.bar.green{background:#3fb950}
.bar.purple{background:#b388ff}
.status{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#3fb950;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.footer{color:#484f58;font-size:11px;margin-top:24px;text-align:center}
.empty{color:#484f58;text-align:center;padding:24px}
.filter-bar{display:flex;gap:8px;align-items:center;margin-bottom:16px}
.filter-bar select{background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px}
.filter-bar label{font-size:12px;color:#7d8590}
.snippet{background:#1c2128;padding:6px 10px;border-radius:4px;font-family:"SF Mono",Monaco,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;max-width:400px;overflow:hidden}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:8px}
.toggle-row .toggle-label{font-size:14px;color:#e1e4e8}
.toggle-row .toggle-desc{font-size:11px;color:#7d8590;margin-top:2px}
.switch{position:relative;width:40px;height:22px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#30363d;border-radius:11px;transition:.2s}
.slider:before{position:absolute;content:"";height:16px;width:16px;left:3px;bottom:3px;background:#e1e4e8;border-radius:50%;transition:.2s}
.switch input:checked+.slider{background:#3fb950}
.switch input:checked+.slider:before{transform:translateX(18px)}
.config-select{background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:4px 8px;border-radius:4px;font-size:12px}
</style>
</head>
<body>
<h1><span class="status"></span>Bastion AI Gateway</h1>
<p class="subtitle">Local-first LLM proxy &mdash; refreshes every 3s</p>

<div class="tabs">
  <button class="tab active" data-tab="overview">Overview</button>
  <button class="tab" data-tab="dlp">DLP</button>
  <button class="tab" data-tab="optimizer">Optimizer</button>
  <button class="tab" data-tab="audit">Audit</button>
  <button class="tab" data-tab="settings">Settings</button>
</div>

<!-- OVERVIEW TAB -->
<div class="tab-content active" id="tab-overview">
  <div class="filter-bar">
    <label>Session:</label>
    <select id="session-filter"><option value="">All sessions</option></select>
  </div>
  <div class="grid" id="cards"></div>
  <div class="section" id="by-provider-section" style="display:none">
    <h2>By Provider</h2>
    <table><thead><tr><th>Provider</th><th>Requests</th><th>Cost</th><th></th></tr></thead><tbody id="by-provider"></tbody></table>
  </div>
  <div class="section" id="by-model-section" style="display:none">
    <h2>By Model</h2>
    <table><thead><tr><th>Model</th><th>Requests</th><th>Cost</th></tr></thead><tbody id="by-model"></tbody></table>
  </div>
  <div class="section">
    <h2>Recent Requests</h2>
    <table><thead><tr><th>Time</th><th>Provider</th><th>Model</th><th>Status</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Flags</th></tr></thead><tbody id="recent"></tbody></table>
    <p class="empty" id="no-requests">No requests yet.</p>
  </div>
</div>

<!-- DLP TAB -->
<div class="tab-content" id="tab-dlp">
  <div class="grid" id="dlp-cards"></div>
  <div class="section">
    <h2>Recent DLP Findings</h2>
    <table><thead><tr><th>Time</th><th>Pattern</th><th>Category</th><th>Action</th><th>Matches</th><th>Original Snippet</th><th>Redacted Snippet</th></tr></thead><tbody id="dlp-recent"></tbody></table>
    <p class="empty" id="no-dlp">No DLP events yet.</p>
  </div>
</div>

<!-- OPTIMIZER TAB -->
<div class="tab-content" id="tab-optimizer">
  <div class="grid" id="optimizer-cards"></div>
  <div class="section">
    <h2>Recent Optimizer Events</h2>
    <table><thead><tr><th>Time</th><th>Type</th><th>Original</th><th>Trimmed</th><th>Chars Saved</th><th>Tokens Saved</th></tr></thead><tbody id="optimizer-recent"></tbody></table>
    <p class="empty" id="no-optimizer">No optimizer events yet.</p>
  </div>
</div>

<!-- AUDIT TAB -->
<div class="tab-content" id="tab-audit">
  <div class="section">
    <h2>Recent Audit Entries</h2>
    <table><thead><tr><th>Time</th><th>Request ID</th><th>Request Size</th><th>Response Size</th><th></th></tr></thead><tbody id="audit-recent"></tbody></table>
    <p class="empty" id="no-audit">No audit entries. Enable audit logging in Settings to start capturing request/response content.</p>
  </div>
  <div id="audit-detail" style="display:none">
    <h2>Content Viewer</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="card"><div class="label">Request</div><pre class="snippet" id="audit-req" style="max-height:400px;overflow:auto"></pre></div>
      <div class="card"><div class="label">Response</div><pre class="snippet" id="audit-res" style="max-height:400px;overflow:auto"></pre></div>
    </div>
  </div>
</div>

<!-- SETTINGS TAB -->
<div class="tab-content" id="tab-settings">
  <div class="section">
    <h2>Plugin Controls</h2>
    <div id="plugin-toggles"></div>
  </div>
  <div class="section">
    <h2>DLP Configuration</h2>
    <div class="toggle-row">
      <div><div class="toggle-label">DLP Action Mode</div><div class="toggle-desc">What to do when sensitive data is detected</div></div>
      <select class="config-select" id="dlp-action">
        <option value="pass">Pass (log only)</option>
        <option value="warn">Warn</option>
        <option value="redact">Redact</option>
        <option value="block">Block</option>
      </select>
    </div>
  </div>
</div>

<p class="footer">Bastion v0.1.0 &mdash; <span id="uptime"></span> uptime &mdash; <span id="mem"></span> MB memory</p>

<script>
function fmt(n){return n.toLocaleString()}
function cost(n){return n<0.01?'$'+n.toFixed(6):'$'+n.toFixed(4)}
function bytes(n){if(n<1024)return n+'B';if(n<1048576)return(n/1024).toFixed(1)+'KB';return(n/1048576).toFixed(1)+'MB'}
function ago(ts){
  const d=new Date(ts+'Z'),now=new Date(),s=Math.floor((now-d)/1000);
  if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';
}
function uptime(s){
  if(s<60)return Math.round(s)+'s';if(s<3600)return Math.round(s/60)+'m';
  return Math.round(s/3600)+'h '+Math.round((s%3600)/60)+'m';
}
function providerTag(p){return '<span class="tag '+p+'">'+p+'</span>'}
function actionTag(a){return '<span class="tag '+(a==='block'?'blocked':a==='warn'?'warn':'redact')+'">'+a+'</span>'}
function card(label,value,cls){return '<div class="card"><div class="label">'+label+'</div><div class="value'+(cls?' '+cls:'')+'">'+value+'</div></div>'}
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML}

// Tab switching
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-'+t.dataset.tab).classList.add('active');
    if(t.dataset.tab==='dlp')refreshDlp();
    if(t.dataset.tab==='optimizer')refreshOptimizer();
    if(t.dataset.tab==='audit')refreshAudit();
    if(t.dataset.tab==='settings')refreshSettings();
  });
});

// Session filter
let sessions=[];
async function loadSessions(){
  try{
    const r=await fetch('/api/sessions');
    sessions=await r.json();
    const sel=document.getElementById('session-filter');
    const cur=sel.value;
    sel.innerHTML='<option value="">All sessions</option>';
    sessions.forEach(s=>{
      const label=s.session_id.slice(0,8)+'... ('+s.request_count+' reqs, '+cost(s.total_cost_usd)+')';
      sel.innerHTML+='<option value="'+s.session_id+'">'+label+'</option>';
    });
    sel.value=cur;
  }catch(e){}
}
document.getElementById('session-filter').addEventListener('change',()=>refresh());

// Overview
async function refresh(){
  try{
    const sid=document.getElementById('session-filter').value;
    const params=sid?'?session_id='+encodeURIComponent(sid):'';
    const r=await fetch('/api/stats'+params);
    const d=await r.json();
    const s=d.stats;

    document.getElementById('cards').innerHTML=
      card('Requests',fmt(s.total_requests))+
      card('Total Cost',cost(s.total_cost_usd),'cost')+
      card('Input Tokens',fmt(s.total_input_tokens))+
      card('Output Tokens',fmt(s.total_output_tokens))+
      card('Cache Hits',fmt(s.cache_hits))+
      card('Avg Latency',Math.round(s.avg_latency_ms)+'ms');

    const providers=Object.entries(s.by_provider||{});
    const maxReq=Math.max(...providers.map(([,v])=>v.requests),1);
    if(providers.length){
      document.getElementById('by-provider-section').style.display='';
      document.getElementById('by-provider').innerHTML=providers.map(([k,v])=>
        '<tr><td>'+providerTag(k)+'</td><td>'+fmt(v.requests)+'</td><td class="mono">'+cost(v.cost_usd)+'</td>'+
        '<td style="width:30%"><div class="bar-container"><div class="bar blue" style="width:'+Math.round(v.requests/maxReq*100)+'%"></div></div></td></tr>'
      ).join('');
    }

    const models=Object.entries(s.by_model||{});
    if(models.length){
      document.getElementById('by-model-section').style.display='';
      document.getElementById('by-model').innerHTML=models.map(([k,v])=>
        '<tr><td class="mono">'+k+'</td><td>'+fmt(v.requests)+'</td><td class="mono">'+cost(v.cost_usd)+'</td></tr>'
      ).join('');
    }

    const recent=d.recent||[];
    document.getElementById('no-requests').style.display=recent.length?'none':'';
    document.getElementById('recent').innerHTML=recent.map(r=>{
      let flags='';
      if(r.cached)flags+='<span class="tag cached">cached</span> ';
      if(r.dlp_action&&r.dlp_action!=='pass')flags+=actionTag(r.dlp_action)+' ';
      if(r.session_id)flags+='<span class="tag" style="background:#1a2a3d;color:#58a6ff" title="'+esc(r.session_id)+'">session</span> ';
      return '<tr><td>'+ago(r.created_at)+'</td><td>'+providerTag(r.provider)+'</td>'+
        '<td class="mono">'+r.model+'</td><td>'+(r.status_code||'-')+'</td>'+
        '<td class="mono">'+fmt(r.input_tokens)+' / '+fmt(r.output_tokens)+'</td>'+
        '<td class="mono">'+cost(r.cost_usd)+'</td><td>'+r.latency_ms+'ms</td><td>'+flags+'</td></tr>';
    }).join('');

    document.getElementById('uptime').textContent=uptime(d.uptime);
    document.getElementById('mem').textContent=Math.round(d.memory/1024/1024);
  }catch(e){}
}

// DLP tab
async function refreshDlp(){
  try{
    const [statsR,recentR]=await Promise.all([fetch('/api/stats'),fetch('/api/dlp/recent')]);
    const stats=(await statsR.json()).dlp;
    const recent=await recentR.json();

    const ba=stats.by_action||{};
    document.getElementById('dlp-cards').innerHTML=
      card('Total Scans',fmt(stats.total_events))+
      card('Blocked',fmt(ba.block||0),'warn')+
      card('Redacted',fmt(ba.redact||0),'blue')+
      card('Warned',fmt(ba.warn||0));

    document.getElementById('no-dlp').style.display=recent.length?'none':'';
    document.getElementById('dlp-recent').innerHTML=recent.map(e=>
      '<tr><td>'+ago(e.created_at)+'</td><td class="mono">'+esc(e.pattern_name)+'</td><td>'+esc(e.pattern_category)+'</td>'+
      '<td>'+actionTag(e.action)+'</td><td>'+e.match_count+'</td>'+
      '<td><div class="snippet">'+esc(e.original_snippet||'-')+'</div></td>'+
      '<td><div class="snippet">'+esc(e.redacted_snippet||'-')+'</div></td></tr>'
    ).join('');
  }catch(e){}
}

// Optimizer tab
async function refreshOptimizer(){
  try{
    const [statsR,recentR]=await Promise.all([fetch('/api/optimizer/stats'),fetch('/api/optimizer/recent')]);
    const stats=await statsR.json();
    const recent=await recentR.json();

    const hitRate=stats.total_events>0?(stats.cache_hit_rate*100).toFixed(1)+'%':'0%';
    document.getElementById('optimizer-cards').innerHTML=
      card('Total Events',fmt(stats.total_events))+
      card('Cache Hit Rate',hitRate,'blue')+
      card('Chars Saved',fmt(stats.total_chars_saved),'cost')+
      card('Tokens Saved',fmt(stats.total_tokens_saved),'cost');

    document.getElementById('no-optimizer').style.display=recent.length?'none':'';
    document.getElementById('optimizer-recent').innerHTML=recent.map(e=>
      '<tr><td>'+ago(e.created_at)+'</td><td>'+(e.cache_hit?'<span class="tag cached">cache hit</span>':'trim')+'</td>'+
      '<td class="mono">'+fmt(e.original_length)+'</td><td class="mono">'+fmt(e.trimmed_length)+'</td>'+
      '<td class="mono">'+fmt(e.chars_saved)+'</td><td class="mono">'+fmt(e.tokens_saved_estimate)+'</td></tr>'
    ).join('');
  }catch(e){}
}

// Audit tab
async function refreshAudit(){
  try{
    const r=await fetch('/api/audit/recent');
    const recent=await r.json();
    document.getElementById('no-audit').style.display=recent.length?'none':'';
    document.getElementById('audit-recent').innerHTML=recent.map(e=>
      '<tr style="cursor:pointer" data-rid="'+e.request_id+'"><td>'+ago(e.created_at)+'</td>'+
      '<td class="mono" style="font-size:11px">'+e.request_id.slice(0,12)+'...</td>'+
      '<td class="mono">'+bytes(e.request_length)+'</td><td class="mono">'+bytes(e.response_length)+'</td>'+
      '<td style="color:#58a6ff">View</td></tr>'
    ).join('');
    document.querySelectorAll('#audit-recent tr[data-rid]').forEach(row=>{
      row.addEventListener('click',async()=>{
        const rid=row.dataset.rid;
        try{
          const r=await fetch('/api/audit/'+rid);
          const data=await r.json();
          document.getElementById('audit-detail').style.display='block';
          document.getElementById('audit-req').textContent=tryPrettyJson(data.request);
          document.getElementById('audit-res').textContent=tryPrettyJson(data.response);
        }catch(e){}
      });
    });
  }catch(e){}
}

function tryPrettyJson(s){
  try{return JSON.stringify(JSON.parse(s),null,2)}catch(e){return s}
}

// Settings tab
async function refreshSettings(){
  try{
    const r=await fetch('/api/config');
    const data=await r.json();
    const ps=data.pluginStatus||{};
    const config=data.config||{};

    let html='';
    for(const [name,enabled] of Object.entries(ps)){
      html+='<div class="toggle-row"><div><div class="toggle-label">'+name+'</div></div>'+
        '<label class="switch"><input type="checkbox" data-plugin="'+name+'"'+(enabled?' checked':'')+'>'+
        '<span class="slider"></span></label></div>';
    }
    document.getElementById('plugin-toggles').innerHTML=html;

    // Bind toggle events
    document.querySelectorAll('#plugin-toggles input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change',async()=>{
        const payload={pluginStatus:{}};
        payload.pluginStatus[cb.dataset.plugin]=cb.checked;
        await fetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      });
    });

    // DLP action selector
    const dlpAction=document.getElementById('dlp-action');
    dlpAction.value=config.plugins?.dlp?.action||'warn';
    dlpAction.onchange=async()=>{
      await fetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},
        body:JSON.stringify({plugins:{dlp:{action:dlpAction.value}}})});
    };
  }catch(e){}
}

loadSessions();
refresh();
setInterval(()=>{refresh();loadSessions()},3000);
</script>
</body>
</html>`;

export function serveDashboard(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HTML);
}
