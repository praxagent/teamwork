import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
// Import store early to ensure dark mode is initialized on page load
import './stores/uiStore'
import { installInternalKeyFetchInterceptor } from './hooks/useInternalKey'

// Before the first render, so no /api call can slip past it. Passive: it only
// acts on a 401 {"error":"internal_key_required"} from the backend.
installInternalKeyFetchInterceptor()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
