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
.subtitle{color:#7d8590;font-size:13px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card .label{font-size:11px;text-transform:uppercase;color:#7d8590;letter-spacing:.5px;margin-bottom:4px}
.card .value{font-size:24px;font-weight:600;color:#f0f3f6}
.card .value.cost{color:#3fb950}
.card .value.warn{color:#d29922}
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
</style>
</head>
<body>
<h1><span class="status"></span>Bastion AI Gateway</h1>
<p class="subtitle">Local-first LLM proxy &mdash; refreshes every 3s</p>

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
<p class="empty" id="no-requests">No requests yet. Send a request through the gateway to see it here.</p>
</div>

<p class="footer">Bastion v0.1.0 &mdash; <span id="uptime"></span> uptime &mdash; <span id="mem"></span> MB memory</p>

<script>
function fmt(n){return n.toLocaleString()}
function cost(n){return n<0.01?'$'+n.toFixed(6):'$'+n.toFixed(4)}
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

async function refresh(){
  try{
    const r=await fetch('/api/stats');
    const d=await r.json();
    const s=d.stats;

    document.getElementById('cards').innerHTML=
      card('Requests',fmt(s.total_requests))+
      card('Total Cost',cost(s.total_cost_usd),'cost')+
      card('Input Tokens',fmt(s.total_input_tokens))+
      card('Output Tokens',fmt(s.total_output_tokens))+
      card('Cache Hits',fmt(s.cache_hits))+
      card('Avg Latency',Math.round(s.avg_latency_ms)+'ms');

    // By provider
    const providers=Object.entries(s.by_provider||{});
    const maxReq=Math.max(...providers.map(([,v])=>v.requests),1);
    if(providers.length){
      document.getElementById('by-provider-section').style.display='';
      document.getElementById('by-provider').innerHTML=providers.map(([k,v])=>
        '<tr><td>'+providerTag(k)+'</td><td>'+fmt(v.requests)+'</td><td class="mono">'+cost(v.cost_usd)+'</td>'+
        '<td style="width:30%"><div class="bar-container"><div class="bar blue" style="width:'+Math.round(v.requests/maxReq*100)+'%"></div></div></td></tr>'
      ).join('');
    }

    // By model
    const models=Object.entries(s.by_model||{});
    if(models.length){
      document.getElementById('by-model-section').style.display='';
      document.getElementById('by-model').innerHTML=models.map(([k,v])=>
        '<tr><td class="mono">'+k+'</td><td>'+fmt(v.requests)+'</td><td class="mono">'+cost(v.cost_usd)+'</td></tr>'
      ).join('');
    }

    // Recent
    const recent=d.recent||[];
    document.getElementById('no-requests').style.display=recent.length?'none':'';
    document.getElementById('recent').innerHTML=recent.map(r=>{
      let flags='';
      if(r.cached)flags+='<span class="tag cached">cached</span> ';
      if(r.dlp_action&&r.dlp_action!=='pass')flags+='<span class="tag blocked">'+r.dlp_action+'</span> ';
      return '<tr><td>'+ago(r.created_at)+'</td><td>'+providerTag(r.provider)+'</td>'+
        '<td class="mono">'+r.model+'</td><td>'+(r.status_code||'-')+'</td>'+
        '<td class="mono">'+fmt(r.input_tokens)+' / '+fmt(r.output_tokens)+'</td>'+
        '<td class="mono">'+cost(r.cost_usd)+'</td><td>'+r.latency_ms+'ms</td><td>'+flags+'</td></tr>';
    }).join('');

    document.getElementById('uptime').textContent=uptime(d.uptime);
    document.getElementById('mem').textContent=Math.round(d.memory/1024/1024);
  }catch(e){}
}

function card(label,value,cls){
  return '<div class="card"><div class="label">'+label+'</div><div class="value'+(cls?' '+cls:'')+'">'+value+'</div></div>';
}

refresh();
setInterval(refresh,3000);
</script>
</body>
</html>`;

export function serveDashboard(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HTML);
}
