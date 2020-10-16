const Terser = require('terser')
const {
    TreeWalker,
    TreeTransformer,
    Compressor
} = Terser;
const CodeGen = require('./codegen')
const VMBuilder = require('./virtualmachine')

module.exports.Transformer = function(src){
    let res = Terser.minify(src, {
        compress: {
            defaults: false,
            hoist_vars: true,
            hoist_funs: true
        },
        mangle: false,
        output: {
            beautify: true,
            ast: true,
        }
    });
    if (res.error)
        throw res.error

    let AST = res.ast;

    let middle = CodeGen.GenCode(AST, {})

    let vmscript = VMBuilder.buildvmjs(middle)
    let minifiedVMres = Terser.minify(vmscript, {
        mangle: {
            toplevel: true,
            properties: {
                keep_quoted: true,
                undeclared: true
            },
            reserved: ["vmrun"],
        },
        output: {
            beautify: false,
        }
    });
    let minifiedVM = minifiedVMres.code
    return minifiedVM
}