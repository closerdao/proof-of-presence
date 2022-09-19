import {soliditySha3} from 'web3-utils';

export function ERC165(functionSignatures: string[] = []) {
  const INTERFACE_ID_LENGTH = 4;

  const interfaceIdBuffer = functionSignatures
    .map((signature) => soliditySha3(signature) as string) // keccak256
    .map(
      (h) => Buffer.from(h.substring(2), 'hex').slice(0, 4) // bytes4()
    )
    .reduce((memo, bytes) => {
      for (let i = 0; i < INTERFACE_ID_LENGTH; i++) {
        memo[i] = memo[i] ^ bytes[i]; // xor
      }
      return memo;
    }, Buffer.alloc(INTERFACE_ID_LENGTH));

  return `0x${interfaceIdBuffer.toString('hex')}`;
}

export function ERC1820(interfaceName: string) {
  return soliditySha3(interfaceName); // keccak256
}
