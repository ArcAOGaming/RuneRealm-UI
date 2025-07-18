import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { ga4Analytics } from './ga4'

export const useAnalytics = () => {
  const location = useLocation()

  useEffect(() => {
    // Track page view whenever location changes
    const path = location.pathname + location.search + location.hash
    ga4Analytics.trackPageView(path)
  }, [location])
}
