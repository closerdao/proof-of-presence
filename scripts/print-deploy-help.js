#!/usr/bin/env node
/* eslint-disable no-undef */

console.log(`Explicit deployment commands:

  npm run deploy:legacy -- <network> [hardhat-deploy args...]
  npm run deploy:contract -- --contract CommunityToken --config path/to/config.json [--network <network>]
  npm run deploy:village -- --config path/to/config.json [--network <network>]
  npm run deploy:tdf-v2 -- --config path/to/config.json [--network <network>]

Verification and export:

  npm run verify:legacy -- <network> [verify args...]
  npm run verify:village -- --manifest deployments/villages/<chainId>/<slug>.json
  npm run export:village -- --manifest deployments/villages/<chainId>/<slug>.json [--out <file.json>]

Owner actions:

  npm run owner:submit -- --manifest <manifest.json> --network <network> [--upgrade <contract>:<version>]
  npm run owner:status -- --manifest <manifest.json> --network <network> [--upgrade <contract>:<version>]

Bare deploy is intentionally non-transactional. Pick an explicit generation/profile command.
`);
