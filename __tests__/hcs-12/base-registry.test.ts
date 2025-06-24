/**
 * Base Registry Abstract Class Tests
 *
 * Tests the shared functionality that all HCS-12 registries must implement.
 * This ensures consistent behavior across action, block, and assembly registries.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Logger } from '../../src/utils/logger';
import {
  RegistryType,
  AssemblyRegistryEntry,
  ActionRegistration,
} from '../../src/hcs-12/types';
import { BaseRegistry } from '../../src/hcs-12/registries/base-registry';
import { HCS12Client } from '../../src/hcs-12/sdk';
import type { NetworkType } from '../../src/utils/types';

/**
 * Concrete implementation for testing
 */
class TestRegistry extends BaseRegistry {
  async register(data: ActionRegistration): Promise<string> {
    this.validateBaseRegistration(data);

    const id = `0.0.${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const entry: AssemblyRegistryEntry = {
      id,
      timestamp: new Date().toISOString(),
      submitter: '0.0.123456',
      data,
    };
    this.entries.set(id, entry);
    return id;
  }
}

describe('BaseRegistry Abstract Class', () => {
  let logger: Logger;
  let registry: TestRegistry;
  let mockClient: jest.Mocked<HCS12Client>;

  beforeEach(() => {
    logger = new Logger({ module: 'test' });

    mockClient = {
      mirrorNode: {
        getTopicMessagesByFilter: jest.fn().mockResolvedValue([]),
      },
      createRegistryTopic: jest.fn().mockResolvedValue('0.0.999999'),
      submitMessage: jest
        .fn()
        .mockResolvedValue({ transactionId: 'test-tx-id' }),
      getOperatorAccountId: jest.fn().mockReturnValue('0.0.123456'),
      getOperatorPrivateKey: jest.fn().mockReturnValue('test-key'),
    } as any;

    registry = new TestRegistry(
      'testnet' as NetworkType,
      logger,
      RegistryType.ACTION,
      '0.0.999999',
      mockClient,
    );
  });

  describe('Registry Initialization', () => {
    it('should initialize with correct parameters', () => {
      expect(registry).toBeDefined();
      expect(registry['networkType']).toBe('testnet');
      expect(registry['registryType']).toBe(RegistryType.ACTION);
      expect(registry['topicId']).toBe('0.0.999999');
      expect(registry['client']).toBe(mockClient);
    });

    it('should generate correct topic memo format', () => {
      const memo = registry.getTopicMemo();
      expect(memo).toBe('hcs-12:1:60:0');
    });

    it('should handle different registry types in memo', () => {
      const actionRegistry = new TestRegistry(
        'testnet' as NetworkType,
        logger,
        RegistryType.ACTION,
        '0.0.888888',
        mockClient,
      );
      expect(actionRegistry.getTopicMemo()).toBe('hcs-12:1:60:0');

      const assemblyRegistry = new TestRegistry(
        'testnet' as NetworkType,
        logger,
        RegistryType.ASSEMBLY,
        '0.0.777777',
        mockClient,
      );
      expect(assemblyRegistry.getTopicMemo()).toBe('hcs-12:1:60:2');
    });
  });

  describe('Entry Management', () => {
    it('should register new entries with validation', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.456789',
        hash: 'abc123',
        wasm_hash: 'def456',
        m: 'Test action registration',
      };

      const id = await registry.register(registration);

      expect(id).toMatch(/^0\.0\.\d+_[a-z0-9]+$/);

      const entry = await registry.getEntry(id);
      expect(entry).toBeDefined();
      expect(entry?.data).toEqual(registration);
      expect(entry?.submitter).toBe('0.0.123456');
    });

    it('should validate registration data', async () => {
      const invalidRegistration = {
        p: 'invalid',
        op: 'register',
        t_id: '0.0.456789',
      };

      await expect(
        registry.register(invalidRegistration as any),
      ).rejects.toThrow('Invalid protocol identifier');
    });

    it('should validate operation field', async () => {
      const invalidRegistration = {
        p: 'hcs-12',
        op: 'invalid',
        t_id: '0.0.456789',
      };

      await expect(
        registry.register(invalidRegistration as any),
      ).rejects.toThrow('Invalid operation');
    });

    it('should retrieve entries by ID', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.456789',
        hash: 'abc123',
        wasm_hash: 'def456',
      };

      const id = await registry.register(registration);
      const entry = await registry.getEntry(id);

      expect(entry).toBeDefined();
      expect(entry?.id).toBe(id);
      expect(entry?.data).toEqual(registration);
    });

    it('should return null for non-existent entries', async () => {
      const entry = await registry.getEntry('0.0.nonexistent');
      expect(entry).toBeNull();
    });

    it('should list all entries', async () => {
      const registration1: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.456789',
        hash: 'abc123',
        wasm_hash: 'def456',
        m: 'Action 1',
      };

      const registration2: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.456790',
        hash: 'abc124',
        wasm_hash: 'def457',
        m: 'Action 2',
      };

      await registry.register(registration1);
      await registry.register(registration2);

      const entries = await registry.listEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].data.m).toBe('Action 1');
      expect(entries[1].data.m).toBe('Action 2');
    });

    it('should filter entries by submitter', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.456789',
        hash: 'abc123',
        wasm_hash: 'def456',
      };

      await registry.register(registration);

      const entries = await registry.listEntries({ submitter: '0.0.123456' });
      expect(entries).toHaveLength(1);

      const noEntries = await registry.listEntries({ submitter: '0.0.999999' });
      expect(noEntries).toHaveLength(0);
    });
  });

  describe('Registry Synchronization', () => {
    it('should sync entries from mirror node', async () => {
      const mockMessages = [
        {
          consensus_timestamp: '2023-01-01T00:00:00.000Z',
          sequence_number: 1,
          payer: '0.0.123456',
          p: 'hcs-12',
          op: 'register',
          t_id: '0.0.456789',
          hash: 'abc123',
        },
      ];

      mockClient.mirrorNode.getTopicMessagesByFilter.mockResolvedValue(
        mockMessages,
      );

      await registry.sync();

      expect(
        mockClient.mirrorNode.getTopicMessagesByFilter,
      ).toHaveBeenCalledWith(
        '0.0.999999',
        expect.objectContaining({
          order: 'asc',
          limit: 100,
        }),
      );

      const entries = await registry.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].data.p).toBe('hcs-12');
    });

    it('should handle sync without client', async () => {
      const registryWithoutClient = new TestRegistry(
        'testnet' as NetworkType,
        logger,
        RegistryType.ACTION,
        '0.0.999999',
      );

      const logSpy = jest.spyOn(logger, 'warn');
      await registryWithoutClient.sync();

      expect(logSpy).toHaveBeenCalledWith(
        'Cannot sync without topic ID and client',
      );
    });
  });

  describe('Registry Configuration', () => {
    it('should return correct registry configuration', () => {
      const config = registry.getConfig();

      expect(config).toEqual({
        type: RegistryType.ACTION,
        indexed: false,
        ttl: 60,
        topicId: '0.0.999999',
        memo: 'hcs-12:1:60:0',
      });
    });
  });

  describe('Topic Creation', () => {
    it('should create registry topic using client', async () => {
      const topicId = await registry.createRegistryTopic();

      expect(mockClient.createRegistryTopic).toHaveBeenCalledWith(
        RegistryType.ACTION,
      );
      expect(topicId).toBe('0.0.999999');
      expect(registry['topicId']).toBe('0.0.999999');
    });

    it('should throw error without client', async () => {
      const registryWithoutClient = new TestRegistry(
        'testnet' as NetworkType,
        logger,
        RegistryType.ACTION,
      );

      await expect(registryWithoutClient.createRegistryTopic()).rejects.toThrow(
        'Client required to create topic',
      );
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.456789',
        hash: 'abc123',
        wasm_hash: 'def456',
      };

      await registry.register(registration);
      let entries = await registry.listEntries();
      expect(entries).toHaveLength(1);

      registry.clearCache();
      entries = await registry.listEntries();
      expect(entries).toHaveLength(0);
    });

    it('should return registry statistics', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.456789',
        hash: 'abc123',
        wasm_hash: 'def456',
      };

      await registry.register(registration);

      const stats = registry.getStats();
      expect(stats).toEqual({
        entryCount: 1,
        lastSync: undefined,
        topicId: '0.0.999999',
        registryType: 'ACTION',
      });
    });
  });

  describe('Registry Type Enum', () => {
    it('should have correct registry type values', () => {
      expect(RegistryType.ACTION).toBe(0);
      expect(RegistryType.ASSEMBLY).toBe(2);
      expect(RegistryType.HASHLINKS).toBe(3);
    });
  });
});
