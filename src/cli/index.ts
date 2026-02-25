#!/usr/bin/env node

import { Command } from 'commander';
import { registerStartCommand } from './commands/start.js';
import { registerStopCommand } from './commands/stop.js';
import { registerStatsCommand } from './commands/stats.js';
import { registerHealthCommand } from './commands/health.js';
import { registerConfigCommand } from './commands/config.js';
import { registerEnvCommand } from './commands/env.js';
import { registerWrapCommand } from './commands/wrap.js';
import { registerTrustCaCommand } from './commands/trust-ca.js';
import { registerProxyCommand } from './commands/proxy.js';
import { registerOpenclawCommand } from './commands/openclaw.js';
import { getVersion } from '../version.js';

const program = new Command();

program
  .name('bastion')
  .description('Bastion AI Gateway — Local-first proxy for LLM providers')
  .version(getVersion())
  .enablePositionalOptions();

registerStartCommand(program);
registerStopCommand(program);
registerStatsCommand(program);
registerHealthCommand(program);
registerConfigCommand(program);
registerEnvCommand(program);
registerWrapCommand(program);
registerTrustCaCommand(program);
registerProxyCommand(program);
registerOpenclawCommand(program);

program.parse();
