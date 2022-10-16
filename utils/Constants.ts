import {ethers} from 'ethers';
const BN = ethers.BigNumber;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
export const MAX_UINT256 = BN.from('2').pow(BN.from('256')).sub(BN.from('1'));
export const MAX_INT256 = BN.from('2').pow(BN.from('255')).sub(BN.from('1'));
export const MIN_INT256 = BN.from('2').pow(BN.from('255')).mul(BN.from('-1'));
