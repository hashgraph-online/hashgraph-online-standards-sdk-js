/**
 * Block Loader for HCS-12
 *
 * Loads block definitions and templates from HCS-1 storage.
 * Blocks are not stored in a registry but directly via HCS-1.
 */

import { Logger } from '../../utils/logger';
import { NetworkType } from '../../utils/types';
import { BlockDefinition } from '../types';
import type { HCS12Client } from '../sdk';
import type { HCS12BrowserClient } from '../browser';
import { HRLResolver } from '../../utils/hrl-resolver';

/**
 * Loader for HCS-1 stored block definitions
 */
export class BlockLoader {
  private logger: Logger;
  private networkType: NetworkType;
  private client?: HCS12Client | HCS12BrowserClient;
  private blockCache: Map<string, BlockDefinition> = new Map();
  private templateCache: Map<string, string> = new Map();

  constructor(
    networkType: NetworkType,
    logger: Logger,
    client?: HCS12Client | HCS12BrowserClient,
  ) {
    this.networkType = networkType;
    this.logger = logger;
    this.client = client;
  }

  /**
   * Load a block definition from HCS-1
   */
  async loadBlockDefinition(blockTopicId: string): Promise<BlockDefinition> {
    const cached = this.blockCache.get(blockTopicId);
    if (cached) return cached;

    try {
      const hrlResolver = new HRLResolver();
      const result = await hrlResolver.resolve(blockTopicId, {
        network: this.networkType,
      });

      if (!result.content) {
        throw new Error(`Block definition not found: ${blockTopicId}`);
      }

      let blockDefinition: BlockDefinition;

      if (
        typeof result.content === 'object' &&
        result.content !== null &&
        !(result.content instanceof ArrayBuffer)
      ) {
        blockDefinition = result.content as BlockDefinition;
      } else {
        blockDefinition = JSON.parse(
          typeof result.content === 'string'
            ? result.content
            : result.content.toString(),
        ) as BlockDefinition;
      }
      this.blockCache.set(blockTopicId, blockDefinition);

      return blockDefinition;
    } catch (error) {
      this.logger.error('Failed to load block definition', {
        blockTopicId,
        error: error.message,
      });
      throw new Error(`Failed to load block definition: ${error.message}`);
    }
  }

  /**
   * Load a block template from HCS-1
   */
  async loadBlockTemplate(templateTopicId: string): Promise<string> {
    const cached = this.templateCache.get(templateTopicId);
    if (cached) return cached;

    try {
      const hrlResolver = new HRLResolver();
      const result = await hrlResolver.resolve(templateTopicId, {
        network: this.networkType,
      });

      if (!result.content) {
        throw new Error(`Block template not found: ${templateTopicId}`);
      }

      let template: string;

      if (typeof result.content === 'string') {
        template = result.content;
      } else if (
        typeof result.content === 'object' &&
        result.content !== null
      ) {
        template =
          (result.content as any).text || JSON.stringify(result.content);
      } else {
        template = result.content.toString();
      }

      this.templateCache.set(templateTopicId, template);

      return template;
    } catch (error) {
      this.logger.error('Failed to load block template', {
        templateTopicId,
        error: error.message,
      });
      throw new Error(`Failed to load block template: ${error.message}`);
    }
  }

  /**
   * Load a complete block (definition + template)
   */
  async loadBlock(blockTopicId: string): Promise<{
    definition: BlockDefinition;
    template: string;
  }> {
    const definition = await this.loadBlockDefinition(blockTopicId);
    const template = await this.loadBlockTemplate(definition.template_t_id);

    return { definition, template };
  }

  /**
   * Store a block definition and template via HCS-1
   */
  async storeBlock(
    template: string,
    definition: Omit<BlockDefinition, 'template_t_id'>,
  ): Promise<{
    definitionTopicId: string;
    templateTopicId: string;
  }> {
    if (!this.client || !('inscribeFile' in this.client)) {
      throw new Error('Client does not support inscription');
    }

    try {
      const templateBuffer = Buffer.from(template);
      const templateResult = await this.client.inscribeFile(
        templateBuffer,
        `block-${definition.name}-template.html`,
      );

      if (!templateResult?.topic_id) {
        throw new Error('Failed to inscribe block template');
      }

      const fullDefinition: BlockDefinition = {
        ...definition,
        template_t_id: templateResult.topic_id,
      };

      const definitionBuffer = Buffer.from(JSON.stringify(fullDefinition));
      const definitionResult = await this.client.inscribeFile(
        definitionBuffer,
        `block-${definition.name}-definition.json`,
      );

      if (!definitionResult?.topic_id) {
        throw new Error('Failed to inscribe block definition');
      }

      this.blockCache.set(definitionResult.topic_id, fullDefinition);
      this.templateCache.set(templateResult.topic_id, template);

      return {
        definitionTopicId: definitionResult.topic_id,
        templateTopicId: templateResult.topic_id,
      };
    } catch (error) {
      this.logger.error('Failed to store block', {
        error: error.message,
      });
      throw new Error(`Failed to store block: ${error.message}`);
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.blockCache.clear();
    this.templateCache.clear();
  }
}
