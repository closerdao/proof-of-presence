import * as fs from 'fs';
import * as path from 'path';

interface DeploymentAddresses {
  [contractName: string]: string;
}

interface Deployments {
  celo: DeploymentAddresses;
  celoSepolia: DeploymentAddresses;
}

function extractAddresses(network: string): DeploymentAddresses {
  const deploymentsDir = path.join(__dirname, '..', 'deployments', network);
  const addresses: DeploymentAddresses = {};

  if (!fs.existsSync(deploymentsDir)) {
    return addresses;
  }

  const files = fs.readdirSync(deploymentsDir);

  for (const file of files) {
    if (
      file.endsWith('.json') &&
      !file.startsWith('_') &&
      !file.includes('solcInputs') &&
      !file.match(/^[a-f0-9]{32}\.json$/) // Skip solc input files
    ) {
      const filePath = path.join(deploymentsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        if (data.address) {
          const contractName = file.replace('.json', '');
          addresses[contractName] = data.address;
        }
      } catch (e) {
        // Skip invalid JSON
        console.warn(`Skipping ${file}: ${e}`);
      }
    }
  }

  return addresses;
}

const celo = extractAddresses('celo');
const celoSepolia = extractAddresses('celoSepolia');

const result: Deployments = {
  celo,
  celoSepolia,
};

const outputPath = path.join(__dirname, '..', 'deployments.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`Created ${outputPath}`);
console.log(`Found ${Object.keys(celo).length} contracts on Celo`);
console.log(`Found ${Object.keys(celoSepolia).length} contracts on Celo Sepolia`);
