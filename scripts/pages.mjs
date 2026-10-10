// SPDX-License-Identifier: GPL-3.0-only
import {cp, mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const git = (repo,...args)=>execFileSync('git',args,{cwd:repo,stdio:['ignore','pipe','pipe']}).toString().trim();
const json = async path=>JSON.parse(await readFile(path,'utf8'));
const writeJson = (path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const dirs = async path=>existsSync(path)?(await readdir(path,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort():[];
export const branchId = branch=>Buffer.from(branch).toString('base64url');
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|pre|rc)(?:\.(?:0|[1-9]\d*))?)?$/;
const escape = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page = (title,body)=>`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:850px;margin:24px auto;padding:0 16px;line-height:1.5}li{margin:16px 0}a{overflow-wrap:anywhere}small{display:block;color:#555}</style></head><body><h1>${escape(title)}</h1>${body}</body></html>\n`;
const validRun = value=>{if(!/^\d+$/.test(String(value)))throw Error('Invalid Pages run ID.');return String(value);};

/** Content hash covers every published byte, excluding build metadata. */
export async function contentHash(folder) {
 const hash=createHash('sha256');
 async function visit(path,prefix='') {
  for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
   const name=prefix+entry.name;if(!prefix&&entry.name==='publication.json')continue;
   if(entry.isDirectory())await visit(resolve(path,entry.name),name+'/');
   else if(entry.isFile()) {const bytes=await readFile(resolve(path,entry.name));hash.update(name+'\0'+bytes.length+'\0');hash.update(bytes);}
   else throw Error('Publication must contain regular files only.');
  }
 }
 await visit(folder);return hash.digest('hex');
}

export async function preparePublication(repo,build,output,{branch='',tag='',mainRef='origin/main',runId='0',repository='serefimov/into-the-night',builtAt=new Date().toISOString()}={}) {
 if(branch&&tag)throw Error('Choose a branch or release tag.');
 const version=(await readFile(resolve(repo,'VERSION'),'utf8')).trim();
 if(!versionPattern.test(version))throw Error('Invalid VERSION.');
 const commit=git(repo,'rev-parse','HEAD');
 if(tag) {
  if(!stable.test(version)||tag!=='v'+version)throw Error('Release tag must be vX.Y.Z and match stable VERSION.');
  if(git(repo,'rev-parse',tag+'^{commit}')!==commit)throw Error('Release tag differs from checkout.');
  git(repo,'merge-base','--is-ancestor',commit,mainRef);
  const changelog=await readFile(resolve(repo,'CHANGELOG.md'),'utf8');
  if(!changelog.split('\n').some(line=>line===`## ${version}`||line.startsWith(`## ${version} — `)))throw Error('Release needs a CHANGELOG section.');
 }
 await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
 if(!branch&&!tag)return;
 const kind=tag?'release':'dev',name=tag?version:branchId(branch),folder=resolve(output,kind,name);
 await cp(build,folder,{recursive:true});
 if(!existsSync(resolve(folder,'index.html'))||!existsSync(resolve(folder,'web/app.mjs')))throw Error('Browser build is missing.');
 for(const path of ['LICENSE','VERSION','CHANGELOG.md'])await cp(resolve(repo,path),resolve(folder,path));
 const record={kind,branch,tag,version,commit,runId:validRun(runId),builtAt,source:`https://github.com/${repository}/tree/${commit}`};
 record.contentHash=await contentHash(folder);await writeJson(resolve(folder,'publication.json'),record);
}

/** Eligible dev branches: default branch plus same-repository, open PR heads. */
export async function openBranches({repository,token,defaultBranch='main',fetcher=fetch}) {
 if(!repository||!token)throw Error('GitHub repository/token required to synchronize open PRs.');
 const branches=new Set([defaultBranch]);
 for(let page=1;;page++) {
  const response=await fetcher(`https://api.github.com/repos/${repository}/pulls?state=open&per_page=100&page=${page}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
  if(!response.ok)throw Error(`Open PR lookup failed: HTTP ${response.status}`);
  const prs=await response.json();if(!Array.isArray(prs))throw Error('Invalid open PR response.');
  for(const pr of prs)if(pr.head?.repo?.full_name===repository)branches.add(pr.head.ref);
  if(prs.length<100)break;
 }
 branches.delete('pages-archive');return branches;
}

export async function mergeArchive(payload,archive,{branches,runId='0'}) {
 const currentRun=BigInt(validRun(runId));await mkdir(archive,{recursive:true});
 const statePath=resolve(archive,'_dev-runs.json'),watermarks=existsSync(statePath)?await json(statePath):{};
 // Tombstones keep delayed jobs from resurrecting a closed/reopened branch.
 for(const id of await dirs(resolve(archive,'dev'))) {
  const folder=resolve(archive,'dev',id),record=await json(resolve(folder,'publication.json'));
  if(!branches.has(record.branch)) {
   watermarks[id]=String(BigInt(watermarks[id]??'0')>currentRun?BigInt(watermarks[id]):currentRun);
   await rm(folder,{recursive:true,force:true});
  }
 }
 for(const kind of ['release','dev'])for(const name of await dirs(resolve(payload,kind))) {
  if(!(kind==='release'?stable.test(name):/^[A-Za-z0-9_-]+$/.test(name)))throw Error('Invalid publication path.');
  const from=resolve(payload,kind,name),record=await json(resolve(from,'publication.json')),to=resolve(archive,kind,name);
  if(record.kind!==kind||!/^([a-f0-9]{40})$/.test(record.commit)||record.contentHash!==await contentHash(from))throw Error('Invalid publication metadata/hash.');
  validRun(record.runId);
  if(kind==='release') {
   if(record.version!==name||record.tag!=='v'+name)throw Error('Invalid release version.');
   if(existsSync(to)) {
    const old=await json(resolve(to,'publication.json'));
    if(old.commit!==record.commit||old.contentHash!==record.contentHash||await contentHash(to)!==record.contentHash)throw Error('Published release is immutable: '+name);
    continue;
   }
  } else {
   if(branchId(record.branch)!==name)throw Error('Invalid branch path.');
   if(!branches.has(record.branch))continue;
   if(BigInt(record.runId)<=BigInt(watermarks[name]??'-1'))continue;
   if(existsSync(to)) {
    const old=await json(resolve(to,'publication.json'));
    if(BigInt(record.runId)<=BigInt(old.runId))continue;
    await rm(to,{recursive:true,force:true});
   }
   watermarks[name]=record.runId;
  }
  await cp(from,to,{recursive:true});
 }
 await writeJson(statePath,watermarks);
}

export async function renderSite(archive,output) {
 await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
 for(const kind of ['dev','release'])await mkdir(resolve(output,kind),{recursive:true});
 let branches='';
 const records=await Promise.all((await dirs(resolve(archive,'dev'))).map(async id=>({id,...await json(resolve(archive,'dev',id,'publication.json'))})));
 for(const record of records.sort((a,b)=>a.branch.localeCompare(b.branch))) {
  if(branchId(record.branch)!==record.id)throw Error('Invalid archive branch.');
  await cp(resolve(archive,'dev',record.id),resolve(output,'dev',record.id),{recursive:true});
  branches+=`<li><a href="./${record.id}/">${escape(record.branch)}</a><small>${escape(record.version)} · ${escape(record.builtAt)} · <a href="${escape(record.source)}">${escape(record.commit.slice(0,12))}</a></small></li>`;
 }
 const versions=(await dirs(resolve(archive,'release'))).sort((a,b)=>{
  if(!stable.test(a)||!stable.test(b))throw Error('Invalid archive release.');
  const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?-1:1;return 0;
 });
 for(const version of versions)await cp(resolve(archive,'release',version),resolve(output,'release',version),{recursive:true});
 await writeFile(resolve(output,'index.html'),page('Into the Night','<p><a href="./dev/">Dev — последние сборки открытых веток</a></p><p><a href="./release/">Release — выпуски по тегам</a></p><p>Экспериментальная игра о выживании, маршрутах и сезонном ожидании.</p>'));
 await writeFile(resolve(output,'dev/index.html'),page('Dev · Into the Night',`<p><a href="../">Главная</a></p><p>Последние успешные сборки main и веток с открытыми PR. Сборки экспериментальны.</p>${branches?`<ul>${branches}</ul>`:'<p>Сборок пока нет.</p>'}`));
 await writeFile(resolve(output,'release/index.html'),page('Release · Into the Night',`<p><a href="../">Главная</a></p>${versions.length?`<ul>${versions.map(v=>`<li><a href="./${v}/">${v}</a></li>`).join('')}</ul>`:'<p>Релизов пока нет.</p>'}`));
 await writeFile(resolve(output,'.nojekyll'),'');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv[2]==='prepare')await preparePublication(process.cwd(),resolve('.build/spike'),resolve('.build/pages-payload'),{branch:process.env.PAGES_BRANCH,tag:process.env.PAGES_RELEASE_TAG,mainRef:process.env.PAGES_MAIN_REF,runId:process.env.GITHUB_RUN_ID,repository:process.env.GITHUB_REPOSITORY});
 else if(process.argv[2]==='render'&&process.argv.length===5)await renderSite(resolve(process.argv[3]),resolve(process.argv[4]));
 else throw Error('Use pages.mjs prepare | render ARCHIVE OUTPUT');
}
