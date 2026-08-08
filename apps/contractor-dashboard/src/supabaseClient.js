import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://redthjpbxhjmoclxupxv.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJlZHRoanBieGhqbW9jbHh1cHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNzcwNDksImV4cCI6MjEwMTc1MzA0OX0.C6Gj3iBbmWtube-PRs4kWD_CgS-BK3emJADO7yLtsNk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
