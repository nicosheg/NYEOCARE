const STANDALONE_GREETING = /^(?:hi|hello|hey|good morning|good afternoon|good evening)(?:[\\s,]+(?:aria|there|everyone|friend))?[!,.?]*$/i;

export function isStandaloneGreeting(value) {
  const input = String(value ?? '').trim().replace(/\\s+/g, ' ');
  return STANDALONE_GREETING.test(input);
}
