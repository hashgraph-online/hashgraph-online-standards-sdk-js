/**
 * Zod validation schemas for HCS-12 registries
 *
 * Provides comprehensive validation for all HCS-12 registration types
 * following the standard specification exactly.
 */

import { z } from 'zod';

/**
 * Common HCS-12 protocol fields
 */
const baseRegistrationSchema = z.object({
  p: z.literal('hcs-12'),
});

/**
 * Hedera address format validation
 */
const hederaAddressSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Invalid Hedera address format');

/**
 * SHA-256 hash format validation
 */
const sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format');

/**
 * Source structure schema
 */
const sourceStructureSchema = z.object({
  format: z.enum(['tar.gz', 'zip', 'car']),
  root_manifest: z.string(),
  includes_lockfile: z.boolean(),
  workspace_members: z.array(z.string()).optional(),
});

/**
 * Source verification schema
 */
const sourceVerificationSchema = z.object({
  source_t_id: hederaAddressSchema,
  source_hash: sha256HashSchema,
  compiler_version: z.string(),
  cargo_version: z.string(),
  target: z.literal('wasm32-unknown-unknown'),
  profile: z.string(),
  build_flags: z.array(z.string()),
  lockfile_hash: sha256HashSchema,
  source_structure: sourceStructureSchema,
});

/**
 * Validation rule schema (mirrors Zod API)
 */
const validationRuleSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    required: z.array(z.string()).optional(),
    properties: z.record(validationRuleSchema).optional(),
    pattern: z.string().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),

    regex: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    length: z.number().optional(),
    email: z.boolean().optional(),
    url: z.boolean().optional(),
    uuid: z.boolean().optional(),
    cuid: z.boolean().optional(),
    cuid2: z.boolean().optional(),
    ulid: z.boolean().optional(),
    datetime: z.boolean().optional(),
    ip: z.boolean().optional(),
    startsWith: z.string().optional(),
    endsWith: z.string().optional(),
    includes: z.string().optional(),

    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    int: z.boolean().optional(),
    positive: z.boolean().optional(),
    nonnegative: z.boolean().optional(),
    negative: z.boolean().optional(),
    nonpositive: z.boolean().optional(),
    multipleOf: z.number().optional(),
    finite: z.boolean().optional(),
    safe: z.boolean().optional(),

    nonempty: z.boolean().optional(),

    literal: z.union([z.string(), z.number(), z.boolean()]).optional(),
    enum: z.array(z.string()).optional(),
    nullable: z.boolean().optional(),
    nullish: z.boolean().optional(),
    optional: z.boolean().optional(),

    element: z.any().optional(),
    shape: z.record(z.any()).optional(),
    strict: z.boolean().optional(),
    passthrough: z.boolean().optional(),
    catchall: z.any().optional(),
  }),
);

/**
 * Action registration schema - follows HCS-12 spec exactly
 */
export const actionRegistrationSchema = z.object({
  p: z.literal('hcs-12'),
  op: z.literal('register'),
  t_id: hederaAddressSchema,
  hash: sha256HashSchema,
  wasm_hash: sha256HashSchema,
  js_t_id: hederaAddressSchema.optional(),
  js_hash: sha256HashSchema.optional(),
  interface_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Invalid version format')
    .optional(),
  info_t_id: hederaAddressSchema.optional(),
  source_verification: sourceVerificationSchema.optional(),
  previous_version: z.string().optional(),
  migration_notes: z.string().optional(),
  validation_rules: z.record(validationRuleSchema).optional(),
  m: z.string().optional(),
});

/**
 * Block registration schema - follows HCS-12 spec exactly
 */
export const blockRegistrationSchema = z.object({
  p: z.literal('hcs-12'),
  op: z.enum(['register', 'template']),
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Invalid semver format'),
  data: z.union([z.any(), z.string()]).optional(),
  t_id: hederaAddressSchema.optional(),
});

/**
 * Assembly operations
 */
const assemblyOperationSchema = z.enum([
  'register',
  'add-action',
  'add-block',
  'update',
]);

/**
 * Assembly registration schema
 */
const assemblyRegisterSchema = baseRegistrationSchema.extend({
  op: z.literal('register'),
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Invalid semver format'),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  author: z.string().optional(),
});

/**
 * Assembly add-action schema
 */
const assemblyAddActionSchema = baseRegistrationSchema.extend({
  op: z.literal('add-action'),
  t_id: hederaAddressSchema,
  alias: z.string(),
  config: z.any().optional(),
  data: hederaAddressSchema.optional(),
});

/**
 * Assembly add-block schema
 */
const assemblyAddBlockSchema = baseRegistrationSchema.extend({
  op: z.literal('add-block'),
  block_t_id: hederaAddressSchema,
  actions: z.record(z.string(), hederaAddressSchema).optional(),
  attributes: z.record(z.any()).optional(),
  children: z.array(z.string()).optional(),
  data: hederaAddressSchema.optional(),
});

/**
 * Assembly update schema
 */
const assemblyUpdateSchema = baseRegistrationSchema.extend({
  op: z.literal('update'),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Assembly layout schema
 */
const assemblyLayoutSchema = z.object({
  type: z.enum(['vertical', 'horizontal', 'grid']),
  responsive: z.boolean().optional(),
  containerClass: z.string().optional(),
});

/**
 * Assembly source verification schema
 */
const assemblySourceVerificationSchema = z.object({
  source_t_id: hederaAddressSchema,
  source_hash: sha256HashSchema,
  description: z.string().optional(),
});

/**
 * Assembly message schema - union of all operation types
 */
export const assemblyMessageSchema = z.discriminatedUnion('op', [
  assemblyRegisterSchema,
  assemblyAddActionSchema,
  assemblyAddBlockSchema,
  assemblyUpdateSchema,
]);

/**
 * Legacy assembly registration schema for backwards compatibility
 */
export const assemblyRegistrationSchema = assemblyRegisterSchema;

/**
 * HashLinks registration schema - for global directory
 */
export const hashLinksRegistrationSchema = baseRegistrationSchema.extend({
  op: z.literal('register'),
  t_id: hederaAddressSchema,
  name: z.string().max(100, 'Name must be 100 characters or less'),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or less')
    .optional(),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional(),
  category: z.string().optional(),
  featured: z.boolean().optional(),
  icon: z.string().optional(),
  author: z.string().optional(),
  website: z.string().url().optional(),
});

/**
 * Validate action registration
 */
export function validateActionRegistration(
  data: unknown,
): z.infer<typeof actionRegistrationSchema> {
  return actionRegistrationSchema.parse(data);
}

/**
 * Validate block registration
 */
export function validateBlockRegistration(
  data: unknown,
): z.infer<typeof blockRegistrationSchema> {
  return blockRegistrationSchema.parse(data);
}

/**
 * Validate assembly message (any operation type)
 */
export function validateAssemblyMessage(
  data: unknown,
): z.infer<typeof assemblyMessageSchema> {
  return assemblyMessageSchema.parse(data);
}

/**
 * Validate assembly registration
 */
export function validateAssemblyRegistration(
  data: unknown,
): z.infer<typeof assemblyRegistrationSchema> {
  return assemblyRegistrationSchema.parse(data);
}

/**
 * Validate HashLinks registration
 */
export function validateHashLinksRegistration(
  data: unknown,
): z.infer<typeof hashLinksRegistrationSchema> {
  return hashLinksRegistrationSchema.parse(data);
}

/**
 * Type-safe validation with error details
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Validate data against a schema and return validation result
 */
export function validateWithSchema<T>(
  data: unknown,
  schema: z.ZodSchema<T>,
): { isValid: boolean; errors: string[]; data?: T } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { isValid: true, errors: [], data: result.data };
  }
  return {
    isValid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}
