import { join } from 'node:path';
import { homedir } from 'node:os';

const BASTION_DIR = join(homedir(), '.bastion');

export const paths = {
  bastionDir: BASTION_DIR,
  configFile: join(BASTION_DIR, 'config.yaml'),
  databaseFile: join(BASTION_DIR, 'bastion.db'),
  encryptionKeyFile: join(BASTION_DIR, '.key'),
  pidFile: join(BASTION_DIR, 'bastion.pid'),
  logFile: join(BASTION_DIR, 'bastion.log'),
};
