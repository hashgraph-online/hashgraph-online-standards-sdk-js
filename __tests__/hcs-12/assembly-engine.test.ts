/**
 * Tests for Assembly Engine
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AssemblyEngine } from '../../src/hcs-12/assembly/assembly-engine';
import { Logger } from '../../src/utils/logger';
import {
  AssemblyState,
  ActionRegistration,
  BlockDefinition,
} from '../../src/hcs-12/types';

const mockAssemblyRegistry = {
  getAssemblyState: jest.fn(),
  register: jest.fn(),
  addAction: jest.fn(),
  addBlock: jest.fn(),
  update: jest.fn(),
  sync: jest.fn(),
};

const mockActionRegistry = {
  getLatestEntry: jest.fn(),
  getActionByTopicId: jest.fn(),
  register: jest.fn(),
  sync: jest.fn(),
};

const mockBlockLoader = {
  loadBlock: jest.fn(),
  loadBlockDefinition: jest.fn(),
  loadBlockTemplate: jest.fn(),
  clearCache: jest.fn(),
};

describe('AssemblyEngine', () => {
  let assemblyEngine: AssemblyEngine;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'AssemblyEngineTest' });
    jest.spyOn(logger, 'debug').mockImplementation();
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();

    assemblyEngine = new AssemblyEngine(
      logger,
      mockAssemblyRegistry as any,
      mockActionRegistry as any,
      mockBlockLoader as any,
    );

    jest.clearAllMocks();
    assemblyEngine.clearCache();
  });

  describe('Assembly Loading', () => {
    it('should load assembly state from topic', async () => {
      const topicId = '0.0.12345';
      const mockAssemblyState: AssemblyState = {
        topicId,
        name: 'Test Assembly',
        version: '1.0.0',
        description: 'Test assembly for unit tests',
        actions: [
          {
            t_id: '0.0.11111',
            alias: 'transfer',
            config: { maxAmount: 1000 },
          },
        ],
        blocks: [
          {
            block_t_id: '0.0.22222',
            actions: {
              transfer: '0.0.11111',
            },
          },
        ],
        created: '2023-01-01T00:00:00.000Z',
        updated: '2023-01-01T00:00:00.000Z',
      };

      mockAssemblyRegistry.getAssemblyState.mockResolvedValueOnce(
        mockAssemblyState,
      );

      const result = await assemblyEngine.loadAssembly(topicId);

      expect(result).toBeDefined();
      expect(result.topicId).toBe(topicId);
      expect(result.state.name).toBe('Test Assembly');
      expect(result.state.actions).toHaveLength(1);
      expect(result.state.blocks).toHaveLength(1);
      expect(result.actions).toEqual([]);
      expect(result.blocks).toEqual([]);
      expect(mockAssemblyRegistry.getAssemblyState).toHaveBeenCalledWith(
        topicId,
      );
    });

    it('should cache loaded assemblies', async () => {
      const topicId = '0.0.12345';
      const mockAssemblyState: AssemblyState = {
        topicId,
        name: 'Cached Assembly',
        version: '1.0.0',
        actions: [],
        blocks: [],
        created: '2023-01-01T00:00:00.000Z',
        updated: '2023-01-01T00:00:00.000Z',
      };

      mockAssemblyRegistry.getAssemblyState.mockResolvedValueOnce(
        mockAssemblyState,
      );

      const firstLoad = await assemblyEngine.loadAssembly(topicId);
      const secondLoad = await assemblyEngine.loadAssembly(topicId);

      expect(firstLoad).toBe(secondLoad);
      expect(mockAssemblyRegistry.getAssemblyState).toHaveBeenCalledTimes(1);
    });

    it('should throw error for non-existent assembly', async () => {
      const topicId = '0.0.99999';
      mockAssemblyRegistry.getAssemblyState.mockResolvedValueOnce(null);

      await expect(assemblyEngine.loadAssembly(topicId)).rejects.toThrow(
        'Assembly not found: 0.0.99999',
      );
    });
  });

  describe('Reference Resolution', () => {
    it('should resolve action references', async () => {
      const mockAssemblyState: AssemblyState = {
        topicId: '0.0.12345',
        name: 'Test Assembly',
        version: '1.0.0',
        actions: [
          {
            t_id: '0.0.11111',
            alias: 'transfer',
          },
        ],
        blocks: [],
        created: '2023-01-01T00:00:00.000Z',
        updated: '2023-01-01T00:00:00.000Z',
      };

      const mockActionRegistration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.88888',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        m: 'Transfer Action v1.0.0',
      };

      mockActionRegistry.getActionByTopicId.mockResolvedValueOnce(mockActionRegistration);

      const resolved =
        await assemblyEngine.resolveReferences(mockAssemblyState);

      expect(resolved.actions).toHaveLength(1);
      expect(resolved.actions[0].alias).toBe('transfer');
      expect(resolved.actions[0].t_id).toBe('0.0.11111');
      expect(resolved.actions[0].definition).toEqual(mockActionRegistration);
    });

    it('should resolve block references', async () => {
      const mockAssemblyState: AssemblyState = {
        topicId: '0.0.12345',
        name: 'Test Assembly',
        version: '1.0.0',
        actions: [],
        blocks: [
          {
            block_t_id: '0.0.22222',
            actions: {
              submit: '0.0.11111',
            },
          },
        ],
        created: '2023-01-01T00:00:00.000Z',
        updated: '2023-01-01T00:00:00.000Z',
      };

      const mockBlockDefinition: BlockDefinition = {
        apiVersion: 3,
        name: 'hashlinks/payment-form',
        title: 'Payment Form',
        category: 'forms',
        template_t_id: '0.0.33333',
        attributes: {},
        supports: {},
      };

      const mockTemplate = '<div>Payment Form Template</div>';

      mockBlockLoader.loadBlock.mockResolvedValueOnce({
        definition: mockBlockDefinition,
        template: mockTemplate,
      });

      const resolved =
        await assemblyEngine.resolveReferences(mockAssemblyState);

      expect(resolved.blocks).toHaveLength(1);
      expect(resolved.blocks[0].block_t_id).toBe('0.0.22222');
      expect(resolved.blocks[0].definition).toEqual(mockBlockDefinition);
      expect(resolved.blocks[0].template).toBe(mockTemplate);
    });

    it('should handle resolution errors gracefully', async () => {
      const mockAssemblyState: AssemblyState = {
        topicId: '0.0.12345',
        name: 'Test Assembly',
        version: '1.0.0',
        actions: [
          {
            t_id: '0.0.99999',
            alias: 'missing-action',
          },
        ],
        blocks: [],
        created: '2023-01-01T00:00:00.000Z',
        updated: '2023-01-01T00:00:00.000Z',
      };

      mockActionRegistry.getActionByTopicId.mockResolvedValueOnce(null);

      const resolved =
        await assemblyEngine.resolveReferences(mockAssemblyState);

      expect(resolved.actions).toHaveLength(1);
      expect(resolved.actions[0].definition).toBeNull();
      expect(resolved.actions[0].error).toBe(
        'Action not found at topic: 0.0.99999',
      );
    });
  });

  describe('Composition Validation', () => {
    it('should validate assembly with all references resolved', () => {
      const assembly = {
        topicId: '0.0.12345',
        state: {
          topicId: '0.0.12345',
          name: 'Valid Assembly',
          version: '1.0.0',
          actions: [
            {
              t_id: '0.0.11111',
              alias: 'action1',
            },
          ],
          blocks: [
            {
              block_t_id: '0.0.22222',
              actions: {
                submit: '0.0.11111',
              },
            },
          ],
          created: '2023-01-01T00:00:00.000Z',
          updated: '2023-01-01T00:00:00.000Z',
        },
        actions: [
          {
            alias: 'action1',
            t_id: '0.0.11111',
            definition: {} as ActionRegistration,
          },
        ],
        blocks: [
          {
            block_t_id: '0.0.22222',
            definition: {} as BlockDefinition,
            template: '<div>Template</div>',
            actions: {
              submit: '0.0.11111',
            },
          },
        ],
      };

      const validation = assemblyEngine.validateComposition(assembly as any);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it('should detect missing action references in blocks', () => {
      const assembly = {
        topicId: '0.0.12345',
        state: {
          topicId: '0.0.12345',
          name: 'Invalid Assembly',
          version: '1.0.0',
          actions: [],
          blocks: [
            {
              block_t_id: '0.0.22222',
              actions: {
                submit: '0.0.99999',
              },
            },
          ],
          created: '2023-01-01T00:00:00.000Z',
          updated: '2023-01-01T00:00:00.000Z',
        },
        actions: [],
        blocks: [],
      };

      const validation = assemblyEngine.validateComposition(assembly as any);

      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toMatch(
        /Block 0\.0\.22222 references non-existent action: 0\.0\.99999/,
      );
    });

    it('should detect missing child block references', () => {
      const assembly = {
        topicId: '0.0.12345',
        state: {
          topicId: '0.0.12345',
          name: 'Invalid Assembly',
          version: '1.0.0',
          actions: [],
          blocks: [
            {
              block_t_id: '0.0.22222',
              children: ['missing-child'],
            },
          ],
          created: '2023-01-01T00:00:00.000Z',
          updated: '2023-01-01T00:00:00.000Z',
        },
        actions: [],
        blocks: [],
      };

      const validation = assemblyEngine.validateComposition(assembly as any);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain(
        'Block 0.0.22222 references non-existent child block: missing-child',
      );
    });
  });

  describe('Load and Resolve', () => {
    it('should load and resolve complete assembly', async () => {
      const topicId = '0.0.12345';
      const mockAssemblyState: AssemblyState = {
        topicId,
        name: 'Complete Assembly',
        version: '1.0.0',
        actions: [
          {
            t_id: '0.0.11111',
            alias: 'transfer',
          },
        ],
        blocks: [
          {
            block_t_id: '0.0.22222',
            actions: {
              transfer: '0.0.11111',
            },
          },
        ],
        created: '2023-01-01T00:00:00.000Z',
        updated: '2023-01-01T00:00:00.000Z',
      };

      const mockActionRegistration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.88888',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      };

      const mockBlockDefinition2: BlockDefinition = {
        apiVersion: 3,
        name: 'hashlinks/payment-form',
        title: 'Payment Form',
        category: 'forms',
        template_t_id: '0.0.55555',
        attributes: {
          defaultAmount: { type: 'number', default: 100 },
        },
        supports: { align: true },
      };

      const mockTemplate = '<div>{{attributes.defaultAmount}}</div>';

      mockAssemblyRegistry.getAssemblyState.mockResolvedValueOnce(
        mockAssemblyState,
      );
      mockActionRegistry.getActionByTopicId.mockResolvedValueOnce(mockActionRegistration);
      mockBlockLoader.loadBlock.mockResolvedValueOnce({
        definition: mockBlockDefinition2,
        template: mockTemplate,
      });

      const result = await assemblyEngine.loadAndResolveAssembly(topicId);

      expect(result.topicId).toBe(topicId);
      expect(result.state.name).toBe('Complete Assembly');
      expect(result.actions).toHaveLength(1);
      expect(result.blocks).toHaveLength(1);
      expect(result.actions[0].definition).toEqual(mockActionRegistration);
      expect(result.blocks[0].definition).toEqual(mockBlockDefinition2);
    });
  });
});
