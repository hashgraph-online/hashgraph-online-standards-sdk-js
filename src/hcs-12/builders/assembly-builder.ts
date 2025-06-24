/**
 * Assembly Builder for HCS-12 HashLinks
 *
 * Provides a fluent interface for building assemblies using the new
 * incremental approach with topic-based references.
 */

import { Logger } from '../../utils/logger';
import {
  AssemblyRegistration,
  AssemblyAddAction,
  AssemblyAddBlock,
  AssemblyUpdate,
  AssemblyAction,
  AssemblyBlock,
  AssemblyState,
} from '../types';
import { ActionBuilder } from './action-builder';
import { BlockBuilder } from './block-builder';

/**
 * Builder for creating HashLink assemblies using incremental operations
 */
export class AssemblyBuilder {
  private logger: Logger;
  private registration: Partial<AssemblyRegistration> = {
    p: 'hcs-12',
    op: 'register',
  };
  private operations: (
    | AssemblyAddAction
    | AssemblyAddBlock
    | AssemblyUpdate
  )[] = [];
  private updateFields: Partial<AssemblyUpdate> = {
    p: 'hcs-12',
    op: 'update',
  };

  constructor(logger?: Logger) {
    this.logger = logger || new Logger({ module: 'AssemblyBuilder' });
  }

  /**
   * Set assembly name
   */
  setName(name: string): AssemblyBuilder {
    if (!this.isValidName(name)) {
      throw new Error('Invalid assembly name format');
    }
    this.registration.name = name;
    return this;
  }

  /**
   * Set assembly version
   */
  setVersion(version: string): AssemblyBuilder {
    if (!this.isValidSemver(version)) {
      throw new Error('Invalid semantic version');
    }
    this.registration.version = version;
    return this;
  }

  /**
   * Set assembly description
   */
  setDescription(description: string): AssemblyBuilder {
    this.registration.description = description;
    if (this.updateFields) {
      this.updateFields.description = description;
    }
    return this;
  }

  /**
   * Set assembly tags
   */
  setTags(tags: string[]): AssemblyBuilder {
    this.registration.tags = tags;
    if (this.updateFields) {
      this.updateFields.tags = tags;
    }
    return this;
  }

  /**
   * Add a single tag
   */
  addTag(tag: string): AssemblyBuilder {
    if (!this.registration.tags) {
      this.registration.tags = [];
    }
    if (!this.updateFields.tags) {
      this.updateFields.tags = [];
    }
    this.registration.tags.push(tag);
    this.updateFields.tags.push(tag);
    return this;
  }

  /**
   * Set assembly author
   */
  setAuthor(author: string): AssemblyBuilder {
    this.registration.author = author;
    return this;
  }

  /**
   * Add an action to the assembly
   */
  addAction(builder: ActionBuilder): AssemblyBuilder {
    const topicId = builder.getTopicId();
    const alias = builder.getAlias();

    if (!this.isValidAlias(alias)) {
      throw new Error('Invalid alias format');
    }

    const operation: AssemblyAddAction = {
      p: 'hcs-12',
      op: 'add-action',
      t_id: topicId,
      alias,
    };

    this.operations.push(operation);
    return this;
  }

  /**
   * Add a block to the assembly
   * The block must already be registered and have a topic ID
   */
  addBlock(builder: BlockBuilder): AssemblyBuilder {
    const blockTopicId = builder.getTopicId();
    
    // Validate block topic ID
    if (!this.isValidTopicId(blockTopicId)) {
      throw new Error(`Invalid block topic ID: ${blockTopicId}`);
    }
    
    const definition = builder.build();
    const actions = builder.getActions();

    // Extract default attributes from builder
    const attributes = this.extractDefaultAttributes(definition.attributes);

    // Validate action topic IDs if provided
    if (actions && Object.keys(actions).length > 0) {
      for (const [name, topicId] of Object.entries(actions)) {
        if (!this.isValidTopicId(topicId)) {
          throw new Error(`Invalid action topic ID for "${name}": ${topicId}`);
        }
      }
    }

    const operation: AssemblyAddBlock = {
      p: 'hcs-12',
      op: 'add-block',
      block_t_id: blockTopicId,
      ...(Object.keys(actions).length > 0 && { actions }),
      attributes,
    };

    this.operations.push(operation);
    return this;
  }

  /**
   * Update assembly metadata
   */
  updateMetadata(description?: string, tags?: string[]): AssemblyBuilder {
    const operation: AssemblyUpdate = {
      p: 'hcs-12',
      op: 'update',
      description,
      tags,
    };

    this.operations.push(operation);
    return this;
  }

  /**
   * Build the assembly registration
   */
  build(): AssemblyRegistration {
    if (!this.registration.name) {
      throw new Error('Assembly name is required');
    }
    if (!this.registration.version) {
      throw new Error('Assembly version is required');
    }
    return { ...this.registration } as AssemblyRegistration;
  }

  /**
   * Build an update operation
   */
  buildUpdate(): AssemblyUpdate {
    const update: AssemblyUpdate = {
      p: 'hcs-12',
      op: 'update',
    };
    if (this.updateFields.description !== undefined) {
      update.description = this.updateFields.description;
    }
    if (this.updateFields.tags !== undefined) {
      update.tags = this.updateFields.tags;
    }
    return update;
  }

  /**
   * Build all operations
   */
  buildOperations(): (AssemblyAddAction | AssemblyAddBlock | AssemblyUpdate)[] {
    return [...this.operations];
  }

  /**
   * Reset the builder
   */
  reset(): AssemblyBuilder {
    this.registration = {
      p: 'hcs-12',
      op: 'register',
    };
    this.operations = [];
    this.updateFields = {
      p: 'hcs-12',
      op: 'update',
    };
    return this;
  }

  /**
   * Get the registration message
   */
  getRegistration(): AssemblyRegistration {
    return this.build();
  }

  /**
   * Get all operations
   */
  getOperations(): (AssemblyAddAction | AssemblyAddBlock | AssemblyUpdate)[] {
    return this.buildOperations();
  }

  /**
   * Build the complete assembly definition for preview
   */
  buildPreview(): AssemblyState {
    const actions: AssemblyAction[] = [];
    const blocks: AssemblyBlock[] = [];

    for (const operation of this.operations) {
      switch (operation.op) {
        case 'add-action':
          actions.push({
            t_id: operation.t_id,
            alias: operation.alias,
            config: operation.config,
            data: operation.data,
          });
          break;
        case 'add-block':
          blocks.push({
            block_t_id: operation.block_t_id,
            actions: operation.actions,
            attributes: operation.attributes,
            children: operation.children,
            data: operation.data,
          });
          break;
        case 'update':
          if (operation.description) {
            this.registration.description = operation.description;
          }
          if (operation.tags) {
            this.registration.tags = operation.tags;
          }
          break;
      }
    }

    return {
      topicId: '',
      name: this.registration.name,
      version: this.registration.version,
      description: this.registration.description,
      tags: this.registration.tags,
      author: this.registration.author,
      actions,
      blocks,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
  }

  /**
   * Validate the assembly configuration
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.registration.name) {
      errors.push('Assembly name is required');
    }
    if (!this.registration.version) {
      errors.push('Assembly version is required');
    }
    if (
      this.registration.version &&
      !this.isValidSemver(this.registration.version)
    ) {
      errors.push('Invalid semantic version format');
    }

    const aliases = new Set<string>();
    for (const operation of this.operations) {
      if (operation.op === 'add-action') {
        if (aliases.has(operation.alias)) {
          errors.push(`Duplicate alias: ${operation.alias}`);
        } else {
          aliases.add(operation.alias);
        }

        if (!this.isValidTopicId(operation.t_id)) {
          errors.push(
            `Invalid topic ID for ${operation.alias}: ${operation.t_id}`,
          );
        }

        if (!this.isValidAlias(operation.alias)) {
          errors.push(`Invalid alias format: ${operation.alias}`);
        }
      } else if (operation.op === 'add-block') {
        if (!this.isValidTopicId(operation.block_t_id)) {
          errors.push(`Invalid block topic ID: ${operation.block_t_id}`);
        }
      }
    }

    const actionAliases = new Set<string>();
    const blockOperations = this.operations.filter(
      op => op.op === 'add-action',
    ) as AssemblyAddAction[];
    blockOperations.forEach(op => actionAliases.add(op.alias));

    for (const operation of this.operations) {
      if (operation.op === 'add-block' && operation.actions) {
        for (const [actionKey, actionTopicId] of Object.entries(
          operation.actions,
        )) {
          if (!this.isValidTopicId(actionTopicId)) {
            errors.push(
              `Block ${operation.block_t_id} has invalid action topic ID for key ${actionKey}: ${actionTopicId}`,
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Helper validation methods
   */
  private isValidSemver(version: string): boolean {
    return /^\d+\.\d+\.\d+(-[\w\.\+]+)?$/.test(version);
  }

  private isValidTopicId(topicId: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(topicId);
  }

  private isValidAlias(alias: string): boolean {
    return (
      /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias) &&
      alias.length >= 2 &&
      alias.length <= 50
    );
  }

  private isValidName(name: string): boolean {
    return /^[a-z0-9-]+$/.test(name) && name.length >= 2 && name.length <= 100;
  }

  /**
   * Extract default values from block attributes
   */
  private extractDefaultAttributes(
    attributes?: Record<string, any>,
  ): Record<string, any> {
    if (!attributes) return {};

    const defaults: Record<string, any> = {};
    for (const [key, attr] of Object.entries(attributes)) {
      if (attr && typeof attr === 'object' && 'default' in attr) {
        defaults[key] = attr.default;
      }
    }
    return defaults;
  }
}
