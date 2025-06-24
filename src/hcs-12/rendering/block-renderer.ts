/**
 * Block Renderer for HCS-12 HashLinks
 *
 * Renders Gutenberg blocks with HashLink integration
 */

import { Logger } from '../../utils/logger';
import { GutenbergBridge } from './gutenberg-bridge';
import { TemplateEngine, TemplateContext } from './template-engine';
import { BlockStateManager, BlockState } from './block-state-manager';
import { GutenbergBlockType, ActionRegistration } from '../types';
import { WasmExecutor } from '../wasm/wasm-executor';
import { NetworkType } from '../../utils/types';
import type { ActionRegistry } from '../registries/action-registry';
import type { Assembly } from '../assembly/assembly-engine';
import { HashLinkScanner } from './hashlink-scanner';
import { HashLinkResolver, RenderContext } from './hashlink-resolver';
import { BlockLoader } from '../registries/block-loader';
import { HRLResolver } from '../../utils/hrl-resolver';

export interface BlockDefinitionWithUI {
  id: string;
  template?: string;
  attributes?: Record<string, any>;
  styles?: string;

  p: 'hcs-12';
  op: 'register' | 'template' | 'pattern';
  name: string;
  version: string;
  blockJson?: GutenbergBlockType;
  t_id?: string;
  title?: string;
  description?: string;
  categories?: string[];
  content?: string | Record<string, any> | any[];
}

export interface RenderOptions {
  container?: string | HTMLElement;
  initialState?: BlockState;
  theme?: 'light' | 'dark';
  responsive?: boolean;
  assembly?: Assembly;
  actionRegistry?: ActionRegistry;
  network?: NetworkType;
  depth?: number;
  maxDepth?: number;
  parentContext?: RenderContext;
  blockLoader?: BlockLoader;
  hrlResolver?: HRLResolver;
}

export interface RenderResult {
  element?: HTMLElement;
  html?: string;
  cleanup?: () => void;
}

/**
 * Renders HashLink blocks to DOM or HTML
 */
export class BlockRenderer {
  private logger: Logger;
  private gutenbergBridge: GutenbergBridge;
  private templateEngine: TemplateEngine;
  private stateManager: BlockStateManager;
  private wasmExecutor?: WasmExecutor;
  private currentBlock?: BlockDefinitionWithUI;
  private currentOptions?: RenderOptions;
  private assembly?: Assembly;
  private actionRegistry?: ActionRegistry;
  private hashLinkScanner: HashLinkScanner;
  private hashLinkResolver?: HashLinkResolver;
  private blockLoader?: BlockLoader;
  private hrlResolver?: HRLResolver;
  private readonly MAX_DEPTH = 10;

  constructor(
    logger: Logger,
    gutenbergBridge: GutenbergBridge,
    templateEngine: TemplateEngine,
    stateManager: BlockStateManager,
  ) {
    this.logger = logger;
    this.gutenbergBridge = gutenbergBridge;
    this.templateEngine = templateEngine;
    this.stateManager = stateManager;
    this.hashLinkScanner = new HashLinkScanner(logger);
  }

  /**
   * Render a block
   */
  async render(
    block: BlockDefinitionWithUI,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    try {
      this.currentBlock = block;
      this.currentOptions = options;

      if (options.assembly) {
        this.assembly = options.assembly;
      }
      if (options.actionRegistry) {
        this.actionRegistry = options.actionRegistry;
      }

      if (options.network && !this.wasmExecutor) {
        this.wasmExecutor = new WasmExecutor(this.logger, options.network);
      }

      if (options.initialState) {
        this.stateManager.setBlockState(block.id, options.initialState);
      }

      let state = this.stateManager.getBlockState(block.id) || {
        attributes: {},
        actionResults: {},
      };

      if (!state.attributes || typeof state.attributes !== 'object') {
        this.logger.warn('Invalid state structure, fixing...', { state });
        state = {
          attributes: (state as any) || {},
          actionResults: {},
        };
      }

      let actions = {};
      let attributes = block.attributes || {};

      if (this.assembly) {
        const assemblyBlock = this.assembly.state?.blocks?.find(
          b => b.block_t_id === block.id || b.block_t_id === block.t_id,
        );

        if (assemblyBlock) {
          actions = assemblyBlock.actions || {};
          attributes = {
            ...assemblyBlock.attributes,
            ...attributes,
          };
        }
      }

      const defaultAttributes: Record<string, any> = {};
      if (block.attributes) {
        Object.entries(block.attributes).forEach(
          ([key, attrDef]: [string, any]) => {
            if (
              attrDef &&
              typeof attrDef === 'object' &&
              'default' in attrDef
            ) {
              defaultAttributes[key] = attrDef.default;
            }
          },
        );
      }

      const mergedAttributes: Record<string, any> = { ...defaultAttributes };

      if (attributes && typeof attributes === 'object') {
        Object.entries(attributes).forEach(([key, value]) => {
          if (typeof value !== 'object' || value === null) {
            mergedAttributes[key] = value;
          }
        });
      }

      if (state.attributes && typeof state.attributes === 'object') {
        Object.entries(state.attributes).forEach(([key, value]) => {
          if (typeof value !== 'object' || value === null) {
            mergedAttributes[key] = value;
          }
        });
      }

      state.attributes = { ...mergedAttributes };
      this.stateManager.setBlockState(block.id, state);

      const templateContext = {
        attributes: mergedAttributes,
        actions,
        blockId: block.id,
        actionResults: state.actionResults || {},
      };

      this.logger.debug('Template context', {
        blockId: block.id,
        attributes: templateContext.attributes,
        hasActions: !!actions,
        actionKeys: Object.keys(actions),
        rawState: state,
        mergedAttributes: mergedAttributes,
      });

      let html = await this.templateEngine.render(
        block.template || '',
        templateContext,
      );

      if (this.shouldProcessHashLinks(options)) {
        html = await this.processHashLinks(html, block, options);
      }

      if (options.container && typeof window !== 'undefined') {
        const container =
          typeof options.container === 'string'
            ? document.querySelector(options.container)
            : options.container;

        if (container instanceof HTMLElement) {
          container.innerHTML = html;

          if (block.styles) {
            this.applyStyles(block.id, block.styles);
          }

          this.setupEventHandlers(container, block.id);

          return {
            element: container,
            html,
            cleanup: () => this.cleanup(block.id),
          };
        }
      }

      return { html };
    } catch (error) {
      this.logger.error('Block render failed', {
        blockId: block.id,
        error,
      });
      throw error;
    }
  }

  /**
   * Apply block styles
   */
  private applyStyles(blockId: string, styles: string): void {
    if (typeof document === 'undefined') return;

    const styleId = `hashlink-styles-${blockId}`;
    let styleElement = document.getElementById(styleId);

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }

    styleElement.textContent = styles;
  }

  /**
   * Setup event handlers for block
   */
  private setupEventHandlers(container: HTMLElement, blockId: string): void {
    this.stateManager.onStateChange(blockId, state => {
      this.updateBlockUI(container, state);
    });

    container.querySelectorAll('[data-action]').forEach(element => {
      element.addEventListener('click', async e => {
        e.preventDefault();
        const actionTopicId = (element as HTMLElement).dataset.action;
        const paramsStr = (element as HTMLElement).dataset.params;

        this.logger.debug('Action button clicked', {
          actionTopicId,
          paramsStr,
          hasAction: !!actionTopicId,
        });

        if (actionTopicId) {
          await this.executeAction(blockId, actionTopicId, paramsStr);
        }
      });
    });
  }

  /**
   * Update the block display by re-rendering with new state
   */
  private async updateBlockDisplay(
    blockId: string,
    newState: BlockState,
  ): Promise<void> {
    try {
      this.logger.debug('updateBlockDisplay called', { blockId, newState });

      const blockElement = document.querySelector(
        `[data-block-id="${blockId}"]`,
      );

      if (!blockElement || !blockElement.parentElement) {
        this.logger.warn('Block element not found for re-render', { blockId });
        return;
      }

      const container = blockElement.parentElement;

      if (
        this.currentBlock &&
        this.currentBlock.id === blockId &&
        this.currentOptions
      ) {
        const updatedOptions = {
          ...this.currentOptions,
          container,
          initialState: newState,
        };

        const renderResult = await this.render(
          this.currentBlock,
          updatedOptions,
        );

        this.logger.debug('Block re-rendered with updated state', {
          blockId,
          newState,
        });
      } else {
      }
    } catch (error) {
      this.logger.error('Failed to re-render block', {
        blockId,
        error: error.message,
      });
    }
  }

  /**
   * Execute a WASM action
   */
  private async executeAction(
    blockId: string,
    actionTopicId: string,
    paramsStr?: string,
  ): Promise<void> {
    try {
      this.logger.debug('Executing action', { blockId, actionTopicId });

      let params = {};
      if (paramsStr) {
        try {
          params = JSON.parse(paramsStr);
        } catch (e) {
          this.logger.warn('Failed to parse action params', { paramsStr });
        }
      }

      const currentState = this.stateManager.getBlockState(blockId) || {
        attributes: {},
        actionResults: {},
      };

      if (this.wasmExecutor && this.actionRegistry) {
        this.logger.debug('Looking up action in registry', { actionTopicId });

        const action =
          await this.actionRegistry.getActionByTopicId(actionTopicId);

        this.logger.debug('Action lookup result', {
          found: !!action,
          actionTopicId,
          actionData: action,
        });

        if (!action) {
          throw new Error(`Action not found: ${actionTopicId}`);
        }

        this.logger.debug('Executing WASM', {
          actionData: action,
          params,
          state: currentState.attributes,
        });

        const result = await this.wasmExecutor.execute(action, {
          method: 'POST',
          params,
          state: currentState.attributes,
        });

        this.logger.debug('WASM execution result', { result });

        if (result.success && result.data) {
          const operation = (params as any).operation || 'default';

          let wasmData = result.data;
          if (wasmData.success && wasmData.data) {
            wasmData = wasmData.data;
          }

          const newState = {
            ...currentState,
            attributes: {
              ...currentState.attributes,
              ...wasmData,
            },
            actionResults: {
              ...currentState.actionResults,
              [operation]: wasmData,
            },
          };

          this.stateManager.updateBlockState(blockId, newState);

          await this.updateBlockDisplay(blockId, newState);
        } else {
          this.logger.error('Action execution failed', { result });
        }
      } else {
        this.stateManager.sendMessage(blockId, 'action', {
          action: actionTopicId,
          params,
        });
      }
    } catch (error) {
      this.logger.error('Failed to execute action', {
        blockId,
        actionTopicId,
        error: error.message,
      });

      this.stateManager.sendMessage(blockId, 'action-error', {
        action: actionTopicId,
        error: error.message,
      });
    }
  }

  /**
   * Update block UI on state change
   */
  private updateBlockUI(container: HTMLElement, state: BlockState): void {
    Object.entries(state).forEach(([key, value]) => {
      const elements = container.querySelectorAll(`[data-bind="${key}"]`);
      elements.forEach(element => {
        if (element instanceof HTMLElement) {
          element.textContent = String(value);
        }
      });
    });
  }

  /**
   * Cleanup block resources
   */
  private cleanup(blockId: string): void {
    const styleElement = document.getElementById(`hashlink-styles-${blockId}`);
    if (styleElement) {
      styleElement.remove();
    }

    this.stateManager.removeBlockState(blockId);
  }

  /**
   * Check if HashLink processing should be enabled
   */
  private shouldProcessHashLinks(options: RenderOptions): boolean {
    const depth = options.depth || 0;
    const maxDepth = options.maxDepth || this.MAX_DEPTH;

    if (depth >= maxDepth) {
      this.logger.warn(
        'Max render depth reached, skipping HashLink processing',
        {
          depth,
          maxDepth,
        },
      );
      return false;
    }

    return !!(options.network && (options.blockLoader || this.blockLoader));
  }

  /**
   * Initialize HashLink resolver if needed
   */
  private ensureHashLinkResolver(options: RenderOptions): void {
    if (!this.hashLinkResolver && options.network) {
      this.blockLoader = options.blockLoader || this.blockLoader;
      this.hrlResolver = options.hrlResolver || this.hrlResolver;

      if (this.blockLoader && this.hrlResolver) {
        this.hashLinkResolver = new HashLinkResolver(
          this.logger,
          this.blockLoader,
          this.hrlResolver,
          options.network,
        );
      }
    }
  }

  /**
   * Process HashLinks in rendered HTML
   */
  private async processHashLinks(
    html: string,
    parentBlock: BlockDefinitionWithUI,
    options: RenderOptions,
  ): Promise<string> {
    this.ensureHashLinkResolver(options);

    if (!this.hashLinkResolver) {
      this.logger.warn('HashLink resolver not available, skipping processing');
      return html;
    }

    this.hashLinkResolver.pushRenderStack(parentBlock.id);

    try {
      const references = await this.hashLinkScanner.scanTemplate(html);

      if (references.length === 0) {
        return html;
      }

      this.logger.debug('Processing HashLinks', {
        parentBlockId: parentBlock.id,
        referenceCount: references.length,
      });

      const parentContext: RenderContext = {
        blockId: parentBlock.id,
        depth: (options.depth || 0) + 1,
        parentContext: options.parentContext,
        attributes: options.initialState?.attributes || {},
        actions: {},
        assembly: this.assembly,
        maxDepth: options.maxDepth || this.MAX_DEPTH,
      };

      if (this.assembly) {
        const assemblyBlock = this.assembly.state?.blocks?.find(
          b =>
            b.block_t_id === parentBlock.id ||
            b.block_t_id === parentBlock.t_id,
        );
        if (assemblyBlock?.actions) {
          parentContext.actions = assemblyBlock.actions;
        }
      }

      let processedHtml = html;

      for (let i = 0; i < references.length; i++) {
        const ref = references[i];

        try {
          const resolved = await this.hashLinkResolver.resolveReference(
            ref,
            parentContext,
          );

          if (resolved.error) {
            this.logger.error('Failed to resolve HashLink', {
              uri: ref.uri,
              error: resolved.error,
            });

            const errorHtml = `<!-- HashLink Error: ${resolved.error} -->`;
            processedHtml = processedHtml.replace(ref.placeholder, errorHtml);
            continue;
          }

          let childHtml: string;

          if (resolved.definition) {
            const childBlock: BlockDefinitionWithUI = {
              id: resolved.blockId,
              template: resolved.template || '',
              attributes: resolved.definition.attributes,
              p: 'hcs-12',
              op: 'register',
              name: resolved.definition.name,
              version: '1.0.0',
              title: resolved.definition.title,
              description: resolved.definition.description,
            };

            const childState = {
              attributes: resolved.attributes,
              actionResults: {},
            };

            const childTemplateContext = {
              attributes: resolved.attributes,
              actions: resolved.actions,
              blockId: resolved.blockId,
              actionResults: {},
            };

            if (resolved.template) {
              childHtml = await this.templateEngine.render(
                resolved.template,
                childTemplateContext,
              );

              const childOptions: RenderOptions = {
                ...options,
                depth: parentContext.depth,
                parentContext,
                initialState: childState,
              };

              if (this.shouldProcessHashLinks(childOptions)) {
                childHtml = await this.processHashLinks(
                  childHtml,
                  childBlock,
                  childOptions,
                );
              }
            } else {
              childHtml = '<!-- Block has no template -->';
            }
          } else if (resolved.template) {
            childHtml = resolved.template;
          } else {
            childHtml = '<!-- Empty block -->';
          }

          if (ref.loading === 'lazy') {
            childHtml = this.wrapLazyLoad(childHtml, ref);
          }

          processedHtml = processedHtml.replace(ref.placeholder, childHtml);
        } catch (error) {
          this.logger.error('Error processing HashLink', {
            uri: ref.uri,
            error: error.message,
          });

          const errorHtml = `<!-- HashLink Error: ${error.message} -->`;
          processedHtml = processedHtml.replace(ref.placeholder, errorHtml);
        }
      }

      return processedHtml;
    } finally {
      this.hashLinkResolver.popRenderStack(parentBlock.id);
    }
  }

  /**
   * Wrap content for lazy loading
   */
  private wrapLazyLoad(html: string, ref: any): string {
    const wrapperId = `lazy-${ref.uri.replace(/[^a-zA-Z0-9]/g, '-')}`;
    return `
      <div id="${wrapperId}" class="hashlink-lazy-container" data-hashlink-lazy="${ref.uri}">
        <div class="hashlink-lazy-placeholder">Loading...</div>
        <template class="hashlink-lazy-content">${html}</template>
      </div>
    `;
  }
}
