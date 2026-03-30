/**
 * Schema validation helpers using Zod
 */

import { z } from 'zod';
import { resolve, normalize, isAbsolute } from 'path';
import { homedir } from 'os';

// Component ID validation schemas
export const LCSCPartNumberSchema = z.string().regex(/^C\d+$/, 'Invalid LCSC part number format (expected C followed by digits)');

/**
 * EasyEDA community component UUID validation
 * Format: 32-character hex string (case-insensitive, normalized to lowercase)
 */
export const EasyEDAUuidSchema = z
  .string()
  .regex(/^[a-f0-9]{32}$/i, 'Invalid EasyEDA UUID (expected 32-character hex string)')
  .transform((s) => s.toLowerCase());

/**
 * Component ID that accepts either LCSC part number or EasyEDA UUID
 */
export const ComponentIdSchema = z.union([LCSCPartNumberSchema, EasyEDAUuidSchema]);

/**
 * Safe path validation - prevents path traversal attacks
 */
export const SafePathSchema = z
  .string()
  .min(1, 'Path cannot be empty')
  .refine((p) => !p.includes('..'), 'Path traversal (..) not allowed')
  .refine((p) => !p.includes('\0'), 'Null bytes not allowed in path');

export const PackageSchema = z.string().min(1, 'Package cannot be empty');

export const PriceTierSchema = z.object({
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  currency: z.string().default('USD'),
});

export const ComponentSchema = z.object({
  lcscPartNumber: LCSCPartNumberSchema,
  manufacturerPart: z.string().min(1),
  manufacturer: z.string().min(1),
  description: z.string(),
  category: z.string(),
  subcategory: z.string(),
  package: PackageSchema,
  stock: z.number().nonnegative(),
  price: z.array(PriceTierSchema),
  datasheet: z.string().url().optional(),
});

// Project validation schemas
export const BoardSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(['mm', 'inch']).default('mm'),
});

export const PowerSourceSchema = z.object({
  type: z.enum(['usb', 'battery', 'dc_jack', 'poe', 'other']),
  voltage: z.object({
    min: z.number(),
    max: z.number(),
  }),
  current: z.number().positive().optional(),
  details: z.string().optional(),
});

export const DesignConstraintsSchema = z.object({
  boardSize: BoardSizeSchema.optional(),
  layers: z.number().min(1).max(32).default(2),
  powerSource: PowerSourceSchema,
  interfaces: z.array(z.object({
    type: z.string(),
    count: z.number().positive().optional(),
    details: z.string().optional(),
  })),
  environment: z.object({
    tempMin: z.number().default(-20),
    tempMax: z.number().default(70),
    indoor: z.boolean().default(true),
    certifications: z.array(z.string()).optional(),
  }).optional(),
  manufacturingClass: z.number().min(1).max(3).optional(),
});

// KiCad validation schemas
export const KiCadPinTypeSchema = z.enum([
  'input',
  'output',
  'bidirectional',
  'power_in',
  'power_out',
  'passive',
  'unspecified',
  'open_collector',
  'open_emitter',
  'no_connect',
]);

export const KiCadPadTypeSchema = z.enum([
  'thru_hole',
  'smd',
  'connect',
  'np_thru_hole',
]);

export const KiCadPadShapeSchema = z.enum([
  'circle',
  'rect',
  'oval',
  'trapezoid',
  'roundrect',
  'custom',
]);

// Validation helper functions
export function validateLCSCPartNumber(partNumber: string): boolean {
  return LCSCPartNumberSchema.safeParse(partNumber).success;
}

export function isLcscId(id: string): boolean {
  return LCSCPartNumberSchema.safeParse(id).success;
}

export function isEasyEDAUuid(id: string): boolean {
  return EasyEDAUuidSchema.safeParse(id).success;
}

export function validateComponent(component: unknown): boolean {
  return ComponentSchema.safeParse(component).success;
}

export function validateDesignConstraints(constraints: unknown): boolean {
  return DesignConstraintsSchema.safeParse(constraints).success;
}

/**
 * Validates and sanitizes a project path to prevent path traversal attacks
 * @param projectPath - The user-supplied project path
 * @returns Canonicalized absolute path
 * @throws Error if path is invalid or potentially malicious
 */
export function validateProjectPath(projectPath: string): string {
  // Check for empty path
  if (!projectPath || projectPath.trim() === '') {
    throw new Error('Project path cannot be empty');
  }

  // Check for null bytes
  if (projectPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  // Normalize and resolve to absolute path
  const normalizedPath = normalize(projectPath);
  const absolutePath = isAbsolute(normalizedPath) 
    ? normalizedPath 
    : resolve(process.cwd(), normalizedPath);

  // Check for path traversal attempts
  const resolvedPath = resolve(absolutePath);
  
  // Ensure the path doesn't traverse outside expected boundaries
  const home = homedir();
  const cwd = process.cwd();
  
  // Allow paths within:
  // 1. User's home directory
  // 2. Current working directory
  // 3. /tmp or similar temp directories (for testing)
  const isInHome = resolvedPath.startsWith(home);
  const isInCwd = resolvedPath.startsWith(cwd);
  const isInTemp = resolvedPath.startsWith('/tmp') || 
                   resolvedPath.startsWith('/var/tmp') ||
                   (process.platform === 'win32' && resolvedPath.includes('\\Temp\\'));

  if (!isInHome && !isInCwd && !isInTemp) {
    throw new Error(
      `Project path must be within your home directory, current working directory, or temp directory. ` +
      `Path: ${resolvedPath}`
    );
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /\/etc\//i,
    /\/bin\//i,
    /\/usr\/bin/i,
    /\/sbin/i,
    /\/boot/i,
    /\/sys\//i,
    /\/proc\//i,
    /\/dev\//i,
    /\\windows\\/i,
    /\\system32\\/i,
    /\\program files/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(resolvedPath)) {
      throw new Error(`Project path contains suspicious system directory: ${resolvedPath}`);
    }
  }

  return resolvedPath;
}

/**
 * Validates that a path is safe for file operations
 * @param filePath - The file path to validate
 * @param basePath - The base directory the file should be within
 * @returns true if path is safe
 * @throws Error if path attempts to escape basePath
 */
export function validateFilePath(filePath: string, basePath: string): boolean {
  const resolvedFile = resolve(normalize(filePath));
  const resolvedBase = resolve(normalize(basePath));

  if (!resolvedFile.startsWith(resolvedBase)) {
    throw new Error(
      `File path attempts to escape base directory. ` +
      `File: ${resolvedFile}, Base: ${resolvedBase}`
    );
  }

  return true;
}

/**
 * Sanitizes a component name for use in filenames and identifiers
 * Removes or replaces characters that could be problematic
 * @param name - The component name to sanitize
 * @returns Sanitized name safe for use in filenames
 */
export function sanitizeComponentName(name: string): string {
  if (!name || name.trim() === '') {
    throw new Error('Component name cannot be empty');
  }

  // Remove null bytes
  let sanitized = name.replace(/\0/g, '');

  // Replace path separators and potentially dangerous characters
  sanitized = sanitized
    .replace(/[\/\\]/g, '_')        // Path separators
    .replace(/[<>:"|?*]/g, '_')     // Windows forbidden characters
    .replace(/\.\./g, '__')          // Path traversal attempts
    .replace(/^\.+/, '')             // Leading dots (hidden files)
    .replace(/\s+/g, '_')            // Whitespace
    .replace(/[^a-zA-Z0-9_-]/g, '_') // Non-alphanumeric except underscore and hyphen
    .replace(/_+/g, '_')             // Multiple underscores
    .replace(/^_+|_+$/g, '');        // Leading/trailing underscores

  // Ensure it's not empty after sanitization
  if (sanitized === '') {
    sanitized = 'component';
  }

  // Limit length to prevent filesystem issues
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }

  return sanitized;
}

export type ValidatedComponent = z.infer<typeof ComponentSchema>;
export type ValidatedDesignConstraints = z.infer<typeof DesignConstraintsSchema>;
