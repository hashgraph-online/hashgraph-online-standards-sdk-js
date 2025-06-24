/**
 * Resource Manager for HCS-12 HashLinks
 *
 * Manages loading and caching of resources (CSS, JS, images, templates)
 * from HCS-3 storage with integrity verification and security validation.
 */

import { Logger } from '../../utils/logger';
import { NetworkType } from '../../utils/types';
import { HCS } from '../../hcs-3/src';

export interface ResourceData {
  content: string | Uint8Array;
  contentType: string;
  size: number;
  hash?: string;
}

export interface VerifiedResource {
  content: string | Uint8Array;
  verified: boolean;
  contentType: string;
}

export interface ResourceDependency {
  topicId: string;
  type: 'css' | 'js' | 'template' | 'image';
  depends?: string[];
}

export interface LoadedResource {
  topicId: string;
  content: string | Uint8Array;
  contentType: string;
  type: string;
}

export interface CacheEntry {
  data: ResourceData;
  timestamp: number;
  size: number;
}

export interface ResourceManagerOptions {
  cacheTTL?: number;
  maxCacheSize?: number;
  maxResourceSize?: number;
}

/**
 * Resource manager for efficient loading and caching of HCS-3 resources
 */
export class ResourceManager {
  private logger: Logger;
  private hcs: HCS;
  private cache: Map<string, CacheEntry> = new Map();
  private options: Required<ResourceManagerOptions>;
  private currentCacheSize: number = 0;

  private readonly supportedImageTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/svg+xml',
    'image/webp',
  ]);

  private readonly dangerousJSPatterns = [
    /eval\s*\(/g,
    /Function\s*\(/g,
    /setTimeout\s*\(\s*["'].*["']/g,
    /setInterval\s*\(\s*["'].*["']/g,
    /document\.write/g,
    /innerHTML\s*=/g,
    /outerHTML\s*=/g,
  ];

  private readonly dangerousCSSPatterns = [
    /javascript\s*:/gi,
    /@import.*url\s*\(\s*["']?javascript:/gi,
    /expression\s*\(/gi,
    /behavior\s*:/gi,
  ];

  constructor(
    networkType: NetworkType,
    logger: Logger,
    hcs?: HCS,
    options: ResourceManagerOptions = {},
  ) {
    this.logger = logger;
    this.hcs = hcs || new HCS();
    this.options = {
      cacheTTL: options.cacheTTL || 300000,
      maxCacheSize: options.maxCacheSize || 50 * 1024 * 1024,
      maxResourceSize: options.maxResourceSize || 5 * 1024 * 1024,
    };
  }

  /**
   * Load CSS resource from HCS-3
   */
  async loadCSS(topicId: string): Promise<string> {
    this.logger.debug('Loading CSS resource', { topicId });

    try {
      const resource = await this.loadResource(topicId);

      if (resource.contentType !== 'text/css') {
        throw new Error(`Expected CSS resource, got ${resource.contentType}`);
      }

      const content = resource.content as string;
      const sanitized = this.sanitizeCSS(content);

      this.logger.debug('CSS resource loaded successfully', {
        topicId,
        size: content.length,
        sanitized: sanitized.length !== content.length,
      });

      return sanitized;
    } catch (error) {
      this.logger.error('Failed to load CSS resource', { topicId, error });
      throw new Error(
        `Failed to load CSS resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Load JavaScript resource from HCS-3
   */
  async loadJS(topicId: string): Promise<string> {
    this.logger.debug('Loading JavaScript resource', { topicId });

    try {
      const resource = await this.loadResource(topicId);

      if (
        !resource.contentType.includes('javascript') &&
        !resource.contentType.includes('ecmascript')
      ) {
        throw new Error(
          `Expected JavaScript resource, got ${resource.contentType}`,
        );
      }

      const content = resource.content as string;

      if (content.length > this.options.maxResourceSize) {
        throw new Error('JavaScript resource too large');
      }

      const sanitized = this.sanitizeJavaScript(content);

      this.logger.debug('JavaScript resource loaded successfully', {
        topicId,
        size: content.length,
        sanitized: sanitized.length !== content.length,
      });

      return sanitized;
    } catch (error) {
      this.logger.error('Failed to load JavaScript resource', {
        topicId,
        error,
      });
      throw new Error(
        `Failed to load JavaScript resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Load image resource from HCS-3 as Blob
   */
  async loadImage(topicId: string): Promise<Blob> {
    this.logger.debug('Loading image resource', { topicId });

    try {
      const resource = await this.loadResource(topicId);

      if (!this.supportedImageTypes.has(resource.contentType)) {
        throw new Error(`Unsupported image format: ${resource.contentType}`);
      }

      const content = resource.content as Uint8Array;
      const blob = new Blob([content], { type: resource.contentType });

      this.logger.debug('Image resource loaded successfully', {
        topicId,
        size: content.length,
        type: resource.contentType,
      });

      return blob;
    } catch (error) {
      this.logger.error('Failed to load image resource', { topicId, error });
      throw new Error(
        `Failed to load image resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Load template resource from HCS-3
   */
  async loadTemplate(topicId: string): Promise<string> {
    this.logger.debug('Loading template resource', { topicId });

    try {
      const resource = await this.loadResource(topicId);

      const content = resource.content as string;

      this.validateTemplateSyntax(content);

      const sanitized = this.sanitizeTemplate(content);

      this.logger.debug('Template resource loaded successfully', {
        topicId,
        size: content.length,
      });

      return sanitized;
    } catch (error) {
      this.logger.error('Failed to load template resource', { topicId, error });
      throw new Error(
        `Failed to load template resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Load resource with integrity verification
   */
  async loadWithIntegrityCheck(
    topicId: string,
    expectedHash: string,
  ): Promise<VerifiedResource> {
    this.logger.debug('Loading resource with integrity check', {
      topicId,
      expectedHash,
    });

    try {
      const resource = await this.loadResource(topicId);

      const verified = await this.verifyIntegrity(
        resource.content,
        expectedHash,
      );

      if (!verified) {
        throw new Error('Resource integrity verification failed');
      }

      this.logger.debug('Resource integrity verified', { topicId });

      return {
        content: resource.content,
        verified,
        contentType: resource.contentType,
      };
    } catch (error) {
      this.logger.error('Resource integrity check failed', { topicId, error });
      throw error;
    }
  }

  /**
   * Verify content integrity using SHA-256 hash
   */
  private async verifyIntegrity(
    content: string | Uint8Array,
    expectedHash: string,
  ): Promise<boolean> {
    try {
      const buffer =
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content;

      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const actualHash = hashArray
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      return actualHash === expectedHash.toLowerCase();
    } catch (error) {
      this.logger.error('Error verifying integrity', { error });
      return false;
    }
  }

  /**
   * Load multiple dependencies in correct order
   */
  async loadDependencies(
    dependencies: ResourceDependency[],
  ): Promise<LoadedResource[]> {
    this.logger.debug('Loading dependencies', { count: dependencies.length });

    try {
      this.detectCircularDependencies(dependencies);

      const sorted = this.topologicalSort(dependencies);

      const results: LoadedResource[] = [];

      for (const dep of sorted) {
        let content: string | Uint8Array;

        switch (dep.type) {
          case 'css':
            content = await this.loadCSS(dep.topicId);
            break;
          case 'js':
            content = await this.loadJS(dep.topicId);
            break;
          case 'template':
            content = await this.loadTemplate(dep.topicId);
            break;
          case 'image':
            const blob = await this.loadImage(dep.topicId);
            content = new Uint8Array(await blob.arrayBuffer());
            break;
          default:
            throw new Error(`Unsupported dependency type: ${dep.type}`);
        }

        results.push({
          topicId: dep.topicId,
          content,
          contentType: this.getContentTypeForType(dep.type),
          type: dep.type,
        });
      }

      this.logger.debug('Dependencies loaded successfully', {
        count: results.length,
      });
      return results;
    } catch (error) {
      this.logger.error('Failed to load dependencies', { error });
      throw error;
    }
  }

  /**
   * Clear resource cache
   */
  clearCache(): void {
    this.cache.clear();
    this.currentCacheSize = 0;
    this.logger.debug('Resource cache cleared');
  }

  /**
   * Get current cache size for testing
   */
  getCacheSize(): number {
    return this.currentCacheSize;
  }

  /**
   * Load resource with caching
   */
  private async loadResource(topicId: string): Promise<ResourceData> {
    const cached = this.getFromCache(topicId);
    if (cached) {
      this.logger.debug('Resource loaded from cache', { topicId });
      return cached;
    }

    const blob = await this.hcs.retrieveHCS1Data(topicId);

    const contentType = blob.type || 'application/octet-stream';

    let content: string | Uint8Array;
    if (
      contentType.startsWith('text/') ||
      contentType.includes('javascript') ||
      contentType.includes('json')
    ) {
      content = await blob.text();
    } else {
      content = new Uint8Array(await blob.arrayBuffer());
    }

    const resource: ResourceData = {
      content,
      contentType,
      size: blob.size,
    };

    this.addToCache(topicId, resource);

    return resource;
  }

  /**
   * Get resource from cache if valid
   */
  private getFromCache(topicId: string): ResourceData | null {
    const entry = this.cache.get(topicId);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.options.cacheTTL) {
      this.removeFromCache(topicId);
      return null;
    }

    return entry.data;
  }

  /**
   * Add resource to cache with size management
   */
  private addToCache(topicId: string, resource: ResourceData): void {
    const size =
      typeof resource.content === 'string'
        ? resource.content.length
        : resource.content.byteLength;

    if (size > this.options.maxCacheSize / 2) {
      this.logger.warn('Resource too large for cache', { topicId, size });
      return;
    }

    while (
      this.currentCacheSize + size > this.options.maxCacheSize &&
      this.cache.size > 0
    ) {
      this.evictOldestEntry();
    }

    const entry: CacheEntry = {
      data: resource,
      timestamp: Date.now(),
      size,
    };

    this.cache.set(topicId, entry);
    this.currentCacheSize += size;

    this.logger.debug('Resource added to cache', {
      topicId,
      size,
      totalCacheSize: this.currentCacheSize,
    });
  }

  /**
   * Remove resource from cache
   */
  private removeFromCache(topicId: string): void {
    const entry = this.cache.get(topicId);
    if (entry) {
      this.cache.delete(topicId);
      this.currentCacheSize -= entry.size;
    }
  }

  /**
   * Evict oldest cache entry
   */
  private evictOldestEntry(): void {
    let oldest: string | null = null;
    let oldestTime = Date.now();

    for (const [topicId, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldest = topicId;
      }
    }

    if (oldest) {
      this.removeFromCache(oldest);
      this.logger.debug('Evicted oldest cache entry', { topicId: oldest });
    }
  }

  /**
   * Sanitize CSS content
   */
  private sanitizeCSS(css: string): string {
    let sanitized = css;

    for (const pattern of this.dangerousCSSPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    return sanitized;
  }

  /**
   * Sanitize JavaScript content
   */
  private sanitizeJavaScript(js: string): string {
    let sanitized = js;

    for (const pattern of this.dangerousJSPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    return sanitized;
  }

  /**
   * Sanitize template content
   */
  private sanitizeTemplate(template: string): string {
    return template
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript\s*:/gi, '');
  }

  /**
   * Validate template syntax
   */
  private validateTemplateSyntax(template: string): void {
    const openBraces = (template.match(/\{\{/g) || []).length;
    const closeBraces = (template.match(/\}\}/g) || []).length;

    if (openBraces !== closeBraces) {
      throw new Error('Invalid template syntax: unmatched braces');
    }

    const openBlocks = (template.match(/\{\{#\w+/g) || []).length;
    const closeBlocks = (template.match(/\{\{\/\w+/g) || []).length;

    if (openBlocks !== closeBlocks) {
      throw new Error('Invalid template syntax: unclosed block helpers');
    }
  }

  /**
   * Detect circular dependencies
   */
  private detectCircularDependencies(dependencies: ResourceDependency[]): void {
    const dependencyMap = new Map<string, string[]>();

    for (const dep of dependencies) {
      dependencyMap.set(dep.topicId, dep.depends || []);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (topicId: string): void => {
      if (visiting.has(topicId)) {
        throw new Error('Circular dependency detected');
      }

      if (visited.has(topicId)) return;

      visiting.add(topicId);

      const deps = dependencyMap.get(topicId) || [];
      for (const dep of deps) {
        visit(dep);
      }

      visiting.delete(topicId);
      visited.add(topicId);
    };

    for (const dep of dependencies) {
      visit(dep.topicId);
    }
  }

  /**
   * Topological sort of dependencies
   */
  private topologicalSort(
    dependencies: ResourceDependency[],
  ): ResourceDependency[] {
    const dependencyMap = new Map<string, ResourceDependency>();
    const dependsMap = new Map<string, string[]>();

    for (const dep of dependencies) {
      dependencyMap.set(dep.topicId, dep);
      dependsMap.set(dep.topicId, dep.depends || []);
    }

    const sorted: ResourceDependency[] = [];
    const visited = new Set<string>();

    const visit = (topicId: string): void => {
      if (visited.has(topicId)) return;

      const deps = dependsMap.get(topicId) || [];
      for (const dep of deps) {
        visit(dep);
      }

      visited.add(topicId);
      const depObj = dependencyMap.get(topicId);
      if (depObj) {
        sorted.push(depObj);
      }
    };

    for (const dep of dependencies) {
      visit(dep.topicId);
    }

    return sorted;
  }

  /**
   * Get content type for dependency type
   */
  private getContentTypeForType(type: string): string {
    switch (type) {
      case 'css':
        return 'text/css';
      case 'js':
        return 'application/javascript';
      case 'template':
        return 'text/html';
      case 'image':
        return 'image/*';
      default:
        return 'application/octet-stream';
    }
  }
}
