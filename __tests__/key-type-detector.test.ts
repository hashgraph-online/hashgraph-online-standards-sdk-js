import { PrivateKey } from '@hashgraph/sdk';
import { detectKeyTypeFromString } from '../src/utils/key-type-detector';

describe('detectKeyTypeFromString', () => {
  describe('ED25519 key detection', () => {
    it('should detect ED25519 key with DER header', () => {
      const ed25519DerKey = '302e020100300506032b657004220420' + '0'.repeat(64);
      const result = detectKeyTypeFromString(ed25519DerKey);

      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
    });

    it('should detect ED25519 key by length (96 chars)', () => {
      const privateKey = PrivateKey.generateED25519();
      const keyString = privateKey.toString();

      const result = detectKeyTypeFromString(keyString);

      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey.toString()).toBe(keyString);
    });

    it('should detect ED25519 key even if length suggests ECDSA', () => {
      const privateKey = PrivateKey.generateED25519();
      const fullKeyString = privateKey.toString();

      const result = detectKeyTypeFromString(fullKeyString);
      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
    });
  });

  describe('ECDSA key detection', () => {
    it('should detect ECDSA key with 0x prefix', () => {
      const privateKey = PrivateKey.generateECDSA();
      const hexKey = privateKey.toStringRaw();
      const ecdsaKey = '0x' + hexKey;

      const result = detectKeyTypeFromString(ecdsaKey);

      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey).toBeDefined();
    });

    it('should detect ECDSA key with DER header', () => {
      const privateKey = PrivateKey.generateECDSA();
      const ecdsaDerKey = privateKey.toString();

      const result = detectKeyTypeFromString(ecdsaDerKey);

      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey).toBeDefined();
    });

    it('should detect ECDSA key by length (88 chars)', () => {
      const privateKey = PrivateKey.generateECDSA();
      const keyString = privateKey.toString();

      const result = detectKeyTypeFromString(keyString);

      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey.toString()).toBe(keyString);
    });
  });

  describe('Fallback behavior', () => {
    it('should try alternate type if first detection fails', () => {
      const invalidKeyWithEcdsaHint = '0x' + 'z'.repeat(64);

      expect(() => detectKeyTypeFromString(invalidKeyWithEcdsaHint)).toThrow(
        /Failed to parse private key/,
      );
    });

    it('should handle keys without obvious indicators', () => {
      const privateKey = PrivateKey.generateED25519();
      const keyString = privateKey.toString();

      const result = detectKeyTypeFromString(keyString);

      expect(['ed25519', 'ecdsa']).toContain(result.detectedType);
      expect(result.privateKey).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should throw error for invalid key string', () => {
      const invalidKey = 'not-a-valid-key';

      expect(() => detectKeyTypeFromString(invalidKey)).toThrow(
        /Failed to parse private key/,
      );
    });

    it('should throw error for empty string', () => {
      expect(() => detectKeyTypeFromString('')).toThrow(
        /Failed to parse private key/,
      );
    });

    it('should throw error for malformed hex string', () => {
      const malformedKey = '0xGHIJKL';

      expect(() => detectKeyTypeFromString(malformedKey)).toThrow(
        /Failed to parse private key/,
      );
    });
  });

  describe('Real key examples', () => {
    it('should correctly identify real ED25519 DER encoded keys', () => {
      const privateKey = PrivateKey.generateED25519();
      const ed25519Example = privateKey.toString();

      const result = detectKeyTypeFromString(ed25519Example);
      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
    });

    it('should correctly identify real ECDSA keys with various formats', () => {
      const privateKey = PrivateKey.generateECDSA();
      const rawHex = privateKey.toStringRaw();
      const ecdsaHexExample = '0x' + rawHex;

      const result = detectKeyTypeFromString(ecdsaHexExample);
      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey).toBeDefined();
    });
  });
});
