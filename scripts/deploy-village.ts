#!/usr/bin/env tsx
import {runDeploymentCli} from './deployment/deploy-cli.js';

runDeploymentCli().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
