"""Arithmetic the tutor is not allowed to do in its head.

Backlog #97. The tutor both posed and graded free-form numeric problems, so a
student who was right could be told four times that she was wrong. This module
is the ground truth the model must consult before asserting any numeric
judgement — see `TutorAgent._call_api`.

It is deliberately NOT a general expression evaluator. `eval()` is never called
and no name, attribute, subscript, comprehension or lambda ever reaches
evaluation: the AST is walked against a whitelist first and rejected whole if it
contains anything else. The student-facing surface here is a chat message, so
the input is untrusted by construction.
"""
import ast
import math
import operator


# A chat-sized calculation. Anything longer is not a student's arithmetic.
MAX_EXPRESSION_LENGTH = 500

# `9 ** 9 ** 9` is a denial of service, not a calculation. An exponent must be a
# plain constant in range — which also rejects the stacked form, since its
# exponent is itself an expression.
MAX_EXPONENT = 1000

# Beyond this a result is meaningless in a Power Engineering context and is more
# likely a runaway than an answer.
MAX_MAGNITUDE = 1e100

# Significant figures kept before formatting. Enough for any exam arithmetic,
# few enough to drop IEEE noise: 0.1 + 0.2 must read 0.3, never
# 0.30000000000000004, and 5 * 4.187 * 60 must read 1256.1.
SIGNIFICANT_FIGURES = 12

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

# `log` is the natural logarithm, matching math.log — `log10` is base 10. The
# tool description says so explicitly, because in plant work "log" often means
# base 10 and a silent mismatch here would be exactly the class of error this
# module exists to prevent.
_FUNCTIONS = {
    'sqrt': math.sqrt,
    'log': math.log,
    'ln': math.log,
    'log10': math.log10,
    'exp': math.exp,
    'abs': abs,
    'round': round,
    'sin': math.sin,
    'cos': math.cos,
    'tan': math.tan,
    'asin': math.asin,
    'acos': math.acos,
    'atan': math.atan,
    'radians': math.radians,
    'degrees': math.degrees,
    'pi': None,   # constants, handled below
    'e': None,
}

_CONSTANTS = {'pi': math.pi, 'e': math.e}


class CalculationError(Exception):
    """Raised for anything the student should see as 'I could not compute that'."""


def _check_node(node):
    """Reject the whole expression unless every node is arithmetic."""
    if isinstance(node, ast.Expression):
        _check_node(node.body)
        return

    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise CalculationError('only numbers are allowed')
        return

    if isinstance(node, ast.BinOp):
        if type(node.op) not in _BIN_OPS:
            raise CalculationError('unsupported operator')
        if isinstance(node.op, ast.Pow):
            _check_exponent(node.right)
        _check_node(node.left)
        _check_node(node.right)
        return

    if isinstance(node, ast.UnaryOp):
        if type(node.op) not in _UNARY_OPS:
            raise CalculationError('unsupported operator')
        _check_node(node.operand)
        return

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise CalculationError('unsupported call')
        if node.func.id not in _FUNCTIONS or _FUNCTIONS[node.func.id] is None:
            raise CalculationError(f'unknown function {node.func.id!r}')
        if node.keywords:
            raise CalculationError('keyword arguments are not supported')
        for arg in node.args:
            _check_node(arg)
        return

    if isinstance(node, ast.Name):
        if node.id not in _CONSTANTS:
            raise CalculationError(f'unknown name {node.id!r}')
        return

    raise CalculationError('expression contains something that is not arithmetic')


def _check_exponent(node):
    """An exponent must be a literal in range, so `9 ** 9 ** 9` cannot be built."""
    value = node
    if isinstance(value, ast.UnaryOp) and type(value.op) in _UNARY_OPS:
        value = value.operand
    if not isinstance(value, ast.Constant) or isinstance(value.value, bool):
        raise CalculationError('exponent must be a plain number')
    if not isinstance(value.value, (int, float)):
        raise CalculationError('exponent must be a plain number')
    if abs(value.value) > MAX_EXPONENT:
        raise CalculationError(f'exponent must be at most {MAX_EXPONENT}')


def _eval_node(node):
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp):
        return _BIN_OPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp):
        return _UNARY_OPS[type(node.op)](_eval_node(node.operand))
    if isinstance(node, ast.Call):
        return _FUNCTIONS[node.func.id](*[_eval_node(a) for a in node.args])
    if isinstance(node, ast.Name):
        return _CONSTANTS[node.id]
    raise CalculationError('expression contains something that is not arithmetic')


def _tidy(value):
    """Drop IEEE noise and render whole numbers without a trailing .0."""
    if isinstance(value, int):
        return value
    if not math.isfinite(value):
        raise CalculationError('result is not a finite number')
    if value != 0:
        digits = SIGNIFICANT_FIGURES - int(math.floor(math.log10(abs(value)))) - 1
        value = round(value, max(digits, 0))
    if value == int(value) and abs(value) < 1e15:
        return int(value)
    return value


def evaluate(expression):
    """Evaluate one arithmetic expression.

    Returns {'ok': True, 'result': number, 'expression': str} or
    {'ok': False, 'error': str}. Never raises — the caller is a tool-call
    handler and an exception there would take down the student's turn.
    """
    expression = (expression or '').strip()

    try:
        if not expression:
            raise CalculationError('no expression given')
        if len(expression) > MAX_EXPRESSION_LENGTH:
            raise CalculationError(
                f'expression is longer than {MAX_EXPRESSION_LENGTH} characters')

        try:
            tree = ast.parse(expression, mode='eval')
        except SyntaxError:
            raise CalculationError('that is not a valid arithmetic expression')

        _check_node(tree)
        result = _eval_node(tree)

        if isinstance(result, complex):
            raise CalculationError('result is not a real number')
        if abs(result) > MAX_MAGNITUDE:
            raise CalculationError('result is too large to be meaningful')

        return {'ok': True, 'result': _tidy(result), 'expression': expression}

    except CalculationError as exc:
        return {'ok': False, 'error': str(exc), 'expression': expression}
    except ZeroDivisionError:
        return {'ok': False, 'error': 'division by zero', 'expression': expression}
    except (ValueError, OverflowError) as exc:
        return {'ok': False, 'error': str(exc), 'expression': expression}
