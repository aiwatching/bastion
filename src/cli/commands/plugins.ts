import { type Command } from 'commander';
import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import yaml from 'js-yaml';

const BASTION_DIR = join(homedir(), '.bastion');
const CONFIG_PATH = join(BASTION_DIR, 'config.yaml');
const MODELS_DIR = join(BASTION_DIR, 'models');

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

function dirSize(dir: string): string {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { recursive: true })) {
      try {
        const st = statSync(join(dir, entry as string));
        if (st.isFile()) total += st.size;
      } catch { /* skip */ }
    }
  } catch { return '0 MB'; }
  if (total > 1024 * 1024 * 1024) return `${(total / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${(total / 1024 / 1024).toFixed(0)} MB`;
}

interface ExternalEntry {
  package: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

function loadConfig(): Record<string, unknown> {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return (yaml.load(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, yaml.dump(config), 'utf-8');
}

function getExternalPlugins(config: Record<string, unknown>): ExternalEntry[] {
  const plugins = config.plugins as Record<string, unknown> | undefined;
  return (plugins?.external as ExternalEntry[] | undefined) ?? [];
}

export function registerPluginsCommand(program: Command): void {
  const cmd = program
    .command('plugins')
    .description('Manage optional plugins');

  cmd
    .command('list')
    .description('List installed external plugins')
    .action(() => {
      const config = loadConfig();
      const entries = getExternalPlugins(config);
      if (entries.length === 0) {
        console.log('No external plugins installed.');
        console.log('\nInstall optional plugins:');
        console.log('  bastion plugins install   (from sibling bastion-plugin-api directory)');
        return;
      }
      console.log('External plugins:\n');
      for (const entry of entries) {
        const status = entry.enabled ? '\x1b[32mENABLED\x1b[0m' : '\x1b[33mDISABLED\x1b[0m';
        const exists = existsSync(entry.package);
        const dir = exists ? '' : ' \x1b[31m(directory missing)\x1b[0m';
        console.log(`  ${entry.package} [${status}]${dir}`);
      }
    });

  cmd
    .command('install')
    .description('Install optional plugin pack')
    .argument('[path]', 'Path to plugin source directory')
    .action((sourcePath?: string) => {
      // Resolve plugin source directory
      let pluginSource = sourcePath;
      if (!pluginSource) {
        // Try ../bastion-plugin-api relative to CWD
        const candidate = join(process.cwd(), '..', 'bastion-plugin-api');
        if (existsSync(join(candidate, 'package.json'))) {
          pluginSource = candidate;
        }
      }
      if (!pluginSource || !existsSync(join(pluginSource, 'package.json'))) {
        console.error('Cannot find plugin source directory.');
        console.error('Usage: bastion plugins install [path-to-bastion-plugin-api]');
        console.error('  Or run from the bastion directory (auto-detects sibling bastion-plugin-api)');
        process.exit(1);
      }

      // Determine install dir (where bastion is installed)
      const appDir = join(BASTION_DIR, 'app');
      if (!existsSync(join(appDir, 'package.json'))) {
        console.error(`Bastion app not found at ${appDir}. Run install.sh first.`);
        process.exit(1);
      }

      const pluginsDest = join(appDir, 'plugins');
      const pluginApiDir = join(appDir, 'packages', 'bastion-plugin-api');

      console.log(`Installing optional plugins from: ${pluginSource}`);

      // Copy source (exclude node_modules, .git, dist)
      mkdirSync(pluginsDest, { recursive: true });
      // Use rsync if available, fallback to cpSync
      try {
        execSync(`rsync -a --exclude node_modules --exclude .git --exclude dist "${pluginSource}/" "${pluginsDest}/"`, { stdio: 'pipe' });
      } catch {
        // Fallback: remove and copy
        rmSync(pluginsDest, { recursive: true, force: true });
        cpSync(pluginSource, pluginsDest, { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('.git') });
      }

      // Rewrite @aion0/bastion-plugin-api to file: path (in dependencies or devDependencies)
      const pkgPath = join(pluginsDest, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const relPath = relative(pluginsDest, pluginApiDir);
      let rewrote = false;
      for (const section of ['dependencies', 'devDependencies'] as const) {
        if (pkg[section]?.['@aion0/bastion-plugin-api']) {
          pkg[section]['@aion0/bastion-plugin-api'] = `file:${relPath}`;
          rewrote = true;
        }
      }
      if (rewrote) {
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log(`Rewrote plugin-api path to: file:${relPath}`);
      }

      // npm install + build
      console.log('Installing dependencies...');
      execSync('npm install', { cwd: pluginsDest, stdio: 'pipe' });
      console.log('Building...');
      execSync('npm run build', { cwd: pluginsDest, stdio: 'pipe' });

      // Update config.yaml
      const config = loadConfig();
      const plugins = (config.plugins ?? {}) as Record<string, unknown>;
      const entries = (plugins.external as ExternalEntry[] | undefined) ?? [];
      const alreadyConfigured = entries.some(e => e.package.endsWith('/plugins'));
      if (!alreadyConfigured) {
        entries.push({ package: pluginsDest, enabled: true });
        plugins.external = entries;
        config.plugins = plugins;
        saveConfig(config);
        console.log('Added to config.yaml');
      } else {
        console.log('Plugin already configured in config.yaml');
      }

      console.log('\nOptional plugins installed. Restart Bastion to apply.');
    });

  cmd
    .command('uninstall')
    .description('Uninstall an optional plugin')
    .argument('[name]', 'Plugin directory name (default: plugins)', 'plugins')
    .option('--all', 'Remove everything including downloaded models')
    .action(async (name: string, opts: { all?: boolean }) => {
      const config = loadConfig();
      const entries = getExternalPlugins(config);

      // Find matching entry
      const match = entries.find(e => e.package.includes(name));
      if (!match) {
        console.error(`No external plugin matching "${name}" found in config.`);
        process.exit(1);
      }

      // Remove plugin directory
      const pluginDir = match.package;
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true });
        console.log(`Removed: ${pluginDir}`);
      } else {
        console.log(`Directory not found (already removed): ${pluginDir}`);
      }

      // Update config
      const plugins = config.plugins as Record<string, unknown>;
      plugins.external = entries.filter(e => e !== match);
      saveConfig(config);
      console.log('Updated config.yaml');

      // Handle models cleanup
      const hasModels = existsSync(MODELS_DIR) && readdirSync(MODELS_DIR).filter(f => !f.startsWith('.')).length > 0;
      if (hasModels) {
        let removeModels = opts.all ?? false;
        if (!removeModels) {
          const size = dirSize(MODELS_DIR);
          const answer = await ask(`\nAlso remove downloaded models (~${size} in ${MODELS_DIR})? [y/N] `);
          removeModels = answer === 'y' || answer === 'yes';
        }
        if (removeModels) {
          rmSync(MODELS_DIR, { recursive: true, force: true });
          console.log(`Removed: ${MODELS_DIR}`);
        } else {
          console.log(`Models kept at: ${MODELS_DIR}`);
        }
      }

      console.log('\nPlugin uninstalled. Restart Bastion to apply.');
    });
}
