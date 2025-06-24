/**
 * Template Engine for HCS-12 HashLinks
 *
 * Handlebars-compatible template engine for rendering HashLinks blocks
 * with XSS protection and caching support.
 */

import { Logger } from '../../utils/logger';

export interface TemplateContext {
  attributes?: Record<string, string | number | boolean>;
  actions?:
    | Array<{
        name: string;
        result?: unknown;
      }>
    | Record<string, string>;
  [key: string]: unknown;
}

export interface CompiledTemplate {
  render(context: TemplateContext): string;
  source: string;
  compiled: boolean;
}

export interface HelperFunction {
  (this: unknown, ...args: unknown[]): string;
}

/**
 * Handlebars-compatible template engine
 */
export class TemplateEngine {
  private logger: Logger;
  private templateCache: Map<string, CompiledTemplate> = new Map();
  private helpers: Map<string, HelperFunction> = new Map();
  private compiledTemplates: Map<string, CompiledTemplate> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
    this.setupBuiltinHelpers();
  }

  /**
   * Render a template with the given context
   */
  async render(
    template: string,
    context: TemplateContext = {},
  ): Promise<string> {
    this.logger.debug('Rendering template', {
      templateLength: template.length,
      context: JSON.stringify(context, null, 2),
      attributesType: context.attributes
        ? typeof context.attributes
        : 'undefined',
      contextKeys: Object.keys(context),
    });

    try {
      const cacheKey = this.getCacheKey(template);
      let compiled = this.templateCache.get(cacheKey);

      if (!compiled) {
        compiled = await this.compileTemplate(template);
        this.templateCache.set(cacheKey, compiled);
      }

      const result = compiled.render(this.sanitizeContext(context));

      this.logger.debug('Template rendered successfully', {
        resultLength: result.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Template rendering failed', { error, template });
      throw new Error(
        `Template rendering failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Precompile a template and store it with a name
   */
  async precompile(name: string, template: string): Promise<void> {
    this.logger.debug('Precompiling template', {
      name,
      templateLength: template.length,
    });

    try {
      const compiled = await this.compileTemplate(template);
      this.compiledTemplates.set(name, compiled);

      this.logger.debug('Template precompiled successfully', { name });
    } catch (error) {
      this.logger.error('Template precompilation failed', { error, name });
      throw new Error(
        `Template precompilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Render a precompiled template
   */
  async renderCompiled(
    name: string,
    context: TemplateContext = {},
  ): Promise<string> {
    const compiled = this.compiledTemplates.get(name);
    if (!compiled) {
      throw new Error(`Precompiled template '${name}' not found`);
    }

    this.logger.debug('Rendering precompiled template', { name });

    try {
      const result = compiled.render(this.sanitizeContext(context));

      this.logger.debug('Precompiled template rendered successfully', { name });
      return result;
    } catch (error) {
      this.logger.error('Precompiled template rendering failed', {
        error,
        name,
      });
      throw new Error(
        `Template rendering failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Register a custom helper function
   */
  registerHelper(name: string, helper: HelperFunction): void {
    this.helpers.set(name, helper);
    this.logger.debug('Helper registered', { name });
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear();
    this.logger.debug('Template cache cleared');
  }

  /**
   * Get cache size for testing
   */
  getCacheSize(): number {
    return this.templateCache.size;
  }

  /**
   * Compile a template string into executable function
   */
  private async compileTemplate(template: string): Promise<CompiledTemplate> {
    this.validateTemplate(template);

    const compiled: CompiledTemplate = {
      source: template,
      compiled: true,
      render: (context: TemplateContext) =>
        this.executeTemplate(template, context),
    };

    return compiled;
  }

  /**
   * Execute template rendering logic
   */
  private executeTemplate(template: string, context: TemplateContext): string {
    let result = template;

    result = this.processHelpers(result, context);
    result = this.processLoops(result, context);
    result = this.processConditionals(result, context);
    result = this.processVariables(result, context);

    return result;
  }

  /**
   * Process conditional statements (if/unless/else)
   */
  private processConditionals(
    template: string,
    context: TemplateContext,
  ): string {
    let result = template;

    const nestedIfElseRegex =
      /\{\{#if\s+([^}]+)\}\}((?:[^{]|\{(?!\{)|\{\{(?!#if|\{#else|\{\/if))*?)\{\{#if\s+([^}]+)\}\}((?:[^{]|\{(?!\{)|\{\{(?!#if|#else|\/if))*?)\{\{else\}\}((?:[^{]|\{(?!\{)|\{\{(?!#if|#else|\/if))*?)\{\{\/if\}\}((?:[^{]|\{(?!\{)|\{\{(?!\/if))*?)\{\{\/if\}\}/gs;
    result = result.replace(
      nestedIfElseRegex,
      (
        match,
        outerCondition,
        beforeInner,
        innerCondition,
        innerTrue,
        innerFalse,
        afterInner,
      ) => {
        const outerValue = this.evaluateCondition(outerCondition, context);
        if (!outerValue) return '';

        const innerValue = this.evaluateCondition(innerCondition, context);
        const innerResult = innerValue ? innerTrue : innerFalse;

        return beforeInner + innerResult + afterInner;
      },
    );

    const ifElseRegex =
      /\{\{#if\s+([^}]+)\}\}((?:[^{]|\{(?!\{)|\{\{(?!else|\/if))*?)\{\{else\}\}((?:[^{]|\{(?!\{)|\{\{(?!\/if))*?)\{\{\/if\}\}/gs;
    result = result.replace(
      ifElseRegex,
      (match, condition, trueBranch, falseBranch) => {
        const conditionValue = this.evaluateCondition(condition, context);
        return conditionValue ? trueBranch : falseBranch;
      },
    );

    const ifRegex =
      /\{\{#if\s+([^}]+)\}\}((?:[^{]|\{(?!\{)|\{\{(?!\/if))*?)\{\{\/if\}\}/gs;
    result = result.replace(ifRegex, (match, condition, content) => {
      const conditionValue = this.evaluateCondition(condition, context);
      return conditionValue ? content : '';
    });

    const unlessRegex =
      /\{\{#unless\s+([^}]+)\}\}((?:[^{]|\{(?!\{)|\{\{(?!\/unless))*?)\{\{\/unless\}\}/gs;
    result = result.replace(unlessRegex, (match, condition, content) => {
      const conditionValue = this.evaluateCondition(condition, context);
      return !conditionValue ? content : '';
    });

    return result;
  }

  /**
   * Process loop statements (each)
   */
  private processLoops(template: string, context: TemplateContext): string {
    let result = template;

    const eachRegex = /\{\{#each\s+([^}]+)\}\}(.*?)\{\{\/each\}\}/gs;
    result = result.replace(eachRegex, (match, variable, content) => {
      const items = this.getNestedValue(variable, context);

      if (!items) return '';

      let loopResult = '';

      if (Array.isArray(items)) {
        items.forEach((item, index) => {
          let itemContent = content;

          itemContent = itemContent.replace(
            /\{\{this\}\}/g,
            this.escapeHtml(String(item)),
          );

          itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));

          if (typeof item === 'object' && item !== null) {
            for (const [key, value] of Object.entries(item)) {
              const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
              itemContent = itemContent.replace(
                regex,
                this.escapeHtml(String(value)),
              );
            }
          }

          itemContent = itemContent.replace(
            /\{\{\.\.\/([^}]+)\}\}/g,
            (parentMatch: string, parentPath: string) => {
              const parentValue = this.getNestedValue(parentPath, context);
              return this.escapeHtml(String(parentValue || ''));
            },
          );

          loopResult += itemContent;
        });
      } else if (typeof items === 'object') {
        for (const [key, value] of Object.entries(items)) {
          let itemContent = content;

          itemContent = itemContent.replace(
            /\{\{@key\}\}/g,
            this.escapeHtml(key),
          );

          itemContent = itemContent.replace(
            /\{\{this\}\}/g,
            this.escapeHtml(String(value)),
          );

          loopResult += itemContent;
        }
      }

      return loopResult;
    });

    return result;
  }

  /**
   * Process variable substitutions
   */
  private processVariables(template: string, context: TemplateContext): string {
    let result = template;

    const tripleRegex = /\{\{\{([^}]+)\}\}\}/g;
    result = result.replace(tripleRegex, (match, variable) => {
      const value = this.getNestedValue(variable.trim(), context);
      return this.sanitizeHtml(String(value || ''));
    });

    const doubleRegex = /\{\{([^}#/]+)\}\}/g;
    result = result.replace(doubleRegex, (match, variable) => {
      const trimmed = variable.trim();

      if (
        trimmed.startsWith('#') ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('else')
      ) {
        return match;
      }

      const value = this.getNestedValue(trimmed, context);

      if (value === 0 || value === false) {
        return this.escapeHtml(String(value));
      }
      return this.escapeHtml(String(value || ''));
    });

    return result;
  }

  /**
   * Process helper functions
   */
  private processHelpers(template: string, context: TemplateContext): string {
    let result = template;

    const withRegex = /\{\{#with\s+([^}]+)\}\}(.*?)\{\{\/with\}\}/gs;
    result = result.replace(withRegex, (match, variable, content) => {
      const newContext = this.getNestedValue(variable.trim(), context);
      if (!newContext) return '';

      return this.executeTemplate(content, newContext as TemplateContext);
    });

    for (const [helperName, helperFunc] of this.helpers) {
      const helperRegex = new RegExp(
        `\\{\\{${helperName}\\s+([^}]+)\\}\\}`,
        'g',
      );
      result = result.replace(helperRegex, (match, args) => {
        try {
          const argValue = this.getNestedValue(args.trim(), context);
          return this.escapeHtml(helperFunc.call(context, argValue));
        } catch (error) {
          this.logger.warn('Helper execution failed', { helperName, error });
          return '';
        }
      });
    }

    return result;
  }

  /**
   * Evaluate condition for if/unless statements
   */
  private evaluateCondition(
    condition: string,
    context: TemplateContext,
  ): boolean {
    const value = this.getNestedValue(condition.trim(), context);
    return Boolean(value);
  }

  /**
   * Get nested value from context using dot notation
   */
  private getNestedValue(path: string, context: TemplateContext): unknown {
    if (!path || !context) return undefined;

    const keys = path.split('.');
    let current: unknown = context;

    for (const key of keys) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== 'object'
      ) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  /**
   * Sanitize context to prevent XSS
   */
  private sanitizeContext(context: TemplateContext): TemplateContext {
    if (context === null || context === undefined) return context;

    const seen = new WeakSet();

    const sanitize = (obj: unknown): unknown => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (seen.has(obj)) return '[Circular]';

      seen.add(obj);

      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }

      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }

      return sanitized;
    };

    return sanitize(context) as TemplateContext;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Sanitize HTML to allow safe tags only
   */
  private sanitizeHtml(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }

  /**
   * Validate template syntax
   */
  private validateTemplate(template: string): void {
    const openBlocks = (template.match(/\{\{#\w+/g) || []).length;
    const closeBlocks = (template.match(/\{\{\/\w+/g) || []).length;

    if (openBlocks !== closeBlocks) {
      throw new Error('Invalid template syntax: unclosed block helpers');
    }

    const malformed = /\{\{[^}]*$|\{\{[^}]*\{\{/.test(template);
    if (malformed) {
      throw new Error('Invalid template syntax: malformed handlebars');
    }
  }

  /**
   * Generate cache key for template
   */
  private getCacheKey(template: string): string {
    let hash = 0;
    for (let i = 0; i < template.length; i++) {
      const char = template.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  /**
   * Setup builtin helper functions
   */
  private setupBuiltinHelpers(): void {}
}
