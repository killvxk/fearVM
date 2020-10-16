const VMTransformer = require('./VM/Transform')
const VM = require('./VM/virtualmachine')

let src = `
function GetConsolelog(){
    this.console = console;
    return (()=>{
        return this.console.log;
    })()
}
let data = [1,2,3,4];
GetConsolelog()(...data);
`

let optable = VM.generateRandomOpTable(); // optional
let script = VMTransformer.Transformer(src, optable);
eval(script)