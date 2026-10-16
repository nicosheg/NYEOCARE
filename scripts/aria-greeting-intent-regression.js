import { readFileSync } from 'node:fs';
import { isStandaloneGreeting } from '../lib/aria/greetingIntent.js';

const cases = [
  ['hi', true],
  ['Hello!', true],
  ['Hey there', true],
  ['Hi Aria', true],
  ['Good morning Aria.', true],
  ['Hello, everyone!', true],
  ['Hi Aria, I want u to list all the people we have in this organization and their numbers', false],
  ['Hello, please show me the attendance session.', false],
  ['Hey, can you help me review the People page?', false],
  ['Good afternoon. Please list the members.', false],
  ['Hi, what can you do?', false],
  ['I want u to list all the people we have in this organization and their numbers', false]
];

const failures = [];
for (const [input, expected] of cases) {
  const actual = isStandaloneGreeting(input);
  if (actual !== expected) failures.push({ input, expected, actual });
}

const commandEngine = readFileSync('lib/aria/commandEngine.js', 'utf8');
const conversationEngine = readFileSync('lib/aria/conversationEngine.js', 'utf8');
if (!commandEngine.includes('if(isStandaloneGreeting(input))')) {
  failures.push({ input: 'command planner integration', expected: 'standalone greeting check', actual: 'missing' });
}
if (!conversationEngine.includes('if(isStandaloneGreeting(message))')) {
  failures.push({ input: 'conversation fallback integration', expected: 'standalone greeting check', actual: 'missing' });
}

if (failures.length) {
  console.error('[ARIA GREETING INTENT REGRESSION] FAILED');
  for (const item of failures) console.error(JSON.stringify(item));
  process.exit(1);
}

console.log('[ARIA GREETING INTENT REGRESSION] PASS: greetings with real requests continue to intent planning.');
