/**
 * Permission System for HCS-12 HashLinks
 *
 * Manages capabilities, roles, and access control for HashLink
 * actions and resources with comprehensive security features.
 */

import { Logger } from '../../utils/logger';

export interface DelegationInfo {
  delegatorId: string;
  permissions: string[];
  validUntil: Date;
}

export type PermissionConditionValue =
  | string
  | number
  | boolean
  | Date
  | { maxRequests: number; windowMs: number }
  | { keyGenerator: (context: UserContext) => string }
  | {
      requiredContext?: Record<string, string>;
      customValidator?: (context: UserContext) => boolean;
    };

export interface PermissionCondition {
  type: 'time-based' | 'rate-limit' | 'conditional' | 'custom';
  value: PermissionConditionValue;
}

export interface AuditEvent {
  timestamp: Date;
  action: string;
  userId: string;
  resourceId?: string;
  result: boolean;
  reason?: string;
}

export interface PermissionSystemConfig {
  logger: Logger;
  enableAudit?: boolean;
  enableRateLimiting?: boolean;
  defaultDenyPolicy?: boolean;
}

export interface Capability {
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval?: boolean;
  inherits?: string[];
  requires?: string[];
}

export interface Role {
  name: string;
  capabilities: string[];
  inherits?: string[];
}

export interface UserContext {
  userId: string;
  capabilities?: string[];
  roles?: string[];
  actingAs?: string;
  delegation?: DelegationInfo;
  delegationId?: string;
}

export interface Resource {
  id: string;
  type: string;
  owner: string;
  permissions: {
    read?: string[];
    write?: string[];
    delete?: string[];
    execute?: string[];
    [key: string]: string[] | undefined;
  };
  groups?: Record<string, string[]>;
}

export interface Action {
  id: string;
  requiredCapabilities: string[];
  metadata?: {
    riskLevel?: string;
    requiresSignature?: boolean;
  };
  sideEffects?: string[];
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  missingCapabilities?: string[];
  grantedCapabilities?: string[];
  securityAlert?: boolean;
  conditions?: PermissionCondition[];
}

export type PolicyConditions =
  | { type: 'time-based'; validFrom?: Date; validUntil?: Date }
  | {
      type: 'rate-limit';
      maxRequests: number;
      windowMs: number;
      keyGenerator: (context: UserContext) => string;
    }
  | {
      type: 'conditional';
      requiredContext?: Record<string, string>;
      customValidator?: (context: UserContext) => boolean;
    };

export interface Policy {
  id: string;
  type: 'time-based' | 'rate-limit' | 'conditional';
  conditions: PolicyConditions;
}

export interface PermissionDelegation {
  from: string;
  to: string;
  capabilities: string[];
  validUntil: Date;
  conditions?: PermissionCondition[];
}

export interface PermissionBoundary {
  maxCapabilities?: string[];
  deniedCapabilities?: string[];
  allowedResources?: string[];
  deniedResources?: string[];
}

export interface ComplianceReport {
  summary: {
    totalChecks: number;
    allowedCount: number;
    deniedCount: number;
  };
  byUser: Record<string, { allowed: number; denied: number }>;
  byAction?: Record<string, { allowed: number; denied: number }>;
  byResource?: Record<string, { allowed: number; denied: number }>;
}

/**
 * Comprehensive permission system for HashLinks
 */
export class PermissionSystem {
  private logger: Logger;
  private config: PermissionSystemConfig;
  private capabilities: Map<string, Capability> = new Map();
  private roles: Map<string, Role> = new Map();
  private delegations: Map<string, PermissionDelegation> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private auditLogger?: (event: AuditEvent) => void;
  private permissionBoundary?: PermissionBoundary;
  private auditLog: AuditEvent[] = [];

  constructor(config: PermissionSystemConfig) {
    this.config = config;
    this.logger = config.logger;
    this.initializeDefaultCapabilities();
  }

  /**
   * Register a capability
   */
  registerCapability(capability: Capability): void {
    this.capabilities.set(capability.name, capability);
    this.logger.debug('Capability registered', { name: capability.name });
  }

  /**
   * Check if capability exists
   */
  hasCapability(name: string): boolean {
    return this.capabilities.has(name);
  }

  /**
   * Get capability definition
   */
  getCapability(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  /**
   * Get effective capabilities including inheritance
   */
  getEffectiveCapabilities(capabilities: string[]): string[] {
    const effective = new Set<string>();

    const processCapability = (name: string) => {
      if (effective.has(name)) return;

      effective.add(name);
      const capability = this.capabilities.get(name);

      if (capability?.inherits) {
        capability.inherits.forEach(parent => processCapability(parent));
      }
    };

    capabilities.forEach(cap => processCapability(cap));
    return Array.from(effective);
  }

  /**
   * Validate capability requirements
   */
  validateCapabilities(
    required: string[],
    provided: string[],
  ): { valid: boolean; missing: string[] } {
    const effective = this.getEffectiveCapabilities(provided);
    const missing: string[] = [];

    for (const req of required) {
      const capability = this.capabilities.get(req);

      if (!effective.includes(req)) {
        if (capability?.requires) {
          const hasRequired = capability.requires.some(r =>
            effective.includes(r),
          );
          if (!hasRequired) {
            missing.push(req);
            missing.push(...capability.requires);
          }
        } else {
          missing.push(req);
        }
      }
    }

    return {
      valid: missing.length === 0,
      missing: [...new Set(missing)],
    };
  }

  /**
   * Register a role
   */
  registerRole(role: Role): void {
    this.roles.set(role.name, role);
    this.logger.debug('Role registered', { name: role.name });
  }

  /**
   * Get role capabilities including inheritance
   */
  async getRoleCapabilities(context: UserContext): Promise<string[]> {
    const capabilities = new Set<string>();

    const processRole = (roleName: string) => {
      const role = this.roles.get(roleName);
      if (!role) return;

      role.capabilities.forEach(cap => capabilities.add(cap));

      if (role.inherits) {
        role.inherits.forEach(parent => processRole(parent));
      }
    };

    context.roles?.forEach(role => processRole(role));
    context.capabilities?.forEach(cap => capabilities.add(cap));

    return Array.from(capabilities);
  }

  /**
   * Validate action permissions
   */
  async validateActionPermissions(
    action: Action,
    context: UserContext,
  ): Promise<ValidationResult> {
    try {
      if (action.sideEffects) {
        const escalation = this.detectPrivilegeEscalation(action, context);
        if (escalation) {
          return {
            allowed: false,
            reason: 'Privilege escalation attempt detected',
            securityAlert: true,
          };
        }
      }

      const userCapabilities = await this.getRoleCapabilities(context);

      const validation = this.validateCapabilities(
        action.requiredCapabilities,
        userCapabilities,
      );

      if (!validation.valid) {
        return {
          allowed: false,
          reason: 'Missing required capabilities',
          missingCapabilities: validation.missing,
        };
      }

      if (this.permissionBoundary) {
        const boundaryCheck = this.checkPermissionBoundary(action, context);
        if (!boundaryCheck.allowed) {
          return boundaryCheck;
        }
      }

      if (this.config.enableAudit) {
        this.logAuditEvent({
          action: `Permission check: ${action.id}`,
          userId: context.userId,
          resourceId: action.id,
          result: true,
          timestamp: new Date(),
        });
      }

      return {
        allowed: true,
        grantedCapabilities: action.requiredCapabilities,
      };
    } catch (error) {
      this.logger.error('Permission validation error', {
        error,
        action,
        context,
      });
      return {
        allowed: false,
        reason: 'Permission validation error',
      };
    }
  }

  /**
   * Validate resource access
   */
  async validateResourceAccess(
    resource: Resource,
    operation: string,
    context: UserContext,
  ): Promise<ValidationResult> {
    try {
      if (resource.owner === context.userId) {
        return { allowed: true };
      }

      const allowedEntities = resource.permissions[operation] || [];

      if (allowedEntities.includes('public')) {
        return { allowed: true };
      }

      if (context.roles?.some(role => allowedEntities.includes(role))) {
        return { allowed: true };
      }

      if (resource.groups) {
        for (const [groupName, members] of Object.entries(resource.groups)) {
          if (
            allowedEntities.includes(groupName) &&
            members.includes(context.userId)
          ) {
            return { allowed: true };
          }
        }
      }

      return {
        allowed: false,
        reason: 'Insufficient permissions for resource access',
      };
    } catch (error) {
      this.logger.error('Resource access validation error', {
        error,
        resource,
        context,
      });
      return {
        allowed: false,
        reason: 'Resource access validation error',
      };
    }
  }

  /**
   * Evaluate policy
   */
  async evaluatePolicy(
    policy: Policy,
    context: UserContext,
  ): Promise<ValidationResult> {
    switch (policy.type) {
      case 'time-based':
        return this.evaluateTimeBasedPolicy(policy, context);

      case 'rate-limit':
        return this.evaluateRateLimitPolicy(policy, context);

      case 'conditional':
        return this.evaluateConditionalPolicy(policy, context);

      default:
        return {
          allowed: false,
          reason: 'Unknown policy type',
        };
    }
  }

  /**
   * Delegate permissions
   */
  async delegatePermissions(delegation: PermissionDelegation): Promise<string> {
    const id = `delegation-${Date.now()}-${Math.random()}`;
    this.delegations.set(id, delegation);

    this.logger.info('Permissions delegated', {
      from: delegation.from,
      to: delegation.to,
      capabilities: delegation.capabilities,
    });

    return id;
  }

  /**
   * Revoke delegation
   */
  async revokeDelegation(delegationId: string): Promise<void> {
    this.delegations.delete(delegationId);
    this.logger.info('Delegation revoked', { delegationId });
  }

  /**
   * Validate delegated permissions
   */
  async validateDelegatedPermissions(
    capability: string,
    context: UserContext,
  ): Promise<ValidationResult> {
    const delegation = context.delegationId
      ? this.delegations.get(context.delegationId)
      : Array.from(this.delegations.values()).find(
          d => d.to === context.userId && d.capabilities.includes(capability),
        );

    if (!delegation) {
      return {
        allowed: false,
        reason: 'Delegation not found or revoked',
      };
    }

    if (new Date() > delegation.validUntil) {
      return {
        allowed: false,
        reason: 'Delegation expired',
      };
    }

    if (!delegation.capabilities.includes(capability)) {
      return {
        allowed: false,
        reason: 'Capability not delegated',
      };
    }

    return {
      allowed: true,
      conditions: delegation.conditions,
    };
  }

  /**
   * Set audit logger
   */
  setAuditLogger(logger: (event: AuditEvent) => void): void {
    this.auditLogger = logger;
  }

  /**
   * Set permission boundary
   */
  setPermissionBoundary(boundary: PermissionBoundary): void {
    this.permissionBoundary = boundary;
  }

  /**
   * Log permission event
   */
  async logPermissionEvent(event: AuditEvent): Promise<void> {
    this.auditLog.push(event);

    if (this.auditLogger) {
      this.auditLogger(event);
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(options: {
    startDate: Date;
    endDate: Date;
    groupBy?: string;
  }): Promise<ComplianceReport> {
    const relevantEvents = this.auditLog.filter(
      event =>
        event.timestamp.getTime() >= options.startDate.getTime() &&
        event.timestamp.getTime() <= options.endDate.getTime(),
    );

    const summary = {
      totalChecks: relevantEvents.length,
      allowedCount: relevantEvents.filter(e => e.result).length,
      deniedCount: relevantEvents.filter(e => !e.result).length,
    };

    const byUser: Record<string, any> = {};

    relevantEvents.forEach(event => {
      if (!byUser[event.userId]) {
        byUser[event.userId] = {
          total: 0,
          allowed: 0,
          denied: 0,
        };
      }

      byUser[event.userId].total++;
      if (event.result) {
        byUser[event.userId].allowed++;
      } else {
        byUser[event.userId].denied++;
      }
    });

    return {
      summary,
      byUser,
    };
  }

  /**
   * Initialize default capabilities
   */
  private initializeDefaultCapabilities(): void {
    const defaults: Capability[] = [
      {
        name: 'BASIC_ACCESS',
        description: 'Basic system access',
        riskLevel: 'low',
      },
      {
        name: 'ACCOUNT_READ',
        description: 'Read account information',
        riskLevel: 'low',
      },
      {
        name: 'CRYPTO_TRANSFER',
        description: 'Transfer cryptocurrency',
        riskLevel: 'high',
        requiresApproval: true,
      },
      {
        name: 'TOKEN_CREATE',
        description: 'Create new tokens',
        riskLevel: 'high',
        requiresApproval: true,
      },
      {
        name: 'ADMIN_ACCESS',
        description: 'Administrative access',
        riskLevel: 'critical',
        requiresApproval: true,
      },
    ];

    defaults.forEach(cap => this.registerCapability(cap));
  }

  /**
   * Evaluate time-based policy
   */
  private evaluateTimeBasedPolicy(
    policy: Policy,
    context: UserContext,
  ): ValidationResult {
    if (policy.conditions.type !== 'time-based') {
      return { allowed: false, reason: 'Invalid policy type' };
    }

    const now = new Date();
    const { validFrom, validUntil } = policy.conditions;

    if (validFrom && now < validFrom) {
      return {
        allowed: false,
        reason: 'Policy not yet active',
      };
    }

    if (validUntil && now > validUntil) {
      return {
        allowed: false,
        reason: 'Policy expired',
      };
    }

    return { allowed: true };
  }

  /**
   * Evaluate rate limit policy
   */
  private evaluateRateLimitPolicy(
    policy: Policy,
    context: UserContext,
  ): ValidationResult {
    if (policy.conditions.type !== 'rate-limit') {
      return { allowed: false, reason: 'Invalid policy type' };
    }

    const key = policy.conditions.keyGenerator(context);

    if (!this.rateLimiters.has(policy.id)) {
      this.rateLimiters.set(
        policy.id,
        new RateLimiter({
          maxRequests: policy.conditions.maxRequests,
          windowMs: policy.conditions.windowMs,
        }),
      );
    }

    const limiter = this.rateLimiters.get(policy.id)!;
    const allowed = limiter.tryConsume(key);

    return {
      allowed,
      reason: allowed ? undefined : 'Rate limit exceeded',
    };
  }

  /**
   * Evaluate conditional policy
   */
  private evaluateConditionalPolicy(
    policy: Policy,
    context: UserContext,
  ): ValidationResult {
    if (policy.conditions.type !== 'conditional') {
      return { allowed: false, reason: 'Invalid policy type' };
    }

    const { requiredContext, customValidator } = policy.conditions;

    if (requiredContext) {
      for (const [key, value] of Object.entries(requiredContext)) {
        if ((context as any)[key] !== value) {
          return {
            allowed: false,
            reason: `Missing required context: ${key}`,
          };
        }
      }
    }

    if (customValidator && !customValidator(context)) {
      return {
        allowed: false,
        reason: 'Custom validation failed',
      };
    }

    return { allowed: true };
  }

  /**
   * Detect privilege escalation attempts
   */
  private detectPrivilegeEscalation(
    action: Action,
    context: UserContext,
  ): boolean {
    if (!action.sideEffects) return false;

    const dangerousEffects = [
      'GRANT_ADMIN',
      'BYPASS_SECURITY',
      'MODIFY_PERMISSIONS',
    ];
    return action.sideEffects.some(effect => dangerousEffects.includes(effect));
  }

  /**
   * Check permission boundary
   */
  private checkPermissionBoundary(
    action: Action,
    context: UserContext,
  ): ValidationResult {
    if (!this.permissionBoundary) return { allowed: true };

    const { deniedCapabilities } = this.permissionBoundary;

    if (deniedCapabilities) {
      const hasDenied = action.requiredCapabilities.some(cap =>
        deniedCapabilities.includes(cap),
      );

      if (hasDenied) {
        return {
          allowed: false,
          reason: 'Permission boundary violation',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Log audit event
   */
  private logAuditEvent(event: AuditEvent): void {
    this.auditLog.push(event);

    if (this.auditLogger) {
      this.auditLogger(event);
    }
  }
}

/**
 * Simple rate limiter implementation
 */
class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(config: { maxRequests: number; windowMs: number }) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  tryConsume(key: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(key) || [];

    const validRequests = requests.filter(time => now - time < this.windowMs);

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    validRequests.push(now);
    this.requests.set(key, validRequests);

    return true;
  }
}
