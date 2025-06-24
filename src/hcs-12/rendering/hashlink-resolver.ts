/**
 * HashLink Resolver for Template-Based Block Composition
 *
 * Resolves HashLink references to actual blocks and handles loading
 */

import { Logger } from '../../utils/logger';
import { ScannedHashLink } from './hashlink-scanner';
import { BlockDefinition } from '../types';
import { BlockLoader } from '../registries/block-loader';
import { HRLResolver } from '../../utils/hrl-resolver';
import { NetworkType } from '../../utils/types';

export interface RenderContext {
  blockId: string;
  depth: number;
  parentContext?: RenderContext;
  attributes: Record<string, any>;
  actions: Record<string, string>;
  assembly?: any;
  maxDepth?: number;
}

export interface ResolvedHashLinkBlock {
  blockId: string;
  definition: BlockDefinition | null;
  template: string | null;
  attributes: Record<string, any>;
  actions: Record<string, string>;
  error?: string;
}

export class HashLinkResolver {
  private logger: Logger;
  private blockLoader: BlockLoader;
  private hrlResolver: HRLResolver;
  private network: NetworkType;
  private cache: Map<string, ResolvedHashLinkBlock>;
  private renderStack: Set<string>;

  constructor(
    logger: Logger,
    blockLoader: BlockLoader,
    hrlResolver: HRLResolver,
    network: NetworkType,
  ) {
    this.logger = logger;
    this.blockLoader = blockLoader;
    this.hrlResolver = hrlResolver;
    this.network = network;
    this.cache = new Map();
    this.renderStack = new Set();
  }

  /**
   * Resolve a HashLink reference to a block
   */
  async resolveReference(
    ref: ScannedHashLink,
    context: RenderContext,
  ): Promise<ResolvedHashLinkBlock> {
    this.logger.debug('Resolving HashLink reference', {
      uri: ref.uri,
      protocol: ref.protocol,
    });

    try {
      switch (ref.protocol) {
        case '12':
          return await this.resolveHCS12Block(ref, context);

        case '1':
          return await this.resolveHCS1Block(ref, context);

        case '2':
          return await this.resolveHCS2Block(ref, context);

        default:
          throw new Error(`Unsupported HashLink protocol: ${ref.protocol}`);
      }
    } catch (error) {
      this.logger.error('Failed to resolve HashLink', {
        uri: ref.uri,
        error: error.message,
      });

      return {
        blockId: ref.reference,
        definition: null,
        template: null,
        attributes: {},
        actions: {},
        error: error.message,
      };
    }
  }

  /**
   * Resolve HCS-12 block by topic ID
   */
  private async resolveHCS12Block(
    ref: ScannedHashLink,
    context: RenderContext,
  ): Promise<ResolvedHashLinkBlock> {
    const blockId = ref.reference;

    if (this.renderStack.has(blockId)) {
      return {
        blockId,
        definition: null,
        template: null,
        attributes: {},
        actions: {},
        error: 'Circular reference detected',
      };
    }

    const cacheKey = this.getCacheKey(blockId, ref.attributes, ref.actions);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const blockData = await this.blockLoader.loadBlock(blockId);

      if (!blockData || !blockData.definition) {
        throw new Error(`Block not found: ${blockId}`);
      }

      const mergedAttributes = {
        ...this.extractDefaults(blockData.definition),
        ...context.attributes,
        ...ref.attributes,
      };

      const mergedActions = {
        ...context.actions,
        ...ref.actions,
      };

      const resolved: ResolvedHashLinkBlock = {
        blockId,
        definition: blockData.definition,
        template: blockData.template,
        attributes: mergedAttributes,
        actions: mergedActions,
      };

      this.cache.set(cacheKey, resolved);

      return resolved;
    } catch (error) {
      this.renderStack.delete(blockId);
      throw new Error(
        `Failed to load HCS-12 block ${blockId}: ${error.message}`,
      );
    }
  }

  /**
   * Resolve HCS-1 topic as potential block
   */
  private async resolveHCS1Block(
    ref: ScannedHashLink,
    context: RenderContext,
  ): Promise<ResolvedHashLinkBlock> {
    const topicId = ref.reference;

    try {
      const blockData = await this.blockLoader.loadBlock(topicId);

      if (blockData && blockData.definition) {
        return {
          blockId: topicId,
          definition: blockData.definition,
          template: blockData.template,
          attributes: {
            ...this.extractDefaults(blockData.definition),
            ...ref.attributes,
          },
          actions: ref.actions || {},
        };
      }

      const content = await this.hrlResolver.resolve(topicId, {
        network: this.network,
      });

      return {
        blockId: topicId,
        definition: null,
        template: content.content as string,
        attributes: ref.attributes || {},
        actions: ref.actions || {},
      };
    } catch (error) {
      throw new Error(
        `Failed to load HCS-1 content ${topicId}: ${error.message}`,
      );
    }
  }

  /**
   * Resolve HCS-2 registry entry
   */
  private async resolveHCS2Block(
    ref: ScannedHashLink,
    context: RenderContext,
  ): Promise<ResolvedHashLinkBlock> {
    if (!ref.registryId || !ref.entryName) {
      throw new Error(
        'Invalid HCS-2 reference: missing registry ID or entry name',
      );
    }

    try {
      const registryUri = `hcs://2/${ref.registryId}`;
      const registryContent = await this.hrlResolver.resolve(registryUri, {
        network: this.network,
      });

      this.logger.warn('HCS-2 registry lookup not fully implemented', {
        registryId: ref.registryId,
        entryName: ref.entryName,
      });

      return {
        blockId: `${ref.registryId}/${ref.entryName}`,
        definition: null,
        template: `<!-- HCS-2 lookup not implemented: ${ref.uri} -->`,
        attributes: ref.attributes || {},
        actions: ref.actions || {},
      };
    } catch (error) {
      throw new Error(`Failed to resolve HCS-2 entry: ${error.message}`);
    }
  }

  /**
   * Extract default attribute values from block definition
   */
  private extractDefaults(definition: BlockDefinition): Record<string, any> {
    const defaults: Record<string, any> = {};

    if (definition.attributes) {
      Object.entries(definition.attributes).forEach(([key, attr]) => {
        if (attr && typeof attr === 'object' && 'default' in attr) {
          defaults[key] = attr.default;
        }
      });
    }

    return defaults;
  }

  /**
   * Get cache key for resolved block
   */
  private getCacheKey(
    blockId: string,
    attributes?: Record<string, any>,
    actions?: Record<string, string>,
  ): string {
    const attrHash = attributes ? JSON.stringify(attributes) : '';
    const actionHash = actions ? JSON.stringify(actions) : '';
    return `${blockId}:${attrHash}:${actionHash}`;
  }

  /**
   * Add block to render stack (for circular reference detection)
   */
  pushRenderStack(blockId: string): void {
    this.renderStack.add(blockId);
  }

  /**
   * Remove block from render stack
   */
  popRenderStack(blockId: string): void {
    this.renderStack.delete(blockId);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
