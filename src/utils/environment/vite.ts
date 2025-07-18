import { IEnvironment } from './types'

export class ViteEnvironment implements IEnvironment {
  private prefix = 'VITE_'

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`
  }

  get(key: string): string | undefined {
    const fullKey = this.getFullKey(key)
    return import.meta.env[fullKey]
  }

  getOrThrow(key: string): string {
    const value = this.get(key)
    if (value === undefined) {
      throw new Error(`Environment variable ${key} is not defined`)
    }
    return value
  }

  getWithDefault(key: string, defaultValue: string): string {
    return this.get(key) ?? defaultValue
  }
}

// Create a singleton instance
export const viteEnvironment = new ViteEnvironment()
