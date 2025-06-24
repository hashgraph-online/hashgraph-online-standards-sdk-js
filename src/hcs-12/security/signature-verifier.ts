/**
 * Signature Verifier for HCS-12 HashLinks
 *
 * Provides cryptographic signature verification for actions, assemblies,
 * and WASM modules to ensure integrity and authenticity.
 */

import { Logger } from '../../utils/logger';
import { PrivateKey, PublicKey } from '@hashgraph/sdk';
import * as crypto from 'crypto';
import { ActionRegistration, AssemblyRegistration } from '../types';

export interface SignatureVerifierConfig {
  logger: Logger;
  enableCaching?: boolean;
  cacheSize?: number;
}

export interface Signature {
  id: string;
  signature: string;
  algorithm: 'ED25519' | 'ECDSA';
  publicKey: string;
  timestamp: number;
}

export interface SignedAction {
  action: ActionRegistration;
  signature: Signature;
  publicKey: string;
}

export interface SignedAssembly {
  assembly: AssemblyRegistration;
  signature: Signature;
  componentSignatures?: Record<string, Signature>;
}

export interface SignedWasmModule {
  id: string;
  code: Uint8Array;
  codeHash: string;
  metadata: Record<string, unknown>;
  signature: Signature;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  signerVerified?: boolean;
  integrityVerified?: boolean;
  codeIntegrity?: boolean;
  brokenLinks?: string[];
  invalidComponents?: string[];
}

export interface MultiSignatureData {
  data: unknown;
  signatures: Signature[];
  signers: string[];
  threshold: number;
}

export interface MultiSignatureResult {
  valid: boolean;
  validSignatures: number;
  thresholdMet: boolean;
  error?: string;
}

export interface ReplayProtectionConfig {
  enabled: boolean;
  windowMs: number;
  checkNonce: boolean;
}

export interface CacheConfig {
  enabled: boolean;
  ttlMs: number;
}

export interface BatchVerificationItem {
  data: unknown;
  signature: Signature;
}

export interface BatchVerificationResult {
  valid: boolean;
  index: number;
  error?: string;
}

/**
 * Cryptographic signature verification system
 */
export class SignatureVerifier {
  private logger: Logger;
  private config: SignatureVerifierConfig;
  private revocationList: Set<string> = new Set();
  private nonceCache: Set<string> = new Set();
  private verificationCache: Map<string, { result: boolean; expiry: number }> =
    new Map();
  private replayProtection?: ReplayProtectionConfig;
  private cacheConfig?: CacheConfig;

  constructor(config: SignatureVerifierConfig) {
    this.config = config;
    this.logger = config.logger;
  }

  /**
   * Sign data with private key
   */
  async sign(data: unknown, privateKey: PrivateKey): Promise<Signature> {
    try {
      const message = this.serializeData(data);
      const messageBytes = Buffer.from(message);
      const signatureBytes = await privateKey.sign(messageBytes);

      const signature: Signature = {
        id: this.generateSignatureId(),
        signature: Buffer.from(signatureBytes).toString('base64'),
        algorithm: this.getKeyAlgorithm(privateKey),
        publicKey: privateKey.publicKey.toString(),
        timestamp: Date.now(),
      };

      return signature;
    } catch (error) {
      this.logger.error('Failed to sign data', { error });
      throw new Error('Signature creation failed');
    }
  }

  /**
   * Verify signature
   */
  async verify(
    data: unknown,
    signature: Signature,
    publicKey: PublicKey,
    options?: { checkRevocation?: boolean },
  ): Promise<boolean> {
    try {
      if (this.cacheConfig?.enabled) {
        const cached = this.checkCache(signature.id);
        if (cached !== null) return cached;
      }

      if (options?.checkRevocation && this.revocationList.has(signature.id)) {
        return false;
      }

      if (!this.isValidSignatureFormat(signature)) {
        throw new Error('Invalid signature format');
      }

      const message = this.serializeData(data);
      const messageBytes = Buffer.from(message);
      const signatureBytes = Buffer.from(signature.signature, 'base64');

      const isValid = publicKey.verify(messageBytes, signatureBytes);

      if (this.cacheConfig?.enabled) {
        this.cacheVerification(signature.id, isValid);
      }

      return isValid;
    } catch (error) {
      this.logger.error('Signature verification failed', { error });
      if (
        error instanceof Error &&
        error.message === 'Invalid signature format'
      ) {
        throw error;
      }
      return false;
    }
  }

  /**
   * Sign action
   */
  async signAction(action: any, privateKey: PrivateKey): Promise<SignedAction> {
    const signature = await this.sign(action, privateKey);

    return {
      action,
      signature,
      publicKey: privateKey.publicKey.toString(),
    };
  }

  /**
   * Verify action
   */
  async verifyAction(
    signedAction: SignedAction,
    publicKey: PublicKey,
  ): Promise<VerificationResult> {
    try {
      if (this.replayProtection?.enabled) {
        const replayCheck = this.checkReplayProtection(signedAction.action);
        if (!replayCheck.valid) {
          return {
            valid: false,
            error: replayCheck.error,
          };
        }
      }

      const isValid = await this.verify(
        signedAction.action,
        signedAction.signature,
        publicKey,
      );

      const signerVerified = signedAction.publicKey === publicKey.toString();

      return {
        valid: isValid && signerVerified,
        signerVerified,
      };
    } catch (error) {
      this.logger.error('Action verification failed', { error });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Hash action for chaining
   */
  async hashAction(signedAction: SignedAction): Promise<string> {
    const data = JSON.stringify({
      action: signedAction.action,
      signature: signedAction.signature,
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Verify action chain
   */
  async verifyActionChain(
    actions: SignedAction[],
    publicKey: PublicKey,
  ): Promise<VerificationResult> {
    const brokenLinks: string[] = [];

    for (let i = 0; i < actions.length; i++) {
      const verification = await this.verifyAction(actions[i], publicKey);
      if (!verification.valid) {
        brokenLinks.push(`action-${i}`);
      }

      if (i > 0) {
        const previousHash = await this.hashAction(actions[i - 1]);
        if ((actions[i].action as any).previousHash !== previousHash) {
          brokenLinks.push(`link-${i}`);
        }
      }
    }

    return {
      valid: brokenLinks.length === 0,
      brokenLinks,
    };
  }

  /**
   * Sign assembly
   */
  async signAssembly(
    assembly: any,
    privateKey: PrivateKey,
  ): Promise<SignedAssembly> {
    const signature = await this.sign(assembly, privateKey);

    return {
      assembly,
      signature,
    };
  }

  /**
   * Verify assembly
   */
  async verifyAssembly(
    signedAssembly: SignedAssembly,
  ): Promise<VerificationResult> {
    try {
      const publicKey = PublicKey.fromString(
        (signedAssembly.assembly as any).creator ||
          signedAssembly.signature.publicKey,
      );

      const isValid = await this.verify(
        signedAssembly.assembly,
        signedAssembly.signature,
        publicKey,
      );

      return {
        valid: isValid,
        integrityVerified: isValid,
      };
    } catch (error) {
      this.logger.error('Assembly verification failed', { error });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Verify assembly components
   */
  async verifyAssemblyComponents(
    assembly: any,
    publicKey: PublicKey,
  ): Promise<VerificationResult> {
    const invalidComponents: string[] = [];

    for (const componentId of assembly.components) {
      const signature = assembly.componentSignatures[componentId];
      if (!signature) {
        invalidComponents.push(componentId);
        continue;
      }

      const isValid = await this.verify(
        { id: componentId },
        signature,
        publicKey,
      );

      if (!isValid) {
        invalidComponents.push(componentId);
      }
    }

    return {
      valid: invalidComponents.length === 0,
      invalidComponents,
    };
  }

  /**
   * Sign WASM module
   */
  async signWasmModule(
    module: { id: string; code: Uint8Array; metadata: any },
    privateKey: PrivateKey,
  ): Promise<SignedWasmModule> {
    const codeHash = crypto
      .createHash('sha256')
      .update(module.code)
      .digest('hex');

    const dataToSign = {
      id: module.id,
      codeHash,
      metadata: module.metadata,
    };

    const signature = await this.sign(dataToSign, privateKey);

    return {
      ...module,
      codeHash,
      signature,
    };
  }

  /**
   * Verify WASM module
   */
  async verifyWasmModule(
    signedModule: SignedWasmModule,
    publicKey: PublicKey,
  ): Promise<VerificationResult> {
    try {
      const actualHash = crypto
        .createHash('sha256')
        .update(signedModule.code)
        .digest('hex');

      const codeIntegrity = actualHash === signedModule.codeHash;

      if (!codeIntegrity) {
        return {
          valid: false,
          codeIntegrity: false,
          error: 'Code integrity check failed',
        };
      }

      const dataToVerify = {
        id: signedModule.id,
        codeHash: signedModule.codeHash,
        metadata: signedModule.metadata,
      };

      const isValid = await this.verify(
        dataToVerify,
        signedModule.signature,
        publicKey,
      );

      return {
        valid: isValid,
        codeIntegrity,
      };
    } catch (error) {
      this.logger.error('WASM module verification failed', { error });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Verify multi-signature
   */
  async verifyMultiSignature(
    data: MultiSignatureData,
  ): Promise<MultiSignatureResult> {
    try {
      let validSignatures = 0;

      for (let i = 0; i < data.signatures.length; i++) {
        const publicKey = PublicKey.fromString(data.signers[i]);
        const isValid = await this.verify(
          data.data,
          data.signatures[i],
          publicKey,
        );

        if (isValid) {
          validSignatures++;
        }
      }

      const thresholdMet = validSignatures >= data.threshold;

      return {
        valid: thresholdMet,
        validSignatures,
        thresholdMet,
        error: thresholdMet ? undefined : 'Threshold not met',
      };
    } catch (error) {
      this.logger.error('Multi-signature verification failed', { error });
      return {
        valid: false,
        validSignatures: 0,
        thresholdMet: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Revoke signature
   */
  async revokeSignature(signatureId: string): Promise<void> {
    this.revocationList.add(signatureId);
    this.logger.info('Signature revoked', { signatureId });
  }

  /**
   * Get revocation list
   */
  async getRevocationList(): Promise<Set<string>> {
    return new Set(this.revocationList);
  }

  /**
   * Set replay protection
   */
  setReplayProtection(config: ReplayProtectionConfig): void {
    this.replayProtection = config;
  }

  /**
   * Set caching configuration
   */
  setCaching(config: CacheConfig): void {
    this.cacheConfig = config;
  }

  /**
   * Batch verify signatures
   */
  async batchVerify(
    items: BatchVerificationItem[],
    publicKey: PublicKey,
  ): Promise<BatchVerificationResult[]> {
    const results = await Promise.all(
      items.map(async (item, index) => {
        try {
          const valid = await this.verify(item.data, item.signature, publicKey);
          return { valid, index };
        } catch (error) {
          return {
            valid: false,
            index,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );

    return results;
  }

  /**
   * Serialize data for signing
   */
  private serializeData(data: any): string {
    return JSON.stringify(data, Object.keys(data).sort());
  }

  /**
   * Get key algorithm
   */
  private getKeyAlgorithm(privateKey: PrivateKey): 'ED25519' | 'ECDSA' {
    try {
      const keyString = privateKey.toString();

      if (keyString.length >= 90) {
        return 'ED25519';
      }
      return 'ECDSA';
    } catch {
      return 'ED25519';
    }
  }

  /**
   * Generate signature ID
   */
  private generateSignatureId(): string {
    return `sig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate signature format
   */
  private isValidSignatureFormat(signature: Signature): boolean {
    return !!(
      signature.id &&
      signature.signature &&
      signature.algorithm &&
      signature.publicKey &&
      signature.timestamp
    );
  }

  /**
   * Check replay protection
   */
  private checkReplayProtection(action: any): {
    valid: boolean;
    error?: string;
  } {
    if (!this.replayProtection) return { valid: true };

    const age = Date.now() - action.timestamp;
    if (age > this.replayProtection.windowMs) {
      return {
        valid: false,
        error: 'Action too old - possible replay attack',
      };
    }

    if (this.replayProtection.checkNonce) {
      if (this.nonceCache.has(action.nonce)) {
        return {
          valid: false,
          error: 'Duplicate nonce - possible replay attack',
        };
      }
      this.nonceCache.add(action.nonce);
    }

    return { valid: true };
  }

  /**
   * Check verification cache
   */
  private checkCache(signatureId: string): boolean | null {
    const cached = this.verificationCache.get(signatureId);
    if (!cached) return null;

    if (Date.now() > cached.expiry) {
      this.verificationCache.delete(signatureId);
      return null;
    }

    return cached.result;
  }

  /**
   * Cache verification result
   */
  private cacheVerification(signatureId: string, result: boolean): void {
    if (!this.cacheConfig) return;

    this.verificationCache.set(signatureId, {
      result,
      expiry: Date.now() + this.cacheConfig.ttlMs,
    });

    if (this.verificationCache.size > (this.config.cacheSize || 1000)) {
      const firstKey = this.verificationCache.keys().next().value;
      this.verificationCache.delete(firstKey);
    }
  }
}
