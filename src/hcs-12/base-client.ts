import { Logger, LogLevel } from '../utils/logger';
import { NetworkType } from '../utils/types';
import { HederaMirrorNode, MirrorNodeConfig } from '../services';
import { TransactionReceipt, PrivateKey, PublicKey } from '@hashgraph/sdk';
import {
  ActionRegistry,
  BlockLoader,
  AssemblyRegistry,
  HashLinksRegistry,
} from './registries';
import {
  ActionRegistration,
  BlockDefinition,
  AssemblyRegistration,
  HashLinksRegistration,
  RegistryType,
  AssemblyState,
} from './types';
import { AssemblyEngine, Assembly } from './assembly';

/**
 * Configuration for HCS-12 client
 */
export interface HCS12Config {
  /** The Hedera network to connect to */
  network: NetworkType;
  /** Custom logger instance (if not provided, one will be created) */
  logger?: Logger;
  /** Log level for the client (ignored if logger is provided) */
  logLevel?: LogLevel;
  /** Whether to pretty print logs (ignored if logger is provided) */
  prettyPrint?: boolean;
  /** Custom mirror node configuration */
  mirrorNode?: MirrorNodeConfig;
  /** Whether to run logger in silent mode (ignored if logger is provided) */
  silent?: boolean;
  /** The key type to use for the operator */
  keyType?: 'ed25519' | 'ecdsa';
}

/**
 * Abstract base class for HCS-12 HashLinks clients
 */
export abstract class HCS12BaseClient {
  protected network: NetworkType;
  protected logger: Logger;
  public mirrorNode: HederaMirrorNode;

  protected _actionRegistry?: ActionRegistry;
  protected _blockLoader?: BlockLoader;
  protected _assemblyRegistry?: AssemblyRegistry;
  protected _hashLinksRegistry?: HashLinksRegistry;
  protected _assemblyEngine?: AssemblyEngine;

  protected actionRegistryTopicId?: string;
  protected _assemblyRegistryTopicId?: string;
  protected _hashLinksRegistryTopicId?: string;

  constructor(config: HCS12Config) {
    this.network = config.network;

    this.logger =
      config.logger ||
      Logger.getInstance({
        level: config.logLevel || 'info',
        module: 'HCS12-BaseClient',
        prettyPrint: config.prettyPrint,
        silent: config.silent,
      });

    this.mirrorNode = new HederaMirrorNode(
      config.network,
      this.logger,
      config.mirrorNode,
    );
  }

  /**
   * Initialize registries with optional existing topic IDs
   */
  protected initializeRegistries(topicIds?: {
    action?: string;
    assembly?: string;
    hashlinks?: string;
  }): void {
    this.actionRegistryTopicId = topicIds?.action;
    this._assemblyRegistryTopicId = topicIds?.assembly;
    this._hashLinksRegistryTopicId = topicIds?.hashlinks;
  }

  /**
   * Create a new HCS topic for a registry
   */
  abstract createRegistryTopic(
    registryType: RegistryType,
    adminKey?: boolean | PublicKey,
    submitKey?: boolean | PublicKey,
  ): Promise<string>;

  /**
   * Submit a message to an HCS topic
   */
  abstract submitMessage(
    topicId: string,
    message: string,
    submitKey?: PrivateKey,
  ): Promise<{ transactionId: string; sequenceNumber?: number }>;


  /**
   * Register a new assembly in the assembly registry
   */
  async registerAssembly(
    registration: AssemblyRegistration,
  ): Promise<{ id: string; transactionId?: string }> {
    if (!this._assemblyRegistry) {
      throw new Error('Assembly registry not initialized');
    }

    const id = await this._assemblyRegistry.register(registration);
    return { id };
  }

  /**
   * Get action by hash
   */
  async getAction(hash: string): Promise<ActionRegistration | null> {
    if (!this._actionRegistry) {
      throw new Error('Action registry not initialized');
    }

    return this._actionRegistry.getAction(hash);
  }

  /**
   * Load block from HCS-1
   */
  async loadBlock(blockTopicId: string): Promise<{
    definition: BlockDefinition;
    template: string;
  }> {
    if (!this._blockLoader) {
      this._blockLoader = new BlockLoader(
        this.network,
        this.logger,
        this as any,
      );
    }

    return this._blockLoader.loadBlock(blockTopicId);
  }

  /**
   * Get assembly by name and version
   */
  async getAssembly(
    name: string,
    version: string,
  ): Promise<AssemblyState | null> {
    if (!this._assemblyRegistry) {
      throw new Error('Assembly registry not initialized');
    }

    const entries = await this._assemblyRegistry.listEntries();
    for (const entry of entries) {
      const state = await this._assemblyRegistry.getAssemblyState(entry.id);
      if (state && state.name === name && state.version === version) {
        return state;
      }
    }
    return null;
  }

  /**
   * Load and resolve a complete assembly by topic ID
   */
  async loadAssembly(topicId: string): Promise<Assembly> {
    if (this._actionRegistry) {
      this.logger.info('Syncing action registry before loading assembly');
      await this._actionRegistry.sync();
    }

    const assemblyRegistry = new AssemblyRegistry(
      this.network,
      this.logger,
      topicId,
      this as any,
    );

    await assemblyRegistry.sync();

    const assemblyEngine = new AssemblyEngine(
      this.logger,
      assemblyRegistry,
      this._actionRegistry!,
      this._blockLoader!,
    );

    return assemblyEngine.loadAndResolveAssembly(topicId);
  }

  /**
   * Get assembly state by topic ID (without resolving references)
   */
  async getAssemblyState(topicId: string): Promise<AssemblyState | null> {
    if (!this._assemblyRegistry) {
      throw new Error('Assembly registry not initialized');
    }
    return this._assemblyRegistry.getAssemblyState(topicId);
  }

  /**
   * Ensure assembly engine is initialized
   */
  protected ensureAssemblyEngine(): void {
    if (!this._assemblyEngine) {
      if (
        !this._actionRegistry ||
        !this._blockLoader ||
        !this._assemblyRegistry
      ) {
        throw new Error(
          'Registries must be initialized before assembly engine',
        );
      }
      this._assemblyEngine = new AssemblyEngine(
        this.logger,
        this._assemblyRegistry,
        this._actionRegistry,
        this._blockLoader,
      );
    }
  }

  /**
   * Register a new HashLink in the global directory
   */
  async registerHashLink(
    registration: HashLinksRegistration,
  ): Promise<{ id: string; transactionId?: string }> {
    if (!this._hashLinksRegistry) {
      throw new Error('HashLinks registry not initialized');
    }

    const id = await this._hashLinksRegistry.register(registration);
    return { id };
  }

  /**
   * Search HashLinks by tags
   */
  async searchHashLinksByTags(
    tags: string[],
  ): Promise<HashLinksRegistration[]> {
    if (!this._hashLinksRegistry) {
      throw new Error('HashLinks registry not initialized');
    }

    return this._hashLinksRegistry.searchByTags(tags);
  }

  /**
   * Search HashLinks by name
   */
  async searchHashLinksByName(
    searchTerm: string,
  ): Promise<HashLinksRegistration[]> {
    if (!this._hashLinksRegistry) {
      throw new Error('HashLinks registry not initialized');
    }

    return this._hashLinksRegistry.searchByName(searchTerm);
  }

  /**
   * Get featured HashLinks
   */
  async getFeaturedHashLinks(): Promise<HashLinksRegistration[]> {
    if (!this._hashLinksRegistry) {
      throw new Error('HashLinks registry not initialized');
    }

    return this._hashLinksRegistry.getFeatured();
  }

  /**
   * Get HashLinks by category
   */
  async getHashLinksByCategory(
    category: string,
  ): Promise<HashLinksRegistration[]> {
    if (!this._hashLinksRegistry) {
      throw new Error('HashLinks registry not initialized');
    }

    return this._hashLinksRegistry.getByCategory(category);
  }

  /**
   * Sync all registries with the network
   */
  async syncRegistries(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this._actionRegistry) {
      promises.push(this._actionRegistry.sync());
    }
    if (this._assemblyRegistry) {
      promises.push(this._assemblyRegistry.sync());
    }
    if (this._hashLinksRegistry) {
      promises.push(this._hashLinksRegistry.sync());
    }

    await Promise.all(promises);
  }

  /**
   * Get registry topic IDs
   */
  getRegistryTopicIds(): {
    action?: string;
    assembly?: string;
    hashlinks?: string;
  } {
    return {
      action: this.actionRegistryTopicId,
      assembly: this._assemblyRegistryTopicId,
      hashlinks: this._hashLinksRegistryTopicId,
    };
  }

  /**
   * Clear all registry caches
   */
  clearCaches(): void {
    this._actionRegistry?.clearCache();
    this._blockLoader?.clearCache();
    this._assemblyRegistry?.clearCache();
    this._hashLinksRegistry?.clearCache();
  }

  /**
   * Get the action registry instance
   */
  get actionRegistry(): ActionRegistry | undefined {
    return this._actionRegistry;
  }

  /**
   * Get the block loader instance
   */
  get blockLoader(): BlockLoader | undefined {
    return this._blockLoader;
  }

  /**
   * Get the assembly registry instance
   */
  get assemblyRegistry(): AssemblyRegistry | undefined {
    return this._assemblyRegistry;
  }

  /**
   * Get the HashLinks registry instance
   */
  get hashLinksRegistry(): HashLinksRegistry | undefined {
    return this._hashLinksRegistry;
  }
}
