import type {BaseContract, ContractRunner} from 'ethers';

export type RuntimeContract = Omit<BaseContract, 'connect'> &
  Record<string, any> & {
    connect(runner?: ContractRunner | null): RuntimeContract;
  };

export interface ConnectableContract {
  connect(runner?: ContractRunner | null): RuntimeContract;
}

export type ContractMap = Record<string, ConnectableContract>;
export type ConnectedContractMap<T extends ContractMap> = {
  [K in keyof T]: RuntimeContract;
};
