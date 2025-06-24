import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  TransactionId,
  TransactionReceipt,
  PrivateKey,
  PublicKey,
  KeyList,
  Hbar,
  AccountId,
  Transaction,
} from '@hashgraph/sdk';
import type { DAppSigner } from '@hashgraph/hedera-wallet-connect';
import { HashinalsWalletConnectSDK } from '@hashgraphonline/hashinal-wc';
import { HCS12BaseClient, HCS12Config } from './base-client';
import { Logger } from '../utils/logger';
import {
  ActionRegistry,
  BlockLoader,
  AssemblyRegistry,
  HashLinksRegistry,
} from './registries';
import {
  RegistryType,
  ActionRegistration,
  AssemblyRegistration,
  AssemblyAddBlock,
  AssemblyAddAction,
  AssemblyUpdate,
  BlockDefinition,
} from './types';

/**
 * Configuration for HCS-12 browser client
 */
export interface HCS12BrowserClientConfig extends HCS12Config {
  /** HashConnect Wallet Connect SDK instance */
  hwc: HashinalsWalletConnectSDK;
}

/**
 * HCS-12 browser client for client-side HashLinks operations
 */
export class HCS12BrowserClient extends HCS12BaseClient {
  private hwc: HashinalsWalletConnectSDK;
  private accountId?: string;

  constructor(config: HCS12BrowserClientConfig) {
    super(config);

    this.hwc = config.hwc;

    this.updateAccountFromWallet();

    this.logger.info('HCS-12 Browser Client initialized', {
      network: config.network,
      accountId: this.accountId,
    });
  }

  /**
   * Update account ID from wallet connect session
   */
  private async updateAccountFromWallet(): Promise<void> {
    try {
      const { accountId } = await this.getAccountAndSigner();
      this.accountId = accountId;
    } catch (error) {
      this.logger.warn('No active wallet connection');
    }
  }

  /**
   * Get account and signer from wallet connect
   */
  async getAccountAndSigner(): Promise<{
    accountId: string;
    signer: DAppSigner;
  }> {
    const accountInfo = this?.hwc?.getAccountInfo();
    const accountId = accountInfo?.accountId?.toString();
    const signer = this?.hwc?.dAppConnector?.signers?.find(s => {
      return s.getAccountId().toString() === accountId;
    });

    if (!signer || !accountId) {
      this.logger.error('Failed to find signer', {
        accountId,
        signers: this?.hwc?.dAppConnector?.signers,
        accountInfo,
      });
      throw new Error('Failed to find signer or account');
    }

    return { accountId, signer };
  }

  /**
   * Get operator account ID (throws in browser)
   */
  getOperatorAccountId(): string {
    throw new Error('Browser client does not have operator account');
  }

  /**
   * Get operator private key (throws in browser)
   */
  getOperatorPrivateKey(): string {
    throw new Error('Browser client does not have operator private key');
  }

  /**
   * Initialize registries with optional existing topic IDs
   */
  initializeRegistries(topicIds?: {
    action?: string;
    assembly?: string;
    hashlinks?: string;
  }): void {
    super.initializeRegistries(topicIds);

    this._actionRegistry = new ActionRegistry(
      this.network,
      this.logger,
      this.actionRegistryTopicId,
      this,
    );

    this._blockLoader = new BlockLoader(this.network, this.logger, this);

    this._assemblyRegistry = new AssemblyRegistry(
      this.network,
      this.logger,
      this._assemblyRegistryTopicId,
      this,
    );

    this._hashLinksRegistry = new HashLinksRegistry(
      this.network,
      this.logger,
      this._hashLinksRegistryTopicId,
      this,
    );

    this.logger.info('Registries initialized with signer', {
      actionTopicId: this.actionRegistryTopicId,
      assemblyTopicId: this._assemblyRegistryTopicId,
      hashLinksTopicId: this._hashLinksRegistryTopicId,
    });
  }

  /**
   * Create a new HCS topic for a registry
   */
  async createRegistryTopic(
    registryType: RegistryType,
    adminKey?: boolean | PublicKey | KeyList,
    submitKey?: boolean | PublicKey | KeyList,
  ): Promise<string> {
    const { accountId, signer } = await this.getAccountAndSigner();

    const memos: Record<RegistryType, string> = {
      [RegistryType.ACTION]: 'hcs-12:1:60:0',
      [RegistryType.ASSEMBLY]: 'hcs-12:1:60:2',
      [RegistryType.HASHLINKS]: 'hcs-12:1:60:3',
    };
    const memo = memos[registryType];

    this.logger.info('Creating registry topic via wallet', {
      registryType: RegistryType[registryType],
      memo,
      accountId,
    });

    const transaction = new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setTransactionId(TransactionId.generate(accountId));

    if (adminKey) {
      if (typeof adminKey === 'boolean' && adminKey) {
        const publicKey = await signer.getAccountKey();
        transaction.setAdminKey(publicKey);
        transaction.setAutoRenewAccountId(AccountId.fromString(accountId));
      } else if (adminKey instanceof PublicKey || adminKey instanceof KeyList) {
        transaction.setAdminKey(adminKey);
        transaction.setAutoRenewAccountId(AccountId.fromString(accountId));
      }
    }

    if (submitKey) {
      if (typeof submitKey === 'boolean' && submitKey) {
        const publicKey = await signer.getAccountKey();
        transaction.setSubmitKey(publicKey);
      } else if (
        submitKey instanceof PublicKey ||
        submitKey instanceof KeyList
      ) {
        transaction.setSubmitKey(submitKey);
      }
    }

    const signedTx = await transaction.freezeWithSigner(signer);
    const txResponse = await signedTx.executeWithSigner(signer);
    const receipt = await txResponse.getReceiptWithSigner(signer);

    if (!receipt.topicId) {
      throw new Error('Failed to create topic: topicId is null');
    }

    const topicId = receipt.topicId.toString();
    this.logger.info('Registry topic created via wallet', {
      topicId,
      registryType: RegistryType[registryType],
    });

    switch (registryType) {
      case RegistryType.ACTION:
        this.actionRegistryTopicId = topicId;
        break;
      case RegistryType.ASSEMBLY:
        this._assemblyRegistryTopicId = topicId;
        break;
      case RegistryType.HASHLINKS:
        break;
    }

    return topicId;
  }

  /**
   * Create a new assembly topic
   */
  async createAssembly(): Promise<string> {
    this.logger.info('Creating new assembly topic');
    const topicId = await this.createRegistryTopic(RegistryType.ASSEMBLY);
    return topicId;
  }

  /**
   * Register an assembly on its own topic
   */
  async registerAssemblyDirect(
    assemblyTopicId: string,
    registration: AssemblyRegistration,
  ): Promise<{ transactionId: string; sequenceNumber?: number }> {
    this.logger.info('Registering assembly', {
      topicId: assemblyTopicId,
      name: registration.name,
      version: registration.version,
    });

    return this._submitMessage(assemblyTopicId, JSON.stringify(registration));
  }

  /**
   * Add a block to an assembly
   */
  async addBlockToAssembly(
    assemblyTopicId: string,
    block: AssemblyAddBlock,
  ): Promise<{ transactionId: string; sequenceNumber?: number }> {
    this.logger.info('Adding block to assembly', {
      assemblyTopicId,
      blockTopicId: block.block_t_id,
    });

    return this._submitMessage(assemblyTopicId, JSON.stringify(block));
  }

  /**
   * Add an action to an assembly
   */
  async addActionToAssembly(
    assemblyTopicId: string,
    action: AssemblyAddAction,
  ): Promise<{ transactionId: string; sequenceNumber?: number }> {
    this.logger.info('Adding action to assembly', {
      assemblyTopicId,
      actionTopicId: action.t_id,
      alias: action.alias,
    });

    return this._submitMessage(assemblyTopicId, JSON.stringify(action));
  }

  /**
   * Update assembly metadata
   */
  async updateAssembly(
    assemblyTopicId: string,
    update: AssemblyUpdate,
  ): Promise<{ transactionId: string; sequenceNumber?: number }> {
    this.logger.info('Updating assembly', {
      assemblyTopicId,
      update,
    });

    return this._submitMessage(assemblyTopicId, JSON.stringify(update));
  }

  /**
   * Store a block (definition and template) via HCS-1
   */
  async storeBlock(
    template: string,
    definition: BlockDefinition,
  ): Promise<{ definitionTopicId: string; templateTopicId: string }> {
    if (!this.blockLoader) {
      throw new Error('Block loader not initialized');
    }

    return this.blockLoader.storeBlock(template, definition);
  }

  /**
   * Submit a message to an HCS topic
   * @deprecated Use operation-specific methods instead
   */
  async submitMessage(
    topicId: string,
    message: string,
    submitKey?: PrivateKey,
  ): Promise<{ transactionId: string; sequenceNumber?: number }> {
    this.logger.warn(
      'submitMessage is deprecated. Use operation-specific methods instead.',
    );
    return this._submitMessage(topicId, message, submitKey);
  }

  /**
   * Internal method to submit a message to an HCS topic
   */
  private async _submitMessage(
    topicId: string,
    message: string,
    submitKey?: PrivateKey,
  ): Promise<{ transactionId: string; sequenceNumber?: number }> {
    const { accountId, signer } = await this.getAccountAndSigner();

    this.logger.debug('Submitting message to topic via wallet', {
      topicId,
      messageLength: message.length,
      accountId,
    });

    const transaction = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .setTransactionId(TransactionId.generate(accountId));

    if (submitKey) {
      this.logger.warn(
        'Submit key parameter ignored in browser client - using wallet signer',
      );
    }

    const signedTx = await transaction.freezeWithSigner(signer);
    const txResponse = await signedTx.executeWithSigner(signer);
    const receipt = await txResponse.getReceiptWithSigner(signer);

    this.logger.info('Message submitted successfully via wallet', {
      topicId,
      transactionId: txResponse.transactionId.toString(),
      sequenceNumber: receipt.topicSequenceNumber?.toString(),
    });

    return {
      transactionId: txResponse.transactionId.toString(),
      sequenceNumber: receipt.topicSequenceNumber
        ? Number(receipt.topicSequenceNumber)
        : undefined,
    };
  }

  /**
   * Get the HashConnect instance
   */
  getHashConnect(): HashinalsWalletConnectSDK {
    return this.hwc;
  }

  /**
   * Get connected account ID
   */
  getAccountId(): string | undefined {
    return this.accountId;
  }

  /**
   * Check if wallet is connected
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.getAccountAndSigner();
      return true;
    } catch {
      return false;
    }
  }
}
