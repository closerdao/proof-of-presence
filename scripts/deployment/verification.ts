import {spawn} from 'node:child_process';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type VillageDeploymentManifest,
} from './village.js';

export interface IgnitionVerificationAttempt {
  status: 'success' | 'failed' | 'skipped';
  attemptedAt: string;
  network: string;
  deploymentId: string;
  command: string[];
  output: string;
}

/**
 * Runs the same best-effort Ignition verification task for initial submission and later retries.
 * Explorer failures are returned as attempts rather than thrown so deployment completion does not depend on explorer uptime.
 */
export async function verifyIgnitionDeployment(
  network: string,
  deploymentId: string,
): Promise<IgnitionVerificationAttempt> {
  const command = ['npx', '--no-install', 'hardhat', '--network', network, 'ignition', 'verify', deploymentId];
  if (['default', 'localhost'].includes(network)) {
    return {
      status: 'skipped',
      attemptedAt: new Date().toISOString(),
      network,
      deploymentId,
      command,
      output: 'Verification is skipped for ephemeral/local networks.',
    };
  }

  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({
        status: code === 0 ? 'success' : 'failed',
        attemptedAt: new Date().toISOString(),
        network,
        deploymentId,
        command,
        output,
      });
    });
  });
}

export async function recordIgnitionVerification(
  manifestPath: string,
  attempt: IgnitionVerificationAttempt,
): Promise<VillageDeploymentManifest> {
  const manifest = await readVillageDeploymentManifest(manifestPath);
  manifest.verification.attempts.push({
    status: attempt.status,
    attemptedAt: attempt.attemptedAt,
    network: attempt.network,
    deploymentId: attempt.deploymentId,
    command: attempt.command,
    // Keep the useful command tail without allowing explorer output to grow the manifest indefinitely.
    summary: attempt.output.trim().slice(-2_000),
  });
  await writeVillageDeploymentManifest(manifestPath, manifest);
  return manifest;
}

export async function attemptAutomaticVerification(
  manifestPath: string,
  manifest: VillageDeploymentManifest,
): Promise<IgnitionVerificationAttempt> {
  const attempt = await verifyIgnitionDeployment(manifest.network, manifest.deploymentTool.deploymentId);
  await recordIgnitionVerification(manifestPath, attempt);
  return attempt;
}
