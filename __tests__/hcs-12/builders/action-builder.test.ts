/**
 * Tests for ActionBuilder utility
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ActionBuilder } from '../../../src/hcs-12/builders/action-builder';
import { Logger } from '../../../src/utils/logger';
import type { NetworkType } from '../../../src/utils/types';
import { ValidationRule } from '../../../src/hcs-12/types';

describe('ActionBuilder', () => {
  let builder: ActionBuilder;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'ActionBuilderTest' });
    jest.spyOn(logger, 'info').mockImplementation();
    jest.spyOn(logger, 'warn').mockImplementation();

    builder = new ActionBuilder(logger);
  });

  describe('Basic Action Building', () => {
    it('should create a minimal action registration', () => {
      const registration = builder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .setWasmHash(
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        )
        .build();

      expect(registration).toEqual({
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      });
    });

    it('should add validation rules', () => {
      const validationRule: ValidationRule = {
        type: 'object',
        properties: {
          amount: { type: 'number', minimum: 0 },
          recipient: { type: 'string', pattern: '^0\\.0\\.\\d+$' },
        },
        required: ['amount', 'recipient'],
      };

      const registration = builder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .setWasmHash(
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        )
        .addValidationRule('transfer', validationRule)
        .build();

      expect(registration.validation_rules).toBeDefined();
      expect(registration.validation_rules!['transfer']).toEqual(
        validationRule,
      );
    });

    it('should add source verification', () => {
      const registration = builder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .setWasmHash(
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        )
        .setSourceVerification({
          source_t_id: '0.0.789012',
          source_hash:
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          compiler_version: 'rustc 1.70.0',
          cargo_version: 'cargo 1.70.0',
          target: 'wasm32-unknown-unknown',
          source_structure: {
            format: 'git',
            main_file: 'src/lib.rs',
          },
        })
        .build();

      expect(registration.source_verification).toBeDefined();
      expect(registration.source_verification!.compiler_version).toBe(
        'rustc 1.70.0',
      );
    });
  });

  describe('Fluent API', () => {
    it('should support method chaining', () => {
      const result = builder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .setWasmHash(
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        )
        .setInfoTopicId('0.0.234567')
        .addValidationRule('action1', { type: 'object' })
        .addValidationRule('action2', { type: 'string' });

      expect(result).toBe(builder);
    });

    it('should allow building multiple registrations', () => {
      builder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .setWasmHash(
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        );

      const reg1 = builder.build();

      const reg2 = builder
        .reset()
        .setTopicId('0.0.999999')
        .setHash(
          'b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6b7b8b9b0b1b2',
        )
        .setWasmHash(
          'c1c2c3c4c5c6c7c8c9c0c1c2c3c4c5c6c7c8c9c0c1c2c3c4c5c6c7c8c9c0c1c2',
        )
        .build();

      expect(reg1.t_id).toBe('0.0.123456');
      expect(reg2.t_id).toBe('0.0.999999');
      expect(reg1.hash).not.toBe(reg2.hash);
    });
  });

  describe('Validation', () => {
    it('should validate required fields', () => {
      expect(() => builder.build()).toThrow('Topic ID is required');

      builder.setTopicId('0.0.123456');
      expect(() => builder.build()).toThrow('INFO hash is required');

      builder.setHash(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
      expect(() => builder.build()).toThrow('WASM hash is required');
    });

    it('should validate topic ID format', () => {
      expect(() => builder.setTopicId('invalid')).toThrow(
        'Invalid topic ID format',
      );

      expect(() => builder.setTopicId('0.0.123456')).not.toThrow();
    });

    it('should validate hash formats', () => {
      builder.setTopicId('0.0.123456');

      expect(() => builder.setHash('invalid-hash')).toThrow(
        'Invalid hash format',
      );

      expect(() => builder.setWasmHash('short')).toThrow('Invalid hash format');
    });

    it('should validate source verification', () => {
      builder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .setWasmHash(
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        );

      expect(() =>
        builder.setSourceVerification({
          source_t_id: 'invalid',
          source_hash:
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          compiler_version: 'rustc 1.70.0',
          cargo_version: 'cargo 1.70.0',
          target: 'wasm32-unknown-unknown',
          source_structure: { format: 'git' },
        }),
      ).toThrow('Invalid source topic ID');
    });
  });

  describe('Hash Generation', () => {
    it('should generate hash from WASM data', async () => {
      const wasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
      const hash = await builder.generateWasmHash(wasmData);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate hash from INFO object', async () => {
      const info = {
        name: 'test-action',
        version: '1.0.0',
        hashlinks_version: '1.0.0',
        creator: '0.0.123456',
        purpose: 'Test action',
        actions: ['test1', 'test2'],
      };

      const hash = await builder.generateInfoHash(info);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Helper Methods', () => {
    it('should create action from WASM and INFO', async () => {
      const wasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
      const info = {
        name: 'test-action',
        version: '1.0.0',
        hashlinks_version: '1.0.0',
      };

      const registration = await builder.createFromWasmAndInfo(
        '0.0.123456',
        wasmData,
        info,
      );

      expect(registration.t_id).toBe('0.0.123456');
      expect(registration.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(registration.wasm_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should validate action registration completeness', () => {
      const incomplete = builder
        .setTopicId('0.0.123456')
        .setHash(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        .build({ validate: false });

      expect(builder.isComplete(incomplete)).toBe(false);

      const complete = {
        ...incomplete,
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      };

      expect(builder.isComplete(complete)).toBe(true);
    });
  });
});
