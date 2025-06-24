/**
 * Tests for WASM validation
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { WasmValidator } from '../../../src/hcs-12/validation/wasm-validator';
import { Logger } from '../../../src/utils/logger';

describe('WasmValidator', () => {
  let validator: WasmValidator;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ module: 'WasmValidatorTest' });
    jest.spyOn(logger, 'info').mockImplementation();
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.spyOn(logger, 'error').mockImplementation();

    validator = new WasmValidator(logger);
  });

  describe('Basic Validation', () => {
    it('should validate WASM magic number', async () => {
      const validWasm = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,

        0x00, 0x00, 0x00, 0x00,
      ]);
      const result = await validator.validate(validWasm);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid magic number', async () => {
      const invalidWasm = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const result = await validator.validate(invalidWasm);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid WASM magic number');
    });

    it('should validate WASM version', async () => {
      const wasm = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);
      const result = await validator.validate(wasm);

      expect(result.version).toBe(1);
    });

    it('should reject unsupported WASM version', async () => {
      const wasm = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00,
      ]);
      const result = await validator.validate(wasm);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unsupported WASM version: 2');
    });
  });

  describe('Export Validation', () => {
    it('should validate required HashLink exports', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
      });

      const result = await validator.validate(mockWasm);

      expect(result.isValid).toBe(true);
      expect(result.exports).toContain('INFO');
      expect(result.exports).toContain('POST');
      expect(result.exports).toContain('GET');
    });

    it('should reject WASM missing required exports', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO'],
      });

      const result = await validator.validate(mockWasm);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required export: POST');
      expect(result.errors).toContain('Missing required export: GET');
    });

    it('should validate export signatures', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        exportTypes: {
          INFO: { type: 'function', params: [], results: ['i32'] },
          POST: {
            type: 'function',
            params: ['i32', 'i32', 'i32', 'i32'],
            results: ['i32'],
          },
          GET: {
            type: 'function',
            params: ['i32', 'i32', 'i32'],
            results: ['i32'],
          },
        },
      });

      const result = await validator.validate(mockWasm);

      expect(result.isValid).toBe(true);
      expect(result.exportSignatures).toBeDefined();
    });
  });

  describe('Import Validation', () => {
    it('should validate allowed imports', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        imports: [
          { module: 'env', name: 'console_log', type: 'function' },
          { module: 'env', name: 'get_network', type: 'function' },
        ],
      });

      const result = await validator.validate(mockWasm);

      expect(result.isValid).toBe(true);
      expect(result.imports).toHaveLength(2);
    });

    it('should reject disallowed imports', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        imports: [
          { module: 'env', name: 'fs_read', type: 'function' },
          {
            module: 'wasi_snapshot_preview1',
            name: 'fd_write',
            type: 'function',
          },
        ],
      });

      const result = await validator.validate(mockWasm);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Disallowed import: env.fs_read');
      expect(result.errors).toContain(
        'Disallowed import: wasi_snapshot_preview1.fd_write',
      );
    });
  });

  describe('Memory Validation', () => {
    it('should validate memory limits', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        memory: {
          initial: 1,
          maximum: 16,
        },
      });

      const result = await validator.validate(mockWasm);

      expect(result.isValid).toBe(true);
      expect(result.memoryRequirements).toEqual({
        initial: 1,
        maximum: 16,
      });
    });

    it('should reject excessive memory requirements', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        memory: {
          initial: 1000,
        },
      });

      const result = await validator.validate(mockWasm);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Excessive initial memory: 1000 pages');
    });
  });

  describe('Security Validation', () => {
    it('should detect potentially unsafe operations', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        customSections: [{ name: 'name', data: 'eval' }],
      });

      const result = await validator.validate(mockWasm);

      expect(result.warnings).toContain(
        'Potentially unsafe operation detected',
      );
    });

    it('should validate start function', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        hasStartFunction: true,
      });

      const result = await validator.validate(mockWasm);

      expect(result.warnings).toContain(
        'Module has start function - may execute code on load',
      );
    });
  });

  describe('Performance Validation', () => {
    it('should check module size', async () => {
      const largeOptions = {
        exports: ['INFO', 'POST', 'GET'],
      };

      const baseMock = createMockWasm(largeOptions);

      const largeWasm = new Uint8Array(1024 * 1024 * 2);
      largeWasm.set(baseMock, 0);

      const result = await validator.validate(largeWasm);

      expect(result.warnings).toContain('Large module size: 2.00 MB');
    });

    it('should validate function count', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        functionCount: 500,
      });

      const result = await validator.validate(mockWasm);

      expect(result.warnings).toContain('High function count: 500');
    });
  });

  describe('HashLink Specific Validation', () => {
    it('should validate INFO return type', async () => {
      const result = await validator.validateInfoFunction(async () => {
        return JSON.stringify({
          name: 'test-action',
          version: '1.0.0',
          hashlinks_version: '1.0.0',
        });
      });

      expect(result.isValid).toBe(true);
      expect(result.moduleInfo).toBeDefined();
      expect(result.moduleInfo.name).toBe('test-action');
    });

    it('should reject invalid INFO return', async () => {
      const result = await validator.validateInfoFunction(async () => {
        return 'not json';
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('INFO function returned invalid JSON');
    });

    it('should validate action parameter schemas', async () => {
      const mockInfo = {
        name: 'test-action',
        version: '1.0.0',
        hashlinks_version: '1.0.0',
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
      };

      const result = await validator.validateActionSchemas(mockInfo);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Helper Methods', () => {
    it('should extract WASM metadata', async () => {
      const mockWasm = createMockWasm({
        exports: ['INFO', 'POST', 'GET'],
        customSections: [
          { name: 'producers', data: JSON.stringify({ language: ['Rust'] }) },
        ],
      });

      const metadata = await validator.extractMetadata(mockWasm);

      expect(metadata).toBeDefined();
      expect(metadata.producers).toBeDefined();
    });

    it('should calculate WASM hash', async () => {
      const wasm = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      ]);
      const hash = await validator.calculateHash(wasm);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});

function createMockWasm(options: any = {}): Uint8Array {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  let content = '';

  if (options.exports) {
    content += options.exports.join('');
  }

  if (options.imports) {
    for (const imp of options.imports) {
      content += `import:${imp.module}.${imp.name}`;
    }
  }

  if (options.memory) {
    content += `memory:${options.memory.initial}`;
    if (options.memory.maximum) {
      content += `-${options.memory.maximum}`;
    }
  }

  if (options.functionCount) {
    content += `functions:${options.functionCount}`;
  }

  if (options.hasStartFunction) {
    content += 'start:true';
  }

  if (options.customSections) {
    for (const section of options.customSections) {
      content += section.data;
    }
  }

  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);

  const result = new Uint8Array(bytes.length + contentBytes.length);
  result.set(bytes, 0);
  result.set(contentBytes, bytes.length);

  return result;
}
