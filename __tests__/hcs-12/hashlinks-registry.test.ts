/**
 * HashLinks Registry Tests
 *
 * Tests the global HashLinks directory functionality
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Logger } from '../../src/utils/logger';
import { HashLinksRegistry } from '../../src/hcs-12/registries/hashlinks-registry';
import { HashLinksRegistration, RegistryType } from '../../src/hcs-12/types';
import type { NetworkType } from '../../src/utils/types';
import type { HCS12Client } from '../../src/hcs-12/sdk';

describe('HashLinks Registry', () => {
  let logger: Logger;
  let registry: HashLinksRegistry;
  let mockClient: jest.Mocked<HCS12Client>;

  beforeEach(() => {
    logger = new Logger({ module: 'test' });

    mockClient = {
      mirrorNode: {
        getTopicMessagesByFilter: jest.fn().mockResolvedValue([]),
      },
      createRegistryTopic: jest.fn().mockResolvedValue('0.0.777777'),
      submitMessage: jest
        .fn()
        .mockResolvedValue({ transactionId: 'test-tx-id' }),
      getOperatorAccountId: jest.fn().mockReturnValue('0.0.123456'),
      getOperatorPrivateKey: jest.fn().mockReturnValue('test-key'),
    } as any;

    registry = new HashLinksRegistry(
      'testnet' as NetworkType,
      logger,
      '0.0.777777',
      mockClient,
    );
  });

  describe('HashLink Registration', () => {
    it('should register a new HashLink in the directory', async () => {
      const registration: HashLinksRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        name: 'DeFi Trading Dashboard',
        description: 'A comprehensive trading dashboard for DeFi operations',
        tags: ['defi', 'trading', 'analytics'],
        category: 'finance',
        featured: true,
        author: '0.0.789012',
        website: 'https://example.com',
      };

      const id = await registry.register(registration);
      expect(id).toMatch(/^(0\.0\.\d+_\d+_[a-z0-9]+|local_\d+_[a-z0-9]+)$/);

      const entry = await registry.getEntry(id);
      expect(entry).toBeDefined();
      expect(entry?.data).toEqual(registration);
    });

    it('should validate HashLink registration fields', async () => {
      const invalidRegistration = {
        p: 'hcs-12',
        op: 'register',
      } as any;

      await expect(registry.register(invalidRegistration)).rejects.toThrow();
    });

    it('should enforce name length limit', async () => {
      const registration: HashLinksRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        name: 'a'.repeat(101),
        description: 'Test',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        'Name must be 100 characters or less',
      );
    });

    it('should enforce description length limit', async () => {
      const registration: HashLinksRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        name: 'Test HashLink',
        description: 'a'.repeat(501),
      };

      await expect(registry.register(registration)).rejects.toThrow(
        'Description must be 500 characters or less',
      );
    });

    it('should enforce tag limit', async () => {
      const registration: HashLinksRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        name: 'Test HashLink',
        tags: Array(11).fill('tag'),
      };

      await expect(registry.register(registration)).rejects.toThrow(
        'Maximum 10 tags allowed',
      );
    });
  });

  describe('HashLink Search and Discovery', () => {
    beforeEach(async () => {
      const hashLinks: HashLinksRegistration[] = [
        {
          p: 'hcs-12',
          op: 'register',
          t_id: '0.0.111111',
          name: 'NFT Marketplace',
          description: 'Decentralized NFT trading platform',
          tags: ['nft', 'marketplace', 'trading'],
          category: 'marketplace',
          featured: true,
        },
        {
          p: 'hcs-12',
          op: 'register',
          t_id: '0.0.222222',
          name: 'DeFi Lending Protocol',
          description: 'Peer-to-peer lending on Hedera',
          tags: ['defi', 'lending', 'finance'],
          category: 'finance',
          featured: false,
        },
        {
          p: 'hcs-12',
          op: 'register',
          t_id: '0.0.333333',
          name: 'Token Swap Exchange',
          description: 'Instant token swaps with minimal fees',
          tags: ['defi', 'exchange', 'trading'],
          category: 'finance',
          featured: true,
        },
      ];

      for (const hashLink of hashLinks) {
        await registry.register(hashLink);
      }
    });

    it('should search HashLinks by tags', async () => {
      const defiResults = await registry.searchByTags(['defi']);
      expect(defiResults).toHaveLength(2);
      expect(defiResults.every(hl => hl.tags?.includes('defi'))).toBe(true);

      const tradingResults = await registry.searchByTags(['trading']);
      expect(tradingResults).toHaveLength(2);
    });

    it('should search HashLinks by name', async () => {
      const results = await registry.searchByName('token');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Token Swap Exchange');
    });

    it('should search HashLinks by description', async () => {
      const results = await registry.searchByName('lending');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('DeFi Lending Protocol');
    });

    it('should get featured HashLinks', async () => {
      const featured = await registry.getFeatured();
      expect(featured).toHaveLength(2);
      expect(featured.every(hl => hl.featured === true)).toBe(true);
    });

    it('should get HashLinks by category', async () => {
      const financeHashLinks = await registry.getByCategory('finance');
      expect(financeHashLinks).toHaveLength(2);
      expect(financeHashLinks.every(hl => hl.category === 'finance')).toBe(
        true,
      );

      const marketplaceHashLinks = await registry.getByCategory('marketplace');
      expect(marketplaceHashLinks).toHaveLength(1);
    });

    it('should get all unique categories', async () => {
      const categories = await registry.getCategories();
      expect(categories).toEqual(['finance', 'marketplace']);
    });

    it('should get all unique tags', async () => {
      const tags = await registry.getAllTags();
      expect(tags).toEqual([
        'defi',
        'exchange',
        'finance',
        'lending',
        'marketplace',
        'nft',
        'trading',
      ]);
    });
  });

  describe('Registry Statistics', () => {
    it('should provide HashLinks-specific statistics', async () => {
      await registry.register({
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.111111',
        name: 'Test App 1',
        tags: ['test', 'demo'],
        category: 'testing',
        featured: true,
      });

      await registry.register({
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.222222',
        name: 'Test App 2',
        tags: ['test', 'example'],
        category: 'examples',
      });

      const stats = registry.getStats();
      expect(stats).toEqual({
        entryCount: 2,
        lastSync: undefined,
        topicId: '0.0.777777',
        registryType: 'HASHLINKS',
        categories: 2,
        totalTags: 3,
        featuredCount: 1,
      });
    });
  });

  describe('Registry Configuration', () => {
    it('should have correct topic memo format', () => {
      const memo = registry.getTopicMemo();
      expect(memo).toBe('hcs-12:1:60:3');
    });

    it('should have correct registry type', () => {
      const config = registry.getConfig();
      expect(config.type).toBe(RegistryType.HASHLINKS);
      expect(config.indexed).toBe(false);
      expect(config.ttl).toBe(60);
    });
  });
});
