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
.sub-tabs{display:flex;gap:2px;margin-bottom:16px;background:#161b22;border-radius:8px;padding:3px;border:1px solid #30363d}
.sub-tab{padding:6px 14px;cursor:pointer;color:#7d8590;font-size:12px;font-weight:500;border:none;background:none;border-radius:6px;transition:all .15s}
.sub-tab:hover{color:#e1e4e8}
.sub-tab.active{color:#e1e4e8;background:#30363d}
.sub-content{display:none}
.sub-content.active{display:block}
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
.tag.dlp{background:#3d1a3d;color:#f0a0f0}
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
.msg-bubble{padding:8px 12px;border-radius:8px;margin-bottom:6px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.msg-bubble.user{background:#1a2a3d;border:1px solid #264166}
.msg-bubble.assistant{background:#1a2d1a;border:1px solid #264d26}
.msg-bubble.system{background:#2a2a1a;border:1px solid #4d4d26}
.msg-role{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#7d8590;margin-bottom:4px;font-weight:600}
.msg-text{color:#e1e4e8}
.audit-kv{display:flex;gap:6px;align-items:baseline;margin-bottom:2px;font-size:12px}
.audit-kv .k{color:#7d8590;min-width:80px}
.audit-kv .v{color:#e1e4e8;font-family:"SF Mono",Monaco,monospace}
.timeline-card{margin-bottom:8px;cursor:pointer;transition:border-color .15s}
.timeline-card:hover{border-color:#58a6ff}
</style>
</head>
<body>
<h1><span class="status"></span>Bastion AI Gateway</h1>
<p class="subtitle">Local-first LLM proxy &mdash; auto-refresh</p>

<div class="tabs">
  <button class="tab active" data-tab="overview">Overview</button>
  <button class="tab" data-tab="dlp">DLP</button>
  <button class="tab" data-tab="optimizer">Optimizer</button>
  <button class="tab" data-tab="audit">Audit</button>
  <button class="tab" data-tab="toolguard">Tool Guard <span id="tg-badge" style="display:none;background:#f85149;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px;font-weight:700"></span></button>
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

  <div class="sub-tabs" id="dlp-sub-tabs">
    <button class="sub-tab active" data-dlp-sub="findings">Findings</button>
    <button class="sub-tab" data-dlp-sub="config">Config</button>
    <button class="sub-tab" data-dlp-sub="signatures">Signatures</button>
    <button class="sub-tab" data-dlp-sub="test">Test</button>
  </div>

  <!-- SUB: Config -->
  <div class="sub-content" id="dlp-sub-config">

  <!-- Unified DLP Configuration -->
  <div class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>Configuration</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <span id="dlp-dirty" style="display:none;color:#d29922;font-size:12px;font-weight:500">\u25cf Unsaved changes</span>
        <button id="dlp-revert-btn" style="display:none;padding:4px 12px;font-size:12px;cursor:pointer;color:#7d8590;background:none;border:1px solid #30363d;border-radius:6px">Revert</button>
        <button id="dlp-apply-btn" style="display:none;padding:4px 16px;font-size:12px;cursor:pointer;color:#fff;background:#238636;border:1px solid #2ea043;border-radius:6px">Apply</button>
      </div>
    </div>
    <div class="toggle-row">
      <div><div class="toggle-label">DLP Engine</div><div class="toggle-desc">Enable or disable DLP scanning</div></div>
      <label class="switch"><input type="checkbox" id="dlp-cfg-enabled"><span class="slider"></span></label>
    </div>
    <div class="toggle-row">
      <div><div class="toggle-label">Action Mode</div><div class="toggle-desc">What to do when sensitive data is detected</div></div>
      <select class="config-select" id="dlp-cfg-action">
        <option value="pass">Pass (log only)</option>
        <option value="warn">Warn</option>
        <option value="redact">Redact</option>
        <option value="block">Block</option>
      </select>
    </div>
    <div class="toggle-row">
      <div>
        <div class="toggle-label">AI Validation <span id="dlp-ai-status" style="font-size:11px;margin-left:6px"></span></div>
        <div class="toggle-desc">Use LLM to verify DLP matches and filter false positives</div>
      </div>
      <label class="switch"><input type="checkbox" id="dlp-cfg-ai"><span class="slider"></span></label>
    </div>
    <div style="margin-top:8px;padding:12px 16px;background:#161b22;border:1px solid #30363d;border-radius:8px">
      <div class="toggle-label" style="margin-bottom:8px">Semantic Detection (Layer 3)</div>
      <div style="margin-bottom:8px">
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Built-in Sensitive Patterns <span style="color:#484f58">(read-only)</span></div>
        <div id="dlp-builtin-sensitive" style="display:flex;flex-wrap:wrap;gap:4px"></div>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Extra Sensitive Patterns <span style="color:#484f58">(regex, one per line)</span></div>
        <textarea id="dlp-cfg-sensitive" rows="2" style="width:100%;background:#0f1117;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:6px;font-family:monospace;font-size:11px;resize:vertical" placeholder="e.g. \\bcert\\b"></textarea>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Built-in Non-sensitive Names <span style="color:#484f58">(read-only)</span></div>
        <div id="dlp-builtin-nonsensitive" style="display:flex;flex-wrap:wrap;gap:4px"></div>
      </div>
      <div>
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Extra Non-sensitive Names <span style="color:#484f58">(one per line)</span></div>
        <textarea id="dlp-cfg-nonsensitive" rows="2" style="width:100%;background:#0f1117;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:6px;font-family:monospace;font-size:11px;resize:vertical" placeholder="e.g. my_safe_field"></textarea>
      </div>
    </div>
  </div>

  <!-- Change History -->
  <div class="section">
    <h2 style="cursor:pointer;user-select:none" id="dlp-history-toggle">Change History <span id="dlp-history-count" style="font-size:11px;color:#484f58"></span> \u25BE</h2>
    <div id="dlp-history-list" style="display:none">
      <table><thead><tr><th>Time</th><th>Action</th><th>AI</th><th>Extra Sensitive</th><th>Extra Non-sensitive</th><th></th></tr></thead><tbody id="dlp-history-body"></tbody></table>
      <p class="empty" id="no-history">No changes recorded yet.</p>
    </div>
  </div>

  </div><!-- /dlp-sub-config -->

  <!-- SUB: Signatures -->
  <div class="sub-content" id="dlp-sub-signatures">

  <!-- Status + Controls -->
  <div class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <h2>Signatures</h2>
        <span id="sig-badge" style="display:none;font-size:11px;padding:2px 8px;border-radius:10px;background:#1f2937;border:1px solid #30363d;color:#7d8590"></span>
        <span id="sig-update" style="display:none;font-size:11px;padding:2px 8px;border-radius:10px;background:#2a1f00;border:1px solid #d29922;color:#d29922;cursor:pointer" title="Click to sync"></span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <div class="toggle-row" style="padding:0;gap:6px">
          <div style="font-size:12px;color:#7d8590">Auto-sync</div>
          <label class="switch"><input type="checkbox" id="sig-auto-sync"><span class="slider"></span></label>
        </div>
        <button id="sig-check-btn" style="padding:4px 10px;font-size:11px;cursor:pointer;color:#7d8590;background:none;border:1px solid #30363d;border-radius:6px">Check Update</button>
        <button id="sig-sync-btn" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#58a6ff;background:none;border:1px solid #1f3a5f;border-radius:6px">Sync Now</button>
      </div>
    </div>
    <div id="sig-status" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      <div style="padding:10px 14px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Version</div>
        <div id="sig-ver" style="font-size:16px;font-weight:600;color:#e1e4e8">-</div>
      </div>
      <div style="padding:10px 14px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Patterns</div>
        <div id="sig-count" style="font-size:16px;font-weight:600;color:#e1e4e8">-</div>
      </div>
      <div style="padding:10px 14px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Branch</div>
        <div id="sig-branch" style="font-size:16px;font-weight:600;color:#e1e4e8">-</div>
      </div>
      <div style="padding:10px 14px;background:#161b22;border:1px solid #30363d;border-radius:8px">
        <div style="font-size:11px;color:#7d8590;margin-bottom:4px">Last Synced</div>
        <div id="sig-synced" style="font-size:14px;font-weight:500;color:#e1e4e8">-</div>
      </div>
    </div>
    <div id="sig-not-synced" style="display:none;margin-top:12px;padding:12px 16px;text-align:center;color:#7d8590;font-size:13px;background:#161b22;border:1px solid #30363d;border-radius:8px">
      Not synced yet. Click <strong>Sync Now</strong> to pull the latest signatures.
    </div>
  </div>

  <!-- DLP Patterns -->
  <div class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2>DLP Patterns</h2>
      <button id="dlp-add-btn" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#3fb950;background:none;border:1px solid #3fb950;border-radius:6px">+ Add Pattern</button>
    </div>
    <div id="dlp-add-form" style="display:none;margin-bottom:12px;padding:12px 16px;background:#161b22;border:1px solid #30363d;border-radius:8px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <input id="dlp-new-name" placeholder="Name" style="background:#0f1117;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:4px;font-size:12px">
        <input id="dlp-new-regex" placeholder="Regex (e.g. \\bSECRET_\\w+)" style="background:#0f1117;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:4px;font-size:12px;font-family:monospace">
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-bottom:8px">
        <input id="dlp-new-desc" placeholder="Description" style="background:#0f1117;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:4px;font-size:12px">
        <input id="dlp-new-context" placeholder="Context words (comma-sep, optional)" style="background:#0f1117;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:4px;font-size:12px">
      </div>
      <div style="display:flex;gap:8px">
        <button id="dlp-save-btn" style="padding:4px 16px;font-size:12px;cursor:pointer;color:#fff;background:#238636;border:1px solid #2ea043;border-radius:6px">Save</button>
        <button id="dlp-cancel-btn" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#7d8590;background:none;border:1px solid #30363d;border-radius:6px">Cancel</button>
        <span id="dlp-form-error" style="color:#f85149;font-size:12px;align-self:center"></span>
      </div>
    </div>
    <table><thead><tr><th style="width:60px">Enabled</th><th>Name</th><th>Category</th><th>Regex</th><th>Description</th><th style="width:60px">Actions</th></tr></thead><tbody id="dlp-patterns"></tbody></table>
    <p class="empty" id="no-patterns">No patterns configured.</p>
  </div>

  <!-- Sync Log (collapsible) -->
  <div class="section">
    <div style="cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none" id="sig-log-toggle">
      <span id="sig-log-arrow" style="font-size:10px;color:#7d8590;transition:transform 0.2s">\u25b6</span>
      <h2 style="margin:0;font-size:14px">Sync Log</h2>
      <span id="sig-log-count" style="font-size:11px;color:#7d8590"></span>
    </div>
    <div id="sig-log-body" style="display:none;margin-top:8px;max-height:300px;overflow-y:auto">
      <div id="sig-log-entries" style="font-family:monospace;font-size:11px;line-height:1.7;color:#8b949e"></div>
      <p class="empty" id="sig-log-empty">No sync log entries.</p>
    </div>
  </div>

  </div><!-- /dlp-sub-signatures -->

  <!-- SUB: Findings -->
  <div class="sub-content active" id="dlp-sub-findings">
  <div class="grid" id="findings-cards"></div>
  <div class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2>DLP Findings</h2>
      <div class="filter-bar" style="margin:0">
        <select id="findings-action-filter" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:4px 8px;border-radius:4px;font-size:12px">
          <option value="">All actions</option>
          <option value="block">Block</option>
          <option value="redact">Redact</option>
          <option value="warn">Warn</option>
        </select>
        <select id="findings-dir-filter" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:4px 8px;border-radius:4px;font-size:12px">
          <option value="">All directions</option>
          <option value="request">Request</option>
          <option value="response">Response</option>
        </select>
      </div>
    </div>
    <table><thead><tr><th>Time</th><th>Dir</th><th>Request</th><th>Pattern</th><th>Category</th><th>Action</th><th>Matches</th><th>Original Snippet</th><th>Redacted Snippet</th></tr></thead><tbody id="findings-list"></tbody></table>
    <p class="empty" id="no-findings">No DLP findings yet.</p>
  </div>
  </div><!-- /dlp-sub-findings -->

  <!-- SUB: Test -->
  <div class="sub-content" id="dlp-sub-test">
  <div class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>DLP Scanner Test</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="scan-action" class="config-select">
          <option value="block">Block</option>
          <option value="redact">Redact</option>
          <option value="warn">Warn</option>
        </select>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#7d8590;cursor:pointer"><input type="checkbox" id="scan-trace"> Trace</label>
        <button id="scan-btn" style="padding:6px 20px;font-size:13px;cursor:pointer;color:#fff;background:#238636;border:1px solid #2ea043;border-radius:6px;font-weight:500">Scan</button>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:11px;color:#7d8590;align-self:center;margin-right:4px">Presets:</span>
        <button class="scan-preset" data-preset="clean" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#7d8590;background:#161b22;border:1px solid #30363d;border-radius:10px">Clean</button>
        <button class="scan-preset" data-preset="aws" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#f85149;background:#161b22;border:1px solid #30363d;border-radius:10px">AWS Key</button>
        <button class="scan-preset" data-preset="github" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#f85149;background:#161b22;border:1px solid #30363d;border-radius:10px">GitHub Token</button>
        <button class="scan-preset" data-preset="openai" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#f85149;background:#161b22;border:1px solid #30363d;border-radius:10px">OpenAI Key</button>
        <button class="scan-preset" data-preset="pem" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#f85149;background:#161b22;border:1px solid #30363d;border-radius:10px">Private Key</button>
        <button class="scan-preset" data-preset="password" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#f85149;background:#161b22;border:1px solid #30363d;border-radius:10px">Password</button>
        <button class="scan-preset" data-preset="cc" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#d29922;background:#161b22;border:1px solid #30363d;border-radius:10px">Credit Card</button>
        <button class="scan-preset" data-preset="ssn" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#d29922;background:#161b22;border:1px solid #30363d;border-radius:10px">SSN</button>
        <button class="scan-preset" data-preset="email" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#58a6ff;background:#161b22;border:1px solid #30363d;border-radius:10px">Email</button>
        <button class="scan-preset" data-preset="multi" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#f0a0f0;background:#161b22;border:1px solid #30363d;border-radius:10px">Multi</button>
        <button class="scan-preset" data-preset="json-secret" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#f0a0f0;background:#161b22;border:1px solid #30363d;border-radius:10px">JSON Secret</button>
        <button class="scan-preset" data-preset="llm-body" style="padding:2px 10px;font-size:11px;cursor:pointer;color:#b388ff;background:#161b22;border:1px solid #30363d;border-radius:10px">LLM Request</button>
      </div>
      <textarea id="scan-input" rows="8" placeholder="Paste or type text to scan for sensitive data..." style="width:100%;background:#0f1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:12px;font-family:'SF Mono',Monaco,monospace;font-size:12px;resize:vertical;line-height:1.6"></textarea>
    </div>
  </div>

  <div id="scan-result" style="display:none">
    <div class="grid" id="scan-result-cards" style="margin-bottom:16px"></div>

    <div class="section" id="scan-findings-section" style="display:none">
      <h2>Findings</h2>
      <table>
        <thead><tr><th>Pattern</th><th>Category</th><th>Matches</th><th>Matched Values</th></tr></thead>
        <tbody id="scan-findings-body"></tbody>
      </table>
    </div>

    <div id="scan-diff-section" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="card">
          <div class="label">Original</div>
          <pre id="scan-original" style="white-space:pre-wrap;word-break:break-all;font-family:'SF Mono',Monaco,monospace;font-size:11px;line-height:1.6;color:#e1e4e8;max-height:400px;overflow:auto;margin-top:8px"></pre>
        </div>
        <div class="card">
          <div class="label">Redacted</div>
          <pre id="scan-redacted" style="white-space:pre-wrap;word-break:break-all;font-family:'SF Mono',Monaco,monospace;font-size:11px;line-height:1.6;color:#e1e4e8;max-height:400px;overflow:auto;margin-top:8px"></pre>
        </div>
      </div>
    </div>

    <div id="scan-trace-section" style="display:none">
      <div class="section">
        <h2>Trace Log</h2>
        <div id="scan-trace-log" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;font-family:'SF Mono',Monaco,monospace;font-size:11px;line-height:1.7;max-height:500px;overflow:auto;white-space:pre-wrap;word-break:break-all"></div>
      </div>
    </div>
  </div>
  </div><!-- /dlp-sub-test -->

</div><!-- /tab-dlp -->

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
    <h2>Sessions</h2>
    <table><thead><tr><th>Time</th><th>Session</th><th>Project</th><th>Models</th><th>Requests</th><th></th></tr></thead><tbody id="audit-sessions"></tbody></table>
    <p class="empty" id="no-audit">No audit entries. Enable audit logging in Settings to start capturing request/response content.</p>
  </div>
  <div id="audit-timeline" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="margin:0">Session Timeline <span id="audit-session-label" class="mono" style="font-size:12px;color:#7d8590"></span></h2>
      <button id="audit-back" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#58a6ff;background:none;border:1px solid #30363d;border-radius:6px">Back to sessions</button>
    </div>
    <div id="audit-timeline-content"></div>
  </div>
  <div id="audit-detail" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="margin:0">Request Detail</h2>
      <div style="display:flex;gap:6px">
        <button id="audit-back-timeline" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#58a6ff;background:none;border:1px solid #30363d;border-radius:6px">Back to timeline</button>
        <button class="audit-view-tab active" data-view="parsed" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#58a6ff;background:none;border:1px solid #30363d;border-radius:6px">Parsed</button>
        <button class="audit-view-tab" data-view="raw" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#7d8590;background:none;border:1px solid #30363d;border-radius:6px">Raw</button>
      </div>
    </div>
    <div id="audit-parsed">
      <div class="grid" id="audit-meta-cards" style="margin-bottom:12px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="card"><div class="label">Messages (Input)</div><div id="audit-messages" style="max-height:500px;overflow:auto;font-size:12px"></div></div>
        <div class="card"><div class="label">Response Content</div><div id="audit-output" style="max-height:500px;overflow:auto;font-size:12px"></div></div>
      </div>
    </div>
    <div id="audit-raw" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="card"><div class="label">Request</div><pre class="snippet" id="audit-req" style="max-height:500px;overflow:auto"></pre></div>
        <div class="card"><div class="label">Response</div><pre class="snippet" id="audit-res" style="max-height:500px;overflow:auto"></pre></div>
      </div>
    </div>
  </div>
</div>

<!-- TOOL GUARD TAB -->
<div class="tab-content" id="tab-toolguard">
  <div id="tg-alert-banner" style="display:none;background:#3d1a1a;border:1px solid #f85149;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:none">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><span style="color:#f85149;font-weight:600;font-size:14px" id="tg-alert-title"></span><span style="color:#e1e4e8;font-size:12px;margin-left:8px" id="tg-alert-msg"></span></div>
      <button id="tg-ack-btn" style="padding:4px 12px;font-size:11px;cursor:pointer;color:#f85149;background:none;border:1px solid #f85149;border-radius:6px">Acknowledge</button>
    </div>
    <div id="tg-alert-list" style="margin-top:8px;font-size:11px;color:#7d8590;max-height:120px;overflow:auto"></div>
  </div>
  <div class="grid" id="tg-cards"></div>
  <div class="section">
    <h2>Recent Tool Calls</h2>
    <table><thead><tr><th>Time</th><th>Session</th><th>Tool Name</th><th>Severity</th><th>Category</th><th>Input</th></tr></thead><tbody id="tg-table"></tbody></table>
    <p class="empty" id="no-tg">No tool calls recorded yet.</p>
  </div>
  <div id="tg-detail" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="margin:0">Tool Call Detail</h2>
      <button id="tg-back" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#58a6ff;background:none;border:1px solid #30363d;border-radius:6px">Back</button>
    </div>
    <div id="tg-detail-content" class="card" style="font-size:12px"></div>
  </div>
</div>

<!-- SETTINGS TAB -->
<div class="tab-content" id="tab-settings">
  <div class="section">
    <h2>Plugin Controls</h2>
    <div id="plugin-toggles"></div>
  </div>
</div>

<p class="footer">Bastion v0.1.0 &mdash; <span id="uptime"></span> uptime &mdash; <span id="mem"></span> MB memory</p>

<script>
let activeTab='overview';
let _lastJson={}; // keyed by element ID — skip DOM rebuild if data unchanged
function skipIfSame(id,json){const s=JSON.stringify(json);if(_lastJson[id]===s)return true;_lastJson[id]=s;return false}
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
    activeTab=t.dataset.tab;
    document.getElementById('tab-'+activeTab).classList.add('active');
    refreshActiveTab();
  });
});
function refreshActiveTab(){
  if(activeTab==='overview')refresh();
  else if(activeTab==='dlp')refreshDlp();
  else if(activeTab==='optimizer')refreshOptimizer();
  else if(activeTab==='audit')refreshAudit();
  else if(activeTab==='toolguard')refreshToolGuard();
  else if(activeTab==='settings')refreshSettings();
}

// DLP sub-tab switching
document.querySelectorAll('#dlp-sub-tabs .sub-tab').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('#dlp-sub-tabs .sub-tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('#tab-dlp .sub-content').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('dlp-sub-'+t.dataset.dlpSub).classList.add('active');
    if(t.dataset.dlpSub==='findings')refreshFindings();
    if(t.dataset.dlpSub==='signatures'){refreshSignature(true);refreshPatterns();}
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
      const name=s.label||s.session_id.slice(0,8)+'...';
      const label=name+' ('+s.request_count+' reqs, '+cost(s.total_cost_usd)+')';
      sel.innerHTML+='<option value="'+s.session_id+'">'+esc(label)+'</option>';
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

    if(!skipIfSame('cards',s)){
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
    }

    const recent=d.recent||[];
    document.getElementById('no-requests').style.display=recent.length?'none':'';
    if(!skipIfSame('recent',recent)){
      document.getElementById('recent').innerHTML=recent.map(r=>{
        let flags='';
        if(r.cached)flags+='<span class="tag cached">cached</span> ';
        if(r.dlp_action&&r.dlp_action!=='pass')flags+=actionTag(r.dlp_action)+' ';
        if(r.session_id){
          const sInfo=sessions.find(s=>s.session_id===r.session_id);
          const sLabel=sInfo?.label||r.session_id.slice(0,6);
          flags+='<span class="tag" style="background:#1a2a3d;color:#58a6ff" title="'+esc(r.session_id)+'">'+esc(sLabel)+'</span> ';
        }
        return '<tr><td>'+ago(r.created_at)+'</td><td>'+providerTag(r.provider)+'</td>'+
          '<td class="mono">'+r.model+'</td><td>'+(r.status_code||'-')+'</td>'+
          '<td class="mono">'+fmt(r.input_tokens)+' / '+fmt(r.output_tokens)+'</td>'+
          '<td class="mono">'+cost(r.cost_usd)+'</td><td>'+r.latency_ms+'ms</td><td>'+flags+'</td></tr>';
      }).join('');
    }

    document.getElementById('uptime').textContent=uptime(d.uptime);
    document.getElementById('mem').textContent=Math.round(d.memory/1024/1024);
  }catch(e){}
}

// ── DLP Config: local state management ──
let dlpServerState=null; // {config, enabled} from server
let dlpBuiltinsLoaded=false;

function readDlpForm(){
  return {
    enabled:document.getElementById('dlp-cfg-enabled').checked,
    action:document.getElementById('dlp-cfg-action').value,
    aiEnabled:document.getElementById('dlp-cfg-ai').checked,
    sensitive:document.getElementById('dlp-cfg-sensitive').value,
    nonsensitive:document.getElementById('dlp-cfg-nonsensitive').value,
  };
}
function dlpFormSnapshot(){return JSON.stringify(readDlpForm())}
let dlpCleanSnapshot='';

function updateDirtyUI(){
  const dirty=dlpCleanSnapshot!==dlpFormSnapshot();
  document.getElementById('dlp-dirty').style.display=dirty?'':'none';
  document.getElementById('dlp-apply-btn').style.display=dirty?'':'none';
  document.getElementById('dlp-revert-btn').style.display=dirty?'':'none';
}

function populateDlpForm(config,enabled){
  document.getElementById('dlp-cfg-enabled').checked=!!enabled;
  document.getElementById('dlp-cfg-action').value=config.action||'warn';
  const aiVal=config.aiValidation||{};
  document.getElementById('dlp-cfg-ai').checked=!!aiVal.enabled;
  const aiSt=document.getElementById('dlp-ai-status');
  if(!aiVal.apiKey){
    aiSt.innerHTML='<span style="color:#d29922">No API key</span>';
    document.getElementById('dlp-cfg-ai').disabled=true;
  }else{
    aiSt.innerHTML=aiVal.enabled?'<span style="color:#3fb950">Active</span>':'<span style="color:#7d8590">Off</span>';
    document.getElementById('dlp-cfg-ai').disabled=false;
  }
  const sem=config.semantics||{};
  document.getElementById('dlp-cfg-sensitive').value=(sem.sensitivePatterns||[]).join('\\n');
  document.getElementById('dlp-cfg-nonsensitive').value=(sem.nonSensitiveNames||[]).join('\\n');
  dlpCleanSnapshot=dlpFormSnapshot();
  updateDirtyUI();
}

async function loadDlpConfig(){
  const r=await fetch('/api/config');
  const data=await r.json();
  const config=data.config?.plugins?.dlp||{};
  const enabled=data.pluginStatus?.['dlp-scanner']!==false;
  dlpServerState={config,enabled};
  populateDlpForm(config,enabled);
  // Load builtins once
  if(!dlpBuiltinsLoaded){
    try{
      const bRes=await fetch('/api/dlp/semantics/builtins');
      const b=await bRes.json();
      document.getElementById('dlp-builtin-sensitive').innerHTML=
        b.sensitivePatterns.map(p=>'<code style="background:#21262d;padding:2px 6px;border-radius:4px;font-size:11px;color:#7d8590">'+esc(p)+'</code>').join('');
      document.getElementById('dlp-builtin-nonsensitive').innerHTML=
        b.nonSensitiveNames.map(n=>'<code style="background:#21262d;padding:2px 6px;border-radius:4px;font-size:11px;color:#7d8590">'+esc(n)+'</code>').join('');
      dlpBuiltinsLoaded=true;
    }catch(e){}
  }
}

// Apply button
document.getElementById('dlp-apply-btn').addEventListener('click',async()=>{
  const f=readDlpForm();
  const payload={
    enabled:f.enabled,
    action:f.action,
    aiValidation:{enabled:f.aiEnabled},
    semantics:{
      sensitivePatterns:f.sensitive.split('\\n').map(s=>s.trim()).filter(Boolean),
      nonSensitiveNames:f.nonsensitive.split('\\n').map(s=>s.trim()).filter(Boolean),
    }
  };
  await fetch('/api/dlp/config/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  await loadDlpConfig();
  loadDlpHistory();
});

// Revert button
document.getElementById('dlp-revert-btn').addEventListener('click',()=>{
  if(dlpServerState) populateDlpForm(dlpServerState.config,dlpServerState.enabled);
});

// Dirty detection on form changes
['dlp-cfg-enabled','dlp-cfg-action','dlp-cfg-ai'].forEach(id=>{
  document.getElementById(id).addEventListener('change',updateDirtyUI);
});
['dlp-cfg-sensitive','dlp-cfg-nonsensitive'].forEach(id=>{
  document.getElementById(id).addEventListener('input',updateDirtyUI);
});

// History toggle
document.getElementById('dlp-history-toggle').addEventListener('click',()=>{
  const list=document.getElementById('dlp-history-list');
  list.style.display=list.style.display==='none'?'':'none';
  if(list.style.display!=='none') loadDlpHistory();
});

async function loadDlpHistory(){
  try{
    const r=await fetch('/api/dlp/config/history');
    const entries=await r.json();
    document.getElementById('dlp-history-count').textContent='('+entries.length+')';
    document.getElementById('no-history').style.display=entries.length?'none':'';
    document.getElementById('dlp-history-body').innerHTML=entries.map(e=>{
      let c={};try{c=JSON.parse(e.config_json)}catch(x){}
      const sem=c.semantics||{};
      const sp=(sem.sensitivePatterns||[]).length;
      const ns=(sem.nonSensitiveNames||[]).length;
      return '<tr><td>'+ago(e.created_at)+'</td>'+
        '<td>'+esc(c.action||'-')+'</td>'+
        '<td>'+(c.aiValidation?.enabled?'On':'Off')+'</td>'+
        '<td>'+sp+'</td><td>'+ns+'</td>'+
        '<td><button class="dlp-restore-btn" data-hid="'+e.id+'" style="padding:2px 8px;font-size:11px;cursor:pointer;color:#58a6ff;background:none;border:1px solid #30363d;border-radius:4px">Restore</button></td></tr>';
    }).join('');
    document.querySelectorAll('.dlp-restore-btn').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        if(!confirm('Restore this configuration?'))return;
        await fetch('/api/dlp/config/restore/'+btn.dataset.hid,{method:'POST'});
        await loadDlpConfig();
        loadDlpHistory();
      });
    });
  }catch(e){}
}

// DLP tab — config + patterns only
async function refreshDlp(){
  try{
    const statsR=await fetch('/api/stats');
    const stats=(await statsR.json()).dlp;
    if(!skipIfSame('dlp-cards',stats)){
      const ba=stats.by_action||{};
      document.getElementById('dlp-cards').innerHTML=
        card('Total Scans',fmt(stats.total_events))+
        card('Blocked',fmt(ba.block||0),'warn')+
        card('Redacted',fmt(ba.redact||0),'blue')+
        card('Warned',fmt(ba.warn||0));
    }
    await loadDlpConfig();
    refreshFindings();
  }catch(e){}
}

// Findings tab
let findingsAll=[];
async function refreshFindings(){
  try{
    const [statsR,recentR]=await Promise.all([fetch('/api/stats'),fetch('/api/dlp/recent?limit=200')]);
    const stats=(await statsR.json()).dlp;
    if(!skipIfSame('findings-cards',stats)){
      const ba=stats.by_action||{};
      document.getElementById('findings-cards').innerHTML=
        card('Total Findings',fmt(stats.total_events))+
        card('Blocked',fmt(ba.block||0),'warn')+
        card('Redacted',fmt(ba.redact||0),'blue')+
        card('Warned',fmt(ba.warn||0));
    }
    const newFindings=await recentR.json();
    if(!skipIfSame('findings-list',newFindings)){
      findingsAll=newFindings;
      renderFindings();
    }
  }catch(e){}
}

function renderFindings(){
  const af=document.getElementById('findings-action-filter').value;
  const df=document.getElementById('findings-dir-filter').value;
  let list=findingsAll;
  if(af) list=list.filter(e=>e.action===af);
  if(df) list=list.filter(e=>(e.direction||'request')===df);
  document.getElementById('no-findings').style.display=list.length?'none':'';
  document.getElementById('findings-list').innerHTML=list.map(e=>{
    const dir=e.direction||'request';
    const dirTag=dir==='response'?'<span class="tag warn">resp</span>':'<span class="tag" style="background:#1a2a3d;color:#58a6ff">req</span>';
    const rid=e.request_id||'';
    const modelTag=e.model?'<span class="mono" style="font-size:10px;color:#7d8590">'+esc(e.model)+'</span>':'';
    const reqCell='<span class="findings-expand-audit" data-rid="'+esc(rid)+'" style="cursor:pointer;color:#58a6ff;font-size:11px" title="Click to expand audit log">&#9654; '+esc(rid.slice(0,8))+'...</span>'+(modelTag?' '+modelTag:'');
    return '<tr><td>'+ago(e.created_at)+'</td><td>'+dirTag+'</td><td>'+reqCell+'</td><td class="mono">'+esc(e.pattern_name)+'</td><td>'+esc(e.pattern_category)+'</td>'+
      '<td>'+actionTag(e.action)+'</td><td>'+e.match_count+'</td>'+
      '<td><div class="snippet">'+esc(e.original_snippet||'-')+'</div></td>'+
      '<td><div class="snippet">'+esc(e.redacted_snippet||'-')+'</div></td></tr>';
  }).join('');
  document.querySelectorAll('.findings-expand-audit').forEach(el=>{
    el.addEventListener('click',async()=>{
      const rid=el.dataset.rid;
      if(!rid)return;
      const parentRow=el.closest('tr');
      const existing=parentRow.nextElementSibling;
      if(existing&&existing.classList.contains('findings-audit-row')){
        existing.remove();
        el.innerHTML='&#9654; '+esc(rid.slice(0,8))+'...';
        return;
      }
      // Remove any other expanded rows
      document.querySelectorAll('.findings-audit-row').forEach(r=>{
        const prev=r.previousElementSibling;
        if(prev){const s=prev.querySelector('.findings-expand-audit');if(s)s.innerHTML='&#9654; '+esc(s.dataset.rid.slice(0,8))+'...';}
        r.remove();
      });
      el.innerHTML='&#9660; '+esc(rid.slice(0,8))+'...';
      const detailRow=document.createElement('tr');
      detailRow.className='findings-audit-row';
      const td=document.createElement('td');
      td.colSpan=9;
      td.style.cssText='padding:0;border:none';
      td.innerHTML='<div style="margin:4px 12px 12px;padding:12px;background:#0d1117;border:1px solid #30363d;border-radius:6px"><span style="color:#7d8590">Loading audit log...</span></div>';
      detailRow.appendChild(td);
      parentRow.after(detailRow);
      try{
        const r=await fetch('/api/audit/'+rid+'?dlp=true');
        const data=await r.json();
        td.innerHTML=renderInlineAudit(data,rid);
      }catch(e){
        td.innerHTML='<div style="margin:4px 12px 12px;padding:12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#f85149">Failed to load audit log</div>';
      }
    });
  });
}

// Escape text with DLP match highlighting
function escHL(text,highlights){
  if(!highlights||!highlights.length)return esc(text);
  let result=text;
  const sorted=[...new Set(highlights)].sort((a,b)=>b.length-a.length);
  const phs=[];
  sorted.forEach((m,i)=>{
    const tag='\\x00HL'+i+'\\x00';
    result=result.split(m).join(tag);
    phs.push({tag,m,i});
  });
  result=esc(result);
  phs.forEach(({tag,m})=>{
    result=result.split(esc(tag)).join('<span style="background:#5c2020;color:#ff6b6b;border-radius:2px;padding:1px 3px;font-weight:600">'+esc(m)+'</span>');
  });
  return result;
}

function renderBlockHL(b,hl){
  if(b.type==='text')return '<div class="msg-text">'+escHL(b.text||'',hl)+'</div>';
  if(b.type==='image')return '<div class="msg-text" style="color:#7d8590">[image]</div>';
  if(b.type==='tool_use'){
    return '<div style="margin:4px 0;padding:6px 8px;background:#2a2a1a;border:1px solid #4d4d26;border-radius:6px;font-size:11px">'+
      '<div style="color:#ffd43b;font-size:10px;font-weight:600;margin-bottom:3px">TOOL_USE: '+esc(b.toolName||'?')+'</div>'+
      '<pre style="color:#e1e4e8;white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit">'+escHL(b.toolInput||'',hl)+'</pre></div>';
  }
  if(b.type==='tool_result'){
    const errStyle=b.isError?' color:#f85149;':'';
    return '<div style="margin:4px 0;padding:6px 8px;background:#1a2a2a;border:1px solid #264d4d;border-radius:6px;font-size:11px">'+
      '<div style="color:#58a6ff;font-size:10px;font-weight:600;margin-bottom:3px">TOOL_RESULT'+(b.isError?' (error)':'')+'</div>'+
      '<pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;'+errStyle+'">'+escHL(b.text||'',hl)+'</pre></div>';
  }
  return '<div class="msg-text" style="color:#7d8590">'+escHL(b.text||JSON.stringify(b),hl)+'</div>';
}

function renderInlineAudit(data,rid){
  const hl=data.dlpHighlights||[];
  const wrap=(inner)=>'<div style="margin:4px 12px 12px;padding:12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;font-size:12px">'+inner+'</div>';
  if(data.summaryOnly){
    const m=data.meta||{};
    const dlpTag=m.dlp_hit?'<span class="tag dlp">DLP</span> ':'';
    return wrap(
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">'+
      (m.model?card('Model',esc(m.model)):'')+
      card('Req Size',bytes(m.request_length||0))+
      card('Res Size',bytes(m.response_length||0))+
      (m.latency_ms?card('Latency',m.latency_ms+'ms'):'')+
      (m.status_code?card('Status',String(m.status_code)):'')+
      '</div>'+
      dlpTag+'<div style="color:#d29922;margin-bottom:6px;font-size:11px">Raw data not available (storage disabled). Summary only:</div>'+
      '<div class="msg-bubble system" style="white-space:pre-wrap;font-size:11px">'+esc(data.summary||'No summary')+'</div>'
    );
  }
  const req=data.request||{};
  const res=data.response||{};

  // Highlight badge
  const hlBadge=hl.length?'<div style="margin-bottom:8px;padding:4px 8px;background:#3d1f1f;border:1px solid #5c2020;border-radius:4px;font-size:11px;color:#ff6b6b">'+
    '<span style="font-weight:600">DLP Matches ('+hl.length+'):</span> '+hl.map(m=>'<code style="background:#5c2020;padding:1px 4px;border-radius:2px;font-size:10px">'+esc(m.length>40?m.slice(0,37)+'...':m)+'</code>').join(' ')+'</div>':'';

  // Meta cards
  const model=req.model||res.model;
  const usage=res.usage||{};
  let metaHtml='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
  if(model)metaHtml+=card('Model',esc(model));
  if(usage.input_tokens)metaHtml+=card('In',fmt(usage.input_tokens),'blue');
  if(usage.output_tokens)metaHtml+=card('Out',fmt(usage.output_tokens),'blue');
  if(res.stopReason)metaHtml+=card('Stop',esc(res.stopReason));
  metaHtml+='</div>';

  // Request messages
  let reqHtml='<div style="margin-bottom:8px"><div style="color:#58a6ff;font-weight:600;font-size:11px;margin-bottom:4px">REQUEST</div>';
  if(req.system){
    reqHtml+='<div class="msg-bubble system" style="font-size:11px"><div class="msg-role">system</div><div class="msg-text" style="max-height:150px;overflow-y:auto">'+escHL(req.system,hl)+'</div></div>';
  }
  if(req.tools&&req.tools.length>0){
    reqHtml+='<div style="margin:4px 0;padding:4px 8px;background:#1c2128;border:1px solid #30363d;border-radius:4px;font-size:10px">'+
      '<span style="color:#7d8590;font-weight:600">TOOLS ('+req.tools.length+'):</span> <span class="mono" style="color:#b388ff">'+req.tools.map(n=>esc(n)).join(', ')+'</span></div>';
  }
  if(req.messages&&req.messages.length>0){
    reqHtml+=req.messages.map(m=>{
      const role=m.role||'unknown';
      const cls=role==='user'?'user':role==='assistant'?'assistant':'system';
      const blocks=(m.content||[]).map(b=>renderBlockHL(b,hl)).join('');
      return '<div class="msg-bubble '+cls+'" style="font-size:11px"><div class="msg-role">'+esc(role)+'</div><div style="max-height:200px;overflow-y:auto">'+blocks+'</div></div>';
    }).join('');
  }
  reqHtml+='</div>';

  // Response content
  let resHtml='<div><div style="color:#3fb950;font-weight:600;font-size:11px;margin-bottom:4px">RESPONSE</div>';
  if(res.content&&res.content.length>0){
    resHtml+=res.content.map(b=>{
      if(b.type==='text')return '<div class="msg-bubble assistant" style="font-size:11px"><div class="msg-role">assistant</div><div class="msg-text" style="max-height:200px;overflow-y:auto">'+escHL(b.text||'',hl)+'</div></div>';
      if(b.type==='tool_use')return '<div class="msg-bubble system" style="font-size:11px"><div class="msg-role">tool_use: '+esc(b.toolName||'')+'</div><div class="msg-text" style="max-height:150px;overflow-y:auto">'+escHL(b.toolInput||'',hl)+'</div></div>';
      return renderBlockHL(b,hl);
    }).join('');
  }else{
    resHtml+='<div style="color:#484f58;font-size:11px">No response content</div>';
  }
  resHtml+='</div>';

  // Raw JSON toggle (also highlighted)
  const rawId='inline-raw-'+rid.replace(/[^a-zA-Z0-9]/g,'');
  let rawHtml='<div style="margin-top:8px;border-top:1px solid #21262d;padding-top:8px">'+
    '<span class="inline-raw-toggle" data-target="'+rawId+'" style="cursor:pointer;color:#7d8590;font-size:11px;user-select:none">&#9654; Raw JSON</span>'+
    '<div id="'+rawId+'" style="display:none;margin-top:6px">'+
    '<div style="color:#7d8590;font-size:10px;margin-bottom:2px">Request:</div>'+
    '<pre style="background:#161b22;border:1px solid #21262d;border-radius:4px;padding:8px;font-size:10px;color:#e1e4e8;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word">'+escHL(tryPrettyJson(data.raw?.request||''),hl)+'</pre>'+
    '<div style="color:#7d8590;font-size:10px;margin:6px 0 2px">Response:</div>'+
    '<pre style="background:#161b22;border:1px solid #21262d;border-radius:4px;padding:8px;font-size:10px;color:#e1e4e8;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word">'+escHL(tryPrettyJson(data.raw?.response||''),hl)+'</pre>'+
    '</div></div>';

  setTimeout(()=>{
    document.querySelectorAll('.inline-raw-toggle').forEach(t=>{
      t.onclick=()=>{
        const el=document.getElementById(t.dataset.target);
        if(!el)return;
        const show=el.style.display==='none';
        el.style.display=show?'':'none';
        t.innerHTML=(show?'&#9660;':'&#9654;')+' Raw JSON';
      };
    });
  },0);

  return wrap(hlBadge+metaHtml+reqHtml+resHtml+rawHtml);
}
document.getElementById('findings-action-filter').addEventListener('change',renderFindings);
document.getElementById('findings-dir-filter').addEventListener('change',renderFindings);

// ── DLP Test tab ──
const SCAN_PRESETS={
  clean:'What is the capital of France? Please explain in detail.',
  aws:'Deploy using AWS credentials:\\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  github:'Clone the repo with: git clone https://github.com/user/repo\\nUse token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk',
  openai:'Set OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234',
  pem:'Server private key:\\n-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB\\naFDrBz9vFqU4yVkzSzl9JYpP0kLgHrFhLXQ2RD3G7X1SE6tU0ZMaXR9T5eJA\\n-----END RSA PRIVATE KEY-----',
  password:'Database config:\\nDB_HOST=prod-db.internal\\nDB_USER=admin\\nDB_PASSWORD=xK9mP2vL5nR8qW4jB7fT3aZ6',
  cc:'Customer payment info:\\nName: John Doe\\nCard: 4111111111111111\\nExp: 12/25\\nSSN: 219-09-9999',
  ssn:'Employee record: Name=Alice Smith, SSN: 219-09-9999, DOB: 1990-01-15',
  email:'Please contact the user at their email address john.doe@company.com or call their phone number (555) 123-4567',
  multi:'Config dump:\\nAKIAIOSFODNN7EXAMPLE\\nghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk\\nsk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234\\npassword=SuperSecret123xK9m',
  'json-secret':JSON.stringify({model:'claude-haiku-4.5-20241022',config:{database_password:'xK9mP2vL5nR8qW4jB7fT3aZ6yU0cD1eH',api_secret:'aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3'}},null,2),
  'llm-body':JSON.stringify({model:'claude-haiku-4.5-20241022',max_tokens:1024,messages:[{role:'system',content:'You are a helpful assistant.'},{role:'user',content:'My server credentials are:\\nHost: 192.168.1.100\\nAPI Key: AKIAIOSFODNN7EXAMPLE\\nPassword: xK9mP2vL5nR8qW4jB7fT3aZ6\\nPlease help me configure the deployment.'}]},null,2),
};

document.querySelectorAll('.scan-preset').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const p=btn.dataset.preset;
    if(SCAN_PRESETS[p]!==undefined) document.getElementById('scan-input').value=SCAN_PRESETS[p];
    document.getElementById('scan-result').style.display='none';
  });
});

function highlightMatches(text,matches){
  if(!matches||!matches.length)return esc(text);
  let result=text;
  const sorted=[...new Set(matches)].sort((a,b)=>b.length-a.length);
  const placeholder=[];
  sorted.forEach((m,i)=>{
    const tag='\\x00MARK'+i+'\\x00';
    result=result.split(m).join(tag);
    placeholder.push({tag,m,i});
  });
  result=esc(result);
  placeholder.forEach(({tag,m,i})=>{
    result=result.split(esc(tag)).join('<span style="background:#5c2020;color:#ff6b6b;border-radius:2px;padding:0 2px">'+esc(m)+'</span>');
  });
  return result;
}

function highlightRedacted(text){
  if(!text)return'';
  return esc(text).replace(/\\[([A-Z_-]+_REDACTED)\\]/g,'<span style="background:#1a3d1a;color:#3fb950;border-radius:2px;padding:0 2px">[$1]</span>');
}

const TRACE_LAYER_COLORS={'-1':'#7d8590','0':'#58a6ff','1':'#d29922','2':'#b388ff','3':'#3fb950'};
const TRACE_LAYER_NAMES={'-1':'INIT','0':'STRUCT','1':'ENTROPY','2':'REGEX','3':'SEMANTIC'};
function renderTrace(trace){
  if(!trace||!trace.entries)return'';
  return trace.entries.map(e=>{
    const color=TRACE_LAYER_COLORS[e.layer]||'#7d8590';
    const label=TRACE_LAYER_NAMES[e.layer]||e.layerName;
    const dur=e.durationMs!==undefined?' <span style="color:#484f58">('+e.durationMs.toFixed(2)+'ms)</span>':'';
    const icon=e.step==='finding'||e.step==='summary'||e.step==='done'?'<span style="color:#3fb950">&#9679;</span> ':
      e.step.includes('skip')||e.step==='not-sensitive'||e.step==='low'||e.step==='dedup'?'<span style="color:#484f58">&#9675;</span> ':
      e.step==='high'||e.step==='match'||e.step==='context-match'?'<span style="color:#d29922">&#9679;</span> ':'  ';
    return icon+'<span style="color:'+color+';font-weight:600">['+esc(label)+']</span> <span style="color:#7d8590">'+esc(e.step)+'</span> '+esc(e.detail)+dur;
  }).join('\\n');
}

document.getElementById('scan-btn').addEventListener('click',async()=>{
  const text=document.getElementById('scan-input').value.trim();
  if(!text)return;
  const action=document.getElementById('scan-action').value;
  const enableTrace=document.getElementById('scan-trace').checked;
  const btn=document.getElementById('scan-btn');
  btn.textContent='Scanning...';btn.disabled=true;
  try{
    const r=await fetch('/api/dlp/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,action,trace:enableTrace})});
    const data=await r.json();
    if(data.error){alert(data.error);return;}
    const resultEl=document.getElementById('scan-result');
    resultEl.style.display='block';
    const n=data.findings.length;
    const allMatches=data.findings.flatMap(f=>f.matches||[]);
    const actionColor=data.action==='block'?'warn':data.action==='redact'?'blue':data.action==='pass'?'':'blue';
    const actionLabel=data.action==='pass'?'No findings':'Action: '+data.action;
    document.getElementById('scan-result-cards').innerHTML=
      card('Result',actionLabel,actionColor)+
      card('Findings',n.toString(),n>0?'warn':'')+
      card('Patterns',n>0?data.findings.map(f=>f.patternName).join(', '):'None','');
    const findSec=document.getElementById('scan-findings-section');
    if(n>0){
      findSec.style.display='';
      document.getElementById('scan-findings-body').innerHTML=data.findings.map(f=>{
        const catClass=f.patternCategory==='high-confidence'?'cached':f.patternCategory==='validated'?'blue':f.patternCategory==='context-aware'?'warn':'redact';
        const matchDisp=(f.matches||[]).map(m=>'<div class="snippet" style="margin-bottom:2px;display:inline-block">'+esc(m.length>60?m.slice(0,60)+'...':m)+'</div>').join(' ');
        return '<tr><td class="mono" style="font-size:12px;white-space:nowrap">'+esc(f.patternName)+'</td>'+
          '<td><span class="tag '+catClass+'">'+esc(f.patternCategory)+'</span></td>'+
          '<td>'+f.matchCount+'</td><td>'+matchDisp+'</td></tr>';
      }).join('');
    }else{findSec.style.display='none';}
    const diffSec=document.getElementById('scan-diff-section');
    if(n>0){
      diffSec.style.display='';
      document.getElementById('scan-original').innerHTML=highlightMatches(text,allMatches);
      document.getElementById('scan-redacted').innerHTML=data.redactedText?highlightRedacted(data.redactedText):'<span style="color:#7d8590">(action is not redact)</span>';
    }else{diffSec.style.display='none';}
    // Trace log
    const traceSec=document.getElementById('scan-trace-section');
    if(data.trace&&data.trace.entries&&data.trace.entries.length>0){
      traceSec.style.display='';
      document.getElementById('scan-trace-log').innerHTML=renderTrace(data.trace);
    }else{traceSec.style.display='none';}
  }catch(e){alert('Scan failed: '+e.message);}
  finally{btn.textContent='Scan';btn.disabled=false;}
});

document.getElementById('scan-input').addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();document.getElementById('scan-btn').click();}
});

// DLP Patterns management
async function refreshPatterns(){
  try{
    const r=await fetch('/api/dlp/patterns');
    const patterns=await r.json();
    document.getElementById('no-patterns').style.display=patterns.length?'none':'';
    document.getElementById('dlp-patterns').innerHTML=patterns.map(p=>{
      const catClass=p.category==='high-confidence'?'cached':p.category==='validated'?'blue':p.category==='context-aware'?'warn':'redact';
      const regexDisp=esc(p.regex_source.length>40?p.regex_source.slice(0,40)+'...':p.regex_source);
      const delBtn=p.is_builtin?'':'<button class="dlp-del-btn" data-id="'+esc(p.id)+'" style="cursor:pointer;color:#f85149;background:none;border:1px solid #3d1a1a;border-radius:4px;padding:2px 8px;font-size:11px">Del</button>';
      return '<tr><td><label class="switch" style="margin:0"><input type="checkbox" data-pid="'+esc(p.id)+'"'+(p.enabled?' checked':'')+'><span class="slider"></span></label></td>'+
        '<td class="mono" style="font-size:12px">'+esc(p.name)+'</td>'+
        '<td><span class="tag '+catClass+'">'+esc(p.category)+'</span></td>'+
        '<td class="mono" style="font-size:11px" title="'+esc(p.regex_source)+'">'+regexDisp+'</td>'+
        '<td style="font-size:12px;color:#7d8590">'+esc(p.description||'-')+'</td>'+
        '<td>'+delBtn+'</td></tr>';
    }).join('');
    // Bind toggle switches
    document.querySelectorAll('#dlp-patterns input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change',async()=>{
        await fetch('/api/dlp/patterns/'+encodeURIComponent(cb.dataset.pid),{
          method:'PUT',headers:{'content-type':'application/json'},
          body:JSON.stringify({enabled:cb.checked})
        });
      });
    });
    // Bind delete buttons
    document.querySelectorAll('.dlp-del-btn').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        if(!confirm('Delete this custom pattern?'))return;
        await fetch('/api/dlp/patterns/'+encodeURIComponent(btn.dataset.id),{method:'DELETE'});
        refreshPatterns();
      });
    });
  }catch(e){console.error('Pattern refresh error',e)}
}

// Signature management
const sigLog=[];
function addSigLog(msg,ok){
  sigLog.unshift({time:new Date().toLocaleTimeString(),msg,ok});
  if(sigLog.length>50)sigLog.length=50;
  renderSigLog();
}
function renderSigLog(){
  const el=document.getElementById('sig-log-entries');
  const empty=document.getElementById('sig-log-empty');
  if(!sigLog.length){empty.style.display='';el.innerHTML='';document.getElementById('sig-log-count').textContent='';return;}
  empty.style.display='none';
  document.getElementById('sig-log-count').textContent='('+sigLog.length+')';
  el.innerHTML=sigLog.map(e=>{
    const color=e.ok===false?'#f85149':e.ok===true?'#3fb950':'#7d8590';
    return '<div style="padding:3px 0;border-bottom:1px solid #21262d"><span style="color:#484f58">'+esc(e.time)+'</span> <span style="color:'+color+'">'+esc(e.msg)+'</span></div>';
  }).join('');
}
document.getElementById('sig-log-toggle').addEventListener('click',()=>{
  const body=document.getElementById('sig-log-body');
  const arrow=document.getElementById('sig-log-arrow');
  if(body.style.display==='none'){body.style.display='';arrow.style.transform='rotate(90deg)';}
  else{body.style.display='none';arrow.style.transform='';}
});
async function refreshSignature(checkRemote){
  try{
    const url=checkRemote?'/api/dlp/signature?check=true':'/api/dlp/signature';
    const r=await fetch(url);
    const s=await r.json();
    const badge=document.getElementById('sig-badge');
    const upd=document.getElementById('sig-update');
    const notSynced=document.getElementById('sig-not-synced');
    if(s.local){
      badge.textContent='#'+s.local.version;
      badge.style.display='';
      document.getElementById('sig-ver').textContent='#'+s.local.version;
      document.getElementById('sig-count').textContent=s.local.patternCount;
      document.getElementById('sig-branch').textContent=s.local.branch;
      document.getElementById('sig-synced').textContent=new Date(s.local.syncedAt).toLocaleString();
      document.getElementById('sig-status').style.display='';
      notSynced.style.display='none';
    }else{
      badge.style.display='none';
      document.getElementById('sig-ver').textContent='-';
      document.getElementById('sig-count').textContent='-';
      document.getElementById('sig-branch').textContent='-';
      document.getElementById('sig-synced').textContent='-';
      document.getElementById('sig-status').style.display='';
      notSynced.style.display='';
    }
    if(s.updateAvailable&&s.remote){
      upd.textContent='#'+s.remote.version+' available';
      upd.title='Click to sync to #'+s.remote.version+' ('+s.remote.patternCount+' patterns)';
      upd.style.display='';
      upd.onclick=()=>syncSignature();
      if(checkRemote)addSigLog('Update available: #'+s.remote.version+' ('+s.remote.patternCount+' patterns)',null);
    }else{
      upd.style.display='none';
      if(checkRemote&&s.local)addSigLog('Already up to date (#'+s.local.version+')',true);
    }
    // Auto-sync toggle
    const cfgR=await fetch('/api/config');
    const cfg=await cfgR.json();
    const rp=cfg.config?.plugins?.dlp?.remotePatterns||{};
    document.getElementById('sig-auto-sync').checked=rp.syncOnStart!==false;
  }catch(e){console.error('Signature refresh error',e)}
}
async function syncSignature(){
  const syncBtn=document.getElementById('sig-sync-btn');
  const oldText=syncBtn.textContent;
  syncBtn.textContent='Syncing...';syncBtn.disabled=true;
  addSigLog('Sync started...',null);
  try{
    const r=await fetch('/api/dlp/signature/sync',{method:'POST'});
    const data=await r.json();
    if(data.ok){
      addSigLog('Sync complete: '+data.synced+' patterns synced'+(data.signature?' (v#'+data.signature.version+')':''),true);
      refreshPatterns();
      refreshSignature(false);
    }else{
      addSigLog('Sync failed: '+(data.error||'unknown error'),false);
    }
  }catch(e){addSigLog('Sync error: '+e.message,false)}
  finally{syncBtn.textContent=oldText;syncBtn.disabled=false}
}
document.getElementById('sig-sync-btn').addEventListener('click',syncSignature);
document.getElementById('sig-check-btn').addEventListener('click',()=>{
  addSigLog('Checking for updates...',null);
  refreshSignature(true);
});
document.getElementById('sig-auto-sync').addEventListener('change',async function(){
  const enabled=this.checked;
  try{
    await fetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({plugins:{dlp:{remotePatterns:{syncOnStart:enabled}}}})});
    addSigLog('Auto-sync '+(enabled?'enabled':'disabled'),true);
  }catch(e){addSigLog('Failed to update auto-sync: '+e.message,false)}
});

// Add pattern form
document.getElementById('dlp-add-btn').addEventListener('click',()=>{
  document.getElementById('dlp-add-form').style.display='';
  document.getElementById('dlp-form-error').textContent='';
});
document.getElementById('dlp-cancel-btn').addEventListener('click',()=>{
  document.getElementById('dlp-add-form').style.display='none';
});
document.getElementById('dlp-save-btn').addEventListener('click',async()=>{
  const name=document.getElementById('dlp-new-name').value.trim();
  const regex=document.getElementById('dlp-new-regex').value.trim();
  const desc=document.getElementById('dlp-new-desc').value.trim();
  const ctx=document.getElementById('dlp-new-context').value.trim();
  const errEl=document.getElementById('dlp-form-error');
  if(!name||!regex){errEl.textContent='Name and Regex are required';return}
  try{new RegExp(regex)}catch(e){errEl.textContent='Invalid regex: '+e.message;return}
  const payload={name,regex_source:regex,description:desc||null,require_context:ctx?JSON.stringify(ctx.split(',').map(s=>s.trim()).filter(Boolean)):null};
  const r=await fetch('/api/dlp/patterns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json();
  if(!r.ok){errEl.textContent=data.error||'Failed to save';return}
  document.getElementById('dlp-add-form').style.display='none';
  document.getElementById('dlp-new-name').value='';
  document.getElementById('dlp-new-regex').value='';
  document.getElementById('dlp-new-desc').value='';
  document.getElementById('dlp-new-context').value='';
  refreshPatterns();
});

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

// Audit tab — session-grouped view
let auditCurrentSession=null;

async function refreshAudit(){
  try{
    const r=await fetch('/api/audit/sessions');
    const sessions=await r.json();
    document.getElementById('no-audit').style.display=sessions.length?'none':'';
    document.getElementById('audit-sessions').innerHTML=sessions.map(s=>{
      const models=(s.models||'').split(',').map(m=>'<span class="tag" style="background:#1a2a3d;color:#58a6ff">'+esc(m.trim())+'</span>').join(' ');
      const sourceTag=s.source==='wrap'?' <span class="tag" style="background:#0d2818;color:#3fb950;font-size:10px">wrap</span>':'';
      const sessionId='<span class="mono" style="font-size:11px;color:#7d8590">'+esc(s.session_id.slice(0,8))+'</span>'+sourceTag;
      const projectLabel=s.label
        ?'<span style="color:#f0f3f6;font-weight:500" title="'+esc(s.project_path||'')+'">'+esc(s.label)+'</span>'
        :'<span style="color:#484f58">-</span>';
      return '<tr style="cursor:pointer" data-sid="'+esc(s.session_id)+'">'+
        '<td>'+ago(s.last_at)+'</td>'+
        '<td>'+sessionId+'</td>'+
        '<td>'+projectLabel+'</td>'+
        '<td>'+models+'</td>'+
        '<td>'+s.request_count+'</td>'+
        '<td style="color:#58a6ff">View</td></tr>';
    }).join('');
    // Also show non-session entries
    const recentR=await fetch('/api/audit/recent');
    const recent=await recentR.json();
    const noSession=recent.filter(e=>!e.session_id);
    if(noSession.length>0){
      document.getElementById('audit-sessions').innerHTML+=
        '<tr><td colspan="6" style="color:#7d8590;font-size:11px;padding-top:12px">Requests without session:</td></tr>'+
        noSession.map(e=>{
          const dlpTag=e.dlp_hit?'<span class="tag dlp">DLP</span> ':'';
          const summaryText=e.summary?'<div style="font-size:11px;color:#7d8590;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="'+esc(e.summary)+'">'+esc(e.summary.slice(0,80))+'</div>':'';
          return '<tr style="cursor:pointer" data-rid="'+e.request_id+'"><td>'+ago(e.created_at)+'</td>'+
          '<td class="mono" style="font-size:11px">'+e.request_id.slice(0,12)+'...</td>'+
          '<td>'+summaryText+'</td>'+
          '<td>'+dlpTag+(e.model?'<span class="tag" style="background:#1a2a3d;color:#58a6ff">'+esc(e.model)+'</span>':'')+'</td>'+
          '<td class="mono">'+bytes(e.request_length)+'</td>'+
          '<td style="color:#58a6ff">View</td></tr>';
        }).join('');
    }
    bindAuditSessionClicks();
    bindAuditSingleClicks();
  }catch(e){ console.error('Audit refresh error',e) }
}

function bindAuditSessionClicks(){
  document.querySelectorAll('#audit-sessions tr[data-sid]').forEach(row=>{
    row.addEventListener('click',()=>loadSessionTimeline(row.dataset.sid));
  });
}

function bindAuditSingleClicks(){
  document.querySelectorAll('#audit-sessions tr[data-rid]').forEach(row=>{
    row.addEventListener('click',()=>loadSingleAudit(row.dataset.rid));
  });
}

async function loadSessionTimeline(sessionId){
  auditCurrentSession=sessionId;
  try{
    const r=await fetch('/api/audit/session/'+sessionId);
    const data=await r.json();
    const timeline=data.timeline||data;
    const sessionMeta=data.session||null;
    document.querySelector('#tab-audit .section').style.display='none';
    document.getElementById('audit-timeline').style.display='block';
    document.getElementById('audit-detail').style.display='none';
    const labelEl=document.getElementById('audit-session-label');
    const projName=sessionMeta?.label||'';
    const projPath=sessionMeta?.project_path||'';
    const shortId=sessionId.slice(0,8);
    labelEl.innerHTML=projName
      ?esc(projName)+' <span style="color:#484f58;font-size:11px">'+esc(shortId)+'</span> \u2014 '+timeline.length+' requests'+(projPath?'<br><span style="font-size:11px;color:#484f58">'+esc(projPath)+'</span>':'')
      :esc(shortId)+'... \u2014 '+timeline.length+' requests';

    let html='';
    timeline.forEach((entry,i)=>{
      const m=entry.meta;
      const p=entry.parsed;
      const model=p.request.model||p.response.model||m.model||'?';
      const stopReason=p.response.stopReason||'';
      const stopTag=stopReason==='end_turn'?'<span class="tag cached">end_turn</span>':
        stopReason==='tool_use'?'<span class="tag" style="background:#2a2a1a;color:#ffd43b">tool_use</span>':
        stopReason?'<span class="tag">'+esc(stopReason)+'</span>':'';

      // Summary of response
      let responseSummary='';
      for(const c of (p.response.content||[])){
        if(c.type==='text'&&c.text){
          responseSummary+=esc(c.text.slice(0,120))+(c.text.length>120?'...':'');
        }
        if(c.type==='tool_use'){
          responseSummary+='<span style="color:#ffd43b">[tool: '+esc(c.toolName||'?')+']</span> ';
        }
      }

      // Summary of last user message
      let userSummary='';
      const msgs=p.request.messages||[];
      const lastUser=msgs.filter(x=>x.role==='user').pop();
      if(lastUser){
        for(const c of (lastUser.content||[])){
          if(c.type==='text'&&c.text){userSummary=esc(c.text.slice(0,100))+(c.text.length>100?'...':'');break}
          if(c.type==='tool_result'){userSummary='<span style="color:#58a6ff">[tool_result]</span> '+esc((c.text||'').slice(0,80));break}
        }
      }

      const usage=p.response.usage||{};
      const tokens=(usage.input_tokens||0)+(usage.output_tokens||0);

      const dlpTag=m.dlp_hit?'<span class="tag dlp">DLP</span>':'';
      html+='<div class="card timeline-card" data-rid="'+esc(m.request_id)+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<div style="display:flex;gap:8px;align-items:center">'+
            '<span style="color:#484f58;font-size:11px;font-weight:600">#'+(i+1)+'</span>'+
            '<span class="mono" style="font-size:11px;color:#7d8590">'+esc(model)+'</span>'+
            stopTag+dlpTag+
            (tokens?'<span style="font-size:11px;color:#7d8590">'+fmt(tokens)+' tok</span>':'')+
          '</div>'+
          '<span style="font-size:11px;color:#484f58">'+ago(m.created_at)+(m.latency_ms?' · '+m.latency_ms+'ms':'')+'</span>'+
        '</div>'+
        (userSummary?'<div style="font-size:12px;color:#58a6ff;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">User: '+userSummary+'</div>':'')+
        (responseSummary?'<div style="font-size:12px;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Response: '+responseSummary+'</div>':'')+
      '</div>';
    });

    document.getElementById('audit-timeline-content').innerHTML=html;

    // Bind clicks on timeline cards
    document.querySelectorAll('#audit-timeline-content .card[data-rid]').forEach(card=>{
      card.addEventListener('click',()=>loadSingleAudit(card.dataset.rid));
    });
  }catch(e){ console.error('Session load error',e) }
}

async function loadSingleAudit(requestId){
  try{
    const r=await fetch('/api/audit/'+requestId);
    const data=await r.json();
    document.querySelector('#tab-audit .section').style.display='none';
    document.getElementById('audit-timeline').style.display=auditCurrentSession?'none':'none';
    document.getElementById('audit-detail').style.display='block';

    // Handle summary-only mode (rawData off)
    if(data.summaryOnly){
      const rawTab=document.querySelector('.audit-view-tab[data-view="raw"]');
      rawTab.style.display='none';
      document.getElementById('audit-raw').style.display='none';
      document.getElementById('audit-parsed').style.display='';
      const m=data.meta||{};
      const dlpTag=m.dlp_hit?'<span class="tag dlp">DLP</span> ':'';
      document.getElementById('audit-meta-cards').innerHTML=
        (m.model?card('Model',esc(m.model)):'')+
        card('Request Size',bytes(m.request_length||0))+
        card('Response Size',bytes(m.response_length||0))+
        (m.latency_ms?card('Latency',m.latency_ms+'ms'):'')+
        (m.status_code?card('Status',String(m.status_code)):'');
      document.getElementById('audit-messages').innerHTML=
        '<div class="empty" style="text-align:left">'+dlpTag+
        '<div style="margin-bottom:8px;color:#d29922">Raw data not available (storage disabled). Summary only:</div>'+
        '<div class="msg-bubble system" style="white-space:pre-wrap">'+esc(data.summary||'No summary')+'</div></div>';
      document.getElementById('audit-output').innerHTML='<div class="empty">Raw data not stored</div>';
      return;
    }

    // Normal mode — show raw tab
    const rawTab=document.querySelector('.audit-view-tab[data-view="raw"]');
    rawTab.style.display='';
    // Raw view
    document.getElementById('audit-req').textContent=tryPrettyJson(data.raw.request);
    document.getElementById('audit-res').textContent=tryPrettyJson(data.raw.response);
    // Parsed view
    renderParsedAudit(data);
  }catch(e){ console.error('Audit load error',e) }
}

// Back buttons
document.getElementById('audit-back').addEventListener('click',()=>{
  auditCurrentSession=null;
  document.getElementById('audit-timeline').style.display='none';
  document.getElementById('audit-detail').style.display='none';
  document.querySelector('#tab-audit .section').style.display='';
});
document.getElementById('audit-back-timeline').addEventListener('click',()=>{
  document.getElementById('audit-detail').style.display='none';
  if(auditCurrentSession){
    document.getElementById('audit-timeline').style.display='block';
  }else{
    document.querySelector('#tab-audit .section').style.display='';
  }
});

// Audit parsed/raw tab toggle
document.querySelectorAll('.audit-view-tab').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('.audit-view-tab').forEach(x=>{x.style.color='#7d8590'});
    t.style.color='#58a6ff';
    document.getElementById('audit-parsed').style.display=t.dataset.view==='parsed'?'':'none';
    document.getElementById('audit-raw').style.display=t.dataset.view==='raw'?'':'none';
  });
});

function tryPrettyJson(s){
  try{return JSON.stringify(JSON.parse(s),null,2)}catch(e){return s}
}

// Render a single content block (pre-parsed by backend)
function renderBlock(b){
  if(b.type==='text')return '<div class="msg-text">'+esc(b.text||'')+'</div>';
  if(b.type==='image')return '<div class="msg-text" style="color:#7d8590">[image]</div>';
  if(b.type==='tool_use'){
    return '<div style="margin:4px 0;padding:6px 8px;background:#2a2a1a;border:1px solid #4d4d26;border-radius:6px;font-size:11px">'+
      '<div style="color:#ffd43b;font-size:10px;font-weight:600;margin-bottom:3px">TOOL_USE: '+esc(b.toolName||'?')+'</div>'+
      '<pre style="color:#e1e4e8;white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit">'+esc(b.toolInput||'')+'</pre></div>';
  }
  if(b.type==='tool_result'){
    const errStyle=b.isError?' color:#f85149;':'';
    return '<div style="margin:4px 0;padding:6px 8px;background:#1a2a2a;border:1px solid #264d4d;border-radius:6px;font-size:11px">'+
      '<div style="color:#58a6ff;font-size:10px;font-weight:600;margin-bottom:3px">TOOL_RESULT'+(b.isError?' (error)':'')+'</div>'+
      '<pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;'+errStyle+'">'+esc(b.text||'')+'</pre></div>';
  }
  return '<div class="msg-text" style="color:#7d8590">'+esc(b.text||JSON.stringify(b))+'</div>';
}

function renderParsedAudit(data){
  const req=data.request;
  const res=data.response;

  // --- Meta cards ---
  const cards=[];
  const model=req.model||res.model;
  if(model)cards.push(card('Model',esc(model)));
  if(req.maxTokens)cards.push(card('Max Tokens',fmt(req.maxTokens)));
  if(req.temperature!=null)cards.push(card('Temperature',String(req.temperature)));
  cards.push(card('Stream',req.stream?'Yes':'No'));

  const usage=res.usage||{};
  if(usage.input_tokens)cards.push(card('Input Tokens',fmt(usage.input_tokens),'blue'));
  if(usage.output_tokens)cards.push(card('Output Tokens',fmt(usage.output_tokens),'blue'));
  if(usage.cache_creation_input_tokens)cards.push(card('Cache Create',fmt(usage.cache_creation_input_tokens)));
  if(usage.cache_read_input_tokens)cards.push(card('Cache Read',fmt(usage.cache_read_input_tokens),'cost'));
  if(res.stopReason)cards.push(card('Stop Reason',esc(res.stopReason)));

  document.getElementById('audit-meta-cards').innerHTML=cards.join('');

  // --- Request side ---
  const msgEl=document.getElementById('audit-messages');
  let html='';

  if(req.system){
    html+='<div class="msg-bubble system"><div class="msg-role">system</div><div class="msg-text">'+esc(req.system)+'</div></div>';
  }

  if(req.tools&&req.tools.length>0){
    html+='<div style="margin:6px 0;padding:6px 10px;background:#1c2128;border:1px solid #30363d;border-radius:6px;font-size:11px">'+
      '<span style="color:#7d8590;font-weight:600">TOOLS ('+req.tools.length+'):</span> '+
      '<span class="mono" style="color:#b388ff">'+req.tools.map(n=>esc(n)).join(', ')+'</span></div>';
  }

  if(req.messages&&req.messages.length>0){
    html+=req.messages.map(m=>{
      const role=m.role||'unknown';
      const cls=role==='user'?'user':role==='assistant'?'assistant':'system';
      const blocks=(m.content||[]).map(renderBlock).join('');
      return '<div class="msg-bubble '+cls+'"><div class="msg-role">'+esc(role)+'</div>'+blocks+'</div>';
    }).join('');
  }

  msgEl.innerHTML=html||'<div class="empty">No request data</div>';

  // --- Response side ---
  const outEl=document.getElementById('audit-output');
  if(res.content&&res.content.length>0){
    outEl.innerHTML=res.content.map(b=>{
      if(b.type==='text')return '<div class="msg-bubble assistant"><div class="msg-role">assistant</div><div class="msg-text">'+esc(b.text||'')+'</div></div>';
      if(b.type==='tool_use')return '<div class="msg-bubble system"><div class="msg-role">tool_use: '+esc(b.toolName||'')+'</div><div class="msg-text">'+esc(b.toolInput||'')+'</div></div>';
      return renderBlock(b);
    }).join('');
  }else{
    outEl.innerHTML='<div class="empty">No response content</div>';
  }
}

// Tool Guard — alert polling
async function pollToolGuardAlerts(){
  try{
    const r=await fetch('/api/tool-guard/alerts');
    const data=await r.json();
    const badge=document.getElementById('tg-badge');
    const banner=document.getElementById('tg-alert-banner');
    const unack=data.unacknowledged||0;
    if(unack>0){
      badge.textContent=unack>99?'99+':String(unack);
      badge.style.display='inline';
      banner.style.display='block';
      document.getElementById('tg-alert-title').textContent=unack+' unacknowledged alert'+(unack>1?'s':'');
      const recent=data.alerts.filter(a=>!a.acknowledged).slice(0,5);
      document.getElementById('tg-alert-msg').textContent=recent.length>0?recent[0].toolName+': '+recent[0].ruleName:'';
      document.getElementById('tg-alert-list').innerHTML=recent.map(a=>
        '<div>'+severityTag(a.severity)+' <strong>'+esc(a.toolName)+'</strong> — '+esc(a.ruleName)+' <span style="color:#484f58">'+ago(a.timestamp)+'</span></div>'
      ).join('');
    }else{
      badge.style.display='none';
      banner.style.display='none';
    }
  }catch(e){}
}

document.getElementById('tg-ack-btn').addEventListener('click',async()=>{
  await fetch('/api/tool-guard/alerts/ack',{method:'POST'});
  pollToolGuardAlerts();
});

// Tool Guard tab
function severityTag(s){
  if(!s)return '<span class="tag" style="background:#21262d;color:#484f58">none</span>';
  const colors={critical:'background:#3d1a1a;color:#f85149',high:'background:#3d2e1a;color:#d29922',medium:'background:#2a2a1a;color:#ffd43b',low:'background:#1a2a3d;color:#58a6ff'};
  return '<span class="tag" style="'+(colors[s]||'')+'">'+(s||'none')+'</span>';
}

async function refreshToolGuard(){
  try{
    const [statsR,recentR,cfgR]=await Promise.all([fetch('/api/tool-guard/stats'),fetch('/api/tool-guard/recent?limit=100'),fetch('/api/config')]);
    const stats=await statsR.json();
    const recent=await recentR.json();
    const cfgData=await cfgR.json();
    const tgAction=cfgData.config?.plugins?.toolGuard?.action||'audit';
    const modeLabel=tgAction==='block'?'BLOCK':'AUDIT';
    const modeCls=tgAction==='block'?'warn':'blue';

    if(!skipIfSame('tg-cards',{stats,tgAction})){
      document.getElementById('tg-cards').innerHTML=
        card('Mode',modeLabel,modeCls)+
        card('Total Tool Calls',fmt(stats.total))+
        card('Flagged',fmt(stats.flagged),'warn')+
        card('Critical',(stats.bySeverity?.critical||0).toString(),'warn');
    }

    document.getElementById('no-tg').style.display=recent.length?'none':'';
    if(skipIfSame('tg-table',recent))return;
    document.getElementById('tg-table').innerHTML=recent.map(e=>{
      const inputPreview=e.tool_input?(e.tool_input.length>80?esc(e.tool_input.slice(0,80))+'...':esc(e.tool_input)):'';
      const sid=e.session_id?e.session_id.slice(0,8)+'...':'-';
      return '<tr style="cursor:pointer" data-tg-idx="'+esc(e.id)+'">'+
        '<td>'+ago(e.created_at)+'</td>'+
        '<td class="mono" style="font-size:11px">'+esc(sid)+'</td>'+
        '<td><strong>'+esc(e.tool_name)+'</strong></td>'+
        '<td>'+severityTag(e.severity)+'</td>'+
        '<td>'+(e.category?'<span style="color:#7d8590">'+esc(e.category)+'</span>':'-')+'</td>'+
        '<td class="mono" style="font-size:11px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(e.tool_input||'')+'">'+inputPreview+'</td></tr>';
    }).join('');

    // Click to expand detail
    document.querySelectorAll('#tg-table tr[data-tg-idx]').forEach(row=>{
      row.addEventListener('click',()=>{
        const entry=recent.find(e=>e.id===row.dataset.tgIdx);
        if(!entry)return;
        document.querySelector('#tab-toolguard .section').style.display='none';
        document.getElementById('tg-cards').style.display='none';
        document.getElementById('tg-detail').style.display='block';

        let inputFormatted=entry.tool_input||'';
        try{inputFormatted=JSON.stringify(JSON.parse(inputFormatted),null,2)}catch{}

        document.getElementById('tg-detail-content').innerHTML=
          '<div class="audit-kv"><span class="k">Tool</span><span class="v">'+esc(entry.tool_name)+'</span></div>'+
          '<div class="audit-kv"><span class="k">Provider</span><span class="v">'+esc(entry.provider||'unknown')+'</span></div>'+
          '<div class="audit-kv"><span class="k">Severity</span><span class="v">'+severityTag(entry.severity)+'</span></div>'+
          '<div class="audit-kv"><span class="k">Rule</span><span class="v">'+(entry.rule_name?esc(entry.rule_name)+' ('+esc(entry.rule_id)+')':'<span style="color:#484f58">none</span>')+'</span></div>'+
          '<div class="audit-kv"><span class="k">Category</span><span class="v">'+(entry.category?esc(entry.category):'-')+'</span></div>'+
          '<div class="audit-kv"><span class="k">Request ID</span><span class="v">'+esc(entry.request_id)+'</span></div>'+
          '<div class="audit-kv"><span class="k">Session</span><span class="v">'+esc(entry.session_id||'-')+'</span></div>'+
          '<div class="audit-kv"><span class="k">Time</span><span class="v">'+esc(entry.created_at)+'</span></div>'+
          '<div style="margin-top:12px"><div class="label">Input</div><pre class="snippet" style="max-height:400px;overflow:auto">'+esc(inputFormatted)+'</pre></div>';
      });
    });
  }catch(e){console.error('Tool Guard refresh error',e)}
}

document.getElementById('tg-back').addEventListener('click',()=>{
  document.getElementById('tg-detail').style.display='none';
  document.querySelector('#tab-toolguard .section').style.display='';
  document.getElementById('tg-cards').style.display='';
});

// Settings tab
async function refreshSettings(){
  try{
    const r=await fetch('/api/config');
    const data=await r.json();
    const ps=data.pluginStatus||{};

    let html='';
    for(const [name,enabled] of Object.entries(ps)){
      html+='<div class="toggle-row"><div><div class="toggle-label">'+name+'</div></div>'+
        '<label class="switch"><input type="checkbox" data-plugin="'+name+'"'+(enabled?' checked':'')+'>'+
        '<span class="slider"></span></label></div>';
    }
    document.getElementById('plugin-toggles').innerHTML=html;

    document.querySelectorAll('#plugin-toggles input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change',async()=>{
        const payload={pluginStatus:{}};
        payload.pluginStatus[cb.dataset.plugin]=cb.checked;
        await fetch('/api/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      });
    });
  }catch(e){}
}

loadSessions();
refresh();
pollToolGuardAlerts();
// Only refresh the active tab + alerts; sessions reload every 15s
setInterval(()=>{refreshActiveTab();pollToolGuardAlerts()},3000);
setInterval(loadSessions,15000);
</script>
</body>
</html>`;

export function serveDashboard(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HTML);
}
