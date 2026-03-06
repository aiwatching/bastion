import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';
import { paths } from '../../config/paths.js';
import {
  validateProLicense,
  saveLicenseKey,
  removeLicenseKey,
  readLicenseKey,
} from '../../license/pro-license.js';
import { getDaemonStatus } from '../daemon.js';

const PRO_PKG = '@aiwatching/bastion-pro';
const PRO_DIR_NAME = 'bastion-pro';

function proPluginDir(): string {
  return join(paths.pluginsDir, PRO_DIR_NAME);
}

function info(msg: string): void {
  process.stderr.write(msg + '\n');
}

function error(msg: string): void {
  process.stderr.write(`Error: ${msg}\n`);
}

/** Read config.yaml as raw object (creates file if missing) */
function readUserConfig(): Record<string, unknown> {
  if (!existsSync(paths.configFile)) return {};
  const raw = readFileSync(paths.configFile, 'utf-8');
  return (yaml.load(raw) as Record<string, unknown>) ?? {};
}

/** Write config.yaml back */
function writeUserConfig(config: Record<string, unknown>): void {
  mkdirSync(paths.bastionDir, { recursive: true });
  writeFileSync(paths.configFile, yaml.dump(config, { lineWidth: 120 }), 'utf-8');
}

/** Add bastion-pro to plugins.external[] in config.yaml */
function addProPluginConfig(): void {
  const config = readUserConfig();
  const plugins = (config.plugins as Record<string, unknown>) ?? {};
  const external = (plugins.external as Array<Record<string, unknown>>) ?? [];

  // Remove any old-path entries, then add/update with new path
  const cleanExternal = external.filter((e) => {
    const pkg = typeof e.package === 'string' ? e.package : '';
    return !pkg.endsWith('/bastion-pro');
  });
  cleanExternal.push({ package: proPluginDir(), enabled: true });
  info('Config: configured bastion-pro in plugins.external');

  plugins.external = cleanExternal;
  config.plugins = plugins;
  writeUserConfig(config);
}

/** Remove bastion-pro from plugins.external[] in config.yaml */
function removeProPluginConfig(): void {
  const config = readUserConfig();
  const plugins = (config.plugins as Record<string, unknown>) ?? {};
  const external = (plugins.external as Array<Record<string, unknown>>) ?? [];

  const filtered = external.filter((e) => {
    const pkg = typeof e.package === 'string' ? e.package : '';
    return pkg !== proPluginDir() && !pkg.endsWith('/bastion-pro');
  });
  if (filtered.length !== external.length) {
    plugins.external = filtered.length > 0 ? filtered : undefined;
    config.plugins = plugins;
    writeUserConfig(config);
    info('Config: removed bastion-pro from plugins.external');
  }
}

/** Install from npm: pack + extract */
function installFromNpm(): void {
  const dest = proPluginDir();
  mkdirSync(dest, { recursive: true });

  info(`Downloading ${PRO_PKG} from npm...`);
  try {
    // Pack into plugins dir
    execSync(`npm pack ${PRO_PKG} --pack-destination .`, {
      cwd: paths.pluginsDir,
      stdio: 'pipe',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('404') || msg.includes('Not Found')) {
      error(`${PRO_PKG} not found on npm. Is it published?`);
    } else {
      error(`Failed to download ${PRO_PKG}: ${msg}`);
    }
    info('Tip: use --source <path> for local installation');
    process.exit(1);
  }

  // Find the tarball
  const tarballs = readdirSync(paths.pluginsDir).filter(
    (f) => f.startsWith('aiwatching-bastion-pro-') && f.endsWith('.tgz'),
  );
  if (tarballs.length === 0) {
    error('No tarball found after npm pack');
    process.exit(1);
  }
  const tarball = tarballs[tarballs.length - 1];
  const tarballPath = join(paths.pluginsDir, tarball);

  info('Extracting...');
  // Extract to dest (tarball has a "package/" prefix)
  execSync(`tar xzf "${tarballPath}" --strip-components=1 -C "${dest}"`, { stdio: 'pipe' });

  // Cleanup tarball
  rmSync(tarballPath, { force: true });

  // Install production deps
  info('Installing dependencies...');
  execSync('npm install --production --ignore-scripts', {
    cwd: dest,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  info(`Installed ${PRO_PKG} → ${dest}`);
}

/** Install from local source: rsync + build */
function installFromLocal(source: string): void {
  if (!existsSync(source)) {
    error(`Source path not found: ${source}`);
    process.exit(1);
  }

  const dest = proPluginDir();
  mkdirSync(dest, { recursive: true });

  info(`Copying from ${source}...`);
  execSync(
    `rsync -a --exclude node_modules --exclude .git --exclude dist "${source}/" "${dest}/"`,
    { stdio: 'pipe' },
  );

  // Rewrite bastion-plugin-api dep to npm version (was file: in dev)
  const pkgPath = join(dest, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.dependencies?.['@aiwatching/bastion-plugin-api']?.startsWith('file:')) {
      pkg.dependencies['@aiwatching/bastion-plugin-api'] = '^2.0.0';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      info('Rewrote @aiwatching/bastion-plugin-api dependency to ^2.0.0');
    }
  }

  info('Installing dependencies...');
  execSync('npm install', { cwd: dest, stdio: 'pipe' });

  info('Building...');
  execSync('npm run build', { cwd: dest, stdio: 'pipe' });

  info(`Installed from local source → ${dest}`);
}

export function registerProCommand(program: Command): void {
  const pro = program
    .command('pro')
    .description('Manage Bastion Pro plugin (activate, deactivate, status)');

  // ── bastion pro activate <key> ──
  pro
    .command('activate <key>')
    .description('Activate Pro features with a license key')
    .option('--source <path>', 'Install from local directory instead of npm')
    .action((key: string, options: { source?: string }) => {
      // 1. Validate license
      const license = validateProLicense(key);
      if (!license.valid) {
        error(`License validation failed: ${license.error}`);
        process.exit(1);
      }
      info(`License valid: ${license.plan} plan, expires ${license.expiresAt!.toISOString().slice(0, 10)}`);

      // 2. Save license key
      saveLicenseKey(key);
      info(`License key saved to ${paths.licenseFile}`);

      // 3. Install plugin
      const dest = proPluginDir();
      const alreadyInstalled = existsSync(join(dest, 'package.json'));

      if (alreadyInstalled) {
        info('Pro plugin already installed, skipping installation');
      } else if (options.source) {
        installFromLocal(options.source);
      } else {
        installFromNpm();
      }

      // 4. Update config.yaml
      addProPluginConfig();

      // 5. Restart notice
      const daemon = getDaemonStatus();
      if (daemon.running) {
        info('');
        info(`Bastion is running (PID ${daemon.pid}). Restart required:`);
        info('  bastion stop && bastion start');
      }

      info('');
      info('Pro features activated successfully!');
    });

  // ── bastion pro deactivate ──
  pro
    .command('deactivate')
    .description('Deactivate Pro features and remove configuration')
    .option('--cleanup', 'Also delete installed plugin files and models')
    .action((options: { cleanup?: boolean }) => {
      // 1. Remove from config
      removeProPluginConfig();

      // 2. Remove license key
      removeLicenseKey();
      info('License key removed');

      // 3. Cleanup installed files
      if (options.cleanup) {
        const dest = proPluginDir();
        if (existsSync(dest)) {
          rmSync(dest, { recursive: true, force: true });
          info(`Removed ${dest}`);
        }
        if (existsSync(paths.modelsDir)) {
          rmSync(paths.modelsDir, { recursive: true, force: true });
          info(`Removed ${paths.modelsDir}`);
        }
      }

      info('');
      info('Pro features deactivated.');
    });

  // ── bastion pro status ──
  pro
    .command('status')
    .description('Show Pro plugin status')
    .action(() => {
      console.log('Bastion Pro Status');
      console.log('─'.repeat(40));

      // License
      const key = readLicenseKey();
      if (key) {
        const license = validateProLicense(key);
        if (license.valid) {
          const isDevMode = key === '__DEV__' || process.env.BASTION_DEV === '1';
          const planLabel = isDevMode ? `${license.plan} (dev mode)` : license.plan;
          console.log(`  License:   ${planLabel}`);
          console.log(`  Expires:   ${license.expiresAt!.toISOString().slice(0, 10)}`);
        } else {
          console.log(`  License:   invalid (${license.error})`);
        }
      } else {
        console.log('  License:   not activated');
      }

      // Plugin installed?
      const dest = proPluginDir();
      const pluginPkgPath = join(dest, 'package.json');
      if (existsSync(pluginPkgPath)) {
        const pkg = JSON.parse(readFileSync(pluginPkgPath, 'utf-8'));
        console.log(`  Plugin:    installed (v${pkg.version ?? '?'})`);
        console.log(`  Location:  ${dest}`);
      } else {
        console.log('  Plugin:    not installed');
      }

      // Config enabled?
      const config = readUserConfig();
      const plugins = (config.plugins as Record<string, unknown>) ?? {};
      const external = (plugins.external as Array<Record<string, unknown>>) ?? [];
      const entry = external.find((e) => e.package === dest);
      console.log(`  Config:    ${entry?.enabled ? 'enabled' : 'not configured'}`);

      // Models
      if (existsSync(paths.modelsDir)) {
        const models = readdirSync(paths.modelsDir).filter((f) => f.endsWith('.onnx'));
        console.log(`  Models:    ${models.length > 0 ? models.join(', ') : 'none'}`);
      } else {
        console.log('  Models:    not downloaded');
      }
    });
}
