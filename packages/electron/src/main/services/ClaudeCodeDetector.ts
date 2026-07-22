import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
  claudeAuthStateService,
  type ClaudeAuthStateKind,
} from './ClaudeAuthStateService';

export interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  authState: ClaudeAuthStateKind;
  authSource: 'claude-cli-auth-status';
  authCheckedAt: number | null;
  authError?: string;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  organization?: string;
  subscriptionType?: string;
  version?: string;
  hasSession?: boolean;
  hasApiKey?: boolean;
}

/**
 * Service to detect Claude Code CLI installation and login status
 */
export class ClaudeCodeDetector {
  private cachedInstallation: { installed: boolean; version?: string } | null = null;
  private installationCacheTimestamp: number = 0;
  private installationCheck: Promise<{ installed: boolean; version?: string }> | null = null;
  private cacheGeneration = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  /**
   * Check if Claude Code CLI is installed
   */
  async isInstalled(): Promise<boolean> {
    const installation = await this.getInstallationStatus();
    return installation.installed;
  }

  /**
   * Check if user is logged in to Claude Code
   */
  async isLoggedIn(): Promise<boolean> {
    const status = await this.getStatus();
    return status.loggedIn;
  }

  /**
   * Get full installation and login status
   */
  async getStatus(): Promise<ClaudeCodeStatus> {
    const [installed, authState] = await Promise.all([
      this.getInstallationStatus(),
      claudeAuthStateService.getState(),
    ]);

    const status: ClaudeCodeStatus = {
      installed: installed.installed,
      version: installed.version,
      loggedIn: authState.status === 'logged-in',
      authState: authState.status,
      authSource: authState.source,
      authCheckedAt: authState.checkedAt,
      authError: authState.error,
      authMethod: authState.authMethod,
      apiProvider: authState.apiProvider,
      email: authState.email,
      organization: authState.organization,
      subscriptionType: authState.subscriptionType,
      hasSession: authState.status === 'logged-in',
      hasApiKey: false,
    };

    return status;
  }

  /**
   * Clear the cache to force a fresh check
   */
  clearCache(): void {
    this.cacheGeneration += 1;
    this.cachedInstallation = null;
    this.installationCacheTimestamp = 0;
    this.installationCheck = null;
    claudeAuthStateService.invalidate();
  }

  private async getInstallationStatus(): Promise<{ installed: boolean; version?: string }> {
    const now = Date.now();
    if (
      this.cachedInstallation
      && now - this.installationCacheTimestamp < this.CACHE_DURATION
    ) {
      return this.cachedInstallation;
    }

    if (this.installationCheck) {
      return this.installationCheck;
    }

    const generation = this.cacheGeneration;
    const check = this.checkInstallation().then((installation) => {
      if (generation === this.cacheGeneration) {
        this.cachedInstallation = installation;
        this.installationCacheTimestamp = Date.now();
      }
      return installation;
    });
    this.installationCheck = check;

    try {
      return await check;
    } finally {
      if (this.installationCheck === check) {
        this.installationCheck = null;
      }
    }
  }

  /**
   * Get enhanced PATH that includes common Claude Code installation locations
   */
  private getEnhancedPath(): string {
    const currentPath = process.env.PATH || '';
    const additionalPaths: string[] = [];

    if (process.platform === 'win32') {
      // Windows: npm global bin is in %APPDATA%\npm
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      additionalPaths.push(path.join(appData, 'npm'));
      // Also check user profile path variant
      additionalPaths.push(path.join(os.homedir(), 'AppData', 'Roaming', 'npm'));
      // Native installer location
      additionalPaths.push(path.join(os.homedir(), '.local', 'bin'));
    } else {
      // macOS/Linux: ~/.local/bin for native installs
      additionalPaths.push(path.join(os.homedir(), '.local', 'bin'));
      // npm global paths
      additionalPaths.push(path.join(os.homedir(), '.npm-global', 'bin'));
      additionalPaths.push('/usr/local/bin');
    }

    const separator = process.platform === 'win32' ? ';' : ':';
    return [...additionalPaths, currentPath].join(separator);
  }

  /**
   * Check if the user has Claude Code CLI installed globally
   */
  private async checkInstallation(): Promise<{ installed: boolean; version?: string }> {
    return new Promise((resolve) => {
      try {
        // Try to run: claude --version
        logger.main.info('[ClaudeCodeDetector] Checking for Claude Code CLI installation...');

        const enhancedPath = this.getEnhancedPath();
        logger.main.info('[ClaudeCodeDetector] Using PATH:', enhancedPath);

        const env = {
          ...process.env,
          PATH: enhancedPath,
        };

        const childProcess = spawn('claude', ['--version'], {
          timeout: 10000,
          shell: true,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        let errorOutput = '';

        childProcess.stdout?.on('data', (data) => {
          output += data.toString();
        });

        childProcess.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });

        childProcess.on('close', (code) => {
          if (code === 0 && output) {
            const version = output.trim();
            logger.main.info('[ClaudeCodeDetector] CLI installed, version:', version);
            resolve({ installed: true, version });
          } else {
            logger.main.info('[ClaudeCodeDetector] CLI not installed or failed to run. Exit code:', code);
            if (errorOutput) {
              logger.main.info('[ClaudeCodeDetector] Error output:', errorOutput);
            }
            resolve({ installed: false });
          }
        });

        childProcess.on('error', (error) => {
          logger.main.error('[ClaudeCodeDetector] Failed to spawn claude:', error);
          resolve({ installed: false });
        });
      } catch (error) {
        logger.main.error('[ClaudeCodeDetector] Installation check failed:', error);
        resolve({ installed: false });
      }
    });
  }

}

// Singleton instance
export const claudeCodeDetector = new ClaudeCodeDetector();
