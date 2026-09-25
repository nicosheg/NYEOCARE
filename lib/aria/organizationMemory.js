// lib/aria/organizationMemory.js
import{recordOrganizationMemory,getCurrentOrganizationMemory}from'./memoryEngine';

export async function setMemory(orgId,memoryType,memoryKey,value,confidence=.8,source='aria',options={}){
 return recordOrganizationMemory({
  organizationId:orgId,memoryType,memoryKey,value,confidence,source,
  evidenceKind:options.evidenceKind||'human_report',
  verificationStatus:options.verificationStatus||'reported',
  sourceEventId:options.sourceEventId||null,createdBy:options.createdBy||null,
  actorRole:options.actorRole||null,validFrom:options.validFrom||null,validUntil:options.validUntil||null,
  verifiedAt:options.verifiedAt||null,metadata:options.metadata||{}
 });
}

export async function getMemory(orgId,memoryType=null,memoryKey=null,options={}){
 const rows=await getCurrentOrganizationMemory(orgId,{limit:options.limit||100,memoryType});
 return memoryKey?rows.filter(x=>x.memory_key===memoryKey):rows;
}