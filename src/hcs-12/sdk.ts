import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  TransactionResponse,
  TransactionReceipt,
  PrivateKey,
  PublicKey,
  KeyList,
  AccountId,
  Hbar,
} from '@hashgraph/sdk';
import { HCS12BaseClient, HCS12Config } from './base-client';
import { Logger, detectKeyTypeFromString } from '../utils';
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
import { ActionBuilder, AssemblyBuilder, BlockBuilder } from './builders';
import { inscribe } from '../inscribe/inscriber';
import { InscriptionSDK } from '@kiloscribe/inscription-sdk';
import type { RetrievedInscriptionResult } from '../inscribe/types';
import * as mime from 'mime-types';

/**
 * Configuration for HCS-12 SDK client
 */
export interface HCS12ClientConfig extends HCS12Config {
  /** Operator account ID */
  operatorId: string;
  /** Operator private key */
  operatorPrivateKey: string;
}

/**
 * HCS-12 SDK client for server-side HashLinks operations
 */
export class HCS12Client extends HCS12BaseClient {
  private client: Client;
  private operatorPrivateKey: string;
  private operatorAccountId: string;
  private keyType: 'ed25519' | 'ecdsa';

  constructor(config: HCS12ClientConfig) {
    super(config);

    this.client =
      config.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();

    this.operatorPrivateKey = config.operatorPrivateKey;
    this.operatorAccountId = config.operatorId;

    if (config.keyType) {
      this.keyType = config.keyType;
      const PK =
        this.keyType === 'ecdsa'
          ? PrivateKey.fromStringECDSA(this.operatorPrivateKey)
          : PrivateKey.fromStringED25519(this.operatorPrivateKey);
      this.client.setOperator(config.operatorId, PK);
    } else {
      try {
        const keyDetection = detectKeyTypeFromString(this.operatorPrivateKey);
        this.keyType = keyDetection.detectedType;
        this.client.setOperator(config.operatorId, keyDetection.privateKey);
        this.logger.debug(`Detected key type: ${this.keyType}`);
      } catch (error) {
        this.logger.error('Failed to detect key type:', error);
        throw new Error('Invalid private key format');
      }
    }

    this.logger.info('HCS-12 SDK Client initialized', {
      network: config.network,
      operatorId: this.operatorAccountId,
      keyType: this.keyType,
    });
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

    this.logger.info('Registries initialized', {
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
    const memos: Record<RegistryType, string> = {
      [RegistryType.ACTION]: 'hcs-12:1:60:0',
      [RegistryType.ASSEMBLY]: 'hcs-12:1:60:2',
      [RegistryType.HASHLINKS]: 'hcs-12:1:60:3',
    };
    const memo = memos[registryType];

    this.logger.info('Creating registry topic', {
      registryType: RegistryType[registryType],
      memo,
    });

    const transaction = new TopicCreateTransaction().setTopicMemo(memo);

    if (adminKey) {
      if (
        typeof adminKey === 'boolean' &&
        adminKey &&
        this.client.operatorPublicKey
      ) {
        transaction.setAdminKey(this.client.operatorPublicKey);
        transaction.setAutoRenewAccountId(this.client.operatorAccountId!);
      } else if (adminKey instanceof PublicKey || adminKey instanceof KeyList) {
        transaction.setAdminKey(adminKey);
        if (this.client.operatorAccountId) {
          transaction.setAutoRenewAccountId(this.client.operatorAccountId);
        }
      }
    }

    if (submitKey) {
      if (
        typeof submitKey === 'boolean' &&
        submitKey &&
        this.client.operatorPublicKey
      ) {
        transaction.setSubmitKey(this.client.operatorPublicKey);
      } else if (
        submitKey instanceof PublicKey ||
        submitKey instanceof KeyList
      ) {
        transaction.setSubmitKey(submitKey);
      }
    }

    const txResponse = await transaction.execute(this.client);
    const receipt = await txResponse.getReceipt(this.client);

    if (!receipt.topicId) {
      throw new Error('Failed to create topic: topicId is null');
    }

    const topicId = receipt.topicId.toString();
    this.logger.info('Registry topic created', {
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
    this.logger.debug('Submitting message to topic', {
      topicId,
      messageLength: message.length,
    });

    const transaction = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message);

    let transactionResponse: TransactionResponse;
    if (submitKey) {
      const frozenTransaction = transaction.freezeWith(this.client);
      const signedTransaction = await frozenTransaction.sign(submitKey);
      transactionResponse = await signedTransaction.execute(this.client);
    } else {
      transactionResponse = await transaction.execute(this.client);
    }

    const receipt = await transactionResponse.getReceipt(this.client);

    this.logger.info('Message submitted successfully', {
      topicId,
      transactionId: transactionResponse.transactionId.toString(),
      sequenceNumber: receipt.topicSequenceNumber?.toString(),
    });

    return {
      transactionId: transactionResponse.transactionId.toString(),
      sequenceNumber: receipt.topicSequenceNumber
        ? Number(receipt.topicSequenceNumber)
        : undefined,
    };
  }

  /**
   * Get the Hedera client instance
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Get operator account ID
   */
  getOperatorAccountId(): string {
    return this.operatorAccountId;
  }

  /**
   * Get operator private key
   */
  getOperatorPrivateKey(): string {
    return this.operatorPrivateKey;
  }

  /**
   * Inscribe a file using HCS-1 protocol
   */
  async inscribeFile(
    buffer: Buffer,
    fileName: string,
    options?: {
      progressCallback?: (progress: any) => void;
      waitMaxAttempts?: number;
      waitIntervalMs?: number;
    },
  ): Promise<RetrievedInscriptionResult> {
    this.logger.info('Inscribing file via HCS-1', { fileName });

    const mimeType = mime.lookup(fileName) || 'application/octet-stream';

    const sdk = await InscriptionSDK.createWithAuth({
      type: 'server',
      accountId: this.operatorAccountId,
      privateKey: this.operatorPrivateKey,
      network: this.network as 'testnet' | 'mainnet',
    });

    const inscriptionOptions = {
      mode: 'file' as const,
      waitForConfirmation: true,
      waitMaxAttempts: options?.waitMaxAttempts || 30,
      waitIntervalMs: options?.waitIntervalMs || 4000,
      progressCallback: options?.progressCallback,
      logging: {
        level: this.logger.getLevel ? this.logger.getLevel() : 'info',
      },
    };

    const response = await inscribe(
      {
        type: 'buffer',
        buffer,
        fileName,
        mimeType,
      },
      {
        accountId: this.operatorAccountId,
        privateKey: this.operatorPrivateKey,
        network: this.network,
      },
      inscriptionOptions,
      sdk,
    );

    if (!response.confirmed || !response.inscription) {
      throw new Error('Inscription failed to confirm');
    }

    return response.inscription;
  }

  /**
   * Create a new assembly topic
   */
  async createAssemblyTopic(): Promise<string> {
    if (!this._assemblyRegistry) {
      throw new Error('Assembly registry not initialized');
    }
    return this._assemblyRegistry.createAssemblyTopic();
  }

  /**
   * Register an action
   */
  async registerAction(
    builder: ActionBuilder,
  ): Promise<ActionBuilder> {
    const registration = builder.build();

    if (!this._actionRegistry) {
      throw new Error('Action registry not initialized');
    }

    // Submit the registration message directly
    const result = await this._submitMessage(
      this.actionRegistryTopicId,
      JSON.stringify(registration),
    );

    this.logger.info('Action registered', {
      topicId: registration.t_id,
      transactionId: result.transactionId,
    });

    // The builder already has the topic ID set
    return builder;
  }

  /**
   * Register a block
   */
  async registerBlock(builder: BlockBuilder): Promise<BlockBuilder> {
    const templateBuffer = builder.getTemplate();

    // If template buffer is provided, store it via HCS-1 first
    if (templateBuffer) {
      const templateResult = await this.inscribeFile(
        templateBuffer,
        `${builder.getName() || 'block'}-template.html`,
      );
      // Set the template topic ID on the builder before building
      builder.setTemplateTopicId(templateResult.topic_id);
    }

    // Now build the definition with the template_t_id set
    const definition = builder.build();

    if (!definition.template_t_id) {
      throw new Error(
        'Block must have either a template buffer (via setTemplate) or template_t_id',
      );
    }

    // Store block definition via HCS-1
    const definitionResult = await this.inscribeFile(
      Buffer.from(JSON.stringify(definition, null, 2)),
      `${definition.name}-definition.json`,
    );

    this.logger.info('Block registered', {
      name: definition.name,
      definitionTopicId: definitionResult.topic_id,
      templateTopicId: definition.template_t_id,
    });

    // Set the topic ID on the builder
    builder.setTopicId(definitionResult.topic_id);
    return builder;
  }

  /**
   * Create an assembly using AssemblyBuilder
   */
  async createAssembly(builder: AssemblyBuilder): Promise<string> {
    const registration = builder.build();

    // Create assembly topic
    const assemblyTopicId = await this.createAssemblyTopic();

    // Register assembly on its topic
    await this.registerAssemblyDirect(assemblyTopicId, registration);

    // Process all operations
    const operations = builder.getOperations();
    for (const operation of operations) {
      switch (operation.op) {
        case 'add-block':
          await this.addBlockToAssembly(assemblyTopicId, operation);
          break;
        case 'add-action':
          await this.addActionToAssembly(assemblyTopicId, operation);
          break;
        case 'update':
          await this.updateAssembly(assemblyTopicId, operation);
          break;
      }
    }

    this.logger.info('Assembly created', {
      topicId: assemblyTopicId,
      name: registration.name,
      version: registration.version,
      operations: operations.length,
    });

    return assemblyTopicId;
  }
}
