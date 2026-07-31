#!/usr/bin/env node
/* eslint-disable no-undef */

console.log(`Explicit deployment commands:

  yarn deploy:village -- --config path/to/config.json [--network <network>]
  yarn deploy:tdf -- --config path/to/config.json [--network <network>]

Verification:

  yarn hardhat --network <network> ignition verify <deployment-id>

Ownership handoff and upgrades:

  yarn owner:submit -- --manifest <manifest.json> --network <network>
  yarn owner:status -- --manifest <manifest.json> --network <network>
  yarn upgrade:prepare -- --manifest <manifest.json> --contract <name> --implementation <artifact> --version <version>
  yarn upgrade:submit -- --manifest <manifest.json> --upgrade <contract>:<version>
  yarn upgrade:status -- --manifest <manifest.json> --upgrade <contract>:<version>

Bare deploy is intentionally non-transactional. Pick an explicit deployment command.
`);
