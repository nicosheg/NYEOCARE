// lib/db.js
import pg from'pg';import{attachDatabasePool}from'@vercel/functions';
const{Pool}=pg;
const connectionString=process.env.DATABASE_URL;if(!connectionString)throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString,ssl:{rejectUnauthorized:false},family:4,max:1,idleTimeoutMillis:5000,connectionTimeoutMillis:3000,keepAlive:true,allowExitOnIdle:true,maxUses:500});
attachDatabasePool(pool);
pool.on('error',err=>console.error('[DB] Unexpected idle client error:',err));
export default pool;
