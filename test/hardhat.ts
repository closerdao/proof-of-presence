import {network} from 'hardhat';
import type {BaseContract, ContractRunner} from 'ethers';

export const connection = await network.getOrCreate();

export type RuntimeContract = Omit<BaseContract, 'connect'> &
  Record<string, any> & {
    connect(runner?: ContractRunner | null): RuntimeContract;
  };

type RuntimeEthers = Omit<typeof connection.ethers, 'getContractAt'> & {
  getContractAt(...args: Parameters<typeof connection.ethers.getContractAt>): Promise<RuntimeContract>;
};

export const ethers = connection.ethers as RuntimeEthers;
