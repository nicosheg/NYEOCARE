// lib/db.js
import{Pool}from'pg';
const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString,ssl:{rejectUnauthorized:false},family:4,max:3,idleTimeoutMillis:5000,connectionTimeoutMillis:10000,keepAlive:true,allowExitOnIdle:true});
pool.on('error',err=>console.error('[DB] Unexpected idle client error:',err));
export default pool;
