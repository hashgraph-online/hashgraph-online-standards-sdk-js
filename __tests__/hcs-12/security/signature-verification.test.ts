/**
 * Tests for HashLink Signature Verification
 *
 * Tests cryptographic signature verification for actions, assemblies,
 * and WASM modules to ensure integrity and authenticity.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SignatureVerifier } from '../../../src/hcs-12/security/signature-verifier';
import { Logger } from '../../../src/utils/logger';
import { PrivateKey, PublicKey } from '@hashgraph/sdk';

describe('SignatureVerification', () => {
  let verifier: SignatureVerifier;
  let logger: Logger;
  let testPrivateKey: PrivateKey;
  let testPublicKey: PublicKey;

  beforeEach(() => {
    logger = new Logger({ module: 'SignatureVerificationTest' });
    verifier = new SignatureVerifier({ logger });

    testPrivateKey = PrivateKey.generateED25519();
    testPublicKey = testPrivateKey.publicKey;
  });

  describe('Basic Signature Operations', () => {
    it('should sign and verify data correctly', async () => {
      const data = {
        action: 'transfer',
        amount: 100,
        recipient: '0.0.456789',
      };

      const signature = await verifier.sign(data, testPrivateKey);
      expect(signature).toBeDefined();
      expect(signature.algorithm).toBe('ED25519');

      const isValid = await verifier.verify(data, signature, testPublicKey);
      expect(isValid).toBe(true);
    });

    it('should detect invalid signatures', async () => {
      const data = { message: 'original' };
      const tamperedData = { message: 'tampered' };

      const signature = await verifier.sign(data, testPrivateKey);

      const isValid = await verifier.verify(
        tamperedData,
        signature,
        testPublicKey,
      );
      expect(isValid).toBe(false);
    });

    it('should handle different signature algorithms', async () => {
      const ed25519Key = PrivateKey.generateED25519();
      const ed25519Data = { type: 'ED25519', value: 123 };

      const ed25519Sig = await verifier.sign(ed25519Data, ed25519Key);
      expect(ed25519Sig.algorithm).toBe('ED25519');

      const ed25519Valid = await verifier.verify(
        ed25519Data,
        ed25519Sig,
        ed25519Key.publicKey,
      );
      expect(ed25519Valid).toBe(true);

      const ecdsaKey = PrivateKey.generateECDSA();
      const ecdsaData = { type: 'ECDSA', value: 456 };

      const ecdsaSig = await verifier.sign(ecdsaData, ecdsaKey);

      expect(['ED25519', 'ECDSA']).toContain(ecdsaSig.algorithm);

      const ecdsaValid = await verifier.verify(
        ecdsaData,
        ecdsaSig,
        ecdsaKey.publicKey,
      );
      expect(ecdsaValid).toBe(true);
    });
  });

  describe('Action Signature Verification', () => {
    it('should verify signed actions', async () => {
      const action = {
        id: 'action-123',
        type: 'TOKEN_TRANSFER',
        parameters: {
          tokenId: '0.0.345678',
          to: '0.0.456789',
          amount: 1000,
        },
        timestamp: Date.now(),
        nonce: Math.random().toString(36),
      };

      const signedAction = await verifier.signAction(action, testPrivateKey);
      expect(signedAction.signature).toBeDefined();
      expect(signedAction.publicKey).toBe(testPublicKey.toString());

      const verification = await verifier.verifyAction(
        signedAction,
        testPublicKey,
      );
      expect(verification.valid).toBe(true);
      expect(verification.signerVerified).toBe(true);
    });

    it('should detect replay attacks', async () => {
      const action = {
        id: 'action-456',
        type: 'CRYPTO_TRANSFER',
        parameters: { amount: 100 },
        timestamp: Date.now() - 3600000,
        nonce: 'old-nonce',
      };

      const signedAction = await verifier.signAction(action, testPrivateKey);

      verifier.setReplayProtection({
        enabled: true,
        windowMs: 300000,
        checkNonce: true,
      });

      const verification = await verifier.verifyAction(
        signedAction,
        testPublicKey,
      );
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain('replay attack');
    });

    it('should verify action chains', async () => {
      const actions = [];
      let previousHash = '';

      for (let i = 0; i < 3; i++) {
        const action = {
          id: `action-chain-${i}`,
          type: 'UPDATE_STATE',
          parameters: { value: i },
          timestamp: Date.now(),
          previousHash,
        };

        const signedAction = await verifier.signAction(action, testPrivateKey);
        previousHash = await verifier.hashAction(signedAction);
        actions.push(signedAction);
      }

      const chainVerification = await verifier.verifyActionChain(
        actions,
        testPublicKey,
      );
      expect(chainVerification.valid).toBe(true);
      expect(chainVerification.brokenLinks).toHaveLength(0);
    });
  });

  describe('Assembly Signature Verification', () => {
    it('should verify assembly manifests', async () => {
      const assembly = {
        id: 'assembly-123',
        name: 'Test Assembly',
        version: '1.0.0',
        actions: ['action-1', 'action-2'],
        blocks: ['block-1', 'block-2'],
        dependencies: [],
        creator: testPublicKey.toString(),
        timestamp: Date.now(),
      };

      const signedAssembly = await verifier.signAssembly(
        assembly,
        testPrivateKey,
      );
      expect(signedAssembly.signature).toBeDefined();

      const verification = await verifier.verifyAssembly(signedAssembly);
      expect(verification.valid).toBe(true);
      expect(verification.integrityVerified).toBe(true);
    });

    it('should verify assembly component signatures', async () => {
      const componentSignatures = {
        'action-1': await verifier.sign({ id: 'action-1' }, testPrivateKey),
        'action-2': await verifier.sign({ id: 'action-2' }, testPrivateKey),
        'block-1': await verifier.sign({ id: 'block-1' }, testPrivateKey),
        'block-2': await verifier.sign({ id: 'block-2' }, testPrivateKey),
      };

      const assembly = {
        id: 'assembly-456',
        components: ['action-1', 'action-2', 'block-1', 'block-2'],
        componentSignatures,
        creator: testPublicKey.toString(),
      };

      const verification = await verifier.verifyAssemblyComponents(
        assembly,
        testPublicKey,
      );

      expect(verification.valid).toBe(true);
      expect(verification.invalidComponents).toHaveLength(0);
    });
  });

  describe('WASM Module Verification', () => {
    it('should verify WASM module signatures', async () => {
      const wasmModule = {
        id: 'wasm-123',
        code: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
        metadata: {
          name: 'Test Module',
          version: '1.0.0',
          capabilities: ['CRYPTO_TRANSFER'],
        },
      };

      const signedModule = await verifier.signWasmModule(
        wasmModule,
        testPrivateKey,
      );
      expect(signedModule.signature).toBeDefined();
      expect(signedModule.codeHash).toBeDefined();

      const verification = await verifier.verifyWasmModule(
        signedModule,
        testPublicKey,
      );

      expect(verification.valid).toBe(true);
      expect(verification.codeIntegrity).toBe(true);
    });

    it('should detect tampered WASM code', async () => {
      const wasmModule = {
        id: 'wasm-456',
        code: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]),
        metadata: { name: 'Original Module' },
      };

      const signedModule = await verifier.signWasmModule(
        wasmModule,
        testPrivateKey,
      );

      signedModule.code[4] = 0xff;

      const verification = await verifier.verifyWasmModule(
        signedModule,
        testPublicKey,
      );

      expect(verification.valid).toBe(false);
      expect(verification.codeIntegrity).toBe(false);
      expect(verification.error).toContain('Code integrity check failed');
    });
  });

  describe('Multi-Signature Support', () => {
    it('should handle multi-signature requirements', async () => {
      const signers = [
        PrivateKey.generateED25519(),
        PrivateKey.generateED25519(),
        PrivateKey.generateED25519(),
      ];

      const data = {
        type: 'MULTI_SIG_ACTION',
        value: 'Important operation',
      };

      const signatures = await Promise.all(
        signers.map(key => verifier.sign(data, key)),
      );

      const multiSigData = {
        data,
        signatures,
        signers: signers.map(key => key.publicKey.toString()),
        threshold: 2,
      };

      const verification = await verifier.verifyMultiSignature(multiSigData);
      expect(verification.valid).toBe(true);
      expect(verification.validSignatures).toBe(3);
      expect(verification.thresholdMet).toBe(true);
    });

    it('should fail when threshold not met', async () => {
      const signer1 = PrivateKey.generateED25519();
      const signer2 = PrivateKey.generateED25519();

      const data = { type: 'THRESHOLD_TEST' };

      const multiSigData = {
        data,
        signatures: [await verifier.sign(data, signer1)],
        signers: [signer1.publicKey.toString(), signer2.publicKey.toString()],
        threshold: 2,
      };

      const verification = await verifier.verifyMultiSignature(multiSigData);
      expect(verification.valid).toBe(false);
      expect(verification.thresholdMet).toBe(false);
      expect(verification.error).toContain('Threshold not met');
    });
  });

  describe('Signature Revocation', () => {
    it('should handle revoked signatures', async () => {
      const data = { message: 'revocable' };
      const signature = await verifier.sign(data, testPrivateKey);

      await verifier.revokeSignature(signature.id);

      const verification = await verifier.verify(
        data,
        signature,
        testPublicKey,
        { checkRevocation: true },
      );

      expect(verification).toBe(false);
    });

    it('should manage revocation lists', async () => {
      const signatures = [];

      for (let i = 0; i < 5; i++) {
        const sig = await verifier.sign({ id: i }, testPrivateKey);
        signatures.push(sig);
      }

      await verifier.revokeSignature(signatures[1].id);
      await verifier.revokeSignature(signatures[3].id);

      const revocationList = await verifier.getRevocationList();
      expect(revocationList.size).toBe(2);
      expect(revocationList.has(signatures[1].id)).toBe(true);
      expect(revocationList.has(signatures[3].id)).toBe(true);
    });
  });

  describe('Performance and Caching', () => {
    it('should cache verification results', async () => {
      const data = { cached: true };
      const signature = await verifier.sign(data, testPrivateKey);

      verifier.setCaching({ enabled: true, ttlMs: 60000 });

      const start1 = Date.now();
      const result1 = await verifier.verify(data, signature, testPublicKey);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      const result2 = await verifier.verify(data, signature, testPublicKey);
      const time2 = Date.now() - start2;

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(time2).toBeLessThan(time1);
    });

    it('should handle batch verification efficiently', async () => {
      const items = [];

      for (let i = 0; i < 100; i++) {
        const data = { id: i, value: Math.random() };
        const signature = await verifier.sign(data, testPrivateKey);
        items.push({ data, signature });
      }

      const start = Date.now();
      const results = await verifier.batchVerify(items, testPublicKey);
      const duration = Date.now() - start;

      expect(results.every(r => r.valid)).toBe(true);
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid signature formats', async () => {
      const data = { test: true };
      const invalidSignature = {
        signature: 'invalid-base64',
        algorithm: 'INVALID',
        publicKey: 'invalid-key',
      };

      await expect(
        verifier.verify(data, invalidSignature as any, testPublicKey),
      ).rejects.toThrow('Invalid signature format');
    });

    it('should handle key mismatches gracefully', async () => {
      const data = { test: true };
      const signature = await verifier.sign(data, testPrivateKey);

      const differentKey = PrivateKey.generateED25519().publicKey;

      const result = await verifier.verify(data, signature, differentKey);
      expect(result).toBe(false);
    });
  });
});
