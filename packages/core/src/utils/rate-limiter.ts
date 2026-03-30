/**
 * Token bucket rate limiter implementation
 * Allows burst traffic while maintaining average rate limit
 */
export class RateLimiter {
	private tokens: number
	private lastRefill: number
	private readonly maxTokens: number
	private readonly refillRate: number // tokens per second
	private readonly queue: Array<{
		tokens: number
		resolve: () => void
	}> = []
	private processing = false

	/**
	 * Create a new rate limiter
	 * @param maxTokens Maximum token bucket size (burst capacity)
	 * @param refillRate Tokens added per second (sustained rate)
	 */
	constructor(maxTokens: number, refillRate: number) {
		this.maxTokens = maxTokens
		this.refillRate = refillRate
		this.tokens = maxTokens
		this.lastRefill = Date.now()
	}

	/**
	 * Acquire tokens from the bucket, waiting if necessary
	 * @param tokens Number of tokens to acquire (default: 1)
	 */
	async acquire(tokens: number = 1): Promise<void> {
		if (tokens > this.maxTokens) {
			throw new Error(
				`Cannot acquire ${tokens} tokens (max: ${this.maxTokens})`
			)
		}

		return new Promise<void>((resolve) => {
			this.queue.push({ tokens, resolve })
			this.processQueue()
		})
	}

	private async processQueue(): Promise<void> {
		if (this.processing) return
		this.processing = true

		while (this.queue.length > 0) {
			this.refill()

			const request = this.queue[0]
			if (this.tokens >= request.tokens) {
				this.tokens -= request.tokens
				this.queue.shift()
				request.resolve()
			} else {
				// Wait for tokens to refill
				const waitTime =
					((request.tokens - this.tokens) / this.refillRate) * 1000
				await new Promise((resolve) => setTimeout(resolve, waitTime))
			}
		}

		this.processing = false
	}

	private refill(): void {
		const now = Date.now()
		const elapsed = (now - this.lastRefill) / 1000
		const tokensToAdd = elapsed * this.refillRate
		this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd)
		this.lastRefill = now
	}

	/**
	 * Get current available tokens
	 */
	getAvailableTokens(): number {
		this.refill()
		return this.tokens
	}

	/**
	 * Reset the rate limiter to full capacity
	 */
	reset(): void {
		this.tokens = this.maxTokens
		this.lastRefill = Date.now()
		this.queue.length = 0
		this.processing = false
	}
}

/**
 * Request queue with concurrency limiting
 * Ensures only N requests run in parallel
 */
export class RequestQueue {
	private queue: Array<() => Promise<any>> = []
	private activeCount = 0
	private readonly concurrency: number

	/**
	 * Create a new request queue
	 * @param concurrency Maximum number of concurrent requests
	 */
	constructor(concurrency: number = 3) {
		this.concurrency = concurrency
	}

	/**
	 * Add a request to the queue
	 * @param fn Async function to execute
	 * @returns Promise that resolves with the function result
	 */
	async add<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push(async () => {
				try {
					const result = await fn()
					resolve(result)
				} catch (error) {
					reject(error)
				}
			})
			this.process()
		})
	}

	private async process(): Promise<void> {
		if (this.activeCount >= this.concurrency || this.queue.length === 0) {
			return
		}

		this.activeCount++
		const fn = this.queue.shift()

		if (fn) {
			try {
				await fn()
			} finally {
				this.activeCount--
				this.process()
			}
		}
	}

	/**
	 * Get current queue size
	 */
	getQueueSize(): number {
		return this.queue.length
	}

	/**
	 * Get number of active requests
	 */
	getActiveCount(): number {
		return this.activeCount
	}
}

/**
 * Fetch with exponential backoff retry logic
 * @param url URL to fetch
 * @param options Fetch options
 * @param maxRetries Maximum number of retries (default: 3)
 * @returns Response object
 */
export async function fetchWithRetry(
	url: string,
	options?: RequestInit,
	maxRetries: number = 3
): Promise<Response> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await fetch(url, options)

			// Handle rate limiting (429 Too Many Requests)
			if (response.status === 429) {
				const retryAfter = response.headers.get('Retry-After')
				const delay = retryAfter
					? parseInt(retryAfter, 10) * 1000
					: Math.pow(2, attempt) * 1000

				console.warn(
					`Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
				)
				await new Promise((resolve) => setTimeout(resolve, delay))
				continue
			}

			// Handle server errors with exponential backoff
			if (response.status >= 500 && attempt < maxRetries - 1) {
				const delay = Math.pow(2, attempt) * 1000
				console.warn(
					`Server error (${response.status}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
				)
				await new Promise((resolve) => setTimeout(resolve, delay))
				continue
			}

			return response
		} catch (error) {
			if (attempt === maxRetries - 1) {
				throw error
			}

			const delay = Math.pow(2, attempt) * 1000
			console.warn(
				`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
			)
			await new Promise((resolve) => setTimeout(resolve, delay))
		}
	}

	throw new Error(`Failed after ${maxRetries} retries`)
}

// Pre-configured rate limiters for different API services
export const rateLimiters = {
	// JLCPCB Search API - conservative to avoid bot detection
	jlcSearch: new RateLimiter(10, 1), // 1 req/sec, burst of 10

	// JLCPCB Component API - moderate rate
	jlcComponent: new RateLimiter(30, 5), // 5 req/sec, burst of 30

	// EasyEDA API - higher rate for component data
	easyeda: new RateLimiter(50, 10), // 10 req/sec, burst of 50

	// EasyEDA Community API
	easyedaCommunity: new RateLimiter(50, 10), // 10 req/sec, burst of 50

	// 3D model downloads - limit concurrent downloads
	downloads: new RateLimiter(15, 3), // 3 req/sec, burst of 15
}

// Request queue for overall concurrency control
export const requestQueue = new RequestQueue(5) // Max 5 concurrent requests
