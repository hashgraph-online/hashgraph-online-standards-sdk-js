/**
 * Block State Manager for HCS-12 HashLinks
 *
 * Manages state isolation, events, and communication between blocks
 * with persistence support and memory management.
 */

import { Logger } from '../../utils/logger';

export interface BlockState {
  attributes: Record<string, string | number | boolean>;
  actionResults: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StateChangeListener {
  (newState: BlockState, oldState: BlockState, blockId: string): void;
}

export interface BlockMessage {
  type: string;
  payload: unknown;
  fromBlock: string;
  toBlock: string;
}

export interface BlockMessageHandler {
  (message: BlockMessage): void;
}

export interface ActionResultBinding {
  onSuccess?: (state: BlockState, result: unknown) => BlockState;
  onError?: (state: BlockState, result: unknown) => BlockState;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  transactionId?: string | null;
}

export interface ValidationSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
}

export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Manages block state with isolation and communication
 */
export class BlockStateManager {
  private logger: Logger;
  private blockStates: Map<string, BlockState> = new Map();
  private stateListeners: Map<string, StateChangeListener[]> = new Map();
  private messageHandlers: Map<string, BlockMessageHandler[]> = new Map();
  private schemas: Map<string, ValidationSchema> = new Map();
  private storageBackend?: StorageBackend;
  private persistentBlocks: Set<string> = new Set();
  private unusedBlocks: Set<string> = new Set();
  private maxBlockStates = 1000;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Create isolated state for a block instance
   */
  createBlockState(blockId: string, initialState: BlockState): void {
    this.logger.debug('Creating block state', { blockId });

    if (this.schemas.has(blockId)) {
      this.validateState(blockId, initialState);
    }

    while (this.blockStates.size >= this.maxBlockStates) {
      if (this.unusedBlocks.size > 0) {
        this.cleanupUnusedStates();
      } else {
        this.evictOldestBlock();
      }
    }

    this.blockStates.set(blockId, { ...initialState });
    this.logger.debug('Block state created', {
      blockId,
      stateKeys: Object.keys(initialState),
    });
  }

  /**
   * Get current state for a block
   */
  getBlockState(blockId: string): BlockState | null {
    if (!this.blockStates.has(blockId)) {
      return null;
    }
    return { ...this.blockStates.get(blockId) };
  }

  /**
   * Check if block state exists
   */
  hasBlockState(blockId: string): boolean {
    return this.blockStates.has(blockId);
  }

  /**
   * Update block state and emit events
   */
  updateBlockState(blockId: string, updates: Partial<BlockState>): void {
    if (!this.blockStates.has(blockId)) {
      throw new Error(`Block state not found: ${blockId}`);
    }

    const oldState = { ...this.blockStates.get(blockId) };
    const newState = { ...oldState, ...updates };

    if (this.schemas.has(blockId)) {
      this.validateState(blockId, newState);
    }

    this.blockStates.set(blockId, newState);

    const listeners = this.stateListeners.get(blockId) || [];
    for (const listener of listeners) {
      try {
        listener(newState, oldState, blockId);
      } catch (error) {
        this.logger.error('State change listener error', { blockId, error });
      }
    }

    this.logger.debug('Block state updated', { blockId, updates });
  }

  /**
   * Destroy block state and cleanup
   */
  destroyBlockState(blockId: string): void {
    this.logger.debug('Destroying block state', { blockId });

    this.blockStates.delete(blockId);
    this.stateListeners.delete(blockId);
    this.messageHandlers.delete(blockId);
    this.schemas.delete(blockId);
    this.persistentBlocks.delete(blockId);
    this.unusedBlocks.delete(blockId);

    this.logger.debug('Block state destroyed', { blockId });
  }

  /**
   * Listen for state changes on a block
   */
  onStateChange(blockId: string, listener: StateChangeListener): void {
    if (!this.stateListeners.has(blockId)) {
      this.stateListeners.set(blockId, []);
    }
    this.stateListeners.get(blockId)!.push(listener);
  }

  /**
   * Remove state change listener
   */
  removeStateChangeListener(
    blockId: string,
    listener: StateChangeListener,
  ): void {
    const listeners = this.stateListeners.get(blockId);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Listen for messages sent to a block
   */
  onBlockMessage(blockId: string, handler: BlockMessageHandler): void {
    if (!this.messageHandlers.has(blockId)) {
      this.messageHandlers.set(blockId, []);
    }
    this.messageHandlers.get(blockId)!.push(handler);
  }

  /**
   * Send message from one block to another
   */
  sendBlockMessage(
    fromBlock: string,
    toBlock: string,
    type: string,
    payload: unknown,
  ): void {
    const message: BlockMessage = {
      type,
      payload,
      fromBlock,
      toBlock,
    };

    const handlers = this.messageHandlers.get(toBlock) || [];
    for (const handler of handlers) {
      try {
        handler(message);
      } catch (error) {
        this.logger.error('Block message handler error', {
          fromBlock,
          toBlock,
          type,
          error,
        });
      }
    }

    this.logger.debug('Block message sent', { fromBlock, toBlock, type });
  }

  /**
   * Broadcast message to all blocks
   */
  broadcastMessage(type: string, payload: unknown): void {
    for (const blockId of this.blockStates.keys()) {
      const handlers = this.messageHandlers.get(blockId) || [];
      const message: BlockMessage = {
        type,
        payload,
        fromBlock: 'system',
        toBlock: blockId,
      };

      for (const handler of handlers) {
        try {
          handler(message);
        } catch (error) {
          this.logger.error('Broadcast message handler error', {
            blockId,
            type,
            error,
          });
        }
      }
    }

    this.logger.debug('Message broadcasted', {
      type,
      blockCount: this.blockStates.size,
    });
  }

  /**
   * Bind action result to block state
   */
  async bindActionResult(
    blockId: string,
    actionName: string,
    result: ActionResult,
    binding: ActionResultBinding,
  ): Promise<void> {
    if (!this.blockStates.has(blockId)) {
      throw new Error(`Block state not found: ${blockId}`);
    }

    const currentState = this.getBlockState(blockId);
    let newState: BlockState;

    try {
      if (result.success && binding.onSuccess) {
        newState = binding.onSuccess(currentState, result);
      } else if (!result.success && binding.onError) {
        newState = binding.onError(currentState, result);
      } else {
        return;
      }

      if (newState) {
        this.updateBlockState(blockId, newState);
      }

      this.logger.debug('Action result bound to state', {
        blockId,
        actionName,
        success: result.success,
      });
    } catch (error) {
      this.logger.error('Action result binding failed', {
        blockId,
        actionName,
        error,
      });
      throw error;
    }
  }

  /**
   * Persist block state to storage
   */
  async persistBlockState(blockId: string): Promise<void> {
    if (!this.storageBackend) {
      this.logger.warn('No storage backend configured');

      this.persistentBlocks.add(blockId);
      return;
    }

    if (!this.blockStates.has(blockId)) {
      throw new Error(`Block state not found: ${blockId}`);
    }

    try {
      const state = this.blockStates.get(blockId);
      await this.storageBackend.setItem(blockId, JSON.stringify(state));
      this.persistentBlocks.add(blockId);
      this.logger.debug('Block state persisted', { blockId });
    } catch (error) {
      this.logger.error('Failed to persist block state', { blockId, error });
    }
  }

  /**
   * Restore block state from storage
   */
  async restoreBlockState(blockId: string): Promise<void> {
    if (!this.storageBackend) {
      this.logger.warn('No storage backend configured');
      return;
    }

    try {
      const stored = await this.storageBackend.getItem(blockId);
      if (stored) {
        const state = JSON.parse(stored);
        this.blockStates.set(blockId, state);
        this.persistentBlocks.add(blockId);
        this.logger.debug('Block state restored', { blockId });
      }
    } catch (error) {
      this.logger.error('Failed to restore block state', { blockId, error });
    }
  }

  /**
   * Check if block state is persistent
   */
  isPersistent(blockId: string): boolean {
    return this.persistentBlocks.has(blockId);
  }

  /**
   * Set storage backend
   */
  setStorageBackend(backend: StorageBackend): void {
    this.storageBackend = backend;
  }

  /**
   * Set validation schema for a block
   */
  setBlockStateSchema(blockId: string, schema: ValidationSchema): void {
    this.schemas.set(blockId, schema);
    this.logger.debug('Block state schema set', { blockId });
  }

  /**
   * Set maximum number of block states
   */
  setMaxBlockStates(max: number): void {
    this.maxBlockStates = max;
  }

  /**
   * Get active block count
   */
  getActiveBlockCount(): number {
    return this.blockStates.size;
  }

  /**
   * Mark block as unused for cleanup
   */
  markBlockUnused(blockId: string): void {
    this.unusedBlocks.add(blockId);
  }

  /**
   * Clean up unused block states
   */
  cleanupUnusedStates(): void {
    for (const blockId of this.unusedBlocks) {
      this.destroyBlockState(blockId);
    }
    this.unusedBlocks.clear();
    this.logger.debug('Unused states cleaned up');
  }

  /**
   * Evict oldest non-persistent block to make room
   */
  private evictOldestBlock(): void {
    for (const blockId of this.blockStates.keys()) {
      if (!this.persistentBlocks.has(blockId)) {
        this.destroyBlockState(blockId);
        this.logger.debug('Evicted block to make room', { blockId });
        return;
      }
    }

    this.logger.warn('Cannot evict blocks - all are persistent');
  }

  /**
   * Get listener count for a block (for testing)
   */
  getListenerCount(blockId: string): number {
    const stateListeners = this.stateListeners.get(blockId)?.length || 0;
    const messageHandlers = this.messageHandlers.get(blockId)?.length || 0;
    return stateListeners + messageHandlers;
  }

  /**
   * Validate state against schema
   */
  private validateState(blockId: string, state: BlockState): void {
    const schema = this.schemas.get(blockId);
    if (!schema) return;

    if (schema.type === 'object') {
      if (typeof state !== 'object' || state === null) {
        throw new Error('State validation failed: expected object');
      }

      if (schema.required) {
        for (const prop of schema.required) {
          if (!(prop in state)) {
            throw new Error(
              `State validation failed: missing required property '${prop}'`,
            );
          }
        }
      }

      if (schema.properties) {
        for (const [prop, propSchema] of Object.entries(schema.properties)) {
          if (prop in state) {
            const value = state[prop];
            const expectedType = (propSchema as any).type;

            if (expectedType === 'string' && typeof value !== 'string') {
              throw new Error(
                `State validation failed: property '${prop}' must be string`,
              );
            }
            if (expectedType === 'number' && typeof value !== 'number') {
              throw new Error(
                `State validation failed: property '${prop}' must be number`,
              );
            }
            if (
              expectedType === 'number' &&
              (propSchema as any).minimum !== undefined
            ) {
              if (value < (propSchema as any).minimum) {
                throw new Error(
                  `State validation failed: property '${prop}' below minimum`,
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * Set block state (alias for updateBlockState)
   */
  setBlockState(blockId: string, state: BlockState): void {
    if (!this.blockStates.has(blockId)) {
      this.createBlockState(blockId, state);
    } else {
      this.updateBlockState(blockId, state);
    }
  }

  /**
   * Remove block state
   */
  removeBlockState(blockId: string): void {
    this.blockStates.delete(blockId);
    this.stateListeners.delete(blockId);
    this.messageHandlers.delete(blockId);
    this.persistentBlocks.delete(blockId);
    this.schemas.delete(blockId);

    if (this.storageBackend) {
      this.storageBackend.removeItem(blockId).catch(error => {
        this.logger.error('Failed to remove persisted state', {
          blockId,
          error,
        });
      });
    }

    this.logger.debug('Block state removed', { blockId });
  }

  /**
   * Send message to a block
   */
  sendMessage(
    blockId: string,
    type: string,
    data: unknown,
    fromBlock: string = 'system',
  ): void {
    const handlers = this.messageHandlers.get(blockId) || [];
    const message: BlockMessage = {
      type,
      payload: data,
      fromBlock,
      toBlock: blockId,
    };

    for (const handler of handlers) {
      try {
        handler(message);
      } catch (error) {
        this.logger.error('Message handler error', { blockId, type, error });
      }
    }
  }
}
