import {ethers, getUnnamedAccounts} from './hardhat3-compat.js';
// example script

const args = process.argv.slice(2);
const account = args[0];
const message = args[1];

async function main() {
  const accountAddress = isNaN(parseInt(account)) ? account : (await getUnnamedAccounts())[parseInt(account)];

  const greetingsRegistry = await ethers.getContract('GreetingsRegistry', accountAddress);
  await greetingsRegistry.setMessage(message || 'hello');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
