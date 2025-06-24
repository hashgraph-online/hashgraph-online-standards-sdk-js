/**
 * Full Integration Tests for HCS-12 HashLinks
 *
 * These tests use real components without mocks to verify
 * the complete integration of the HCS-12 implementation,
 * including registries, builders, hash verification, and
 * the full lifecycle of HashLinks components.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Logger } from '../../../src/utils/logger';
import { HCS12Client } from '../../../src/hcs-12/sdk';
import { ActionBuilder } from '../../../src/hcs-12/builders/action-builder';
import { BlockBuilder } from '../../../src/hcs-12/builders/block-builder';
import { HashVerifier } from '../../../src/hcs-12/security/hash-verifier';
import type { NetworkType } from '../../../src/utils/types';
import {
  ActionRegistration,
  BlockDefinition,
  AssemblyRegistration,
  RegistryType,
} from '../../../src/hcs-12/types';
import * as dotenv from 'dotenv';

dotenv.config();

describe('HCS-12 Full Integration Tests', () => {
  let logger: Logger;
  let client: HCS12Client;
  let actionBuilder: ActionBuilder;
  let hashVerifier: HashVerifier;

  const hasCredentials =
    process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY;
  const describeOrSkip = hasCredentials ? describe : describe.skip;

  beforeEach(() => {
    logger = new Logger({ module: 'HCS12IntegrationTest' });

    if (hasCredentials) {
      client = new HCS12Client({
        network: 'testnet' as NetworkType,
        operatorId: process.env.HEDERA_ACCOUNT_ID!,
        operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY!,
        logger,
      });

      client.initializeRegistries();
    }

    actionBuilder = new ActionBuilder(logger);
    hashVerifier = new HashVerifier({ logger });
  });

  describeOrSkip('Registry Integration', () => {
    it('should create and retrieve action registrations', async () => {
      const actionDef: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        info_t_id: '0.0.789012',
        validation_rules: {
          transfer: {
            type: 'object',
            properties: {
              amount: { type: 'number', minimum: 0 },
              to: { type: 'string' },
            },
            required: ['amount', 'to'],
          },
        },
        m: 'Test action for integration',
      };

      const registrationId = await client.actionRegistry!.register(actionDef);
      expect(registrationId).toMatch(/^\d+$/);

      const retrieved = await client.actionRegistry!.getEntry(registrationId);
      expect(retrieved).toBeDefined();
      expect((retrieved?.data as ActionRegistration).hash).toBe(actionDef.hash);
    });

    it('should create and retrieve action registrations with JavaScript wrapper', async () => {
      const actionDef: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        js_t_id: '0.0.123457',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        js_hash:
          'd4d4d4d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        interface_version: '0.2.95',
        m: 'Test action with JavaScript wrapper',
      };

      const registrationId = await client.actionRegistry!.register(actionDef);
      expect(registrationId).toMatch(/^\d+$/);

      const retrieved = await client.actionRegistry!.getEntry(registrationId);
      expect(retrieved).toBeDefined();
      const data = retrieved?.data as ActionRegistration;
      expect(data.hash).toBe(actionDef.hash);
      expect(data.js_t_id).toBe(actionDef.js_t_id);
      expect(data.js_hash).toBe(actionDef.js_hash);
      expect(data.interface_version).toBe(actionDef.interface_version);
    });

    it('should store and retrieve blocks via HCS-1', async () => {
      const template = '<div>{{attributes.content}}</div>';
      
      const blockBuilder = BlockBuilder.createDisplayBlock(
        'test/hello-world-block',
        'Hello World Block'
      )
        .setDescription('A test block for integration')
        .setIcon('block-default')
        .setKeywords(['test', 'hello'])
        .addAttribute('content', 'string', 'Hello, World!')
        .addSupport('align', true)
        .addSupport('className', true)
        .setTemplate(Buffer.from(template));

      const registeredBlock = await client.registerBlock(blockBuilder);
      const definitionTopicId = registeredBlock.getTopicId();

      expect(definitionTopicId).toBeDefined();
      expect(definitionTopicId).toMatch(/^\d+\.\d+\.\d+$/);

      const loadedBlock =
        await client.blockLoader!.loadBlock(definitionTopicId);
      expect(loadedBlock).toBeDefined();
      expect(loadedBlock.definition.name).toBe('test/hello-world-block');
      expect(loadedBlock.template).toBe(template);
    }, 180000);
  });

  describeOrSkip('Action Builder Integration', () => {
    it('should build valid action registrations', async () => {
      const mockWasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
      const mockInfo = {
        name: 'test/test-action',
        version: '1.0.0',
        hashlinks_version: '0.1.0',
        creator: '0.0.123456',
        purpose: 'Test action',
        actions: [],
        capabilities: [],
        plugins: [],
      };

      const registration = await actionBuilder.createFromWasmAndInfo(
        '0.0.123456',
        mockWasmData,
        mockInfo,
      );

      expect(registration.p).toBe('hcs-12');
      expect(registration.op).toBe('register');
      expect(registration.t_id).toBe('0.0.123456');
      expect(registration.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(registration.wasm_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should build action registrations with JavaScript wrapper', async () => {
      const mockWasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
      const mockJsData = new TextEncoder().encode('export function init() {}');
      const mockInfo = {
        name: 'test/test-action',
        version: '1.0.0',
        hashlinks_version: '0.1.0',
        creator: '0.0.123456',
        purpose: 'Test action',
        actions: [],
        capabilities: [],
        plugins: [],
      };

      const registration = await actionBuilder
        .setTopicId('0.0.123456')
        .setJsTopicId('0.0.123457')
        .setInterfaceVersion('0.2.95')
        .createFromWasmAndInfo('0.0.123456', mockWasmData, mockInfo);

      expect(registration.js_t_id).toBe('0.0.123457');
      expect(registration.interface_version).toBe('0.2.95');

      const jsHash = await actionBuilder.calculateHash(mockJsData);
      actionBuilder.setJsHash(jsHash);
      const finalReg = actionBuilder.build();
      expect(finalReg.js_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should validate action builder fields', () => {
      expect(() => actionBuilder.setTopicId('invalid')).toThrow(
        'Invalid topic ID format',
      );
      expect(() => actionBuilder.setHash('invalid')).toThrow(
        'Invalid hash format',
      );
      expect(() => actionBuilder.setWasmHash('short')).toThrow(
        'Invalid hash format',
      );
    });

    it('should support fluent API', () => {
      const result = actionBuilder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .setWasmHash(
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        );

      expect(result).toBe(actionBuilder);

      const registration = result.build();
      expect(registration.t_id).toBe('0.0.123456');
    });

    it('should validate JavaScript wrapper fields', () => {
      expect(() => actionBuilder.setJsTopicId('invalid')).toThrow(
        'Invalid topic ID format',
      );
      expect(() => actionBuilder.setJsHash('invalid')).toThrow(
        'Invalid hash format',
      );
      expect(() => actionBuilder.setInterfaceVersion('invalid')).toThrow(
        'Invalid version format',
      );

      expect(() => actionBuilder.setJsTopicId('0.0.123457')).not.toThrow();
      expect(() =>
        actionBuilder.setJsHash(
          'd4d4d4d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        ),
      ).not.toThrow();
      expect(() => actionBuilder.setInterfaceVersion('0.2.95')).not.toThrow();
    });
  });

  describeOrSkip('Hash Verification Integration', () => {
    it('should create and verify WASM manifests', async () => {
      const mockModule = {
        id: 'test-module',
        code: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
        metadata: {
          name: 'test/test-module',
          version: '1.0.0',
          creator: '0.0.123456',
        },
      };

      const manifest = await hashVerifier.createWasmManifest(mockModule);

      expect(manifest.codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.metadataHash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.combinedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.algorithm).toBe('sha256');
      expect(manifest.timestamp).toBeGreaterThan(0);

      const verification = await hashVerifier.verifyWasmModule(
        mockModule,
        manifest,
      );
      expect(verification.valid).toBe(true);
      expect(verification.codeIntegrity).toBe(true);
      expect(verification.metadataIntegrity).toBe(true);
    });

    it('should create and verify assembly hash trees', async () => {
      const mockAssembly = {
        id: 'test-assembly',
        components: {
          action1: { registryId: '0.0.12345', type: 'action' },
          block1: { id: 'test/test-block', version: '1.0.0' },
        },
        metadata: {
          name: 'Test Assembly',
          version: '1.0.0',
        },
      };

      const hashTree = await hashVerifier.createAssemblyHashTree(mockAssembly);

      expect(hashTree.root).toMatch(/^[a-f0-9]{64}$/);
      expect(hashTree.components.action1).toMatch(/^[a-f0-9]{64}$/);
      expect(hashTree.components.block1).toMatch(/^[a-f0-9]{64}$/);
      expect(hashTree.metadata).toMatch(/^[a-f0-9]{64}$/);
      expect(hashTree.algorithm).toBe('sha256');

      const verification = await hashVerifier.verifyAssemblyHashTree(
        mockAssembly,
        hashTree,
      );
      expect(verification.valid).toBe(true);
      expect(verification.invalidComponents).toHaveLength(0);
    });

    it('should handle hash verification failures', async () => {
      const mockModule = {
        id: 'test-module',
        code: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
        metadata: { name: 'test' },
      };

      const manifest = await hashVerifier.createWasmManifest(mockModule);

      const tamperedModule = {
        ...mockModule,
        code: new Uint8Array([0x00, 0x61, 0x73, 0x6e]),
      };

      const verification = await hashVerifier.verifyWasmModule(
        tamperedModule,
        manifest,
      );
      expect(verification.valid).toBe(false);
      expect(verification.codeIntegrity).toBe(false);
    });
  });

  describe('Registry Configuration Integration', () => {
    it('should provide correct registry configurations', () => {
      const actionConfig = client.actionRegistry!.getConfig();
      expect(actionConfig.type).toBe(RegistryType.ACTION);
      expect(actionConfig.memo).toBe('hcs-12:1:60:0');
      expect(actionConfig.indexed).toBe(false);
      expect(actionConfig.ttl).toBe(60);


      const assemblyConfig = client.assemblyRegistry!.getConfig();
      expect(assemblyConfig.type).toBe(RegistryType.ASSEMBLY);
      expect(assemblyConfig.memo).toBe('hcs-12:0:60:2');
    });

    it('should handle registry statistics', () => {
      const stats = client.actionRegistry!.getStats();
      expect(stats).toEqual({
        entryCount: expect.any(Number),
        lastSync: undefined,
        topicId: undefined,
        registryType: 'ACTION',
      });
    });

    it('should clear registry cache', async () => {
      client.actionRegistry!.clearCache();
      const entries = await client.actionRegistry!.listEntries();
      expect(entries).toHaveLength(0);
    });
  });

  describe('Full Registry Lifecycle', () => {
    it('should handle complete registration and retrieval flow', async () => {
      const actionReg: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        m: 'Test action',
      };

      const actionWithJsReg: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.223456',
        js_t_id: '0.0.223457',
        hash: 'f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        js_hash:
          'c4c4c4c4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        interface_version: '0.2.95',
        m: 'Test action with JS wrapper',
      };

      const actionId = await client.actionRegistry!.register(actionReg);
      expect(actionId).toMatch(/^\d+$/);

      const actionWithJsId =
        await client.actionRegistry!.register(actionWithJsReg);
      expect(actionWithJsId).toMatch(/^\d+$/);

      const blockBuilder = BlockBuilder.createDisplayBlock(
        'hashlinks/test-block',
        'Test Block'
      )
        .setDescription('Test block')
        .setIcon('block-default')
        .setKeywords(['test'])
        .setTemplate(Buffer.from('<div>{{attributes.content}}</div>'));

      await client.registerBlock(blockBuilder);
      const blockId = blockBuilder.getTopicId();
      expect(blockId).toMatch(/^\d+\.\d+\.\d+$/);

      logger.info('Integration test completed successfully', {
        actionId,
        blockId,
      });
    }, 180000);
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle validation errors gracefully', async () => {
      const invalidAction = {
        p: 'hcs-12',
        op: 'register',
      } as any;

      await expect(
        client.actionRegistry!.register(invalidAction),
      ).rejects.toThrow(/Validation failed/);
    });

    it('should handle invalid topic IDs', () => {
      expect(() => actionBuilder.setTopicId('invalid-format')).toThrow(
        'Invalid topic ID format',
      );

      expect(() => actionBuilder.setTopicId('0.0.123456')).not.toThrow();
    });

    it('should handle invalid hash formats', () => {
      expect(() => actionBuilder.setHash('too-short')).toThrow(
        'Invalid hash format',
      );

      expect(() => actionBuilder.setWasmHash('not-hex-chars!@#')).toThrow(
        'Invalid hash format',
      );

      expect(() =>
        actionBuilder.setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        ),
      ).not.toThrow();
    });

    it('should handle missing registry entries', async () => {
      const nonExistentEntry =
        await client.actionRegistry!.getEntry('0.0.nonexistent');
      expect(nonExistentEntry).toBeNull();
    });

    it('should handle empty registry listings', async () => {
      client.actionRegistry!.clearCache();
      const entries = await client.actionRegistry!.listEntries();
      expect(entries).toHaveLength(0);
    });
  });
});
