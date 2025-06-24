/**
 * HashLinks Registry for HCS-12
 *
 * Manages the global directory of HashLinks assemblies.
 * This registry provides discovery and cataloging of available HashLinks.
 */

import { Logger } from '../../utils/logger';
import { BaseRegistry } from './base-registry';
import { RegistryType, HashLinksRegistration, AssemblyRegistryEntry } from '../types';
import { hashLinksRegistrationSchema } from '../validation/schemas';
import { validateWithSchema } from '../validation';
import type { NetworkType } from '../../utils/types';
import type { HCS12Client } from '../sdk';
import type { HCS12BrowserClient } from '../browser';

/**
 * Registry for managing HashLinks directory entries
 */
export class HashLinksRegistry extends BaseRegistry {
  constructor(
    networkType: NetworkType,
    logger: Logger,
    topicId?: string,
    client?: HCS12Client | HCS12BrowserClient,
  ) {
    super(networkType, logger, RegistryType.HASHLINKS, topicId, client);
  }

  /**
   * Register a new HashLink in the global directory
   */
  async register(data: HashLinksRegistration): Promise<string> {
    this.validateRegistration(data);

    const id = `${this.topicId || 'local'}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const entry: AssemblyRegistryEntry = {
      id,
      sequenceNumber: 0,
      timestamp: new Date().toISOString(),
      submitter:
        this.client && 'getHashConnect' in this.client
          ? 'browser'
          : this.client?.getOperatorAccountId() || 'local',
      data,
    };

    this.entries.set(id, entry);

    if (this.client && this.topicId) {
      try {
        const message = JSON.stringify(data);
        const result = await this.client.submitMessage(this.topicId, message);

        if (result.sequenceNumber) {
          entry.sequenceNumber = result.sequenceNumber;
          entry.id = result.sequenceNumber.toString();
          this.entries.delete(id);
          this.entries.set(entry.id, entry);
        }

        this.logger.info('HashLink submitted to HCS', {
          transactionId: result.transactionId,
          sequenceNumber: result.sequenceNumber,
          topicId: this.topicId,
        });

        return entry.id;
      } catch (error) {
        this.logger.error('Failed to submit HashLink to HCS', { error });

        this.entries.delete(id);
        throw error;
      }
    }

    this.logger.info('HashLink registered in directory', {
      id,
      name: data.name,
      assemblyTopicId: data.t_id,
      tags: data.tags,
    });

    return id;
  }

  /**
   * Search HashLinks by tags
   */
  async searchByTags(tags: string[]): Promise<HashLinksRegistration[]> {
    const entries = await this.listEntries();

    return entries
      .map(entry => entry.data as HashLinksRegistration)
      .filter(hashLink => {
        if (!hashLink.tags || hashLink.tags.length === 0) {
          return false;
        }
        return tags.some(tag => hashLink.tags?.includes(tag));
      });
  }

  /**
   * Search HashLinks by name (partial match)
   */
  async searchByName(searchTerm: string): Promise<HashLinksRegistration[]> {
    const entries = await this.listEntries();
    const lowerSearchTerm = searchTerm.toLowerCase();

    return entries
      .map(entry => entry.data as HashLinksRegistration)
      .filter(
        hashLink =>
          hashLink.name.toLowerCase().includes(lowerSearchTerm) ||
          (hashLink.description?.toLowerCase().includes(lowerSearchTerm) ??
            false),
      );
  }

  /**
   * Get featured HashLinks
   */
  async getFeatured(): Promise<HashLinksRegistration[]> {
    const entries = await this.listEntries();

    return entries
      .map(entry => entry.data as HashLinksRegistration)
      .filter(hashLink => hashLink.featured === true);
  }

  /**
   * Get HashLinks by category
   */
  async getByCategory(category: string): Promise<HashLinksRegistration[]> {
    const entries = await this.listEntries();

    return entries
      .map(entry => entry.data as HashLinksRegistration)
      .filter(hashLink => hashLink.category === category);
  }

  /**
   * Get all unique categories
   */
  async getCategories(): Promise<string[]> {
    const entries = await this.listEntries();
    const categories = new Set<string>();

    entries.forEach(entry => {
      const hashLink = entry.data as HashLinksRegistration;
      if (hashLink.category) {
        categories.add(hashLink.category);
      }
    });

    return Array.from(categories).sort();
  }

  /**
   * Get all unique tags
   */
  async getAllTags(): Promise<string[]> {
    const entries = await this.listEntries();
    const tags = new Set<string>();

    entries.forEach(entry => {
      const hashLink = entry.data as HashLinksRegistration;
      if (hashLink.tags) {
        hashLink.tags.forEach(tag => tags.add(tag));
      }
    });

    return Array.from(tags).sort();
  }

  /**
   * Validate HashLinks registration data
   */
  private validateRegistration(data: HashLinksRegistration): void {
    this.validateBaseRegistration(data);

    const validation = validateWithSchema(data, hashLinksRegistrationSchema);
    if (!validation.isValid) {
      throw new Error(
        `HashLinks validation failed: ${validation.errors.join(', ')}`,
      );
    }

    if (!data.t_id || !data.t_id.match(/^\d+\.\d+\.\d+$/)) {
      throw new Error('Valid assembly topic ID (t_id) is required');
    }

    if (data.tags && data.tags.length > 10) {
      throw new Error('Maximum 10 tags allowed');
    }

    if (data.name.length > 100) {
      throw new Error('Name must be 100 characters or less');
    }

    if (data.description && data.description.length > 500) {
      throw new Error('Description must be 500 characters or less');
    }
  }

  /**
   * Get registry statistics with HashLinks-specific metrics
   */
  getStats(): {
    entryCount: number;
    lastSync?: string;
    topicId?: string;
    registryType: string;
    categories: number;
    totalTags: number;
    featuredCount: number;
  } {
    const baseStats = super.getStats();
    const entries = Array.from(this.entries.values());

    const categories = new Set<string>();
    const tags = new Set<string>();
    let featuredCount = 0;

    entries.forEach(entry => {
      const hashLink = entry.data as HashLinksRegistration;
      if (hashLink.category) {
        categories.add(hashLink.category);
      }
      if (hashLink.tags) {
        hashLink.tags.forEach(tag => tags.add(tag));
      }
      if (hashLink.featured) {
        featuredCount++;
      }
    });

    return {
      ...baseStats,
      categories: categories.size,
      totalTags: tags.size,
      featuredCount,
    };
  }
}
