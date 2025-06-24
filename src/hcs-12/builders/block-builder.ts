import {
  BlockDefinition,
  GutenbergBlockType,
  AttributeDefinition,
  BlockSupports,
  BlockIcon,
} from '../types';
import { Logger } from '../../utils/logger';

/**
 * BlockBuilder provides a fluent interface for creating HCS-12 block definitions.
 *
 * Example usage:
 * ```typescript
 * const counterBlock = new BlockBuilder()
 *   .setName('hashlink/counter')
 *   .setTitle('Counter Block')
 *   .setDescription('A simple counter with increment/decrement')
 *   .setCategory('interactive')
 *   .setIcon('calculator')
 *   .addAttribute('count', 'number', 0)
 *   .addAttribute('step', 'number', 1)
 *   .addAttribute('label', 'string', 'Counter')
 *   .setTemplateFromFile('./counter-template.html')
 *   .addAction('increment', 'Increment the counter')
 *   .addAction('decrement', 'Decrement the counter')
 *   .addAction('reset', 'Reset to zero')
 *   .build();
 * ```
 */
export class BlockBuilder {
  private block: Partial<BlockDefinition> = {
    apiVersion: 3,
  };
  private attributes: Record<string, AttributeDefinition> = {};
  private supports: Partial<BlockSupports> = {};
  private templateTopicId?: string;
  private templateBuffer?: Buffer;
  private actions: Record<string, string> = {};
  private blockTopicId?: string;
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ module: 'BlockBuilder' });
  }

  /**
   * Set the block name (e.g., 'hashlink/counter')
   */
  setName(name: string): this {
    this.block.name = name;
    return this;
  }

  /**
   * Set the block title for display
   */
  setTitle(title: string): this {
    this.block.title = title;
    return this;
  }

  /**
   * Set the block description
   */
  setDescription(description: string): this {
    this.block.description = description;
    return this;
  }

  /**
   * Set the block category
   */
  setCategory(category: string): this {
    this.block.category = category;
    return this;
  }

  /**
   * Set the block icon (dashicon name)
   */
  setIcon(icon: string): this {
    this.block.icon = icon;
    return this;
  }

  /**
   * Set keywords for search
   */
  setKeywords(keywords: string[]): this {
    this.block.keywords = keywords;
    return this;
  }

  /**
   * Set the API version
   */
  setApiVersion(version: number): this {
    this.block.apiVersion = version;
    return this;
  }

  /**
   * Add a block attribute
   */
  addAttribute(
    name: string,
    type: 'string' | 'number' | 'boolean' | 'object' | 'array',
    defaultValue: any,
    options?: {
      enum?: any[];
      source?: string;
      selector?: string;
      attribute?: string;
    },
  ): this {
    const attr: AttributeDefinition = {
      type,
      default: defaultValue,
    };

    if (options?.enum) attr.enum = options.enum;
    if (options?.source) attr.source = options.source;
    if (options?.selector) (attr as any).selector = options.selector;
    if (options?.attribute) (attr as any).attribute = options.attribute;

    this.attributes[name] = attr;
    return this;
  }

  /**
   * Set the template topic ID
   */
  setTemplateTopicId(topicId: string): this {
    this.block.template_t_id = topicId;
    return this;
  }

  /**
   * Set the template buffer
   */
  setTemplate(template: Buffer): this {
    this.templateBuffer = template;
    return this;
  }

  /**
   * Map actions for this block
   */
  setActions(actions: Record<string, string>): this {
    this.actions = actions;
    return this;
  }

  /**
   * Add a single action mapping
   */
  addAction(name: string, topicId: string): this {
    this.actions[name] = topicId;
    return this;
  }

  /**
   * Add block supports (e.g., align, anchor, etc.)
   */
  addSupport(feature: keyof BlockSupports, value: any = true): this {
    this.supports[feature] = value;
    return this;
  }

  /**
   * Enable common supports
   */
  enableCommonSupports(): this {
    this.supports = {
      ...this.supports,
      align: true,
      anchor: true,
      className: true,
      spacing: {
        margin: true,
        padding: true,
      },
    };
    return this;
  }

  /**
   * Build the block definition
   */
  build(): BlockDefinition {
    if (!this.block.name) {
      throw new Error('Block name is required');
    }
    if (!this.block.title) {
      throw new Error('Block title is required');
    }
    if (!this.block.category) {
      throw new Error('Block category is required');
    }
    if (!this.block.template_t_id) {
      throw new Error('Block template_t_id is required');
    }

    return {
      apiVersion: this.block.apiVersion || 3,
      name: this.block.name,
      title: this.block.title,
      category: this.block.category,
      template_t_id: this.block.template_t_id,
      icon: this.block.icon,
      description: this.block.description,
      keywords: this.block.keywords,
      attributes: this.attributes,
      supports: this.supports as BlockSupports,
    };
  }

  /**
   * Create a simple display block
   */
  static createDisplayBlock(name: string, title: string): BlockBuilder {
    return new BlockBuilder()
      .setName(name)
      .setTitle(title)
      .setCategory('formatting')
      .enableCommonSupports();
  }

  /**
   * Create an interactive block
   */
  static createInteractiveBlock(name: string, title: string): BlockBuilder {
    return new BlockBuilder()
      .setName(name)
      .setTitle(title)
      .setCategory('widgets')
      .enableCommonSupports();
  }

  /**
   * Create a widget block (alias for interactive block)
   */
  static createWidgetBlock(name: string, title: string): BlockBuilder {
    return this.createInteractiveBlock(name, title);
  }

  /**
   * Create a container block (for nesting)
   */
  static createContainerBlock(name: string, title: string): BlockBuilder {
    return new BlockBuilder()
      .setName(name)
      .setTitle(title)
      .setCategory('design')
      .enableCommonSupports()
      .addSupport('html', false);
  }

  /**
   * Get the template buffer if set
   */
  getTemplate(): Buffer | undefined {
    return this.templateBuffer;
  }

  /**
   * Get the actions mapping
   */
  getActions(): Record<string, string> {
    return this.actions;
  }

  /**
   * Set the block topic ID (after registration)
   */
  setTopicId(topicId: string): this {
    this.blockTopicId = topicId;
    return this;
  }

  /**
   * Get the block topic ID
   */
  getTopicId(): string {
    if (!this.blockTopicId) {
      throw new Error('Block topic ID not set');
    }
    return this.blockTopicId;
  }

  /**
   * Get the block name (if set)
   */
  getName(): string | undefined {
    return this.block.name;
  }
}
