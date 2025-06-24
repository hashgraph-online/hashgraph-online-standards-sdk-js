/**
 * HCS-2 Integration Tests
 *
 * These tests run against testnet with real transactions.
 * No mocking - tests the actual HCS-2 implementation end-to-end.
 */

import { PrivateKey, TopicCreateTransaction } from '@hashgraph/sdk';
import { HCS2Client } from '../src/hcs-2/client';
import { HCS2RegistryType, HCS2Operation } from '../src/hcs-2/types';
import * as dotenv from 'dotenv';

dotenv.config();

describe('HCS-2 Integration Tests', () => {
  let client: HCS2Client;
  let operatorId: string;
  let indexedRegistryTopicId: string;
  let nonIndexedRegistryTopicId: string;
  let targetTopicId: string;

  // TTL values to use in tests
  const INDEXED_TTL = 86400; // 24 hours for indexed topics
  const NON_INDEXED_TTL = 3600; // 1 hour for non-indexed topics

  beforeAll(() => {
    operatorId = process.env.HEDERA_ACCOUNT_ID!;
    const operatorKey = process.env.HEDERA_PRIVATE_KEY!;

    if (!operatorId || !operatorKey) {
      throw new Error(
        'Please set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in .env file',
      );
    }

    client = new HCS2Client({
      operatorId,
      operatorKey,
      network: 'testnet',
    });
  });

  describe('Registry Creation', () => {
    it('should create an indexed registry topic with correct memo format', async () => {
      const result = await client.createRegistry({
        registryType: HCS2RegistryType.INDEXED,
        ttl: INDEXED_TTL,
        memo: 'Integration test indexed registry',
        adminKey: true,
        submitKey: true,
      });

      expect(result.success).toBe(true);
      expect(result.topicId).toBeDefined();
      expect(result.transactionId).toBeDefined();

      indexedRegistryTopicId = result.topicId!;
      console.log(`Created indexed registry topic: ${indexedRegistryTopicId}`);

      // Verify the memo format is correct (hcs-2:0:86400)
      const topicInfo = await (client as any).getTopicInfo(
        indexedRegistryTopicId,
      );
      expect(topicInfo.memo).toContain(
        `hcs-2:${HCS2RegistryType.INDEXED}:${INDEXED_TTL}`,
      );
    }, 30000);

    it('should create a non-indexed registry topic with correct memo format', async () => {
      const result = await client.createRegistry({
        registryType: HCS2RegistryType.NON_INDEXED,
        ttl: NON_INDEXED_TTL,
        memo: 'Integration test non-indexed registry',
      });

      expect(result.success).toBe(true);
      expect(result.topicId).toBeDefined();
      expect(result.transactionId).toBeDefined();

      nonIndexedRegistryTopicId = result.topicId!;
      console.log(
        `Created non-indexed registry topic: ${nonIndexedRegistryTopicId}`,
      );

      // Verify the memo format is correct (hcs-2:1:3600)
      const topicInfo = await (client as any).getTopicInfo(
        nonIndexedRegistryTopicId,
      );
      expect(topicInfo.memo).toContain(
        `hcs-2:${HCS2RegistryType.NON_INDEXED}:${NON_INDEXED_TTL}`,
      );
    }, 30000);

    it('should create a registry with a custom admin and submit key', async () => {
      const customKey = PrivateKey.generateED25519();

      const result = await client.createRegistry({
        registryType: HCS2RegistryType.INDEXED,
        memo: 'Integration test custom key registry',
        adminKey: customKey,
        submitKey: customKey,
      });

      expect(result.success).toBe(true);
      expect(result.topicId).toBeDefined();
      const customTopicId = result.topicId!;
      console.log(`Created registry with custom key: ${customTopicId}`);

      await new Promise(resolve => setTimeout(resolve, 8000));
      const topicInfo = await client.getTopicInfo(customTopicId);

      console.log('Topic info:', topicInfo);
      expect(topicInfo.admin_key).toBeDefined();
      expect(topicInfo.submit_key).toBeDefined();
    }, 30000);

    it('should create a target topic for testing', async () => {
      const result = await client.createRegistry({
        memo: 'Integration test target topic',
      });

      expect(result.success).toBe(true);
      expect(result.topicId).toBeDefined();

      targetTopicId = result.topicId!;
      console.log(`Created target topic: ${targetTopicId}`);
    }, 30000);
  });

  describe('Registry Operations - Indexed', () => {
    let entryUid: number;
    let updatedMetadataTopicId: string;

    beforeAll(async () => {
      const result = await client.createRegistry({
        memo: 'Integration test updated metadata topic',
      });
      updatedMetadataTopicId = result.topicId!;
      console.log(`Created updated metadata topic: ${updatedMetadataTopicId}`);
    }, 30000);

    it('should register an entry in the indexed registry with proper message format', async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const metadata = `hcs://${HCS2RegistryType.NON_INDEXED}/${targetTopicId}`;
      const memo = 'First test entry';

      const result = await client.registerEntry(indexedRegistryTopicId, {
        targetTopicId,
        metadata,
        memo,
      });

      expect(result.success).toBe(true);
      expect(result.receipt).toBeDefined();

      entryUid = result.sequenceNumber!;
      console.log(`Registered entry with UID: ${entryUid}`);

      // Wait longer for network propagation before querying
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Verify the message structure in the registry
      const registry = await client.getRegistry(indexedRegistryTopicId);
      console.log(
        'Registry after register:',
        JSON.stringify(registry, null, 2),
      );

      // First try finding by sequence number
      let entry = registry.entries.find(e => e.sequence === entryUid);

      // If not found, try finding by message content as a fallback
      if (!entry) {
        console.log('Entry not found by sequence, trying by content...');
        entry = registry.entries.find(
          e =>
            e.message.op === HCS2Operation.REGISTER &&
            e.message.t_id === targetTopicId &&
            e.message.metadata === metadata,
        );
      }

      expect(entry).toBeDefined();
      if (entry) {
        expect(entry.message.p).toBe('hcs-2');
        expect(entry.message.op).toBe(HCS2Operation.REGISTER);
        expect(entry.message.t_id).toBe(targetTopicId);
        expect(entry.message.metadata).toBe(metadata);
        expect(entry.message.m).toBe(memo);
        expect(entry.message.uid).toBeUndefined();
      } else {
        console.error('Failed to find registered entry in registry entries.');
      }
    }, 40000);

    it('should update an entry in the indexed registry with proper message format', async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const metadata = `hcs://${HCS2RegistryType.NON_INDEXED}/${updatedMetadataTopicId}`;
      const memo = 'Updated test entry';

      const result = await client.updateEntry(indexedRegistryTopicId, {
        uid: entryUid.toString(),
        targetTopicId,
        metadata,
        memo,
      });

      expect(result.success).toBe(true);
      console.log(`Updated entry with UID: ${entryUid}`);

      // Wait longer for network propagation before querying
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Verify the message structure in the registry
      const registry = await client.getRegistry(indexedRegistryTopicId);
      console.log('Registry after update:', JSON.stringify(registry, null, 2));

      // Get the update message, first by sequence if possible, then by content
      let entry = registry.entries.find(
        e =>
          e.message.op === HCS2Operation.UPDATE &&
          e.message.uid === entryUid.toString(),
      );

      // If not found, log for debugging
      if (!entry) {
        console.log(
          'Update entry not found, checking all entries for content match...',
        );
        entry = registry.entries.find(
          e =>
            e.message.op === HCS2Operation.UPDATE &&
            e.message.t_id === targetTopicId &&
            e.message.metadata === metadata,
        );
      }

      expect(entry).toBeDefined();
      if (entry) {
        expect(entry.message.p).toBe('hcs-2');
        expect(entry.message.op).toBe(HCS2Operation.UPDATE);
        expect(entry.message.t_id).toBe(targetTopicId);
        expect(entry.message.uid).toBe(entryUid.toString());
        expect(entry.message.metadata).toBe(metadata);
        expect(entry.message.m).toBe(memo);
      } else {
        console.error('Failed to find updated entry in registry entries.');
      }
    }, 40000);

    it('should query the indexed registry and find the updated entry', async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const registry = await client.getRegistry(indexedRegistryTopicId);
      expect(registry.registryType).toBe(HCS2RegistryType.INDEXED);
      expect(registry.entries.length).toBeGreaterThan(0);
      expect(registry.ttl).toBe(INDEXED_TTL);

      const updateEntry = registry.entries.find(
        e =>
          e.message.op === HCS2Operation.UPDATE &&
          e.message.uid === entryUid.toString(),
      );
      expect(updateEntry).toBeDefined();
      expect(updateEntry!.message.metadata).toBe(
        `hcs://${HCS2RegistryType.NON_INDEXED}/${updatedMetadataTopicId}`,
      );
      expect(updateEntry!.message.m).toBe('Updated test entry');
    }, 30000);

    it('should delete an entry from the indexed registry with proper message format', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const memo = 'Deleting test entry';

      const result = await client.deleteEntry(indexedRegistryTopicId, {
        uid: entryUid.toString(),
        memo,
      });

      expect(result.success).toBe(true);
      console.log(`Deleted entry with UID: ${entryUid}`);

      // Wait for network propagation
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify the message structure in the registry
      const registry = await client.getRegistry(indexedRegistryTopicId);
      const deleteEntry = registry.entries.find(
        e =>
          e.message.op === HCS2Operation.DELETE &&
          e.message.uid === entryUid.toString(),
      );

      expect(deleteEntry).toBeDefined();
      expect(deleteEntry!.message.p).toBe('hcs-2');
      expect(deleteEntry!.message.op).toBe(HCS2Operation.DELETE);
      expect(deleteEntry!.message.uid).toBe(entryUid.toString());
      expect(deleteEntry!.message.m).toBe(memo);
      expect(deleteEntry!.message.t_id).toBeUndefined();
    }, 30000);
  });

  describe('Registry Operations - Non-indexed', () => {
    let updatedMetadataTopicId: string;

    beforeAll(async () => {
      const result = await client.createRegistry({
        memo: 'Integration test updated metadata topic for non-indexed',
      });
      updatedMetadataTopicId = result.topicId!;
      console.log(
        `Created updated metadata topic for non-indexed: ${updatedMetadataTopicId}`,
      );
    }, 30000);

    it('should register an entry in the non-indexed registry', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const result = await client.registerEntry(nonIndexedRegistryTopicId, {
        targetTopicId,
        metadata: `hcs://${HCS2RegistryType.NON_INDEXED}/${targetTopicId}`,
        memo: 'Non-indexed test entry',
      });

      expect(result.success).toBe(true);
      console.log(
        `Registered non-indexed entry with sequence: ${result.sequenceNumber}`,
      );
    }, 30000);

    it('should register a second entry and only see that one when querying (non-indexed behavior)', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const metadata = `hcs://${HCS2RegistryType.NON_INDEXED}/${updatedMetadataTopicId}`;
      const memo = 'Latest non-indexed entry';

      const result = await client.registerEntry(nonIndexedRegistryTopicId, {
        targetTopicId,
        metadata,
        memo,
      });

      expect(result.success).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 5000));

      const registry = await client.getRegistry(nonIndexedRegistryTopicId);

      expect(registry.registryType).toBe(HCS2RegistryType.NON_INDEXED);
      expect(registry.ttl).toBe(NON_INDEXED_TTL);
      expect(registry.entries.length).toBe(1);
      expect(registry.entries[0].message.metadata).toBe(metadata);
      expect(registry.entries[0].message.m).toBe(memo);
    }, 30000);

    it('should verify that update operations are not allowed on non-indexed registries', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      await expect(
        client.updateEntry(nonIndexedRegistryTopicId, {
          uid: '1',
          targetTopicId,
          metadata: `hcs://${HCS2RegistryType.NON_INDEXED}/${targetTopicId}`,
        }),
      ).rejects.toThrow(/only valid for indexed registries/);
    }, 30000);

    it('should verify that delete operations are not allowed on non-indexed registries', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      await expect(
        client.deleteEntry(nonIndexedRegistryTopicId, {
          uid: '1', // Any UID
        }),
      ).rejects.toThrow(/only valid for indexed registries/);
    }, 30000);
  });

  describe('Registry Migration', () => {
    let newTopicId: string;

    it('should create a new topic for migration', async () => {
      const result = await client.createRegistry({
        registryType: HCS2RegistryType.INDEXED,
        ttl: INDEXED_TTL,
        memo: 'Migration target topic',
      });

      expect(result.success).toBe(true);
      expect(result.topicId).toBeDefined();

      newTopicId = result.topicId!;
      console.log(`Created migration target topic: ${newTopicId}`);
    }, 30000);

    it('should migrate a registry to a new topic with proper message format', async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const metadata = `hcs://${HCS2RegistryType.NON_INDEXED}/${targetTopicId}`;
      const memo = 'Migrating to new topic';

      const result = await client.migrateRegistry(indexedRegistryTopicId, {
        targetTopicId: newTopicId,
        metadata,
        memo,
      });

      expect(result.success).toBe(true);
      console.log(`Migrated registry to new topic: ${newTopicId}`);

      // Wait for network propagation
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify the message structure in the registry
      const registry = await client.getRegistry(indexedRegistryTopicId);
      const migrateOp = registry.entries.find(
        e =>
          e.message.op === HCS2Operation.MIGRATE &&
          e.message.t_id === newTopicId,
      );

      expect(migrateOp).toBeDefined();
      expect(migrateOp!.message.p).toBe('hcs-2');
      expect(migrateOp!.message.op).toBe(HCS2Operation.MIGRATE);
      expect(migrateOp!.message.t_id).toBe(newTopicId);
      expect(migrateOp!.message.metadata).toBe(metadata);
      expect(migrateOp!.message.m).toBe(memo);
      expect(migrateOp!.message.uid).toBeUndefined();
    }, 30000);
  });

  describe('Message Validation', () => {
    it('should validate well-formed messages', async () => {
      const registerMessage = {
        p: 'hcs-2',
        op: HCS2Operation.REGISTER,
        t_id: '0.0.12345',
        metadata: `hcs://1/0.0.12345`,
        m: 'Test memo',
      };
      const validRegisterResult = (client as any).validateMessage(
        registerMessage,
      );
      expect(validRegisterResult.valid).toBe(true);

      // Valid update message
      const updateMessage = {
        p: 'hcs-2',
        op: HCS2Operation.UPDATE,
        uid: '123',
        t_id: '0.0.12345',
        metadata: `hcs://1/0.0.12345`,
      };
      const validUpdateResult = (client as any).validateMessage(updateMessage);
      expect(validUpdateResult.valid).toBe(true);

      // Valid delete message
      const deleteMessage = {
        p: 'hcs-2',
        op: HCS2Operation.DELETE,
        uid: '123',
      };
      const validDeleteResult = (client as any).validateMessage(deleteMessage);
      expect(validDeleteResult.valid).toBe(true);

      // Valid migrate message
      const migrateMessage = {
        p: 'hcs-2',
        op: HCS2Operation.MIGRATE,
        t_id: '0.0.12345',
      };
      const validMigrateResult = (client as any).validateMessage(
        migrateMessage,
      );
      expect(validMigrateResult.valid).toBe(true);
    });

    it('should reject malformed messages', async () => {
      const wrongProtocol = {
        p: 'wrong-protocol',
        op: HCS2Operation.REGISTER,
        t_id: '0.0.12345',
      };
      const wrongProtocolResult = (client as any).validateMessage(
        wrongProtocol,
      );
      expect(wrongProtocolResult.valid).toBe(false);
      expect(wrongProtocolResult.errors).toContain(
        'p: Invalid literal value, expected "hcs-2"',
      );

      // Missing t_id in register
      const missingTargetId = {
        p: 'hcs-2',
        op: HCS2Operation.REGISTER,
      };
      const missingTargetIdResult = (client as any).validateMessage(
        missingTargetId,
      );
      expect(missingTargetIdResult.valid).toBe(false);
      expect(missingTargetIdResult.errors).toContain(`t_id: Required`);

      // Missing uid in update
      const missingUid = {
        p: 'hcs-2',
        op: HCS2Operation.UPDATE,
        t_id: '0.0.12345',
      };
      const missingUidResult = (client as any).validateMessage(missingUid);
      expect(missingUidResult.valid).toBe(false);
      expect(missingUidResult.errors).toContain('uid: Required');

      // Memo too long (over 500 chars)
      const longMemo = {
        p: 'hcs-2',
        op: HCS2Operation.REGISTER,
        t_id: '0.0.12345',
        m: 'a'.repeat(501),
      };
      const longMemoResult = (client as any).validateMessage(longMemo);
      expect(longMemoResult.valid).toBe(false);
      expect(longMemoResult.errors).toContain(
        'm: Memo must not exceed 500 characters',
      );
    });

    it('should handle attempts to get registry info from non-HCS-2 topics', async () => {
      const hederaClient = (client as any).client;

      const receipt = await new TopicCreateTransaction()
        .setTopicMemo('Regular topic without HCS-2 format')
        .execute(hederaClient)
        .then(resp => resp.getReceipt(hederaClient));

      const regularTopicId = receipt.topicId!.toString();

      await new Promise(resolve => setTimeout(resolve, 3000));

      await expect(client.getRegistry(regularTopicId)).rejects.toThrow(
        /not an HCS-2 registry/,
      );
    }, 30000);
  });

  describe('Pagination', () => {
    let paginationTestTopicId: string;
    const totalEntries = 5;

    beforeAll(async () => {
      if (!targetTopicId) {
        const result = await client.createRegistry({
          memo: 'Pagination test target topic',
        });
        targetTopicId = result.topicId!;
        console.log(`Created target topic for pagination: ${targetTopicId}`);
      }

      const result = await client.createRegistry({
        registryType: HCS2RegistryType.INDEXED,
        memo: 'Pagination test registry',
      });
      paginationTestTopicId = result.topicId!;
      console.log(`Created pagination test topic: ${paginationTestTopicId}`);

      for (let i = 1; i <= totalEntries; i++) {
        await client.registerEntry(paginationTestTopicId, {
          targetTopicId: targetTopicId,
          metadata: `Entry ${i}`,
          memo: `Pagination test entry ${i}`,
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      await new Promise(resolve => setTimeout(resolve, 10000));
    }, 60000);

    it('should skip the first 2 entries and limit to 2', async () => {
      const registry = await client.getRegistry(paginationTestTopicId, {
        skip: 2,
        limit: 2,
        order: 'asc',
      });

      expect(registry.entries.length).toBe(2);
      expect(registry.entries[0].sequence).toBe(3);
      expect(registry.entries[1].sequence).toBe(4);
    }, 30000);

    it('should get the last page of results', async () => {
      const registry = await client.getRegistry(paginationTestTopicId, {
        skip: 4,
        limit: 2,
        order: 'asc',
      });

      expect(registry.entries.length).toBe(1);
      expect(registry.entries[0].sequence).toBe(5);
    }, 30000);

    it('should return 0 entries if skip is greater than total entries', async () => {
      const registry = await client.getRegistry(paginationTestTopicId, {
        skip: totalEntries,
        limit: 2,
        order: 'asc',
      });

      expect(registry.entries.length).toBe(0);
    }, 30000);
  });

  describe('Key Type Detection', () => {
    it('should detect ED25519 key type and retain the correct operator key', () => {
      const privateKey = PrivateKey.generateED25519();
      const keyString = privateKey.toString();
      const client = new HCS2Client({
        operatorId,
        operatorKey: keyString,
        network: 'testnet',
      });
      expect(client.getKeyType()).toBe('ed25519');
      expect(client.getOperatorKey().toString()).toBe(keyString);
    });

    it('should detect ECDSA key type when explicitly set', () => {
      const privateKey = PrivateKey.generateECDSA();
      const raw = privateKey.toStringRaw();
      // Using raw hex for ECDSA
      const client = new HCS2Client({
        operatorId,
        operatorKey: raw,
        network: 'testnet',
        keyType: 'ecdsa',
      });
      expect(client.getKeyType()).toBe('ecdsa');
      expect(client.getOperatorKey().toStringRaw()).toBe(raw);
    });

    it('should auto-detect ECDSA key with 0x prefix', () => {
      const privateKey = PrivateKey.generateECDSA();
      const raw = privateKey.toStringRaw();
      const keyString = '0x' + raw;
      const client = new HCS2Client({
        operatorId,
        operatorKey: keyString,
        network: 'testnet',
      });
      expect(client.getKeyType()).toBe('ecdsa');
      expect(client.getOperatorKey().toStringRaw()).toBe(raw);
    });
  });

  afterAll(async () => {
    client.close();
  });
});
