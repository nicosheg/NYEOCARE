// lib/aria/attendanceQueue.js
// Attendance processing is durable in Postgres; closing attendance never depends on a web worker.
import pool from '../db';

const QUEUE='nyeocare-attendance';

export async function enqueueAttendanceProcessing({organizationId,sessionId,actorId=null,stage='persist',db=pool}) {
  if(!organizationId||!sessionId)throw new Error('organizationId and sessionId are required');
  const message={
    organization_id:String(organizationId),
    session_id:String(sessionId),
    actor_id:actorId?String(actorId):null,
    stage:String(stage||'persist'),
    enqueued_at:new Date().toISOString()
  };
  const result=await db.query(
    'SELECT pgmq.send($1,$2::jsonb) AS message_id',
    [QUEUE,JSON.stringify(message)]
  );
  return {queue:QUEUE,messageId:result.rows[0]?.message_id||null,message};
}
