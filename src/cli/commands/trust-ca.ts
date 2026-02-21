import type { Command } from 'commander';
import { platform } from 'node:os';
import { ensureCA, getCACertPath } from '../../proxy/certs.js';

export function registerTrustCaCommand(program: Command): void {
  program
    .command('trust-ca')
    .description('Generate and display the Bastion CA certificate for trust configuration')
    .action(() => {
      // This will generate the CA if it doesn't exist
      ensureCA();
      const certPath = getCACertPath();
      const plat = platform();

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

      if (plat === 'darwin') {
        console.log('To add to macOS system trust (optional):');
        console.log(`  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`);
      } else if (plat === 'linux') {
        console.log('To add to Linux system trust (optional):');
        console.log(`  sudo cp "${certPath}" /usr/local/share/ca-certificates/bastion-ca.crt`);
        console.log('  sudo update-ca-certificates');
        console.log('');
        console.log('For Python (requests/httpx):');
        console.log(`  export SSL_CERT_FILE="${certPath}"`);
        console.log(`  export REQUESTS_CA_BUNDLE="${certPath}"`);
      } else if (plat === 'win32') {
        console.log('To add to Windows certificate store (optional):');
        console.log(`  certutil -addstore -user Root "${certPath}"`);
      }
    });
}
