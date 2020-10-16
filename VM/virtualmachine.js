const OpCodes = require('./opcodes')
const Terser = require('terser')

function vmrun(ops, _global, ip, stack, SP, exceptions) {
    if (SP === undefined)
        SP = [-1];
    if (ip === undefined)
        ip = 0;
    if (stack === undefined)
        stack = [-1];
    if (exceptions === undefined)
        exceptions = [];

    /* INSIDEHELPERS HERE */
    /* HANDLERS HERE */

    while (true) {
        try {
            while (true) {
                let op = ops[ip++];
                if (op === undefined) {
                    ip = -1;
                    break; // Packed VMFunction
                }
                let handler = handlers[op];
                let args = ops.slice(ip, ip + handler.length);
                ip += handler.length
                if (handler.apply(this, args) || ip < 0)
                    break
            }
            if (ip < 0)
                return stack.pop();
        } catch (e) {
            let ex = exceptions.pop();
            if (ex === undefined)
                throw e

            let bcatch = ex[0];
            let bfinally = ex[1];
            stack.length = ex[2]; // recover stack
            SP.length = ex[3]; // recover SP

            if (bcatch) {
                bcatch(e)
            }
            ip = bfinally
        }
    }
}

module.exports.generateRandomOpTable = function generateRandomOpTable() {
    let oporder = Object.keys(OpCodes.OpHandlers).sort();
    const shuffleArray = arr => arr
        .map(a => [Math.random(), a])
        .sort((a, b) => a[0] - b[0])
        .map(a => a[1]);

    oporder = shuffleArray(oporder)
    
    let opcodes = {}
    let codeops = {}
    for (let i = 0; i < oporder.length; i++) {
        opcodes[oporder[i]] = i;
        codeops[i] = oporder[i];
    }

    let orderedHandlers = new Array(opcodes.length);
    for (const [id, name] of Object.entries(codeops)) {
        orderedHandlers[id] = OpCodes.OpHandlers[name];
    }

    return {
        OpCodes: opcodes,
        CodeOps: codeops,
        OrderedHandlers: orderedHandlers
    }
}

module.exports.buildVirtualMachine = function buildVirtualMachine(optable) {
    let base = vmrun.toString()
    if (optable === undefined)
        optable = OpCodes

    let commentedHandlers = optable.OrderedHandlers;

    for (let i = 0; i < commentedHandlers.length; i++) {
        commentedHandlers[i] = `/* ${optable.CodeOps[i]} */` + commentedHandlers[i];
    }
    let handler = `let handlers = [${ commentedHandlers.join(",") }]`
        .replace('/* OPEXPANSION HERE */', `const opEXPANSION = ${optable.OpCodes.EXPANSION}`)
        .replace('/* OPARGNEXT HERE */', `const opArgNext = ${optable.OpCodes.ARGNEXT}`)
        .replace(' /* OPFUNCEND HERE */', `const opFuncEnd = ${optable.OpCodes.FUNCEND}`)

    let insidehelper = OpCodes.InsideHelpers.join(";")
        .replace('/* OPRELCALL HERE */', `const opRELCALL = ${optable.OpCodes.RELCALL}`)
    let helper = OpCodes.Helpers.join(";")

    base = base.replace('/* INSIDEHELPERS HERE */', insidehelper)
        .replace('/* HANDLERS HERE */', handler)

    let code = helper + base;
    return `let vmrun = (function(){${code};return vmrun;})();`;
}

module.exports.buildJS = function buildJS(middle, optable) {
    let code = `vmrun(${middle.data.toString(optable)},${middle.nonlocal})` +
        `/*${ JSON.stringify(middle.data, null, 4) }*/`
    return code
}

module.exports.buildvmjs = function (middle, optable) {
    let code = buildVirtualMachine(optable) + buildJS(middle, optable)
    let res = Terser.minify(code, {
        compress: {
            defaults: false,
        },
        mangle: false,
        output: {
            beautify: true,
            code: true,
            comments: true,
            braces: true,
            semicolons: false,
        }
    });

    if (res.error)
        throw res.error;
    return res.code;
}