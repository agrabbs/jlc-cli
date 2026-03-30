# Error Handling Guidelines

This document describes error handling best practices for the jlc-cli codebase.

## Logging System

The project uses a custom logger (`packages/core/src/utils/logger.ts`) that provides:

- **Structured logging** with log levels (debug, info, warn, error)
- **Security event logging** for audit trails
- **Error context preservation** to maintain stack traces and metadata

### Using the Logger

```typescript
import { createLogger } from '../utils/logger.js';

const logger = createLogger('my-module');

// Basic logging
logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message', errorObject);

// Security events
logger.security('file_write', {
  path: '/path/to/file',
  size: 1024,
  user: 'system',
});

// Error with full context
logger.errorWithContext('Operation failed', error, {
  operation: 'download',
  componentId: 'C12345',
});
```

## Error Handling Patterns

### 1. Never Use Empty Catch Blocks

❌ **Bad:**
```typescript
try {
  riskyOperation();
} catch {
  // Silent failure - debugging nightmare
}
```

✅ **Good:**
```typescript
try {
  riskyOperation();
} catch (error) {
  logger.error('Risky operation failed', error);
  // Either re-throw or handle gracefully
  throw error;
}
```

### 2. Preserve Error Context

❌ **Bad:**
```typescript
try {
  await fetchData(url);
} catch (error) {
  throw new Error('Failed to fetch data'); // Lost original error
}
```

✅ **Good:**
```typescript
import { ContextError } from '../utils/logger.js';

try {
  await fetchData(url);
} catch (error) {
  throw new ContextError('Failed to fetch data', error, { url });
}
```

### 3. Log Security-Relevant Events

Always log:
- Authentication failures
- Rate limit violations
- File system operations
- Network requests to external APIs
- Input validation failures
- Permission errors

```typescript
// Log failed authentication
if (!isAuthenticated(token)) {
  logger.security('auth_failed', {
    timestamp: new Date().toISOString(),
    ip: clientIp,
    reason: 'invalid_token',
  });
  throw new Error('Unauthorized');
}

// Log file operations
logger.security('file_write', {
  path: filePath,
  size: content.length,
  component: componentId,
});
await writeFile(filePath, content);
```

### 4. Use Typed Error Handling

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

try {
  validateInput(value);
} catch (error) {
  if (error instanceof ValidationError) {
    logger.warn(`Validation failed for ${error.field}: ${error.message}`);
    // Handle validation error
  } else {
    logger.error('Unexpected error', error);
    throw error;
  }
}
```

### 5. Wrap Async Functions

Use the `withErrorHandling` wrapper for consistent error logging:

```typescript
import { withErrorHandling, createLogger } from '../utils/logger.js';

const logger = createLogger('api');

const fetchComponent = withErrorHandling(
  async (id: string) => {
    const response = await fetch(`/api/component/${id}`);
    return await response.json();
  },
  logger,
  'fetch component'
);
```

## Validation

Use Zod schemas for input validation:

```typescript
import { z } from 'zod';

const ComponentIdSchema = z.union([
  z.string().regex(/^C\d+$/), // LCSC ID
  z.string().regex(/^[a-f0-9]{32}$/i), // EasyEDA UUID
]);

try {
  const id = ComponentIdSchema.parse(userInput);
} catch (error) {
  if (error instanceof z.ZodError) {
    logger.warn('Invalid component ID', { input: userInput, errors: error.errors });
    throw new ValidationError('Invalid component ID format', 'componentId', userInput);
  }
}
```

## API Error Handling

All API calls should:
1. Log the request (debug level)
2. Handle HTTP errors gracefully
3. Log failures with context
4. Return meaningful errors to callers

```typescript
async getComponentData(lcscId: string): Promise<ComponentData> {
  logger.debug(`Fetching component: ${lcscId}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    logger.debug(`Component fetched successfully: ${lcscId}`);
    return data;
  } catch (error) {
    logger.errorWithContext('Failed to fetch component', error, {
      lcscId,
      url,
    });
    throw new ContextError('Failed to fetch component data', error, { lcscId });
  }
}
```

## Security Event Categories

Log these events with `logger.security()`:

- `auth_failed` - Failed authentication attempts
- `rate_limit_exceeded` - Rate limit violations
- `file_write` - File system writes
- `file_delete` - File deletions
- `path_validation_failed` - Path traversal attempts
- `input_validation_failed` - Malformed input detected
- `command_injection_attempt` - Suspicious command patterns

## Testing Error Handling

Always test error paths:

```typescript
test('handles network errors gracefully', async () => {
  // Mock network failure
  mock(fetch).mockRejectedValue(new Error('Network error'));

  await expect(async () => {
    await fetchComponent('C12345');
  }).toThrow('Failed to fetch component');

  // Verify error was logged
  expect(logger.error).toHaveBeenCalledWith(
    expect.stringContaining('Failed to fetch'),
    expect.any(Error)
  );
});
```

## Checklist for New Code

- [ ] All errors are caught and logged
- [ ] Error messages include context (component ID, file path, etc.)
- [ ] Security-relevant events are logged
- [ ] No empty catch blocks
- [ ] Original error information is preserved
- [ ] API errors include HTTP status codes
- [ ] Validation errors specify the invalid field
- [ ] Async errors are properly handled
- [ ] Error tests are written
