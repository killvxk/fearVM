const fs = require('fs')
const ManglerTransformer = require('./Mangler/Transform')

//let src = fs.readFileSync("test.js", 'utf8');
let src = `
/* VMRUN */
console.log(
/* VM_START_R */
Math.max(1,2,3)
/* VM_END */
);

/* VM_START */
console.log(2,3,4)
/* VM_END */
`
let script = ManglerTransformer.Transformer(src, false)
//console.log(script)
eval(script)
//fs.writeFileSync("vm.js", script);