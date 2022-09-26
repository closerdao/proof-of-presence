import {Contract} from 'ethers';
import {ethers, network, getNamedAccounts, deployments} from 'hardhat';
import {parseUnits} from 'ethers/lib/utils';
const BN = ethers.BigNumber;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const MAX_UINT256 = BN.from('2').pow(BN.from('256')).sub(BN.from('1'));
export const MAX_INT256 = BN.from('2').pow(BN.from('255')).sub(BN.from('1'));
export const MIN_INT256 = BN.from('2').pow(BN.from('255')).mul(BN.from('-1'));

const erc20ABI =
  '[{"inputs":[{"internalType":"uint256","name":"chainId_","type":"uint256"}],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"src","type":"address"},{"indexed":true,"internalType":"address","name":"guy","type":"address"},{"indexed":false,"internalType":"uint256","name":"wad","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":true,"inputs":[{"indexed":true,"internalType":"bytes4","name":"sig","type":"bytes4"},{"indexed":true,"internalType":"address","name":"usr","type":"address"},{"indexed":true,"internalType":"bytes32","name":"arg1","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"arg2","type":"bytes32"},{"indexed":false,"internalType":"bytes","name":"data","type":"bytes"}],"name":"LogNote","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"src","type":"address"},{"indexed":true,"internalType":"address","name":"dst","type":"address"},{"indexed":false,"internalType":"uint256","name":"wad","type":"uint256"}],"name":"Transfer","type":"event"},{"constant":true,"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"PERMIT_TYPEHASH","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"usr","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"usr","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"burn","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"guy","type":"address"}],"name":"deny","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"usr","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"mint","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"src","type":"address"},{"internalType":"address","name":"dst","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"move","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"holder","type":"address"},{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"nonce","type":"uint256"},{"internalType":"uint256","name":"expiry","type":"uint256"},{"internalType":"bool","name":"allowed","type":"bool"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"permit","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"usr","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"pull","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"usr","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"push","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"guy","type":"address"}],"name":"rely","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"dst","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"src","type":"address"},{"internalType":"address","name":"dst","type":"address"},{"internalType":"uint256","name":"wad","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"version","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"wards","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}]';
const wethABI =
  '[{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"guy","type":"address"},{"name":"wad","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"src","type":"address"},{"name":"dst","type":"address"},{"name":"wad","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"wad","type":"uint256"}],"name":"withdraw","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"dst","type":"address"},{"name":"wad","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"deposit","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"src","type":"address"},{"indexed":true,"name":"guy","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"src","type":"address"},{"indexed":true,"name":"dst","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"dst","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Deposit","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"src","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Withdrawal","type":"event"}]';

export async function setupUsers<T extends {[contractName: string]: Contract}>(
  addresses: string[],
  contracts: T
): Promise<({address: string} & T)[]> {
  const users: ({address: string} & T)[] = [];
  for (const address of addresses) {
    users.push(await setupUser(address, contracts));
  }
  return users;
}

export async function setupUser<T extends {[contractName: string]: Contract}>(
  address: string,
  contracts: T
): Promise<{address: string} & T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user: any = {address};
  for (const key of Object.keys(contracts)) {
    user[key] = contracts[key].connect(await ethers.getSigner(address));
  }
  return user as {address: string} & T;
}

export async function getActiveContract(name: string): Promise<Contract> {
  const accounts = await getNamedAccounts();
  switch (name) {
    case 'dai': {
      return new ethers.Contract(accounts.dai, erc20ABI) as Contract;
    }
    case 'weth': {
      return new ethers.Contract(accounts.weth, wethABI) as Contract;
    }
    case 'wrapped': {
      return new ethers.Contract(accounts.wrapped, wethABI) as Contract;
    }
    case 'usdc': {
      return new ethers.Contract(accounts.usdc, erc20ABI) as Contract;
    }
    case 'usdt': {
      return new ethers.Contract(accounts.usdt, erc20ABI) as Contract;
    }
    case 'wmatic': {
      return new ethers.Contract(accounts.wmatic, erc20ABI) as Contract;
    }
    default: {
      throw 'Contact not listed';
    }
  }
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getInactiveContract(name: string, args?: []): Promise<Contract> {
  const accounts = await getNamedAccounts();
  const {deployer} = accounts;

  switch (name) {
    // Example:
    case 'TDFSale': {
      const {weth, TDFTokenBeneficiary} = accounts;
      const TDFToken = await ethers.getContract('TDFToken');
      await deployments.deploy('TDFSale', {from: deployer, args: [TDFToken.address, weth, TDFTokenBeneficiary, 1, 1]});
      return ethers.getContract('TDFSale', deployer);
    }
    default: {
      throw 'Contact not listed';
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}

export async function topUpFunds(name: string, to: string, amount?: string) {
  const accounts = await getNamedAccounts();
  let defAmount: string;
  switch (name) {
    case 'usdc': {
      defAmount = amount || '110000.0';
      await impersonateFundErc20(await getActiveContract('usdc'), accounts.usdc_whale, to, defAmount, 6);
      break;
    }
    case 'weth': {
      defAmount = amount || '10.0';
      await impersonateFundErc20(await getActiveContract('weth'), accounts.weth_whale, to, defAmount);
      break;
    }
    case 'mint_weth': {
      const {weth} = accounts;
      const signer = await ethers.getSigner(to);
      defAmount = amount || '10.0';
      await signer.sendTransaction({from: to, value: parseUnits(defAmount, 18), to: weth});
      break;
    }
    case 'send_value': {
      const {deployer} = accounts;
      const signer = await ethers.getSigner(deployer);
      defAmount = amount || '10.0';
      await signer.sendTransaction({from: deployer, value: parseUnits(defAmount, 18), to: to});
      break;
    }
    case 'wmatic': {
      defAmount = amount || '10000.0';
      await impersonateFundErc20(await getActiveContract('wmatic'), accounts.wmatic_whale, to, defAmount);
      break;
    }
    default: {
      throw new Error('token not found for topUpFunds');
    }
  }
}

export const getBigNumber = (amount: number, decimals = 18) => {
  return ethers.utils.parseUnits(amount.toString(), decimals);
};

export const getErc20Balance = async (contract: Contract, address: string, name: string, decimals: number) => {
  const [balance] = await Promise.all([contract.balanceOf(address)]);

  console.log(name, ethers.utils.formatUnits(balance, decimals));
};

const fundErc20 = async (contract: Contract, sender: string, recipient: string, amount: string, decimals: number) => {
  const FUND_AMOUNT = ethers.utils.parseUnits(amount, decimals);

  // fund erc20 token to the contract
  const MrWhale = await ethers.getSigner(sender);

  const contractSigner = contract.connect(MrWhale);
  await contractSigner.transfer(recipient, FUND_AMOUNT);
};

const impersonateFundErc20 = async (
  contract: Contract,
  sender: string,
  recipient: string,
  amount: string,
  decimals = 18
) => {
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [sender],
  });

  // fund baseToken to the contract
  await fundErc20(contract, sender, recipient, amount, decimals);

  await network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [sender],
  });
};
