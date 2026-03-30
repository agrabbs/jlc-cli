/**
 * Shared HTTP client for EasyEDA API calls
 * Used by both LCSC and Community API clients
 */

import { spawnSync } from 'child_process';
import { createLogger } from '../utils/index.js';

const logger = createLogger('http-client');

// Allowed Content-Types for different file formats
const ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
  'step': [
    'application/step',
    'model/step',
    'model/step+xml',
    'application/step+xml',
    'application/octet-stream',
    'application/x-step',
  ],
  'obj': [
    'model/obj',
    'text/plain',
    'application/octet-stream',
  ],
  'json': [
    'application/json',
    'text/json',
  ],
  'html': [
    'text/html',
    'application/xhtml+xml',
  ],
};

/**
 * Validate Content-Type header for expected file type
 * @param contentType The Content-Type header value
 * @param expectedType The expected file type (step, obj, json, etc.)
 * @returns true if valid, false otherwise
 */
function isValidContentType(contentType: string | null, expectedType?: string): boolean {
  if (!contentType) {
    // Missing Content-Type - allow for now but log warning
    return true;
  }

  const normalizedType = contentType.toLowerCase().split(';')[0].trim();

  // If no expected type specified, just check it's not obviously dangerous
  if (!expectedType) {
    // Reject known dangerous types
    const dangerousTypes = ['text/html', 'application/javascript', 'text/javascript', 'application/x-sh'];
    return !dangerousTypes.includes(normalizedType);
  }

  // Check against allowed types for the expected format
  const allowedTypes = ALLOWED_CONTENT_TYPES[expectedType] || [];
  return allowedTypes.some(type => normalizedType.includes(type));
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
  binary?: boolean;
  maxSize?: number; // Maximum size in bytes
  expectedFileType?: string; // Expected file type for Content-Type validation (step, obj, json)
}

/**
 * Fetch URL with curl fallback for reliability
 * Falls back to curl when Node fetch fails (proxy issues, etc.)
 */
export async function fetchWithCurlFallback(
  url: string,
  options: FetchOptions = {}
): Promise<string | Buffer> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };

  if (options.contentType) {
    headers['Content-Type'] = options.contentType;
  }

  // Try native fetch first
  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (options.body) {
      fetchOptions.body = options.body;
    }

    const response = await fetch(url, fetchOptions);

    if (response.ok) {
      // Validate Content-Type if expectedFileType is specified
      const responseContentType = response.headers.get('content-type');
      if (options.expectedFileType) {
        if (!isValidContentType(responseContentType, options.expectedFileType)) {
          throw new Error(
            `Invalid Content-Type: ${responseContentType}. Expected ${options.expectedFileType} format.`
          );
        }
      } else {
        // At minimum, check it's not a dangerous type
        if (!isValidContentType(responseContentType)) {
          throw new Error(
            `Potentially dangerous Content-Type: ${responseContentType}`
          );
        }
      }

      // Check Content-Length header if available
      const contentLength = response.headers.get('content-length');
      if (options.maxSize && contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > options.maxSize) {
          throw new Error(
            `Response size ${size} bytes exceeds maximum allowed size of ${options.maxSize} bytes`
          );
        }
      }

      if (options.binary) {
        const buffer = Buffer.from(await response.arrayBuffer());
        
        // Verify size after download if Content-Length wasn't available
        if (options.maxSize && buffer.length > options.maxSize) {
          throw new Error(
            `Downloaded file size ${buffer.length} bytes exceeds maximum allowed size of ${options.maxSize} bytes`
          );
        }
        
        return buffer;
      }
      
      const text = await response.text();
      
      // Check text size
      if (options.maxSize && text.length > options.maxSize) {
        throw new Error(
          `Response size ${text.length} bytes exceeds maximum allowed size of ${options.maxSize} bytes`
        );
      }
      
      return text;
    }
  } catch (error) {
    logger.debug(`Native fetch failed, falling back to curl: ${error}`);
  }

  // Fallback to curl
  try {
    const curlArgs = ['-s'];

    if (method === 'POST') {
      curlArgs.push('-X', 'POST');
    }

    curlArgs.push('-H', 'Accept: application/json');
    curlArgs.push(
      '-H',
      'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    );

    if (options.contentType) {
      curlArgs.push('-H', `Content-Type: ${options.contentType}`);
    }

    if (options.body) {
      curlArgs.push('-d', options.body);
    }

    curlArgs.push(url);

    // Use spawnSync with argument array to prevent command injection
    const maxBuffer = options.maxSize || 50 * 1024 * 1024;
    const result = spawnSync('curl', curlArgs, {
      maxBuffer,
      encoding: options.binary ? 'buffer' : 'utf-8',
    });

    if (result.error) {
      // Check if error is due to maxBuffer exceeded
      if (result.error.message?.includes('maxBuffer') || result.error.message?.includes('stdout maxBuffer')) {
        throw new Error(
          `Download exceeded maximum allowed size of ${maxBuffer} bytes`
        );
      }
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`curl exited with code ${result.status}: ${result.stderr}`);
    }

    if (options.binary) {
      const buffer = result.stdout as Buffer;
      if (options.maxSize && buffer.length > options.maxSize) {
        throw new Error(
          `Downloaded file size ${buffer.length} bytes exceeds maximum allowed size of ${options.maxSize} bytes`
        );
      }
      return buffer;
    }

    const text = result.stdout as string;
    if (options.maxSize && text.length > options.maxSize) {
      throw new Error(
        `Response size ${text.length} bytes exceeds maximum allowed size of ${options.maxSize} bytes`
      );
    }
    return text;
  } catch (error) {
    throw new Error(`Both fetch and curl failed for URL: ${url}`);
  }
}
