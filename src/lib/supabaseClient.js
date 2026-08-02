import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Without these, every request silently goes out with no `apikey` header
  // and Supabase returns a cryptic "No API key found in request" error that's
  // hard to trace back to its cause. Fail loudly and immediately instead.
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env, fill in ' +
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase ' +
    'project settings (Project Settings -> API), then restart `npm run dev`. ' +
    'If this is a deployed build, add the same two variables in your host\'s ' +
    'environment variable settings and redeploy.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
