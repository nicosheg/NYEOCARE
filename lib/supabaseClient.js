// lib/supabaseClient.js
// Canonical Supabase client. Browser sessions remain persistent; server bearer-token validation is stateless.
import{createClient}from'@supabase/supabase-js';
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,supabaseAnonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if(!supabaseUrl||!supabaseAnonKey)throw new Error('Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.');
export const supabase=createClient(supabaseUrl,supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'pkce'}});
