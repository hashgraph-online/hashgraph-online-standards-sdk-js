/**
 * Action Registry Tests
 *
 * Tests the registry functionality for HashLink WASM actions,
 * including registration, validation, and retrieval.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Logger } from '../../src/utils/logger';
import { ActionRegistry } from '../../src/hcs-12/registries/action-registry';
import { HCS12Client } from '../../src/hcs-12/sdk';
import type { NetworkType } from '../../src/utils/types';
import type { ActionRegistration, RegistryType } from '../../src/hcs-12/types';

describe('ActionRegistry', () => {
  let logger: Logger;
  let client: HCS12Client;
  let registry: ActionRegistry;
  const testTopicId = '0.0.999999';

  beforeEach(() => {
    logger = new Logger({ module: 'test' });

    client = new HCS12Client({
      network: 'testnet' as NetworkType,
      operatorId: process.env.HEDERA_ACCOUNT_ID || '0.0.123456',
      operatorPrivateKey:
        process.env.HEDERA_PRIVATE_KEY ||
        '302e020100300506032b657004220420d45e1557156908c967804615ed29f7b4bdf5bb1e0fefdc11661fb8f8c5034bc0',
      logger,
    });

    client.initializeRegistries();
    registry = client.actionRegistry!;
  });

  describe('Action Registration', () => {
    it('should register a valid action', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        m: 'Test action registration',
      };

      const id = await registry.register(registration);
      expect(id).toMatch(/^\d+$/);

      const retrieved = await registry.getEntry(id);
      expect(retrieved?.data).toEqual(registration);
    });

    it('should register action with source verification', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        source_verification: {
          source_t_id: '0.0.789012',
          source_hash:
            'f1f1f1f1e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          compiler_version: '1.75.0',
          cargo_version: '1.75.0',
          target: 'wasm32-unknown-unknown',
          profile: 'release',
          build_flags: ['--locked', '--features', 'hedera'],
          lockfile_hash:
            'c3c3c3c3e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          source_structure: {
            format: 'tar.gz',
            root_manifest: './Cargo.toml',
            includes_lockfile: true,
            workspace_members: [],
          },
        },
      };

      const id = await registry.register(registration);
      expect(id).toBeDefined();

      const retrieved = await registry.getEntry(id);
      expect(
        (retrieved?.data as ActionRegistration)?.source_verification,
      ).toEqual(registration.source_verification);
    });

    it('should register action with version migration', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        previous_version: '1.0.0',
        migration_notes: 'Added support for new input types',
        m: 'Version 2.0.0',
      };

      const id = await registry.register(registration);
      expect(id).toBeDefined();

      const retrieved = await registry.getEntry(id);
      const data = retrieved?.data as ActionRegistration;
      expect(data?.previous_version).toBe('1.0.0');
      expect(data?.migration_notes).toBe('Added support for new input types');
    });

    it('should register action with JavaScript wrapper', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        js_t_id: '0.0.123457',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        js_hash:
          'd4d4d4d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        interface_version: '0.2.92',
        m: 'Action with JS wrapper for WASM stability',
      };

      const id = await registry.register(registration);
      expect(id).toBeDefined();

      const retrieved = await registry.getEntry(id);
      const data = retrieved?.data as ActionRegistration;
      expect(data?.js_t_id).toBe('0.0.123457');
      expect(data?.js_hash).toBe(
        'd4d4d4d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      );
      expect(data?.interface_version).toBe('0.2.92');
    });

    it('should reject invalid protocol identifier', async () => {
      const registration: ActionRegistration = {
        p: 'invalid' as any,
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('should reject invalid operation', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'invalid' as any,
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('should reject invalid HCS-1 topic ID', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: 'invalid-topic',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('should reject invalid hash formats', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'invalid-hash',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('should reject invalid source verification', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        source_verification: {
          source_t_id: 'invalid',
          source_hash:
            'f1f1f1f1e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          compiler_version: '1.75.0',
          cargo_version: '1.75.0',
          target: 'wasm32-unknown-unknown',
          profile: 'release',
          build_flags: [],
          lockfile_hash:
            'c3c3c3c3e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          source_structure: {
            format: 'tar.gz',
            root_manifest: './Cargo.toml',
            includes_lockfile: true,
          },
        },
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('should reject invalid JavaScript topic ID', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        js_t_id: 'invalid-js-topic',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('should reject invalid JavaScript hash', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        js_t_id: '0.0.123457',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        js_hash: 'invalid-hash-format',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('should reject invalid interface version', async () => {
      const registration: ActionRegistration = {
        p: 'hcs-12',
        op: 'register',
        t_id: '0.0.123456',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        wasm_hash:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        interface_version: 'invalid-version',
      };

      await expect(registry.register(registration)).rejects.toThrow(
        /Validation failed/,
      );
    });
  });

  describe('Action Retrieval', () => {
    const sampleRegistration: ActionRegistration = {
      p: 'hcs-12',
      op: 'register',
      t_id: '0.0.123456',
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      wasm_hash:
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      info_t_id: '0.0.654321',
      m: 'Test action',
    };
    let registrationId: string;

    beforeEach(async () => {
      registrationId = await registry.register(sampleRegistration);
    });

    it('should retrieve action entry', async () => {
      const entry = await registry.getEntry(registrationId);
      expect(entry?.data).toEqual(sampleRegistration);
    });

    it('should return null for non-existent entry', async () => {
      const entry = await registry.getEntry('0.0.nonexistent');
      expect(entry).toBeNull();
    });

    it('should list all entries', async () => {
      const entries = await registry.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].data).toEqual(sampleRegistration);
    });

    it('should filter entries by submitter', async () => {
      const entries = await registry.listEntries({ submitter: 'local' });
      expect(entries).toHaveLength(1);

      const noEntries = await registry.listEntries({ submitter: '0.0.999999' });
      expect(noEntries).toHaveLength(0);
    });
  });

  describe('Registry Configuration', () => {
    it('should return correct registry configuration', () => {
      const config = registry.getConfig();

      expect(config).toEqual({
        type: 0,
        indexed: false,
        ttl: 60,
        topicId: undefined,
        memo: 'hcs-12:1:60:0',
      });
    });
  });
});
