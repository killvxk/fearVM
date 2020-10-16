const Terser = require('terser')
const {
    JSFuck
} = require('jsfuck')
const {
    TreeWalker,
    TreeTransformer,
    Compressor
} = Terser;
const VM = require('../VM/virtualmachine')
const VMC = require('../VM/codegen')

function make_node(ctor, orig, props) {
    if (!props) props = {};
    if (orig) {
        if (!props.start) props.start = orig.start;
        if (!props.end) props.end = orig.end;
    }
    return new ctor(props);
}

function sortObjKeyByValue(obj) {
    return Object.keys(obj).sort(function (a, b) {
        return obj[b] - obj[a]
    })
}

function shuffle_lst(lst) {
    var j, x, i;
    for (i = lst.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = lst[i];
        lst[i] = lst[j];
        lst[j] = x;
    }
    return lst;
}

function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

function ReplaceText(txt, transforms) {
    var extraOffset = 0
    for (transform of transforms) {
        var ori_length = transform.end - transform.start

        let A = txt.slice(0, transform.start + extraOffset)
        let B = txt.slice(transform.end + extraOffset)
        extraOffset += transform.value.length - ori_length
        txt = A + transform.value + B
    }
    return txt
}

function code2ast(code) {
    let res = Terser.minify(code, {
        compress: false,
        mangle: false,
        output: {
            ast: true,
            comments: true,
        }
    });
    if (res.error)
        throw res.error

    return res.ast
}

function code2vmast(code) {
    let res = Terser.minify("(" + code + ")", {
        compress: false,
        output: {
            ast: true,
        }
    });
    if (res.error)
        throw res.error

    return res.ast
}

let Transformers = {
    Dot2Sub: function (ast) {
        let transformer = new TreeTransformer(null, function (node, descend) {
            if (node instanceof Terser.AST_Dot) {
                return make_node(Terser.AST_Sub, node, {
                    expression: node.expression,
                    property: new Terser.AST_String({
                        value: node.property
                    })
                });
            }
        });
        return ast.transform(transformer)
    },
    StrConfusing: function (ast, {
        usejsfuck
    }) {
        let strs = Collectors.Strings(ast)
        strs.push("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")
        let literals = {}
        for (str of strs) {
            literals[str] = 1 + (literals[str] || 0)
        }
        let sorted_literal = sortObjKeyByValue(literals)
        let chars = new Set()
        for (let literal of sorted_literal) {
            for (let ch of [...literal]) {
                chars.add(ch)
            }
        }
        let literal_chars = shuffle_lst([...chars])
        let literal_int_XOR_key = 6 + getRandomInt(250)
        let literal_int_index_offset = getRandomInt(128)
        let literal_ints = literal_chars.map(e => e.charCodeAt(0) ^ literal_int_XOR_key)
        let FEAR_STRING_DECODER = (...arg) => {
            return ([] + [])["constructor"]["fromCharCode"](...(arg["map"](
                _ => $[-(+literal_int_index_offset) + _] ^ literal_int_XOR_key
            )))
        }
        let FEAR_STRING_DECODER_str = FEAR_STRING_DECODER.toString()
        if (usejsfuck) {
            FEAR_STRING_DECODER_str = FEAR_STRING_DECODER_str
                //.replace('"constructor"', JSFuck.encode("constructor"))
                //.replace('"fromCharCode"', JSFuck.encode("fromCharCode"))
                //.replace('"map"', JSFuck.encode("map"))
                .replace("literal_int_index_offset", JSFuck.encode("" + literal_int_index_offset))
                .replace("literal_int_XOR_key", JSFuck.encode("" + literal_int_XOR_key))
        } else {
            FEAR_STRING_DECODER_str = FEAR_STRING_DECODER_str
                .replace("literal_int_index_offset", "" + literal_int_index_offset)
                .replace("literal_int_XOR_key", "" + literal_int_XOR_key)
        }

        const max_herstory_count = 16
        let transformer = new TreeTransformer(null, function (node, descend) {
            if (node instanceof Terser.AST_String) {
                let strindex = sorted_literal.indexOf(node.value)
                if (strindex < 0)
                    throw ""
                if (strindex < max_herstory_count) {
                    return make_node(Terser.AST_SymbolRef, node, {
                        name: "FEAR_STRING_" + strindex
                    })
                }
                return make_node(Terser.AST_Call, node, {
                    expression: new Terser.AST_SymbolRef({
                        name: "FEAR_STRING_DECODER"
                    }),
                    args: node.value.length ? [...node.value].map(v => {
                        return new Terser.AST_Number({
                            value: literal_ints.indexOf(
                                v.charCodeAt(0) ^ literal_int_XOR_key
                            ) + literal_int_index_offset
                        })
                    }) : null
                });
            }
        });

        ast = ast.transform(transformer); {
            let modified = ast.print_to_string({
                beautify: true,
                comments: true
            });
            for (let i = 0; i < Math.min(max_herstory_count, sorted_literal.length); i++) {
                modified = `let FEAR_STRING_${i} = FEAR_STRING_DECODER(${
                    [...sorted_literal[i]].map(v => literal_ints.indexOf(
                        v.charCodeAt(0) ^ literal_int_XOR_key
                    ) + literal_int_index_offset).join(",")
                });
                ` + modified
            }
            let res = Terser.minify(modified, {
                compress: false,
                mangle: false,
                output: {
                    ast: true,
                    comments: true,
                },
                enclose: `FEAR_STRING_DECODER : (function(){
                    let $ = ${JSON.stringify(literal_ints)};
                    return ${FEAR_STRING_DECODER_str}}
                )()`
            });
            if (res.error)
                throw res.error
            ast = res.ast
        }

        return ast
    },
    MakeVM: function(ast){
        let jsscript = ast.print_to_string({
            beautify: true,
            comments: true
        })
        ast = code2ast(jsscript)
        let optable = VM.generateRandomOpTable();
        let markReplace = []
        let commnets = Collectors.Comments(ast)
        for(comment of commnets)
        {
            if (comment.value.trim() == "VMRUN")
            {
                markReplace.push({
                    start: comment.pos,
                    end: comment.endpos,
                    value: VM.buildVirtualMachine(optable),
                })
                break;
            }
        }

        let VMStatus = false;
        let startPos = 0;
        for (comment of commnets) {
            if (!VMStatus)
            {
                if (comment.value.trim() == "VM_START")
                {
                    VMStatus = "VM_S"
                    startPos = comment.pos
                } else if (comment.value.trim() == "VM_START_R")
                {
                    VMStatus = "VM_R"
                    startPos = comment.pos
                }
                continue
            }
            if (comment.value.trim() == "VM_END")
            {
                let part = jsscript.slice(startPos, comment.endpos);
                let middle = VMC.GenCode(code2vmast(part), {
                    bRValue: VMStatus !== "VM_S"
                })
                markReplace.push({
                    start: startPos,
                    end: comment.endpos,
                    value: VM.buildJS(middle, optable),
                })
                VMStatus = false
            }
        }

        jsscript = ReplaceText(jsscript, markReplace)
        ast = code2ast(jsscript)
        return ast
    },
    Mangler: function(ast){
        let res = Terser.minify(ast.print_to_string({
                beautify: true,
                comments: true
            }), {
            mangle: {
                toplevel: true,
                properties: {
                    undeclared: true
                },
                reserved: ["vmrun", "require", "exports"],
            },
            output: {
                ast: true,
            }
        });
        if (res.error)
            throw res.error
        return res.ast
    }
}

let Collectors = {
    Strings: function (ast) {
        let results = []
        let walker = new Terser.TreeWalker((node, descend) => {
            if (node instanceof Terser.AST_String) {
                results.push(node.value)
            }
        });
        ast.walk(walker)
        return results
    },
    Comments: function (ast) {
        let results = []
        let walker = new Terser.TreeWalker(function (node, descend) {
            if (node.start && node.start.comments_before.length) {
                node.start.comments_before.map(token => results.push(token))
            }
            if (node.end && node.end.comments_after.length) {
                node.end.comments_after.map(token => results.push(token))
            }
        })
        ast.walk(walker)

        var poss = new Set();
        results = results.filter(item =>
            !poss.has(item.pos) ? poss.add(item.pos) : false);

        results = results.sort((a, b) => {
            return a.pos - b.pos
        })
        return results
    }
}

module.exports.Transformer = function (src, debugMode = true) {
    let ast = code2ast("let _FEAR_DEBUG_ = " + debugMode + ";" + src);
    ast = Transformers.MakeVM(ast);
    ast = Transformers.Dot2Sub(ast);
    ast = Transformers.StrConfusing(ast, {
        usejsfuck: !debugMode
    });
    if (!debugMode)
    {
        ast = Transformers.Mangler(ast);
    }

    return ast.print_to_string({
        beautify: debugMode,
        comments: debugMode
    })
}