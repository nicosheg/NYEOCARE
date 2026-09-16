// lib/supabaseClient.js
// Browser sessions persist and refresh automatically; server validation remains stateless.
import{createClient}from'@supabase/supabase-js';
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,supabaseAnonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if(!supabaseUrl||!supabaseAnonKey)throw new Error('Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.');
const isBrowser=typeof window!=='undefined';
export const supabase=createClient(supabaseUrl,supabaseAnonKey,{auth:{persistSession:isBrowser,autoRefreshToken:isBrowser,detectSessionInUrl:isBrowser,flowType:'pkce'}});
