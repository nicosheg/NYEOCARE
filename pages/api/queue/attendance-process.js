// pages/api/queue/attendance-process.js
import { QueueClient } from '@vercel/queue';
import { processAttendanceSession } from '../../../lib/aria/attendanceProcessor';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';
import { directAriaEvent } from '../../../lib/aria/director';
import pool from '../../../lib/db';

const queue = new QueueClient();
const { handleNodeCallback } = queue;
const MAX_DELIVERIES = 5;

async function markPending(sessionId,orgId,error) {
  await pool.query(
    `UPDATE sessions
       SET aria_processing_status='pending',
           aria_processing_error=$1,
           aria_processing_completed_at=NULL
     WHERE id=$2 AND organization_id=$3 AND status='closed'`,
    [String(error||'Processing failed').slice(0,2000),sessionId,orgId]
  );
}

async function markFailed(sessionId,orgId,error,actorId) {
  const internal=String(error||'Processing failed').slice(0,2000);
  await pool.query(
    `UPDATE sessions
       SET aria_processing_status='failed',
           aria_processing_error=$1,
           aria_processing_completed_at=NULL
     WHERE id=$2 AND organization_id=$3 AND status='closed'`,
    [internal,sessionId,orgId]
  );
  try {
    const event=await emitAriaEvent({
      organizationId:orgId,
      type:'ATTENDANCE_PROCESSING_FAILED',
      source:'attendance',
      actorId:actorId||null,
      metadata:{session_id:sessionId,error:internal},
      eventKey:`attendance:${sessionId}:aria_failed:final`
    });
    if(event)await directAriaEvent(event);
  } catch(e) {
    console.error('[ATTENDANCE QUEUE] Failure signal could not be persisted:',e);
  }
}

export default handleNodeCallback(
  async (message,metadata)=>{
    const sessionId=String(message?.session_id||'');
    const orgId=String(message?.organization_id||'');
    const actorId=message?.actor_id?String(message.actor_id):null;
    if(!sessionId||!orgId)throw new Error('Invalid attendance queue message.');

    try {
      const result=await processAttendanceSession(sessionId,orgId);
      await pool.query(
        `UPDATE sessions
           SET aria_processing_status='completed',
               aria_processing_error=NULL,
               aria_processing_completed_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND status='closed'`,
        [sessionId,orgId]
      );
      console.info('[ATTENDANCE QUEUE] completed',JSON.stringify({
        session_id:sessionId,delivery:metadata?.deliveryCount||1,result
      }));
    } catch(error) {
      if(error?.code==='ATTENDANCE_PROCESSING_BUSY')throw error;
      const delivery=Number(metadata?.deliveryCount)||1;
      if(delivery>=MAX_DELIVERIES){
        await markFailed(sessionId,orgId,error?.message,actorId);
        return;
      }
      await markPending(sessionId,orgId,error?.message);
      throw error;
    }
  },
  {
    visibilityTimeoutSeconds:300,
    retry:(error,metadata)=>{
      if(error?.code==='ATTENDANCE_PROCESSING_BUSY'){
        return {afterSeconds:Math.min(60,5*Math.max(1,2**Math.max(0,(metadata?.deliveryCount||1)-1)))};
      }
      return {afterSeconds:Math.min(60,5*Math.max(1,2**Math.max(0,(metadata?.deliveryCount||1)-1)))};
    }
  }
);
