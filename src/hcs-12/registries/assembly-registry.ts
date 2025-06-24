/**
 * Assembly Registry Implementation for HCS-12
 *
 * Manages assembly topics where each topic represents one assembly.
 * Processes operations sequentially to build assembly state.
 */

import { Logger } from '../../utils/logger';
import { NetworkType } from '../../utils/types';
import {
  RegistryType,
  AssemblyRegistryEntry,
  AssemblyState,
  AssemblyRegistration,
  AssemblyAddAction,
  AssemblyAddBlock,
  AssemblyUpdate,
  AssemblyMessage,
  AssemblyAction,
  AssemblyBlock,
} from '../types';
import { BaseRegistry } from './base-registry';
import type { HCS12Client } from '../sdk';
import type { HCS12BrowserClient } from '../browser';
import { validateAssemblyMessage } from '../validation/schemas';
import { ZodError } from 'zod';

/**
 * Registry for HashLink assemblies
 */
export class AssemblyRegistry extends BaseRegistry {
  private assemblyStates: Map<string, AssemblyState> = new Map();

  constructor(
    networkType: NetworkType,
    logger: Logger,
    topicId?: string,
    client?: HCS12Client | HCS12BrowserClient,
  ) {
    super(networkType, logger, RegistryType.ASSEMBLY, topicId, client);
  }

  /**
   * Override getTopicMemo to indicate indexed registry
   */
  getTopicMemo(): string {
    const indexed = 0;
    const ttl = 60;
    const type = this.registryType;
    return `hcs-12:${indexed}:${ttl}:${type}`;
  }

  /**
   * Register a new assembly
   */
  async register(registration: AssemblyRegistration): Promise<string> {
    return this.submitMessage(registration);
  }

  /**
   * Create a new assembly topic
   */
  async createAssemblyTopic(): Promise<string> {
    const topicId = await this.createRegistryTopic();
    this.topicId = topicId;
    return topicId;
  }

  /**
   * Add an action to the assembly
   */
  async addAction(message: AssemblyAddAction): Promise<string> {
    return this.submitMessage(message);
  }

  /**
   * Add a block to the assembly
   */
  async addBlock(message: AssemblyAddBlock): Promise<string> {
    return this.submitMessage(message);
  }

  /**
   * Update assembly metadata
   */
  async update(message: AssemblyUpdate): Promise<string> {
    return this.submitMessage(message);
  }

  /**
   * Submit any assembly operation message
   */
  async submitMessage(message: AssemblyMessage): Promise<string> {
    this.validateMessage(message);

    if (!this.topicId) {
      throw new Error('Assembly topic ID not found');
    }

    if (!this.client) {
      throw new Error('Client not found');
    }

    this.logger.info('Submitting assembly message to HCS', {
      topicId: this.topicId,
      op: message.op,
    });

    const result = await this.client.submitMessage(
      this.topicId,
      JSON.stringify(message),
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
      data: message,
    };

    this.entries.set(entry.id, entry);

    await this.processMessage(entry);

    this.logger.info('Assembly message processed', {
      op: message.op,
      sequenceNumber,
    });

    return sequenceNumber.toString();
  }

  /**
   * Process a message to update assembly state
   */
  private async processMessage(entry: AssemblyRegistryEntry): Promise<void> {
    const message = entry.data as AssemblyMessage;

    if (!this.topicId) return;

    let state = this.assemblyStates.get(this.topicId);

    switch (message.op) {
      case 'register':
        const reg = message as AssemblyRegistration;
        state = {
          topicId: this.topicId,
          name: reg.name,
          version: reg.version,
          description: reg.description,
          tags: reg.tags,
          author: reg.author,
          actions: [],
          blocks: [],
          created: entry.timestamp,
          updated: entry.timestamp,
        };
        this.assemblyStates.set(this.topicId, state);
        break;

      case 'add-action':
        if (!state) {
          this.logger.warn('Cannot add action without assembly registration');
          return;
        }
        const addAction = message as AssemblyAddAction;
        const action: AssemblyAction = {
          t_id: addAction.t_id,
          alias: addAction.alias,
          config: addAction.config,
          data: addAction.data,
        };
        state.actions.push(action);
        state.updated = entry.timestamp;
        break;

      case 'add-block':
        if (!state) {
          this.logger.warn('Cannot add block without assembly registration');
          return;
        }
        const addBlock = message as AssemblyAddBlock;
        const block: AssemblyBlock = {
          block_t_id: addBlock.block_t_id,
          actions: addBlock.actions,
          attributes: addBlock.attributes,
          children: addBlock.children,
          data: addBlock.data,
        };
        state.blocks.push(block);
        state.updated = entry.timestamp;
        break;

      case 'update':
        if (!state) {
          this.logger.warn('Cannot update without assembly registration');
          return;
        }
        const update = message as AssemblyUpdate;
        if (update.description !== undefined) {
          state.description = update.description;
        }
        if (update.tags !== undefined) {
          state.tags = update.tags;
        }
        state.updated = entry.timestamp;
        break;
    }
  }

  /**
   * Get the current state of an assembly
   */
  async getAssemblyState(topicId?: string): Promise<AssemblyState | null> {
    const targetTopicId = topicId || this.topicId;
    if (!targetTopicId || !this.client) return null;

    let state = this.assemblyStates.get(targetTopicId);
    if (state) return state;

    if (targetTopicId === this.topicId && this.entries.size > 0) {
      this.logger.debug('Building state from existing entries', {
        topicId: targetTopicId,
        entriesCount: this.entries.size,
      });
      this.assemblyStates.clear();
      for (const entry of this.entries.values()) {
        this.processAssemblyMessage(targetTopicId, entry);
      }
      const builtState = this.assemblyStates.get(targetTopicId) || null;
      this.logger.debug('Built state from entries', {
        topicId: targetTopicId,
        hasState: !!builtState,
        name: builtState?.name,
      });
      return builtState;
    }

    this.logger.info('Syncing assembly state from topic', {
      topicId: targetTopicId,
    });

    try {
      const messages = await this.client.mirrorNode.getTopicMessagesByFilter(
        targetTopicId,
        {
          order: 'asc',
          limit: 1000,
        },
      );

      const messageArray = Array.isArray(messages) ? messages : [];

      this.logger.info('Processing assembly messages', {
        topicId: targetTopicId,
        messageCount: messageArray.length,
      });

      for (const msg of messageArray) {
        try {
          let data: any;

          if ((msg as any).message) {
            try {
              let messageContent: string;
              const isServerEnvironment = typeof window === 'undefined';

              if (isServerEnvironment) {
                messageContent = Buffer.from(
                  (msg as any).message,
                  'base64',
                ).toString('utf-8');
              } else {
                messageContent = new TextDecoder().decode(
                  Uint8Array.from(atob((msg as any).message), c =>
                    c.charCodeAt(0),
                  ),
                );
              }

              data = JSON.parse(messageContent);
              this.logger.debug('Successfully parsed message', {
                sequenceNumber: msg.sequence_number,
                op: data.op,
                p: data.p,
              });
            } catch (error) {
              this.logger.debug('Failed to decode/parse message', {
                sequenceNumber: msg.sequence_number,
                error,
              });
              continue;
            }
          } else {
            continue;
          }

          if (data.p !== 'hcs-12') {
            this.logger.debug('Skipping non-HCS-12 message', {
              sequenceNumber: msg.sequence_number,
              protocol: data.p,
            });
            continue;
          }

          const entry: AssemblyRegistryEntry = {
            id: msg.sequence_number.toString(),
            sequenceNumber: msg.sequence_number,
            timestamp: msg.consensus_timestamp || new Date().toISOString(),
            submitter: (msg as any).payer_account_id || 'unknown',
            data,
          };

          this.processAssemblyMessage(targetTopicId, entry);

          this.logger.debug('Processed message for assembly', {
            topicId: targetTopicId,
            sequenceNumber: entry.sequenceNumber,
            op: entry.data.op,
          });
        } catch (error) {
          this.logger.warn('Failed to parse assembly message', {
            sequenceNumber: msg.sequence_number,
            error,
          });
        }
      }

      const finalState = this.assemblyStates.get(targetTopicId) || null;
      this.logger.info('Assembly state after sync', {
        topicId: targetTopicId,
        hasState: !!finalState,
        name: finalState?.name,
        version: finalState?.version,
        actionsCount: finalState?.actions?.length || 0,
        blocksCount: finalState?.blocks?.length || 0,
      });
      return finalState;
    } catch (error) {
      this.logger.error('Failed to sync assembly state', {
        topicId: targetTopicId,
        error,
      });
      return null;
    }
  }

  /**
   * Process a message for a specific assembly topic
   */
  private processAssemblyMessage(topicId: string, entry: AssemblyRegistryEntry): void {
    const message = entry.data as AssemblyMessage;
    let state = this.assemblyStates.get(topicId);

    this.logger.debug('Processing assembly message', {
      topicId,
      op: message.op,
      hasState: !!state,
    });

    switch (message.op) {
      case 'register':
        const reg = message as AssemblyRegistration;
        state = {
          topicId: topicId,
          name: reg.name,
          version: reg.version,
          description: reg.description,
          tags: reg.tags,
          author: reg.author,
          actions: [],
          blocks: [],
          created: entry.timestamp,
          updated: entry.timestamp,
        };
        this.assemblyStates.set(topicId, state);
        this.logger.debug('Assembly registered', {
          topicId,
          name: reg.name,
          version: reg.version,
        });
        break;

      case 'add-action':
        if (!state) {
          this.logger.warn('Cannot add action without assembly registration');
          return;
        }
        const addAction = message as AssemblyAddAction;
        const action: AssemblyAction = {
          t_id: addAction.t_id,
          alias: addAction.alias,
          config: addAction.config,
          data: addAction.data,
        };
        state.actions.push(action);
        state.updated = entry.timestamp;
        break;

      case 'add-block':
        if (!state) {
          this.logger.warn('Cannot add block without assembly registration');
          return;
        }
        const addBlock = message as AssemblyAddBlock;
        const block: AssemblyBlock = {
          block_t_id: addBlock.block_t_id,
          actions: addBlock.actions,
          attributes: addBlock.attributes,
          children: addBlock.children,
          data: addBlock.data,
        };
        state.blocks.push(block);
        state.updated = entry.timestamp;
        break;

      case 'update':
        if (!state) {
          this.logger.warn('Cannot update without assembly registration');
          return;
        }
        const update = message as AssemblyUpdate;
        if (update.description !== undefined) {
          state.description = update.description;
        }
        if (update.tags !== undefined) {
          state.tags = update.tags;
        }
        state.updated = entry.timestamp;
        break;
    }
  }

  /**
   * Override sync to rebuild state from all messages
   */
  async sync(): Promise<void> {
    if (!this.topicId || !this.client) {
      this.logger.warn('Cannot sync without topic ID and client');
      return;
    }

    this.entries.clear();
    this.assemblyStates.delete(this.topicId);

    this.logger.info('Syncing assembly messages', {
      topicId: this.topicId,
    });

    try {
      const messages = await this.client.mirrorNode.getTopicMessagesByFilter(
        this.topicId,
        {
          order: 'asc',
          limit: 1000,
        },
      );

      const messageArray = Array.isArray(messages) ? messages : [];

      this.logger.info('Processing assembly messages', {
        topicId: this.topicId,
        messageCount: messageArray.length,
      });

      for (const msg of messageArray) {
        try {
          let data: any;

          if ((msg as any).message) {
            try {
              let messageContent: string;
              const isServerEnvironment = typeof window === 'undefined';

              if (isServerEnvironment) {
                messageContent = Buffer.from(
                  (msg as any).message,
                  'base64',
                ).toString('utf-8');
              } else {
                messageContent = new TextDecoder().decode(
                  Uint8Array.from(atob((msg as any).message), c =>
                    c.charCodeAt(0),
                  ),
                );
              }

              data = JSON.parse(messageContent);
            } catch (error) {
              this.logger.debug('Failed to decode/parse message in sync', {
                sequenceNumber: msg.sequence_number,
                error,
              });
              continue;
            }
          } else if ((msg as any).raw_content) {
            try {
              data = JSON.parse((msg as any).raw_content);
            } catch {
              continue;
            }
          } else {
            const msgAny = msg as any;
            if (msgAny.p && msgAny.op) {
              data = { ...msgAny };
              delete data.consensus_timestamp;
              delete data.sequence_number;
              delete data.payer_account_id;
              delete data.topic_id;
              delete data.running_hash;
              delete data.running_hash_version;
              delete data.chunk_info;
              delete data.created;
              delete data.payer;
            } else {
              continue;
            }
          }

          if (data.p !== 'hcs-12') {
            continue;
          }

          const entry: AssemblyRegistryEntry = {
            id: msg.sequence_number.toString(),
            sequenceNumber: msg.sequence_number,
            timestamp: msg.consensus_timestamp || new Date().toISOString(),
            submitter: (msg as any).payer_account_id || 'unknown',
            data,
          };

          this.entries.set(entry.id, entry);

          await this.processMessage(entry);

          this.logger.debug('Processed sync message', {
            sequenceNumber: entry.sequenceNumber,
            op: entry.data.op,
          });
        } catch (error) {
          this.logger.warn('Failed to parse assembly message', {
            sequenceNumber: msg.sequence_number,
            error,
          });
        }
      }

      this.logger.info('Assembly sync completed', {
        topicId: this.topicId,
        messageCount: messageArray.length,
      });
    } catch (error) {
      this.logger.error('Failed to sync assembly', { error });
      throw error;
    }
  }

  /**
   * Validate an assembly message
   */
  private validateMessage(message: AssemblyMessage): void {
    try {
      validateAssemblyMessage(message);
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.errors.map(
          e => `${e.path.join('.')}: ${e.message}`,
        );
        throw new Error(`Assembly validation failed: ${issues.join('; ')}`);
      }
      throw error;
    }
  }
}
