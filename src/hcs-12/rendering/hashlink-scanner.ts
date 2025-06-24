/**
 * HashLink Scanner for Template-Based Block Composition
 *
 * Scans HTML templates for data-hashlink attributes and extracts references
 */

import { Logger } from '../../utils/logger';

export interface ScannedHashLink {
  element: string;
  uri: string;
  protocol: string;
  reference: string;
  registryId?: string;
  entryName?: string;
  attributes?: Record<string, any>;
  actions?: Record<string, string>;
  loading?: 'eager' | 'lazy';
  placeholder: string;
}

export class HashLinkScanner {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Scan template for data-hashlink elements
   */
  async scanTemplate(html: string): Promise<ScannedHashLink[]> {
    const references: ScannedHashLink[] = [];

    const hashLinkRegex = /<([^>]+)\s+data-hashlink=["']([^"']+)["']([^>]*)>/gs;

    let match;
    while ((match = hashLinkRegex.exec(html)) !== null) {
      const fullMatch = match[0];
      const tagName = match[1].split(/\s+/)[0];
      const uri = match[2];
      const otherAttributes = match[3];

      try {
        const parsed = this.parseHashLinkURI(uri);

        const attributesMatch = otherAttributes.match(
          /data-attributes=(['"])((?:(?!\1).)*)\1/s,
        );
        let attributes: Record<string, any> | undefined;
        if (attributesMatch) {
          try {
            const attrString = attributesMatch[2];
            attributes = JSON.parse(attrString);
          } catch (e) {
            this.logger.warn('Failed to parse data-attributes', {
              uri,
              attributes: attributesMatch[2],
              error: e.message,
            });
          }
        }

        const actionsMatch = otherAttributes.match(
          /data-actions=(['"])((?:(?!\1).)*)\1/s,
        );
        let actions: Record<string, string> | undefined;
        if (actionsMatch) {
          try {
            const actionsString = actionsMatch[2];
            actions = JSON.parse(actionsString);
          } catch (e) {
            this.logger.warn('Failed to parse data-actions', {
              uri,
              actions: actionsMatch[2],
              error: e.message,
            });
          }
        }

        const loadingMatch = otherAttributes.match(
          /data-loading=['"]([^'"]+)['"]/,
        );
        const loading = (loadingMatch?.[1] as 'lazy' | 'eager') || 'eager';

        references.push({
          element: tagName,
          uri,
          ...parsed,
          attributes,
          actions,
          loading,
          placeholder: fullMatch,
        });

        this.logger.debug('Found HashLink reference', { uri, parsed });
      } catch (error) {
        this.logger.error('Failed to parse HashLink URI', {
          uri,
          error: error.message,
        });
      }
    }

    return references;
  }

  /**
   * Parse HashLink URI into components
   */
  parseHashLinkURI(uri: string): {
    protocol: string;
    reference: string;
    registryId?: string;
    entryName?: string;
  } {
    const uriMatch = uri.match(/^hcs:\/\/(\d+)\/(.+)$/);
    if (!uriMatch) {
      throw new Error(`Invalid HashLink URI format: ${uri}`);
    }

    const protocol = uriMatch[1];
    const referencePath = uriMatch[2];

    if (protocol === '2') {
      const parts = referencePath.split('/');
      if (parts.length !== 2) {
        throw new Error(`Invalid HCS-2 reference format: ${referencePath}`);
      }
      return {
        protocol,
        reference: referencePath,
        registryId: parts[0],
        entryName: parts[1],
      };
    }

    return {
      protocol,
      reference: referencePath,
    };
  }

  /**
   * Create a unique placeholder for replacement
   */
  createPlaceholder(ref: ScannedHashLink, index: number): string {
    return `<!-- HASHLINK_PLACEHOLDER_${index}_${ref.uri.replace(/[^a-zA-Z0-9]/g, '_')} -->`;
  }
}
