let Variable = function Variable(value, level, id) {
    this._value = value;
    this._level = level;
    this._id = id;
}

let Member = function Member(parent, prop, fromGlobal) {
    this._value = parent[prop];
    this._parent = parent;
    this.prop = prop;
    this.fromGlobal = fromGlobal;
}

let Expandable = function Expandable(value) {
    this._value = value;
}

let VMFunction = function VMFunction(type, target) {
    /* OPRELCALL HERE */
    let local = {
        _stack: [...stack],
        SP: [...SP],
        ops: [...ops, opRELCALL]
    }
    let entrance = ops.length;

    return function (...args) {
        local._stack.push(args)
        local._stack.push([type, target])
        return vmrun(local.ops, _global, entrance, local._stack, local.SP, undefined)
    }
}

function extractVar(src) {
    let srcv;
    if (src instanceof Variable) {
        if (src._level !== undefined)
            srcv = src._value.a[0];
        else // Global Variables
            srcv = src._value;
    } else if (src instanceof Member) {
        srcv = src._value;
    } else {
        srcv = src;
    }
    return srcv;
}

function popArgs(argc) {
    args = []
    for (let i = 0; i < argc; i++) {
        let arg = extractVar(stack.pop());
        if (arg instanceof Expandable) {
            args = args.concat(arg._value.reverse())
        } else {
            args.push(arg)
        }
    }
    args = args.reverse();
    return args
}

let helpers = [
    Variable, Member, Expandable, extractVar
]
let Insidehelpers = [
    VMFunction, popArgs
]

let optable = {
    HALT: function () {
        let result = extractVar(stack.pop());
        let len = SP.pop()
        stack.length = len;
        ip = stack.pop()
        stack.push(result)
        return true;
    },
    LEAVESCOPE: function () {
        let len = SP.pop()
        stack.length = len;
    },
    NOP: function () {},
    TOP: function (size) {
        SP.push(stack.length);
        for (let i = 0; i < size + 1; i++) {
            stack.push({
                a: []
            })
        }
    },
    UNDEFINED: function () {
        stack.push(undefined);
    },
    NULL: function () {
        stack.push(null);
    },
    TRUE: function () {
        stack.push(true);
    },
    FALSE: function () {
        stack.push(false);
    },
    PUSH: function (value) {
        stack.push(value);
    },
    POP: function () {
        stack.pop();
    },
    STRING: function () {
        stack.push("")
    },
    CHAR: function (ch) {
        stack[stack.length - 1] += String.fromCharCode(ch ^ 0x39)
    },
    BIND: function () {
        let id = stack.pop();
        let level = stack.pop() + 1;
        let BP = SP[SP.length - 1 - level];
        let register = new Variable(stack[BP + id], level, id);
        stack.push(register)
    }, // 外部变量
    BINDg: function () {
        let id = stack.pop();
        let register = new Variable(_global[id](), undefined, id);
        stack.push(register)
    }, // 全局变量
    BINDv: function () {
        let id = stack.pop();
        let BP = SP[SP.length - 1];
        let register = new Variable(stack[BP + id], 0, id);
        if (id == 0 && register._value.a[0] == undefined) {
            // 对arrowfunction以及block的this额外处理
            for (let i = SP.length - 2; i > 0; i--) {
                let _BP = SP[i];
                if (stack[_BP].a[0] !== undefined) {
                    register._value = stack[_BP];
                    register._level = SP.length - 1 - i;
                    stack.push(register)
                    return
                }
            }
            register._value = _global[0];
            register._level = undefined;
        }
        stack.push(register)
        return

    }, // 局部变量
    LOAD: function () {
        stack.push(extractVar(stack.pop()))
    },
    STORE: function () {
        let src = stack.pop();
        let target = stack.pop();

        let srcv = extractVar(src);

        if (target instanceof Member) {
            target._parent[target.prop] = srcv;
        } else if (target instanceof Variable) {
            if (target._level === undefined) {
                _global[target._id](srcv);
            } else {
                let BP = SP[SP.length - 1 - target._level];
                stack[BP + target._id].a[0] = srcv;
            }
        } else {
            throw ""
        }

        stack.push(src)
    },
    ACCESS: function () {
        let property = stack.pop();
        let ref = stack.pop();
        let fromGlobal = false;
        if (ref instanceof Variable && ref._level === undefined) {
            fromGlobal = true
        } else if (ref instanceof Member) {
            fromGlobal = ref.fromGlobal
        }
        stack.push(new Member(extractVar(ref), extractVar(property), fromGlobal))
    },
    PROPERTIES: function () {
        let values = [];
        for (let x in stack.pop()) {
            values.push(x)
        }
        stack.push(values)
    },
    EXTRACT: function () {
        let ref = stack[stack.length - 1]
        if (ref.length) {
            stack.push(ref.shift(), true)
        } else {
            stack.push(undefined, false)
        }
    },
    DELETE: function () {
        let ref = stack.pop();
        if (!ref instanceof Member) {
            throw ""
        }
        delete ref._parent[ref.prop];
    },
    THROW: function () {
        let value = stack.pop();
        throw value;
    },
    JMP: function (target) {
        ip = target;
    },
    JMPFt: function (target) {
        if (extractVar(stack[stack.length - 1]))
            ip = target;
    },
    JMPt: function (target) {
        if (extractVar(stack.pop()))
            ip = target;
    },
    CALL: function (argc) {
        let targetr = stack.pop();
        if (targetr instanceof Member) {
            stack.push(targetr._parent[targetr.prop](...popArgs(argc)))
        } else {
            stack.push(extractVar(targetr)(...popArgs(argc)))
        }
    },
    RELCALL: function () {
        let funcinfo = stack.pop()
        let args = stack.pop()
        let bTargetArrowFunc = funcinfo[0];

        stack.push(ip)
        ip = funcinfo[1];

        /* OPEXPANSION HERE */
        /* OPARGNEXT HERE */
        /* OPFUNCEND HERE */

        let opTop = ops[ip++];
        let sizeTop = ops[ip++];
        handlers[opTop](sizeTop)
        let BP = SP[SP.length - 1];

        //arguments , ...funcargs, ...othervars
        let EP = stack.length;
        let realArgNum = 0;
        stack[BP].a[0] = bTargetArrowFunc ? undefined : {};

        function GetArgs() {
            return arguments;
        }

        for (let i = 0;; i++) {
            let op = ops[ip++];
            if (op == opFuncEnd) {
                if (ops[ip - 4] == opEXPANSION) {
                    let value = stack[BP + (1 - bTargetArrowFunc) + realArgNum];
                    stack[BP + (1 - bTargetArrowFunc) + realArgNum] = [value].concat(args.slice(realArgNum))
                }
                break;
            }

            if (op == opArgNext && i == 0 && !bTargetArrowFunc) {
                stack[BP + 1].a[0] = GetArgs(...args);
                i--;
                continue;
            }

            realArgNum++;
            if (args[i] !== undefined) {
                stack[BP + (2 - bTargetArrowFunc) + i].a[0] = args[i];
                let opPush = op;
                while (ops[ip++] !== opArgNext || ops[ip - 2] == opPush);
                continue;
            }
            do {
                if (op == opArgNext) {
                    break;
                }
                let handler = handlers[op];
                let args = ops.slice(ip, ip + handler.length);
                ip += handler.length
                handler.apply(this, args)
                op = ops[ip++];
            }
            while (true)

        }

        stack.length = EP;
    },
    NEW: function (argc) {
        let target = extractVar(stack.pop());

        stack.push(new target(...popArgs(argc)))
    },
    NOT: function () {
        let A = extractVar(stack.pop())
        stack.push(!A)
    },
    NEG: function () {
        let A = extractVar(stack.pop())
        stack.push(-A)
    },
    TYPEOF: function () {
        let A = extractVar(stack.pop())
        stack.push(typeof A)
    },
    EQ: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A == B)
    },
    IDENTITY: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A === B)
    },
    GT: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A > B)
    },
    GE: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A >= B)
    },
    SAL: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A << B)
    },
    SAR: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A >> B)
    },
    SHR: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A >>> B)
    },
    ADD: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A + B)
    },
    SUB: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A - B)
    },
    MUL: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A * B)
    },
    DIV: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A / B)
    },
    MOD: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A % B)
    },
    OR: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A | B)
    },
    AND: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A & B)
    },
    XOR: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A ^ B)
    },
    PLUS: function () {
        let A = extractVar(stack.pop())
        stack.push(+A)
    },
    MINUS: function () {
        let A = extractVar(stack.pop())
        stack.push(-A)
    },
    IN: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A in B)
    },
    DUP: function () {
        stack.push(stack[stack.length - 1])
    },
    SWAP: function (n) {
        let tmp = stack[stack.length - 1 + n]
        stack[stack.length - 1 + n] = stack[stack.length - 1]
        stack[stack.length - 1] = tmp
    },
    INSTANCEOF: function () {
        let B = extractVar(stack.pop())
        let A = extractVar(stack.pop())
        stack.push(A instanceof B)
    },
    FUNCTION: function (address) {
        stack.push(VMFunction(0, address))
    },
    ARROWFUNCTION: function (address) {
        stack.push(VMFunction(1, address))
    },
    FUNCEND: function () {},
    ARGNEXT: function () {},
    ARRAY: function (count) {
        let elements = stack.slice(stack.length - count, stack.length);
        stack.length -= count;
        elements = elements.map(ele => extractVar(ele))
        let expandedElements = [];
        elements.map(ele => {
            if (ele instanceof Expandable) {
                expandedElements = expandedElements.concat(ele._value)
            } else {
                expandedElements.push(ele)
            }
        })
        stack.push(expandedElements)
    },
    EXPANSION: function () {
        let target = extractVar(stack.pop());
        stack.push(new Expandable(target));
    },
    PUSHe: function (bcatch, bfinally) {
        exceptions.push([bcatch ? VMFunction(0, bcatch) : 0, bfinally, stack.length, SP.length])
    },
    POPe: function () {
        exceptions.pop();
    }
}

let oporder = Object.keys(optable).sort()

let opcodes = {}
let codeops = {}
for (let i = 0; i < oporder.length; i++) {
    opcodes[oporder[i]] = i;
    codeops[i] = oporder[i];
}

let orderedHandlers = new Array(opcodes.length);
for (const [id, name] of Object.entries(codeops)) {
    orderedHandlers[id] = optable[name];
}

module.exports.OpCodes = opcodes;
module.exports.CodeOps = codeops;
module.exports.OpHandlers = optable;
module.exports.OrderedHandlers = orderedHandlers;
module.exports.Helpers = helpers;
module.exports.InsideHelpers = Insidehelpers;