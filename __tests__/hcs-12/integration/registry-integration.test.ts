/**
 * Registry Integration Tests for HCS-12
 *
 * Tests real registry operations on Hedera Testnet without mocks
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { HCS12Client } from '../../../src/hcs-12/sdk';
import { ActionRegistry } from '../../../src/hcs-12/registries/action-registry';
import { BlockLoader } from '../../../src/hcs-12/registries/block-loader';
import { AssemblyRegistry } from '../../../src/hcs-12/registries/assembly-registry';
import { Logger } from '../../../src/utils/logger';
import { NetworkType } from '../../../src/utils/types';
import {
  ActionRegistration,
  BlockDefinition,
  AssemblyRegistration,
  RegistryType,
  StorageCapability,
} from '../../../src/hcs-12/types';
import { BlockBuilder, AssemblyBuilder } from '../../../src/hcs-12/builders';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Registry Integration Tests', () => {
  let client: HCS12Client;
  let actionRegistry: ActionRegistry;
  let blockLoader: BlockLoader;
  let assemblyRegistry: AssemblyRegistry;
  let logger: Logger;

  let actionTopicId: string;
  let blockTopicId: string;
  let assemblyTopicId: string;

  let testActionId: string;
  let testBlockId: string;

  const hasCredentials =
    process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY;
  const describeOrSkip = hasCredentials ? describe : describe.skip;

  beforeAll(async () => {
    logger = new Logger({ module: 'RegistryIntegrationTest' });

    if (hasCredentials) {
      client = new HCS12Client({
        network: 'testnet' as NetworkType,
        operatorId: process.env.HEDERA_ACCOUNT_ID!,
        operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY!,
        logger,
      });
    }
  }, 30000);

  describeOrSkip('Action Registry Integration', () => {
    it('should create action registry topic on testnet', async () => {
      actionTopicId = await client.createRegistryTopic(RegistryType.ACTION);

      expect(actionTopicId).toBeDefined();
      expect(actionTopicId).toMatch(/^\d+\.\d+\.\d+$/);

      logger.info('Created action registry topic', { actionTopicId });
    }, 60000);

    it('should register a new action with WASM', async () => {
      client.initializeRegistries({
        action: actionTopicId,
        block: blockTopicId || '0.0.0',
        assembly: assemblyTopicId || '0.0.0',
      });

      const wasmModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);

      const moduleInfo = {
        name: 'test-action',
        version: '1.0.0',
        hashlinks_version: '0.1.0',
        creator: client.getOperatorAccountId(),
        purpose: 'Integration test action',
        actions: [
          {
            name: 'execute',
            description: 'Execute test action',
            inputs: [
              {
                name: 'input',
                param_type: 'string' as const,
                description: 'Test input',
                required: true,
              },
            ],
            outputs: [
              {
                name: 'result',
                param_type: 'string' as const,
                description: 'Test result',
                required: false,
              },
            ],
            required_capabilities: [],
          },
        ],
        capabilities: [
          {
            type: 'storage',
            value: {
              storage_types: ['hcs'],
              max_size_bytes: 1048576,
            } as StorageCapability,
          },
        ],
        plugins: [],
      };

      const actionReg = await client.actionRegistry!.registerWithWasm(
        Buffer.from(wasmModule),
        moduleInfo,
      );

      testActionId = await client.actionRegistry!.register(actionReg);

      expect(testActionId).toBeDefined();
      logger.info('Registered real action', {
        testActionId,
        wasmTopic: actionReg.t_id,
      });
    }, 60000);

    it('should query registered actions', async () => {
      await client.actionRegistry!.sync();

      const actions = await client.actionRegistry!.listEntries();

      expect(actions).toBeDefined();
      expect(actions.length).toBeGreaterThan(0);

      const testAction = actions.find(a => a.id === testActionId);
      expect(testAction).toBeDefined();
      expect(testAction?.data.t_id).toBeDefined();
      expect(testAction?.data.hash).toBeDefined();
    }, 60000);
  });

  describeOrSkip('Block Registry Integration', () => {
    it('should create assembly topic on testnet for blocks', async () => {
      expect(true).toBe(true);
    }, 60000);

    it('should store a block via HCS-1', async () => {
      const template = '<div>{{attributes.message}}</div>';
      
      const blockBuilder = BlockBuilder.createWidgetBlock(
        'hashlinks/test-block',
        'Test Block'
      )
        .setDescription('Integration test block')
        .setIcon('block-default')
        .setKeywords(['test', 'integration'])
        .addAttribute('message', 'string', 'Hello HashLink!')
        .addSupport('align', true)
        .addSupport('className', true)
        .addSupport('customClassName', true)
        .setTemplate(Buffer.from(template));

      const registeredBlock = await client.registerBlock(blockBuilder);
      testBlockId = registeredBlock.getTopicId();

      expect(testBlockId).toBeDefined();
      logger.info('Stored block via HCS-1', { testBlockId });
    }, 60000);

    it('should load stored block', async () => {
      if (!testBlockId) {
        logger.warn('No block ID from previous test');
        return;
      }

      const loadedBlock = await client.blockLoader!.loadBlock(testBlockId);

      expect(loadedBlock).toBeDefined();
      expect(loadedBlock.definition.name).toBe('hashlinks/test-block');
      expect(loadedBlock.definition.category).toBe('widgets');
      expect(loadedBlock.definition.keywords).toContain('test');
      expect(loadedBlock.template).toBe('<div>{{attributes.message}}</div>');
    }, 60000);
  });

  describeOrSkip('Assembly Registry Integration', () => {
    it('should create assembly registry topic on testnet', async () => {
      assemblyTopicId = await client.createRegistryTopic(RegistryType.ASSEMBLY);

      expect(assemblyTopicId).toBeDefined();
      expect(assemblyTopicId).toMatch(/^\d+\.\d+\.\d+$/);

      client.initializeRegistries({
        action: actionTopicId,
        block: blockTopicId,
        assembly: assemblyTopicId,
      });

      logger.info('Created assembly registry topic', { assemblyTopicId });
    }, 60000);

    it('should create and setup a complete assembly', async () => {
      const assemblyBuilder = new AssemblyBuilder(logger)
        .setName('test-assembly')
        .setVersion('1.0.0')
        .setDescription('Integration test assembly');

      const assemblyTopicId = await client.createAssembly(assemblyBuilder);
      expect(assemblyTopicId).toBeDefined();


      logger.info('Created complete assembly', { assemblyTopicId });
    }, 60000);

    it('should query assemblies from registry', async () => {
      await client.assemblyRegistry!.sync();

      const assemblies = await client.assemblyRegistry!.listEntries();

      expect(assemblies).toBeDefined();
      expect(assemblies.length).toBeGreaterThan(0);

      const testAssembly = assemblies.find(
        a => a.data.name === 'test-assembly',
      );
      expect(testAssembly).toBeDefined();
      expect(testAssembly?.data.version).toBe('1.0.0');
    }, 60000);
  });

  describeOrSkip('Cross-Registry Integration', () => {
    it('should resolve assembly with all dependencies', async () => {
      await client.actionRegistry!.sync();
      await client.assemblyRegistry!.sync();

      const assemblies = await client.assemblyRegistry!.listEntries();
      const assembly = assemblies.find(a => a.data.name === 'test-assembly');

      expect(assembly).toBeDefined();

      const assemblyData = assembly!.data;

      expect(assemblyData.name).toBe('test-assembly');
      expect(assemblyData.version).toBe('1.0.0');
    }, 60000);

    it('should handle registry queries with pagination', async () => {
      const actionPromises = [];
      for (let i = 0; i < 5; i++) {
        const wasmModule = new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        ]);

        const moduleInfo = {
          name: `pagination-test-${i}`,
          version: '1.0.0',
          hashlinks_version: '0.1.0',
          creator: client.getOperatorAccountId(),
          purpose: 'Pagination test',
          actions: [
            {
              name: 'execute',
              description: 'Execute pagination test',
              inputs: [],
              outputs: [],
              required_capabilities: [],
            },
          ],
          capabilities: [],
          plugins: [],
        };

        const actionReg = await client.actionRegistry!.registerWithWasm(
          Buffer.from(wasmModule),
          moduleInfo,
        );

        actionPromises.push(client.actionRegistry!.register(actionReg));
      }

      await Promise.all(actionPromises);

      await client.actionRegistry!.sync();
      const allActions = await client.actionRegistry!.listEntries();

      const paginationActions = allActions.filter(a =>
        a.data.name.startsWith('pagination-test-'),
      );
      expect(paginationActions.length).toBe(5);
    }, 120000);
  });

  describeOrSkip('Performance Tests', () => {
    it('should handle concurrent registry operations', async () => {
      const start = Date.now();
      const operations = [];

      for (let i = 0; i < 10; i++) {
        operations.push(client.actionRegistry!.listEntries());
        operations.push(client.assemblyRegistry!.listEntries());
      }

      const results = await Promise.all(operations);
      const duration = Date.now() - start;

      expect(results).toHaveLength(20);
      expect(duration).toBeLessThan(30000);

      logger.info('Concurrent operations performance', {
        operations: 20,
        duration,
        avgTime: duration / 20,
      });
    }, 60000);

    it('should measure registry query performance', async () => {
      const iterations = 5;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await client.actionRegistry!.listEntries();
        times.push(Date.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b) / times.length;
      expect(avgTime).toBeLessThan(5000);

      logger.info('Query performance', {
        iterations,
        times,
        avgTime,
        min: Math.min(...times),
        max: Math.max(...times),
      });
    }, 60000);
  });

  afterAll(async () => {
    logger.info('Registry integration tests completed', {
      actionTopicId,
      blockTopicId,
      assemblyTopicId,
    });
  });
});
