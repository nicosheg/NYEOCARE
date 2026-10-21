// lib/scanRequestBudget.js
export function isInputTokenBudgetError(status, message = '') {
  return Number(status) === 413 &&
    /input tokens per minute|ITPM|tokens per minute/i.test(String(message || ''));
}

export function makeFullPageBudgetFallback(region) {
  if (!region || typeof region.data !== 'string' || !region.data) return null;
  return {
    ...region,
    images: [{
      label: 'full_page_budget_fallback',
      data: region.data,
      y0: Number(region.y0) || 0,
      y1: Number(region.y1) || Number(region.h) || 1000
    }]
  };
}
