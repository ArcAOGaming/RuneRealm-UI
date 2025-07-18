export interface IAnalyticsConfig {
  measurementId: string
}

export interface IAnalytics {
  initialize(config: IAnalyticsConfig): void
  trackPageView(path: string): void
  trackEvent(category: string, action: string, label?: string): void
}
