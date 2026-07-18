import {keccak256, toUtf8Bytes} from 'ethers';

export function ERC165(functionSignatures: string[] = []) {
  const INTERFACE_ID_LENGTH = 4;

  const interfaceIdBuffer = functionSignatures
    .map((signature) => keccak256(toUtf8Bytes(signature)))
    .map(
      (h) => Buffer.from(h.substring(2), 'hex').slice(0, 4), // bytes4()
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
  return keccak256(toUtf8Bytes(interfaceName));
}
