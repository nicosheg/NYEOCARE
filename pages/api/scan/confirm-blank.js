// pages/api/scan/confirm-blank.js
import{withOrg}from'../../../lib/apiHelpers';
import pool from'../../../lib/db';
import{processVisionJob,SCAN_PIPELINE_VERSION}from'../../../lib/visionProcessor';
import{waitUntil}from'@vercel/functions';
import{createConfirmBlankHandler}from'../../../lib/scanBlankConfirmation';

export const config={api:{bodyParser:{sizeLimit:'1mb'}},maxDuration:300};
const handler=createConfirmBlankHandler({db:pool,runVision:processVisionJob,schedule:waitUntil,pipelineVersion:SCAN_PIPELINE_VERSION});
export default withOrg(handler);
