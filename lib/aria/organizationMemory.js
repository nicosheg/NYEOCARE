// lib/aria/organizationMemory.js
import{setOrganizationMemory as writeOrganizationMemory}from'./memoryEngine';
import pool from'../db';

export async function setMemory(orgId,memoryType,memoryKey,value,confidence=.8,source='aria',options={}){
 return writeOrganizationMemory({
  organizationId:orgId,memoryType,memoryKey,value,confidence,source,
  evidenceKind:options.evidenceKind||'human_report',
  verificationStatus:options.verificationStatus||'reported',
  sourceEventId:options.sourceEventId||null,
  createdBy:options.createdBy||null,
  validFrom:options.validFrom||null,
  validUntil:options.validUntil||null,
  metadata:options.metadata||{}
 });
}

export async function getMemory(orgId,memoryType=null,memoryKey=null,{currentOnly=true,limit=200}={}){
 if(!orgId)throw new Error('orgId required');
 const params=[orgId];let where='organization_id=$1';
 if(currentOnly)where+=' AND is_current=true';
 if(memoryType){params.push(memoryType);where+=' AND memory_type=$'+params.length}
 if(memoryKey){params.push(memoryKey);where+=' AND memory_key=$'+params.length}
 params.push(Math.min(Math.max(Number(limit)||200,1),500));
 return(await pool.query('SELECT * FROM organization_memory WHERE '+where+' ORDER BY updated_at DESC LIMIT $'+params.length,params)).rows;
}