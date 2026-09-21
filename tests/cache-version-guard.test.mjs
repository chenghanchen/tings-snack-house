import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { managedResources, checkResourceVersions, resourceParts, checkGitVersions } from '../scripts/cache-version-guard.mjs';
const hash=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
function fixture() {
 const files=Object.fromEntries(Object.keys(managedResources).map(f=>[f,'/* '+f+' */']));
 const html=()=>Object.entries(managedResources).map(([f,r])=>r.tag==='script'?
  '<script src="'+f+'?v='+hash(files[f])+'"></script>':'<link rel="stylesheet" href="'+f+'?v='+hash(files[f])+'">').join('\n');
 files['index.html']=html();files['admin.html']='<p>Admin</p>';
 const old={...files};
 const git=(command,...args)=>{
  const tree=args.find(a=>a==='before'||a==='after');
  const data=tree==='before'?old:files;
  if(command==='ls-tree'&&args.includes('-r'))return Object.keys(data).join('\0')+'\0';
  if(command==='ls-tree')return data[args.at(-1)]===undefined?'':'100644 blob '+hash(data[args.at(-1)]);
  if(command==='show'){const [version,file]=args[0].split(':');if(!(file in (version==='before'?old:files)))throw Error('missing');return(version==='before'?old:files)[file];}
  throw Error('unknown fixture operation');
 };
 return {files,old,html,check:(changes=[{path:'index.html'}])=>checkResourceVersions(git,'before','after',changes)};
}
test('managed resource scope remains the four audited assets',()=>{
 assert.deepEqual(Object.keys(managedResources),['styles.css','mobile-header.js','customer-account.css','customer-account.js']);
});
test('managed changed bytes require updated real hash version',()=>{
 const f=fixture();assert.equal(f.check().status,'PASS');
 f.files['styles.css']='p{color:red}';
 const changes=[{path:'styles.css',before:f.old['styles.css'],after:f.files['styles.css']}];
 assert.equal(f.check(changes).status,'FAIL');
 f.files['index.html']=f.html();assert.equal(f.check(changes).status,'PASS');
 assert.equal(f.check(changes).checked.length,4);
});
for(const kind of ['missing','duplicate','alias','extra consumer','opaque','stale version'])
 test('cache fail closed: '+kind,()=>{
  const f=fixture();
  if(kind==='missing')f.files['index.html']='';
  if(kind==='duplicate')f.files['index.html']+='\n'+f.files['index.html'];
  if(kind==='alias')f.files['index.html']=f.files['index.html'].replace('styles.css?','/styles.css?');
  if(kind==='extra consumer')f.files['nested.html']=f.files['index.html'];
  if(kind==='opaque')f.files['index.html']+='<script>load("styles.css")</script>';
  if(kind==='stale version')f.files['index.html']=f.files['index.html'].replace(/\?v=[a-f0-9]+/,'?v=stale');
  assert.equal(f.check().status,'FAIL');
 });
test('non-relevant diff stays NOT_REQUIRED; malformed input cannot pass',()=>{
 assert.equal(fixture().check([{path:'scripts/ci-check.mjs'}]).status,'NOT_REQUIRED');
 assert.throws(()=>resourceParts('<base href="/">'));
 assert.throws(()=>checkGitVersions('.',null,null));
});
