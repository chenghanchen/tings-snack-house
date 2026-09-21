import test from 'node:test';
import assert from 'node:assert/strict';
import {scanText} from '../scripts/release-security.mjs';

// Preserved from the retired report tests: the scanner is still a real safety check.
test('secret scanner reports positions without exposing values; public anon is not a server secret',()=>{
 const secret=['sb','secret','X'.repeat(30)].join('_');
 const jwt=role=>['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');
 const findings=scanText('first line\n'+secret+'\n'+jwt('service_role'),'fixture.txt');
 assert.deepEqual(findings.map(x=>x.rule),['supabase-secret','non-public-jwt']);
 assert.equal(findings[0].line,2);
 assert.ok(!JSON.stringify(findings).includes(secret));
 assert.equal(scanText(jwt('anon'),'public.js').length,0);
});
