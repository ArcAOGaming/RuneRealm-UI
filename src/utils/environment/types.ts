export interface IEnvironment {
  get(key: string): string | undefined
  getOrThrow(key: string): string
  getWithDefault(key: string, defaultValue: string): string
}

export interface IEnvironmentConfig {
  GA_MEASUREMENT_ID: string
  // Add other environment variables here
}
