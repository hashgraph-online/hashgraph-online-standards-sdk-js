/**
 * Assembly Engine for HCS-12 HashLinks
 *
 * Handles loading, reference resolution, and validation of HashLink assemblies
 * using the new incremental assembly approach with caching and error handling.
 */

import { Logger } from '../../utils/logger';
import { NetworkType } from '../../utils/types';
import {
  AssemblyState,
  AssemblyAction,
  AssemblyBlock,
  ActionRegistration,
  BlockDefinition,
  AssemblyRegistration,
  ParameterDefinition,
} from '../types';
import { BaseRegistry } from '../registries/base-registry';
import { AssemblyRegistry } from '../registries/assembly-registry';
import { ActionRegistry } from '../registries/action-registry';
import { BlockLoader } from '../registries/block-loader';
import { retrieveInscription } from '../../inscribe';

export interface Assembly {
  topicId: string;
  state: AssemblyState;
  actions: ResolvedAction[];
  blocks: ResolvedBlock[];
  dependencies?: ResolvedDependency[];
}

export interface ResolvedAction {
  alias: string;
  t_id: string;
  definition: ActionRegistration | null;
  config?: any;
  error?: string;
}

export interface ResolvedBlock {
  block_t_id: string;
  definition: BlockDefinition | null;
  template?: string;
  attributes?: Record<string, any>;
  actions?: Record<string, string>;
  children?: string[];
  error?: string;
}

export interface ResolvedDependency {
  name: string;
  version: string;
  registry?: string;
  definition: AssemblyRegistration | null;
  error?: string;
}

export class AssemblyEngine {
  private logger: Logger;
  private cache: Map<string, Assembly> = new Map();
  private assemblyRegistry: AssemblyRegistry;
  private actionRegistry: ActionRegistry;
  private blockLoader: BlockLoader;

  constructor(
    logger: Logger,
    assemblyRegistry: AssemblyRegistry,
    actionRegistry: ActionRegistry,
    blockLoader: BlockLoader,
  ) {
    this.logger = logger;
    this.assemblyRegistry = assemblyRegistry;
    this.actionRegistry = actionRegistry;
    this.blockLoader = blockLoader;
  }

  /**
   * Load assembly state from topic and resolve all references
   */
  async loadAssembly(topicId: string): Promise<Assembly> {
    this.logger.debug('Loading assembly', { topicId });

    const cached = this.cache.get(topicId);
    if (cached) {
      this.logger.debug('Assembly loaded from cache', { topicId });
      return cached;
    }

    try {
      const assemblyState =
        await this.assemblyRegistry.getAssemblyState(topicId);
      if (!assemblyState) {
        throw new Error(`Assembly not found: ${topicId}`);
      }

      const assembly: Assembly = {
        topicId,
        state: assemblyState,
        actions: [],
        blocks: [],
      };

      this.cache.set(topicId, assembly);

      this.logger.debug('Assembly loaded successfully', {
        topicId,
        name: assemblyState.name,
        version: assemblyState.version,
        actionsCount: assemblyState.actions?.length || 0,
        blocksCount: assemblyState.blocks?.length || 0,
      });

      return assembly;
    } catch (error) {
      this.logger.error('Failed to load assembly', { topicId, error });
      throw new Error(
        `Failed to load assembly: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Resolve all references in an assembly state
   */
  async resolveReferences(assemblyState: AssemblyState): Promise<Assembly> {
    this.logger.debug('Resolving assembly references', {
      name: assemblyState.name,
    });

    const assembly: Assembly = {
      topicId: assemblyState.topicId,
      state: assemblyState,
      actions: [],
      blocks: [],
    };

    if (assemblyState.actions) {
      for (const actionRef of assemblyState.actions) {
        try {
          const actionDefinition = await this.resolveActionReference(actionRef);
          assembly.actions.push({
            alias: actionRef.alias,
            t_id: actionRef.t_id,
            definition: actionDefinition,
            config: actionRef.config,
          });
        } catch (error) {
          this.logger.warn('Failed to resolve action reference', {
            t_id: actionRef.t_id,
            alias: actionRef.alias,
            error,
          });
          assembly.actions.push({
            alias: actionRef.alias,
            t_id: actionRef.t_id,
            definition: null,
            config: actionRef.config,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    if (assemblyState.blocks) {
      for (const blockRef of assemblyState.blocks) {
        try {
          const { definition, template } =
            await this.resolveBlockReference(blockRef);
          assembly.blocks.push({
            block_t_id: blockRef.block_t_id,
            definition,
            template,
            attributes: blockRef.attributes,
            actions: blockRef.actions,
            children: blockRef.children,
          });
        } catch (error) {
          this.logger.warn('Failed to resolve block reference', {
            block_t_id: blockRef.block_t_id,
            error,
          });
          assembly.blocks.push({
            block_t_id: blockRef.block_t_id,
            definition: null,
            attributes: blockRef.attributes,
            actions: blockRef.actions,
            children: blockRef.children,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return assembly;
  }

  /**
   * Validate that an assembly can be composed without errors
   */
  validateComposition(assembly: Assembly): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    this.logger.debug('Validating assembly composition', {
      topicId: assembly.topicId,
    });

    if (!assembly.state.name) {
      errors.push('Assembly must have a name');
    }

    if (!assembly.state.version) {
      errors.push('Assembly must have a version');
    }

    if (assembly.state.blocks) {
      for (const block of assembly.state.blocks) {
        if (block.actions) {
          for (const [actionKey, actionTopicId] of Object.entries(
            block.actions,
          )) {
            const actionExists = assembly.state.actions?.some(
              a => a.t_id === actionTopicId,
            );
            if (!actionExists) {
              errors.push(
                `Block ${block.block_t_id} references non-existent action: ${actionTopicId} for key ${actionKey}`,
              );
            }
          }
        }

        if (block.children) {
          for (const childTopicId of block.children) {
            const childExists = assembly.state.blocks?.some(
              b => b.block_t_id === childTopicId,
            );
            if (!childExists) {
              errors.push(
                `Block ${block.block_t_id} references non-existent child block: ${childTopicId}`,
              );
            }
          }
        }
      }
    }

    for (const action of assembly.actions) {
      if (action.error) {
        errors.push(
          `Action ${action.alias} has resolution error: ${action.error}`,
        );
      }
    }

    for (const block of assembly.blocks) {
      if (block.error) {
        errors.push(
          `Block ${block.block_t_id} has resolution error: ${block.error}`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Load and resolve assembly with full validation
   */
  async loadAndResolveAssembly(topicId: string): Promise<Assembly> {
    this.logger.debug('Loading and resolving assembly', { topicId });

    try {
      const assembly = await this.loadAssembly(topicId);
      const resolved = await this.resolveReferences(assembly.state);

      const validation = this.validateComposition(resolved);
      if (!validation.valid) {
        this.logger.warn('Assembly validation failed', {
          topicId,
          errors: validation.errors,
        });
      }

      return resolved;
    } catch (error) {
      this.logger.error('Failed to load and resolve assembly', {
        topicId,
        error,
      });
      throw new Error(
        `Failed to load and resolve assembly: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Resolve action reference by fetching from action registry
   */
  private async resolveActionReference(
    actionRef: AssemblyAction,
  ): Promise<ActionRegistration> {
    const action = await this.actionRegistry.getActionByTopicId(actionRef.t_id);
    if (!action) {
      throw new Error(`Action not found at topic: ${actionRef.t_id}`);
    }
    return action;
  }

  /**
   * Resolve block reference by fetching from HCS-1
   */
  private async resolveBlockReference(
    blockRef: AssemblyBlock,
  ): Promise<{ definition: BlockDefinition; template: string }> {
    return await this.blockLoader.loadBlock(blockRef.block_t_id);
  }

  /**
   * Clear assembly cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Assembly cache cleared');
  }

  /**
   * Get cached assembly
   */
  getCachedAssembly(topicId: string): Assembly | undefined {
    return this.cache.get(topicId);
  }

  /**
   * Check if assembly is cached
   */
  isAssemblyCached(topicId: string): boolean {
    return this.cache.has(topicId);
  }
}
