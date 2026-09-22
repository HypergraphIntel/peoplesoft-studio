import { encodeSimpleProgramHeader, PROGRAM_DIRECTORY_SEPARATOR } from './programLayout.js';
import {
  INLINE_IDENTIFIER_OPCODE,
  OPCODES,
  TEXT_INTRODUCERS,
  TokenKind
} from './format.js';
import { UNSIGNED_NUMBER_FORMAT } from './numberFormats.js';

const MAX_UNSIGNED_INTEGER = (1n << BigInt(UNSIGNED_NUMBER_FORMAT.valueBytes * 8)) - 1n;
const MAX_INTEGER_DIGITS = MAX_UNSIGNED_INTEGER.toString().length;
const MAX_EXPRESSION_DEPTH = 128;

interface FunctionMetadata {
  name: string;
  parameterTypes: string[];
  returnType?: string;
}

export interface PeopleCodeReference {
  index: number;
  recordName: string;
  fieldName: string;
  eventName: string;
}

export interface EncodedPeopleCode {
  program: Buffer;
  references: PeopleCodeReference[];
}

function functionTypeId(typeName: string): number {
  switch (typeName.toLowerCase()) {
    case 'string':
      return 0x01;

    case 'boolean':
      return 0x05;

    case 'integer':
      return 0x11;

    default:
      throw new Error(
        `Unsupported function metadata type: ${typeName}`
      );
  }
}

function returnTypeDescriptor(typeName?: string): number {
  return typeName === undefined
    ? 0x07
    : functionTypeId(typeName);
}

function parameterTypeDescriptor(typeName: string): number {
  return (0xc0000000 | functionTypeId(typeName)) >>> 0;
}

function encodeFunctionProgramHeader(
  executableLength: number,
  metadata: FunctionMetadata
): Buffer {
  // Calibrated 37-byte Function PSPCMPROG header.
  const header = Buffer.alloc(37);

  header[0] = 0xa0;
  header.writeUInt32LE(0, 1);
  header.writeUInt32LE(executableLength, 5);
  header.writeUInt32LE(0, 9);
  header.writeUInt32LE(
    Buffer.byteLength(metadata.name + '\0', 'utf16le'),
    13
  );
  header.writeUInt32LE(0, 17);
  header.writeUInt32LE(metadata.parameterTypes.length + 1, 21);
  header.writeUInt32LE(0, 25);
  header.writeUInt32LE(1, 29);
  header.writeUInt32LE(0x85, 33);

  return header;
}

function encodeFunctionMetadata(metadata: FunctionMetadata): Buffer {
  const name = Buffer.from(metadata.name + '\0', 'utf16le');

  const data = Buffer.alloc(
    4 + // reserved 1
    4 + // reserved 2
    4 + // parameter count
    4 + // return descriptor
    metadata.parameterTypes.length * 4 +
    4   // terminator
  );

  let offset = 0;

  data.writeUInt32LE(0, offset);
  offset += 4;

  data.writeUInt32LE(0, offset);
  offset += 4;

  data.writeUInt32LE(metadata.parameterTypes.length, offset);
  offset += 4;

  data.writeUInt32LE(
    returnTypeDescriptor(metadata.returnType),
    offset
  );
  offset += 4;

  for (const typeName of metadata.parameterTypes) {
    data.writeUInt32LE(
      parameterTypeDescriptor(typeName),
      offset
    );
    offset += 4;
  }

  data.writeUInt32LE(0x07, offset);

  return Buffer.concat([name, data]);
}
export class UnsupportedPeopleCodeError extends Error {
  constructor(readonly offset: number, detail: string) {
    super(`Cannot encode PeopleCode at source offset ${offset}: ${detail}`);
    this.name = 'UnsupportedPeopleCodeError';
  }
}

function fixed(text: string, selectedOpcode?: number): Buffer {
  const matches = [...OPCODES].filter(([, spec]) => spec.text === text);
  if (selectedOpcode !== undefined) {
    if (!matches.some(([opcode]) => opcode === selectedOpcode)) throw new Error(`No opcode ${selectedOpcode} for ${text}`);
    return Buffer.from([selectedOpcode]);
  }
  if (matches.length !== 1) throw new Error(`No unambiguous opcode for ${text}`);
  return Buffer.from([matches[0][0]]);
}

function textOperand(opcode: number, kind: TokenKind, value: string): Buffer {
  const expectedKind = opcode === INLINE_IDENTIFIER_OPCODE ? TokenKind.Name : TEXT_INTRODUCERS.get(opcode);
  if (expectedKind !== kind) throw new Error('Unsupported text operand opcode');
  return Buffer.concat([Buffer.from([opcode]), Buffer.from(value, 'utf16le'), Buffer.alloc(2)]);
}

/**
 * Experimental statement bytes ONLY: no PSPCMPROG header, trailer or name table.
 * Grammar:
 *   statement:
 *     ';'
 *     | 'Local' type variable ('=' expression)? ';'
 *     | 'Return' expression? ';'
 *     | variable '=' expression ';'
 *     | call ';'
 *
 * expression: primary (('+' | '-' | '*' | '/') primary)*
 * primary: '-' primary | value | '(' expression ')' | call
 * call: identifier '(' (expression (',' expression)*)? ')'
 * value: &variable | quoted string (doubled delimiters) | True | False | uint128.
 * Operators retain source order; no folding, type checking or AST is needed
 * for this token format. Unary minus is supported; unary plus and member/index
 * access are unsupported.  
 */
function encodeFragmentInternal(source: string): { bytes: Buffer; references: PeopleCodeReference[] } {
  const typeName = (): Buffer => {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
    if (!match) return fail('expected a PeopleCode type name');
    pos += match[0].length;
    return textOperand(0x40, TokenKind.Keyword, match[0]);
  };

  const localDeclaration = () => {
    chunks.push(fixed('Local'));

    space();

    const type =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

    chunks.push(typeName());

    space();
    chunks.push(variable());

    space();
    if (source[pos] === '=') {
      pos++;
      chunks.push(fixed('='));

      space();

      if (/^boolean$/i.test(type ?? '') && source[pos] === '(') {
        parenthesized(booleanExpression, false);
      } else {
        expression();
      }
    }
  };

  const globalDeclaration = () => {
    chunks.push(fixed('Global'));

    space();
    chunks.push(typeName());

    space();
    chunks.push(variable());
  };

  const componentDeclaration = () => {
    chunks.push(fixed('Component'));

    space();
    chunks.push(typeName());

    space();
    chunks.push(variable());
  };

  const constantDeclaration = () => {
    chunks.push(fixed('Constant'));

    space();
    chunks.push(variable());

    space();

    if (source[pos] !== '=') {
      fail('expected = in Constant declaration');
    }

    pos++;
    chunks.push(fixed('='));

    expression();
  };


  let pos = 0;
  let depth = 0;
  const chunks: Buffer[] = [];
  const references: PeopleCodeReference[] = [];
  
  const reservedCallNames = new Set([...OPCODES.values()]
    .filter(spec => spec.kind === TokenKind.Keyword && spec.text)
    .map(spec => spec.text!.toLowerCase()));
  // Value is also a real bare 0x0a-introduced conversion call in the
  // corpus; its keyword meaning applies in DLL parameter declarations.
  reservedCallNames.delete('value');
  const fail = (detail: string): never => { throw new UnsupportedPeopleCodeError(pos, detail); };
  const space = () => { while (pos < source.length && /\s/.test(source[pos])) pos++; };
  const word = (value: string): boolean => {
    const tail = source.slice(pos);
    if (!tail.toLowerCase().startsWith(value.toLowerCase()) || /[A-Za-z0-9_$#]/.test(tail[value.length] ?? '')) return false;
    pos += value.length;
    return true;
  };
  const variable = (): Buffer => {
    const match = /^&[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
    if (!match) return fail('expected an ASCII &variable');
    pos += match[0].length;
    return textOperand(0x01, TokenKind.Name, match[0]);
  };
  const value = (): Buffer => {
    space();
    if (source[pos] === '&') return variable();
    if (word('True')) return fixed('True');
    if (word('False')) return fixed('False');
    const digits = /^[0-9]+/.exec(source.slice(pos))?.[0];
    if (digits !== undefined) {
      // Bound conversion before BigInt, including arbitrarily many leading
      // zeros. Never route the magnitude through a lossy JS Number.
      const canonical = digits.replace(/^0+/, '') || '0';
      if (canonical.length > MAX_INTEGER_DIGITS) fail('unsigned integer exceeds the 128-bit magnitude field');
      let magnitude = BigInt(canonical);
      if (magnitude > MAX_UNSIGNED_INTEGER) fail('unsigned integer exceeds the 128-bit magnitude field');
      const { opcode, operandLength, valueOffset, valueBytes } = UNSIGNED_NUMBER_FORMAT;
      const bytes = Buffer.alloc(1 + operandLength);
      bytes[0] = opcode;
      // The zero prefix and scale stay zero. Write the entire little-endian
      // magnitude field; integer division never rounds through floating point.
      for (let i = 0; i < valueBytes; i++) {
        bytes[1 + valueOffset + i] = Number(magnitude & 0xffn);
        magnitude >>= 8n;
      }
      pos += digits.length;
      return bytes;
    }
    const quote = source[pos];
    if (quote !== '"' && quote !== "'") return fail('expected a variable, string, boolean, or unsigned integer; other operands are unsupported');
    pos++;
    let text = '';
    while (pos < source.length) {
      const char = source[pos++];
      if (char === '\0') { pos--; return fail('NUL cannot appear in a terminated string operand'); }
      if (char === quote) {
        if (source[pos] === quote) { text += quote; pos++; }
        else return textOperand(0x16, TokenKind.StringLiteral, text);
      } else text += char;
    }
    return fail('unterminated string');
  };
  const expression = () => {
    primary();

    while (true) {
      space();

      const operator = /^[+\-*/]/.exec(source.slice(pos))?.[0];
      if (!operator) break;

      pos += operator.length;
      chunks.push(fixed(operator, operator === '*' ? 0x0f : undefined));
      primary();
    }
  };
  const booleanUnary = () => {
    space();

    if (/^Not\b/i.test(source.slice(pos))) {
      pos += 3;
      chunks.push(fixed('Not'));
      booleanUnary();
      return;
    }

    comparisonExpression();
  };

  const andExpression = () => {
    booleanUnary();
    space();

    if (!/^And\b/i.test(source.slice(pos))) {
      return;
    }

    chunks.push(Buffer.from([0x41]));

    while (/^And\b/i.test(source.slice(pos))) {
      pos += 3;
      chunks.push(fixed('And'));

      booleanUnary();
      space();
    }

    chunks.push(Buffer.from([0x42]));
  };

  const booleanExpression = () => {
    andExpression();
    space();

    if (!/^Or\b/i.test(source.slice(pos))) {
      return;
    }

    chunks.push(Buffer.from([0x41]));

    while (/^Or\b/i.test(source.slice(pos))) {
      pos += 2;
      chunks.push(fixed('Or'));

      andExpression();
      space();
    }

    chunks.push(Buffer.from([0x42]));
  };

  const comparisonExpression = () => {
    expression();
    space();

    const operator =
      /^(<>|<=|>=|=|<|>)/.exec(source.slice(pos))?.[0];

    if (!operator) {
      return;
    }

    pos += operator.length;
    chunks.push(fixed(operator));

    expression();
  };
  const parenthesized = (body: () => void, allowEmpty: boolean) => {
    if (source[pos] !== '(') fail('expected (');
    if (depth >= MAX_EXPRESSION_DEPTH) fail(`expression nesting exceeds ${MAX_EXPRESSION_DEPTH}`);
    depth++;
    pos++;
    chunks.push(fixed('('));
    space();
    if (!allowEmpty || source[pos] !== ')') body();
    space();
    if (source[pos] !== ')') fail('expected )');
    pos++;
    chunks.push(fixed(')'));
    depth--;
  };
  
  const declareFunction = () => {
    chunks.push(Buffer.from([0x31]));

    space();
    if (!word('Function')) {
      throw new UnsupportedPeopleCodeError(pos, 'expected Function after Declare');
    }
    chunks.push(fixed('Function'));

    space();
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (name === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected declared Function name');
    }
    pos += name.length;
    chunks.push(textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, name));

    space();
    if (!word('PeopleCode')) {
      throw new UnsupportedPeopleCodeError(pos, 'expected PeopleCode in Declare Function');
    }
    chunks.push(Buffer.from([0x3a]));

    space();
    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (recordName === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected record name in Declare Function PeopleCode target');
    }
    pos += recordName.length;

    if (source[pos] !== '.') {
      throw new UnsupportedPeopleCodeError(pos, 'expected . in Declare Function PeopleCode target');
    }
    pos++;

    const fieldName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (fieldName === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected field name in Declare Function PeopleCode target');
    }
    pos += fieldName.length;

    space();
    const eventName = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(pos))?.[0];
    if (eventName === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected event name in Declare Function');
    }
    pos += eventName.length;

    const existingReference = references.find(
      item =>
        item.recordName.toLowerCase() === recordName.toLowerCase() &&
        item.fieldName.toLowerCase() === fieldName.toLowerCase() &&
        item.eventName.toLowerCase() === eventName.toLowerCase()
    );

    const reference: PeopleCodeReference =
      existingReference ?? {
        index: references.length + 1,
        recordName,
        fieldName,
        eventName
      };

    if (existingReference === undefined) {
      references.push(reference);
    }

    if (reference.index > 0xffff) {
      throw new UnsupportedPeopleCodeError(pos, 'Declare Function reference index exceeds uint16 range');
    }

    const referenceBytes = Buffer.alloc(3);
    referenceBytes[0] = 0x21;
    referenceBytes.writeUInt16LE(reference.index, 1);
    chunks.push(referenceBytes);
    chunks.push(textOperand(0x40, TokenKind.Keyword, eventName));
    chunks.push(Buffer.from([0x42]));
  };

  function statement(): void {
    if (word('Declare')) {
      declareFunction();
    } else if (word('Function')) {
      functionStatement();
    } else if (word('Local')) {
      localDeclaration();
    } else if (word('Global')) {
      globalDeclaration();
    } else if (word('Component')) {
      componentDeclaration();
    } else if (word('Constant')) {
      constantDeclaration();
    } else if (word('Return')) {
      chunks.push(fixed('Return'));
      space();
      if (source[pos] !== ';') expression();
    } else if (word('If')) {
      ifStatement();
    } else if (word('While')) {
      whileStatement();
    } else if (word('For')) {
      forStatement();
    } else if (word('Repeat')) {
      repeatStatement();
    } else if (word('try')) {
      tryStatement();
    } else if (word('throw')) {
      throwStatement();

    } else if (word('Break')) {
      chunks.push(fixed('Break'));

    } else if (word('Evaluate')) {
      evaluateStatement();

    } else if (source[pos] === '&') {
      chunks.push(variable());
      space();
      if (source[pos] !== '=') fail('expected assignment =');
      pos++;
      chunks.push(fixed('='));
      expression();
    } else if (/[A-Za-z_]/.test(source[pos] ?? '')) {
      call();
    } else {
      fail('unsupported PeopleCode statement');
    }
  };

  function functionStatement(): void {
    chunks.push(fixed('Function'));

    space();

    const nameMatch =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

    if (!nameMatch) {
      return fail('expected Function name');
    }

    const name = nameMatch[0];
    pos += name.length;

    chunks.push(
      textOperand(
        INLINE_IDENTIFIER_OPCODE,
        TokenKind.Name,
        name
      )
    );

    space();

    // Parameters
    parenthesized(() => {
      space();

      if (source[pos] === ')') {
        return;
      }

      while (true) {
        chunks.push(variable());

        space();

        if (!word('As')) {
          fail('expected As in Function parameter');
        }

        chunks.push(fixed('As'));

        space();
        chunks.push(typeName());

        space();

        if (source[pos] !== ',') {
          break;
        }

        pos++;
        chunks.push(fixed(','));
        space();
      }
    }, true);

    space();

    // Optional return type.
    if (word('Returns')) {
      chunks.push(fixed('Returns'));

      space();
      chunks.push(typeName());

      space();
    }

    // Confirmed Function header -> body boundary.
    chunks.push(Buffer.from([0x2d]));

    let sawLocalDeclaration = false;
    let enteredExecutableSection = false;

    while (true) {
      space();

      if (word('End-Function')) {
        chunks.push(fixed('End-Function'));

        space();

        if (source[pos] !== ';') {
          fail('expected ; after End-Function');
        }

        pos++;
        chunks.push(fixed(';'));

        // Confirmed Function-definition boundary.
        chunks.push(Buffer.from([0x2d]));

        return;
      }

      if (pos === source.length) {
        fail('expected End-Function');
      }

      // PeopleTools emits one 0x4f when a Function transitions from one or
      // more leading Local declarations to its first executable statement.
      // It is not emitted when End-Function immediately follows the Locals.
      const isLocal = /^Local\b/i.test(source.slice(pos));

      if (!isLocal && sawLocalDeclaration && !enteredExecutableSection) {
        chunks.push(Buffer.from([0x4f]));
        enteredExecutableSection = true;
      }

      statement();

      if (isLocal) {
        sawLocalDeclaration = true;
      } else {
        enteredExecutableSection = true;
      }

      space();

      if (source[pos] !== ';') {
        fail('expected ; in Function body');
      }

      pos++;
      chunks.push(fixed(';'));
    }
  }

  function tryStatement(): void {
    chunks.push(fixed('try'));

    while (true) {
      space();

      if (word('catch')) {
        chunks.push(fixed('catch'));

        space();

        const typeMatch =
          /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

        if (!typeMatch) {
          return fail('expected exception type after catch');
        }

        const typeName = typeMatch[0];
        pos += typeName.length;

        chunks.push(
          textOperand(
            INLINE_IDENTIFIER_OPCODE,
            TokenKind.Name,
            typeName
          )
        );

        space();

        chunks.push(variable());

        // Confirmed catch-header -> body boundary.
        chunks.push(Buffer.from([0x2d]));

        while (true) {
          space();

          if (word('end-try')) {
            chunks.push(fixed('end-try'));
            return;
          }

          if (pos === source.length) {
            fail('expected end-try');
          }

          statement();

          space();

          if (source[pos] !== ';') {
            fail('expected ; in catch body');
          }

          pos++;
          chunks.push(fixed(';'));
        }
      }

      if (pos === source.length) {
        fail('expected catch');
      }

      statement();

      space();

      if (source[pos] !== ';') {
        fail('expected ; in try body');
      }

      pos++;
      chunks.push(fixed(';'));
    }
  }
  

  function throwStatement(): void {
    chunks.push(fixed('throw'));
    expression();
  }
  function repeatStatement(): void {
    chunks.push(fixed('Repeat'));

    while (true) {
      space();

      if (word('Until')) {
        chunks.push(fixed('Until'));

        space();
        booleanExpression();
        return;
      }

      if (pos === source.length) {
        fail('expected Until');
      }

      statement();

      space();
      if (source[pos] !== ';') {
        fail('expected ; in Repeat body');
      }

      pos++;
      chunks.push(fixed(';'));
    }
  }
  function forStatement(): void {
    chunks.push(fixed('For'));

    space();
    chunks.push(variable());

    space();
    if (source[pos] !== '=') {
      fail('expected = in For');
    }

    pos++;
    chunks.push(fixed('='));

    expression();

    space();
    if (!word('To')) {
      fail('expected To');
    }

    chunks.push(fixed('To'));

    expression();

    space();

    if (word('Step')) {
      chunks.push(fixed('Step'));
      expression();
    }

    // Confirmed PeopleTools boundary between loop header and body.
    chunks.push(Buffer.from([0x2d]));

    while (true) {
      space();

      if (word('End-For')) {
        chunks.push(fixed('End-For'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-For');
      }

      statement();

      space();
      if (source[pos] !== ';') {
        fail('expected ; in For body');
      }

      pos++;
      chunks.push(fixed(';'));
    }
  }
  function whileStatement(): void {
    chunks.push(fixed('While'));

    space();
    booleanExpression();

    // Confirmed structural boundary between condition and body.
    chunks.push(Buffer.from([0x2d]));

    while (true) {
      space();

      if (word('End-While')) {
        chunks.push(fixed('End-While'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-While');
      }

      statement();

      space();
      if (source[pos] !== ';') {
        fail('expected ; in While body');
      }

      pos++;
      chunks.push(fixed(';'));
    }
  }

  function ifStatement(): void {
    chunks.push(fixed('If'));

    space();
    booleanExpression();

    space();
    if (!word('Then')) {
      fail('expected Then');
    }
    chunks.push(fixed('Then'));

    // Then body
    while (true) {
      space();

      if (word('Else')) {
        chunks.push(fixed('Else'));
        break;
      }

      if (word('End-If')) {
        chunks.push(fixed('End-If'));
        return;
      }

      if (pos === source.length) {
        fail('expected Else or End-If');
      }

      statement();

      space();
      if (source[pos] !== ';') {
        fail('expected ; in If body');
      }

      pos++;
      chunks.push(fixed(';'));
    }

    // Else body
    while (true) {
      space();

      if (word('End-If')) {
        chunks.push(fixed('End-If'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-If');
      }

      statement();

      space();
      if (source[pos] !== ';') {
        fail('expected ; in Else body');
      }

      pos++;
      chunks.push(fixed(';'));
    }
  }
  function evaluateStatement(): void {
    chunks.push(fixed('Evaluate'));

    space();
    expression();

    let sawWhen = false;
    let sawWhenOther = false;

    while (true) {
      space();

      if (word('When-Other')) {
        if (sawWhenOther) {
          fail('duplicate When-Other');
        }

        sawWhenOther = true;
        chunks.push(fixed('When-Other'));

        // Parse When-Other body until End-Evaluate.
        while (true) {
          space();

          if (word('End-Evaluate')) {
            chunks.push(fixed('End-Evaluate'));
            return;
          }

          if (pos === source.length) {
            fail('expected End-Evaluate');
          }

          statement();

          space();
          if (source[pos] !== ';') {
            fail('expected ; in When-Other body');
          }

          pos++;
          chunks.push(fixed(';'));
        }
      }

      if (word('When')) {
        sawWhen = true;
        chunks.push(fixed('When'));

        space();

        // Our calibrated fixture permits a parenthesized comparison here.
        if (source[pos] === '(') {
          parenthesized(booleanExpression, false);
        } else {
          expression();
        }

        // Confirmed by every When in the fixture.
        chunks.push(Buffer.from([0x2d]));

        // Parse this When body until the next clause/end.
        while (true) {
          space();

          if (
            /^When(?:-Other)?\b/i.test(source.slice(pos)) ||
            /^End-Evaluate\b/i.test(source.slice(pos))
          ) {
            break;
          }

          if (pos === source.length) {
            fail('expected End-Evaluate');
          }

          statement();

          space();
          if (source[pos] !== ';') {
            fail('expected ; in When body');
          }

          pos++;
          chunks.push(fixed(';'));
        }

        continue;
      }

      if (word('End-Evaluate')) {
        if (!sawWhen) {
          fail('Evaluate requires at least one When');
        }

        chunks.push(fixed('End-Evaluate'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-Evaluate');
      }

      fail('expected When, When-Other, or End-Evaluate');
    }
  }
  const call = () => {
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!name) return fail('expected a simple call name');
    if (reservedCallNames.has(name.toLowerCase())) fail(`keyword ${name} is not a supported call name`);
    pos += name.length;
    space();
    if (source[pos] !== '(') fail('bare identifiers are only supported as calls');
    chunks.push(textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, name));
    parenthesized(() => {
      expression();
      space();
      while (source[pos] === ',') {
        pos++;
        chunks.push(fixed(','));
        expression();
        space();
      }
    }, true);
  };
  const primary = () => {
    space();

    if (source[pos] === '-') {
      pos++;
      chunks.push(fixed('-'));
      primary();
      return;
    }

    if (source[pos] === '(') {
      parenthesized(expression, false);
      return;
    }

    const identifier =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

    if (identifier && !/^(true|false)$/i.test(identifier)) {
      call();
    } else {
      chunks.push(value());
    }

    // Postfix member access / method calls.
    while (true) {
      space();

      if (source[pos] !== '.') {
        break;
      }

      pos++;
      chunks.push(fixed('.'));

      space();

      const memberMatch =
        /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

      if (!memberMatch) {
        return fail('expected member name after .');
      }

      const member = memberMatch[0];
      pos += member.length;

      chunks.push(
        textOperand(
          INLINE_IDENTIFIER_OPCODE,
          TokenKind.Name,
          member
        )
      );

      space();

      if (source[pos] === '(') {
        parenthesized(() => {
          space();

          if (source[pos] === ')') {
            return;
          }

          expression();
          space();

          while (source[pos] === ',') {
            pos++;
            chunks.push(fixed(','));
            expression();
            space();
          }
        }, true);
      }
    }
  };
  let sawTopLevelDeclaration = false;
  let closedTopLevelDeclarationSection = false;

  while (true) {
    space();

    if (pos === source.length) {
      break;
    }

    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
      continue;
    }

    const isFunction = /^Function\b/i.test(source.slice(pos));
    const isTopLevelDeclaration = /^(?:Global|Component|Constant|Declare\s+Function)\b/i.test(source.slice(pos));

    // Calibrated top-level declaration transition:
    //
    //   Global ... ;
    //   Component ... ;
    //   2D
    //   [4F if executable code follows]
    //
    // A declaration-only program gets only the 2D here; encodeProgram()
    // supplies the final program-directory 07.
    if (
      !isTopLevelDeclaration &&
      sawTopLevelDeclaration &&
      !closedTopLevelDeclarationSection
    ) {
      chunks.push(Buffer.from([0x2d]));
      chunks.push(Buffer.from([0x4f]));
      closedTopLevelDeclarationSection = true;
    }

    statement();

    if (isFunction) {
      continue;
    }

    space();

    if (source[pos] !== ';') {
      fail('expected ;');
    }

    pos++;
    chunks.push(fixed(';'));

    if (isTopLevelDeclaration) {
      sawTopLevelDeclaration = true;
    }
  }

  if (sawTopLevelDeclaration && !closedTopLevelDeclarationSection) {
    chunks.push(Buffer.from([0x2d]));
  }

  return {
    bytes: Buffer.concat(chunks),
    references
  };
}

export function encodeFragment(source: string): Buffer {
  return encodeFragmentInternal(source).bytes;
}


function parseFunctionMetadata(source: string): FunctionMetadata | undefined {
  const functionMatch =
    /^\s*Function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(source);

  if (!functionMatch) {
    return undefined;
  }

  const name = functionMatch[1];
  let pos = functionMatch[0].length;

  const closeParen = source.indexOf(')', pos);
  if (closeParen < 0) {
    throw new Error('Unterminated Function parameter list');
  }

  const parameterSource = source.slice(pos, closeParen).trim();
  const parameterTypes: string[] = [];

  if (parameterSource.length > 0) {
    for (const parameter of parameterSource.split(',')) {
      const match =
        /^\s*&[A-Za-z_][A-Za-z0-9_]*\s+As\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(
          parameter
        );

      if (!match) {
        throw new Error(`Unsupported Function parameter: ${parameter.trim()}`);
      }

      parameterTypes.push(match[1]);
    }
  }

  pos = closeParen + 1;

  const afterParameters = source.slice(pos);

  const returnMatch =
    /^\s*Returns\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(afterParameters);

  return {
    name,
    parameterTypes,
    returnType: returnMatch?.[1]
  };
}

/**
 * Complete PSPCMPROG bytes for the encodeFragment subset, using the observed
 * 0xa0/0x85 format and empty metadata sections. No PSPCMNAME references are
 * generated. Producing bytes is not a database write or a PeopleTools runtime
 * validation; provider saves remain disabled.
 */
export function encodeProgramArtifacts(source: string): EncodedPeopleCode {
  const functionMetadata = parseFunctionMetadata(source);
  const encoded = encodeFragmentInternal(source);
  const statements = encoded.bytes;

  let program: Buffer;

  if (!functionMetadata) {
    program = Buffer.concat([
      encodeSimpleProgramHeader(statements.length + 1),
      statements,
      Buffer.from([PROGRAM_DIRECTORY_SEPARATOR])
    ]);
  } else {
    const metadata = encodeFunctionMetadata(functionMetadata);
    const executableLength = statements.length + 1;

    program = Buffer.concat([
      encodeFunctionProgramHeader(
        executableLength,
        functionMetadata
      ),
      statements,
      Buffer.from([PROGRAM_DIRECTORY_SEPARATOR]),
      metadata
    ]);
  }

  return {
    program,
    references: encoded.references
  };
}

export function encodeProgram(source: string): Buffer {
  return encodeProgramArtifacts(source).program;
}
