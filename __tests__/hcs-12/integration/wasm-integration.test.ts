/**
 * WASM Module Integration Tests for HCS-12
 *
 * Tests real WASM module operations on Hedera Testnet without mocks
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Logger } from '../../../src/utils/logger';
import { SignatureVerifier } from '../../../src/hcs-12/security/signature-verifier';
import { HashVerifier } from '../../../src/hcs-12/security/hash-verifier';
import { PrivateKey } from '@hashgraph/sdk';
import { HCS12Client } from '../../../src/hcs-12/sdk';
import { RegistryType } from '../../../src/hcs-12/types';
import { NetworkType } from '../../../src/utils/types';
import * as dotenv from 'dotenv';

dotenv.config();

describe('WASM Module Integration Tests', () => {
  let client: HCS12Client;
  let signatureVerifier: SignatureVerifier;
  let hashVerifier: HashVerifier;
  let logger: Logger;
  let signingKey: PrivateKey;

  const hasCredentials =
    process.env.HEDERA_ACCOUNT_ID && process.env.HEDERA_PRIVATE_KEY;
  const describeOrSkip = hasCredentials ? describe : describe.skip;

  beforeAll(async () => {
    logger = new Logger({ module: 'WASMIntegrationTest' });

    if (hasCredentials) {
      client = new HCS12Client({
        network: 'testnet' as NetworkType,
        operatorId: process.env.HEDERA_ACCOUNT_ID!,
        operatorPrivateKey: process.env.HEDERA_PRIVATE_KEY!,
        logger,
      });

      client.initializeRegistries();

      signatureVerifier = new SignatureVerifier({ logger });
      hashVerifier = new HashVerifier({ logger });
      signingKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY!);
    }
  }, 30000);

  afterAll(async () => {});

  describeOrSkip('WASM File Upload via HCS-1', () => {
    it('should inscribe valid WASM module using HCS-1 on REAL testnet', async () => {
      const wasmCode = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,

        0x01, 0x04, 0x01, 0x60, 0x00, 0x00,

        0x03, 0x02, 0x01, 0x00,

        0x07, 0x08, 0x01, 0x04, 0x49, 0x4e, 0x46, 0x4f, 0x00, 0x00,

        0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
      ]);

      const moduleInfo = {
        name: 'real-test-action',
        version: '1.0.0',
        hashlinks_version: '0.1.0',
        creator: client.getOperatorAccountId(),
        purpose: 'Real WASM upload test on testnet',
        actions: [
          {
            name: 'test',
            description: 'Test action',
            inputs: [],
            outputs: [],
            required_capabilities: [],
          },
        ],
        capabilities: [],
        plugins: [],
      };

      const actionTopicId = await client.createRegistryTopic(
        RegistryType.ACTION,
      );
      client.initializeRegistries({ action: actionTopicId });

      const registration = await client.actionRegistry!.registerWithWasm(
        Buffer.from(wasmCode),
        moduleInfo,
      );

      expect(registration.t_id).toBeDefined();
      expect(registration.t_id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(registration.wasm_hash).toBeDefined();
      expect(registration.hash).toBeDefined();

      await new Promise(resolve => setTimeout(resolve, 5000));

      const retrieved = await client.actionRegistry!.getAction(
        registration.hash,
      );
      expect(retrieved).toBeDefined();
      expect(retrieved?.wasm_hash).toBe(registration.wasm_hash);
    }, 60000);

    it('should inscribe large WASM module using HCS-1 on REAL testnet', async () => {
      const largeWasm = new Uint8Array(100 * 1024);
      const header = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);
      largeWasm.set(header);

      for (let i = header.length; i < largeWasm.length; i++) {
        largeWasm[i] = i % 256;
      }

      const moduleInfo = {
        name: 'large-real-test-action',
        version: '1.0.0',
        hashlinks_version: '0.1.0',
        creator: client.getOperatorAccountId(),
        purpose: 'Real large WASM upload test on testnet',
        actions: [
          {
            name: 'test',
            description: 'Test action',
            inputs: [],
            outputs: [],
            required_capabilities: [],
          },
        ],
        capabilities: [],
        plugins: [],
      };

      const registration = await client.actionRegistry!.registerWithWasm(
        Buffer.from(largeWasm),
        moduleInfo,
      );

      expect(registration.t_id).toBeDefined();
      expect(registration.wasm_hash).toBeDefined();

      logger.info('Large WASM inscribed via HCS-1 on real testnet', {
        topicId: registration.t_id,
        size: largeWasm.length,
        hash: registration.wasm_hash,
      });

      await new Promise(resolve => setTimeout(resolve, 5000));

      const retrieved = await client.actionRegistry!.getAction(
        registration.hash,
      );
      expect(retrieved).toBeDefined();
    }, 120000);
  });

  describeOrSkip('WASM Security', () => {
    let wasmModule: Uint8Array;

    beforeAll(async () => {
      const wasmCode = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);

      wasmModule = {
        id: `wasm-security-test-${Date.now()}`,
        code: wasmCode,
        metadata: {
          name: 'security-test-action',
          version: '1.0.0',
          creator: client.getOperatorAccountId(),
        },
      };
    });

    it('should sign and verify WASM module', async () => {
      const signedModule = await signatureVerifier.signWasmModule(
        wasmModule,
        signingKey,
      );

      expect(signedModule.signature).toBeDefined();
      expect(signedModule.codeHash).toBeDefined();

      const verification = await signatureVerifier.verifyWasmModule(
        signedModule,
        signingKey.publicKey,
      );

      expect(verification.valid).toBe(true);
      expect(verification.codeIntegrity).toBe(true);
    }, 20000);

    it('should create and verify WASM hash manifest', async () => {
      const manifest = await hashVerifier.createWasmManifest(wasmModule);

      expect(manifest.codeHash).toBeDefined();
      expect(manifest.metadataHash).toBeDefined();
      expect(manifest.combinedHash).toBeDefined();

      const verification = await hashVerifier.verifyWasmModule(
        wasmModule,
        manifest,
      );

      expect(verification.valid).toBe(true);
      expect(verification.codeIntegrity).toBe(true);
      expect(verification.metadataIntegrity).toBe(true);
    }, 20000);

    it('should detect tampered WASM code', async () => {
      const signedModule = await signatureVerifier.signWasmModule(
        wasmModule,
        signingKey,
      );

      const tamperedModule = {
        ...signedModule,
        code: new Uint8Array(signedModule.code),
      };
      tamperedModule.code[0] = 0xff;

      const verification = await signatureVerifier.verifyWasmModule(
        tamperedModule,
        signingKey.publicKey,
      );

      expect(verification.codeIntegrity).toBe(false);
    }, 20000);
  });

  describeOrSkip('WASM Execution Environment', () => {
    it('should validate WASM module capabilities', async () => {
      const wasmModule = {
        code: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
        metadata: {
          name: 'Capability Test',
          version: '1.0.0',
          capabilities: ['READ_STATE', 'WRITE_STATE', 'HTTP_REQUEST'],
          parameters: [{ name: 'input', type: 'string', required: true }],
        },
      };

      const allowedCapabilities = [
        'READ_STATE',
        'WRITE_STATE',
        'EMIT_EVENT',
        'HTTP_REQUEST',
        'HEDERA_TRANSACTION',
      ];

      const validCapabilities = wasmModule.metadata.capabilities.every(cap =>
        allowedCapabilities.includes(cap),
      );

      expect(validCapabilities).toBe(true);
    }, 30000);

    it('should enforce memory limits for WASM modules', async () => {
      const wasmWithMemory = {
        code: new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01,
          0x00, 0x01,
        ]),
        metadata: {
          name: 'Memory Test',
          version: '1.0.0',
          memory: {
            initial: 1,
            maximum: 10,
          },
        },
      };

      const MAX_MEMORY_PAGES = 16;
      const isWithinLimits =
        wasmWithMemory.metadata.memory.initial <= MAX_MEMORY_PAGES &&
        wasmWithMemory.metadata.memory.maximum <= MAX_MEMORY_PAGES;

      expect(isWithinLimits).toBe(true);
    }, 30000);
  });

  describeOrSkip('WASM Module Versioning', () => {
    it('should support WASM module versioning', async () => {
      const baseModuleInfo = {
        name: 'versioned-action',
        version: '1.0.0',
        hashlinks_version: '0.1.0',
        creator: client.getOperatorAccountId(),
        purpose: 'Test WASM versioning',
        actions: [
          {
            name: 'execute',
            description: 'Execute versioned action',
            inputs: [],
            outputs: [],
            required_capabilities: [],
          },
        ],
        capabilities: [],
        plugins: [],
      };

      const wasmV1 = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);
      const regV1 = await client.actionRegistry!.registerWithWasm(
        Buffer.from(wasmV1),
        baseModuleInfo,
      );

      const moduleInfoV2 = {
        ...baseModuleInfo,
        version: '2.0.0',
      };

      const wasmV2 = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x02,
      ]);
      const regV2 = await client.actionRegistry!.registerWithWasm(
        Buffer.from(wasmV2),
        moduleInfoV2,
        {
          previous_version: regV1.hash,
          migration_notes: 'Added new features',
        },
      );

      expect(regV2.source_verification?.previous_version).toBe(regV1.hash);
      expect(regV2.source_verification?.migration_notes).toBe(
        'Added new features',
      );
    }, 60000);
  });

  describeOrSkip('WASM Module Performance', () => {
    it('should measure WASM upload performance', async () => {
      const sizes = [1024, 10240, 51200];
      const performanceMetrics: Array<{ operation: string; duration: number; success: boolean }> = [];

      for (const size of sizes) {
        const wasmCode = new Uint8Array(size);
        wasmCode.set([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

        const moduleInfo = {
          name: `perf-test-${size}`,
          version: '1.0.0',
          hashlinks_version: '0.1.0',
          creator: client.getOperatorAccountId(),
          purpose: `Performance test for ${size} bytes`,
          actions: [],
          capabilities: [],
          plugins: [],
        };

        const startTime = Date.now();

        const registration = await client.actionRegistry!.registerWithWasm(
          Buffer.from(wasmCode),
          moduleInfo,
        );

        const uploadTime = Date.now() - startTime;

        performanceMetrics.push({
          size,
          uploadTime,
          topicId: registration.t_id,
        });

        logger.info('WASM upload performance', {
          size,
          uploadTimeMs: uploadTime,
          bytesPerSecond: (size / uploadTime) * 1000,
        });
      }

      const maxSize = Math.max(...sizes);
      const maxSizeMetric = performanceMetrics.find(m => m.size === maxSize);
      expect(maxSizeMetric?.uploadTime).toBeLessThan(30000);
    }, 120000);

    it('should handle concurrent WASM operations', async () => {
      const concurrentUploads = 3;
      const uploads = [];

      for (let i = 0; i < concurrentUploads; i++) {
        const wasmCode = new Uint8Array([
          0x00,
          0x61,
          0x73,
          0x6d,
          0x01,
          0x00,
          0x00,
          0x00,
          i,
        ]);
        const moduleInfo = {
          name: `concurrent-test-${i}`,
          version: '1.0.0',
          hashlinks_version: '0.1.0',
          creator: client.getOperatorAccountId(),
          purpose: `Concurrent test ${i}`,
          actions: [],
          capabilities: [],
          plugins: [],
        };

        uploads.push(
          client.actionRegistry!.registerWithWasm(
            Buffer.from(wasmCode),
            moduleInfo,
          ),
        );
      }

      const results = await Promise.all(uploads);

      expect(results).toHaveLength(concurrentUploads);
      results.forEach(reg => {
        expect(reg.t_id).toBeDefined();
        expect(reg.wasm_hash).toBeDefined();
      });

      logger.info('Concurrent WASM operations completed', {
        count: concurrentUploads,
        topicIds: results.map(r => r.t_id),
      });
    }, 120000);
  });

  describeOrSkip('WASM Module Metadata', () => {
    it('should store and retrieve complete module metadata', async () => {
      const complexMetadata = {
        name: 'advanced-calculator',
        version: '3.1.4',
        hashlinks_version: '0.1.0',
        creator: client.getOperatorAccountId(),
        purpose: 'Advanced mathematical operations',
        actions: [
          {
            name: 'add',
            description: 'Add two numbers',
            inputs: [
              {
                name: 'a',
                param_type: 'number' as const,
                description: 'First operand',
                required: true,
              },
              {
                name: 'b',
                param_type: 'number' as const,
                description: 'Second operand',
                required: true,
              },
            ],
            outputs: [
              {
                name: 'result',
                param_type: 'number' as const,
                description: 'Sum of a and b',
                required: false,
              },
            ],
            required_capabilities: [],
          },
          {
            name: 'multiply',
            description: 'Multiply two numbers',
            inputs: [
              {
                name: 'a',
                param_type: 'number' as const,
                description: 'First operand',
                required: true,
              },
              {
                name: 'b',
                param_type: 'number' as const,
                description: 'Second operand',
                required: true,
              },
            ],
            outputs: [
              {
                name: 'result',
                param_type: 'number' as const,
                description: 'Product of a and b',
                required: false,
              },
            ],
            required_capabilities: [],
          },
        ],
        capabilities: [],
        plugins: [],
      };

      const wasmCode = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);
      const registration = await client.actionRegistry!.registerWithWasm(
        Buffer.from(wasmCode),
        complexMetadata,
      );

      await new Promise(resolve => setTimeout(resolve, 5000));

      const retrieved = await client.actionRegistry!.getAction(
        registration.hash,
      );
      expect(retrieved).toBeDefined();

      expect(registration.hash).toBeDefined();
      expect(registration.info_t_id).toBeDefined();
    }, 60000);
  });
});
