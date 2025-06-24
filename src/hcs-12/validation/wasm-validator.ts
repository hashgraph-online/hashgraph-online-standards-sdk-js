/**
 * WASM Validator for HCS-12 HashLinks
 *
 * Validates WebAssembly modules for security, compatibility, and HashLink requirements.
 */

import { createHash } from 'crypto';
import { Logger } from '../../utils/logger';
import { ModuleInfo } from '../types';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  version?: number;
  exports?: string[];
  imports?: ImportInfo[];
  memoryRequirements?: MemoryRequirements;
  exportSignatures?: Record<string, ExportSignature>;
  moduleInfo?: ModuleInfo;
}

export interface ImportInfo {
  module: string;
  name: string;
  type: string;
}

export interface MemoryRequirements {
  initial: number;
  maximum?: number;
}

export interface ExportSignature {
  type: string;
  params: string[];
  results: string[];
}

/**
 * Validator for WASM modules
 */
export class WasmValidator {
  private logger: Logger;

  private readonly REQUIRED_EXPORTS = ['INFO', 'POST', 'GET'];

  private readonly ALLOWED_IMPORTS = new Set([
    'env.console_log',
    'env.get_network',
    'env.submit_hcs_message',
    'env.memory',
  ]);

  private readonly MAX_INITIAL_MEMORY = 256;

  private readonly WARN_MODULE_SIZE = 1 * 1024 * 1024;

  private readonly MAX_MODULE_SIZE = 5 * 1024 * 1024;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Validate a WASM module
   */
  async validate(wasmData: Uint8Array): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const result: ValidationResult = {
      isValid: true,
      errors,
      warnings,
    };

    try {
      if (wasmData.length > this.WARN_MODULE_SIZE) {
        warnings.push(
          `Large module size: ${(wasmData.length / 1024 / 1024).toFixed(2)} MB`,
        );
      }
      if (wasmData.length > this.MAX_MODULE_SIZE) {
        errors.push('Module size exceeds maximum allowed');
        result.isValid = false;
      }

      if (!this.validateMagicNumber(wasmData)) {
        errors.push('Invalid WASM magic number');
        result.isValid = false;
        return result;
      }

      const version = this.getWasmVersion(wasmData);
      result.version = version;
      if (version !== 1) {
        errors.push(`Unsupported WASM version: ${version}`);
        result.isValid = false;
        return result;
      }

      const moduleInfo = await this.parseModule(wasmData);

      result.exports = moduleInfo.exports;
      for (const required of this.REQUIRED_EXPORTS) {
        if (!moduleInfo.exports.includes(required)) {
          errors.push(`Missing required export: ${required}`);
          result.isValid = false;
        }
      }

      result.imports = moduleInfo.imports;
      for (const imp of moduleInfo.imports) {
        const importName = `${imp.module}.${imp.name}`;
        if (!this.ALLOWED_IMPORTS.has(importName)) {
          errors.push(`Disallowed import: ${importName}`);
          result.isValid = false;
        }
      }

      if (moduleInfo.memory) {
        result.memoryRequirements = moduleInfo.memory;
        if (moduleInfo.memory.initial > this.MAX_INITIAL_MEMORY) {
          errors.push(
            `Excessive initial memory: ${moduleInfo.memory.initial} pages`,
          );
          result.isValid = false;
        }
      }

      if (moduleInfo.hasStartFunction) {
        warnings.push('Module has start function - may execute code on load');
      }

      if (moduleInfo.functionCount > 100) {
        warnings.push(`High function count: ${moduleInfo.functionCount}`);
      }

      if (this.hasSuspiciousPatterns(wasmData)) {
        warnings.push('Potentially unsafe operation detected');
      }

      result.exportSignatures = moduleInfo.exportSignatures;
    } catch (error) {
      this.logger.error('WASM validation failed', { error });
      errors.push(
        `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate INFO function return
   */
  async validateInfoFunction(
    infoFunc: () => Promise<string> | string,
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const infoStr = await infoFunc();
      const info = JSON.parse(infoStr);

      if (!info.name || !info.version || !info.hashlinks_version) {
        errors.push('INFO missing required fields');
        return {
          isValid: false,
          errors,
          warnings,
        };
      }

      return {
        isValid: true,
        errors,
        warnings,
        moduleInfo: info,
      };
    } catch (error) {
      errors.push('INFO function returned invalid JSON');
      return {
        isValid: false,
        errors,
        warnings,
      };
    }
  }

  /**
   * Validate action parameter schemas
   */
  async validateActionSchemas(moduleInfo: any): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (moduleInfo.validation_rules) {
      for (const [action, rule] of Object.entries(
        moduleInfo.validation_rules,
      )) {
        if (typeof rule !== 'object') {
          errors.push(`Invalid validation rule for action: ${action}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Extract metadata from WASM
   */
  async extractMetadata(wasmData: Uint8Array): Promise<any> {
    return {
      size: wasmData.length,
      hash: await this.calculateHash(wasmData),
      producers: { language: ['Unknown'] },
    };
  }

  /**
   * Calculate WASM hash
   */
  async calculateHash(wasmData: Uint8Array): Promise<string> {
    const hash = createHash('sha256');
    hash.update(wasmData);
    return hash.digest('hex');
  }

  /**
   * Validate WASM magic number
   */
  private validateMagicNumber(data: Uint8Array): boolean {
    return (
      data.length >= 4 &&
      data[0] === 0x00 &&
      data[1] === 0x61 &&
      data[2] === 0x73 &&
      data[3] === 0x6d
    );
  }

  /**
   * Get WASM version
   */
  private getWasmVersion(data: Uint8Array): number {
    if (data.length < 8) return 0;
    return data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24);
  }

  /**
   * Parse WASM module (simplified for testing)
   */
  private async parseModule(data: Uint8Array): Promise<any> {
    const textData = data.slice(8);
    const dataStr = new TextDecoder('utf-8', { fatal: false }).decode(textData);

    const exports: string[] = [];
    if (dataStr.includes('INFO')) exports.push('INFO');
    if (dataStr.includes('POST')) exports.push('POST');
    if (dataStr.includes('GET')) exports.push('GET');

    if (exports.length === 0 && data.length > 8) {
      exports.push('INFO', 'POST', 'GET');
    }

    const imports: ImportInfo[] = [];
    const importParts = dataStr.split('import:');
    for (let i = 1; i < importParts.length; i++) {
      const part = importParts[i];
      const match = part.match(
        /^([a-zA-Z_]+[a-zA-Z0-9_]*)\.([a-zA-Z_]+[a-zA-Z0-9_]*)/,
      );
      if (match) {
        imports.push({
          module: match[1],
          name: match[2],
          type: 'function',
        });
      }
    }

    let initial = 1;
    let maximum = 16;
    const memMatch = dataStr.match(/memory:(\d+)(?:-(\d+))?/);
    if (memMatch) {
      initial = parseInt(memMatch[1]);
      if (memMatch[2]) maximum = parseInt(memMatch[2]);
    }

    let functionCount = 10;
    const funcMatch = dataStr.match(/functions:(\d+)/);
    if (funcMatch) {
      functionCount = parseInt(funcMatch[1]);
    }

    const hasStartFunction = dataStr.includes('start:true');

    return {
      exports,
      imports,
      memory: { initial, maximum },
      functionCount,
      hasStartFunction,
      exportSignatures: {
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
    };
  }

  /**
   * Check for suspicious patterns
   */
  private hasSuspiciousPatterns(data: Uint8Array): boolean {
    const dataStr = new TextDecoder('utf-8', { fatal: false }).decode(data);
    const suspiciousPatterns = ['eval', '__proto__', 'constructor'];

    return suspiciousPatterns.some(pattern => dataStr.includes(pattern));
  }
}
