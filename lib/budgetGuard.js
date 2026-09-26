// lib/budgetGuard.js
import pool from './db';
import{calculateConservativeReservation}from'./costCalculator';

const limitValue=(v,fallback)=>{
 if(v===undefined||v===null||v==='')return fallback;
 const n=Number(v);
 if(!Number.isFinite(n)||n<0)throw new Error('Invalid AI budget limit');
 return n;
};

export async function reserveBudget(organizationId,purpose,modelKey,{idempotencyKey=null}={}){
 if(!organizationId||!purpose||!modelKey)throw new Error('organizationId, purpose and modelKey are required');

 const estimatedCost=calculateConservativeReservation(modelKey);
 const dailyLimit=limitValue(process.env.MAX_DAILY_AI_COST,.10);
 const monthlyLimit=limitValue(process.env.MAX_MONTHLY_AI_COST,2);
 const client=await pool.connect();

 try{
  await client.query('BEGIN');

  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[
   `nyeocare-budget:${organizationId}`
  ]);

  const daily=await client.query(`
   SELECT COALESCE(SUM(
    CASE
     WHEN status='confirmed' THEN actual_cost
     WHEN status='pending' AND expires_at>NOW() THEN estimated_cost
     ELSE 0
    END
   ),0)::numeric AS total
   FROM budget_reservations
   WHERE organization_id=$1
     AND(
      confirmed_at::date=CURRENT_DATE
      OR(created_at::date=CURRENT_DATE AND status='pending' AND expires_at>NOW())
     )
  `,[organizationId]);

  const monthly=await client.query(`
   SELECT COALESCE(SUM(
    CASE
     WHEN status='confirmed' THEN actual_cost
     WHEN status='pending' AND expires_at>NOW() THEN estimated_cost
     ELSE 0
    END
   ),0)::numeric AS total
   FROM budget_reservations
   WHERE organization_id=$1
     AND(
      confirmed_at>=date_trunc('month',NOW())
      OR(created_at>=date_trunc('month',NOW()) AND status='pending' AND expires_at>NOW())
     )
  `,[organizationId]);

  if(Number(daily.rows[0].total)+estimatedCost>dailyLimit){
   await client.query('ROLLBACK');
   return{allowed:false,reason:'Daily organization AI budget would be exceeded'};
  }

  if(Number(monthly.rows[0].total)+estimatedCost>monthlyLimit){
   await client.query('ROLLBACK');
   return{allowed:false,reason:'Monthly organization AI budget would be exceeded'};
  }

  const reservation=(await client.query(`
   INSERT INTO budget_reservations(
    organization_id,purpose,estimated_cost,model_key,idempotency_key,status,expires_at,created_at
   )VALUES($1,$2,$3,$4,$5,'pending',NOW()+INTERVAL'10 minutes',NOW())
   RETURNING id
  `,[organizationId,purpose,estimatedCost,modelKey,idempotencyKey])).rows[0];

  await client.query('COMMIT');

  return{allowed:true,reservationId:reservation.id,estimatedCost};
 }catch(err){
  try{await client.query('ROLLBACK')}catch{}
  throw err;
 }finally{
  client.release();
 }
}

export async function confirmReservation(reservationId,actualCost){
 if(!reservationId)return true;
 if(!Number.isFinite(Number(actualCost))||Number(actualCost)<0)return false;

 const result=await pool.query(`
  UPDATE budget_reservations
  SET status='confirmed',actual_cost=$1,confirmed_at=NOW()
  WHERE id=$2 AND status='pending' AND expires_at>NOW()
  RETURNING id
 `,[Number(actualCost),reservationId]);

 return result.rowCount===1;
}

export async function cancelReservation(reservationId){
 if(!reservationId)return true;

 const result=await pool.query(`
  UPDATE budget_reservations
  SET status='cancelled',cancelled_at=NOW()
  WHERE id=$1 AND status='pending'
  RETURNING id
 `,[reservationId]);

 return result.rowCount===1;
}
