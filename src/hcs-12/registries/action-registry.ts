/**
 * Action Registry Implementation for HCS-12
 *
 * Manages registration and retrieval of HashLink WASM actions.
 */

import { Logger } from '../../utils/logger';
import { NetworkType } from '../../utils/types';
import {
  RegistryType,
  AssemblyRegistryEntry,
  ActionRegistration,
  ModuleInfo,
  SourceVerification,
} from '../types';
import { BaseRegistry } from './base-registry';
import { retrieveInscription } from '../../inscribe';
import { createHash } from 'crypto';
import type { HCS12Client } from '../sdk';
import type { HCS12BrowserClient } from '../browser';
import {
  validateActionRegistration,
  safeValidate,
  actionRegistrationSchema,
} from '../validation/schemas';
import { ZodError } from 'zod';

/**
 * Registry for HashLink WASM actions
 */
export class ActionRegistry extends BaseRegistry {
  private actionsByHash: Map<string, ActionRegistration> = new Map();

  constructor(
    networkType: NetworkType,
    logger: Logger,
    topicId?: string,
    client?: HCS12Client | HCS12BrowserClient,
  ) {
    super(networkType, logger, RegistryType.ACTION, topicId, client);
  }

  /**
   * Register a WASM module with its binary via HCS-1
   */
  async registerWithWasm(
    wasmBinary: Buffer,
    moduleInfo: ModuleInfo,
    sourceVerification?: SourceVerification,
  ): Promise<ActionRegistration> {
    const wasmHash = createHash('sha256').update(wasmBinary).digest('hex');
    const infoString = JSON.stringify(moduleInfo);
    const infoHash = createHash('sha256').update(infoString).digest('hex');

    const wasmTopicId = await this.inscribeContent(
      wasmBinary,
      'application/octet-stream',
      {
        name: moduleInfo.name,
        version: moduleInfo.version,
        hash: wasmHash,
        fileType: 'wasm',
      },
    );

    let infoTopicId: string | undefined;
    if (Buffer.byteLength(infoString, 'utf8') > 1024) {
      infoTopicId = await this.inscribeContent(infoString, 'application/json', {
        name: `${moduleInfo.name}-info`,
        version: moduleInfo.version,
      });
    }

    const registration: ActionRegistration = {
      p: 'hcs-12',
      op: 'register',
      t_id: wasmTopicId,
      hash: infoHash,
      wasm_hash: wasmHash,
      info_t_id: infoTopicId,
      source_verification: sourceVerification,
      m: `${moduleInfo.name} v${moduleInfo.version}`,
    };

    const id = await this.register(registration);
    return registration;
  }

  /**
   * Register a new WASM action
   */
  async register(registration: ActionRegistration): Promise<string> {
    this.validateRegistration(registration);

    if (this.topicId && this.client) {
      this.logger.info('Submitting action registration to HCS', {
        topicId: this.topicId,
        hash: registration.hash,
        wasmHash: registration.wasm_hash,
      });

      const result = await this.client.submitMessage(
        this.topicId,
        JSON.stringify(registration),
      );

      const sequenceNumber = result.sequenceNumber;
      if (!sequenceNumber) {
        throw new Error('No sequence number returned from submission');
      }

      const entry: AssemblyRegistryEntry = {
        id: sequenceNumber.toString(),
        sequenceNumber,
        timestamp: new Date().toISOString(),
        submitter:
          'getHashConnect' in this.client
            ? (await (this.client as HCS12BrowserClient).getAccountAndSigner())
                .accountId
            : this.client.getOperatorAccountId(),
        data: registration,
      };

      this.entries.set(entry.id, entry);
      this.actionsByHash.set(registration.hash, registration);

      this.logger.info('Action registered', {
        hash: registration.hash,
        sequenceNumber,
        hasSourceVerification: !!registration.source_verification,
      });

      return sequenceNumber.toString();
    } else {
      const sequenceNumber = this.entries.size + 1;
      const entry: AssemblyRegistryEntry = {
        id: sequenceNumber.toString(),
        sequenceNumber,
        timestamp: new Date().toISOString(),
        submitter: 'local',
        data: registration,
      };

      this.entries.set(entry.id, entry);
      this.actionsByHash.set(registration.hash, registration);

      return sequenceNumber.toString();
    }
  }

  /**
   * Retrieve action by hash
   */
  async getAction(hash: string): Promise<ActionRegistration | null> {
    const cached = this.actionsByHash.get(hash);
    if (cached) return cached;

    if (this.topicId && this.client) {
      await this.sync();
      return this.actionsByHash.get(hash) || null;
    }

    return null;
  }

  /**
   * Retrieve action by topic ID
   */
  async getActionByTopicId(
    topicId: string,
  ): Promise<ActionRegistration | null> {
    this.logger.debug('getActionByTopicId called', { topicId });
    console.log('DEBUG: getActionByTopicId called', {
      topicId,
      cacheSize: this.actionsByHash.size,
      cachedTopicIds: Array.from(this.actionsByHash.values()).map(a => a.t_id),
    });

    for (const action of this.actionsByHash.values()) {
      if (action.t_id === topicId) {
        this.logger.debug('Action found in cache', { topicId, action });
        console.log('DEBUG: Action found in cache', { topicId, action });
        return action;
      }
    }

    if (this.topicId && this.client) {
      this.logger.debug('Action not in cache, syncing...', { topicId });
      console.log('DEBUG: Action not in cache, syncing...');
      await this.sync();

      console.log('DEBUG: After sync', {
        cacheSize: this.actionsByHash.size,
        cachedTopicIds: Array.from(this.actionsByHash.values()).map(
          a => a.t_id,
        ),
      });

      for (const action of this.actionsByHash.values()) {
        if (action.t_id === topicId) {
          this.logger.debug('Action found after sync', { topicId, action });
          console.log('DEBUG: Action found after sync', { topicId, action });
          return action;
        }
      }
    }

    this.logger.warn('Action not found', { topicId });
    console.log('DEBUG: Action not found', { topicId });
    return null;
  }

  /**
   * Retrieve action info by hash
   */
  async getActionInfo(hash: string): Promise<ModuleInfo | null> {
    const action = await this.getAction(hash);
    if (!action) return null;

    try {
      let infoString: string;

      if (action.info_t_id) {
        if (!this.client) {
          this.logger.error('Client not initialized - cannot fetch INFO');
          return null;
        }

        let inscription;

        if ('getOperatorAccountId' in this.client) {
          inscription = await retrieveInscription(action.info_t_id, {
            accountId: this.client.getOperatorAccountId(),
            privateKey: this.client.getOperatorPrivateKey(),
            network: this.networkType as 'mainnet' | 'testnet',
          });
        } else {
          const { accountId } = await (
            this.client as HCS12BrowserClient
          ).getAccountAndSigner();
          inscription = await retrieveInscription(action.info_t_id, {
            accountId,
            network: this.networkType as 'mainnet' | 'testnet',
          });
        }

        if (!inscription.content) {
          this.logger.error('No content in inscription response');
          return null;
        }
        infoString =
          typeof inscription.content === 'string'
            ? inscription.content
            : Buffer.from(inscription.content).toString('utf8');
      } else {
        this.logger.warn('Inline INFO storage not yet implemented');
        return null;
      }

      const moduleInfo = JSON.parse(infoString) as ModuleInfo;
      const computedHash = createHash('sha256')
        .update(infoString)
        .digest('hex');

      if (computedHash !== action.hash) {
        this.logger.error('INFO hash mismatch', {
          expected: action.hash,
          computed: computedHash,
        });
        throw new Error('Module info verification failed');
      }

      return moduleInfo;
    } catch (error) {
      this.logger.error('Failed to fetch action INFO', {
        hash,
        error,
      });
      return null;
    }
  }

  /**
   * Retrieve action WASM binary
   */
  async getActionWasm(hash: string): Promise<Uint8Array | null> {
    const action = await this.getAction(hash);
    if (!action) return null;

    if (!this.client) {
      this.logger.error('Client not initialized - cannot fetch WASM');
      return null;
    }

    try {
      let inscription;

      if ('getOperatorAccountId' in this.client) {
        inscription = await retrieveInscription(action.t_id, {
          accountId: this.client.getOperatorAccountId(),
          privateKey: this.client.getOperatorPrivateKey(),
          network: this.networkType as 'mainnet' | 'testnet',
        });
      } else {
        const { accountId } = await (
          this.client as HCS12BrowserClient
        ).getAccountAndSigner();
        inscription = await retrieveInscription(action.t_id, {
          accountId,
          network: this.networkType as 'mainnet' | 'testnet',
        });
      }

      if (!inscription.content) {
        this.logger.error('No content in inscription response');
        return null;
      }

      const wasmBuffer =
        typeof inscription.content === 'string'
          ? Buffer.from(inscription.content, 'base64')
          : Buffer.from(inscription.content);

      const computedHash = createHash('sha256')
        .update(wasmBuffer)
        .digest('hex');

      if (computedHash !== action.wasm_hash) {
        this.logger.error('WASM hash mismatch', {
          expected: action.wasm_hash,
          computed: computedHash,
        });
        throw new Error('WASM binary verification failed');
      }

      return new Uint8Array(wasmBuffer);
    } catch (error) {
      this.logger.error('Failed to fetch WASM from HCS-1', {
        topicId: action.t_id,
        error,
      });
      return null;
    }
  }

  /**
   * Search actions by criteria
   */
  async searchActions(criteria: {
    creator?: string;
    capability?: string;
    afterTimestamp?: string;
    beforeTimestamp?: string;
    hasSourceVerification?: boolean;
  }): Promise<ActionRegistration[]> {
    const entries = await this.listEntries({
      submitter: criteria.creator,
      afterTimestamp: criteria.afterTimestamp,
      beforeTimestamp: criteria.beforeTimestamp,
    });

    return entries
      .map(entry => entry.data as ActionRegistration)
      .filter(action => {
        if (criteria.hasSourceVerification !== undefined) {
          const hasVerification = !!action.source_verification;
          if (hasVerification !== criteria.hasSourceVerification) return false;
        }

        return true;
      });
  }

  /**
   * Get actions by version chain
   */
  async getVersionChain(latestHash: string): Promise<ActionRegistration[]> {
    const chain: ActionRegistration[] = [];
    let currentHash: string | undefined = latestHash;

    while (currentHash) {
      const action = await this.getAction(currentHash);
      if (!action) break;

      chain.push(action);

      currentHash = undefined;
    }

    return chain;
  }

  /**
   * Validate action registration using Zod schema
   */
  private validateRegistration(registration: ActionRegistration): void {
    try {
      validateActionRegistration(registration);
    } catch (error) {
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        throw new Error(
          `Validation failed: ${firstError.path.join('.')} - ${firstError.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Override sync to handle action-specific processing
   */
  async sync(): Promise<void> {
    await super.sync();

    this.actionsByHash.clear();
    for (const entry of this.entries.values()) {
      const action = entry.data as ActionRegistration;
      this.actionsByHash.set(action.hash, action);
    }
  }

  /**
   * Override clear cache to also clear action hash index
   */
  clearCache(): void {
    super.clearCache();
    this.actionsByHash.clear();
  }
}
