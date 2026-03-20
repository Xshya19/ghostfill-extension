/**
 * Standalone LRU Cache for testing and benchmarking
 * This is the same implementation used in storageService.ts
 */

export interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  utilization: number;
}

/**
 * O(1) LRU Cache Implementation using Map
 * - Map provides O(1) get/set/delete
 * - Access order is maintained by Map's insertion order (ES2015+ guarantee)
 * - Automatic TTL-based eviction
 */
export class LRUCache<K extends string, V> {
  private readonly cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number = 100, ttlMs: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * O(1) Get with automatic LRU promotion and TTL check
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // O(1) LRU promotion: delete and re-add to move to end
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * O(1) Set with automatic eviction if at capacity
   */
  set(key: K, value: V): void {
    // If key exists, remove it first (for LRU promotion)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry - O(1) with Map iterator
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * O(1) Delete
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * O(1) Has check with TTL validation
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * O(1) Size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache stats
   */
  getStats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: this.cache.size / this.maxSize,
    };
  }

  /**
   * Clean up expired entries
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Benchmark: Compare O(1) Map vs O(n) Array
   */
  static benchmark(size: number, iterations: number): { mapTime: number; arrayTime: number } {
    // Map-based LRU (O(1))
    const mapCache = new Map<string, number>();
    const mapStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const key = `key${i % size}`;
      if (mapCache.has(key)) {
        mapCache.delete(key);
      } else if (mapCache.size >= size) {
        const oldest = mapCache.keys().next().value;
        if (oldest) {
          mapCache.delete(oldest);
        }
      }
      mapCache.set(key, i);
    }
    const mapTime = performance.now() - mapStart;

    // Array-based LRU (O(n)) - simulated old implementation
    const arrayCache: Array<{ key: string; value: number }> = [];
    const arrayStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const key = `key${i % size}`;
      const index = arrayCache.findIndex((item) => item.key === key);
      if (index > -1) {
        arrayCache.splice(index, 1);
      } else if (arrayCache.length >= size) {
        arrayCache.shift();
      }
      arrayCache.push({ key, value: i });
    }
    const arrayTime = performance.now() - arrayStart;

    return { mapTime, arrayTime };
  }
}
