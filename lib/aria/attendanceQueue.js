// lib/aria/attendanceQueue.js
import { send } from '@vercel/queue';

const TOPIC='nyeocare-attendance';

export async function enqueueAttendanceProcessing({organizationId,sessionId,actorId=null}) {
  if(!organizationId||!sessionId)throw new Error('organizationId and sessionId are required');
  const key=`attendance:${organizationId}:${sessionId}:processing`;
  return send(TOPIC,{organization_id:String(organizationId),session_id:String(sessionId),actor_id:actorId?String(actorId):null},{
    idempotencyKey:key,
    retentionSeconds:604800
  });
}
