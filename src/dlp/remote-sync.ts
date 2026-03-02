import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { paths } from '../config/paths.js';
import { DlpPatternsRepository } from '../storage/repositories/dlp-patterns.js';
import { getMajorVersion } from '../version.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('dlp-remote-sync');

// ── Public types ──

export interface RemotePatternsConfig {
  url: string;
  branch: string;        // "auto" = read VERSION, or explicit e.g. "v0.1.0"
  syncOnStart: boolean;
  syncIntervalMinutes: number;
}

export interface SignatureMeta {
  version: string;
  updatedAt: string;
  patternCount: number;
  syncedAt: string;
  repoUrl: string;
  branch: string;
  changelog?: SignatureChangelog[];
}

export interface SignatureChangelog {
  version: string;
  date: string;
  changes: string[];
}

export interface SignatureStatus {
  local: SignatureMeta | null;
  remote: { version: string; updatedAt: string; patternCount: number } | null;
  updateAvailable: boolean;
}

// ── Internal types ──

interface YamlContextVerify {
  antiPatterns?: string[];
  confirmPatterns?: string[];
  minEntropy?: number;
  rejectInCodeBlock?: boolean;
}

interface YamlPattern {
  name: string;
  category: string;
  regex: string;
  flags?: string;
  description: string;
  validator?: string;
  requireContext?: string[];
  contextVerify?: YamlContextVerify;
}

interface YamlPatternFile {
  patterns: YamlPattern[];
}

interface YamlSignature {
  version: string;
  updatedAt: string;
  patternCount: number;
  changelog?: SignatureChangelog[];
}

const META_FILE = '.meta.json';

// ── Helpers ──

function resolveBranch(branch: string): string {
  if (branch !== 'auto') return branch;

  const major = getMajorVersion();
  if (major && major !== '0.0') {
    return `v${major}`;
  }

  log.warn('Could not resolve VERSION for auto branch, falling back to "main"');
  return 'main';
}

function syncRepo(url: string, branch: string): string | null {
  const repoDir = paths.signaturesDir;

  try {
    if (existsSync(join(repoDir, '.git'))) {
      log.info('Updating signature repo', { branch });
      execSync(`git -C "${repoDir}" fetch origin`, { stdio: 'pipe', timeout: 30000 });
      execSync(`git -C "${repoDir}" checkout ${branch}`, { stdio: 'pipe', timeout: 10000 });
      execSync(`git -C "${repoDir}" pull origin ${branch}`, { stdio: 'pipe', timeout: 30000 });
    } else {
      log.info('Cloning signature repo', { url, branch });
      mkdirSync(repoDir, { recursive: true });
      execSync(`git clone --branch ${branch} --depth 1 "${url}" "${repoDir}"`, {
        stdio: 'pipe',
        timeout: 60000,
      });
    }
    return repoDir;
  } catch (err) {
    log.error('Failed to sync signature repo', { url, branch, error: (err as Error).message });
    return null;
  }
}

function loadPatternFiles(repoDir: string): YamlPattern[] {
  const patternsDir = join(repoDir, 'patterns');
  if (!existsSync(patternsDir)) {
    log.warn('No patterns/ directory in signature repo');
    return [];
  }

  const files = readdirSync(patternsDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .filter((f) => f !== 'schema.yaml')
    .sort();

  const allPatterns: YamlPattern[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(patternsDir, file), 'utf-8');
      const parsed = yaml.load(content) as YamlPatternFile;
      if (parsed?.patterns && Array.isArray(parsed.patterns)) {
        allPatterns.push(...parsed.patterns);
        log.debug('Loaded patterns from file', { file, count: parsed.patterns.length });
      }
    } catch (err) {
      log.warn('Failed to parse pattern file', { file, error: (err as Error).message });
    }
  }

  return allPatterns;
}

function serializeYamlContextVerify(cv: YamlContextVerify): string | null {
  // Validate all regex strings before serializing
  for (const s of cv.antiPatterns ?? []) {
    new RegExp(s, 'i'); // throws on invalid regex
  }
  for (const s of cv.confirmPatterns ?? []) {
    new RegExp(s, 'i'); // throws on invalid regex
  }
  return JSON.stringify(cv);
}

function upsertPatterns(repo: DlpPatternsRepository, patterns: YamlPattern[], enabledCategories: string[]): number {
  const enabledSet = new Set(enabledCategories);
  let count = 0;

  for (const p of patterns) {
    try {
      new RegExp(p.regex, p.flags ?? 'g');

      let contextVerify: string | null = null;
      if (p.contextVerify) {
        contextVerify = serializeYamlContextVerify(p.contextVerify);
      }

      repo.upsertRemote({
        id: `remote-${p.name}`,
        name: p.name,
        category: p.category,
        regex_source: p.regex,
        regex_flags: p.flags ?? 'g',
        description: p.description ?? null,
        validator: p.validator ?? null,
        require_context: p.requireContext ? JSON.stringify(p.requireContext) : null,
        context_verify: contextVerify,
        enabled: enabledSet.has(p.category),
        source: 'remote',
      });
      count++;
    } catch (err) {
      log.warn('Invalid pattern skipped', { name: p.name, error: (err as Error).message });
    }
  }

  return count;
}

// ── Signature version ──

function readSignatureYaml(repoDir: string): YamlSignature | null {
  const sigPath = join(repoDir, 'signature.yaml');
  if (!existsSync(sigPath)) return null;

  try {
    return yaml.load(readFileSync(sigPath, 'utf-8')) as YamlSignature;
  } catch (err) {
    log.warn('Failed to parse signature.yaml', { error: (err as Error).message });
    return null;
  }
}

function writeMetaFile(meta: SignatureMeta): void {
  const metaPath = join(paths.signaturesDir, META_FILE);
  try {
    mkdirSync(paths.signaturesDir, { recursive: true });
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (err) {
    log.warn('Failed to write signature meta', { error: (err as Error).message });
  }
}

/** Read locally stored signature metadata (from last sync) */
export function getLocalSignatureMeta(): SignatureMeta | null {
  const metaPath = join(paths.signaturesDir, META_FILE);
  if (!existsSync(metaPath)) return null;

  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as SignatureMeta;
  } catch {
    return null;
  }
}

/**
 * Check if a newer signature version is available on remote.
 * Does git fetch + reads remote signature.yaml without pulling (non-destructive).
 */
export function checkForUpdates(config: RemotePatternsConfig): SignatureStatus {
  const local = getLocalSignatureMeta();

  if (!config.url) {
    return { local, remote: null, updateAvailable: false };
  }

  const repoDir = paths.signaturesDir;
  const branch = resolveBranch(config.branch);

  // If repo not cloned yet, we can't check
  if (!existsSync(join(repoDir, '.git'))) {
    return { local, remote: null, updateAvailable: false };
  }

  try {
    execSync(`git -C "${repoDir}" fetch origin`, { stdio: 'pipe', timeout: 15000 });

    // Read remote signature.yaml via git show (doesn't modify working tree)
    const remoteContent = execSync(
      `git -C "${repoDir}" show origin/${branch}:signature.yaml`,
      { encoding: 'utf-8', timeout: 5000 },
    );

    const remoteSig = yaml.load(remoteContent) as YamlSignature;
    if (!remoteSig?.version) {
      return { local, remote: null, updateAvailable: false };
    }

    const remote = {
      version: String(remoteSig.version),
      updatedAt: String(remoteSig.updatedAt ?? ''),
      patternCount: remoteSig.patternCount ?? 0,
    };

    const localVer = local ? Number(local.version) || 0 : 0;
    const remoteVer = Number(remote.version) || 0;
    const updateAvailable = remoteVer > localVer;

    return { local, remote, updateAvailable };
  } catch (err) {
    log.debug('Check for updates failed', { error: (err as Error).message });
    return { local, remote: null, updateAvailable: false };
  }
}

// ── Main sync ──

/**
 * Full sync: clone/pull repo → parse YAML → upsert into DB → save meta.
 * Returns the number of patterns synced, or -1 on failure.
 */
export function syncRemotePatterns(
  config: RemotePatternsConfig,
  patternsRepo: DlpPatternsRepository,
  enabledCategories: string[],
): number {
  if (!config.url) return 0;

  const branch = resolveBranch(config.branch);
  log.info('Starting remote pattern sync', { url: config.url, branch });

  const repoDir = syncRepo(config.url, branch);
  if (!repoDir) return -1;

  const patterns = loadPatternFiles(repoDir);
  if (patterns.length === 0) {
    log.info('No remote patterns found');
    return 0;
  }

  const count = upsertPatterns(patternsRepo, patterns, enabledCategories);

  // Read signature.yaml and save meta
  const sig = readSignatureYaml(repoDir);
  if (sig) {
    const meta: SignatureMeta = {
      version: String(sig.version),
      updatedAt: String(sig.updatedAt ?? ''),
      patternCount: sig.patternCount ?? count,
      syncedAt: new Date().toISOString(),
      repoUrl: config.url,
      branch,
      changelog: sig.changelog,
    };
    writeMetaFile(meta);
    log.info('Remote pattern sync complete', { version: meta.version, count, total: patterns.length });
  } else {
    log.info('Remote pattern sync complete (no signature.yaml)', { count, total: patterns.length });
  }

  return count;
}

/**
 * Start periodic sync timer. Returns a cleanup function to stop it.
 */
export function startPeriodicSync(
  config: RemotePatternsConfig,
  patternsRepo: DlpPatternsRepository,
  enabledCategories: string[],
): () => void {
  if (!config.url || config.syncIntervalMinutes <= 0) {
    return () => {};
  }

  const intervalMs = config.syncIntervalMinutes * 60 * 1000;
  log.info('Starting periodic pattern sync', { intervalMinutes: config.syncIntervalMinutes });

  const timer = setInterval(() => {
    try {
      syncRemotePatterns(config, patternsRepo, enabledCategories);
    } catch (err) {
      log.error('Periodic sync failed', { error: (err as Error).message });
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
