// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {branchId,contentHash,git,mergeArchive,openBranches,preparePublication,renderSite} from '../scripts/pages.mjs';
import {storeArchive} from '../scripts/store-pages.mjs';

async function fixture(t) {
 const root=await mkdtemp(resolve(tmpdir(),'night-publication-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const repo=resolve(root,'repo'),build=resolve(root,'build'),archive=resolve(root,'archive');await mkdir(repo);
 git(repo,'init','-b','main');git(repo,'config','user.name','test');git(repo,'config','user.email','test@example.invalid');git(repo,'config','commit.gpgsign','false');
 for(const [path,text] of Object.entries({VERSION:'0.1.0-alpha.1\n',LICENSE:'GPL-3.0-only\n','CHANGELOG.md':'# Changes\n\n## Не выпущено\n'}))await writeFile(resolve(repo,path),text);
 git(repo,'add','.');git(repo,'commit','-m','#18 подготовил тест');
 await mkdir(resolve(build,'web'),{recursive:true});await writeFile(resolve(build,'index.html'),'<meta http-equiv="refresh" content="0;url=./web/index.html">');await writeFile(resolve(build,'web/app.mjs'),'export const version=1;');
 let n=0;
 return {root,repo,build,archive,async payload(options={}) {const output=resolve(root,'payload'+(++n));await preparePublication(repo,build,output,{branch:'main',runId:String(n),...options});return output;}};
}

test('dev retains latest build, resists delayed jobs, escapes names and removes closed branches',async t=>{
 const f=await fixture(t),branch='18-map/<label>&',branches=new Set(['main',branch]);
 const old=await f.payload({branch,runId:'10'});await mergeArchive(old,f.archive,{branches,runId:'10'});
 await writeFile(resolve(f.build,'web/app.mjs'),'export const version=2;');
 const latest=await f.payload({branch,runId:'20'});await mergeArchive(latest,f.archive,{branches,runId:'20'});await mergeArchive(old,f.archive,{branches,runId:'10'});
 const folder=resolve(f.archive,'dev',branchId(branch));assert.match(await readFile(resolve(folder,'web/app.mjs'),'utf8'),/version=2/);assert.equal((await readdir(resolve(f.archive,'dev'))).length,1);
 const site=resolve(f.root,'site');await renderSite(f.archive,site);
 const html=await readFile(resolve(site,'dev/index.html'),'utf8');assert.match(html,/&lt;label&gt;&amp;/);assert.doesNotMatch(html,/Все сборки|<label>/);assert.match(html,new RegExp(branchId(branch)));assert.equal(existsSync(resolve(site,'_dev-runs.json')),false);
 const empty=resolve(f.root,'empty');await mkdir(empty);
 await mergeArchive(empty,f.archive,{branches:new Set(['main']),runId:'30'});assert.equal(existsSync(folder),false);
 await mergeArchive(latest,f.archive,{branches,runId:'20'});assert.equal(existsSync(folder),false,'Old job resurrected closed/reopened PR');
 const reopened=await f.payload({branch,runId:'40'});await mergeArchive(reopened,f.archive,{branches,runId:'40'});assert.ok(existsSync(folder));
});

test('tags validate VERSION, changelog and main ancestry; releases remain immutable through dev pruning',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.payload({branch:'',tag:'v0.1.0'}),/match stable VERSION/);
 await writeFile(resolve(f.repo,'VERSION'),'0.1.0\n');git(f.repo,'add','.');git(f.repo,'commit','-m','#18 подготовил выпуск');git(f.repo,'tag','v0.1.0');
 await assert.rejects(f.payload({branch:'',tag:'v0.1.0',mainRef:'main'}),/CHANGELOG/);
 git(f.repo,'tag','-d','v0.1.0');await writeFile(resolve(f.repo,'CHANGELOG.md'),'# Changes\n\n## 0.1.0\n\nFirst spike.\n');git(f.repo,'add','.');git(f.repo,'commit','-m','#18 описал выпуск');git(f.repo,'tag','v0.1.0');
 const first=await f.payload({branch:'',tag:'v0.1.0',mainRef:'main',runId:'5'});await mergeArchive(first,f.archive,{branches:new Set(['main']),runId:'5'});
 const release=resolve(f.archive,'release/0.1.0'),hash=await contentHash(release);
 const retry=await f.payload({branch:'',tag:'v0.1.0',mainRef:'main',runId:'50'});await mergeArchive(retry,f.archive,{branches:new Set(['main']),runId:'50'});assert.equal(await contentHash(release),hash);
 await writeFile(resolve(f.build,'web/app.mjs'),'modified bytes');const modified=await f.payload({branch:'',tag:'v0.1.0',mainRef:'main'});await assert.rejects(mergeArchive(modified,f.archive,{branches:new Set(['main'])}),/immutable/);
 const dev=await f.payload({runId:'60'});await mergeArchive(dev,f.archive,{branches:new Set(['main']),runId:'60'});await mergeArchive(dev,f.archive,{branches:new Set(),runId:'70'});assert.equal(await contentHash(release),hash);
 const site=resolve(f.root,'site');await renderSite(f.archive,site);assert.ok(existsSync(resolve(site,'release/0.1.0/web/app.mjs')));assert.match(await readFile(resolve(site,'index.html'),'utf8'),/\.\/dev\//);assert.match(await readFile(resolve(site,'release/index.html'),'utf8'),/\.\/0\.1\.0\//);
 git(f.repo,'switch','-c','unmerged');await writeFile(resolve(f.repo,'VERSION'),'0.2.0\n');await writeFile(resolve(f.repo,'CHANGELOG.md'),'## 0.2.0\n');git(f.repo,'add','.');git(f.repo,'commit','-m','#18 подготовил другой выпуск');git(f.repo,'tag','v0.2.0');await assert.rejects(f.payload({branch:'',tag:'v0.2.0',mainRef:'main'}));
});

test('open PR lookup paginates and excludes forks/service branch; API failure aborts pruning',async()=>{
 const calls=[],repository='serefimov/into-the-night';
 const fetcher=async url=>{calls.push(url);return {ok:true,json:async()=>calls.length===1?Array.from({length:100},(_,i)=>({head:{ref:'branch'+i,repo:{full_name:repository}}})):[{head:{ref:'fork',repo:{full_name:'other/fork'}}},{head:{ref:'pages-archive',repo:{full_name:repository}}},{head:{ref:'final',repo:{full_name:repository}}}]};};
 const branches=await openBranches({repository,token:'test',fetcher});assert.equal(calls.length,2);assert.equal(branches.size,102);assert.ok(branches.has('main'));assert.ok(branches.has('final'));assert.equal(branches.has('fork'),false);assert.equal(branches.has('pages-archive'),false);
 await assert.rejects(openBranches({repository,token:'test',fetcher:async()=>({ok:false,status:403})}),/HTTP 403/);
});

test('non-forced archive retry preserves concurrent branches and identical retries add no commits',async t=>{
 const f=await fixture(t),remote=resolve(f.root,'remote.git');await mkdir(remote);git(remote,'init','--bare');git(f.repo,'remote','add','origin',remote);
 const a=await f.payload({branch:'a',runId:'10'}),b=await f.payload({branch:'b',runId:'11'}),branches=new Set(['main','a','b']);let calls=0;
 await storeArchive(f.repo,a,{runId:'10',eligibleBranches:async()=>{if(++calls===1)await storeArchive(f.repo,b,{runId:'11',eligibleBranches:async()=>branches});return branches;}});
 assert.equal(calls,2,'Expected optimistic push retry');
 const files=git(remote,'ls-tree','-r','--name-only','pages-archive');assert.ok(files.includes(`dev/${branchId('a')}/web/app.mjs`));assert.ok(files.includes(`dev/${branchId('b')}/web/app.mjs`));
 await storeArchive(f.repo,a,{runId:'10',eligibleBranches:async()=>branches});assert.equal(git(remote,'rev-list','--count','pages-archive'),'2','Identical retry added an archive commit');
 await storeArchive(f.repo,a,{runId:'20',eligibleBranches:async()=>new Set(['main','b'])});assert.doesNotMatch(git(remote,'ls-tree','-r','--name-only','pages-archive'),new RegExp(`dev/${branchId('a')}/`));
});

test('HTML, module imports and scenario files resolve inside a nested Pages deployment',async()=>{
 const base=new URL('https://serefimov.github.io/into-the-night/release/0.1.0/'),entry=new URL('./web/index.html',base),html=await readFile('web/index.html','utf8');
 for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {const url=new URL(match[1],entry);assert.ok(url.pathname.startsWith(base.pathname));assert.ok(existsSync(url.pathname.slice(base.pathname.length)));}
 const visited=new Set();
 async function moduleAt(path) {
  if(visited.has(path))return;visited.add(path);const text=await readFile(path,'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {const target=resolve(path,'..',match[1]);assert.ok(target.startsWith(resolve('.')+'/'));assert.ok(existsSync(target));await moduleAt(target);}
 }
 await moduleAt(resolve('web/app.mjs'));assert.ok(visited.size>5);
 for(const name of ['airports','scenario']) {const url=new URL(`../data/spike/${name}.json`,new URL('web/app.mjs',base));assert.ok(url.pathname.startsWith(base.pathname));assert.ok(existsSync('data/spike/'+name+'.json'));}
});
