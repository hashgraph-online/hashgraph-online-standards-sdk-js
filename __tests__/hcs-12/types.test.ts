/**
 * HCS-12 Type Definition Tests
 *
 * These tests ensure all HCS-12 types are properly defined
 * and comply with the standard specification.
 */

import { describe, it, expect } from '@jest/globals';
import type {
  WasmInterface,
  ModuleInfo,
  ActionDefinition,
  ParameterDefinition,
  ValidationRule,
  BlockDefinition,
  BlockIcon,
  AttributeDefinition,
  BlockSupports,
  GutenbergBlockType,
  AssemblyDefinition,
  PluginDefinition,
  SourceStructure,
  SourceVerification,
  ActionRegistration,
  AssemblyRegistration,
  HashLinkReference,
  Capability,
  NetworkCapability,
  TransactionCapability,
  StorageCapability,
  ExternalApiCapability,
} from '../../src/hcs-12/types';

describe('HCS-12 Type Definitions', () => {
  describe('WasmInterface', () => {
    it('should define WasmInterface with correct methods', () => {
      const wasmInterface: WasmInterface = {
        INFO: () => '',
        POST: async (
          action: string,
          params: string,
          network: 'mainnet' | 'testnet',
          hashLinkMemo: string,
        ) => '',
        GET: async (
          action: string,
          params: string,
          network: 'mainnet' | 'testnet',
        ) => '',
      };

      expect(wasmInterface.INFO).toBeDefined();
      expect(wasmInterface.POST).toBeDefined();
      expect(wasmInterface.GET).toBeDefined();
    });
  });

  describe('ModuleInfo', () => {
    it('should define ModuleInfo with all required fields', () => {
      const moduleInfo: ModuleInfo = {
        name: 'Test Module',
        version: '1.0.0',
        hashlinks_version: '1.0.0',
        creator: 'Test Creator',
        purpose: 'Test Purpose',
        actions: [],
        capabilities: [],
        plugins: [],
      };

      expect(moduleInfo.name).toBeDefined();
      expect(moduleInfo.version).toBeDefined();
      expect(moduleInfo.hashlinks_version).toBeDefined();
      expect(moduleInfo.creator).toBeDefined();
      expect(moduleInfo.purpose).toBeDefined();
      expect(moduleInfo.actions).toBeDefined();
      expect(moduleInfo.capabilities).toBeDefined();
      expect(moduleInfo.plugins).toBeDefined();
    });
  });

  describe('ValidationRule', () => {
    it('should define ValidationRule matching Zod API', () => {
      const stringValidation: ValidationRule = {
        regex: '^[A-Z]+$',
        min: 1,
        max: 100,
        length: 10,
        email: true,
        url: true,
        uuid: true,
        startsWith: 'https://',
        endsWith: '.com',
        includes: 'test',
      };

      const numberValidation: ValidationRule = {
        gt: 0,
        gte: 1,
        lt: 100,
        lte: 99,
        int: true,
        positive: true,
        multipleOf: 5,
        finite: true,
        safe: true,
      };

      expect(stringValidation).toBeDefined();
      expect(numberValidation).toBeDefined();
    });
  });

  describe('BlockDefinition', () => {
    it('should define BlockDefinition compatible with Gutenberg', () => {
      const blockDef: BlockDefinition = {
        p: 'hcs-12',
        op: 'register',
        name: 'test-block',
        version: '1.0.0',
        data: {
          apiVersion: 3,
          name: 'hashlink/test-block',

          icon: 'star',
          description: 'Test block',
          keywords: ['test'],
          textdomain: 'hashlink',
          attributes: {},
          provides: {},
          usesContext: [],
          supports: {},
          actions: [],
          parent: [],
        },
      };

      expect(blockDef.p).toBe('hcs-12');
      expect(blockDef.op).toBe('register');
      expect(blockDef.data.apiVersion).toBe(3);
    });
  });

  describe('Registry Messages', () => {
    it('should define ActionRegistration with optional fields', () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'action-hash-123',
        registryId: '0.0.12345',
        wasm_hash: '0.0.12345',
        info_t_id: '0.0.456789',
        source_verification: {
          source_t_id: '0.0.789012',
          source_registryId: '0.0.12345',
          compiler_version: '1.75.0',
          cargo_version: '1.75.0',
          target: 'wasm32-unknown-unknown',
          profile: 'release',
          build_flags: ['--locked', '--features', 'hedera'],
          lockfile_registryId: '0.0.12345',
          source_structure: {
            format: 'tar.gz',
            root_manifest: './Cargo.toml',
            includes_lockfile: true,
            workspace_members: [],
          },
        },
        previous_version: '1.0.0',
        migration_notes: 'Added new features',
        m: 'Test registration',
      };

      expect(registration.p).toBe('hcs-12');
      expect(registration.source_verification).toBeDefined();
    });
  });

  describe('HCS-10 Integration Types', () => {
    it('should define HashLinkReference for HCS-10 integration', () => {
      const reference: HashLinkReference = {
        parseFromMessage: (data: string) => {
          const match = data.match(/hcs:\/\/15\/(\d+\.\d+\.\d+)/);
          return match ? match[0] : null;
        },
        formatHashLinkUrl: (assemblyId: string) => `hcs://15/${assemblyId}`,
      };

      expect(reference.parseFromMessage).toBeDefined();
      expect(reference.formatHashLinkUrl).toBeDefined();
      expect(reference.formatHashLinkUrl('0.0.123456')).toBe(
        'hcs://15/0.0.123456',
      );
    });
  });

  describe('Capability Types', () => {
    it('should define all capability types', () => {
      const networkCap: NetworkCapability = {
        networks: ['mainnet', 'testnet'],
        operations: ['query', 'submit'],
      };

      const transactionCap: TransactionCapability = {
        transaction_types: ['token_transfer', 'token_create'],
        max_fee_hbar: 10,
      };

      const storageCap: StorageCapability = {
        storage_types: ['hcs', 'ipfs'],
        max_size_bytes: 1024 * 1024,
      };

      const externalCap: ExternalApiCapability = {
        allowed_domains: ['api.example.com'],
        rate_limit: 100,
      };

      expect(networkCap.networks).toContain('mainnet');
      expect(transactionCap.transaction_types).toContain('token_transfer');
      expect(storageCap.storage_types).toContain('hcs');
      expect(externalCap.allowed_domains).toContain('api.example.com');
    });
  });
});
