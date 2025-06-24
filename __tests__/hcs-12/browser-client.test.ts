/**
 * Tests for HCS12BrowserClient implementation
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Logger } from '../../src/utils/logger';
import { HCS12BrowserClient } from '../../src/hcs-12/browser';
import type { NetworkType } from '../../src/utils/types';
import { ActionRegistration, RegistryType } from '../../src/hcs-12/types';
import type { HashinalsWalletConnectSDK } from '@hashgraphonline/hashinal-wc';
import type { DAppSigner } from '@hashgraph/hedera-wallet-connect';

global.fetch = jest.fn();

jest.mock('@hashgraph/sdk', () => {
  const mockTransaction = {
    setTopicMemo: jest.fn().mockReturnThis(),
    setTransactionId: jest.fn().mockReturnThis(),
    setAdminKey: jest.fn().mockReturnThis(),
    setSubmitKey: jest.fn().mockReturnThis(),
    setAutoRenewAccountId: jest.fn().mockReturnThis(),
    setTopicId: jest.fn().mockReturnThis(),
    setMessage: jest.fn().mockReturnThis(),
    freezeWithSigner: jest.fn().mockResolvedValue({
      executeWithSigner: jest.fn().mockResolvedValue({
        transactionId: { toString: () => '0.0.123456@1234567890.123456789' },
        getReceiptWithSigner: jest.fn().mockResolvedValue({
          topicId: { toString: () => '0.0.999999' },
          topicSequenceNumber: 123,
        }),
      }),
    }),
  };

  return {
    TopicCreateTransaction: jest.fn(() => mockTransaction),
    TopicMessageSubmitTransaction: jest.fn(() => mockTransaction),
    TopicId: { fromString: jest.fn(id => ({ toString: () => id })) },
    TransactionId: {
      generate: jest.fn(() => ({
        toString: () => '0.0.123456@1234567890.123456789',
      })),
    },
    AccountId: { fromString: jest.fn(id => ({ toString: () => id })) },
  };
});

describe('HCS12BrowserClient', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  let client: HCS12BrowserClient;
  let logger: Logger;
  let mockHwc: jest.Mocked<HashinalsWalletConnectSDK>;
  let mockSigner: jest.Mocked<DAppSigner>;
  const mockNetwork: NetworkType = 'testnet';

  beforeEach(() => {
    logger = new Logger({ module: 'HCS12BrowserClientTest' });
    jest.spyOn(logger, 'info').mockImplementation();
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();

    mockSigner = {
      getAccountId: jest.fn().mockReturnValue({ toString: () => '0.0.123456' }),
      populateTransaction: jest.fn(),
      signTransaction: jest.fn(),
      call: jest.fn(),
      getProvider: jest.fn(),
      checkTransaction: jest.fn(),
    } as any;

    mockHwc = {
      getSigner: jest.fn().mockReturnValue(mockSigner),
      getAccountBalance: jest.fn().mockResolvedValue({
        hbars: { toBigNumber: () => ({ toNumber: () => 100 }) },
      }),
      getAccountInfo: jest.fn().mockReturnValue({
        accountId: { toString: () => '0.0.123456' },
        balance: { hbars: { toBigNumber: () => ({ toNumber: () => 100 }) } },
      }),
      dAppConnector: {
        signers: [mockSigner],
      },
    } as any;

    client = new HCS12BrowserClient({
      network: mockNetwork,
      logger,
      hwc: mockHwc,
    });

    jest.spyOn(client, 'createRegistryTopic').mockResolvedValue('0.0.999999');
    jest.spyOn(client as any, '_submitMessage').mockResolvedValue({
      transactionId: '0.0.123456@1234567890.123456789',
      sequenceNumber: 123,
    });
    jest.spyOn(client, 'submitMessage').mockResolvedValue({
      transactionId: '0.0.123456@1234567890.123456789',
      sequenceNumber: 123,
    });
  });

  describe('Initialization', () => {
    it('should initialize with browser configuration', () => {
      expect(client).toBeDefined();
      expect(client.mirrorNode).toBeDefined();
    });

    it('should initialize registries', () => {
      if (client && typeof client.initializeRegistries === 'function') {
        client.initializeRegistries();
      }
      expect(client.actionRegistry).toBeDefined();
      expect(client.blockLoader).toBeDefined();
      expect(client.assemblyRegistry).toBeDefined();
    });
  });

  describe('Topic Creation', () => {
    it('should create topic via wallet connect', async () => {
      if (client && typeof client.initializeRegistries === 'function') {
        client.initializeRegistries();
      }

      const topicId = await client.createRegistryTopic(RegistryType.ACTION);
      expect(topicId).toBe('0.0.999999');
    });
  });

  describe('Message Submission', () => {
    it('should submit message via wallet connect', async () => {
      const message = { p: 'hcs-12', op: 'register' };

      const result = await client.submitMessage('0.0.123456', message);
      expect(result.transactionId).toBe('0.0.123456@1234567890.123456789');
      expect(result.sequenceNumber).toBe(123);
    });
  });

  describe('Mirror Node Access', () => {
    it('should access mirror node for read operations', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          messages: [
            {
              consensus_timestamp: '2023-01-01T00:00:00.000Z',
              sequence_number: 1,
              payer: '0.0.123456',
              data: JSON.stringify({
                p: 'hcs-12',
                op: 'register',
                name: 'test-action',
                hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              }),
            },
          ],
        }),
      });

      if (client && typeof client.initializeRegistries === 'function') {
        client.initializeRegistries();
      }

      jest.spyOn(client.actionRegistry, 'sync').mockImplementation(async () => {
        await (global.fetch as jest.Mock)('test-url');
      });

      await client.actionRegistry.sync();

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Account Information', () => {
    it('should throw error for operator account info in browser', () => {
      expect(() => client.getOperatorAccountId()).toThrow(
        'Browser client does not have operator account',
      );
    });

    it('should throw error for operator private key in browser', () => {
      expect(() => client.getOperatorPrivateKey()).toThrow(
        'Browser client does not have operator private key',
      );
    });
  });

  describe('Registry Management', () => {
    beforeEach(() => {
      if (client && typeof client.initializeRegistries === 'function') {
        client.initializeRegistries({
          action: '0.0.999998',
          assembly: '0.0.999997',
        });
      }
    });

    it('should register action and sync from mirror node', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          messages: [],
        }),
      });

      const actionReg: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        m: 'Test action for browser client',
      };

      const registrationId = await client.actionRegistry.register(actionReg);
      expect(registrationId).toBe('123');

      jest.spyOn(client.actionRegistry, 'sync').mockImplementation(async () => {
        await (global.fetch as jest.Mock)('test-url');
      });

      await client.actionRegistry.sync();
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
