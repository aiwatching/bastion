import type { Command } from 'commander';
import { ensureCA, getCACertPath } from '../../proxy/certs.js';

export function registerTrustCaCommand(program: Command): void {
  program
    .command('trust-ca')
    .description('Generate and display the Bastion CA certificate for trust configuration')
    .action(() => {
      // This will generate the CA if it doesn't exist
      ensureCA();
      const certPath = getCACertPath();

      console.log('Bastion CA certificate generated.');
      console.log('');
      console.log(`  Certificate: ${certPath}`);
      console.log('');
      console.log('For Node.js tools (Claude Code, etc.):');
      console.log(`  export NODE_EXTRA_CA_CERTS="${certPath}"`);
      console.log('');
      console.log('Or use "bastion wrap" which sets this automatically:');
      console.log('  bastion wrap claude');
      console.log('');
      console.log('To add to macOS system trust (optional):');
      console.log(`  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`);
    });
}
