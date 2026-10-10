import { research } from './spike-research.mjs';
import { readJson, runBatches, compact } from './spike-lib.mjs';
try {
  const args=process.argv.slice(2);
  let result;
  if(args.length===1 && args[0]==='--research' || args.length===2 && args[0]==='--research' && ['--write-report','--verify-report'].includes(args[1])) {
    result=research(args.includes('--write-report'),args.includes('--verify-report'));
  } else if(args.length===2 && args[0]==='--plan') {
    const plan=readJson(args[1]);
    if(plan.planVersion!==1 || !Array.isArray(plan.batches) || plan.batches.length===0)throw new Error('Invalid spike plan.');
    result=compact(runBatches(plan.input,plan.batches));
    if(['validation_error','needs_refinement','risk_confirmation_required'].includes(result.outcome))process.exitCode=2;
  } else throw new Error('Use --research [--write-report|--verify-report] or --plan FILE. Research output includes private experimental warehouse data.');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch(error) {
  process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=2;
}
