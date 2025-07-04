import {
  TransactionReceipt,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  PublicKey,
} from '@hashgraph/sdk';
import { HashinalsWalletConnectSDK } from '@hashgraphonline/hashinal-wc';
import { HCS2BaseClient } from './base-client';
import {
  HCS2ClientConfig,
  HCS2Message,
  HCS2Operation,
  HCS2RegistryType,
  TopicRegistrationResponse,
  RegistryOperationResponse,
  TopicRegistry,
  CreateRegistryOptions,
  RegisterEntryOptions,
  UpdateEntryOptions,
  DeleteEntryOptions,
  MigrateTopicOptions,
  QueryRegistryOptions,
} from './types';
import { isBrowser } from '../utils/is-browser';

/**
 * Browser client configuration for HCS-2
 */
export interface BrowserHCS2Config extends HCS2ClientConfig {
  hwc: HashinalsWalletConnectSDK;
}

/**
 * Browser client for HCS-2 operations
 */
export class BrowserHCS2Client extends HCS2BaseClient {
  private hwc: HashinalsWalletConnectSDK;

  /**
   * Create a new browser HCS-2 client
   * @param config Client configuration
   */
  constructor(config: BrowserHCS2Config) {
    super({
      network: config.network,
      logLevel: config.logLevel,
      silent: config.silent,
      mirrorNodeUrl: config.mirrorNodeUrl,
      logger: config.logger,
    });

    this.hwc = config.hwc;

    if (!isBrowser) {
      this.logger.error(
        'BrowserHCS2Client initialized in server environment - browser-specific features will not be available. Use HCS2Client instead.',
      );
    } else {
      this.logger.info('HCS-2 browser client initialized successfully');
    }
  }

  /**
   * Get the operator account ID
   * @returns The operator account ID
   */
  private getOperatorId(): string {
    const accountInfo = this.hwc.getAccountInfo();
    if (!accountInfo || !accountInfo.accountId) {
      throw new Error('No connected account found');
    }
    return accountInfo.accountId;
  }

  /**
   * Create a new registry topic
   * @param options Registry creation options
   * @returns Promise resolving to the transaction result
   */
  async createRegistry(
    options: CreateRegistryOptions = {},
  ): Promise<TopicRegistrationResponse> {
    try {
      const registryType = options.registryType ?? HCS2RegistryType.INDEXED;
      const ttl = options.ttl ?? 86400; // Default TTL: 24 hours

      const memo = this.generateRegistryMemo(registryType, ttl);

      let transaction = new TopicCreateTransaction().setTopicMemo(memo);

      // Add admin key if requested (using connected wallet)
      if (options.adminKey) {
        let adminPublicKey: PublicKey;
        if (typeof options.adminKey === 'string') {
          adminPublicKey = PublicKey.fromString(options.adminKey);
        } else if (typeof options.adminKey === 'boolean') {
          adminPublicKey = await this.mirrorNode.getPublicKey(
            this.getOperatorId(),
          );
        } else {
          // Provided as PrivateKey instance
          adminPublicKey = options.adminKey.publicKey;
        }
        transaction = transaction.setAdminKey(adminPublicKey);
      }

      // Add submit key if requested (using connected wallet)
      if (options.submitKey) {
        let submitPublicKey: PublicKey;
        if (typeof options.submitKey === 'string') {
          submitPublicKey = PublicKey.fromString(options.submitKey);
        } else if (typeof options.submitKey === 'boolean') {
          submitPublicKey = await this.mirrorNode.getPublicKey(
            this.getOperatorId(),
          );
        } else {
          submitPublicKey = options.submitKey.publicKey;
        }
        transaction = transaction.setSubmitKey(submitPublicKey);
      }

      const txResponse = await (
        this.hwc as any
      ).executeTransactionWithErrorHandling(transaction, false);

      if (txResponse?.error) {
        throw new Error(txResponse.error);
      }

      const resultReceipt = txResponse?.result;
      if (!resultReceipt?.topicId) {
        throw new Error('Failed to create registry: No topic ID in receipt');
      }

      const topicId = resultReceipt.topicId.toString();

      this.logger.info(
        `Created registry topic: ${topicId} (${registryType === HCS2RegistryType.INDEXED ? 'Indexed' : 'Non-indexed'}, TTL: ${ttl}s)`,
      );

      return {
        success: true,
        topicId,
        transactionId: txResponse.transactionId || 'unknown',
      };
    } catch (error) {
      this.logger.error(`Failed to create registry: ${error}`);
      return {
        success: false,
        error: `Failed to create registry: ${error}`,
      };
    }
  }

  /**
   * Register a new entry in the registry
   * @param registryTopicId The topic ID of the registry
   * @param options Registration options
   * @returns Promise resolving to the operation result
   */
  async registerEntry(
    registryTopicId: string,
    options: RegisterEntryOptions,
  ): Promise<RegistryOperationResponse> {
    try {
      // Create register message
      const message = this.createRegisterMessage(
        options.targetTopicId,
        options.metadata,
        options.memo,
      );

      // Ensure operation type is correctly set
      if (message.op !== HCS2Operation.REGISTER) {
        throw new Error(
          `Invalid operation type: ${message.op}, expected ${HCS2Operation.REGISTER}`,
        );
      }

      const receipt = await this.submitMessage(registryTopicId, message);

      this.logger.info(
        `Registered entry in registry ${registryTopicId} pointing to topic ${options.targetTopicId}`,
      );

      return {
        success: true,
        receipt,
        sequenceNumber: receipt.topicSequenceNumber?.low ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to register entry: ${error}`);
      return {
        success: false,
        error: `Failed to register entry: ${error}`,
      };
    }
  }

  /**
   * Update an existing entry in the registry (indexed registries only)
   * @param registryTopicId The topic ID of the registry
   * @param options Update options
   * @returns Promise resolving to the operation result
   */
  async updateEntry(
    registryTopicId: string,
    options: UpdateEntryOptions,
  ): Promise<RegistryOperationResponse> {
    try {
      // Verify registry type (only indexed registries support updates)
      const registryInfo = await this.mirrorNode.getTopicInfo(registryTopicId);
      const memoInfo = this.parseRegistryTypeFromMemo(registryInfo.memo);

      if (!memoInfo || memoInfo.registryType !== HCS2RegistryType.INDEXED) {
        throw new Error(
          'Update operation is only valid for indexed registries',
        );
      }

      const message = this.createUpdateMessage(
        options.targetTopicId,
        options.uid,
        options.metadata,
        options.memo,
      );

      const receipt = await this.submitMessage(registryTopicId, message);

      this.logger.info(
        `Updated entry with UID ${options.uid} in registry ${registryTopicId}`,
      );

      return {
        success: true,
        receipt,
        sequenceNumber: receipt.topicSequenceNumber?.low ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to update entry: ${error}`);
      return {
        success: false,
        error: `Failed to update entry: ${error}`,
      };
    }
  }

  /**
   * Delete an entry from the registry (indexed registries only)
   * @param registryTopicId The topic ID of the registry
   * @param options Delete options
   * @returns Promise resolving to the operation result
   */
  async deleteEntry(
    registryTopicId: string,
    options: DeleteEntryOptions,
  ): Promise<RegistryOperationResponse> {
    try {
      // Verify registry type (only indexed registries support deletions)
      const registryInfo = await this.mirrorNode.getTopicInfo(registryTopicId);
      const memoInfo = this.parseRegistryTypeFromMemo(registryInfo.memo);

      if (!memoInfo || memoInfo.registryType !== HCS2RegistryType.INDEXED) {
        throw new Error(
          'Delete operation is only valid for indexed registries',
        );
      }

      // Create delete message
      const message = this.createDeleteMessage(options.uid, options.memo);

      const receipt = await this.submitMessage(registryTopicId, message);

      this.logger.info(
        `Deleted entry with UID ${options.uid} from registry ${registryTopicId}`,
      );

      return {
        success: true,
        receipt,
        sequenceNumber: receipt.topicSequenceNumber?.low ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to delete entry: ${error}`);
      return {
        success: false,
        error: `Failed to delete entry: ${error}`,
      };
    }
  }

  /**
   * Migrate a registry to a new topic
   * @param registryTopicId The topic ID of the registry
   * @param options Migration options
   * @returns Promise resolving to the operation result
   */
  async migrateRegistry(
    registryTopicId: string,
    options: MigrateTopicOptions,
  ): Promise<RegistryOperationResponse> {
    try {
      const message = this.createMigrateMessage(
        options.targetTopicId,
        options.metadata,
        options.memo,
      );

      const receipt = await this.submitMessage(registryTopicId, message);

      this.logger.info(
        `Migrated registry ${registryTopicId} to ${options.targetTopicId}`,
      );

      return {
        success: true,
        receipt,
        sequenceNumber: receipt.topicSequenceNumber?.low ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to migrate registry: ${error}`);
      return {
        success: false,
        error: `Failed to migrate registry: ${error}`,
      };
    }
  }

  /**
   * Get all entries from a registry
   * @param topicId The topic ID of the registry
   * @param options Query options
   * @returns Promise resolving to the registry information
   */
  async getRegistry(
    topicId: string,
    options: QueryRegistryOptions = {},
  ): Promise<TopicRegistry> {
    try {
      // Get topic info to determine registry type
      const topicInfo = await this.mirrorNode.getTopicInfo(topicId);
      const memoInfo = this.parseRegistryTypeFromMemo(topicInfo.memo);

      if (!memoInfo) {
        throw new Error(
          `Topic ${topicId} is not an HCS-2 registry (invalid memo format)`,
        );
      }

      const messagesResult = await this.mirrorNode.getTopicMessages(topicId, {
        sequenceNumber:
          options.skip && options.skip > 0 ? `gt:${options.skip}` : undefined,
        limit: options.limit ?? 100,
        order: options.order ?? 'asc',
      });

      // Since getTopicMessages fetches all pages, we must manually truncate if a limit was set.
      const messages = options.limit
        ? messagesResult.slice(0, options.limit)
        : messagesResult;

      // Parse messages into registry entries
      return this.parseRegistryEntries(
        topicId,
        messages,
        memoInfo.registryType,
        memoInfo.ttl,
      );
    } catch (error) {
      this.logger.error(`Failed to get registry: ${error}`);
      throw error;
    }
  }

  /**
   * Submit a message to a topic
   * @param topicId The topic ID to submit to
   * @param payload The message payload
   * @returns Promise resolving to the transaction receipt
   */
  async submitMessage(
    topicId: string,
    payload: HCS2Message,
  ): Promise<TransactionReceipt> {
    try {
      // Validate message
      const { valid, errors } = this.validateMessage(payload);
      if (!valid) {
        throw new Error(`Invalid HCS-2 message: ${errors.join(', ')}`);
      }

      const transaction = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(JSON.stringify(payload));

      const txResponse = await (
        this.hwc as any
      ).executeTransactionWithErrorHandling(transaction, false);

      if (txResponse?.error) {
        throw new Error(txResponse.error);
      }

      return txResponse.result;
    } catch (error) {
      this.logger.error(`Failed to submit message: ${error}`);
      throw error;
    }
  }
}
