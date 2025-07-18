import ReactGA from 'react-ga4'
import { IAnalytics, IAnalyticsConfig } from './types'

export class GA4Analytics implements IAnalytics {
  initialize(config: IAnalyticsConfig): void {
    ReactGA.initialize(config.measurementId)
  }

  trackPageView(path: string): void {
    ReactGA.send({ hitType: 'pageview', page: path })
  }

  trackEvent(category: string, action: string, label?: string): void {
    ReactGA.event({
      category,
      action,
      label
    })
  }
}

// Create a singleton instance
export const ga4Analytics = new GA4Analytics()
