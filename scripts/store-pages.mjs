// SPDX-License-Identifier: GPL-3.0-only
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {git,mergeArchive,openBranches} from './pages.mjs';

/** Non-forced push is the archive compare-and-swap; re-read on a competing write. */
export async function storeArchive(repo,payload,{attempts=8,remote='origin',branch='pages-archive',runId='0',eligibleBranches}={}) {
 const worktree=await mkdtemp(resolve(tmpdir(),'night-pages-')),tracking=`refs/remotes/${remote}/${branch}`;
 let added=false;
 try {
  git(repo,'worktree','add','--detach',worktree,'HEAD');added=true;
  git(worktree,'config','user.name','github-actions[bot]');git(worktree,'config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
  for(let attempt=0;attempt<attempts;attempt++) {
   const before=git(repo,'ls-remote','--heads',remote,`refs/heads/${branch}`).split(/\s/)[0];
   if(before) {
    git(repo,'fetch',remote,`+refs/heads/${branch}:${tracking}`);git(worktree,'checkout','--detach',tracking);git(worktree,'reset','--hard',tracking);
   } else {git(worktree,'checkout','--orphan',`pages-initial-${worktree.split('/').at(-1)}-${attempt}`);git(worktree,'rm','-rf','.');}
   git(worktree,'clean','-fd');
   // Lookup is inside every retry, so closed PRs are not a stale build-time snapshot.
   const branches=await eligibleBranches();await mergeArchive(payload,worktree,{branches,runId});
   git(worktree,'add','.');if(!git(worktree,'diff','--cached','--name-only'))return;
   git(worktree,'-c','commit.gpgsign=false','commit','-m','#18 обновил публикации GitHub Pages');
   try {git(worktree,'push',remote,`HEAD:refs/heads/${branch}`);return;}
   catch(error) {
    const after=git(repo,'ls-remote','--heads',remote,`refs/heads/${branch}`).split(/\s/)[0];
    if(attempt===attempts-1||!after||after===before)throw error;
   }
  }
 } finally {if(added)git(repo,'worktree','remove','--force',worktree);await rm(worktree,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await storeArchive(process.cwd(),resolve('.build/pages-payload'),{runId:process.env.GITHUB_RUN_ID,eligibleBranches:async()=>{
 const branches=await openBranches({repository:process.env.GITHUB_REPOSITORY,token:process.env.GH_TOKEN,defaultBranch:process.env.PAGES_DEFAULT_BRANCH??'main'});
 const heads=new Set(git(process.cwd(),'ls-remote','--heads','origin').split('\n').filter(Boolean).map(line=>line.split('\t')[1].slice('refs/heads/'.length)));
 return new Set([...branches].filter(branch=>heads.has(branch)));
}});
