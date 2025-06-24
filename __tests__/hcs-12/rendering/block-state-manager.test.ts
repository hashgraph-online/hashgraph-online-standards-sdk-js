/**
 * Tests for Block State Manager
 *
 * Tests state management and isolation for HashLinks blocks
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BlockStateManager } from '../../../src/hcs-12/rendering/block-state-manager';
import { Logger } from '../../../src/utils/logger';

describe('BlockStateManager', () => {
  let stateManager: BlockStateManager;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'BlockStateManagerTest' });
    stateManager = new BlockStateManager(logger);
  });

  describe('Block State Container', () => {
    it('should create isolated state for each block instance', () => {
      const blockId1 = 'block-1';
      const blockId2 = 'block-2';

      stateManager.createBlockState(blockId1, { count: 0 });
      stateManager.createBlockState(blockId2, { count: 10 });

      const state1 = stateManager.getBlockState(blockId1);
      const state2 = stateManager.getBlockState(blockId2);

      expect(state1.count).toBe(0);
      expect(state2.count).toBe(10);
    });

    it('should update block state without affecting other blocks', () => {
      const blockId1 = 'block-1';
      const blockId2 = 'block-2';

      stateManager.createBlockState(blockId1, { value: 'a' });
      stateManager.createBlockState(blockId2, { value: 'b' });

      stateManager.updateBlockState(blockId1, { value: 'updated-a' });

      expect(stateManager.getBlockState(blockId1).value).toBe('updated-a');
      expect(stateManager.getBlockState(blockId2).value).toBe('b');
    });

    it('should handle nested state objects', () => {
      const blockId = 'nested-block';
      const initialState = {
        user: {
          name: 'John',
          preferences: {
            theme: 'dark',
            notifications: true,
          },
        },
        ui: {
          isVisible: true,
          activeTab: 0,
        },
      };

      stateManager.createBlockState(blockId, initialState);

      stateManager.updateBlockState(blockId, {
        user: {
          ...initialState.user,
          preferences: {
            ...initialState.user.preferences,
            theme: 'light',
          },
        },
      });

      const state = stateManager.getBlockState(blockId);
      expect(state.user.preferences.theme).toBe('light');
      expect(state.user.preferences.notifications).toBe(true);
      expect(state.ui.isVisible).toBe(true);
    });

    it('should return null when accessing non-existent block state', () => {
      const result = stateManager.getBlockState('non-existent');
      expect(result).toBeNull();
    });

    it('should remove block state when destroyed', () => {
      const blockId = 'temp-block';

      stateManager.createBlockState(blockId, { temp: true });
      expect(stateManager.hasBlockState(blockId)).toBe(true);

      stateManager.destroyBlockState(blockId);
      expect(stateManager.hasBlockState(blockId)).toBe(false);
    });
  });

  describe('State Change Events', () => {
    it('should emit events when state changes', () => {
      const blockId = 'event-block';
      const listener = jest.fn();

      stateManager.createBlockState(blockId, { counter: 0 });
      stateManager.onStateChange(blockId, listener);

      stateManager.updateBlockState(blockId, { counter: 1 });

      expect(listener).toHaveBeenCalledWith(
        { counter: 1 },
        { counter: 0 },
        blockId,
      );
    });

    it('should support multiple listeners for same block', () => {
      const blockId = 'multi-listener-block';
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      stateManager.createBlockState(blockId, { value: 'initial' });
      stateManager.onStateChange(blockId, listener1);
      stateManager.onStateChange(blockId, listener2);

      stateManager.updateBlockState(blockId, { value: 'changed' });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should remove event listeners', () => {
      const blockId = 'removable-listener-block';
      const listener = jest.fn();

      stateManager.createBlockState(blockId, { value: 'test' });
      stateManager.onStateChange(blockId, listener);

      stateManager.updateBlockState(blockId, { value: 'first-change' });
      expect(listener).toHaveBeenCalledTimes(1);

      stateManager.removeStateChangeListener(blockId, listener);
      stateManager.updateBlockState(blockId, { value: 'second-change' });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should clean up listeners when block is destroyed', () => {
      const blockId = 'cleanup-block';
      const listener = jest.fn();

      stateManager.createBlockState(blockId, { value: 'test' });
      stateManager.onStateChange(blockId, listener);

      stateManager.destroyBlockState(blockId);

      stateManager.createBlockState(blockId, { value: 'new' });
      stateManager.updateBlockState(blockId, { value: 'updated' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Block Communication', () => {
    it('should enable blocks to communicate via events', () => {
      const blockId1 = 'sender-block';
      const blockId2 = 'receiver-block';
      const messageHandler = jest.fn();

      stateManager.createBlockState(blockId1, {});
      stateManager.createBlockState(blockId2, {});

      stateManager.onBlockMessage(blockId2, messageHandler);
      stateManager.sendBlockMessage(blockId1, blockId2, 'greeting', {
        text: 'Hello',
      });

      expect(messageHandler).toHaveBeenCalledWith({
        type: 'greeting',
        payload: { text: 'Hello' },
        fromBlock: blockId1,
        toBlock: blockId2,
      });
    });

    it('should support broadcast messages to all blocks', () => {
      const blockId1 = 'block-1';
      const blockId2 = 'block-2';
      const blockId3 = 'block-3';

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      stateManager.createBlockState(blockId1, {});
      stateManager.createBlockState(blockId2, {});
      stateManager.createBlockState(blockId3, {});

      stateManager.onBlockMessage(blockId1, handler1);
      stateManager.onBlockMessage(blockId2, handler2);
      stateManager.onBlockMessage(blockId3, handler3);

      stateManager.broadcastMessage('system-update', { version: '1.0.1' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });

    it('should prevent circular message loops', () => {
      const blockId1 = 'loop-block-1';
      const blockId2 = 'loop-block-2';

      stateManager.createBlockState(blockId1, {});
      stateManager.createBlockState(blockId2, {});

      let messageCount = 0;

      stateManager.onBlockMessage(blockId1, () => {
        messageCount++;
        if (messageCount < 10) {
          stateManager.sendBlockMessage(blockId1, blockId2, 'ping', {});
        }
      });

      stateManager.onBlockMessage(blockId2, () => {
        messageCount++;
        if (messageCount < 10) {
          stateManager.sendBlockMessage(blockId2, blockId1, 'pong', {});
        }
      });

      stateManager.sendBlockMessage(blockId1, blockId2, 'ping', {});

      expect(messageCount).toBeLessThan(20);
    });
  });

  describe('Action Result Binding', () => {
    it('should bind action results to block state', async () => {
      const blockId = 'action-block';
      const mockActionResult = {
        success: true,
        data: { userId: 123, userName: 'testuser' },
        transactionId: '0.0.12345@1234567890',
      };

      stateManager.createBlockState(blockId, { user: null, loading: false });

      await stateManager.bindActionResult(
        blockId,
        'user-login',
        mockActionResult,
        {
          onSuccess: (state, result) => ({
            ...state,
            user: result.data,
            loading: false,
          }),
          onError: (state, error) => ({
            ...state,
            error: error.message,
            loading: false,
          }),
        },
      );

      const state = stateManager.getBlockState(blockId);
      expect(state.user).toEqual(mockActionResult.data);
      expect(state.loading).toBe(false);
    });

    it('should handle action errors in binding', async () => {
      const blockId = 'error-block';
      const mockActionError = {
        success: false,
        error: 'Authentication failed',
        transactionId: null,
      };

      stateManager.createBlockState(blockId, { user: null, error: null });

      await stateManager.bindActionResult(
        blockId,
        'user-login',
        mockActionError,
        {
          onSuccess: (state, result) => ({
            ...state,
            user: result.data,
          }),
          onError: (state, result) => ({
            ...state,
            error: result.error,
          }),
        },
      );

      const state = stateManager.getBlockState(blockId);
      expect(state.user).toBeNull();
      expect(state.error).toBe('Authentication failed');
    });

    it('should support conditional state updates', async () => {
      const blockId = 'conditional-block';
      const mockResult = {
        success: true,
        data: { count: 5 },
      };

      stateManager.createBlockState(blockId, { count: 0, threshold: 3 });

      await stateManager.bindActionResult(blockId, 'increment', mockResult, {
        onSuccess: (state, result) => {
          if (result.data.count > state.threshold) {
            return {
              ...state,
              count: result.data.count,
              status: 'above-threshold',
            };
          }
          return {
            ...state,
            count: result.data.count,
          };
        },
      });

      const state = stateManager.getBlockState(blockId);
      expect(state.count).toBe(5);
      expect(state.status).toBe('above-threshold');
    });
  });

  describe('State Persistence', () => {
    it('should persist block state to storage', async () => {
      const blockId = 'persistent-block';
      const state = {
        settings: { theme: 'dark', lang: 'en' },
        lastUpdated: new Date().toISOString(),
      };

      stateManager.createBlockState(blockId, state);

      await stateManager.persistBlockState(blockId);

      expect(stateManager.isPersistent(blockId)).toBe(true);
    });

    it('should restore block state from storage', async () => {
      const blockId = 'restored-block';
      const originalState = {
        user: { id: 123, name: 'John' },
        preferences: { notifications: true },
      };

      const mockStorage = {
        getItem: jest.fn().mockResolvedValue(JSON.stringify(originalState)),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };

      stateManager.setStorageBackend(mockStorage as any);

      await stateManager.restoreBlockState(blockId);

      const restoredState = stateManager.getBlockState(blockId);
      expect(restoredState).toEqual(originalState);
    });

    it('should handle storage errors gracefully', async () => {
      const blockId = 'error-storage-block';

      stateManager.createBlockState(blockId, { test: true });

      const mockStorage = {
        setItem: () => {
          throw new Error('Storage full');
        },
      };

      stateManager.setStorageBackend(mockStorage as any);

      await expect(
        stateManager.persistBlockState(blockId),
      ).resolves.not.toThrow();
    });
  });

  describe('State Validation', () => {
    it('should validate state schema when configured', () => {
      const blockId = 'validated-block';
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      stateManager.setBlockStateSchema(blockId, schema);

      expect(() => {
        stateManager.createBlockState(blockId, { name: 'John', age: 30 });
      }).not.toThrow();

      expect(() => {
        stateManager.updateBlockState(blockId, { age: 'invalid' });
      }).toThrow('State validation failed');
    });

    it('should provide detailed validation errors', () => {
      const blockId = 'validation-error-block';
      const schema = {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          count: { type: 'number', minimum: 0 },
        },
      };

      stateManager.setBlockStateSchema(blockId, schema);
      stateManager.createBlockState(blockId, {
        email: 'test@example.com',
        count: 5,
      });

      try {
        stateManager.updateBlockState(blockId, {
          email: 'invalid-email',
          count: -1,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('State validation failed');
      }
    });
  });

  describe('Memory Management', () => {
    it('should limit number of active block states', () => {
      const maxBlocks = 100;
      stateManager.setMaxBlockStates(maxBlocks);

      for (let i = 0; i < maxBlocks + 10; i++) {
        stateManager.createBlockState(`block-${i}`, { id: i });
      }

      expect(stateManager.getActiveBlockCount()).toBeLessThanOrEqual(maxBlocks);
    });

    it('should cleanup unused block states', () => {
      const blockId = 'cleanup-test-block';

      stateManager.createBlockState(blockId, { test: true });
      expect(stateManager.hasBlockState(blockId)).toBe(true);

      stateManager.markBlockUnused(blockId);
      stateManager.cleanupUnusedStates();

      expect(stateManager.hasBlockState(blockId)).toBe(false);
    });

    it('should prevent memory leaks from event listeners', () => {
      const blockId = 'memory-leak-test';
      const listeners: Array<() => void> = [];

      stateManager.createBlockState(blockId, {});

      for (let i = 0; i < 100; i++) {
        const listener = jest.fn();
        listeners.push(listener);
        stateManager.onStateChange(blockId, listener);
      }

      stateManager.destroyBlockState(blockId);

      expect(stateManager.getListenerCount(blockId)).toBe(0);
    });
  });
});
