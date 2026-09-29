import assert from 'assert';
import {expect} from '../chai-setup';
import {artifacts, ethers, network} from 'hardhat';
import {Contract, ContractFactory} from 'ethers';
import {readFileSync} from 'fs';
import {resolve} from 'path';
import {ROLES} from '../../utils';
import {verifyBurnInitializer} from '../../utils/tdfBurnArtifacts';
import {BURN_SAFE_ABI, burnSafeBatch, readBurnSafe, verifyBurnExecution} from '../../utils/tdfBurnSafe';
import {
  TDF_BURN,
  burnCorrectionTransaction,
  fetchBurnSources,
  readBurnPreflight,
  tdfTransfers,
} from '../../utils/tdfBurnCorrection';

// Run explicitly, without HARDHAT_DEPLOY_FIXTURE or the normal deployment suite.
const describeFork = process.env.TDF_BURN_FORK === '1' ? describe : describe.skip;

describeFork('TDFBurnCorrection Celo fork', function () {
  this.timeout(180000);

  it('executes the exact Safe CALL against deployed contracts and rejects replay', async () => {
    assert(network.name === 'hardhat', 'Run the rehearsal with the default local Hardhat configuration');
    assert(!process.env.HARDHAT_DEPLOY_FIXTURE, 'Do not run deployment fixtures in this rehearsal');
    // Hardhat 2.9 cannot decode current Celo blocks (missing totalDifficulty and L2 transaction types).
    // Keep its compiler/test tooling, but execute this opt-in rehearsal on a dedicated local Anvil node.
    const nodeUrl = new URL(process.env.TDF_BURN_FORK_NODE || 'http://127.0.0.1:18545');
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(nodeUrl.hostname), 'Fork node must be local');
    const fork = new ethers.providers.JsonRpcProvider(nodeUrl.toString(), 'any');
    fork.pollingInterval = 100;
    assert(/^anvil/i.test(await fork.send('web3_clientVersion', [])), 'Fork node must be Anvil');
    assert(Number(await fork.send('eth_chainId', [])) === TDF_BURN.chainId, 'Start Anvil with --chain-id 42220');
    const rpc = process.env.TDF_BURN_FORK_RPC || 'https://forno.celo.org';
    const upstream = new ethers.providers.JsonRpcProvider(rpc);
    assert((await upstream.getNetwork()).chainId === TDF_BURN.chainId, 'Fork RPC must be Celo mainnet');
    const requestedBlock = process.env.TDF_BURN_FORK_BLOCK;
    const blockNumber =
      requestedBlock === 'latest'
        ? await upstream.getBlockNumber()
        : requestedBlock
        ? Number(requestedBlock)
        : TDF_BURN.forkBlock;
    assert(Number.isSafeInteger(blockNumber) && blockNumber >= TDF_BURN.sources[0].block, 'Invalid fork block');
    const {excludedAccounts} = await fetchBurnSources(upstream);
    await readBurnPreflight(upstream, blockNumber);
    await fork.send('anvil_reset', [{forking: {jsonRpcUrl: rpc, blockNumber}}]);
    assert(Number(await fork.send('eth_chainId', [])) === TDF_BURN.chainId, 'Unexpected local fork chain');

    try {
      const deployment = JSON.parse(readFileSync(resolve('deployments/celo/TDFDiamond.json'), 'utf8'));
      const diamond = new Contract(TDF_BURN.diamond, deployment.abi, fork);
      const tokenArtifact = await artifacts.readArtifact('TDFToken');
      const initializerArtifact = await artifacts.readArtifact('TDFBurnCorrection');
      const token = new Contract(TDF_BURN.token, tokenArtifact.abi, fork);
      // Construct directly: this repository's old ethers plugin can discard an external provider's signer.
      const factory = new ContractFactory(initializerArtifact.abi, initializerArtifact.bytecode, fork.getSigner(0));
      const initializer = await factory.deploy(TDF_BURN.diamond, TDF_BURN.token);
      await initializer.deployed();
      await verifyBurnInitializer(fork, artifacts, initializer.address);

      await fork.send('anvil_setBalance', [TDF_BURN.safe, '0x56BC75E2D63100000']);
      await fork.send('anvil_impersonateAccount', [TDF_BURN.safe]);
      const safe = fork.getSigner(TDF_BURN.safe);
      const preservedAccounts = [TDF_BURN.safe, TDF_BURN.diamond, ...excludedAccounts];
      const years = await diamond.getAccommodationYears();
      const preservedState = async () => ({
        facets: await diamond.facets(),
        slot0: await fork.getStorageAt(TDF_BURN.diamond, 0),
        owner: await diamond.owner(),
        dao: await token.getDAOContract(),
        years: await diamond.getAccommodationYears(),
        members: await diamond.memberList(),
        balances: await Promise.all(preservedAccounts.map((account) => token.balanceOf(account))),
        targets: await Promise.all(
          TDF_BURN.targets.map(async ({account}) => ({
            staked: await diamond.stakedBalanceOf(account),
            deposits: await diamond.depositsStakedFor(account),
            bookings: await Promise.all(
              years.map((year: {number: number}) => diamond.getAccommodationBookings(account, year.number))
            ),
          }))
        ),
        roles: await Promise.all(Object.values(ROLES).map((role) => diamond.hasRole(role, TDF_BURN.safe))),
      });
      const before = await readBurnPreflight(fork);
      const preserved = await preservedState();
      const {operation, ...transaction} = burnCorrectionTransaction(initializer.address);
      expect(operation).to.eq(0);
      // Exercise the exact raw transaction exported for the Safe app.
      expect(burnSafeBatch(initializer.address).transactions[0]).to.deep.eq(transaction);
      await diamond
        .connect(safe)
        .callStatic.diamondCut([], initializer.address, initializer.interface.encodeFunctionData('execute'));
      const ownerSafe = new Contract(
        TDF_BURN.safe,
        [
          ...BURN_SAFE_ABI,
          'function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)',
          'function approveHash(bytes32)',
        ],
        fork.getSigner(0)
      );
      const safeState = await readBurnSafe(fork, 'latest');
      const safeArgs = [
        transaction.to,
        transaction.value,
        transaction.data,
        operation,
        0,
        0,
        0,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
      ];
      const safeHash = await ownerSafe.getTransactionHash(...safeArgs, safeState.nonce);
      const approvingOwners = safeState.owners
        .map((owner) => owner.toLowerCase())
        .sort()
        .slice(0, safeState.threshold);
      // Local-only owner approvals allow rehearsal without real signatures or owner keys.
      for (const owner of approvingOwners) {
        await fork.send('anvil_setBalance', [owner, '0x56BC75E2D63100000']);
        await fork.send('anvil_impersonateAccount', [owner]);
        await (await ownerSafe.connect(fork.getSigner(owner)).approveHash(safeHash)).wait();
      }
      const signatures = ethers.utils.hexConcat(
        approvingOwners.map((owner) =>
          ethers.utils.hexConcat([ethers.utils.hexZeroPad(owner, 32), ethers.utils.hexZeroPad('0x00', 32), '0x01'])
        )
      );
      const receipt = await (await ownerSafe.execTransaction(...safeArgs, signatures)).wait();
      expect(receipt.status).to.eq(1);
      const verified = await verifyBurnExecution(fork, artifacts, receipt.transactionHash);
      expect(verified.initializer).to.eq(initializer.address);
      expect(verified.safeTransactionHash).to.eq(safeHash);
      expect(await ownerSafe.nonce()).to.eq(ethers.BigNumber.from(safeState.nonce).add(1));
      const transfers = tdfTransfers(receipt);
      expect(transfers).to.have.lengthOf(4);
      for (let i = 0; i < TDF_BURN.targets.length; i++) {
        const {account, amount} = TDF_BURN.targets[i];
        expect(transfers[i].from).to.eq(account);
        expect(transfers[i].to).to.eq(ethers.constants.AddressZero);
        expect(transfers[i].amount).to.eq(amount);
        expect(await token.balanceOf(account)).to.eq(ethers.BigNumber.from(before.targets[i].expectedBalanceAfter));
      }
      expect(await token.totalSupply()).to.eq(ethers.BigNumber.from(before.expectedTotalSupplyAfter));
      expect(await preservedState()).to.deep.eq(preserved);
      expect(ethers.BigNumber.from(await fork.getStorageAt(TDF_BURN.diamond, TDF_BURN.completionSlot))).to.eq(1);
      const selector = initializer.interface.getSighash('execute');
      expect(await diamond.facetAddress(selector)).to.eq(ethers.constants.AddressZero);
      await expect(initializer.attach(TDF_BURN.diamond).connect(safe).execute()).to.be.reverted;

      // Replenishment proves replay is blocked by the completion flag, not insufficient funds.
      for (const {account, amount} of TDF_BURN.targets) await token.connect(safe).mint(account, amount);
      await expect(diamond.connect(safe).diamondCut([], initializer.address, selector)).to.be.revertedWith(
        'TDFBurnCorrection: already executed'
      );
      const replacement = await factory.deploy(TDF_BURN.diamond, TDF_BURN.token);
      await expect(diamond.connect(safe).diamondCut([], replacement.address, selector)).to.be.revertedWith(
        'TDFBurnCorrection: already executed'
      );
      console.log(`Rehearsed 41-TDF correction at Celo block ${blockNumber}; gas used: ${receipt.gasUsed.toString()}`);
    } finally {
      await fork.send('anvil_reset', []);
    }
  });
});
