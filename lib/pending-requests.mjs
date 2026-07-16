export class PendingRequestRegistry {
  constructor({timeoutMilliseconds, timeoutMessage}) {
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.timeoutMessage = timeoutMessage;
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  create(key, operation) {
    if (this.entries.has(key)) throw new Error(`Pending request already exists: ${key}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.entries.delete(key);
        reject(new Error(this.timeoutMessage(operation)));
      }, this.timeoutMilliseconds);
      this.entries.set(key, {resolve, reject, timer});
    });
  }

  take(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.entries.delete(key);
    return entry;
  }

  rejectAll(error) {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.entries.clear();
  }
}
