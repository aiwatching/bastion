import type { RequestStats } from '../storage/repositories/requests.js';

function padRight(str: string, len: number): string {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number): string {
  return ' '.repeat(Math.max(0, len - str.length)) + str;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function renderDashboard(stats: RequestStats, cacheStats?: { total_entries: number; total_hits: number }): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('  Bastion AI Gateway — Stats');
  lines.push('  ' + '='.repeat(40));
  lines.push('');

  // Summary
  lines.push('  Overview');
  lines.push('  ' + '-'.repeat(40));
  lines.push(`  Total Requests:   ${padLeft(formatNumber(stats.total_requests), 12)}`);
  lines.push(`  Total Cost:       ${padLeft(formatCost(stats.total_cost_usd), 12)}`);
  lines.push(`  Input Tokens:     ${padLeft(formatNumber(stats.total_input_tokens), 12)}`);
  lines.push(`  Output Tokens:    ${padLeft(formatNumber(stats.total_output_tokens), 12)}`);
  lines.push(`  Cache Hits:       ${padLeft(formatNumber(stats.cache_hits), 12)}`);
  lines.push(`  Avg Latency:      ${padLeft(Math.round(stats.avg_latency_ms) + 'ms', 12)}`);

  if (cacheStats) {
    lines.push('');
    lines.push('  Cache');
    lines.push('  ' + '-'.repeat(40));
    lines.push(`  Cached Responses: ${padLeft(formatNumber(cacheStats.total_entries), 12)}`);
    lines.push(`  Total Hits:       ${padLeft(formatNumber(cacheStats.total_hits), 12)}`);
  }

  // By Provider
  const providers = Object.entries(stats.by_provider);
  if (providers.length > 0) {
    lines.push('');
    lines.push('  By Provider');
    lines.push('  ' + '-'.repeat(40));
    lines.push(`  ${padRight('Provider', 18)} ${padLeft('Requests', 10)} ${padLeft('Cost', 12)}`);
    for (const [name, data] of providers) {
      lines.push(`  ${padRight(name, 18)} ${padLeft(formatNumber(data.requests), 10)} ${padLeft(formatCost(data.cost_usd), 12)}`);
    }
  }

  // By Model
  const models = Object.entries(stats.by_model);
  if (models.length > 0) {
    lines.push('');
    lines.push('  By Model');
    lines.push('  ' + '-'.repeat(40));
    lines.push(`  ${padRight('Model', 30)} ${padLeft('Req', 6)} ${padLeft('Cost', 12)}`);
    for (const [name, data] of models) {
      const displayName = name.length > 28 ? name.slice(0, 28) + '..' : name;
      lines.push(`  ${padRight(displayName, 30)} ${padLeft(formatNumber(data.requests), 6)} ${padLeft(formatCost(data.cost_usd), 12)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
