import {getNamedAccounts, ethers, artifacts} from 'hardhat';
import {FormatTypes} from '@ethersproject/abi';
import fs from 'fs';
import path from 'path';

import {TDFTokenTest} from '../typechain';
import {Contract} from 'ethers';
import {encodeSingle, encodeMulti, TransactionType, createTransaction, MetaTransaction} from 'ethers-multisend';
import {parseEther} from 'ethers/lib/utils';

const getTheAbi = () => {
  try {
    const dir = path.resolve(
      __dirname,
      './deployments/celo/TDFTokenTest_Proxy.json' // hardhat build dir
    );
    const file = fs.readFileSync(dir, 'utf8');
    const json = JSON.parse(file);
    const abi = json.abi;
    console.log(`abi`, abi);

    return abi;
  } catch (e) {
    console.log(`e`, e);
  }
};

async function setupUser<T extends {[contractName: string]: Contract}>(
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
async function main() {
  const namedAccounts = await getNamedAccounts();
  const contracts = {
    token: <TDFTokenTest>await ethers.getContract('TDFTokenTest', namedAccounts.deployer),
  };

  const deployer = await setupUser(namedAccounts.deployer, contracts);

  // const data = await deployer.token.populateTransaction.mint(testAddress, parseEther('2'));

  // Encode transactions
  const tx1: MetaTransaction = encodeSingle({
    type: TransactionType.callContract,
    to: '0x59578a7381a77770B46153A7443a4c566fCC5427',
    abi: deployer.token.interface.format(FormatTypes.json) as string,
    value: '',
    functionSignature: 'mint(address,uint256)',
    inputValues: {
      account: '0x62266a37cb6C4a06c10eD65D70Baa2A69C7eFcB7', // Address that receives the tokens
      amount: parseEther('2').toString(),
    },
    id: '',
  });

  const tx2: MetaTransaction = encodeSingle({
    type: TransactionType.callContract,
    to: '0x59578a7381a77770B46153A7443a4c566fCC5427', // sent to TDFToken implementation.
    abi: deployer.token.interface.format(FormatTypes.json) as string,
    value: '',
    functionSignature: 'mint(address,uint256)',
    inputValues: {
      account: '0xfdA58254CBF6fa8ece7FC3CA5664cF5B7EbEE35E',
      amount: parseEther('2').toString(),
    },
    id: '',
  });

  // Output data fields. This can be copied into the 'custom data' field within the transaction builder
  //
  // console.log(tx1.data);
  // console.log(tx2.data);

  const finalTx = encodeMulti(
    [
      {
        to: '0x59578a7381a77770B46153A7443a4c566fCC5427',
        value: parseEther('1').toString(), // This amount is not calculated but taken from the example tests: https://github.com/gnosis/ethers-multisend/blob/main/test/encodeMulti.spec.ts#L41
        data: '0x40c10f1900000000000000000000000062266a37cb6c4a06c10ed65d70baa2a69c7efcb70000000000000000000000000000000000000000000000001bc16d674ec80000', // Output of tx1.data
      },
      {
        to: '0x59578a7381a77770B46153A7443a4c566fCC5427',
        value: parseEther('1').toString(),
        data: '0x40c10f19000000000000000000000000fda58254cbf6fa8ece7fc3ca5664cf5b7ebee35e0000000000000000000000000000000000000000000000001bc16d674ec80000', // Output of tx2.data
      },
    ],
    '0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B' // multisent contract Celo https://explorer.celo.org/mainnet/address/0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B/contracts#address-tabs
  );

  console.log(finalTx);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
