/**
 * HTTP server for the EasyEDA Component Browser
 * Runs alongside the MCP stdio server to serve the web UI and proxy API requests
 * 
 * Security features:
 * - Token-based authentication
 * - Rate limiting (100 req/min per IP)
 * - CORS restricted to localhost
 * - Bound to 127.0.0.1 only
 * - Security event logging for failed auth and rate limiting
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { createLogger } from '../utils/logger.js'
import { handleRequest } from './routes.js'

const logger = createLogger('http-server')

const DEFAULT_PORT = 3847

let serverInstance: ReturnType<typeof createServer> | null = null
let authToken: string | null = null

// Rate limiting
interface RateLimitEntry {
  count: number
  resetTime: number
}
const requestCounts = new Map<string, RateLimitEntry>()
const RATE_LIMIT_WINDOW = 60000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100 // 100 requests per minute

export interface HttpServerOptions {
  port?: number
  onReady?: (url: string, token?: string) => void
  disableAuth?: boolean // For testing purposes only
}

/**
 * Check rate limit for a client
 */
function checkRateLimit(clientIp: string): boolean {
  const now = Date.now()
  const entry = requestCounts.get(clientIp)

  if (!entry || now > entry.resetTime) {
    requestCounts.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  entry.count++
  return true
}

/**
 * Validate authentication token
 */
function validateAuth(req: IncomingMessage, disableAuth: boolean): boolean {
  if (disableAuth) return true
  if (!authToken) return true // No auth required if token not set

  // Check for token in header
  const headerToken = req.headers['x-auth-token'] as string | undefined
  if (headerToken === authToken) return true

  // Check for token in query parameter
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const queryToken = url.searchParams.get('token')
  if (queryToken === authToken) return true

  return false
}

/**
 * Start the HTTP server
 * @returns The port the server is listening on
 */
export function startHttpServer(options: HttpServerOptions = {}): number {
  if (serverInstance) {
    logger.debug('HTTP server already running')
    const port = options.port ?? parseInt(process.env.JLC_MCP_HTTP_PORT || String(DEFAULT_PORT), 10)
    options.onReady?.(`http://localhost:${port}`, authToken || undefined)
    return port
  }

  const port = options.port ?? parseInt(process.env.JLC_MCP_HTTP_PORT || String(DEFAULT_PORT), 10)
  
  // Generate authentication token unless auth is disabled
  if (!options.disableAuth && !authToken) {
    authToken = randomBytes(32).toString('hex')
    logger.info(`Server authentication token: ${authToken}`)
    logger.info(`Use header: x-auth-token: ${authToken}`)
    logger.info(`Or query param: ?token=${authToken}`)
  }

  serverInstance = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const clientIp = req.socket.remoteAddress || 'unknown'
    
    // Check rate limit
    if (!checkRateLimit(clientIp)) {
      logger.warn(`Rate limit exceeded for ${clientIp}`)
      logger.security('rate_limit_exceeded', {
        clientIp,
        timestamp: new Date().toISOString(),
        url: req.url,
      })
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }))
      return
    }

    // Check authentication
    if (!validateAuth(req, options.disableAuth || false)) {
      logger.warn(`Unauthorized request from ${clientIp}`)
      logger.security('auth_failed', {
        clientIp,
        timestamp: new Date().toISOString(),
        url: req.url,
        userAgent: req.headers['user-agent'],
      })
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized. Valid authentication token required.' }))
      return
    }

    // Restrict CORS to localhost only
    const origin = req.headers.origin
    const allowedOrigins = [
      'http://localhost:3847',
      `http://localhost:${port}`,
      'http://127.0.0.1:3847',
      `http://127.0.0.1:${port}`,
    ]
    
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    } else {
      res.setHeader('Access-Control-Allow-Origin', `http://localhost:${port}`)
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-auth-token')
    res.setHeader('Access-Control-Allow-Credentials', 'true')

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      await handleRequest(req, res)
    } catch (error) {
      logger.errorWithContext('Request handling failed', error, {
        clientIp,
        method: req.method,
        url: req.url,
        headers: req.headers,
      })
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  })

  serverInstance.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`
    logger.info(`HTTP server listening on ${url} (127.0.0.1 only)`)
    options.onReady?.(url, authToken || undefined)
  })

  serverInstance.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} already in use, HTTP server not started`)
    } else {
      logger.error('HTTP server error:', error)
    }
  })

  return port
}

/**
 * Stop the HTTP server
 */
export function stopHttpServer(): void {
  if (serverInstance) {
    serverInstance.close()
    serverInstance = null
    authToken = null
    requestCounts.clear()
    logger.info('HTTP server stopped')
  }
}

/**
 * Get current authentication token (for testing)
 */
export function getAuthToken(): string | null {
  return authToken
}
