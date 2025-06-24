/**
 * ActionBuilder utility for creating HCS-12 action registrations
 */

import { createHash } from 'crypto';
import { Logger } from '../../utils/logger';
import {
  ActionRegistration,
  SourceVerification,
  ValidationRule,
  ModuleInfo,
} from '../types';

export interface BuildOptions {
  validate?: boolean;
}

/**
 * Builder for creating action registrations with validation
 */
export class ActionBuilder {
  private logger: Logger;
  private registration: Partial<ActionRegistration>;
  private alias?: string;

  constructor(logger: Logger) {
    this.logger = logger;
    this.registration = {
      p: 'hcs-12',
      op: 'register',
    };
  }

  /**
   * Set HCS-1 topic ID for WASM storage
   */
  setTopicId(topicId: string): ActionBuilder {
    if (!this.isValidTopicId(topicId)) {
      throw new Error('Invalid topic ID format');
    }
    this.registration.t_id = topicId;
    return this;
  }

  /**
   * Set alias for this action in the assembly
   */
  setAlias(alias: string): ActionBuilder {
    this.alias = alias;
    return this;
  }

  /**
   * Set INFO hash
   */
  setHash(hash: string): ActionBuilder {
    if (!this.isValidHash(hash)) {
      throw new Error('Invalid hash format');
    }
    this.registration.hash = hash;
    return this;
  }

  /**
   * Set WASM hash
   */
  setWasmHash(hash: string): ActionBuilder {
    if (!this.isValidHash(hash)) {
      throw new Error('Invalid hash format');
    }
    this.registration.wasm_hash = hash;
    return this;
  }

  /**
   * Set optional INFO topic ID
   */
  setInfoTopicId(topicId: string): ActionBuilder {
    if (!this.isValidTopicId(topicId)) {
      throw new Error('Invalid topic ID format');
    }
    this.registration.info_t_id = topicId;
    return this;
  }

  /**
   * Set JavaScript wrapper topic ID
   */
  setJsTopicId(topicId: string): ActionBuilder {
    if (!this.isValidTopicId(topicId)) {
      throw new Error('Invalid topic ID format');
    }
    this.registration.js_t_id = topicId;
    return this;
  }

  /**
   * Set JavaScript wrapper hash
   */
  setJsHash(hash: string): ActionBuilder {
    if (!this.isValidHash(hash)) {
      throw new Error('Invalid hash format');
    }
    this.registration.js_hash = hash;
    return this;
  }

  /**
   * Set interface version (wasm-bindgen version)
   */
  setInterfaceVersion(version: string): ActionBuilder {
    if (!this.isValidVersion(version)) {
      throw new Error('Invalid version format');
    }
    this.registration.interface_version = version;
    return this;
  }

  /**
   * Add validation rule for an action
   */
  addValidationRule(action: string, rule: ValidationRule): ActionBuilder {
    if (!this.registration.validation_rules) {
      this.registration.validation_rules = {};
    }
    this.registration.validation_rules[action] = rule;
    return this;
  }

  /**
   * Set source verification data
   */
  setSourceVerification(verification: SourceVerification): ActionBuilder {
    if (!this.isValidTopicId(verification.source_t_id)) {
      throw new Error('Invalid source topic ID');
    }
    if (!this.isValidHash(verification.source_hash)) {
      throw new Error('Invalid source hash');
    }
    if (verification.target !== 'wasm32-unknown-unknown') {
      throw new Error('Invalid compilation target');
    }
    this.registration.source_verification = verification;
    return this;
  }

  /**
   * Build the action registration
   */
  build(options: BuildOptions = { validate: true }): ActionRegistration {
    if (options.validate !== false) {
      this.validate();
    }

    return { ...this.registration } as ActionRegistration;
  }

  /**
   * Reset the builder
   */
  reset(): ActionBuilder {
    this.registration = {
      p: 'hcs-12',
      op: 'register',
    };
    this.alias = undefined;
    return this;
  }

  /**
   * Get the alias
   */
  getAlias(): string {
    if (!this.alias) {
      throw new Error('Action alias not set');
    }
    return this.alias;
  }

  /**
   * Get the topic ID
   */
  getTopicId(): string {
    if (!this.registration.t_id) {
      throw new Error('Action topic ID not set');
    }
    return this.registration.t_id;
  }

  /**
   * Generate WASM hash from binary data
   */
  async generateWasmHash(wasmData: Uint8Array): Promise<string> {
    const hash = createHash('sha256');
    hash.update(wasmData);
    return hash.digest('hex');
  }

  /**
   * Generate INFO hash from module info
   */
  async generateInfoHash(info: ModuleInfo): Promise<string> {
    const hash = createHash('sha256');
    const infoJson = JSON.stringify(info, Object.keys(info).sort());
    hash.update(infoJson);
    return hash.digest('hex');
  }

  /**
   * Calculate hash for any data
   */
  async calculateHash(data: Uint8Array | Buffer | string): Promise<string> {
    const hash = createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * Create registration from WASM and INFO data
   */
  async createFromWasmAndInfo(
    topicId: string,
    wasmData: Uint8Array,
    info: ModuleInfo,
  ): Promise<ActionRegistration> {
    const wasmHash = await this.generateWasmHash(wasmData);
    const infoHash = await this.generateInfoHash(info);

    const jsTopicId = this.registration.js_t_id;
    const jsHash = this.registration.js_hash;
    const interfaceVersion = this.registration.interface_version;

    this.reset().setTopicId(topicId).setHash(infoHash).setWasmHash(wasmHash);

    if (jsTopicId) this.setJsTopicId(jsTopicId);
    if (jsHash) this.setJsHash(jsHash);
    if (interfaceVersion) this.setInterfaceVersion(interfaceVersion);

    return this.build();
  }

  /**
   * Check if registration is complete
   */
  isComplete(registration: Partial<ActionRegistration>): boolean {
    return !!(
      registration.p === 'hcs-12' &&
      registration.op === 'register' &&
      registration.t_id &&
      registration.hash &&
      registration.wasm_hash
    );
  }

  /**
   * Validate the current registration
   */
  private validate(): void {
    if (!this.registration.t_id) {
      throw new Error('Topic ID is required');
    }
    if (!this.registration.hash) {
      throw new Error('INFO hash is required');
    }
    if (!this.registration.wasm_hash) {
      throw new Error('WASM hash is required');
    }
  }

  /**
   * Validate topic ID format
   */
  private isValidTopicId(topicId: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(topicId);
  }

  /**
   * Validate hash format
   */
  private isValidHash(hash: string): boolean {
    return /^[a-f0-9]{64}$/.test(hash);
  }

  /**
   * Validate semantic version format
   */
  private isValidVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(version);
  }
}
