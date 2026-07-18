import hre, {network} from 'hardhat';
import type {HardhatEthersSigner} from '@nomicfoundation/hardhat-ethers/types';
import {Contract, Wallet, ZeroAddress, getAddress} from 'ethers';
import {loadEnvironmentFromHardhat} from '../rocketh/environment.js';

const connection = await network.getOrCreate();
const hreEthers = connection.ethers;

type RockethEnv = Awaited<ReturnType<typeof loadEnvironmentFromHardhat>>;

let cachedEnv: RockethEnv | null = null;

async function ensureEnv(): Promise<RockethEnv> {
  if (!cachedEnv) {
    cachedEnv = await loadEnvironmentFromHardhat({hre, connection});
  }
  return cachedEnv;
}

export async function runDeploy(): Promise<void> {
  cachedEnv = null;
  await hre.tasks.getTask('deploy').run({});
  cachedEnv = await loadEnvironmentFromHardhat({hre, connection});
}

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
  return env.unnamedAccounts.map((account: string) => getAddress(account));
}

export const ethers = Object.assign(Object.create(hreEthers), {
  getSigners: hreEthers.getSigners.bind(hreEthers),
  getSigner: hreEthers.getSigner.bind(hreEthers),
  getContractFactory: hreEthers.getContractFactory.bind(hreEthers),
  getContractAt: hreEthers.getContractAt.bind(hreEthers),
  getImpersonatedSigner: hreEthers.getImpersonatedSigner.bind(hreEthers),
  deployContract: hreEthers.deployContract.bind(hreEthers),
  provider: hreEthers.provider,
  Contract,
  Wallet,
  ZeroAddress,

  async getContract(name: string, signerOrAddress?: string | HardhatEthersSigner) {
    const env = await ensureEnv();
    const deployment = env.get(name);
    const signer = typeof signerOrAddress === 'string' ? await hreEthers.getSigner(signerOrAddress) : signerOrAddress;
    return hreEthers.getContractAt(deployment.abi, deployment.address, signer);
  },
});
