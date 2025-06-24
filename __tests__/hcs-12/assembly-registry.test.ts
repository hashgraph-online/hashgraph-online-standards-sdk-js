/**
 * Tests for Assembly Registry
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AssemblyRegistry } from '../../src/hcs-12/registries/assembly-registry';
import { Logger } from '../../src/utils/logger';
import type { NetworkType } from '../../src/utils/types';
import type { HCS12Client, HCS12BrowserClient } from '../../src/hcs-12';
import {
  AssemblyRegistration,
  AssemblyAddAction,
  AssemblyAddBlock,
  AssemblyUpdate,
  AssemblyState,
} from '../../src/hcs-12/types';

describe('AssemblyRegistry', () => {
  let assemblyRegistry: AssemblyRegistry;
  let logger: Logger;
  let mockClient: jest.Mocked<HCS12Client>;
  const mockTopicId = '0.0.123456';
  const mockNetwork: NetworkType = 'testnet';

  beforeEach(() => {
    logger = new Logger({ module: 'AssemblyRegistryTest' });
    jest.spyOn(logger, 'info').mockImplementation();
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();

    mockClient = {
      submitMessage: jest.fn(),
      getOperatorAccountId: jest.fn().mockReturnValue('0.0.99999'),
      mirrorNode: {
        getTopicMessagesByFilter: jest.fn(),
      },
    } as any;

    assemblyRegistry = new AssemblyRegistry(
      mockNetwork,
      logger,
      mockTopicId,
      mockClient,
    );
  });

  describe('Assembly Operations', () => {
    beforeEach(() => {
      mockClient.mirrorNode.getTopicMessagesByFilter.mockResolvedValue([]);
    });

    it('should register a new assembly', async () => {
      const assemblyReg: AssemblyRegistration = {
        p: 'hcs-12',
        op: 'register',
        name: 'test-assembly',
        version: '1.0.0',
        description: 'Test assembly for unit tests',
        tags: ['test', 'demo'],
        author: '0.0.99999',
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-1',
        sequenceNumber: 1,
      });

      const sequenceNumber = await assemblyRegistry.register(assemblyReg);
      expect(sequenceNumber).toBe('1');

      expect(mockClient.submitMessage).toHaveBeenCalledWith(
        mockTopicId,
        JSON.stringify(assemblyReg),
      );

      const state = await assemblyRegistry.getAssemblyState();
      expect(state).toBeDefined();
      expect(state?.name).toBe('test-assembly');
      expect(state?.version).toBe('1.0.0');
      expect(state?.actions).toEqual([]);
      expect(state?.blocks).toEqual([]);
    });

    it('should add action to assembly', async () => {
      mockClient.mirrorNode.getTopicMessagesByFilter.mockResolvedValue([]);

      const registration: AssemblyRegistration = {
        p: 'hcs-12',
        op: 'register',
        name: 'test-app',
        version: '1.0.0',
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-1',
        sequenceNumber: 1,
      });

      await assemblyRegistry.register(registration);

      const addAction: AssemblyAddAction = {
        p: 'hcs-12',
        op: 'add-action',
        t_id: '0.0.12345',
        alias: 'transfer',
        config: { maxAmount: 1000 },
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-2',
        sequenceNumber: 2,
      });

      const sequenceNumber = await assemblyRegistry.addAction(addAction);
      expect(sequenceNumber).toBe('2');

      const state = await assemblyRegistry.getAssemblyState();
      expect(state?.actions).toHaveLength(1);
      expect(state?.actions[0]).toMatchObject({
        t_id: '0.0.12345',
        alias: 'transfer',
        config: { maxAmount: 1000 },
      });
    });

    it('should add block to assembly', async () => {
      const registration: AssemblyRegistration = {
        p: 'hcs-12',
        op: 'register',
        name: 'test-app',
        version: '1.0.0',
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-1',
        sequenceNumber: 1,
      });

      await assemblyRegistry.register(registration);

      const addBlock: AssemblyAddBlock = {
        p: 'hcs-12',
        op: 'add-block',
        block_t_id: '0.0.45678',
        actions: {
          transfer: '0.0.12345',
          approve: '0.0.12346',
        },
        attributes: { theme: 'dark' },
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-2',
        sequenceNumber: 2,
      });

      const sequenceNumber = await assemblyRegistry.addBlock(addBlock);
      expect(sequenceNumber).toBe('2');

      const state = await assemblyRegistry.getAssemblyState();
      expect(state?.blocks).toHaveLength(1);
      expect(state?.blocks[0]).toMatchObject({
        block_t_id: '0.0.45678',
        actions: {
          transfer: '0.0.12345',
          approve: '0.0.12346',
        },
        attributes: { theme: 'dark' },
      });
    });

    it('should update assembly metadata', async () => {
      const registration: AssemblyRegistration = {
        p: 'hcs-12',
        op: 'register',
        name: 'test-app',
        version: '1.0.0',
        description: 'Original description',
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-1',
        sequenceNumber: 1,
      });

      await assemblyRegistry.register(registration);

      const update: AssemblyUpdate = {
        p: 'hcs-12',
        op: 'update',
        description: 'Updated description',
        tags: ['updated', 'v2'],
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-2',
        sequenceNumber: 2,
      });

      const sequenceNumber = await assemblyRegistry.update(update);
      expect(sequenceNumber).toBe('2');

      const state = await assemblyRegistry.getAssemblyState();
      expect(state?.description).toBe('Updated description');
      expect(state?.tags).toEqual(['updated', 'v2']);
    });

    it('should require mandatory fields for registration', async () => {
      const incompleteAssembly = {
        p: 'hcs-12',
        op: 'register',
      } as AssemblyRegistration;

      await expect(
        assemblyRegistry.register(incompleteAssembly),
      ).rejects.toThrow('Assembly validation failed');
    });

    it('should validate operation types', async () => {
      const invalidOperation = {
        p: 'hcs-12',
        op: 'invalid-op',
      } as any;

      await expect(
        assemblyRegistry.submitMessage(invalidOperation),
      ).rejects.toThrow();
    });

    it('should handle data field for large configurations', async () => {
      const addAction: AssemblyAddAction = {
        p: 'hcs-12',
        op: 'add-action',
        t_id: '0.0.78901',
        alias: 'complex-action',
        data: '0.0.99999',
      };

      mockClient.submitMessage.mockResolvedValueOnce({
        transactionId: 'test-tx-1',
        sequenceNumber: 1,
      });

      const sequenceNumber = await assemblyRegistry.addAction(addAction);
      expect(sequenceNumber).toBe('1');
    });
  });

  describe('Sync from Mirror Node', () => {
    it('should rebuild assembly state from sequential operations', async () => {
      const mockMessages = [
        {
          sequence_number: 1,
          consensus_timestamp: '2023-01-01T00:00:00.000Z',
          payer_account_id: '0.0.12345',
          message: Buffer.from(
            JSON.stringify({
              p: 'hcs-12',
              op: 'register',
              name: 'synced-assembly',
              version: '1.0.0',
              description: 'Test assembly',
            }),
          ).toString('base64'),
        },
        {
          sequence_number: 2,
          consensus_timestamp: '2023-01-01T00:01:00.000Z',
          payer_account_id: '0.0.12345',
          message: Buffer.from(
            JSON.stringify({
              p: 'hcs-12',
              op: 'add-action',
              t_id: '0.0.11111',
              alias: 'transfer',
            }),
          ).toString('base64'),
        },
        {
          sequence_number: 3,
          consensus_timestamp: '2023-01-01T00:02:00.000Z',
          payer_account_id: '0.0.12345',
          message: Buffer.from(
            JSON.stringify({
              p: 'hcs-12',
              op: 'add-block',
              block_t_id: '0.0.22222',
              actions: {
                transfer: '0.0.11111',
              },
            }),
          ).toString('base64'),
        },
      ];

      mockClient.mirrorNode.getTopicMessagesByFilter.mockResolvedValueOnce(
        mockMessages,
      );

      await assemblyRegistry.sync();

      const state = await assemblyRegistry.getAssemblyState();
      expect(state).toBeDefined();
      expect(state?.name).toBe('synced-assembly');
      expect(state?.actions).toHaveLength(1);
      expect(state?.blocks).toHaveLength(1);
      expect(state?.actions[0].alias).toBe('transfer');
      expect(state?.blocks[0].block_t_id).toBe('0.0.22222');
    });

    it('should handle update operations in sync', async () => {
      const mockMessages = [
        {
          sequence_number: 1,
          consensus_timestamp: '2023-01-01T00:00:00.000Z',
          payer_account_id: '0.0.12345',
          message: Buffer.from(
            JSON.stringify({
              p: 'hcs-12',
              op: 'register',
              name: 'test-assembly',
              version: '1.0.0',
              description: 'Original',
            }),
          ).toString('base64'),
        },
        {
          sequence_number: 2,
          consensus_timestamp: '2023-01-01T00:01:00.000Z',
          payer_account_id: '0.0.12345',
          message: Buffer.from(
            JSON.stringify({
              p: 'hcs-12',
              op: 'update',
              description: 'Updated description',
              tags: ['new', 'updated'],
            }),
          ).toString('base64'),
        },
      ];

      mockClient.mirrorNode.getTopicMessagesByFilter.mockResolvedValueOnce(
        mockMessages,
      );

      await assemblyRegistry.sync();

      const state = await assemblyRegistry.getAssemblyState();
      expect(state?.description).toBe('Updated description');
      expect(state?.tags).toEqual(['new', 'updated']);
    });

    it('should filter non-HCS-12 messages', async () => {
      const mockMessages = [
        {
          sequence_number: 1,
          consensus_timestamp: '2023-01-01T00:00:00.000Z',
          payer_account_id: '0.0.12345',
          message: Buffer.from(
            JSON.stringify({
              p: 'hcs-10',
              op: 'message',
              data: 'Not an HCS-12 message',
            }),
          ).toString('base64'),
        },
        {
          sequence_number: 2,
          consensus_timestamp: '2023-01-01T00:01:00.000Z',
          payer_account_id: '0.0.12345',
          message: Buffer.from(
            JSON.stringify({
              p: 'hcs-12',
              op: 'register',
              name: 'valid-assembly',
              version: '1.0.0',
            }),
          ).toString('base64'),
        },
      ];

      mockClient.mirrorNode.getTopicMessagesByFilter.mockResolvedValue(
        mockMessages,
      );

      await assemblyRegistry.sync();

      const entries = await assemblyRegistry.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].data.name).toBe('valid-assembly');
    });
  });
});
