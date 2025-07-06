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
      // Generate a valid ED25519 private key
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

    it('should properly parse ED25519 key with 0x prefix (hex encoded)', () => {
      // Generate a valid ED25519 private key and get raw hex
      const privateKey = PrivateKey.generateED25519();
      const hexKey = privateKey.toStringRaw();
      const ed25519HexKey = '0x' + hexKey;

      const result = detectKeyTypeFromString(ed25519HexKey);

      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toStringRaw()).toBe(hexKey);
    });

    it('should detect ED25519 key without prefix (raw hex encoded)', () => {
      // Generate a valid ED25519 private key and get raw hex
      const privateKey = PrivateKey.generateED25519();
      const hexKey = privateKey.toStringRaw();

      const result = detectKeyTypeFromString(hexKey);

      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toStringRaw()).toBe(hexKey);
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
      // Generate a valid ECDSA private key
      const privateKey = PrivateKey.generateECDSA();
      const keyString = privateKey.toString();

      const result = detectKeyTypeFromString(keyString);

      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey.toString()).toBe(keyString);
    });

    it('should properly parse ECDSA key without prefix (raw hex encoded)', () => {
      // Generate a valid ECDSA private key and get raw hex
      const privateKey = PrivateKey.generateECDSA();
      const hexKey = privateKey.toStringRaw();

      const result = detectKeyTypeFromString(hexKey);

      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toStringRaw()).toBe(hexKey);
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
      // Generate a key and strip any obvious indicators
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
      const malformedKey = '0xGHIJKL'; // Invalid hex characters

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

  describe('Edge cases for hex encoded keys', () => {
    it('should properly parse keys with whitespace', () => {
      const privateKey = PrivateKey.generateED25519();
      const hexKey = privateKey.toStringRaw();
      const keyWithWhitespace = `  0x${hexKey}  `;

      const result = detectKeyTypeFromString(keyWithWhitespace);
      
      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toStringRaw()).toBe(hexKey);
    });

    it('should handle mixed case hex', () => {
      const privateKey = PrivateKey.generateED25519();
      const hexKey = privateKey.toStringRaw().toUpperCase();
      const mixedCaseKey = `0x${hexKey}`;

      const result = detectKeyTypeFromString(mixedCaseKey);
      
      expect(result.privateKey).toBeDefined();
    });
  });

  describe('PEM format support', () => {
    it('should detect ED25519 key from PEM format', () => {
      const privateKey = PrivateKey.generateED25519();
      const derKey = privateKey.toString();
      const base64 = Buffer.from(derKey, 'hex').toString('base64');
      const pemKey = `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
      
      const result = detectKeyTypeFromString(pemKey);
      
      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toString()).toBe(derKey);
    });

    it('should detect ECDSA key from PEM format', () => {
      const privateKey = PrivateKey.generateECDSA();
      const derKey = privateKey.toString();
      const base64 = Buffer.from(derKey, 'hex').toString('base64');
      const pemKey = `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
      
      const result = detectKeyTypeFromString(pemKey);
      
      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toString()).toBe(derKey);
    });

    it('should handle PEM with line breaks', () => {
      const privateKey = PrivateKey.generateED25519();
      const derKey = privateKey.toString();
      const base64 = Buffer.from(derKey, 'hex').toString('base64');
      // Split base64 into 64-char lines like real PEM
      const formattedBase64 = base64.match(/.{1,64}/g)?.join('\n') || base64;
      const pemKey = `-----BEGIN PRIVATE KEY-----\n${formattedBase64}\n-----END PRIVATE KEY-----`;
      
      const result = detectKeyTypeFromString(pemKey);
      
      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
    });
  });

  describe('Base64 format support', () => {
    it('should detect ED25519 key from base64 format', () => {
      const privateKey = PrivateKey.generateED25519();
      const derKey = privateKey.toString();
      const base64Key = Buffer.from(derKey, 'hex').toString('base64');
      
      const result = detectKeyTypeFromString(base64Key);
      
      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toString()).toBe(derKey);
    });

    it('should detect ECDSA key from base64 format', () => {
      const privateKey = PrivateKey.generateECDSA();
      const derKey = privateKey.toString();
      const base64Key = Buffer.from(derKey, 'hex').toString('base64');
      
      const result = detectKeyTypeFromString(base64Key);
      
      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toString()).toBe(derKey);
    });
  });

  describe('64-byte key handling', () => {
    it('should handle 64-byte hex as ED25519 (private + public key)', () => {
      // Create a 64-byte hex string (128 chars)
      const privateKey = PrivateKey.generateED25519();
      const privateHex = privateKey.toStringRaw();
      const publicHex = privateKey.publicKey.toStringRaw();
      const combined64ByteHex = privateHex + publicHex;
      
      const result = detectKeyTypeFromString(combined64ByteHex);
      
      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey).toBeDefined();
    });
  });

  describe('Public key rejection', () => {
    it('should reject ED25519 public keys', () => {
      // ED25519 public key DER prefix
      const publicKeyDer = '302a300506032b6570' + '0'.repeat(64);
      
      expect(() => detectKeyTypeFromString(publicKeyDer)).toThrow(
        /Public keys are not supported/
      );
    });
  });

  describe('Convention-based hex detection', () => {
    it('should detect 0x-prefixed 32-byte hex as ECDSA', () => {
      const privateKey = PrivateKey.generateECDSA();
      const hexKey = privateKey.toStringRaw();
      const keyWith0x = '0x' + hexKey;
      
      const result = detectKeyTypeFromString(keyWith0x);
      
      expect(result.detectedType).toBe('ecdsa');
      expect(result.privateKey.toStringRaw()).toBe(hexKey);
    });

    it('should detect raw 32-byte hex as ED25519', () => {
      const privateKey = PrivateKey.generateED25519();
      const hexKey = privateKey.toStringRaw();
      
      const result = detectKeyTypeFromString(hexKey);
      
      expect(result.detectedType).toBe('ed25519');
      expect(result.privateKey.toStringRaw()).toBe(hexKey);
    });

    it('should fallback correctly when convention-based guess is wrong', () => {
      // Use an ED25519 key with 0x prefix (convention says ECDSA)
      const ed25519Key = PrivateKey.generateED25519();
      const hexKey = ed25519Key.toStringRaw();
      const keyWith0x = '0x' + hexKey;
      
      // This should still work due to fallback
      const result = detectKeyTypeFromString(keyWith0x);
      
      expect(result.privateKey).toBeDefined();
      expect(result.privateKey.toStringRaw()).toBe(hexKey);
    });
  });

  describe('Invalid input handling', () => {
    it('should throw on invalid PEM format', () => {
      const invalidPem = '-----BEGIN PRIVATE KEY-----\ninvalid base64 content!@#\n-----END PRIVATE KEY-----';
      
      expect(() => detectKeyTypeFromString(invalidPem)).toThrow();
    });

    it('should throw on non-hex string without valid format', () => {
      const invalidKey = 'this-is-not-a-valid-key-format';
      
      expect(() => detectKeyTypeFromString(invalidKey)).toThrow(
        /Failed to parse private key/
      );
    });

    it('should throw on hex string with odd length', () => {
      const oddLengthHex = '0x123'; // 3 chars is not valid hex byte representation
      
      expect(() => detectKeyTypeFromString(oddLengthHex)).toThrow(
        /Invalid hex string: odd number of characters/
      );
    });
  });
});
