// lib/aiProviderCore.js
// Compatibility facade only.
// The canonical scan provider implementation is hybridScanProvider, which
// resolves the configured model provider through lib/aiProviders.
export{callVisionWithRetry,getScanAdmission,SCAN_PIPELINE_VERSION}from'./hybridScanProvider';
