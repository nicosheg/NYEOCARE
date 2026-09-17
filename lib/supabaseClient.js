// lib/supabaseClient.js
import{createClient}from'@supabase/supabase-js';
const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,supabaseAnonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!supabaseUrl||!supabaseAnonKey)throw new Error('Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.');
const isBrowser=typeof window!=='undefined';
export const supabase=createClient(supabaseUrl,supabaseAnonKey,{auth:{persistSession:isBrowser,autoRefreshToken:isBrowser,detectSessionInUrl:isBrowser,flowType:'pkce'}});
export const supabaseAdmin=serviceRoleKey?createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
