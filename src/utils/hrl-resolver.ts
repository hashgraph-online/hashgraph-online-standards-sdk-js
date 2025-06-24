import axios from 'axios';
import { Logger, LogLevel } from './logger';
import { NetworkType } from './types';
import { HederaMirrorNode } from '../services';

/**
 * Options for HRL resolution
 */
export interface HRLResolutionOptions {
  network: NetworkType;
  returnRaw?: boolean;
  cdnEndpoint?: string;
}

/**
 * Result of an HRL resolution operation
 */
export interface HRLResolutionResult {
  content: string | ArrayBuffer;
  contentType: string;
  topicId: string;
  isBinary: boolean;
}

export interface ContentWithType {
  content: string | ArrayBuffer;
  contentType: string;
  isBinary: boolean;
}

/**
 * Utility class for resolving Hedera Resource Locators across the SDK
 */
export class HRLResolver {
  private logger: Logger;
  private defaultEndpoint = 'https://kiloscribe.com/api/inscription-cdn';

  constructor(logLevel: LogLevel = 'info') {
    this.logger = Logger.getInstance({
      level: logLevel,
      module: 'HRLResolver',
    });
  }

  /**
   * Determines if a MIME type represents binary content
   */
  private isBinaryContentType(mimeType: string): boolean {
    const binaryTypes = [
      'image/',
      'audio/',
      'video/',
      'application/octet-stream',
      'application/pdf',
      'application/zip',
      'application/gzip',
      'application/x-binary',
      'application/vnd.ms-',
      'application/x-msdownload',
      'application/x-shockwave-flash',
      'font/',
      'application/wasm',
    ];

    return binaryTypes.some(prefix => mimeType.startsWith(prefix));
  }

  /**
   * Parses an HRL string into its components
   */
  public parseHRL(hrl: string): { standard: string; topicId: string } | null {
    if (!hrl) {
      return null;
    }

    const hrlPattern = /^hcs:\/\/(\d+)\/([0-9]+\.[0-9]+\.[0-9]+)$/;
    const match = hrl.match(hrlPattern);

    if (!match) {
      return null;
    }

    return {
      standard: match[1],
      topicId: match[2],
    };
  }

  /**
   * Validates if a string is a valid HRL
   */
  public isValidHRL(hrl: string): boolean {
    if (!hrl || typeof hrl !== 'string') {
      return false;
    }

    const parsed = this.parseHRL(hrl);
    if (!parsed) {
      return false;
    }

    const topicIdPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
    if (!topicIdPattern.test(parsed.topicId)) {
      return false;
    }

    return true;
  }

  /**
   * Validates if a string is a valid topic ID
   */
  public isValidTopicId(topicId: string): boolean {
    const topicIdPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
    return topicIdPattern.test(topicId);
  }

  /**
   * Resolves content from either an HRL or a topic ID
   * If a topic ID is provided, it queries the topic memo to determine the HCS standard
   */
  public async resolve(
    hrlOrTopicId: string,
    options: HRLResolutionOptions,
  ): Promise<HRLResolutionResult> {
    if (this.isValidHRL(hrlOrTopicId)) {
      return this.resolveHRL(hrlOrTopicId, options);
    }

    if (!this.isValidTopicId(hrlOrTopicId)) {
      throw new Error(`Invalid HRL or topic ID format: ${hrlOrTopicId}`);
    }

    try {
      const mirrorNode = new HederaMirrorNode(options.network, this.logger);
      const topicInfo = await mirrorNode.getTopicInfo(hrlOrTopicId);
      const memo = topicInfo?.memo || '';

      let standard = '1';
      if (memo) {
        const hcsMatch = memo.match(/^hcs-(\d+)/);
        if (hcsMatch && hcsMatch[1]) {
          standard = hcsMatch[1];
        }
      }

      const hrl = `hcs://${standard}/${hrlOrTopicId}`;
      return this.resolveHRL(hrl, options);
    } catch (error: any) {
      this.logger.error(
        `Failed to get topic info for ${hrlOrTopicId}: ${error.message}`,
      );
      const hrl = `hcs://1/${hrlOrTopicId}`;
      return this.resolveHRL(hrl, options);
    }
  }

  public async getContentWithType(
    hrl: string,
    options: HRLResolutionOptions,
  ): Promise<ContentWithType> {
    if (!this.isValidHRL(hrl)) {
      return {
        content: hrl,
        contentType: 'text/plain',
        isBinary: false,
      };
    }

    try {
      const result = await this.resolveHRL(hrl, options);
      return {
        content: result.content,
        contentType: result.contentType,
        isBinary: result.isBinary,
      };
    } catch (e: any) {
      const error = e as Error;
      const logMessage = `Error resolving HRL for content and type: ${error.message}`;
      this.logger.error(logMessage);
      throw new Error(logMessage);
    }
  }

  /**
   * Resolves HRL content with proper content type detection
   */
  public async resolveHRL(
    hrl: string,
    options: HRLResolutionOptions,
  ): Promise<HRLResolutionResult> {
    const parsed = this.parseHRL(hrl);

    if (!parsed) {
      throw new Error(`Invalid HRL format: ${hrl}`);
    }

    const { standard, topicId } = parsed;

    this.logger.debug(
      `Resolving HRL reference: standard=${standard}, topicId=${topicId}`,
    );

    try {
      const cdnEndpoint = options.cdnEndpoint || this.defaultEndpoint;
      const cdnUrl = `${cdnEndpoint}/${topicId}?network=${options.network}`;

      this.logger.debug(`Fetching content from CDN: ${cdnUrl}`);
      const headResponse = await axios.head(cdnUrl);
      const contentType = headResponse.headers['content-type'] || '';
      const isBinary = this.isBinaryContentType(contentType);

      if (isBinary || options.returnRaw) {
        const response = await axios.get(cdnUrl, {
          responseType: 'arraybuffer',
        });

        return {
          content: response.data,
          contentType,
          topicId,
          isBinary: true,
        };
      }

      if (contentType === 'application/json') {
        const response = await axios.get(cdnUrl, {
          responseType: 'json',
        });

        if (!response.data) {
          throw new Error(`Failed to fetch content from topic: ${topicId}`);
        }

        return {
          content: response.data,
          contentType,
          topicId,
          isBinary: false,
        };
      }

      const response = await axios.get(cdnUrl);

      if (!response.data) {
        throw new Error(`Failed to fetch content from topic: ${topicId}`);
      }

      let content: string;

      if (typeof response.data === 'object') {
        content =
          response.data.content ||
          response.data.text ||
          JSON.stringify(response.data);
      } else {
        content = response.data;
      }

      return {
        content,
        contentType,
        topicId,
        isBinary: false,
      };
    } catch (e: any) {
      const error = e as Error;
      const logMessage = `Error resolving HRL reference: ${error.message}`;
      this.logger.error(logMessage);
      throw new Error(logMessage);
    }
  }
}
