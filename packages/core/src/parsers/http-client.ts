/**
 * Shared HTTP client for EasyEDA API calls
 * Used by both LCSC and Community API clients
 */

import { spawnSync } from 'child_process';
import { createLogger } from '../utils/index.js';

const logger = createLogger('http-client');

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
  binary?: boolean;
  maxSize?: number; // Maximum size in bytes
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
