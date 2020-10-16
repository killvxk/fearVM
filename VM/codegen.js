const OpCodes = require('./opcodes')

let Exception = function (node, message) {
    if (node.start !== undefined) {
        return `At ${node.start.line}:${node.start.col}, ${message}`;
    } else {
        return `At ?, ${message}`;
    }
};

module.exports.GenCode = function (ast, options) {
    let output = {
        data: [],
        nonlocal: {}
    }

    output.data.toString = function (optable) {
        let res = [...this];
        for (let i = 0; i < this.length; i++) {
            let op = this[i];
            let opCodes = OpCodes.OpCodes;
            if (optable !== undefined) {
                opCodes = optable.OpCodes;
            }

            let handler = OpCodes.OpHandlers[op];
            res[i] = opCodes[op];
            i += handler.length;
        }

        return JSON.stringify(res);
    }

    output.nonlocal.toString = function () {
        let funcs = new Array(this.length);
        for (const [name, id] of Object.entries(this)) {
            if (name != "this") {
                funcs[id] = `
                    function(v){
                        if(v){
                            try{
                                ${name} = v; 
                            }catch(e)
                            {
                                if( typeof global === "undefined") 
                                    window.${name} = v; 
                                else
                                    global.${name} = v;
                            }
                        }
                        try {
                            return ${name}
                        } catch (e){
                            return undefined
                        }
                    }`;
            } else {
                funcs[id] = `()=>{return Date.constructor("return this")()}`;
            }
        }
        return `[ ${funcs.join(",")} ]`
    }

    let bytecodes = {
        append: function (...args) {
            output.data.push.apply(output.data, args);
        },
        counter: function (offset) {
            if (offset === undefined)
                return output.data.length
            return output.data.length + offset
        },
        modify: function (offset, default_value) {
            return (function (a) {
                return function (v) {
                    output.data[a] = (v === undefined) ? default_value() : v;
                };
            })(bytecodes.counter(offset));
        }
    }

    let opcode = {
        JMP: function (address) {
            bytecodes.append('JMP', (address === undefined) ? -1 : address);
            let callable = bytecodes.modify(-1, bytecodes.counter);
            return callable;
        },
        JMPt: function (address) {
            bytecodes.append('JMPt', (address === undefined) ? -1 : address);
            let callable = bytecodes.modify(-1, bytecodes.counter);
            return callable;
        },
        JMPFt: function (address) {
            bytecodes.append('JMPFt', (address === undefined) ? -1 : address);
            let callable = bytecodes.modify(-1, bytecodes.counter);
            return callable;
        },
        FUNCTION: function (address) {
            bytecodes.append('FUNCTION', (address === undefined) ? -1 : address);
        },
        ARROWFUNCTION: function (address) {
            bytecodes.append('ARROWFUNCTION', (address === undefined) ? -1 : address);
        },
    }

    let opcodehandler = {
        get(target, name) {
            if (target.hasOwnProperty(name))
                return target[name];

            if (OpCodes.OpCodes.hasOwnProperty(name)) {
                return function (...args) {
                    bytecodes.append(name, ...args);
                }
            } else {
                throw Exception(null, "Unsupported Opcode: " + name)
            }
        }
    }

    opcode = new Proxy(opcode, opcodehandler)

    let scope = {
        stack: [],
        locals: {},
        level: 0,
        labels: [],
        states: [],

        enter: function (variables, regStart) {
            this.stack.push({
                locals: this.locals,
                level: this.level,
            });

            this.locals = []
            this.level++

            let reg = regStart ? regStart : 1

            variables.forEach((sym) => {
                this.locals[sym.name] = reg
                reg++
            })

            opcode.TOP(reg - 1);
        },
        leave: function () {
            let frame = this.stack.pop();

            this.locals = frame.locals;
            this.level = frame.level;
        },
        locate: function (symbol) {
            switch (symbol) {
                case "this": {
                    if (this.stack.length == 1) {
                        return ["global", output.nonlocal["this"]]
                    } else {
                        return 0;
                    }
                }
                case "arguments":
                    return 1;
            }

            if (this.locals.hasOwnProperty(symbol)) {
                return this.locals[symbol];
            }

            for (let level = 0; level < this.stack.length - 1; level++) {
                let refs = this.stack[this.stack.length - level - 1].locals;
                if (refs.hasOwnProperty(symbol)) {
                    return [level, refs[symbol]];
                }
            }

            if (output.nonlocal.hasOwnProperty(symbol)) {
                return ["global", output.nonlocal[symbol]];
            }
        }
    }
    let helper = {
        top: function (node) {
            let reg = 1
            output.nonlocal["this"] = 0
            if (node.globals) {
                node.globals.forEach((sym) => {
                    output.nonlocal[sym.name] = reg
                    reg++
                });
            }
            helper.body(node)
        },
        block: function ({
            body,
            functions,
            variables,
        }, bArrow) {
            scope.enter(variables)

            body.forEach(entry => $(entry, $.S))

            scope.leave()
            opcode.LEAVESCOPE()
        },
        body: function ({
            body,
            functions,
            variables,
            references,
            globals,
            enclosed,
            argnames,
            regStart
        }, bArrow) {
            scope.enter(variables, regStart)

            let except = $.S;
            if (argnames !== undefined) {
                if (!bArrow)
                    opcode.ARGNEXT();

                argnames.forEach(entry => {
                    $(entry, $.S)
                    opcode.ARGNEXT();
                });
                opcode.FUNCEND();
            } else {
                if (!options.bRValue) // TopLevel Return Result
                {
                    opcode.UNDEFINED();
                }
                else {
                    except = $.R;
                    if (body.length !== 1) {
                        throw Exception("Cannot be a r value")
                    }
                    body = [body[0].body]
                }
            }

            body.forEach(entry => $(entry, except))

            scope.leave()
            opcode.HALT()
        },
        getvar: function (name) {
            let ref = scope.locate(name);
            if (typeof ref === "number") {
                opcode.PUSH(ref);
                opcode.BINDv();

            } else if (ref !== undefined) {
                if (ref[0] == "global") {
                    opcode.PUSH(ref[1]);
                    opcode.BINDg();
                } else {
                    opcode.PUSH(ref[0]);
                    opcode.PUSH(ref[1]);
                    opcode.BIND();
                }
            } else {
                throw Exception(null, "Counld not find reference for symbol " + name)
            }
            return;
        },
        global: function (name) {
            let index = output.nonlocal[name]
            if (index === undefined) {
                index = Object.keys(output.nonlocal).length;
                output.nonlocal[name] = index;
            }
            opcode.PUSH(index);
            opcode.BINDg();
            return;
        },
        string: function (value) {
            opcode.STRING();
            for (let i = 0; i < value.length; i++) {
                opcode.CHAR(value.charCodeAt(i) ^ 0x39);
            }
        }
    }

    let handler = {
        "Toplevel": function () {
            helper.top(this);
            return new $.S();
        },
        "This": function () {
            helper.getvar("this");
            return new $.R();
        },
        "Defun": function ({
            name
        }) {
            helper.getvar(name.name)
            let jump = opcode.JMP();
            let begin = bytecodes.counter();

            helper.body(this);

            jump();
            opcode.FUNCTION(begin);
            opcode.STORE();
            return new $.R();
        },
        "Function": function () {
            let jump = opcode.JMP();
            let begin = bytecodes.counter();

            helper.body(this);

            jump();
            opcode.FUNCTION(begin);
            return new $.R();
        },
        "Arrow": function () {
            let jump = opcode.JMP();
            let begin = bytecodes.counter();

            helper.body(this, true);

            jump();
            opcode.ARROWFUNCTION(begin);
            return new $.R();
        },
        "SymbolFunarg": function ({
            name
        }) {
            helper.getvar(name)
            return new $.R();
        },
        "SymbolCatch": function ({
            name
        }) {
            helper.getvar(name)
            return new $.R();
        },
        "DefaultAssign": function () {
            return handler.Assign.apply(this, [this]);
        },
        "Return": function ({
            value
        }) {
            if (value === undefined) {
                opcode.UNDEFINED();
            } else {
                $(value, $.R);
            }

            opcode.HALT();
            return new $.S();
        },
        "Binary": function ({
            operator,
            left,
            right
        }) {
            $(left, $.L);
            switch (operator) {
                case '&&': {
                    let jump_if_T = opcode.JMPFt();
                    let jump_if_F = opcode.JMP();
                    jump_if_T();
                    opcode.POP();
                    $(right, $.R);
                    jump_if_F();
                    return new $.R();
                    break;
                }
                case '||': {
                    let jump_if_T = opcode.JMPFt();
                    opcode.POP();
                    $(right, $.R);
                    jump_if_T()
                    return new $.R();
                    break;
                }
            }

            $(right, $.R);

            switch (operator) {
                case '==':
                    opcode.EQ();
                    break;
                case '!=':
                    opcode.EQ();
                    opcode.NOT();
                    break;
                case '===':
                    opcode.IDENTITY();
                    break;
                case '!==':
                    opcode.IDENTITY();
                    opcode.NOT();
                    break;
                case '<':
                    opcode.GE();
                    opcode.NOT();
                    break;
                case '<=':
                    opcode.GT();
                    opcode.NOT();
                    break;
                case '>':
                    opcode.GT();
                    break;
                case '>=':
                    opcode.GE();
                    break;
                case '<<':
                    opcode.SAL();
                    break;
                case '>>':
                    opcode.SAR();
                    break;
                case '>>>':
                    opcode.SHR();
                    break;
                case '+':
                    opcode.ADD();
                    break;
                case '-':
                    opcode.SUB();
                    break;
                case '*':
                    opcode.MUL();
                    break;
                case '/':
                    opcode.DIV();
                    break;
                case '%':
                    opcode.MOD();
                    break;
                case '|':
                    opcode.OR();
                    break;
                case '^':
                    opcode.XOR();
                    break;
                case '&':
                    opcode.AND();
                    break;
                case 'in':
                    opcode.IN();
                    break;
                case 'instanceof':
                    opcode.INSTANCEOF();
                    break;
            }

            return new $.R();
        },
        "SymbolRef": function ({
            name
        }) {
            helper.getvar(name)

            return new $.R();
        },
        "Call": function ({
            expression,
            args
        }) {
            let argc = args.length;

            args.forEach(entry => $(entry, $.R))
            $(expression, $.R)
            opcode.CALL(argc);
            return new $.R();
        },
        "Var": function ({
            definitions
        }) {
            definitions.forEach(entry => $(entry, $.S))
            return new $.S();
        },
        "Let": function ({
            definitions
        }) {
            definitions.forEach(entry => $(entry, $.S))
            return new $.S();
        },
        "VarDef": function ({
            name,
            value
        }) {
            if (value != null) {
                helper.getvar(name.name);
                $(value, $.R);
                opcode.STORE();
                return new $.R();
            }
            return new $.S();
        },
        "Number": function ({
            value
        }) {
            opcode.PUSH(value);
            return new $.R();
        },
        "String": function ({
            value
        }) {
            helper.string(value)
            return new $.R()
        },
        "Sequence": function ({
            expressions
        }) {
            let i = 0
            for (; i < expressions.length - 1; i++) {
                $(expressions[i], $.S);
            }
            $(expressions[i], $.R);
            return new $.R();
        },
        "SimpleStatement": function ({
            body
        }) {
            $(body, $.S);
            return new $.S();
        },
        "BlockStatement": function ({
            block_scope
        }) {
            $(block_scope, $.S);
            return new $.S();
        },
        "Scope": function () {
            helper.block(this);
            return new $.S();
        },
        "UnaryPrefix": function ({
            operator,
            expression
        }) {
            let simpleUnaryProcessed = true;
            switch (operator) {
                case '-':
                    $(expression, $.R);
                    opcode.MINUS();
                    break;
                case '+':
                    $(expression, $.R);
                    opcode.PLUS();
                    break;
                case '!':
                    $(expression, $.R);
                    opcode.NOT();
                    break;
                case '~':
                    $(expression, $.R);
                    opcode.NEG();
                    break;
                case 'typeof':
                    $(expression, $.R);
                    opcode.TYPEOF();
                    break;
                case 'void':
                    $(expression, $.R);
                    opcode.POP();
                    opcode.UNDEFINED();
                    break;
                default:
                    simpleUnaryProcessed = false;
            }

            if (simpleUnaryProcessed)
                return new $.R();

            $(expression, $.R)
            if (operator == "delete") {
                opcode.DELETE();
                return new $.R();
            }

            opcode.DUP();
            opcode.PUSH(1);
            switch (operator) {
                case "++":
                    opcode.ADD();
                    break;
                case "--":
                    opcode.SUB();
                    break
            }
            opcode.STORE();
            return new $.R();
        },
        "UnaryPostfix": function ({
            operator,
            expression
        }) {
            $(expression, $.L)
            opcode.DUP();
            opcode.LOAD();
            opcode.SWAP(-1);
            opcode.DUP();
            opcode.PUSH(1);
            switch (operator) {
                case "++":
                    opcode.ADD();
                    break;
                case "--":
                    opcode.SUB();
                    break
            }
            opcode.STORE();
            opcode.POP();
            return new $.R();
        },
        "Assign": function ({
            operator,
            left,
            right
        }) {
            $(left, $.L);
            if (operator === '=') {
                $(right, $.R);
            } else {
                opcode.DUP();
                $(right, $.R);

                switch (operator) {
                    case '+=':
                        opcode.ADD();
                        break;
                    case '-=':
                        opcode.SUB();
                        break;
                    case '*=':
                        opcode.MUL();
                        break;
                    case '/=':
                        opcode.DIV();
                        break;
                    case '%=':
                        opcode.MOD();
                        break;
                    case '<<=':
                        opcode.SAL();
                        break;
                    case '>>=':
                        opcode.SAR();
                        break;
                    case '>>>=':
                        opcode.SHR();
                        break;
                    case '|=':
                        opcode.OR();
                        break;
                    case '^=':
                        opcode.XOR();
                        break;
                    case '&=':
                        opcode.AND();
                        break;
                }
            }
            opcode.STORE();
            return new $.R();
        },
        "Dot": function ({
            expression,
            property
        }) {
            $(expression, $.R)
            helper.string(property)
            opcode.ACCESS();
            return new $.L();
        },
        "Sub": function ({
            expression,
            property
        }) {
            $(expression, $.R)
            $(property, $.R)
            opcode.ACCESS();
            return new $.L();
        },
        "Array": function ({
            elements
        }) {
            elements.forEach(entry => $(entry, $.R))
            opcode.ARRAY(elements.length);
            return new $.R();
        },
        "Expansion": function ({
            expression
        }) {
            $(expression, $.L)
            opcode.EXPANSION();
            return new $.R();
        },
        "If": function ({
            condition,
            body,
            alternative
        }) {
            $(condition, $.R);
            let jump_if_T = opcode.JMPt();

            if (alternative !== null) {
                $(alternative, $.S)
            }
            let jump_if_F = opcode.JMP();

            jump_if_T();
            $(body, $.S);
            jump_if_F();

            return new $.S();
        },
        "True": function () {
            opcode.TRUE();
            return new $.R();
        },
        "False": function () {
            opcode.FALSE();
            return new $.R();
        },
        "For": function ({
            init,
            step,
            condition,
            body,
            block_scope
        }) {
            scope.enter(block_scope.variables)

            if (init !== null) {
                $(init, $.S)
            }

            let begin = bytecodes.counter();
            if (condition === null) {
                opcode.TRUE();
            } else {
                $(condition, $.R)
            }

            let jump_if_T = opcode.JMPt();
            let jump_if_F = opcode.JMP();
            jump_if_T();
            scope.labels.push([]);
            scope.states.push("For");
            $(body, $.S);
            let middle = bytecodes.counter();

            if (step !== null) {
                $(step, $.S);
            }

            opcode.JMP(begin);
            jump_if_F();
            let end = bytecodes.counter();

            scope.leave()
            opcode.LEAVESCOPE()

            for (let label of scope.labels[scope.labels.length - 1]) {
                switch (label.type) {
                    case "continue": {
                        label.jmp(middle)
                        break;
                    }
                    case "break": {
                        label.jmp(end)
                        break;
                    }
                }
            }
            scope.labels.pop();
            scope.states.pop();
            return new $.S();
        },
        "ForIn": function ({
            object,
            init,
            body,
            block_scope
        }) {
            scope.enter(block_scope.variables)

            $(object, $.R)
            opcode.PROPERTIES()
            let begin = bytecodes.counter();

            opcode.EXTRACT();
            let jump_if_T = opcode.JMPt();;
            opcode.POP();
            let jump_if_F = opcode.JMP();
            jump_if_T();

            $(init, $.R)
            opcode.SWAP(-1)
            opcode.STORE()

            scope.labels.push([]);
            scope.states.push("ForIn");
            $(body, $.S);

            opcode.JMP(begin);
            jump_if_F();
            let end = bytecodes.counter();

            scope.leave()
            opcode.LEAVESCOPE()

            for (let label of scope.labels[scope.labels.length - 1]) {
                switch (label.type) {
                    case "continue": {
                        label.jmp(begin)
                        break;
                    }
                    case "break": {
                        label.jmp(end)
                        break;
                    }
                }
            }
            scope.labels.pop();
            scope.states.pop();
            return new $.S();
        },
        "While": function ({
            condition,
            body,
            block_scope
        }) {
            let begin = bytecodes.counter();
            $(condition, $.R)
            let jump_if_T = opcode.JMPt();
            let jump_if_F = opcode.JMP();
            jump_if_T();

            scope.labels.push([]);
            scope.states.push("While");
            $(body, $.S);

            opcode.JMP(begin);
            jump_if_F();

            let end = bytecodes.counter();

            for (let label of scope.labels[scope.labels.length - 1]) {
                switch (label.type) {
                    case "continue": {
                        label.jmp(begin)
                        break;
                    }
                    case "break": {
                        label.jmp(end)
                        break;
                    }
                }
            }
            scope.labels.pop();
            scope.states.pop();
            return new $.S();
        },
        "Do": function ({
            condition,
            body,
            block_scope
        }) {
            let jump_first = opcode.JMP();
            let begin = bytecodes.counter();

            $(condition, $.R);
            let jump_if_T = opcode.JMPt();
            let jump_if_F = opcode.JMP();
            jump_if_T();

            jump_first();
            scope.labels.push([]);
            scope.states.push("While");
            $(body, $.S);
            opcode.JMP(begin);
            jump_if_F();
            let end = bytecodes.counter();

            for (let label of scope.labels[scope.labels.length - 1]) {
                switch (label.type) {
                    case "continue": {
                        label.jmp(begin)
                        break;
                    }
                    case "break": {
                        label.jmp(end)
                        break;
                    }
                }
            }
            scope.labels.pop();
            scope.states.pop();
            return new $.S();
        },
        "Switch": function ({
            expression,
            body,
            block_scope
        }) {
            $(expression, $.R);

            let jmp_to_next_case = null;
            let jmps = [];
            for (let i = 0; i < body.length; i++) {
                let block = body[i];
                if (block.TYPE == "Case") {
                    opcode.DUP();
                    $(block.expression, $.R);
                    opcode.IDENTITY();
                    let jump_if_T = opcode.JMPt();
                    let jump_if_F = opcode.JMP();
                    jump_if_T();

                    if (jmp_to_next_case !== null) {
                        jmp_to_next_case()
                    }

                    scope.labels.push([]);
                    scope.states.push("Case")
                    block.body.forEach(entry => $(entry, $.S))
                    for (let label of scope.labels[scope.labels.length - 1]) {
                        switch (label.type) {
                            case "break": {
                                jmps.push(label.jmp)
                                break;
                            }
                        }
                    }
                    scope.labels.pop();
                    scope.states.pop();

                    jmp_to_next_case = opcode.JMP();
                    jump_if_F();
                } else // Default
                {
                    if (jmp_to_next_case !== null) {
                        jmp_to_next_case()
                    }

                    scope.labels.push([]);
                    scope.states.push("Case")
                    block.body.forEach(entry => $(entry, $.S))
                    for (let label of scope.labels[scope.labels.length - 1]) {
                        switch (label.type) {
                            case "break": {
                                jmps.push(label.jmp)
                                break;
                            }
                        }
                    }
                    scope.labels.pop();
                    scope.states.pop();

                    jmp_to_next_case = opcode.JMP();
                }

            }


            if (jmp_to_next_case !== null) {
                jmp_to_next_case()
            }
            for (jmp of jmps) {
                jmp()
            }

            opcode.POP();
            return new $.S();
        },
        "Continue": function () {
            opcode.LEAVESCOPE()
            let jmp = opcode.JMP();
            scope.labels[scope.labels.length - 1].push({
                type: "continue",
                jmp: jmp
            });
            return new $.S();
        },
        "Break": function () {
            if (scope.states[scope.states.length - 1] != "Case") {
                opcode.LEAVESCOPE()
            }
            let jmp = opcode.JMP();
            scope.labels[scope.labels.length - 1].push({
                type: "break",
                jmp: jmp
            });
            return new $.S();
        },
        "RegExp": function ({
            value
        }) {
            helper.string(value.source)
            helper.string(value.flags)
            helper.global("RegExp");
            opcode.NEW(2);
            return new $.R();
        },
        "Conditional": function ({
            condition,
            consequent,
            alternative
        }) {
            $(condition, $.R);
            let jump_if_T = opcode.JMPt();
            $(alternative, $.R);
            let jump_if_F = opcode.JMP();
            jump_if_T();
            $(consequent, $.R);
            jump_if_F();
            return new $.R();
        },
        "Object": function ({
            properties
        }) {
            helper.global("Object");
            opcode.NEW(0);

            properties.map(entry => $(entry, $.S));
            return new $.R();
        },
        "ObjectKeyVal": function ({
            key,
            value
        }) {
            opcode.DUP();
            if (typeof key === "string") {
                helper.string(key)
            } else {
                $(key, $.R);
            }
            opcode.ACCESS();
            $(value, $.R);
            opcode.STORE();
            return new $.R();
        },
        "EmptyStatement": function () {
            opcode.NOP();
            return new $.S();
        },
        "New": function ({
            expression,
            args
        }) {
            args.forEach(entry => $(entry, $.R))
            $(expression, $.R);
            opcode.NEW(args.length);
            return new $.R();
        },
        "Throw": function ({
            value
        }) {
            $(value, $.R);
            opcode.THROW();
            return new $.S();
        },
        "Try": function ({
            bcatch,
            bfinally,
            body,
            block_scope
        }) {
            let jump_try = opcode.JMP()

            let catch_entry = 0
            let finally_entry = 0

            if (bcatch !== null) {
                catch_entry = bytecodes.counter()

                helper.body({
                    variables: bcatch.block_scope.variables,
                    argnames: [bcatch.argname],
                    body: bcatch.body,
                    regStart: 2
                });
            }

            finally_entry = bytecodes.counter()
            if (bfinally != null) {
                $(bfinally.block_scope, $.S);
            }
            let jump_outer = opcode.JMP();
            jump_try();

            opcode.PUSHe(catch_entry, finally_entry);
            $(block_scope, $.S);
            opcode.POPe();

            if (bfinally !== null) {
                opcode.JMP(finally_entry)
            }

            jump_outer();
            return new $.S();
        }
    };

    let $ = function (node, expecting, ...args) {
        if (node === undefined)
            throw "Node is undefined";

        if (!node || !node.TYPE || !handler[node.TYPE])
            throw Exception(node, "Unspport node :" + node.TYPE);

        value = handler[node.TYPE].apply(node, [node].concat(args));

        if (expecting === $.S && !(value instanceof $.S)) {
            opcode.POP();
            return new $.S();
        }
        return value;
    }

    // Expression: RHS
    $.R = function () { };

    // Expression: LHS
    $.L = function () { };

    // Sentences
    $.S = function () { };

    if (!options.bRValue) {
        $(ast, $.S);
    } else {
        $(ast, $.R);
    }

    return output;
}