import type { ServerResponse } from 'node:http';

// ── HEAD ──────────────────────────────────────────────────────────
const HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bastion AI Gateway</title>
<style>
:root{--bg:#0c0c0c;--panel:#111;--panel-head:#0f0f0f;--border:#1a1a1a;--border-l:#222;--text:#a0a0a0;--bright:#e0e0e0;--dim:#555;--muted:#444;--green:#00ff88;--red:#ff4444;--cyan:#00ccff;--yellow:#ffcc00;--purple:#aa66ff;--orange:#ff8844}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"SF Mono","Fira Code","JetBrains Mono",Menlo,Consolas,monospace;background:var(--bg);color:var(--text);min-height:100vh}
.container{max-width:1100px;margin:0 auto;padding:16px 20px}
.titlebar{display:flex;align-items:center;justify-content:space-between;padding:8px 0;margin-bottom:12px;border-bottom:1px solid var(--border-l)}
.titlebar-left{display:flex;align-items:center;gap:10px}
.titlebar h1{font-size:13px;font-weight:700;color:var(--green);letter-spacing:1px}
.hdr-status{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px}
.hdr-status::before{content:'\\25CF';color:var(--green);font-size:8px}
.titlebar-right{display:flex;gap:8px;align-items:center}
.time-sel{background:var(--panel);border:1px solid var(--border);color:var(--dim);font-family:inherit;font-size:10px;padding:2px 6px;cursor:pointer}
.tab{font-size:11px;color:var(--dim);cursor:pointer;padding:2px 8px;border:1px solid transparent;transition:all .15s;user-select:none}
.tab:hover{color:#888}
.tab.active{color:var(--green);border-color:var(--green)}
.badge{display:none;background:var(--red);color:#fff;border-radius:2px;padding:0 4px;font-size:9px;font-weight:700;margin-left:2px}
.gauges{display:flex;gap:2px;margin-bottom:16px}
.gauge{flex:1;background:var(--panel);border:1px solid var(--border);padding:10px 12px}
.gauge-label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.gauge-value{font-size:22px;font-weight:700;color:var(--bright);line-height:1}
.gauge-value.green{color:var(--green)}.gauge-value.red{color:var(--red)}.gauge-value.cyan{color:var(--cyan)}.gauge-value.yellow{color:var(--yellow)}.gauge-value.purple{color:var(--purple)}
.gauge-sub{font-size:10px;color:var(--muted);margin-top:3px}
.gauge-bar{height:2px;background:var(--border);margin-top:6px;border-radius:1px;overflow:hidden}
.gauge-bar-fill{height:100%;border-radius:1px}
.panes{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:16px}
.section{background:var(--panel);border:1px solid var(--border);margin-bottom:2px}
.section-head{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:var(--panel-head);border-bottom:1px solid var(--border)}
.section-title{font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:1px}
.section-count{font-size:10px;color:var(--red);font-weight:700}
.section-body{padding:0}
.row{display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid var(--bg);font-size:12px;cursor:pointer;transition:background .1s}
.row:last-child{border-bottom:none}
.row:hover{background:var(--border)}
.row-icon{width:14px;text-align:center;flex-shrink:0}
.row-time{width:55px;color:var(--muted);font-size:11px;flex-shrink:0}
.row-tag{font-size:9px;font-weight:700;padding:1px 5px;border-radius:2px;flex-shrink:0;text-transform:uppercase;letter-spacing:.5px}
.row-tag.dlp{background:#1a0033;color:var(--purple)}
.row-tag.guard{background:#001a33;color:var(--cyan)}
.row-tag.redact{background:#1a0033;color:var(--purple)}
.row-tag.block{background:#330000;color:var(--red)}
.row-tag.audit{background:#0a1a0a;color:var(--green)}
.row-tag.warn{background:#1a1a00;color:var(--yellow)}
.row-text{flex:1;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-text b{color:#ccc;font-weight:600}
.prov-row{display:flex;align-items:center;gap:6px;padding:4px 12px;font-size:11px}
.prov-name{width:70px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prov-bar{flex:1;height:3px;background:var(--border);overflow:hidden}
.prov-bar-fill{height:100%}
.prov-bar-fill.purple{background:var(--purple)}.prov-bar-fill.cyan{background:var(--cyan)}.prov-bar-fill.yellow{background:var(--yellow)}.prov-bar-fill.green{background:var(--green)}
.prov-pct{width:45px;text-align:right;color:var(--dim);font-size:10px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:5px 12px;color:var(--muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);background:var(--panel-head)}
td{padding:5px 12px;border-bottom:1px solid var(--panel);color:#888}
tr:hover td{background:var(--border)}
.s200{color:var(--green)}.s403{color:var(--red)}.cost-c{color:var(--green)}
.page{display:none}.page.active{display:block}
.footer{text-align:center;font-size:10px;color:var(--border-l);margin-top:20px;padding-bottom:16px}
.empty{color:var(--muted);text-align:center;padding:20px;font-size:12px}
.mono{font-size:11px}
.snippet{background:#161b22;padding:6px 10px;border-radius:4px;font-size:11px;white-space:pre-wrap;word-break:break-all;max-width:400px;overflow:hidden}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--panel);border:1px solid var(--border);margin-bottom:4px}
.toggle-label{font-size:12px;color:var(--bright)}
.toggle-desc{font-size:10px;color:var(--dim);margin-top:2px}
.switch{position:relative;width:36px;height:20px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#21262d;border:1px solid var(--border);border-radius:10px;transition:.2s}
.slider:before{position:absolute;content:"";height:14px;width:14px;left:2px;bottom:2px;background:var(--muted);border-radius:50%;transition:.2s}
.switch input:checked+.slider{background:#0a3d0a;border-color:var(--green)}
.switch input:checked+.slider:before{transform:translateX(16px);background:var(--green)}
.cfg-select{background:var(--panel);border:1px solid var(--border);color:var(--bright);padding:4px 8px;font-family:inherit;font-size:11px;cursor:pointer}
.cfg-input{background:var(--bg);border:1px solid var(--border);color:var(--bright);padding:6px 8px;font-family:inherit;font-size:11px;width:100%}
.cfg-textarea{background:var(--bg);border:1px solid var(--border);color:var(--bright);padding:6px 8px;font-family:inherit;font-size:11px;width:100%;resize:vertical}
.cfg-btn{padding:4px 14px;font-size:11px;cursor:pointer;font-family:inherit;border-radius:2px}
.cfg-btn.primary{color:#fff;background:#0a3d0a;border:1px solid var(--green)}
.cfg-btn.secondary{color:var(--dim);background:none;border:1px solid var(--border)}
.cfg-btn.danger{color:var(--red);background:none;border:1px solid #330000}
.setting-toggle{cursor:pointer;user-select:none}
.sect-arrow{display:inline-block;font-size:10px;color:var(--dim);transition:transform .15s;margin-right:4px}
.msg-bubble{padding:8px 12px;border-radius:4px;margin-bottom:4px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.msg-bubble.user{background:#0a1a2a;border:1px solid #1a3a5a}
.msg-bubble.assistant{background:#0a1a0a;border:1px solid #1a3a1a}
.msg-bubble.system{background:#1a1a0a;border:1px solid #3a3a1a}
.msg-role{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:3px;font-weight:700}
.msg-text{color:var(--bright)}
.audit-kv{display:flex;gap:6px;align-items:baseline;margin-bottom:2px;font-size:11px}
.audit-kv .k{color:var(--dim);min-width:80px}
.audit-kv .v{color:var(--bright)}
.timeline-card{margin-bottom:4px;cursor:pointer;transition:border-color .15s;padding:10px 12px}
.timeline-card:hover{border-color:var(--cyan)}
.pro-feature-row{cursor:pointer;transition:border-color .15s}
.pro-feature-row:hover{border-color:var(--cyan)}
.pro-feature-row.unlocked .toggle-label{color:var(--green)}
.filter-input{background:var(--bg);border:1px solid var(--border);color:var(--bright);padding:4px 10px;font-family:inherit;font-size:11px;width:280px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
</style>
</head>`;

// ── TITLEBAR ──────────────────────────────────────────────────────
const TITLEBAR = `
<div class="titlebar">
  <div class="titlebar-left">
    <h1>BASTION</h1>
    <span class="hdr-status" id="hdr-status">RUNNING &mdash; <span id="hdr-ver">v0.1.0</span> &mdash; <span id="hdr-uptime">0s</span></span>
  </div>
  <div class="titlebar-right">
    <select id="time-range" class="time-sel"><option value="24h">24H</option><option value="7d">7D</option><option value="30d">30D</option><option value="all">ALL</option></select>
    <span class="tab active" data-page="overview">OVERVIEW</span>
    <span class="tab" data-page="dlp">DLP</span>
    <span class="tab" data-page="guard">GUARD <span id="guard-badge" class="badge"></span></span>
    <span class="tab" data-page="log">LOG</span>
    <span class="tab" data-page="settings">SETTINGS</span>
  </div>
</div>`;

// ── PAGE: OVERVIEW ────────────────────────────────────────────────
const PAGE_OVERVIEW = `
<div class="page active" id="page-overview">
<div class="gauges" id="ov-gauges"></div>
<div class="panes">
  <div class="section">
    <div class="section-head"><span class="section-title">Alerts</span><span class="section-count" id="ov-alert-count"></span></div>
    <div class="section-body" id="ov-alerts"><div class="empty">No alerts</div></div>
  </div>
  <div class="section">
    <div class="section-head"><span class="section-title">Traffic</span></div>
    <div class="section-body" id="ov-traffic"></div>
  </div>
</div>
<div class="section">
  <div class="section-head"><span class="section-title">Request Log</span></div>
  <div class="section-body">
    <table><thead><tr><th>Time</th><th>Provider</th><th>Model</th><th>St</th><th>Tokens</th><th>Cost</th><th>Lat</th><th>Flags</th></tr></thead><tbody id="ov-recent"></tbody></table>
    <p class="empty" id="ov-no-requests">No requests yet.</p>
  </div>
</div>
</div>`;

// ── PAGE: DLP ─────────────────────────────────────────────────────
const PAGE_DLP = `
<div class="page" id="page-dlp">
<div class="gauges" id="dlp-gauges"></div>
<div class="section">
  <div class="section-head">
    <span class="section-title">Findings</span>
    <div style="display:flex;gap:6px">
      <select id="findings-action-filter" class="cfg-select"><option value="">All</option><option value="block">Block</option><option value="redact">Redact</option><option value="warn">Warn</option></select>
      <select id="findings-dir-filter" class="cfg-select"><option value="">All Dir</option><option value="request">Req</option><option value="response">Res</option></select>
    </div>
  </div>
  <div class="section-body">
    <table><thead><tr><th>Time</th><th>Dir</th><th>Req</th><th>Pattern</th><th>Cat</th><th>Action</th><th>#</th><th>Original</th><th>Redacted</th></tr></thead><tbody id="findings-list"></tbody></table>
    <p class="empty" id="no-findings">No DLP findings yet.</p>
  </div>
</div>
</div>`;

// ── PAGE: GUARD ───────────────────────────────────────────────────
const PAGE_GUARD = `
<div class="page" id="page-guard">
<div id="gd-alert-banner" style="display:none;background:#1a0000;border:1px solid var(--red);padding:8px 12px;margin-bottom:8px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div><span style="color:var(--red);font-weight:700;font-size:12px" id="gd-alert-title"></span><span style="color:var(--bright);font-size:11px;margin-left:8px" id="gd-alert-msg"></span></div>
    <button id="gd-ack-btn" class="cfg-btn danger">ACK</button>
  </div>
  <div id="gd-alert-list" style="margin-top:6px;font-size:11px;color:var(--dim);max-height:100px;overflow:auto"></div>
</div>
<div class="gauges" id="gd-gauges"></div>
<div class="panes">
  <div class="section">
    <div class="section-head"><span class="section-title">Events</span></div>
    <div class="section-body" id="gd-events"><div class="empty">No events</div></div>
  </div>
  <div class="section">
    <div class="section-head"><span class="section-title">Rules (top)</span></div>
    <div class="section-body" id="gd-rules"><div class="empty">No rules</div></div>
  </div>
</div>
</div>`;

// ── PAGE: LOG ─────────────────────────────────────────────────────
const PAGE_LOG = `
<div class="page" id="page-log">
<div class="section" id="log-sessions-section">
  <div class="section-head">
    <span class="section-title">Sessions</span>
    <div style="display:flex;gap:6px;align-items:center">
      <input id="log-session-search" type="text" class="filter-input" placeholder="Search session or request ID...">
      <button id="log-search-btn" class="cfg-btn secondary">Search</button>
      <button id="log-search-clear" class="cfg-btn secondary" style="display:none">Clear</button>
    </div>
  </div>
  <div class="section-body">
    <table><thead><tr><th>Time</th><th>Session</th><th>Project</th><th>Models</th><th>Reqs</th><th></th></tr></thead><tbody id="log-sessions"></tbody></table>
    <p class="empty" id="log-no-sessions">No audit entries. Enable audit logging in Settings.</p>
  </div>
</div>
<div id="log-timeline" style="display:none">
  <div class="section">
    <div class="section-head">
      <span class="section-title">Timeline <span id="log-timeline-label" style="font-weight:400;color:var(--dim);text-transform:none;letter-spacing:0"></span></span>
      <button id="log-back-sessions" class="cfg-btn secondary">Back</button>
    </div>
    <div class="section-body" id="log-timeline-content"></div>
  </div>
</div>
<div id="log-detail" style="display:none">
  <div class="section">
    <div class="section-head">
      <span class="section-title">Request Detail</span>
      <div style="display:flex;gap:6px">
        <button id="log-back-timeline" class="cfg-btn secondary">Back</button>
        <button class="log-view-tab cfg-btn primary" data-view="parsed">Parsed</button>
        <button class="log-view-tab cfg-btn secondary" data-view="raw">Raw</button>
      </div>
    </div>
    <div class="section-body" style="padding:12px">
      <div id="log-parsed">
        <div id="log-detail-meta" class="gauges" style="margin-bottom:12px"></div>
        <div id="log-detail-tg" style="display:none;margin-bottom:12px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><div style="font-size:10px;color:var(--cyan);font-weight:700;margin-bottom:4px">REQUEST</div><div id="log-detail-messages" style="max-height:500px;overflow:auto"></div></div>
          <div><div style="font-size:10px;color:var(--green);font-weight:700;margin-bottom:4px">RESPONSE</div><div id="log-detail-output" style="max-height:500px;overflow:auto"></div></div>
        </div>
      </div>
      <div id="log-raw" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><div style="font-size:10px;color:var(--cyan);font-weight:700;margin-bottom:4px">REQUEST</div><pre class="snippet" id="log-raw-req" style="max-height:500px;overflow:auto"></pre></div>
          <div><div style="font-size:10px;color:var(--green);font-weight:700;margin-bottom:4px">RESPONSE</div><pre class="snippet" id="log-raw-res" style="max-height:500px;overflow:auto"></pre></div>
        </div>
      </div>
    </div>
  </div>
</div>
<!-- Optimizer (collapsible) -->
<div class="section" style="margin-top:8px">
  <div class="section-head setting-toggle" id="opt-toggle"><span class="section-title"><span class="sect-arrow">&#9656;</span> OPTIMIZER</span></div>
  <div class="section-body" id="opt-body" style="display:none;padding:12px">
    <div class="gauges" id="opt-gauges" style="margin-bottom:12px"></div>
    <table><thead><tr><th>Time</th><th>Type</th><th>Original</th><th>Trimmed</th><th>Chars</th><th>Tokens</th></tr></thead><tbody id="opt-recent"></tbody></table>
    <p class="empty" id="opt-no-events">No optimizer events yet.</p>
  </div>
</div>
</div>`;

// ── PAGE: SETTINGS ────────────────────────────────────────────────
const PAGE_SETTINGS = `
<div class="page" id="page-settings">

<!-- 1. Plugins -->
<div class="section"><div class="section-head setting-toggle" data-target="set-plugins"><span class="section-title"><span class="sect-arrow">&#9662;</span> PLUGINS</span></div>
<div class="section-body" id="set-plugins" style="padding:12px"><div id="plugin-toggles"></div></div></div>

<!-- 2. Pro Features (dev-only) -->
<div class="section" id="sec-pro" style="display:none"><div class="section-head setting-toggle" data-target="set-pro"><span class="section-title"><span class="sect-arrow">&#9656;</span> PRO FEATURES</span></div>
<div class="section-body" id="set-pro" style="display:none;padding:12px">
  <div id="pro-features">
    <div class="toggle-row pro-feature-row" data-pro-feature="ai-injection"><div><div class="toggle-label">AI Injection Detection</div><div class="toggle-desc">Multi-layer AI-driven prompt injection detection</div></div><span class="row-tag" style="background:#1a1a1a;color:var(--dim)">PRO</span></div>
    <div class="toggle-row pro-feature-row" data-pro-feature="budget"><div><div class="toggle-label">Budget Control</div><div class="toggle-desc">Per-session/user/project usage and cost budgets</div></div><span class="row-tag" style="background:#1a1a1a;color:var(--dim)">PRO</span></div>
    <div class="toggle-row pro-feature-row" data-pro-feature="ratelimit"><div><div class="toggle-label">Rate Limiting</div><div class="toggle-desc">Configurable rate limiting by API key, session, or global</div></div><span class="row-tag" style="background:#1a1a1a;color:var(--dim)">PRO</span></div>
  </div>
  <div id="pro-detail" style="display:none;margin-top:12px;padding:16px;background:var(--bg);border:1px solid var(--border);text-align:center">
    <div id="pro-detail-title" style="color:var(--bright);font-size:13px;font-weight:700;margin-bottom:6px"></div>
    <div id="pro-detail-desc" style="color:var(--dim);font-size:12px;max-width:480px;margin:0 auto 12px"></div>
    <div id="pro-detail-unlocked" style="display:none;color:var(--green);font-size:12px">Feature enabled.</div>
    <div id="pro-detail-locked">
      <a style="display:inline-block;padding:6px 20px;background:#0a3d0a;color:var(--green);border:1px solid var(--green);font-size:12px;text-decoration:none;font-family:inherit" href="https://bastion.dev/pro" target="_blank">Upgrade to Pro</a>
      <div class="pro-license-input" id="pro-detail-license" style="display:none;margin-top:12px">
        <input type="text" class="cfg-input" style="width:240px;display:inline-block" placeholder="License key" id="pro-license-key">
        <button class="cfg-btn primary" onclick="activateLicense('pro-license-key')">Activate</button>
      </div>
    </div>
  </div>
</div></div>

<!-- 3. DLP Configuration -->
<div class="section"><div class="section-head setting-toggle" data-target="set-dlp-config"><span class="section-title"><span class="sect-arrow">&#9656;</span> DLP CONFIGURATION</span></div>
<div class="section-body" id="set-dlp-config" style="display:none;padding:12px">
  <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px">
    <span id="dlp-dirty" style="display:none;color:var(--yellow);font-size:11px">&#9679; Unsaved</span>
    <button id="dlp-revert-btn" class="cfg-btn secondary" style="display:none">Revert</button>
    <button id="dlp-apply-btn" class="cfg-btn primary" style="display:none">Apply</button>
  </div>
  <div class="toggle-row"><div><div class="toggle-label">DLP Engine</div><div class="toggle-desc">Enable or disable DLP scanning</div></div><label class="switch"><input type="checkbox" id="dlp-cfg-enabled"><span class="slider"></span></label></div>
  <div class="toggle-row"><div><div class="toggle-label">Action Mode</div><div class="toggle-desc">What to do when sensitive data is detected</div></div><select class="cfg-select" id="dlp-cfg-action"><option value="pass">Pass</option><option value="warn">Warn</option><option value="redact">Redact</option><option value="block">Block</option></select></div>
  <div class="toggle-row"><div><div class="toggle-label">AI Validation <span id="dlp-ai-status" style="font-size:10px;margin-left:4px"></span></div><div class="toggle-desc">Use LLM to verify DLP matches</div></div><label class="switch"><input type="checkbox" id="dlp-cfg-ai"><span class="slider"></span></label></div>
  <div style="margin-top:8px;padding:10px 12px;background:var(--bg);border:1px solid var(--border)">
    <div class="toggle-label" style="margin-bottom:8px">Semantic Detection (Layer 3)</div>
    <div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">Built-in Sensitive Patterns <span style="color:var(--muted)">(read-only)</span></div><div id="dlp-builtin-sensitive" style="display:flex;flex-wrap:wrap;gap:4px"></div></div>
    <div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">Extra Sensitive Patterns</div><textarea id="dlp-cfg-sensitive" class="cfg-textarea" rows="2" placeholder="regex, one per line"></textarea></div>
    <div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">Built-in Non-sensitive Names <span style="color:var(--muted)">(read-only)</span></div><div id="dlp-builtin-nonsensitive" style="display:flex;flex-wrap:wrap;gap:4px"></div></div>
    <div><div style="font-size:10px;color:var(--dim);margin-bottom:4px">Extra Non-sensitive Names</div><textarea id="dlp-cfg-nonsensitive" class="cfg-textarea" rows="2" placeholder="one per line"></textarea></div>
  </div>
  <div style="margin-top:8px">
    <div class="section-head setting-toggle" id="dlp-history-toggle" style="background:var(--bg)"><span class="section-title"><span class="sect-arrow">&#9656;</span> Change History <span id="dlp-history-count" style="font-size:10px;color:var(--muted)"></span></span></div>
    <div id="dlp-history-list" style="display:none"><table><thead><tr><th>Time</th><th>Action</th><th>AI</th><th>Sensitive</th><th>Non-sensitive</th><th></th></tr></thead><tbody id="dlp-history-body"></tbody></table><p class="empty" id="no-history">No changes.</p></div>
  </div>
</div></div>

<!-- 4. DLP Patterns -->
<div class="section"><div class="section-head setting-toggle" data-target="set-dlp-patterns"><span class="section-title"><span class="sect-arrow">&#9656;</span> DLP PATTERNS</span></div>
<div class="section-body" id="set-dlp-patterns" style="display:none;padding:12px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <div style="display:flex;gap:8px;align-items:center">
      <select id="dlp-cat-filter" class="cfg-select"><option value="">All categories</option></select>
      <span id="dlp-pat-count" style="font-size:10px;color:var(--dim)"></span>
    </div>
    <button id="dlp-add-btn" class="cfg-btn" style="color:var(--green);border:1px solid var(--green)">+ Add</button>
  </div>
  <div id="dlp-add-form" style="display:none;margin-bottom:12px;padding:12px;background:var(--bg);border:1px solid var(--border)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
      <input id="dlp-new-name" class="cfg-input" placeholder="Name">
      <input id="dlp-new-regex" class="cfg-input" placeholder="Regex">
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:6px;margin-bottom:6px">
      <input id="dlp-new-desc" class="cfg-input" placeholder="Description">
      <input id="dlp-new-context" class="cfg-input" placeholder="Context words (csv)">
    </div>
    <div style="display:flex;gap:6px;align-items:center"><button id="dlp-save-btn" class="cfg-btn primary">Save</button><button id="dlp-cancel-btn" class="cfg-btn secondary">Cancel</button><span id="dlp-form-error" style="color:var(--red);font-size:11px"></span></div>
  </div>
  <table><thead><tr><th style="width:50px">On</th><th>Name</th><th>Category</th><th>Regex</th><th>Description</th><th style="width:50px"></th></tr></thead><tbody id="dlp-patterns"></tbody></table>
  <p class="empty" id="no-patterns">No patterns.</p>
</div></div>

<!-- 5. DLP Signatures -->
<div class="section"><div class="section-head setting-toggle" data-target="set-dlp-sig"><span class="section-title"><span class="sect-arrow">&#9656;</span> DLP SIGNATURES</span></div>
<div class="section-body" id="set-dlp-sig" style="display:none;padding:12px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:8px"><span id="sig-badge" style="display:none;font-size:10px;padding:1px 6px;background:var(--border);color:var(--dim)"></span><span id="sig-update" style="display:none;font-size:10px;padding:1px 6px;background:#1a1a00;color:var(--yellow);cursor:pointer"></span></div>
    <div style="display:flex;gap:6px;align-items:center">
      <span style="font-size:11px;color:var(--dim)">Auto-sync</span>
      <label class="switch"><input type="checkbox" id="sig-auto-sync"><span class="slider"></span></label>
      <button id="sig-check-btn" class="cfg-btn secondary">Check</button>
      <button id="sig-sync-btn" class="cfg-btn" style="color:var(--cyan);border:1px solid #003344">Sync Now</button>
    </div>
  </div>
  <div id="sig-status" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
    <div style="padding:8px 12px;background:var(--bg);border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Version</div><div id="sig-ver" style="font-size:14px;font-weight:700;color:var(--bright)">-</div></div>
    <div style="padding:8px 12px;background:var(--bg);border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Patterns</div><div id="sig-count" style="font-size:14px;font-weight:700;color:var(--bright)">-</div></div>
    <div style="padding:8px 12px;background:var(--bg);border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Branch</div><div id="sig-branch" style="font-size:14px;font-weight:700;color:var(--bright)">-</div></div>
    <div style="padding:8px 12px;background:var(--bg);border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);margin-bottom:2px">Last Synced</div><div id="sig-synced" style="font-size:12px;font-weight:500;color:var(--bright)">-</div></div>
  </div>
  <div id="sig-not-synced" style="display:none;padding:10px;text-align:center;color:var(--dim);font-size:11px;background:var(--bg);border:1px solid var(--border)">Not synced yet. Click Sync Now.</div>
  <div style="margin-top:8px">
    <div style="cursor:pointer;display:flex;align-items:center;gap:4px" id="sig-log-toggle"><span id="sig-log-arrow" class="sect-arrow">&#9656;</span><span style="font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:1px">Sync Log</span><span id="sig-log-count" style="font-size:10px;color:var(--dim)"></span></div>
    <div id="sig-log-body" style="display:none;margin-top:6px;max-height:200px;overflow-y:auto"><div id="sig-log-entries" style="font-size:10px;line-height:1.7;color:var(--dim)"></div><p class="empty" id="sig-log-empty">No sync log.</p></div>
  </div>
</div></div>

<!-- 6. Tool Guard Configuration -->
<div class="section"><div class="section-head setting-toggle" data-target="set-tg-config"><span class="section-title"><span class="sect-arrow">&#9656;</span> TOOL GUARD CONFIGURATION</span></div>
<div class="section-body" id="set-tg-config" style="display:none;padding:12px">
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--dim)">Action</span><select id="tg-action-select" class="cfg-select"><option value="audit">Audit</option><option value="block">Block</option></select></div>
    <div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--dim)">Block Min</span><select id="tg-block-severity" class="cfg-select"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
    <div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--dim)">Alert Min</span><select id="tg-alert-severity" class="cfg-select"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
    <div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--dim)">Record All</span><label class="switch"><input type="checkbox" id="tg-record-all"><span class="slider"></span></label></div>
    <span id="tg-cfg-status" style="font-size:11px;color:var(--green);display:none">Saved!</span>
  </div>
</div></div>

<!-- 7. Tool Guard Rules -->
<div class="section"><div class="section-head setting-toggle" data-target="set-tg-rules"><span class="section-title"><span class="sect-arrow">&#9656;</span> TOOL GUARD RULES</span></div>
<div class="section-body" id="set-tg-rules" style="display:none;padding:12px">
  <div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button id="tg-add-rule-btn" class="cfg-btn primary">+ Add Rule</button></div>
  <div id="tg-rule-form" style="display:none;background:var(--bg);border:1px solid var(--border);padding:12px;margin-bottom:12px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
      <div><label style="font-size:10px;color:var(--dim)">Name *</label><input id="tgr-name" class="cfg-input"></div>
      <div><label style="font-size:10px;color:var(--dim)">Category</label><input id="tgr-category" class="cfg-input" value="custom"></div>
    </div>
    <div style="margin-bottom:6px"><label style="font-size:10px;color:var(--dim)">Description</label><input id="tgr-description" class="cfg-input"></div>
    <div style="display:grid;grid-template-columns:3fr 1fr;gap:6px;margin-bottom:6px">
      <div><label style="font-size:10px;color:var(--dim)">Input Pattern *</label><input id="tgr-input-pattern" class="cfg-input"></div>
      <div><label style="font-size:10px;color:var(--dim)">Flags</label><input id="tgr-input-flags" class="cfg-input" value="i"></div>
    </div>
    <div style="display:grid;grid-template-columns:3fr 1fr 1fr;gap:6px;margin-bottom:8px">
      <div><label style="font-size:10px;color:var(--dim)">Tool Pattern</label><input id="tgr-tool-pattern" class="cfg-input"></div>
      <div><label style="font-size:10px;color:var(--dim)">Tool Flags</label><input id="tgr-tool-flags" class="cfg-input"></div>
      <div><label style="font-size:10px;color:var(--dim)">Severity</label><select id="tgr-severity" class="cfg-select" style="width:100%"><option value="critical">Critical</option><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select></div>
    </div>
    <div style="display:flex;gap:6px;align-items:center"><button id="tgr-save" class="cfg-btn primary">Save</button><button id="tgr-cancel" class="cfg-btn secondary">Cancel</button><span id="tgr-error" style="color:var(--red);font-size:11px;display:none"></span></div>
  </div>
  <table><thead><tr><th style="width:40px">On</th><th>Name</th><th>Severity</th><th>Category</th><th>Pattern</th><th>Type</th><th style="width:50px"></th></tr></thead><tbody id="tg-rules-table"></tbody></table>
  <p class="empty" id="no-tg-rules" style="display:none">No rules.</p>
</div></div>

<!-- 8. Data Retention -->
<div class="section"><div class="section-head setting-toggle" data-target="set-retention"><span class="section-title"><span class="sect-arrow">&#9656;</span> DATA RETENTION</span></div>
<div class="section-body" id="set-retention" style="display:none;padding:12px">
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">
    <div class="toggle-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:8px"><div class="toggle-label" style="font-size:11px">Requests (h)</div><input type="number" id="ret-requests" min="1" class="cfg-input"></div>
    <div class="toggle-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:8px"><div class="toggle-label" style="font-size:11px">DLP Events (h)</div><input type="number" id="ret-dlp" min="1" class="cfg-input"></div>
    <div class="toggle-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:8px"><div class="toggle-label" style="font-size:11px">Tool Calls (h)</div><input type="number" id="ret-tools" min="1" class="cfg-input"></div>
    <div class="toggle-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:8px"><div class="toggle-label" style="font-size:11px">Optimizer (h)</div><input type="number" id="ret-optimizer" min="1" class="cfg-input"></div>
    <div class="toggle-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:8px"><div class="toggle-label" style="font-size:11px">Sessions (h)</div><input type="number" id="ret-sessions" min="1" class="cfg-input"></div>
    <div class="toggle-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:8px"><div class="toggle-label" style="font-size:11px">Audit Log (h)</div><input type="number" id="ret-audit" min="1" class="cfg-input"></div>
    <div class="toggle-row" style="flex-direction:column;align-items:flex-start;gap:4px;padding:8px"><div class="toggle-label" style="font-size:11px">Plugin Events (h)</div><input type="number" id="ret-plugin-events" min="1" class="cfg-input"></div>
  </div>
  <div style="display:flex;gap:8px;align-items:center"><button id="ret-save-btn" class="cfg-btn primary">Save</button><span id="ret-status" style="font-size:11px;color:var(--green);display:none">Saved!</span></div>
</div></div>

<!-- 9. Security Pipeline -->
<div class="section"><div class="section-head setting-toggle" data-target="set-pipeline"><span class="section-title"><span class="sect-arrow">&#9656;</span> SECURITY PIPELINE</span></div>
<div class="section-body" id="set-pipeline" style="display:none;padding:12px">
  <div style="display:flex;gap:12px;align-items:center">
    <span style="font-size:11px;color:var(--dim)">Fail Mode</span>
    <select id="fail-mode-select" class="cfg-select"><option value="open">Open (skip failed)</option><option value="closed">Closed (reject on failure)</option></select>
    <span id="fail-mode-status" style="font-size:11px;color:var(--green);display:none">Saved!</span>
  </div>
</div></div>

<!-- 10. Debug Scanner -->
<div class="section"><div class="section-head setting-toggle" data-target="set-debug"><span class="section-title"><span class="sect-arrow">&#9656;</span> DEBUG SCANNER</span></div>
<div class="section-body" id="set-debug" style="display:none;padding:12px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <span style="font-size:10px;color:var(--dim);align-self:center;margin-right:4px">Presets:</span>
      <button class="scan-preset cfg-btn secondary" data-preset="clean">Clean</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--red)" data-preset="aws">AWS</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--red)" data-preset="github">GitHub</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--red)" data-preset="openai">OpenAI</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--red)" data-preset="pem">PEM</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--red)" data-preset="password">Pass</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--yellow)" data-preset="cc">CC</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--yellow)" data-preset="ssn">SSN</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--cyan)" data-preset="email">Email</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--purple)" data-preset="multi">Multi</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--purple)" data-preset="json-secret">JSON</button>
      <button class="scan-preset cfg-btn secondary" style="color:var(--purple)" data-preset="llm-body">LLM</button>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <select id="scan-action" class="cfg-select"><option value="block">Block</option><option value="redact">Redact</option><option value="warn">Warn</option></select>
      <label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--dim);cursor:pointer"><input type="checkbox" id="scan-trace"> Trace</label>
      <button id="scan-btn" class="cfg-btn primary">Scan</button>
    </div>
  </div>
  <textarea id="scan-input" class="cfg-textarea" rows="6" placeholder="Paste or type text to scan..."></textarea>
  <div id="scan-result" style="display:none;margin-top:12px">
    <div class="gauges" id="scan-result-cards" style="margin-bottom:12px"></div>
    <div class="section" id="scan-findings-section" style="display:none"><div class="section-head"><span class="section-title">Findings</span></div><div class="section-body"><table><thead><tr><th>Pattern</th><th>Category</th><th>Matches</th><th>Values</th></tr></thead><tbody id="scan-findings-body"></tbody></table></div></div>
    <div id="scan-diff-section" style="display:none;margin-top:8px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div style="padding:10px 12px;background:var(--panel);border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">ORIGINAL</div><pre id="scan-original" style="white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--bright);max-height:300px;overflow:auto"></pre></div>
      <div style="padding:10px 12px;background:var(--panel);border:1px solid var(--border)"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">REDACTED</div><pre id="scan-redacted" style="white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--bright);max-height:300px;overflow:auto"></pre></div>
    </div></div>
    <div id="scan-trace-section" style="display:none;margin-top:8px"><div style="font-size:10px;color:var(--dim);margin-bottom:4px">TRACE LOG</div><div id="scan-trace-log" style="background:var(--bg);border:1px solid var(--border);padding:10px;font-size:10px;line-height:1.7;max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-all"></div></div>
  </div>
</div></div>

</div>`;

// ── FOOTER ────────────────────────────────────────────────────────
const FOOTER = `<div class="footer">BASTION AI GATEWAY &mdash; local-first security proxy</div>`;

// ── SCRIPT (placeholder - assembled below) ────────────────────────
const SCRIPT = `<script>
// ══ 1. UTILITIES ══════════════════════════════════════════════════
var _authToken=localStorage.getItem('bastion_token')||'';
function apiFetch(url,opts){
  opts=opts||{};
  if(_authToken){opts.headers=Object.assign(opts.headers||{},{'Authorization':'Bearer '+_authToken});}
  return fetch(url,opts);
}
var _lastJson={};
function skipIfSame(id,json){var s=JSON.stringify(json);if(_lastJson[id]===s)return true;_lastJson[id]=s;return false}
function fmt(n){return n==null?'0':n.toLocaleString()}
function cost(n){return n<0.01?'$'+n.toFixed(6):'$'+n.toFixed(4)}
function bytes(n){if(n<1024)return n+'B';if(n<1048576)return(n/1024).toFixed(1)+'KB';return(n/1048576).toFixed(1)+'MB'}
function ago(ts){
  var d=new Date(/[Z+]/.test(ts)?ts:ts+'Z'),now=new Date(),s=Math.floor((now-d)/1000);
  if(isNaN(s)||s<0)return '?';
  if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';
}
function uptimeFmt(s){
  if(s<60)return Math.round(s)+'s';if(s<3600)return Math.round(s/60)+'m';
  return Math.round(s/3600)+'h '+Math.round((s%3600)/60)+'m';
}
function esc(s){if(!s)return'';var d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function tryPrettyJson(s){try{return JSON.stringify(JSON.parse(s),null,2)}catch(e){return s||''}}

var timeRange='24h';
function hoursForRange(r){return r==='24h'?24:r==='7d'?168:r==='30d'?720:0}
function sinceParam(){var h=hoursForRange(timeRange);return h?'hours='+h:'';}
document.getElementById('time-range').addEventListener('change',function(){
  timeRange=this.value;_lastJson={};refreshActivePage();
});

// ══ 2. TAB MANAGEMENT ═════════════════════════════════════════════
var activePage='overview';
function showPage(name){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  var pageEl=document.getElementById('page-'+name);
  if(pageEl)pageEl.classList.add('active');
  var tabs=document.querySelectorAll('.tab');
  tabs.forEach(function(t){if(t.dataset.page===name)t.classList.add('active')});
  activePage=name;
  refreshActivePage();
}
function refreshActivePage(){
  if(activePage==='overview')refreshOverview();
  else if(activePage==='dlp')refreshDlp();
  else if(activePage==='guard')refreshGuard();
  else if(activePage==='log')refreshLog();
  else if(activePage==='settings')refreshSettings();
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click',function(){showPage(t.dataset.page)});
});
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
  if(e.key==='1')showPage('overview');
  else if(e.key==='2')showPage('dlp');
  else if(e.key==='3')showPage('guard');
  else if(e.key==='4')showPage('log');
  else if(e.key==='5')showPage('settings');
});

// ══ 3. RENDER HELPERS ═════════════════════════════════════════════
function gauge(label,value,sub,cls,barPct,barColor){
  return '<div class="gauge"><div class="gauge-label">'+esc(label)+'</div>'+
    '<div class="gauge-value'+(cls?' '+cls:'')+'">'+value+'</div>'+
    (sub?'<div class="gauge-sub">'+sub+'</div>':'')+
    (barPct!=null?'<div class="gauge-bar"><div class="gauge-bar-fill" style="width:'+Math.min(100,Math.max(0,barPct))+'%;background:'+(barColor||'#555')+'"></div></div>':'')+
    '</div>';
}
function provTag(p){
  var colors={anthropic:'#aa66ff',openai:'#00ff88',gemini:'#ffcc00',telegram:'#00ccff',slack:'#ffcc00'};
  return '<span style="color:'+(colors[p]||'#888')+'">'+esc(p)+'</span>';
}
function dlpActionTag(a){
  if(a==='block')return '<span class="row-tag block">BLOCK</span>';
  if(a==='redact')return '<span class="row-tag redact">REDACT</span>';
  if(a==='warn')return '<span class="row-tag warn">WARN</span>';
  if(a==='pass')return '<span class="row-tag audit">PASS</span>';
  return '<span class="row-tag">'+esc(a||'-')+'</span>';
}
function severityTag(s){
  if(!s)return '<span class="row-tag" style="background:#1a1a1a;color:#444">none</span>';
  var colors={critical:'background:#330000;color:#ff4444',high:'background:#1a1a00;color:#ffcc00',medium:'background:#1a1a00;color:#888',low:'background:#001a1a;color:#00ccff',info:'background:#0a1a0a;color:#00ff88'};
  return '<span class="row-tag" style="'+(colors[s]||'')+'">'+esc(s)+'</span>';
}
function actionTag(a){
  if(!a||a==='pass')return '<span class="row-tag audit">pass</span>';
  if(a==='block')return '<span class="row-tag block">block</span>';
  if(a==='flag')return '<span class="row-tag warn">flag</span>';
  return '<span class="row-tag">'+esc(a)+'</span>';
}

// ══ 4. PAGE: OVERVIEW ═════════════════════════════════════════════
async function refreshOverview(){
  try{
    var sp=sinceParam();
    var qp=sp?'?'+sp:'';
    var [statsR,alertsR,dlpRecentR]=await Promise.all([
      apiFetch('/api/stats'+qp),
      apiFetch('/api/tool-guard/alerts'),
      apiFetch('/api/dlp/recent?limit=5'+(sp?'&'+sp:''))
    ]);
    var statsData=await statsR.json();
    var alertsData=await alertsR.json();
    var dlpRecent=await dlpRecentR.json();
    var s=statsData.stats;
    var dlp=statsData.dlp||{};
    var ba=dlp.by_action||{};

    // Gauges
    if(!skipIfSame('ov-gauges',{s:s,dlp:dlp})){
      var dlpTotal=dlp.total_events||0;
      var latAvg=s.avg_latency_ms||0;
      document.getElementById('ov-gauges').innerHTML=
        gauge('Requests',fmt(s.total_requests),'','')+
        gauge('Cost',cost(s.total_cost_usd),'','green')+
        gauge('Tokens',fmt(s.total_input_tokens+s.total_output_tokens),fmt(s.total_input_tokens)+' in / '+fmt(s.total_output_tokens)+' out','')+
        gauge('DLP Hits',fmt(dlpTotal),(ba.redact||0)+' redact, '+(ba.block||0)+' block',dlpTotal>0?'red':'')+
        gauge('Avg Latency',Math.round(latAvg)+'ms','','cyan');
    }

    // Alerts pane (combine DLP + Guard)
    var combined=[];
    (dlpRecent||[]).forEach(function(d){
      combined.push({type:'dlp',time:d.created_at,text:'<b>'+esc(d.pattern_name)+'</b> \\u2192 '+esc(d.action),tag:'dlp'});
    });
    (alertsData.alerts||[]).filter(function(a){return !a.acknowledged}).slice(0,5).forEach(function(a){
      combined.push({type:'guard',time:a.timestamp,text:'<b>'+esc(a.toolName)+'</b> \\u2192 '+esc(a.ruleName),tag:'guard'});
    });
    combined.sort(function(a,b){return new Date(b.time)-new Date(a.time)});
    var alertCount=(alertsData.unacknowledged||0)+(dlpRecent||[]).length;
    document.getElementById('ov-alert-count').textContent=alertCount||'';
    if(!skipIfSame('ov-alerts',combined)){
      document.getElementById('ov-alerts').innerHTML=combined.length?combined.slice(0,8).map(function(c){
        return '<div class="row"><span class="row-icon" style="color:#ff4444">!</span>'+
          '<span class="row-tag '+c.tag+'">'+c.type.toUpperCase()+'</span>'+
          '<span class="row-text">'+c.text+'</span>'+
          '<span class="row-time">'+ago(c.time)+'</span></div>';
      }).join(''):'<div class="empty">No alerts</div>';
    }

    // Traffic pane
    var providers=Object.entries(s.by_provider||{});
    var models=Object.entries(s.by_model||{});
    if(!skipIfSame('ov-traffic',{providers:providers,models:models})){
      var maxProv=Math.max.apply(null,providers.map(function(p){return p[1].requests}).concat([1]));
      var maxModel=Math.max.apply(null,models.map(function(m){return m[1].requests}).concat([1]));
      var provColors={anthropic:'purple',openai:'green',gemini:'yellow',telegram:'cyan',slack:'yellow'};
      var tHtml=providers.map(function(p){
        var pct=Math.round(p[1].requests/maxProv*100);
        var clr=provColors[p[0]]||'green';
        return '<div class="prov-row"><span class="prov-name">'+esc(p[0])+'</span><div class="prov-bar"><div class="prov-bar-fill '+clr+'" style="width:'+pct+'%"></div></div><span class="prov-pct">'+fmt(p[1].requests)+'</span></div>';
      }).join('');
      if(models.length>0){
        tHtml+='<div style="height:4px"></div>';
        tHtml+=models.map(function(m){
          var pct=Math.round(m[1].requests/maxModel*100);
          return '<div class="prov-row"><span class="prov-name" style="color:#555">'+esc(m[0].length>12?m[0].slice(0,12)+'..':m[0])+'</span><div class="prov-bar"><div class="prov-bar-fill purple" style="width:'+pct+'%"></div></div><span class="prov-pct">'+fmt(m[1].requests)+'</span></div>';
        }).join('');
      }
      document.getElementById('ov-traffic').innerHTML=tHtml||'<div class="empty">No traffic</div>';
    }

    // Request log
    var recent=statsData.recent||[];
    document.getElementById('ov-no-requests').style.display=recent.length?'none':'';
    if(!skipIfSame('ov-recent',recent)){
      document.getElementById('ov-recent').innerHTML=recent.map(function(r){
        var flags='';
        if(r.cached)flags+='<span class="row-tag audit">CACHED</span> ';
        if(r.dlp_action&&r.dlp_action!=='pass')flags+=dlpActionTag(r.dlp_action)+' ';
        var stCls=r.status_code>=400?'s403':'s200';
        return '<tr><td>'+ago(r.created_at)+'</td><td>'+provTag(r.provider)+'</td>'+
          '<td class="mono">'+esc(r.model)+'</td><td class="'+stCls+'">'+(r.status_code||'-')+'</td>'+
          '<td class="mono">'+fmt(r.input_tokens)+'/'+fmt(r.output_tokens)+'</td>'+
          '<td class="cost-c">'+cost(r.cost_usd)+'</td><td>'+r.latency_ms+'ms</td><td>'+flags+'</td></tr>';
      }).join('');
    }

    // Header status
    if(statsData.version)document.getElementById('hdr-ver').textContent='v'+statsData.version;
    document.getElementById('hdr-uptime').textContent=uptimeFmt(statsData.uptime||0);
  }catch(e){console.error('Overview refresh error',e)}
}

// ══ 5. PAGE: DLP ══════════════════════════════════════════════════
var findingsAll=[];
async function refreshDlp(){
  try{
    var sp=sinceParam();
    var [statsR,recentR]=await Promise.all([
      apiFetch('/api/stats'+(sp?'?'+sp:'')),
      apiFetch('/api/dlp/recent?limit=200'+(sp?'&'+sp:''))
    ]);
    var statsData=await statsR.json();
    var dlp=statsData.dlp||{};
    var ba=dlp.by_action||{};
    var newFindings=await recentR.json();

    if(!skipIfSame('dlp-gauges',dlp)){
      document.getElementById('dlp-gauges').innerHTML=
        gauge('Findings',fmt(dlp.total_events),'','red')+
        gauge('Redacted',fmt(ba.redact||0),'','yellow')+
        gauge('Blocked',fmt(ba.block||0),'','red')+
        gauge('Warned',fmt(ba.warn||0),'','')+
        gauge('Scans',fmt(dlp.total_events),'','');
    }

    if(!skipIfSame('findings-list',newFindings)){
      findingsAll=newFindings;
      renderFindings();
    }
  }catch(e){console.error('DLP refresh error',e)}
}

function renderFindings(){
  var af=document.getElementById('findings-action-filter').value;
  var df=document.getElementById('findings-dir-filter').value;
  var list=findingsAll;
  if(af)list=list.filter(function(e){return e.action===af});
  if(df)list=list.filter(function(e){return(e.direction||'request')===df});
  document.getElementById('no-findings').style.display=list.length?'none':'';
  document.getElementById('findings-list').innerHTML=list.map(function(e){
    var dir=e.direction||'request';
    var dirTag=dir==='response'?'<span class="row-tag warn">res</span>':'<span class="row-tag guard">req</span>';
    var rid=e.request_id||'';
    var reqCell='<span class="findings-expand" data-rid="'+esc(rid)+'" style="cursor:pointer;color:#00ccff;font-size:10px">'+esc(rid.slice(0,8))+'...</span>';
    return '<tr><td>'+ago(e.created_at)+'</td><td>'+dirTag+'</td><td>'+reqCell+'</td><td class="mono">'+esc(e.pattern_name)+'</td><td>'+esc(e.pattern_category)+'</td>'+
      '<td>'+dlpActionTag(e.action)+'</td><td>'+e.match_count+'</td>'+
      '<td><div class="snippet">'+esc(e.original_snippet||'-')+'</div></td>'+
      '<td><div class="snippet">'+esc(e.redacted_snippet||'-')+'</div></td></tr>';
  }).join('');
}
document.getElementById('findings-action-filter').addEventListener('change',renderFindings);
document.getElementById('findings-dir-filter').addEventListener('change',renderFindings);

// Findings expand — inline audit
document.getElementById('findings-list').addEventListener('click',async function(e){
  var el=e.target.closest('.findings-expand');
  if(!el)return;
  var rid=el.dataset.rid;if(!rid)return;
  var parentRow=el.closest('tr');
  var existing=parentRow.nextElementSibling;
  if(existing&&existing.classList.contains('findings-audit-row')){existing.remove();return;}
  document.querySelectorAll('.findings-audit-row').forEach(function(r){r.remove()});
  var detailRow=document.createElement('tr');
  detailRow.className='findings-audit-row';
  var td=document.createElement('td');td.colSpan=9;td.style.cssText='padding:0;border:none';
  td.innerHTML='<div style="margin:4px 12px 12px;padding:12px;background:#0c0c0c;border:1px solid #1a1a1a"><span style="color:#555">Loading...</span></div>';
  detailRow.appendChild(td);parentRow.after(detailRow);
  try{
    var r=await apiFetch('/api/audit/'+rid+'?dlp=true');
    var data=await r.json();
    td.innerHTML=renderInlineAudit(data,rid);
  }catch(ex){td.innerHTML='<div style="margin:4px 12px;padding:12px;background:#0c0c0c;border:1px solid #1a1a1a;color:#ff4444">Failed to load</div>'}
});

// ══ 6. PAGE: GUARD ════════════════════════════════════════════════
async function refreshGuard(){
  try{
    var sp=sinceParam();
    var [statsR,recentR,rulesR,alertsR]=await Promise.all([
      apiFetch('/api/tool-guard/stats'),
      apiFetch('/api/tool-guard/recent?limit=50'+(sp?'&'+sp:'')),
      apiFetch('/api/tool-guard/rules'),
      apiFetch('/api/tool-guard/alerts')
    ]);
    var stats=await statsR.json();
    var recent=await recentR.json();
    var rules=await rulesR.json();
    var alertsData=await alertsR.json();

    // Alert banner
    var unack=alertsData.unacknowledged||0;
    var banner=document.getElementById('gd-alert-banner');
    if(unack>0){
      banner.style.display='block';
      document.getElementById('gd-alert-title').textContent=unack+' unacknowledged alert'+(unack>1?'s':'');
      var recentAlerts=alertsData.alerts.filter(function(a){return !a.acknowledged}).slice(0,5);
      document.getElementById('gd-alert-msg').textContent=recentAlerts.length>0?recentAlerts[0].toolName+': '+recentAlerts[0].ruleName:'';
      document.getElementById('gd-alert-list').innerHTML=recentAlerts.map(function(a){
        return '<div>'+severityTag(a.severity)+' <strong style="color:#ccc">'+esc(a.toolName)+'</strong> \\u2014 '+esc(a.ruleName)+' <span style="color:#444">'+ago(a.timestamp)+'</span></div>';
      }).join('');
    }else{banner.style.display='none'}

    // Gauges
    var bySev=stats.bySeverity||{};
    if(!skipIfSame('gd-gauges',stats)){
      document.getElementById('gd-gauges').innerHTML=
        gauge('Blocked',fmt(stats.flagged),'','red')+
        gauge('Total',fmt(stats.total),'','yellow')+
        gauge('Rules',fmt(rules.length),'','')+
        gauge('Critical',fmt(bySev.critical||0),'','red')+
        gauge('High',fmt(bySev.high||0),'','yellow');
    }

    // Events pane
    if(!skipIfSame('gd-events',recent)){
      document.getElementById('gd-events').innerHTML=recent.length?recent.slice(0,15).map(function(e){
        var icon=e.action==='block'?'<span style="color:#ff4444">\\u2715</span>':'<span style="color:#00ccff">\\u25CB</span>';
        var tag=e.action==='block'?'block':'audit';
        return '<div class="row" data-rid="'+esc(e.request_id)+'">'+
          '<span class="row-icon">'+icon+'</span>'+
          '<span class="row-tag '+tag+'">'+esc(e.action||'audit').toUpperCase()+'</span>'+
          '<span class="row-text"><b>'+esc(e.tool_name)+'</b> <span style="color:#444">\\u2014 '+esc(e.rule_name||'')+(e.severity?' ('+e.severity+')':'')+'</span></span>'+
          '<span class="row-time">'+ago(e.created_at)+'</span></div>';
      }).join(''):'<div class="empty">No events</div>';
    }

    // Rules summary pane
    if(!skipIfSame('gd-rules',rules)){
      var topRules=rules.slice(0,15);
      document.getElementById('gd-rules').innerHTML=topRules.length?topRules.map(function(r){
        var sevColor=r.severity==='critical'?'#ff4444':r.severity==='high'?'#ffcc00':'#555';
        return '<div class="row"><span class="row-icon" style="color:'+sevColor+'">\\u25CF</span>'+
          '<span class="row-text"><b>'+esc(r.name)+'</b> <span style="color:#444">\\u2014 '+esc(r.description||r.category||'')+'</span></span>'+
          '<span class="row-tag '+(r.enabled?'audit':'')+'">'+((r.enabled?'ON':'OFF'))+'</span></div>';
      }).join(''):'<div class="empty">No rules</div>';
    }
  }catch(e){console.error('Guard refresh error',e)}
}
document.getElementById('gd-ack-btn').addEventListener('click',async function(){
  await apiFetch('/api/tool-guard/alerts/ack',{method:'POST'});
  refreshGuard();pollAlerts();
});
// Click guard event → go to Log detail
document.getElementById('gd-events').addEventListener('click',function(e){
  var row=e.target.closest('.row[data-rid]');
  if(!row)return;
  showPage('log');
  setTimeout(function(){loadSingleAudit(row.dataset.rid)},100);
});

// ══ 7. PAGE: LOG ══════════════════════════════════════════════════
var logCurrentSession=null;

async function refreshLog(){
  // Only refresh session list if we are viewing sessions
  if(document.getElementById('log-detail').style.display!=='none')return;
  if(document.getElementById('log-timeline').style.display!=='none')return;
  try{
    var sp=sinceParam();
    var r=await apiFetch('/api/audit/sessions'+(sp?'?'+sp:''));
    var sessions=await r.json();
    document.getElementById('log-no-sessions').style.display=sessions.length?'none':'';
    if(!skipIfSame('log-sessions',sessions)){
      document.getElementById('log-sessions').innerHTML=sessions.map(function(s){
        var models=(s.models||'').split(',').map(function(m){return '<span class="row-tag guard">'+esc(m.trim())+'</span>'}).join(' ');
        var sourceTag=s.source==='wrap'?' <span class="row-tag audit" style="font-size:9px">wrap</span>':'';
        var sessionId='<span class="mono" style="color:#555">'+esc(s.session_id.slice(0,8))+'</span>'+sourceTag;
        var projectLabel=s.label?'<span style="color:#e0e0e0" title="'+esc(s.project_path||'')+'">'+esc(s.label)+'</span>':'<span style="color:#444">-</span>';
        return '<tr style="cursor:pointer" data-sid="'+esc(s.session_id)+'"><td>'+ago(s.last_at)+'</td><td>'+sessionId+'</td><td>'+projectLabel+'</td><td>'+models+'</td><td>'+s.request_count+'</td><td style="color:#00ccff">View</td></tr>';
      }).join('');
    }
  }catch(e){console.error('Log refresh error',e)}
}

// Session list click
document.getElementById('log-sessions').addEventListener('click',function(e){
  var row=e.target.closest('tr[data-sid]');
  if(row){loadSessionTimeline(row.dataset.sid);return;}
});

// Search
function applyLogSearch(){
  var q=document.getElementById('log-session-search').value.trim().toLowerCase();
  var clearBtn=document.getElementById('log-search-clear');
  if(!q){
    document.querySelectorAll('#log-sessions tr').forEach(function(r){r.style.display=''});
    clearBtn.style.display='none';return;
  }
  clearBtn.style.display='';
  if(q.length>=32){loadSingleAudit(q).catch(function(){filterLogRows(q)});return;}
  filterLogRows(q);
}
function filterLogRows(q){
  document.querySelectorAll('#log-sessions tr').forEach(function(r){
    var sid=r.dataset.sid||'';
    r.style.display=sid.toLowerCase().includes(q)?'':'none';
  });
}
document.getElementById('log-search-btn').addEventListener('click',applyLogSearch);
document.getElementById('log-session-search').addEventListener('keydown',function(e){if(e.key==='Enter')applyLogSearch()});
document.getElementById('log-search-clear').addEventListener('click',function(){
  document.getElementById('log-session-search').value='';applyLogSearch();
});

async function loadSessionTimeline(sessionId){
  logCurrentSession=sessionId;
  try{
    var r=await apiFetch('/api/audit/session/'+sessionId);
    var data=await r.json();
    var timeline=data.timeline||data;
    var sessionMeta=data.session||null;
    document.getElementById('log-sessions-section').style.display='none';
    document.getElementById('log-timeline').style.display='block';
    document.getElementById('log-detail').style.display='none';
    var labelEl=document.getElementById('log-timeline-label');
    var projName=sessionMeta?sessionMeta.label:'';
    var shortId=sessionId.slice(0,8);
    labelEl.innerHTML=projName?esc(projName)+' ('+esc(shortId)+') \\u2014 '+timeline.length+' reqs':esc(shortId)+'... \\u2014 '+timeline.length+' reqs';

    var html='';
    timeline.forEach(function(entry,i){
      var m=entry.meta;var p=entry.parsed;
      var model=p.request.model||p.response.model||m.model||'?';
      var stopReason=p.response.stopReason||'';
      var stopTag=stopReason==='end_turn'?'<span class="row-tag audit">end_turn</span>':
        stopReason==='tool_use'?'<span class="row-tag warn">tool_use</span>':
        stopReason?'<span class="row-tag">'+esc(stopReason)+'</span>':'';
      var usage=p.response.usage||{};
      var tokens=(usage.input_tokens||0)+(usage.output_tokens||0);
      var dlpTag=m.dlp_hit?'<span class="row-tag dlp">DLP</span>':'';
      var tgTag=m.tool_guard_hit?'<span class="row-tag guard">TG</span>':'';

      var userSummary='';
      var msgs=p.request.messages||[];
      var lastUser=msgs.filter(function(x){return x.role==='user'}).pop();
      if(lastUser){
        (lastUser.content||[]).some(function(c){
          if(c.type==='text'&&c.text){userSummary=esc(c.text.slice(0,100));return true}
          if(c.type==='tool_result'){userSummary='<span style="color:#00ccff">[tool_result]</span> '+esc((c.text||'').slice(0,80));return true}
          return false;
        });
      }
      var responseSummary='';
      (p.response.content||[]).forEach(function(c){
        if(c.type==='text'&&c.text)responseSummary+=esc(c.text.slice(0,120));
        if(c.type==='tool_use')responseSummary+='<span style="color:#ffcc00">[tool: '+esc(c.toolName||'?')+']</span> ';
      });

      html+='<div class="section timeline-card" data-rid="'+esc(m.request_id)+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px">'+
          '<div style="display:flex;gap:6px;align-items:center">'+
            '<span style="color:#444;font-size:10px;font-weight:700">#'+(i+1)+'</span>'+
            '<span class="mono" style="color:#555">'+esc(model)+'</span>'+
            stopTag+dlpTag+tgTag+
            (tokens?'<span style="font-size:10px;color:#555">'+fmt(tokens)+' tok</span>':'')+
          '</div>'+
          '<span style="font-size:10px;color:#444">'+ago(m.created_at)+(m.latency_ms?' \\u00B7 '+m.latency_ms+'ms':'')+'</span>'+
        '</div>'+
        (userSummary?'<div style="padding:0 12px 2px;font-size:11px;color:#00ccff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+userSummary+'</div>':'')+
        (responseSummary?'<div style="padding:0 12px 6px;font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+responseSummary+'</div>':'')+
      '</div>';
    });
    document.getElementById('log-timeline-content').innerHTML=html;
  }catch(e){console.error('Timeline load error',e)}
}
document.getElementById('log-timeline-content').addEventListener('click',function(e){
  var card=e.target.closest('.timeline-card[data-rid]');
  if(card)loadSingleAudit(card.dataset.rid);
});

// Back buttons
document.getElementById('log-back-sessions').addEventListener('click',function(){
  logCurrentSession=null;
  document.getElementById('log-timeline').style.display='none';
  document.getElementById('log-detail').style.display='none';
  document.getElementById('log-sessions-section').style.display='';
});
document.getElementById('log-back-timeline').addEventListener('click',function(){
  document.getElementById('log-detail').style.display='none';
  if(logCurrentSession){document.getElementById('log-timeline').style.display='block'}
  else{document.getElementById('log-sessions-section').style.display=''}
});

// View toggle (parsed/raw)
document.querySelectorAll('.log-view-tab').forEach(function(t){
  t.addEventListener('click',function(){
    document.querySelectorAll('.log-view-tab').forEach(function(x){x.className='log-view-tab cfg-btn secondary'});
    t.className='log-view-tab cfg-btn primary';
    document.getElementById('log-parsed').style.display=t.dataset.view==='parsed'?'':'none';
    document.getElementById('log-raw').style.display=t.dataset.view==='raw'?'':'none';
  });
});

// ── Audit detail rendering ────────────────────────────────────────
function escHL(text,highlights){
  if(!highlights||!highlights.length)return esc(text);
  var result=text;
  var sorted=Array.from(new Set(highlights)).sort(function(a,b){return b.length-a.length});
  var phs=[];
  sorted.forEach(function(m,i){
    var tag='\\x00HL'+i+'\\x00';
    result=result.split(m).join(tag);
    phs.push({tag:tag,m:m,i:i});
  });
  result=esc(result);
  phs.forEach(function(p){
    result=result.split(esc(p.tag)).join('<span style="background:#5c2020;color:#ff6b6b;padding:1px 3px;font-weight:600">'+esc(p.m)+'</span>');
  });
  return result;
}

function renderBlock(b){
  if(b.type==='text')return '<div class="msg-text">'+esc(b.text||'')+'</div>';
  if(b.type==='image')return '<div class="msg-text" style="color:#555">[image]</div>';
  if(b.type==='tool_use'){
    return '<div style="margin:4px 0;padding:6px 8px;background:#1a1a0a;border:1px solid #333300;font-size:10px">'+
      '<div style="color:#ffcc00;font-size:9px;font-weight:700;margin-bottom:2px">TOOL_USE: '+esc(b.toolName||'?')+'</div>'+
      '<pre style="color:#e0e0e0;white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit">'+esc(b.toolInput||'')+'</pre></div>';
  }
  if(b.type==='tool_result'){
    var errSt=b.isError?' color:#ff4444;':'';
    return '<div style="margin:4px 0;padding:6px 8px;background:#0a1a1a;border:1px solid #003333;font-size:10px">'+
      '<div style="color:#00ccff;font-size:9px;font-weight:700;margin-bottom:2px">TOOL_RESULT'+(b.isError?' (error)':'')+'</div>'+
      '<pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;'+errSt+'">'+esc(b.text||'')+'</pre></div>';
  }
  return '<div class="msg-text" style="color:#555">'+esc(b.text||JSON.stringify(b))+'</div>';
}

function renderBlockHL(b,hl){
  if(b.type==='text')return '<div class="msg-text">'+escHL(b.text||'',hl)+'</div>';
  if(b.type==='image')return '<div class="msg-text" style="color:#555">[image]</div>';
  if(b.type==='tool_use'){
    return '<div style="margin:4px 0;padding:6px 8px;background:#1a1a0a;border:1px solid #333300;font-size:10px">'+
      '<div style="color:#ffcc00;font-size:9px;font-weight:700;margin-bottom:2px">TOOL_USE: '+esc(b.toolName||'?')+'</div>'+
      '<pre style="color:#e0e0e0;white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit">'+escHL(b.toolInput||'',hl)+'</pre></div>';
  }
  if(b.type==='tool_result'){
    var errSt=b.isError?' color:#ff4444;':'';
    return '<div style="margin:4px 0;padding:6px 8px;background:#0a1a1a;border:1px solid #003333;font-size:10px">'+
      '<div style="color:#00ccff;font-size:9px;font-weight:700;margin-bottom:2px">TOOL_RESULT'+(b.isError?' (error)':'')+'</div>'+
      '<pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;'+errSt+'">'+escHL(b.text||'',hl)+'</pre></div>';
  }
  return '<div class="msg-text" style="color:#555">'+escHL(b.text||JSON.stringify(b),hl)+'</div>';
}

function renderInlineAudit(data,rid){
  var hl=data.dlpHighlights||[];
  var wrap=function(inner){return '<div style="margin:4px 12px 12px;padding:12px;background:#0c0c0c;border:1px solid #1a1a1a;font-size:11px">'+inner+'</div>'};
  if(data.summaryOnly){
    var m=data.meta||{};
    return wrap('<div style="color:#ffcc00;margin-bottom:6px">Summary only (raw data not stored)</div><div class="msg-bubble system">'+esc(data.summary||'No summary')+'</div>');
  }
  var req=data.request||{};var res=data.response||{};
  var hlBadge=hl.length?'<div style="margin-bottom:8px;padding:4px 8px;background:#1a0000;border:1px solid #330000;font-size:10px;color:#ff6b6b"><span style="font-weight:700">DLP Matches ('+hl.length+'):</span> '+hl.map(function(m){return '<code style="background:#330000;padding:1px 4px;font-size:9px">'+esc(m.length>40?m.slice(0,37)+'...':m)+'</code>'}).join(' ')+'</div>':'';
  var reqHtml='<div style="color:#00ccff;font-weight:700;font-size:10px;margin-bottom:4px">REQUEST</div>';
  if(req.system)reqHtml+='<div class="msg-bubble system"><div class="msg-role">system</div><div class="msg-text" style="max-height:150px;overflow-y:auto">'+escHL(req.system,hl)+'</div></div>';
  if(req.messages&&req.messages.length>0){
    reqHtml+=req.messages.map(function(m){
      var role=m.role||'unknown';var cls=role==='user'?'user':role==='assistant'?'assistant':'system';
      var blocks=(m.content||[]).map(function(b){return renderBlockHL(b,hl)}).join('');
      return '<div class="msg-bubble '+cls+'"><div class="msg-role">'+esc(role)+'</div><div style="max-height:200px;overflow-y:auto">'+blocks+'</div></div>';
    }).join('');
  }
  var resHtml='<div style="color:#00ff88;font-weight:700;font-size:10px;margin-bottom:4px">RESPONSE</div>';
  if(res.content&&res.content.length>0){
    resHtml+=res.content.map(function(b){return renderBlockHL(b,hl)}).join('');
  }else{resHtml+='<div style="color:#444">No response content</div>'}
  return wrap(hlBadge+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div>'+reqHtml+'</div><div>'+resHtml+'</div></div>');
}

async function loadSingleAudit(requestId){
  try{
    var r=await apiFetch('/api/audit/'+requestId+'?dlp=true&tg=true');
    var data=await r.json();
    if(data.error)throw new Error(data.error);
    document.getElementById('log-sessions-section').style.display='none';
    document.getElementById('log-timeline').style.display=logCurrentSession?'none':'none';
    document.getElementById('log-detail').style.display='block';

    if(data.summaryOnly){
      var rawTab=document.querySelector('.log-view-tab[data-view="raw"]');rawTab.style.display='none';
      document.getElementById('log-raw').style.display='none';
      document.getElementById('log-parsed').style.display='';
      var m=data.meta||{};
      document.getElementById('log-detail-meta').innerHTML=
        (m.model?gauge('Model',esc(m.model),'',''):'')+
        gauge('Req',bytes(m.request_length||0),'','')+
        gauge('Res',bytes(m.response_length||0),'','')+
        (m.latency_ms?gauge('Lat',m.latency_ms+'ms','',''):'');
      document.getElementById('log-detail-tg').style.display='none';
      document.getElementById('log-detail-messages').innerHTML='<div style="color:#ffcc00;margin-bottom:6px">Summary only</div><div class="msg-bubble system">'+esc(data.summary||'No summary')+'</div>';
      document.getElementById('log-detail-output').innerHTML='<div class="empty">Raw data not stored</div>';
      return;
    }

    var rawTab=document.querySelector('.log-view-tab[data-view="raw"]');rawTab.style.display='';
    document.getElementById('log-raw-req').textContent=tryPrettyJson(data.raw.request);
    document.getElementById('log-raw-res').textContent=tryPrettyJson(data.raw.response);
    renderParsedAudit(data);
  }catch(e){console.error('Audit load error',e)}
}

function renderParsedAudit(data){
  var req=data.request;var res=data.response;var hl=data.dlpHighlights||[];
  var metaHtml='';
  var model=req.model||res.model;
  if(model)metaHtml+=gauge('Model',esc(model),'','');
  var usage=res.usage||{};
  if(usage.input_tokens)metaHtml+=gauge('In',fmt(usage.input_tokens),'','cyan');
  if(usage.output_tokens)metaHtml+=gauge('Out',fmt(usage.output_tokens),'','cyan');
  if(res.stopReason)metaHtml+=gauge('Stop',esc(res.stopReason),'','');
  if(req.stream!==undefined)metaHtml+=gauge('Stream',req.stream?'Yes':'No','','');
  document.getElementById('log-detail-meta').innerHTML=metaHtml;

  // Tool Guard findings
  var tgDiv=document.getElementById('log-detail-tg');
  var tgFindings=data.toolGuardFindings||[];
  if(tgFindings.length>0){
    tgDiv.style.display='';
    tgDiv.innerHTML='<div style="padding:8px 12px;background:#0a0a1a;border:1px solid #1a1a3a"><div style="color:#ff8844;font-weight:700;margin-bottom:4px;font-size:11px">Tool Guard ('+tgFindings.length+')</div>'+
      tgFindings.map(function(f){
        return '<div style="margin:2px 0;font-size:11px">'+actionTag(f.action)+' '+severityTag(f.severity)+' <strong style="color:#e0e0e0">'+esc(f.tool_name)+'</strong>'+(f.rule_name?' <span style="color:#555">'+esc(f.rule_name)+'</span>':'')+'</div>';
      }).join('')+'</div>';
  }else{tgDiv.style.display='none'}

  // DLP highlight badge
  var hlBadge='';
  if(hl.length>0){
    hlBadge='<div style="margin-bottom:8px;padding:4px 8px;background:#1a0000;border:1px solid #330000;font-size:10px;color:#ff6b6b"><span style="font-weight:700">DLP Matches ('+hl.length+'):</span> '+hl.map(function(m){return '<code style="background:#330000;padding:1px 4px;font-size:9px">'+esc(m.length>40?m.slice(0,37)+'...':m)+'</code>'}).join(' ')+'</div>';
  }

  // Request side
  var msgEl=document.getElementById('log-detail-messages');
  var html=hlBadge;
  if(req.system)html+='<div class="msg-bubble system"><div class="msg-role">system</div><div class="msg-text">'+escHL(req.system,hl)+'</div></div>';
  if(req.tools&&req.tools.length>0){
    html+='<div style="margin:4px 0;padding:4px 8px;background:#111;border:1px solid #1a1a1a;font-size:10px"><span style="color:#555;font-weight:700">TOOLS ('+req.tools.length+'):</span> <span style="color:#aa66ff">'+req.tools.map(function(n){return esc(n)}).join(', ')+'</span></div>';
  }
  if(req.messages&&req.messages.length>0){
    html+=req.messages.map(function(m){
      var role=m.role||'unknown';var cls=role==='user'?'user':role==='assistant'?'assistant':'system';
      var blocks=(m.content||[]).map(function(b){return renderBlockHL(b,hl)}).join('');
      return '<div class="msg-bubble '+cls+'"><div class="msg-role">'+esc(role)+'</div>'+blocks+'</div>';
    }).join('');
  }
  msgEl.innerHTML=html||'<div class="empty">No request data</div>';

  // Response side
  var outEl=document.getElementById('log-detail-output');
  if(res.content&&res.content.length>0){
    outEl.innerHTML=res.content.map(function(b){
      if(b.type==='text')return '<div class="msg-bubble assistant"><div class="msg-role">assistant</div><div class="msg-text">'+escHL(b.text||'',hl)+'</div></div>';
      if(b.type==='tool_use')return '<div class="msg-bubble system"><div class="msg-role">tool_use: '+esc(b.toolName||'')+'</div><div class="msg-text">'+escHL(b.toolInput||'',hl)+'</div></div>';
      return renderBlockHL(b,hl);
    }).join('');
  }else{outEl.innerHTML='<div class="empty">No response content</div>'}
}

// ── Optimizer section ─────────────────────────────────────────────
document.getElementById('opt-toggle').addEventListener('click',function(){
  var body=document.getElementById('opt-body');
  var arrow=this.querySelector('.sect-arrow');
  if(body.style.display==='none'){body.style.display='';arrow.innerHTML='\\u25BE';refreshOptimizer()}
  else{body.style.display='none';arrow.innerHTML='\\u25B8'}
});
async function refreshOptimizer(){
  try{
    var sp=sinceParam();
    var [statsR,recentR]=await Promise.all([apiFetch('/api/optimizer/stats'),apiFetch('/api/optimizer/recent'+(sp?'?'+sp:''))]);
    var stats=await statsR.json();var recent=await recentR.json();
    var hitRate=stats.total_events>0?(stats.cache_hit_rate*100).toFixed(1)+'%':'0%';
    document.getElementById('opt-gauges').innerHTML=
      gauge('Events',fmt(stats.total_events),'','')+
      gauge('Cache Rate',hitRate,'','cyan')+
      gauge('Chars Saved',fmt(stats.total_chars_saved),'','green')+
      gauge('Tokens Saved',fmt(stats.total_tokens_saved),'','green');
    document.getElementById('opt-no-events').style.display=recent.length?'none':'';
    document.getElementById('opt-recent').innerHTML=recent.map(function(e){
      return '<tr><td>'+ago(e.created_at)+'</td><td>'+(e.cache_hit?'<span class="row-tag audit">cache</span>':'trim')+'</td>'+
        '<td class="mono">'+fmt(e.original_length)+'</td><td class="mono">'+fmt(e.trimmed_length)+'</td>'+
        '<td class="mono">'+fmt(e.chars_saved)+'</td><td class="mono">'+fmt(e.tokens_saved_estimate)+'</td></tr>';
    }).join('');
  }catch(e){console.error('Optimizer error',e)}
}

// ══ 8. PAGE: SETTINGS ═════════════════════════════════════════════
// Collapsible sections
document.querySelectorAll('.setting-toggle[data-target]').forEach(function(h){
  h.addEventListener('click',function(){
    var target=document.getElementById(h.dataset.target);
    if(!target)return;
    var isOpen=target.style.display!=='none';
    target.style.display=isOpen?'none':'';
    var arrow=h.querySelector('.sect-arrow');
    if(arrow)arrow.innerHTML=isOpen?'\\u25B8':'\\u25BE';
  });
});

var _devMode=false;var _proLicense={pro:false};
var _proFeatures={
  'ai-injection':{title:'AI Injection Detection',desc:'Multi-layer AI-driven prompt injection detection with semantic analysis.'},
  'budget':{title:'Budget Control',desc:'Per-session/user/project cost budgets with auto-blocking.'},
  'ratelimit':{title:'Rate Limiting',desc:'Configurable rate limiting by API key, session, or global scope.'}
};

async function refreshSettings(){
  try{
    var [cfgR,licR,devR]=await Promise.all([apiFetch('/api/config'),apiFetch('/api/license'),apiFetch('/api/dev')]);
    var cfgData=await cfgR.json();_proLicense=await licR.json();var devData=await devR.json();
    _devMode=!!devData.dev;
    document.getElementById('sec-pro').style.display=_devMode?'':'none';

    // 1. Plugins
    var info=cfgData.pluginInfo||[];
    var builtin=info.filter(function(p){return p.source==='builtin'});
    var external=info.filter(function(p){return p.source==='external'});
    var pHtml='<div style="font-size:10px;color:#555;margin-bottom:4px;font-weight:700">BUILT-IN</div>';
    builtin.forEach(function(p){
      pHtml+='<div class="toggle-row"><div><div class="toggle-label">'+esc(p.name)+'</div></div><label class="switch"><input type="checkbox" data-plugin="'+esc(p.name)+'"'+(p.enabled?' checked':'')+'><span class="slider"></span></label></div>';
    });
    if(external.length>0){
      pHtml+='<div style="font-size:10px;color:#555;margin:8px 0 4px;font-weight:700;border-top:1px solid #1a1a1a;padding-top:8px">EXTERNAL</div>';
      external.forEach(function(p){
        var meta=[];if(p.version)meta.push('v'+p.version);if(p.packageName)meta.push(p.packageName);
        var ms=meta.length?' <span style="color:#555;font-size:10px">('+meta.join(' ')+')</span>':'';
        pHtml+='<div class="toggle-row"><div><div class="toggle-label">'+esc(p.name)+ms+'</div></div><label class="switch"><input type="checkbox" data-plugin="'+esc(p.name)+'"'+(p.enabled?' checked':'')+'><span class="slider"></span></label></div>';
      });
    }
    document.getElementById('plugin-toggles').innerHTML=pHtml;
    document.querySelectorAll('#plugin-toggles input[type=checkbox]').forEach(function(cb){
      cb.addEventListener('change',async function(){
        var payload={pluginStatus:{}};payload.pluginStatus[cb.dataset.plugin]=cb.checked;
        await apiFetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      });
    });

    // 2. Pro Features
    updateProFeatures();

    // 3. DLP Config
    await loadDlpConfig(cfgData);

    // 6. TG Config
    var tgCfg=cfgData.config&&cfgData.config.plugins?cfgData.config.plugins.toolGuard||{}:{};
    document.getElementById('tg-action-select').value=tgCfg.action||'audit';
    document.getElementById('tg-record-all').checked=tgCfg.recordAll!==false;
    document.getElementById('tg-block-severity').value=tgCfg.blockMinSeverity||'critical';
    document.getElementById('tg-alert-severity').value=tgCfg.alertMinSeverity||'high';

    // 7. TG Rules
    refreshTgRules();

    // 8. Retention
    var ret=cfgData.config&&cfgData.config.retention?cfgData.config.retention:{};
    document.getElementById('ret-requests').value=ret.requestsHours||720;
    document.getElementById('ret-dlp').value=ret.dlpEventsHours||720;
    document.getElementById('ret-tools').value=ret.toolCallsHours||720;
    document.getElementById('ret-optimizer').value=ret.optimizerEventsHours||720;
    document.getElementById('ret-sessions').value=ret.sessionsHours||720;
    document.getElementById('ret-audit').value=ret.auditLogHours||24;
    document.getElementById('ret-plugin-events').value=ret.pluginEventsHours||720;

    // 9. Pipeline
    var srv=cfgData.config&&cfgData.config.server?cfgData.config.server:{};
    document.getElementById('fail-mode-select').value=srv.failMode||'open';
  }catch(e){console.error('Settings refresh error',e)}
}

// Pro features
function updateProFeatures(){
  document.querySelectorAll('.pro-feature-row').forEach(function(row){
    if(_proLicense.pro){
      row.classList.add('unlocked');
      var badge=row.querySelector('.row-tag');
      if(badge){badge.style.background='#0a1a0a';badge.style.color='#00ff88';badge.textContent='ACTIVE'}
    }
  });
}
function showProDetail(feature){
  var info=_proFeatures[feature];if(!info)return;
  document.getElementById('pro-detail-title').textContent=info.title;
  document.getElementById('pro-detail-desc').textContent=info.desc;
  document.getElementById('pro-detail').style.display='block';
  if(_proLicense.pro){document.getElementById('pro-detail-unlocked').style.display='block';document.getElementById('pro-detail-locked').style.display='none'}
  else{document.getElementById('pro-detail-unlocked').style.display='none';document.getElementById('pro-detail-locked').style.display='block';
    document.getElementById('pro-detail-license').style.display=(_devMode||_proLicense.installed)?'block':'none'}
}
document.querySelectorAll('.pro-feature-row').forEach(function(row){
  row.addEventListener('click',function(){showProDetail(row.dataset.proFeature)});
});
async function activateLicense(inputId){
  var key=document.getElementById(inputId).value.trim();if(!key)return;
  if(_devMode){
    try{var r=await apiFetch('/api/dev/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:key})});
      var d=await r.json();if(d.ok){refreshSettings();return}alert(d.error||'Invalid token');
    }catch(e){alert('Activation failed')}
  }else{alert('License activation requires the Bastion Pro plugin.')}
}
window.activateLicense=activateLicense;

// DLP Config
var dlpServerState=null;var dlpBuiltinsLoaded=false;var dlpCleanSnapshot='';
function readDlpForm(){
  return{enabled:document.getElementById('dlp-cfg-enabled').checked,action:document.getElementById('dlp-cfg-action').value,
    aiEnabled:document.getElementById('dlp-cfg-ai').checked,
    sensitive:document.getElementById('dlp-cfg-sensitive').value,nonsensitive:document.getElementById('dlp-cfg-nonsensitive').value};
}
function dlpFormSnapshot(){return JSON.stringify(readDlpForm())}
function updateDirtyUI(){
  var dirty=dlpCleanSnapshot!==dlpFormSnapshot();
  document.getElementById('dlp-dirty').style.display=dirty?'':'none';
  document.getElementById('dlp-apply-btn').style.display=dirty?'':'none';
  document.getElementById('dlp-revert-btn').style.display=dirty?'':'none';
}
function populateDlpForm(config,enabled){
  document.getElementById('dlp-cfg-enabled').checked=!!enabled;
  document.getElementById('dlp-cfg-action').value=config.action||'warn';
  var aiVal=config.aiValidation||{};
  document.getElementById('dlp-cfg-ai').checked=!!aiVal.enabled;
  var aiSt=document.getElementById('dlp-ai-status');
  if(!aiVal.apiKey){aiSt.innerHTML='<span style="color:#ffcc00">No key</span>';document.getElementById('dlp-cfg-ai').disabled=true}
  else{aiSt.innerHTML=aiVal.enabled?'<span style="color:#00ff88">Active</span>':'<span style="color:#555">Off</span>';document.getElementById('dlp-cfg-ai').disabled=false}
  var sem=config.semantics||{};
  document.getElementById('dlp-cfg-sensitive').value=(sem.sensitivePatterns||[]).join('\\n');
  document.getElementById('dlp-cfg-nonsensitive').value=(sem.nonSensitiveNames||[]).join('\\n');
  dlpCleanSnapshot=dlpFormSnapshot();updateDirtyUI();
}
async function loadDlpConfig(cfgData){
  var config=cfgData.config&&cfgData.config.plugins?cfgData.config.plugins.dlp||{}:{};
  var enabled=cfgData.pluginStatus?cfgData.pluginStatus['dlp-scanner']!==false:true;
  dlpServerState={config:config,enabled:enabled};
  populateDlpForm(config,enabled);
  if(!dlpBuiltinsLoaded){
    try{var bRes=await apiFetch('/api/dlp/semantics/builtins');var b=await bRes.json();
      document.getElementById('dlp-builtin-sensitive').innerHTML=b.sensitivePatterns.map(function(p){return '<code style="background:#1a1a1a;padding:2px 4px;font-size:10px;color:#555">'+esc(p)+'</code>'}).join('');
      document.getElementById('dlp-builtin-nonsensitive').innerHTML=b.nonSensitiveNames.map(function(n){return '<code style="background:#1a1a1a;padding:2px 4px;font-size:10px;color:#555">'+esc(n)+'</code>'}).join('');
      dlpBuiltinsLoaded=true;
    }catch(e){}
  }
  refreshPatterns();refreshSignature(false);
}
document.getElementById('dlp-apply-btn').addEventListener('click',async function(){
  var f=readDlpForm();
  var payload={enabled:f.enabled,action:f.action,aiValidation:{enabled:f.aiEnabled},
    semantics:{sensitivePatterns:f.sensitive.split('\\n').map(function(s){return s.trim()}).filter(Boolean),
      nonSensitiveNames:f.nonsensitive.split('\\n').map(function(s){return s.trim()}).filter(Boolean)}};
  await apiFetch('/api/dlp/config/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  refreshSettings();loadDlpHistory();
});
document.getElementById('dlp-revert-btn').addEventListener('click',function(){if(dlpServerState)populateDlpForm(dlpServerState.config,dlpServerState.enabled)});
['dlp-cfg-enabled','dlp-cfg-action','dlp-cfg-ai'].forEach(function(id){document.getElementById(id).addEventListener('change',updateDirtyUI)});
['dlp-cfg-sensitive','dlp-cfg-nonsensitive'].forEach(function(id){document.getElementById(id).addEventListener('input',updateDirtyUI)});

// DLP History
document.getElementById('dlp-history-toggle').addEventListener('click',function(){
  var list=document.getElementById('dlp-history-list');
  var arrow=this.querySelector('.sect-arrow');
  if(list.style.display==='none'){list.style.display='';if(arrow)arrow.innerHTML='\\u25BE';loadDlpHistory()}
  else{list.style.display='none';if(arrow)arrow.innerHTML='\\u25B8'}
});
async function loadDlpHistory(){
  try{var r=await apiFetch('/api/dlp/config/history');var entries=await r.json();
    document.getElementById('dlp-history-count').textContent='('+entries.length+')';
    document.getElementById('no-history').style.display=entries.length?'none':'';
    document.getElementById('dlp-history-body').innerHTML=entries.map(function(e){
      var c={};try{c=JSON.parse(e.config_json)}catch(x){}
      var sem=c.semantics||{};var sp=(sem.sensitivePatterns||[]).length;var ns=(sem.nonSensitiveNames||[]).length;
      return '<tr><td>'+ago(e.created_at)+'</td><td>'+esc(c.action||'-')+'</td><td>'+(c.aiValidation&&c.aiValidation.enabled?'On':'Off')+'</td><td>'+sp+'</td><td>'+ns+'</td>'+
        '<td><button class="dlp-restore-btn cfg-btn secondary" data-hid="'+e.id+'">Restore</button></td></tr>';
    }).join('');
  }catch(e){}
}
document.getElementById('dlp-history-body').addEventListener('click',async function(e){
  var btn=e.target.closest('.dlp-restore-btn');if(!btn)return;
  if(!confirm('Restore this configuration?'))return;
  await apiFetch('/api/dlp/config/restore/'+btn.dataset.hid,{method:'POST'});
  refreshSettings();loadDlpHistory();
});

// DLP Patterns
var _allPatterns=[];
async function refreshPatterns(){
  try{var r=await apiFetch('/api/dlp/patterns');_allPatterns=await r.json();
    var sel=document.getElementById('dlp-cat-filter');var prev=sel.value;
    var cats=Array.from(new Set(_allPatterns.map(function(p){return p.category}))).sort();
    sel.innerHTML='<option value="">All categories</option>'+cats.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+' ('+_allPatterns.filter(function(p){return p.category===c}).length+')</option>'}).join('');
    sel.value=prev;renderPatterns();
  }catch(e){console.error('Pattern refresh error',e)}
}
function renderPatterns(){
  var catFilter=document.getElementById('dlp-cat-filter').value;
  var filtered=catFilter?_allPatterns.filter(function(p){return p.category===catFilter}):_allPatterns;
  document.getElementById('dlp-pat-count').textContent=catFilter?filtered.length+'/'+_allPatterns.length:_allPatterns.length+' patterns';
  document.getElementById('no-patterns').style.display=filtered.length?'none':'';
  document.getElementById('dlp-patterns').innerHTML=filtered.map(function(p){
    var regexDisp=esc(p.regex_source.length>40?p.regex_source.slice(0,40)+'...':p.regex_source);
    var delBtn=p.is_builtin?'':'<button class="dlp-del-btn cfg-btn danger" data-id="'+esc(p.id)+'">Del</button>';
    return '<tr><td><label class="switch" style="margin:0"><input type="checkbox" data-pid="'+esc(p.id)+'"'+(p.enabled?' checked':'')+'><span class="slider"></span></label></td>'+
      '<td class="mono" style="font-size:11px">'+esc(p.name)+'</td><td>'+esc(p.category)+'</td>'+
      '<td class="mono" style="font-size:10px" title="'+esc(p.regex_source)+'">'+regexDisp+'</td>'+
      '<td style="color:#555;font-size:11px">'+esc(p.description||'-')+'</td><td>'+delBtn+'</td></tr>';
  }).join('');
}
document.getElementById('dlp-patterns').addEventListener('change',async function(e){
  var cb=e.target.closest('input[type=checkbox][data-pid]');if(!cb)return;
  await apiFetch('/api/dlp/patterns/'+encodeURIComponent(cb.dataset.pid),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:cb.checked})});
});
document.getElementById('dlp-patterns').addEventListener('click',async function(e){
  var btn=e.target.closest('.dlp-del-btn');if(!btn)return;
  if(!confirm('Delete this custom pattern?'))return;
  await apiFetch('/api/dlp/patterns/'+encodeURIComponent(btn.dataset.id),{method:'DELETE'});refreshPatterns();
});
document.getElementById('dlp-cat-filter').addEventListener('change',renderPatterns);
document.getElementById('dlp-add-btn').addEventListener('click',function(){document.getElementById('dlp-add-form').style.display='';document.getElementById('dlp-form-error').textContent=''});
document.getElementById('dlp-cancel-btn').addEventListener('click',function(){document.getElementById('dlp-add-form').style.display='none'});
document.getElementById('dlp-save-btn').addEventListener('click',async function(){
  var name=document.getElementById('dlp-new-name').value.trim();var regex=document.getElementById('dlp-new-regex').value.trim();
  var desc=document.getElementById('dlp-new-desc').value.trim();var ctx=document.getElementById('dlp-new-context').value.trim();
  var errEl=document.getElementById('dlp-form-error');
  if(!name||!regex){errEl.textContent='Name and Regex required';return}
  try{new RegExp(regex)}catch(e){errEl.textContent='Invalid regex: '+e.message;return}
  var payload={name:name,regex_source:regex,description:desc||null,require_context:ctx?JSON.stringify(ctx.split(',').map(function(s){return s.trim()}).filter(Boolean)):null};
  var r=await apiFetch('/api/dlp/patterns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  var data=await r.json();if(!r.ok){errEl.textContent=data.error||'Failed';return}
  document.getElementById('dlp-add-form').style.display='none';
  ['dlp-new-name','dlp-new-regex','dlp-new-desc','dlp-new-context'].forEach(function(id){document.getElementById(id).value=''});
  refreshPatterns();
});

// DLP Signatures
var sigLog=[];
function addSigLog(msg,ok){sigLog.unshift({time:new Date().toLocaleTimeString(),msg:msg,ok:ok});if(sigLog.length>50)sigLog.length=50;renderSigLog()}
function renderSigLog(){
  var el=document.getElementById('sig-log-entries');var empty=document.getElementById('sig-log-empty');
  if(!sigLog.length){empty.style.display='';el.innerHTML='';document.getElementById('sig-log-count').textContent='';return}
  empty.style.display='none';document.getElementById('sig-log-count').textContent='('+sigLog.length+')';
  el.innerHTML=sigLog.map(function(e){var color=e.ok===false?'#ff4444':e.ok===true?'#00ff88':'#555';
    return '<div style="padding:2px 0;border-bottom:1px solid #1a1a1a"><span style="color:#444">'+esc(e.time)+'</span> <span style="color:'+color+'">'+esc(e.msg)+'</span></div>';
  }).join('');
}
document.getElementById('sig-log-toggle').addEventListener('click',function(){
  var body=document.getElementById('sig-log-body');var arrow=document.getElementById('sig-log-arrow');
  if(body.style.display==='none'){body.style.display='';arrow.style.transform='rotate(90deg)'}
  else{body.style.display='none';arrow.style.transform=''}
});
async function refreshSignature(checkRemote){
  try{var url=checkRemote?'/api/dlp/signature?check=true':'/api/dlp/signature';
    var r=await apiFetch(url);var s=await r.json();
    var badge=document.getElementById('sig-badge');var upd=document.getElementById('sig-update');var notSynced=document.getElementById('sig-not-synced');
    if(s.local){badge.textContent='#'+s.local.version;badge.style.display='';
      document.getElementById('sig-ver').textContent='#'+s.local.version;document.getElementById('sig-count').textContent=s.local.patternCount;
      document.getElementById('sig-branch').textContent=s.local.branch;document.getElementById('sig-synced').textContent=new Date(s.local.syncedAt).toLocaleString();
      notSynced.style.display='none';
    }else{badge.style.display='none';['sig-ver','sig-count','sig-branch','sig-synced'].forEach(function(id){document.getElementById(id).textContent='-'});notSynced.style.display=''}
    if(s.updateAvailable&&s.remote){upd.textContent='#'+s.remote.version+' available';upd.style.display='';upd.onclick=function(){syncSignature()};
      if(checkRemote)addSigLog('Update available: #'+s.remote.version,null);
    }else{upd.style.display='none';if(checkRemote&&s.local)addSigLog('Up to date (#'+s.local.version+')',true)}
    var cfgR=await apiFetch('/api/config');var cfg=await cfgR.json();
    var rp=cfg.config&&cfg.config.plugins&&cfg.config.plugins.dlp?cfg.config.plugins.dlp.remotePatterns||{}:{};
    document.getElementById('sig-auto-sync').checked=rp.syncOnStart!==false;
  }catch(e){console.error('Sig refresh error',e)}
}
async function syncSignature(){
  var btn=document.getElementById('sig-sync-btn');var old=btn.textContent;btn.textContent='Syncing...';btn.disabled=true;
  addSigLog('Sync started...',null);
  try{var r=await apiFetch('/api/dlp/signature/sync',{method:'POST'});var data=await r.json();
    if(data.ok){addSigLog('Synced: '+data.synced+' patterns',true);refreshPatterns();refreshSignature(false)}
    else{addSigLog('Failed: '+(data.error||'unknown'),false)}
  }catch(e){addSigLog('Error: '+e.message,false)}
  finally{btn.textContent=old;btn.disabled=false}
}
document.getElementById('sig-sync-btn').addEventListener('click',syncSignature);
document.getElementById('sig-check-btn').addEventListener('click',function(){addSigLog('Checking...',null);refreshSignature(true)});
document.getElementById('sig-auto-sync').addEventListener('change',async function(){
  var enabled=this.checked;
  try{await apiFetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({plugins:{dlp:{remotePatterns:{syncOnStart:enabled}}}})});
    addSigLog('Auto-sync '+(enabled?'enabled':'disabled'),true);
  }catch(e){addSigLog('Failed: '+e.message,false)}
});

// TG Config change handlers
['tg-action-select','tg-record-all','tg-block-severity','tg-alert-severity'].forEach(function(id){
  var el=document.getElementById(id);if(!el)return;
  el.addEventListener('change',async function(){
    var payload={plugins:{toolGuard:{action:document.getElementById('tg-action-select').value,
      recordAll:document.getElementById('tg-record-all').checked,
      blockMinSeverity:document.getElementById('tg-block-severity').value,
      alertMinSeverity:document.getElementById('tg-alert-severity').value}}};
    try{await apiFetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})}catch(e){return}
    var st=document.getElementById('tg-cfg-status');st.style.display='inline';setTimeout(function(){st.style.display='none'},2000);
  });
});

// TG Rules
async function refreshTgRules(){
  try{var r=await apiFetch('/api/tool-guard/rules');var rules=await r.json();
    document.getElementById('no-tg-rules').style.display=rules.length?'none':'';
    if(skipIfSame('tg-rules-table',rules))return;
    document.getElementById('tg-rules-table').innerHTML=rules.map(function(r){
      var patPreview=r.input_pattern?(r.input_pattern.length>50?esc(r.input_pattern.slice(0,50))+'...':esc(r.input_pattern)):'';
      var typeLabel=r.is_builtin?'<span style="color:#555">built-in</span>':'<span style="color:#00ccff">custom</span>';
      return '<tr><td><label class="switch" style="transform:scale(0.8)"><input type="checkbox" class="tgr-toggle" data-id="'+esc(r.id)+'"'+(r.enabled?' checked':'')+'><span class="slider"></span></label></td>'+
        '<td><strong>'+esc(r.name)+'</strong>'+(r.description?'<div style="font-size:10px;color:#555">'+esc(r.description)+'</div>':'')+'</td>'+
        '<td>'+severityTag(r.severity)+'</td><td style="color:#555">'+esc(r.category)+'</td>'+
        '<td class="mono" style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.input_pattern)+'">'+patPreview+'</td>'+
        '<td>'+typeLabel+'</td><td>'+(r.is_builtin?'':'<button class="tgr-del cfg-btn danger" data-id="'+esc(r.id)+'">Del</button>')+'</td></tr>';
    }).join('');
  }catch(e){console.error('TG rules error',e)}
}
document.getElementById('tg-rules-table').addEventListener('change',async function(e){
  var cb=e.target.closest('.tgr-toggle');if(!cb)return;
  await apiFetch('/api/tool-guard/rules/'+encodeURIComponent(cb.dataset.id),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:cb.checked})});
});
document.getElementById('tg-rules-table').addEventListener('click',async function(e){
  var btn=e.target.closest('.tgr-del');if(!btn)return;e.stopPropagation();
  if(!confirm('Delete this custom rule?'))return;
  await apiFetch('/api/tool-guard/rules/'+encodeURIComponent(btn.dataset.id),{method:'DELETE'});_lastJson={};refreshTgRules();
});
document.getElementById('tg-add-rule-btn').addEventListener('click',function(){
  document.getElementById('tg-rule-form').style.display='block';
  ['tgr-name','tgr-description','tgr-input-pattern','tgr-tool-pattern','tgr-tool-flags'].forEach(function(id){document.getElementById(id).value=''});
  document.getElementById('tgr-input-flags').value='i';document.getElementById('tgr-severity').value='medium';document.getElementById('tgr-category').value='custom';
  document.getElementById('tgr-error').style.display='none';
});
document.getElementById('tgr-cancel').addEventListener('click',function(){document.getElementById('tg-rule-form').style.display='none'});
document.getElementById('tgr-save').addEventListener('click',async function(){
  var errEl=document.getElementById('tgr-error');var name=document.getElementById('tgr-name').value.trim();
  var inputPattern=document.getElementById('tgr-input-pattern').value.trim();
  if(!name||!inputPattern){errEl.textContent='Name and Input Pattern required';errEl.style.display='inline';return}
  try{new RegExp(inputPattern,document.getElementById('tgr-input-flags').value)}catch(e){errEl.textContent='Invalid regex: '+e.message;errEl.style.display='inline';return}
  var toolPat=document.getElementById('tgr-tool-pattern').value.trim();
  if(toolPat){try{new RegExp(toolPat,document.getElementById('tgr-tool-flags').value)}catch(e){errEl.textContent='Invalid tool regex: '+e.message;errEl.style.display='inline';return}}
  var payload={name:name,description:document.getElementById('tgr-description').value.trim()||null,
    input_pattern:inputPattern,input_flags:document.getElementById('tgr-input-flags').value||'i',
    tool_name_pattern:toolPat||null,tool_name_flags:document.getElementById('tgr-tool-flags').value||null,
    severity:document.getElementById('tgr-severity').value,category:document.getElementById('tgr-category').value||'custom'};
  var r=await apiFetch('/api/tool-guard/rules',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  var res=await r.json();if(res.error){errEl.textContent=res.error;errEl.style.display='inline';return}
  document.getElementById('tg-rule-form').style.display='none';_lastJson={};refreshTgRules();
});

// Retention save
document.getElementById('ret-save-btn').addEventListener('click',async function(){
  var retention={requestsHours:parseInt(document.getElementById('ret-requests').value)||720,
    dlpEventsHours:parseInt(document.getElementById('ret-dlp').value)||720,
    toolCallsHours:parseInt(document.getElementById('ret-tools').value)||720,
    optimizerEventsHours:parseInt(document.getElementById('ret-optimizer').value)||720,
    sessionsHours:parseInt(document.getElementById('ret-sessions').value)||720,
    auditLogHours:parseInt(document.getElementById('ret-audit').value)||24,
    pluginEventsHours:parseInt(document.getElementById('ret-plugin-events').value)||720};
  await apiFetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({retention:retention})});
  var st=document.getElementById('ret-status');st.style.display='inline';setTimeout(function(){st.style.display='none'},2000);
});

// Pipeline fail mode
document.getElementById('fail-mode-select').addEventListener('change',async function(){
  var val=document.getElementById('fail-mode-select').value;
  await apiFetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({server:{failMode:val}})});
  var st=document.getElementById('fail-mode-status');st.style.display='inline';setTimeout(function(){st.style.display='none'},2000);
});

// Debug Scanner
var SCAN_PRESETS={
  clean:'What is the capital of France?',
  aws:'AWS credentials:\\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  github:'Use token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk',
  openai:'Set OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234',
  pem:'-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB\\naFDrBz9vFqU4yVkzSzl9JYpP0kLgHrFhLXQ2RD3G7X1SE6tU0ZMaXR9T5eJA\\n-----END RSA PRIVATE KEY-----',
  password:'DB_PASSWORD=xK9mP2vL5nR8qW4jB7fT3aZ6',
  cc:'Card: 4111111111111111\\nSSN: 219-09-9999',
  ssn:'SSN: 219-09-9999, DOB: 1990-01-15',
  email:'Contact john.doe@company.com',
  multi:'AKIAIOSFODNN7EXAMPLE\\nghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk\\npassword=SuperSecret123',
  'json-secret':JSON.stringify({database_password:'xK9mP2vL5nR8qW4jB7fT3aZ6'},null,2),
  'llm-body':JSON.stringify({model:'claude-haiku-4.5',messages:[{role:'user',content:'API Key: AKIAIOSFODNN7EXAMPLE'}]},null,2)
};
document.querySelectorAll('.scan-preset').forEach(function(btn){
  btn.addEventListener('click',function(){var p=btn.dataset.preset;if(SCAN_PRESETS[p]!==undefined)document.getElementById('scan-input').value=SCAN_PRESETS[p];document.getElementById('scan-result').style.display='none'});
});

function highlightMatches(text,matches){
  if(!matches||!matches.length)return esc(text);
  var result=text;var sorted=Array.from(new Set(matches)).sort(function(a,b){return b.length-a.length});var phs=[];
  sorted.forEach(function(m,i){var tag='\\x00M'+i+'\\x00';result=result.split(m).join(tag);phs.push({tag:tag,m:m})});
  result=esc(result);phs.forEach(function(p){result=result.split(esc(p.tag)).join('<span style="background:#5c2020;color:#ff6b6b;padding:0 2px">'+esc(p.m)+'</span>')});
  return result;
}
function highlightRedacted(text){if(!text)return'';return esc(text).replace(/\\[([A-Z_-]+_REDACTED)\\]/g,'<span style="background:#0a1a0a;color:#00ff88;padding:0 2px">[$1]</span>')}

var TRACE_COLORS={'-1':'#555','0':'#00ccff','1':'#ffcc00','2':'#aa66ff','3':'#00ff88'};
var TRACE_NAMES={'-1':'INIT','0':'STRUCT','1':'ENTROPY','2':'REGEX','3':'SEMANTIC'};
function renderTrace(trace){
  if(!trace||!trace.entries)return'';
  return trace.entries.map(function(e){
    var color=TRACE_COLORS[e.layer]||'#555';var label=TRACE_NAMES[e.layer]||e.layerName;
    var dur=e.durationMs!==undefined?' <span style="color:#444">('+e.durationMs.toFixed(2)+'ms)</span>':'';
    return '<span style="color:'+color+';font-weight:700">['+esc(label)+']</span> <span style="color:#555">'+esc(e.step)+'</span> '+esc(e.detail)+dur;
  }).join('\\n');
}

document.getElementById('scan-btn').addEventListener('click',async function(){
  var text=document.getElementById('scan-input').value.trim();if(!text)return;
  var action=document.getElementById('scan-action').value;var enableTrace=document.getElementById('scan-trace').checked;
  var btn=document.getElementById('scan-btn');btn.textContent='...';btn.disabled=true;
  try{var r=await apiFetch('/api/dlp/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:text,action:action,trace:enableTrace})});
    var data=await r.json();if(data.error){alert(data.error);return}
    document.getElementById('scan-result').style.display='block';
    var n=data.findings.length;var allMatches=data.findings.flatMap(function(f){return f.matches||[]});
    document.getElementById('scan-result-cards').innerHTML=
      gauge('Result',data.action==='pass'?'Clean':data.action,'',(data.action==='pass'?'green':'red'))+
      gauge('Findings',String(n),'',n>0?'red':'')+
      gauge('Patterns',n>0?data.findings.map(function(f){return f.patternName}).join(', '):'None','','');
    if(n>0){document.getElementById('scan-findings-section').style.display='';
      document.getElementById('scan-findings-body').innerHTML=data.findings.map(function(f){
        var matchDisp=(f.matches||[]).map(function(m){return '<div class="snippet" style="display:inline-block;margin:1px">'+esc(m.length>60?m.slice(0,60)+'...':m)+'</div>'}).join(' ');
        return '<tr><td class="mono">'+esc(f.patternName)+'</td><td>'+esc(f.patternCategory)+'</td><td>'+f.matchCount+'</td><td>'+matchDisp+'</td></tr>';
      }).join('');
    }else{document.getElementById('scan-findings-section').style.display='none'}
    if(n>0){document.getElementById('scan-diff-section').style.display='';
      document.getElementById('scan-original').innerHTML=highlightMatches(text,allMatches);
      document.getElementById('scan-redacted').innerHTML=data.redactedText?highlightRedacted(data.redactedText):'<span style="color:#555">(not redact mode)</span>';
    }else{document.getElementById('scan-diff-section').style.display='none'}
    if(data.trace&&data.trace.entries&&data.trace.entries.length>0){document.getElementById('scan-trace-section').style.display='';
      document.getElementById('scan-trace-log').innerHTML=renderTrace(data.trace);
    }else{document.getElementById('scan-trace-section').style.display='none'}
  }catch(e){alert('Scan failed: '+e.message)}
  finally{btn.textContent='Scan';btn.disabled=false}
});
document.getElementById('scan-input').addEventListener('keydown',function(e){
  if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();document.getElementById('scan-btn').click()}
});

// ══ 9. BOOTSTRAP ══════════════════════════════════════════════════
async function pollAlerts(){
  try{var r=await apiFetch('/api/tool-guard/alerts');var data=await r.json();
    var badge=document.getElementById('guard-badge');var unack=data.unacknowledged||0;
    if(unack>0){badge.textContent=unack>99?'99+':String(unack);badge.style.display='inline'}
    else{badge.style.display='none'}
  }catch(e){}
}

async function checkAuth(){
  var r=await apiFetch('/api/stats');
  if(r.status===401){
    var t=prompt('Enter Bastion Dashboard token:');
    if(t){_authToken=t.trim();localStorage.setItem('bastion_token',_authToken);
      var r2=await apiFetch('/api/stats');
      if(r2.status===401){localStorage.removeItem('bastion_token');_authToken='';
        document.body.innerHTML='<div style="color:#ff4444;text-align:center;padding:60px;font-size:14px">Invalid token. Reload to try again.</div>';return false}
    }else{document.body.innerHTML='<div style="color:#555;text-align:center;padding:60px;font-size:14px">Authentication required. Reload to enter token.</div>';return false}
  }
  return true;
}

(async function(){
  if(!await checkAuth())return;
  refreshOverview();
  pollAlerts();
  var _refreshBusy=false;
  setInterval(async function(){
    if(document.hidden||_refreshBusy)return;
    if(activePage==='log'||activePage==='settings')return;
    _refreshBusy=true;
    try{await refreshActivePage()}finally{_refreshBusy=false}
  },3000);
  setInterval(function(){if(!document.hidden)pollAlerts()},3000);
})();
</script>`;

const HTML = HEAD + '<body><div class="container">' +
  TITLEBAR + PAGE_OVERVIEW + PAGE_DLP + PAGE_GUARD + PAGE_LOG + PAGE_SETTINGS + FOOTER +
  '</div>' + SCRIPT + '</body></html>';

export function serveDashboard(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'pragma': 'no-cache',
  });
  res.end(HTML);
}
