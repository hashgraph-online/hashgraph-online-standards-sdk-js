/**
 * Assembly Lifecycle Integration Tests for HCS-12
 *
 * Tests complete assembly lifecycle operations on real Hedera Testnet
 * NO MOCKS - REAL INTEGRATION TESTS
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { HCS12Client } from '../../../src/hcs-12/sdk';
import { AssemblyEngine } from '../../../src/hcs-12/assembly';
import { AssemblyBuilder, ActionBuilder, BlockBuilder } from '../../../src/hcs-12/builders';
import { Logger } from '../../../src/utils/logger';
import { NetworkType } from '../../../src/utils/types';
import {
  ActionRegistration,
  AssemblyRegistration,
  RegistryType,
} from '../../../src/hcs-12/types';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Assembly Lifecycle Integration Tests', () => {
  let client: HCS12Client;
  let logger: Logger;

  let actionTopicId: string;
  let blockTopicId: string;
  let assemblyTopicId: string;

  let actionId: string;
  let blockId: string;

  const hasCredentials =
    process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY;
  const describeOrSkip = hasCredentials ? describe : describe.skip;

  beforeAll(async () => {
    logger = new Logger({ module: 'AssemblyLifecycleTest' });

    if (hasCredentials) {
      client = new HCS12Client({
        network: 'testnet' as NetworkType,
        operatorId: process.env.HEDERA_ACCOUNT_ID!,
        operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY!,
        logger,
      });

    }
  }, 30000);

  describeOrSkip('Complete Assembly Lifecycle on Real Testnet', () => {
    it('should create registry topics', async () => {
      actionTopicId = await client.createRegistryTopic(RegistryType.ACTION);
      blockTopicId = await client.createRegistryTopic(RegistryType.BLOCK);
      assemblyTopicId = await client.createRegistryTopic(RegistryType.ASSEMBLY);

      expect(actionTopicId).toMatch(/^\d+\.\d+\.\d+$/);
      expect(blockTopicId).toMatch(/^\d+\.\d+\.\d+$/);
      expect(assemblyTopicId).toMatch(/^\d+\.\d+\.\d+$/);

      client.initializeRegistries({
        action: actionTopicId,
        block: blockTopicId,
        assembly: assemblyTopicId,
      });

      logger.info('Created real registry topics', {
        actionTopicId,
        blockTopicId,
        assemblyTopicId,
      });
    }, 180000);

    it('should register real action on testnet', async () => {
      const wasmModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);

      const moduleInfo = {
        name: 'lifecycle-test-action',
        version: '1.0.0',
        hashlinks_version: '0.1.0',
        creator: client.getOperatorAccountId(),
        purpose: 'Test assembly lifecycle',
        actions: [
          {
            name: 'execute',
            description: 'Execute lifecycle test',
            inputs: [],
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
        capabilities: [],
        plugins: [],
      };

      const actionReg = await client.actionRegistry!.registerWithWasm(
        Buffer.from(wasmModule),
        moduleInfo,
      );

      actionId = await client.actionRegistry!.register(actionReg);

      expect(actionId).toBeDefined();
      logger.info('Registered real action', {
        actionId,
        wasmTopic: actionReg.t_id,
      });
    }, 180000);

    it('should register real block on testnet', async () => {
      const template = '<div>{{attributes.message}}</div>';
      
      const blockBuilder = BlockBuilder.createDisplayBlock(
        'lifecycle/test-block',
        'Lifecycle Test Block'
      )
        .setDescription('Block for testing assembly lifecycle')
        .setIcon('block-default')
        .setKeywords(['test', 'lifecycle'])
        .addAttribute('message', 'string', 'Hello from lifecycle test')
        .setTemplate(Buffer.from(template));

      const registeredBlock = await client.registerBlock(blockBuilder);
      blockId = registeredBlock.getTopicId();

      expect(blockId).toBeDefined();
      logger.info('Registered real block', { blockId });
    }, 120000);


    it('should verify assembly components are retrievable', async () => {
      if (!blockId) {
        logger.warn('Skipping component verification: blockId not set from previous test');
        return;
      }

      await client.actionRegistry!.sync();
      await client.assemblyRegistry!.sync();

      const actionEntries = await client.actionRegistry!.listEntries();
      const hasAction = actionEntries.some(e => e.id === actionId);
      expect(hasAction).toBe(true);

      const loadedBlock = await client.blockLoader!.loadBlock(blockId);
      expect(loadedBlock).toBeDefined();
      expect(loadedBlock.definition.name).toBe('lifecycle/test-block');

      const assemblyEntries = await client.assemblyRegistry!.listEntries();
      expect(assemblyEntries.length).toBeGreaterThan(0);

      logger.info('Verified all components are retrievable', {
        actionCount: actionEntries.length,
        assemblyCount: assemblyEntries.length,
      });
    }, 180000);
  });

  afterAll(async () => {
    logger.info('Assembly lifecycle integration tests completed', {
      actionTopicId,
      blockTopicId,
      assemblyTopicId,
    });
  });
});
