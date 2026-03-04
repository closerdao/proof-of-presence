/**
 * Compatibility layer that bridges HH2 test patterns (deployments, ethers.getContract,
 * getNamedAccounts, getUnnamedAccounts) to HH3 + hardhat-deploy v2 + rocketh.
 *
 * This minimizes changes across the existing test suite.
 */
import {network} from 'hardhat';
import type {HardhatEthersSigner} from '@nomicfoundation/hardhat-ethers/signers.js';
import {getAddress} from 'ethers';
import {loadAndExecuteDeploymentsFromFiles} from '../rocketh/environment.js';

// Top-level await — ESM supports this
const connection = await network.connect();
const hreEthers = connection.ethers;
const hreNetworkHelpers = connection.networkHelpers;
const hreProvider = connection.provider;
const hreNetwork = connection.network;

type RockethEnv = Awaited<ReturnType<typeof loadAndExecuteDeploymentsFromFiles>>;

let cachedEnv: RockethEnv | null = null;

// Manual registry for mock contracts deployed in tests (not via rocketh deploy scripts)
const manualDeployments: Record<string, {address: string; abi: any}> = {};

async function ensureEnv(): Promise<RockethEnv> {
  if (!cachedEnv) {
    // Clear manual deployments on each new fixture
    for (const key of Object.keys(manualDeployments)) {
      delete manualDeployments[key];
    }
    cachedEnv = await loadAndExecuteDeploymentsFromFiles({provider: hreProvider});
  }
  return cachedEnv;
}

function getDeployment(name: string): {address: string; abi: any} | undefined {
  // Manual deployments take priority (tests override deploy-script contracts via getMock/deploy)
  if (manualDeployments[name]) {
    return manualDeployments[name];
  }
  const env = cachedEnv;
  if (env) {
    try {
      const d = env.get(name);
      if (d) return d;
    } catch {
      // env.get() throws if not found
    }
  }
  return undefined;
}

// ----- ethers compat -----
// Wraps HH3 ethers with the hardhat-deploy v1 `getContract(name, signer?)` method.
export const ethers = Object.assign(Object.create(hreEthers), {
  getSigners: hreEthers.getSigners.bind(hreEthers),
  getSigner: hreEthers.getSigner.bind(hreEthers),
  getContractFactory: hreEthers.getContractFactory.bind(hreEthers),
  getContractAt: hreEthers.getContractAt.bind(hreEthers),
  getImpersonatedSigner: hreEthers.getImpersonatedSigner.bind(hreEthers),
  deployContract: hreEthers.deployContract.bind(hreEthers),
  Contract: (await import('ethers')).Contract,
  Wallet: (await import('ethers')).Wallet,
  ZeroAddress: (await import('ethers')).ZeroAddress,

  async getContract(name: string, signerOrAddress?: string | HardhatEthersSigner) {
    await ensureEnv();
    const deployment = getDeployment(name);
    if (!deployment) throw new Error(`Deployment '${name}' not found`);
    const signer = typeof signerOrAddress === 'string' ? await hreEthers.getSigner(signerOrAddress) : signerOrAddress;
    // Use ABI from deployment record to avoid HH3 artifact lookup issues
    return hreEthers.getContractAt(deployment.abi, deployment.address, signer);
  },
});

// ----- getNamedAccounts / getUnnamedAccounts compat -----
export async function getNamedAccounts(): Promise<Record<string, string>> {
  const env = await ensureEnv();
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(env.namedAccounts)) {
    result[key] = getAddress(val as string);
  }
  return result;
}

export async function getUnnamedAccounts(): Promise<string[]> {
  const env = await ensureEnv();
  return env.unnamedAccounts.map((a: string) => getAddress(a));
}

// ----- deployments compat -----
export const deployments = {
  async fixture() {
    cachedEnv = null;
    await ensureEnv();
  },

  async get(name: string) {
    await ensureEnv();
    const d = getDeployment(name);
    if (!d) throw new Error(`no deployment named "${name}" found.`);
    return d;
  },

  async deploy(
    name: string,
    opts: {from: string; args?: unknown[]; log?: boolean; autoMine?: boolean; [k: string]: unknown},
  ) {
    // Deploy contract and register it in the manual deployments registry
    const factory = await hreEthers.getContractFactory(name, await hreEthers.getSigner(opts.from));
    const contract = await factory.deploy(...(opts.args || []));
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    const abi = JSON.parse(contract.interface.formatJson());
    manualDeployments[name] = {address, abi};
    return {address, abi};
  },

  createFixture<T>(
    fn: (hre: {
      deployments: typeof deployments;
      ethers: typeof ethers;
      getNamedAccounts: typeof getNamedAccounts;
      getUnnamedAccounts: typeof getUnnamedAccounts;
    }) => Promise<T>,
  ) {
    // Use HH3 loadFixture for snapshot caching
    const fixtureFn = async () => {
      cachedEnv = null;
      return fn({
        deployments,
        ethers,
        getNamedAccounts,
        getUnnamedAccounts,
      });
    };
    return () => hreNetworkHelpers.loadFixture(fixtureFn);
  },
};

// ----- network compat -----
export {hreNetwork as networkObj, hreProvider as provider};
export const networkProvider = {
  send: hreProvider.send.bind(hreProvider),
  request: hreProvider.request.bind(hreProvider),
};
