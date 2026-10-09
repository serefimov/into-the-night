import { validationReport } from './solar-validation.mjs';
const report=validationReport();
console.log(JSON.stringify(report,null,2));
if(!report.passed) process.exitCode=1;
