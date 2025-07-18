import { useEffect } from 'react'
import { ga4Analytics, useAnalytics } from '../../utils/analytics'
import { viteEnvironment } from '../../utils/environment'

interface AnalyticsProps {
  children: React.ReactNode
}

export function Analytics({ children }: AnalyticsProps) {
  useAnalytics()

  useEffect(() => {
    // Initialize Google Analytics with environment config
    ga4Analytics.initialize({
      measurementId: viteEnvironment.getWithDefault('GA_MEASUREMENT_ID', 'G-TG3P45LMEK')
    })
  }, [])

  return <>{children}</>
}
