import { encodePrimitiveMethodSignature } from './applicationClassMetadata.js';
import { encodeSimpleProgramHeader, PROGRAM_DIRECTORY_SEPARATOR } from './programLayout.js';
import {
  INLINE_IDENTIFIER_OPCODE,
  OPCODES,
  PRIMITIVE_SIGNATURE_TYPE_IDS,
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
  /** Zero-based PSPCMPROG 0x21 operand; PSPCMNAME sequence is index + 1. */
  index: number;
  /** One-based PSPCMNAME sequence. */
  sequence: number;
  kind: 'owner' | 'record-field' | 'package' | 'record' | 'field' | 'scroll' | 'component' | 'declare-function';
  recordName?: string;
  fieldName?: string;
  eventName?: string;
  packageName?: string;
  objectName?: string;
  /** Application Package path components, excluding the class name. */
  packagePath?: string[];
  /** Application Class name for PACKAGE dependency rows. */
  className?: string;
  methodName?: string;
}

export interface PeopleCodeOwner {
  recordName: string;
  fieldName: string;
}

export interface EncodeProgramContext {
  owner?: PeopleCodeOwner;

  /**
   * Original block-comment opcodes, in source order, when re-encoding
   * text produced by decodeProgram().
   *
   * 0x24 = standalone block comment
   * 0x4E = alternate/trailing block-comment representation
   *
   * Ordinary source encoding leaves this undefined and derives the
   * representation from source placement.
   */
  commentOpcodes?: readonly (0x24 | 0x4e)[];
}

export interface EncodedPeopleCode {
  program: Buffer;
  references: PeopleCodeReference[];
}

function functionTypeId(typeName: string): number {
  const id = PRIMITIVE_SIGNATURE_TYPE_IDS.get(typeName.toLowerCase());
  if (id === undefined) throw new Error(`Unsupported function metadata type: ${typeName}`);
  return id;
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
function encodeFragmentInternal(source: string, context?: EncodeProgramContext): { bytes: Buffer; references: PeopleCodeReference[] } {

  let commentOpcodeIndex = 0;

  const consumeCommentOpcode = (
    fallback: 0x24 | 0x4e
  ): 0x24 | 0x4e => {
    const opcode =
      context?.commentOpcodes?.[commentOpcodeIndex];

    if (opcode === 0x24 || opcode === 0x4e) {
      commentOpcodeIndex++;
      return opcode;
    }

    return fallback;
  };

  const typeName = (): Buffer => {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
    if (!match) return fail('expected a PeopleCode type name');

    const name = match[0];
    pos += name.length;

    // Calibrated object declaration types use the ordinary inline-name
    // introducer rather than the primitive-type 0x40 introducer.
    if (/^(Record|Field|Rowset|Row|SQL)$/i.test(name)) {
      return textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, name);
    }

    return textOperand(0x40, TokenKind.Keyword, name);
  };

  const localDeclaration = () => {
    chunks.push(fixed('Local'));

    space();

    // Application-class declaration:
    //   Local OU_CORPUS:Utilities:TestClass &obj;
    // => 44 0A "OU_CORPUS" 57 0A "Utilities" 57 0A "TestClass" 01 "&obj"
    //
    // The declaration itself does NOT allocate a PSPCMNAME dependency row.
    const appClassLookahead =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(
        source.slice(pos)
      );

    if (appClassLookahead) {
      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      space();

      const variableMatch =
        /^&[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
      if (!variableMatch) {
        return fail('expected an ASCII &variable');
      }

      const variableName = variableMatch[0];
      chunks.push(variable());

      applicationClassVariables.set(variableName.toLowerCase(), {
        packagePath: appClass.packagePath,
        className: appClass.className
      });

      space();
      if (source[pos] === '=') {
        pos++;
        chunks.push(fixed('='));
        expression();
      }

      return;
    }

    const type =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

    chunks.push(typeName());

    // Calibrated compound declaration:
    //   Local array of string &values;
    // => 44 40 "array" 40 "of" 40 "string" 01 "&values"
    if (/^array$/i.test(type ?? '')) {
      space();

      const ofMatch = /^of\b/i.exec(source.slice(pos));
      if (!ofMatch) {
        return fail('expected "of" after array in Local declaration');
      }
      pos += ofMatch[0].length;
      chunks.push(textOperand(0x40, TokenKind.Keyword, 'of'));

      space();
      chunks.push(typeName());
    }

    if (/^Record$/i.test(type ?? '')) {
      ensurePackageReference('RECORD', 'Record');
    } else if (/^Field$/i.test(type ?? '')) {
      ensurePackageReference('FIELD', 'Field');
    } else if (/^Rowset$/i.test(type ?? '')) {
      ensurePackageReference('ROWSET', 'Rowset');
    } else if (/^Row$/i.test(type ?? '')) {
      ensurePackageReference('ROW', 'Row');
    } else if (/^SQL$/i.test(type ?? '')) {
      ensurePackageReference('SQL', 'SQL');
    }

    /*
    * A Local declaration may declare multiple variables of the same type:
    *
    *   Local Rowset &RS1, &RS2;
    *   Local number &I, &FirstRow, &HireRow;
    *
    * The comma is the ordinary 0x03 punctuation opcode and each variable
    * remains an ordinary 0x01 text operand.
    */
    space();
    const firstDeclaredVariable =
      /^&[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (/^Record$/i.test(type ?? '') && firstDeclaredVariable) {
      recordVariables.add(firstDeclaredVariable.toLowerCase());
    }
    chunks.push(variable());

    while (true) {
      space();

      if (source[pos] !== ',') {
        break;
      }

      pos++;
      chunks.push(fixed(','));

      space();
      const declaredVariable =
        /^&[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
      if (/^Record$/i.test(type ?? '') && declaredVariable) {
        recordVariables.add(declaredVariable.toLowerCase());
      }
      chunks.push(variable());
    }

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

  const systemVariable = (): Buffer => {
    const match = /^%[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

    if (!match) {
      return fail('expected a PeopleCode system variable');
    }

    const name = match[0];
    pos += name.length;

    return textOperand(
      0x12,
      TokenKind.Name,
      name
    );
  };
  
  let pos = 0;
  let depth = 0;
  const chunks: Buffer[] = [];
  const references: PeopleCodeReference[] = [];

  // Application-class declarations establish receiver type information used
  // to emit PSPCMNAME dependency metadata for method calls.
  const applicationClassVariables = new Map<
    string,
    { packagePath: string[]; className: string }
  >();
  const recordVariables = new Set<string>();

  const same = (a: string | undefined, b: string | undefined): boolean =>
    (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

  // Every calibrated PSPCMNAME set has sequence 1 occupied by the owning
  // PeopleCode definition. When the caller supplies owner context we expose
  // that row explicitly. Without context we reserve the slot internally and
  // bind it to the first matching ordinary record/field reference if one is
  // encountered. This preserves the calibrated encodeProgram(source) API
  // while allowing persistence code to provide the exact owner.
  let ownerReference: PeopleCodeReference = {
    index: 0,
    sequence: 1,
    kind: 'owner',
    recordName: context?.owner?.recordName,
    fieldName: context?.owner?.fieldName
  };
  references.push(ownerReference);

  const nextReference = (
    reference: Omit<PeopleCodeReference, 'index' | 'sequence'>
  ): PeopleCodeReference => {
    const sequence = references.length + 1;
    const created: PeopleCodeReference = {
      ...reference,
      sequence,
      index: sequence - 1
    };
    references.push(created);
    return created;
  };

  const findPackageReference = (
    packageName: string,
    objectName: string
  ): PeopleCodeReference | undefined =>
    references.find(
      item =>
        item.kind === 'package' &&
        same(item.packageName, packageName) &&
        same(item.objectName, objectName)
    );

  const ensurePackageReference = (
    packageName: string,
    objectName: string
  ): PeopleCodeReference =>
    findPackageReference(packageName, objectName) ??
    nextReference({
      kind: 'package',
      packageName,
      objectName
    });

  const addApplicationClassReference = (
    packagePath: string[],
    className: string,
    methodName?: string
  ): PeopleCodeReference => {
    if (packagePath.length === 0) {
      return fail('application class requires at least one package component');
    }

    return nextReference({
      kind: 'package',

      // Preserve the original two-component artifact mapping for existing
      // consumers while also exposing the complete calibrated hierarchy.
      //
      //   OU_CORPUS:TestClass
      //     PSPCMNAME: PACKAGE | TESTCLASS | OU_CORPUS
      //
      //   OU_CORPUS:Utilities:TestClass
      //     PSPCMNAME: PACKAGE | TESTCLASS | OU_CORPUS | Utilities
      //
      // A method dependency appends the method name after the package path.
      packageName: className.toUpperCase(),
      objectName: packagePath[0].toUpperCase(),
      packagePath: packagePath.map(
        (component, index) =>
          index === 0 ? component.toUpperCase() : component
      ),
      className: className.toUpperCase(),
      methodName: methodName?.toUpperCase()
    });
  };

  const applicationClassPath = (): {
    packagePath: string[];
    className: string;
    bytes: Buffer;
  } => {
    const components: string[] = [];

    const firstMatch =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
    if (!firstMatch) {
      return fail('expected application package name');
    }

    components.push(firstMatch[0]);
    pos += firstMatch[0].length;

    while (true) {
      space();

      if (source[pos] !== ':') {
        break;
      }

      pos++;
      space();

      const componentMatch =
        /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
      if (!componentMatch) {
        return fail('expected application package/class name after :');
      }

      components.push(componentMatch[0]);
      pos += componentMatch[0].length;
    }

    if (components.length < 2) {
      return fail('application class path requires package and class names');
    }

    const className = components[components.length - 1];
    const packagePath = components.slice(0, -1);

    const encoded: Buffer[] = [];
    components.forEach((component, index) => {
      if (index > 0) {
        encoded.push(Buffer.from([0x57]));
      }

      encoded.push(
        textOperand(
          INLINE_IDENTIFIER_OPCODE,
          TokenKind.Name,
          component
        )
      );
    });

    return {
      packagePath,
      className,
      bytes: Buffer.concat(encoded)
    };
  };

  const referenceOperand = (reference: PeopleCodeReference): Buffer => {
    if (reference.index > 0xffff) {
      throw new UnsupportedPeopleCodeError(
        pos,
        'PeopleCode reference index exceeds uint16 range'
      );
    }

    const bytes = Buffer.alloc(3);
    bytes[0] = 0x21;
    bytes.writeUInt16LE(reference.index, 1);
    return bytes;
  };

  const ordinaryRecordFieldReference = (): Buffer => {
    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected record name');
    pos += recordName.length;

    if (source[pos] !== '.') return fail('expected . in record/field reference');
    pos++;

    const fieldName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!fieldName) return fail('expected field name');
    pos += fieldName.length;

    // A reference to the owning record/field uses PSPCMNAME sequence 1.
    // If owner context was omitted, the first ordinary record/field reference
    // is the only calibrated inference available, so bind the reserved owner
    // slot to it. If it is not the owner, allocate a normal occurrence row.
    const ownerUnbound =
      ownerReference.recordName === undefined &&
      ownerReference.fieldName === undefined;

    if (ownerUnbound) {
      ownerReference.recordName = recordName;
      ownerReference.fieldName = fieldName;
      return referenceOperand(ownerReference);
    }

    if (
      same(ownerReference.recordName, recordName) &&
      same(ownerReference.fieldName, fieldName)
    ) {
      return referenceOperand(ownerReference);
    }

    /*
    * Ordinary RECORD.FIELD references are name-deduplicated.
    *
    * Calibrated by AA_COST_RT_JPN.EMPL_RCD_JPN.FieldChange:
    * BUS_UNIT_TBL_HR.DESCRSHORT appears repeatedly in source but occupies
    * one PSPCMNAME row, and every compiled 0x21 operand reuses that same
    * zero-based reference index.
    *
    * This is distinct from explicit Record.X / Field.X / Scroll.X
    * references, which have separate occurrence-based calibration.
    */
    const key = `${controlGroup}:${recordName.toLowerCase()}:${fieldName.toLowerCase()}`;
    const existing = ordinaryRecordFieldsByControlGroup.get(key);

    if (existing !== undefined) {
      return referenceOperand(existing);
    }

    const reference = nextReference({
      kind: 'record-field',
      recordName,
      fieldName
    });
    ordinaryRecordFieldsByControlGroup.set(key, reference);
    return referenceOperand(reference);
  };

  let reuseRecordReferenceByName = false;
  const ordinaryRecordFieldsByControlGroup = new Map<string, PeopleCodeReference>();
  let controlDepth = 0;
  let controlGroup = 0;
  let nextControlGroup = 1;
  const inControlGroup = (parse: () => void): void => {
    const previousGroup = controlGroup;
    if (controlDepth === 0) controlGroup = nextControlGroup++;
    controlDepth++;
    try {
      parse();
    } finally {
      controlDepth--;
      controlGroup = previousGroup;
    }
  };
  let reuseRowShorthandRecord = false;
  let captureRowsetElementRecord = false;
  const rowShorthandRecords = new Map<string, PeopleCodeReference>();
  const rowsetElementRecords = new Map<string, PeopleCodeReference>();
  const createRecordReferences = new Map<string, PeopleCodeReference>();
  const createRecordReferenceCounts = new Map<string, number>();
  const rowShorthandRecordsByBase = new Map<string, PeopleCodeReference>();
  const recordVariableFields = new Map<string, PeopleCodeReference>();
  const rowShorthandFields = new Map<string, PeopleCodeReference>();
  const latestFields = new Map<string, PeopleCodeReference>();
  const resetRecordVariableFields = new Set<string>();

  const recordReference = (): Buffer => {
    if (!word('Record')) return fail('expected Record');
    if (source[pos] !== '.') return fail('expected . after Record');
    pos++;

    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected record name after Record.');
    pos += recordName.length;

    /*
    * Record.X is normally occurrence-based.
    *
    * However, calibrated GetSetId(...) calls reuse an existing RECORD
    * PSPCMNAME row when the same Record.X is supplied repeatedly:
    *
    *   GetSetId(..., Record.DEPT_TBL, ...)
    *   GetSetId(..., Record.DEPT_TBL, ...)
    *
    * Other calibrated contexts such as CreateRecord(Record.X) remain
    * occurrence-based.
    */
    if (reuseRowShorthandRecord) {
      const existing = rowShorthandRecords.get(recordName.toLowerCase());
      if (existing !== undefined) {
        return referenceOperand(existing);
      }
      const createCount = createRecordReferenceCounts.get(recordName.toLowerCase()) ?? 0;
      const previousCreate = createRecordReferences.get(recordName.toLowerCase());
      if (createCount >= 2 && previousCreate !== undefined) {
        return referenceOperand(previousCreate);
      }
    }

    if (reuseRecordReferenceByName) {
      const existing = references.find(
        reference =>
          reference.kind === 'record' &&
          reference.recordName !== undefined &&
          reference.recordName.toLowerCase() === recordName.toLowerCase()
      );

      if (existing !== undefined) {
        return referenceOperand(existing);
      }
    }

    const reference = nextReference({
      kind: 'record',
      recordName
    });
    if (reuseRowShorthandRecord) {
      const key = recordName.toLowerCase();
      createRecordReferences.set(key, reference);
      createRecordReferenceCounts.set(
        key,
        (createRecordReferenceCounts.get(key) ?? 0) + 1
      );
    }
    if (captureRowsetElementRecord) {
      rowsetElementRecords.set(recordName.toLowerCase(), reference);
    }
    return referenceOperand(reference);
  };

  const fieldReference = (): Buffer => {
    if (!word('Field')) return fail('expected Field');
    if (source[pos] !== '.') return fail('expected . after Field');
    pos++;

    const fieldName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!fieldName) return fail('expected field name after Field.');
    pos += fieldName.length;

    // Field.X allocates only the occurrence-based FIELD row.
    // PACKAGE FIELD is created by a Field object declaration, not by
    // encountering Field.X in an expression.
    // Repeated-Field calibration proves FIELD rows are occurrence-based.
    return referenceOperand(
      nextReference({
        kind: 'field',
        fieldName
      })
    );
  };

  const scrollReference = (): Buffer => {
    if (!word('Scroll')) return fail('expected Scroll');
    if (source[pos] !== '.') return fail('expected . after Scroll');
    pos++;

    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected scroll name after Scroll.');
    pos += recordName.length;

    // Calibrated: SCROLL rows occupy occurrence-specific PSPCMNAME entries.
    return referenceOperand(
      nextReference({
        kind: 'scroll',
        recordName
      })
    );
  };


  const componentReference = (): Buffer => {
    if (!word('Component')) return fail('expected Component');
    if (source[pos] !== '.') return fail('expected . after Component');
    pos++;

    const componentName =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

    if (!componentName) {
      return fail('expected component name after Component.');
    }

    pos += componentName.length;

    return referenceOperand(
      nextReference({
        kind: 'component',
        objectName: componentName
      })
    );
  };

  const reservedCallNames = new Set([...OPCODES.values()]
    .filter(spec => spec.kind === TokenKind.Keyword && spec.text)
    .map(spec => spec.text!.toLowerCase()));
  // Value is also a real bare 0x0a-introduced conversion call in the
  // corpus; its keyword meaning applies in DLL parameter declarations.
  reservedCallNames.delete('value');
  // const fail = (detail: string): never => { throw new UnsupportedPeopleCodeError(pos, detail); };
  const fail = (message: string): never => {
    if (message.includes('expected assignment')) {
      console.error(
        '\nENCODER ASSIGNMENT FAILURE',
        '\npos:', pos,
        '\nnext:', JSON.stringify(source.slice(pos, pos + 100)),
        '\nprevious:', JSON.stringify(source.slice(Math.max(0, pos - 100), pos)),
        '\nstack:', new Error().stack
      );
    }

    throw new UnsupportedPeopleCodeError(pos, message);
  };
  const space = () => { while (pos < source.length && /\s/.test(source[pos])) pos++; };
  const blockComment = (): Buffer => {
    if (!source.startsWith('/*', pos)) {
      return fail('expected block comment');
    }

    const end = source.indexOf('*/', pos + 2);

    if (end < 0) {
      return fail('unterminated block comment');
    }

    const text = source.slice(pos, end + 2);
    const payload = Buffer.from(text, 'utf16le');

    if (payload.length > 0xffff) {
      return fail('block comment exceeds uint16 byte-length field');
    }

    const header = Buffer.alloc(3);
    header[0] = consumeCommentOpcode(0x24);
    header.writeUInt16LE(payload.length, 1);

    pos = end + 2;

    return Buffer.concat([header, payload]);
  };
  const inlineBlockComment = (): Buffer => {
    if (!source.startsWith('/*', pos)) {
      return fail('expected inline block comment');
    }

    const end = source.indexOf('*/', pos + 2);

    if (end < 0) {
      return fail('unterminated inline block comment');
    }

    const text = source.slice(pos, end + 2);
    const payload = Buffer.from(text, 'utf16le');

    if (payload.length > 0xffff) {
      return fail(
        'inline block comment exceeds uint16 byte-length field'
      );
    }

    const header = Buffer.alloc(3);
    header[0] = consumeCommentOpcode(0x4e);
    header.writeUInt16LE(payload.length, 1);

    pos = end + 2;

    return Buffer.concat([
      header,
      payload
    ]);
  };
  const trailingBlockComments = (): void => {
    while (true) {
      /*
      * Only consume horizontal whitespace here.
      * A newline means the comment is no longer trailing the statement.
      */
      while (
        pos < source.length &&
        (source[pos] === ' ' || source[pos] === '\t')
      ) {
        pos++;
      }

      if (!source.startsWith('/*', pos)) {
        return;
      }

      chunks.push(inlineBlockComment());
    }
  };
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

      // A block comment starts with the same slash used by division, but it
      // is a statement boundary and must remain available to the statement
      // parser.
      if (source.startsWith('/*', pos)) break;

      const operator = /^[+\-*/|]/.exec(source.slice(pos))?.[0];
      if (!operator) break;

      pos += operator.length;
      chunks.push(fixed(operator, operator === '*' ? 0x0f : undefined));
      primary();
    }
  };
  const booleanUnary = () => {
    space();

    if (source[pos] === '(') {
      parenthesized(booleanExpression, false);
      space();
      const operator =
        /^(<>|<=|>=|=|<|>)/.exec(source.slice(pos))?.[0];
      if (operator !== undefined) {
        pos += operator.length;
        chunks.push(fixed(operator));
        expression();
      }
      return;
    }

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

    let reference = references.find(
      item =>
        item.kind === 'declare-function' &&
        same(item.recordName, recordName) &&
        same(item.fieldName, fieldName) &&
        same(item.eventName, eventName)
    );

    if (reference === undefined) {
      reference = nextReference({
        kind: 'declare-function',
        recordName,
        fieldName,
        eventName
      });
    }

    chunks.push(referenceOperand(reference));
    chunks.push(textOperand(0x40, TokenKind.Keyword, eventName));
    chunks.push(Buffer.from([0x42]));
  };

  const importStatement = () => {
    // `import` is 0x58 in the calibrated Application Class fixture.
    chunks.push(Buffer.from([0x58]));

    space();
    const appClass = applicationClassPath();
    chunks.push(appClass.bytes);

    // Import itself establishes one PSPCMNAME PACKAGE dependency row.
    addApplicationClassReference(
      appClass.packagePath,
      appClass.className
    );
  };

  function statement(): void {
    if (source.startsWith('/*', pos)) {
      chunks.push(blockComment());
    } else if (word('import')) {
      importStatement();
    } else if (word('Declare')) {
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
      inControlGroup(ifStatement);
    } else if (word('While')) {
      inControlGroup(whileStatement);
    } else if (word('For')) {
      inControlGroup(forStatement);
    } else if (word('Repeat')) {
      inControlGroup(repeatStatement);
    } else if (word('try')) {
      tryStatement();
    } else if (word('throw')) {
      throwStatement();

    } else if (word('Break')) {
      chunks.push(fixed('Break'));

    } else if (word('Exit')) {
      chunks.push(fixed('Exit'));
      const afterExit = pos;
      space();
      if (source[pos] === '(') {
        parenthesized(expression, false);
      } else {
        pos = afterExit;
      }

    } else if (word('Continue')) {
      chunks.push(fixed('Continue'));

    } else if (word('Error')) {
      chunks.push(fixed('Error'));
      space();
      expression();

    } else if (word('Warning')) {
      chunks.push(fixed('Warning'));
      space();
      expression();

    } else if (word('Evaluate')) {
      inControlGroup(evaluateStatement);

    } else if (source[pos] === '&' || source[pos] === '@') {
      // A variable-led statement may be either an assignment:
      //
      //   &x = value;
      //   &fld.Value = value;
      //
      // or a method-call statement:
      //
      //   &fld.ClearDropDownList();
      //
      // primary() consumes the complete variable/member/call chain.
      const statementVariable =
        /^&[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
      primary();
      space();

      if (source[pos] === '=') {
        pos++;
        if (
          statementVariable !== undefined &&
          recordVariables.has(statementVariable.toLowerCase()) &&
          /^\s*CreateRecord\b/i.test(source.slice(pos)) &&
          !resetRecordVariableFields.has(statementVariable.toLowerCase())
        ) {
          const prefix = `${statementVariable.toLowerCase()}:`;
          let clearedField = false;
          for (const key of recordVariableFields.keys()) {
            if (key.startsWith(prefix)) {
              recordVariableFields.delete(key);
              clearedField = true;
            }
          }
          if (clearedField) {
            resetRecordVariableFields.add(statementVariable.toLowerCase());
          }
        }
        chunks.push(fixed('='));
        expression();
      } else if (source[pos] !== ';') {
        fail('expected assignment = or end of method-call statement');
      }
    } else if (/[A-Za-z_]/.test(source[pos] ?? '')) {
      const tail = source.slice(pos);
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)) {
        chunks.push(ordinaryRecordFieldReference());
        let sawMethodCall = false;

        // Calibrated postfix member chain, e.g. OU_CORPUS.CODE.Value.
        while (true) {
          space();
          if (source[pos] !== '.') break;
          pos++;
          chunks.push(fixed('.'));
          space();
          const member = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
          if (member === undefined) {
            throw new UnsupportedPeopleCodeError(pos, 'expected member name after .');
          }
          pos += member.length;
          chunks.push(textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, member));
          space();
          if (source[pos] === '(') {
            sawMethodCall = true;
            parenthesized(() => {
              space();
              if (source[pos] === ')') return;
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

        space();
        if (sawMethodCall && source[pos] === ';') {
          return;
        }
        //if (source[pos] !== '=') fail('expected assignment =');
        if (source[pos] !== '=') {
          fail(
            `expected assignment = [DOTTED-STMT] ` +
            `next=${JSON.stringify(source.slice(pos, pos + 80))} ` +
            `previous=${JSON.stringify(source.slice(Math.max(0, pos - 80), pos))}`
          );
        }
        pos++;
        chunks.push(fixed('='));
        expression();
      } else {
        call();
      }
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
      trailingBlockComments();
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
      trailingBlockComments();
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
      trailingBlockComments();
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

    /*
    * expression() may consume the whitespace following the To/Step
    * expression. Recover that trailing whitespace from immediately before
    * the current source position so a blank line between the For header and
    * its first body statement still emits PeopleTools' 0x4F marker.
    */
    let trailingWhitespaceStart = pos;

    while (
      trailingWhitespaceStart > 0 &&
      /\s/.test(source[trailingWhitespaceStart - 1])
    ) {
      trailingWhitespaceStart--;
    }

    const headerTrailingWhitespace =
      source.slice(trailingWhitespaceStart, pos);

    const hadBlankLineAfterForHeader =
      /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
        headerTrailingWhitespace
      );

    if (hadBlankLineAfterForHeader) {
      chunks.push(Buffer.from([0x4f]));
    }

    let firstForBodyItem = true;

    while (true) {
      const whitespaceStart = pos;
      space();

      const bodyWhitespace =
        source.slice(whitespaceStart, pos);

      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
          bodyWhitespace
        );

      if (word('End-For')) {
        if (hasBlankLine) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }
        chunks.push(fixed('End-For'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-For');
      }

      // Standalone block comments are executable-stream records in their
      // own right. They can appear between For-body statements just as they
      // can inside If bodies; preserve their calibrated 0x24 provenance.
      if (source.startsWith('/*', pos)) {
        if (hasBlankLine && !firstForBodyItem) {
          chunks.push(Buffer.from([0x4f]));
        }
        chunks.push(blockComment());
        continue;
      }

      if (hasBlankLine && !firstForBodyItem) {
        chunks.push(Buffer.from([0x4f]));
      }

      firstForBodyItem = false;

      statement();

      space();

      if (source[pos] !== ';') {
        fail('expected ; in For body');
      }

      pos++;
      chunks.push(fixed(';'));
      trailingBlockComments();
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

      if (source.startsWith('/*', pos)) {
        chunks.push(blockComment());
        continue;
      }

      statement();

      space();
      if (source[pos] !== ';') {
        fail('expected ; in While body');
      }

      pos++;
      chunks.push(fixed(';'));
      trailingBlockComments();
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

    const afterThen = pos;
    space();
    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
    } else {
      pos = afterThen;
    }

    // Then body
    while (true) {
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('Else')) {
        /*
        * A blank line immediately before Else is represented by 0x4F before
        * the 0x19 Else opcode.
        */
        if (hasBlankLine) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }

        chunks.push(fixed('Else'));
        break;
      }

      if (word('End-If')) {
        if (hasBlankLine) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }
        chunks.push(fixed('End-If'));
        return;
      }

      if (pos === source.length) {
        fail('expected Else or End-If');
      }

      /*
       * decodeProgram renders 0x4E comments on their own line. Inside an
       * If body, accept that canonical decoded form and re-emit the same
       * 0x4E length-prefixed comment rather than treating it as a statement.
       * The original inline form is still handled by trailingBlockComments()
       * immediately after the preceding semicolon.
       */
      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          chunks.push(Buffer.from([0x4f]));
        }

        chunks.push(blockComment());
        continue;
      }

      if (hasBlankLine) {
        pendingReferenceGroupBoundaries.push(chunks.length);
      }

      statement();

      space();
      if (source[pos] === ';') {
        pos++;
        chunks.push(fixed(';'));
      } else if (!/^End-If\b/i.test(source.slice(pos))) {
        fail('expected ; in If body');
      }
      trailingBlockComments();
    }

    // Else body
    while (true) {
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('End-If')) {
        if (hasBlankLine) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }
        chunks.push(fixed('End-If'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-If');
      }

      /*
       * Same canonical round-trip case as the Then body: a decoded 0x4E
       * comment may appear on its own source line even though the stored
       * token immediately follows the previous semicolon.
       */
      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          chunks.push(Buffer.from([0x4f]));
        }

        chunks.push(blockComment());
        continue;
      }

      if (hasBlankLine) {
        pendingReferenceGroupBoundaries.push(chunks.length);
      }

      statement();

      space();
      if (source[pos] === ';') {
        pos++;
        chunks.push(fixed(';'));
      } else if (!/^End-If\b/i.test(source.slice(pos))) {
        fail('expected ; in Else body');
      }
      trailingBlockComments();
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
          const whitespaceStart = pos;
          space();
          const bodyWhitespace = source.slice(whitespaceStart, pos);
          const hasBlankLine =
            /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

          if (word('End-Evaluate')) {
            if (hasBlankLine) {
              chunks.push(Buffer.from([0x4f]));
            }
            chunks.push(fixed('End-Evaluate'));
            return;
          }

          if (pos === source.length) {
            fail('expected End-Evaluate');
          }

          if (source.startsWith('/*', pos)) {
            chunks.push(blockComment());
            continue;
          }

          statement();

          space();
          if (source[pos] !== ';') {
            fail('expected ; in When-Other body');
          }

          pos++;
          chunks.push(fixed(';'));
          trailingBlockComments();
        }
      }

      if (word('When')) {
        sawWhen = true;
        chunks.push(fixed('When'));

        space();

        // Evaluate clauses commonly spell the selector as `When = value`.
        // The equals sign is part of the clause grammar, not an expression
        // operator, so preserve it before parsing the selector value.
        const selectorOperator = /^(?:<>|<=|>=|=|<|>)/.exec(
          source.slice(pos)
        )?.[0];
        if (selectorOperator !== undefined) {
          pos += selectorOperator.length;
          chunks.push(fixed(selectorOperator));
          space();
        }

        // Our calibrated fixture permits a parenthesized comparison here.
        if (source[pos] === '(') {
          parenthesized(booleanExpression, false);
        } else {
          expression();
        }

        // Confirmed by every When in the fixture.
        chunks.push(Buffer.from([0x2d]));

        let selectorWhitespaceStart = pos;
        while (
          selectorWhitespaceStart > 0 &&
          /\s/.test(source[selectorWhitespaceStart - 1])
        ) {
          selectorWhitespaceStart--;
        }
        if (
          /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
            source.slice(selectorWhitespaceStart, pos)
          )
        ) {
          chunks.push(Buffer.from([0x4f]));
        }

        // Parse this When body until the next clause/end.
        while (true) {
          const whitespaceStart = pos;
          space();

          const bodyWhitespace =
            source.slice(whitespaceStart, pos);

          const hasBlankLine =
            /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
              bodyWhitespace
            );

          if (
            /^When(?:-Other)?\b/i.test(source.slice(pos)) ||
            /^End-Evaluate\b/i.test(source.slice(pos))
          ) {
            if (
              hasBlankLine &&
              /^End-Evaluate\b/i.test(source.slice(pos))
            ) {
              chunks.push(Buffer.from([0x4f]));
            }
            break;
          }

          if (pos === source.length) {
            fail('expected End-Evaluate');
          }

          if (source.startsWith('/*', pos)) {
            if (hasBlankLine) {
              chunks.push(Buffer.from([0x4f]));
            }
            chunks.push(blockComment());
            continue;
          }

          if (hasBlankLine) {
            chunks.push(Buffer.from([0x4f]));
          }

          statement();

          space();

          if (
            source[pos] !== ';' &&
            !/^When(?:-Other)?\b/i.test(source.slice(pos)) &&
            !/^End-Evaluate\b/i.test(source.slice(pos))
          ) {
            fail('expected ; in When body');
          }

          if (source[pos] === ';') {
            pos++;
            chunks.push(fixed(';'));
            trailingBlockComments();
          }
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
  const name =
    /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

  if (!name) {
    return fail('expected a simple call name');
  }

  if (reservedCallNames.has(name.toLowerCase())) {
    fail(`keyword ${name} is not a supported call name`);
  }

  pos += name.length;

  space();

  if (source[pos] !== '(') {
    fail('bare identifiers are only supported as calls');
  }

  chunks.push(
    textOperand(
      INLINE_IDENTIFIER_OPCODE,
      TokenKind.Name,
      name
    )
  );

  /*
   * Calibrated GetSetId behavior:
   *
   * repeated Record.X arguments reuse the existing RECORD PSPCMNAME
   * entry instead of allocating another occurrence.
   *
   * Preserve the previous value because calls may nest.
   */
  const previousReuseRecordReferenceByName =
    reuseRecordReferenceByName;
  const previousReuseRowShorthandRecord =
    reuseRowShorthandRecord;
  const previousCaptureRowsetElementRecord =
    captureRowsetElementRecord;

  if (/^(?:GetSetId|GetRecord|ActiveRowCount|ScrollSelect|RowScrollSelect|Gray|UnGray)$/i.test(name)) {
    reuseRecordReferenceByName = true;
  }
  if (/^CreateRecord$/i.test(name)) {
    reuseRowShorthandRecord = true;
  }
  if (/^CreateRowset$/i.test(name)) {
    captureRowsetElementRecord = true;
  }

  try {
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
  } finally {
    reuseRecordReferenceByName =
      previousReuseRecordReferenceByName;
    reuseRowShorthandRecord =
      previousReuseRowShorthandRecord;
    captureRowsetElementRecord =
      previousCaptureRowsetElementRecord;
  }
};
  const primary = () => {
    space();

    // Bare postfix (...) is calibrated for variable/object indexing such as
    // &rs(1). Do not make every literal/value callable (e.g. True()).
    let allowDirectPostfixCall = source[pos] === '&';
    const baseVariableName =
      /^&[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    const baseApplicationClass =
      baseVariableName === undefined
        ? undefined
        : applicationClassVariables.get(baseVariableName.toLowerCase());

    if (source[pos] === '-') {
      pos++;
      chunks.push(fixed('-'));
      primary();
      return;
    }

    if (source[pos] === '@') {
      pos++;
      chunks.push(fixed('@'));
      space();
      if (source[pos] === '(') {
        parenthesized(expression, false);
      } else {
        primary();
      }
      return;
    }

    if (source[pos] === '%') {
      chunks.push(systemVariable());
      return;
    }

    if (source[pos] === '(') {
      parenthesized(expression, false);
    } else if (/^create\b/i.test(source.slice(pos))) {
      word('create');
      chunks.push(Buffer.from([0x69]));

      space();
      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      // Each calibrated create occurrence gets its own PSPCMNAME PACKAGE row.
      addApplicationClassReference(
        appClass.packagePath,
        appClass.className
      );

      space();
      if (source[pos] !== '(') {
        return fail('expected ( after application class name in create');
      }

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
    } else {
      const identifier =
        /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

      if (identifier && !/^(true|false)$/i.test(identifier)) {
      const tail = source.slice(pos);

      if (/^Record\s*\./i.test(tail)) {
        chunks.push(recordReference());
      } else if (/^Field\s*\./i.test(tail)) {
        chunks.push(fieldReference());
      } else if (/^Scroll\s*\./i.test(tail)) {
        chunks.push(scrollReference());
      } else if (/^Component\s*\./i.test(tail)) {
        chunks.push(componentReference());
      } else if (/^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)) {
        chunks.push(ordinaryRecordFieldReference());
      } else {
        call();

        // A function-call result may itself be invoked/indexed using (...)
        // e.g. GetLevel0()(1).
        allowDirectPostfixCall = true;
      }
      } else {
        chunks.push(value());
      }
    }

    let expectedReferenceMember:
      'record' | 'field' | undefined =
        baseVariableName !== undefined &&
        recordVariables.has(baseVariableName.toLowerCase())
          ? 'field'
          : undefined;

    // Calibrated postfix forms may be chained arbitrarily:
    //   expr.Member / expr.Method(...)
    //   expr[index]       => 0x4C ... 0x4D
    //   expr(args)        => 0x0B ... 0x14 (e.g. Rowset shorthand &rs(1))
    while (true) {
      space();

      if (source[pos] === '.') {
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

        space();

        const isMethodCall = source[pos] === '(';
        const isInlineRowStateMember =
          expectedReferenceMember === 'record' &&
          /^(?:IsNew|IsDeleted|IsChanged)$/i.test(member);
        const hasExistingExpectedReference = references.some(item =>
          expectedReferenceMember === 'record'
            ? (item.kind === 'record' || (isMethodCall && item.kind === 'scroll')) &&
              same(item.recordName, member)
            : expectedReferenceMember === 'field'
              ? item.kind === 'field' && same(item.fieldName, member)
              : false
        );

        if (
          expectedReferenceMember !== undefined &&
          (!isMethodCall || hasExistingExpectedReference) &&
          !isInlineRowStateMember
        ) {
          let reference =
            expectedReferenceMember === 'record' && isMethodCall
              ? references.find(
                  item =>
                    item.kind === 'scroll' &&
                    same(item.recordName, member)
                )
              : expectedReferenceMember === 'record'
              ? rowShorthandRecordsByBase.get(
                  `${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`
                ) ?? rowsetElementRecords.get(member.toLowerCase())
              : recordVariableFields.get(
                  `${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`
                ) ?? (
                  baseVariableName !== undefined &&
                  recordVariables.has(baseVariableName.toLowerCase())
                    ? rowShorthandFields.get(member.toLowerCase())
                    : latestFields.get(member.toLowerCase())
                );

          if (reference === undefined) {
            reference =
              expectedReferenceMember === 'record'
                ? nextReference({
                    kind: 'record',
                    recordName: member
                  })
                : nextReference({
                    kind: 'field',
                    fieldName: member
                  });
          }

          if (
            expectedReferenceMember === 'record' &&
            reference.kind === 'record'
          ) {
            rowShorthandRecords.set(member.toLowerCase(), reference);
            rowShorthandRecordsByBase.set(
              `${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`,
              reference
            );
          } else if (
            expectedReferenceMember === 'field' &&
            baseVariableName !== undefined
          ) {
            recordVariableFields.set(
              `${baseVariableName.toLowerCase()}:${member.toLowerCase()}`,
              reference
            );
            latestFields.set(member.toLowerCase(), reference);
            if (!recordVariables.has(baseVariableName.toLowerCase())) {
              rowShorthandFields.set(member.toLowerCase(), reference);
            }
          }

          chunks.push(Buffer.from([
            0x4a,
            reference.index & 0xff,
            (reference.index >>> 8) & 0xff
          ]));

          /*
          * Row shorthand:
          *
          *   &rs(1).RECORD.FIELD.Value
          *
          * RECORD is followed by FIELD. FIELD then returns us to normal
          * member/property encoding.
          */
          expectedReferenceMember =
            expectedReferenceMember === 'record'
              ? 'field'
              : undefined;

          continue;
        }

        if (isInlineRowStateMember) {
          expectedReferenceMember = undefined;
        }

        chunks.push(
          textOperand(
            INLINE_IDENTIFIER_OPCODE,
            TokenKind.Name,
            member
          )
        );

        if (isMethodCall) {
          if (baseApplicationClass !== undefined) {
            addApplicationClassReference(
              baseApplicationClass.packagePath,
              baseApplicationClass.className,
              member
            );
          }

          const previousReuseRecordReferenceByName =
            reuseRecordReferenceByName;
          if (/^GetRecord$/i.test(member)) {
            reuseRecordReferenceByName = true;
          }
          try {
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
          } finally {
            reuseRecordReferenceByName =
              previousReuseRecordReferenceByName;
          }

          expectedReferenceMember =
            member.toLowerCase() === 'getrecord'
              ? 'field'
              : member.toLowerCase() === 'getrow'
                ? 'record'
                : undefined;
        } else {
          expectedReferenceMember = undefined;
        }

        continue;
      }

      if (source[pos] === '[') {
        pos++;
        chunks.push(Buffer.from([0x4c]));

        expression();
        space();

        if (source[pos] !== ']') {
          return fail('expected ] after array subscript');
        }

        pos++;
        chunks.push(Buffer.from([0x4d]));
        continue;
      }

      if (source[pos] === '(' && allowDirectPostfixCall) {
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

          /*
          * Calibrated Rowset shorthand:
          *
          *   &rs(CurrentRowNumber(1)).RECORD.FIELD
          *
          * The first member after the row selector is a compiled RECORD
          * reference.
          */
          expectedReferenceMember = 'record';

          continue;
        }
      break;
    }
  };
  let sawTopLevelDeclaration = false;
  let closedTopLevelDeclarationSection = false;

  // A leading run of Local declarations is not, by itself, a 0x2D declaration
  // section. Primitive-only fixtures prove that PeopleTools emits no trailing
  // 0x2D and no 0x2D/0x4F transition for ordinary Local declarations.
  //
  // Reference-bearing programs are different: calibrated Record/Field/Rowset/
  // SQL fixtures place 0x2D 0x4F between the leading Local run and the first
  // executable statement. We cannot know whether the program has compiled
  // PSPCMNAME references until parsing has progressed, so remember the chunk
  // insertion point and decide after the full fragment has been parsed.
  let leadingLocalRun = true;
  let sawLeadingLocalDeclaration = false;
  let pendingReferenceLocalBoundary: number | undefined;
  let pendingReferenceLocalMarkers = 1;
  const pendingReferenceGroupBoundaries: number[] = [];
  let haveCompletedTopLevelStatement = false;
  let sawApplicationClassLocalSection = false;
  let closedApplicationClassLocalSection = false;

  while (true) {
    const whitespaceStart = pos;
    space();
    const topLevelWhitespace = source.slice(whitespaceStart, pos);
    const hasBlankLine = /(?:\r?\n)[ \t]*(?:\r?\n)/.test(topLevelWhitespace);

    if (pos === source.length) {
      break;
    }

    if (source.startsWith('/*', pos)) {
      if (
        leadingLocalRun &&
        sawLeadingLocalDeclaration &&
        pendingReferenceLocalBoundary === undefined
      ) {
        pendingReferenceLocalBoundary = chunks.length;
        pendingReferenceLocalMarkers = 0;
        leadingLocalRun = false;
      }
      if (haveCompletedTopLevelStatement && hasBlankLine) {
        /*
        * A comment can occur immediately after a top-level declaration
        * section. Because comments are handled before the normal statement
        * transition logic below, close the declaration section here first.
        *
        * Calibrated:
        *
        *   Declare Function ...;
        *
        *   /* comment *\/
        *
        * => ... 15 2D 4F 24 ...
        */
        if (
          sawTopLevelDeclaration &&
          !closedTopLevelDeclarationSection
        ) {
          chunks.push(Buffer.from([0x2d]));
          closedTopLevelDeclarationSection = true;
        }

        chunks.push(Buffer.from([0x4f]));
      }

      do {
        chunks.push(blockComment());

        const commentWhitespaceStart = pos;
        space();

        const commentWhitespace =
          source.slice(commentWhitespaceStart, pos);

        const hasBlankLineAfterComment =
          /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
            commentWhitespace
          );

        if (hasBlankLineAfterComment) {
          chunks.push(Buffer.from([0x4f]));
        }
      } while (source.startsWith('/*', pos));

      continue;
    }

    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
      continue;
    }

    const isFunction = /^Function\b/i.test(source.slice(pos));
    const isImport = /^import\b/i.test(source.slice(pos));
    const isLocalDeclaration = /^Local\b/i.test(source.slice(pos));
    const isApplicationClassLocal =
      /^Local\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\b/i.test(
        source.slice(pos)
      );
    const isTopLevelDeclaration =
      isImport ||
      /^(?:Global|Component|Constant|Declare\s+Function)\b/i.test(source.slice(pos));


    const closesTopLevelDeclarationSection =
      !isTopLevelDeclaration &&
      !isLocalDeclaration &&
      sawTopLevelDeclaration &&
      !closedTopLevelDeclarationSection;

    if (
      haveCompletedTopLevelStatement &&
      hasBlankLine &&
      !leadingLocalRun &&
      !isTopLevelDeclaration &&
      !closesTopLevelDeclarationSection
    ) {
      const markerCount = Math.max(1, (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1);
      for (let marker = 0; marker < markerCount; marker++) {
        pendingReferenceGroupBoundaries.push(chunks.length);
      }
    }

    if (leadingLocalRun) {
      if (isLocalDeclaration) {
        sawLeadingLocalDeclaration = true;
      } else {
        // This is the first non-Local statement. If the completed program
        // turns out to contain real compiled references, PeopleTools inserts
        // 0x2D 0x4F at this exact boundary.
        if (sawLeadingLocalDeclaration && !isTopLevelDeclaration && pendingReferenceLocalBoundary === undefined) {
          pendingReferenceLocalBoundary = chunks.length;
          pendingReferenceLocalMarkers = Math.max(1, (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1);
        }
        leadingLocalRun = false;
      }
    }


    // An application-class Local starts a Local declaration section. The
    // section may contain following ordinary Local declarations and closes
    // only when the run ends (or at EOF), matching the full fixture.
    if (
      !isLocalDeclaration &&
      sawApplicationClassLocalSection &&
      !closedApplicationClassLocalSection
    ) {
      chunks.push(Buffer.from([0x2d]));
      closedApplicationClassLocalSection = true;
    }

    // Calibrated top-level declaration transition:
    //
    //   Global ... ;
    //   Component ... ;
    //   2D
    //   [4F if executable code follows]
    //
    // A declaration-only program gets only the 2D here; encodeProgram()
    // supplies the final program-directory 07.
    if (closesTopLevelDeclarationSection) {
      chunks.push(Buffer.from([0x2d]));
      const markerCount = Math.max(1, (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1);
      for (let marker = 0; marker < markerCount; marker++) {
        chunks.push(Buffer.from([0x4f]));
      }
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

    if (isImport) {
      // Import is its own declaration section.
      chunks.push(Buffer.from([0x2d]));

      // Import is classified as a top-level declaration only to prevent the
      // generic leading-Local transition logic from firing before it.
      // Its section has already been closed explicitly.
      closedTopLevelDeclarationSection = true;
    } else if (isApplicationClassLocal) {
      sawApplicationClassLocalSection = true;
    } else if (isTopLevelDeclaration) {
      sawTopLevelDeclaration = true;
    }

    haveCompletedTopLevelStatement = true;
  }

  // The implicit owner placeholder alone does not count as a compiled
  // reference. A bound/inferred owner or any additional PSPCMNAME row does.
  const hasCompiledReferences =
    references.length > 1 ||
    references[0]?.recordName !== undefined ||
    references[0]?.fieldName !== undefined;

  console.error({
    hasCompiledReferences,
    references: references.map((r, i) => ({
      i,
      kind: r.kind,
      recordName: r.recordName,
      fieldName: r.fieldName
    })),
    sawLeadingLocalDeclaration,
    leadingLocalRun,
    pendingReferenceLocalBoundary,
    pendingReferenceGroupBoundaries,
    chunkCount: chunks.length
  });

  if (hasCompiledReferences) {
    const insertions: Array<{ index: number; bytes: Buffer[] }> = [];

    if (pendingReferenceLocalBoundary !== undefined) {
      insertions.push({
        index: pendingReferenceLocalBoundary,
        bytes: [
          Buffer.from([0x2d]),
          ...Array.from({ length: pendingReferenceLocalMarkers }, () => Buffer.from([0x4f]))
        ]
      });
    }

    for (const index of pendingReferenceGroupBoundaries) {
      // Do not duplicate the 0x4F already supplied by the leading-Local
      // reference boundary at the same source boundary.
      if (index !== pendingReferenceLocalBoundary) {
        insertions.push({
          index,
          bytes: [Buffer.from([0x4f])]
        });
      }
    }

    // Insert from the end so earlier chunk indexes remain stable.
    insertions.sort((a, b) => b.index - a.index);
    for (const insertion of insertions) {
      chunks.splice(insertion.index, 0, ...insertion.bytes);
    }

  }

  if (
    sawApplicationClassLocalSection &&
    !closedApplicationClassLocalSection
  ) {
    chunks.push(Buffer.from([0x2d]));
  }

  if (sawTopLevelDeclaration && !closedTopLevelDeclarationSection) {
    chunks.push(Buffer.from([0x2d]));
  }

  const finalBytes = Buffer.concat(chunks);

  return {
    bytes: finalBytes,
    references
  };
}

export function encodeFragment(source: string): Buffer {
  return encodeFragmentInternal(source).bytes;
}



interface ApplicationClassProgramMetadata {
  importedPath: string[];
  className: string;
  methodName: string;
  parameters: { name: string; type: string }[];
  returnType?: string;
  signatureComments: string[];
  localVariableName: string;
  localClassPath: string[];
  createClassPath: string[];
  callMethodName: string;
  callArgument: string;
  returnValue: string;
}

function encodeInlineName(value: string): Buffer {
  return textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, value);
}

function encodeKeywordText(value: string): Buffer {
  return textOperand(0x40, TokenKind.Keyword, value);
}

function encodeStringLiteral(value: string): Buffer {
  return textOperand(0x16, TokenKind.StringLiteral, value);
}

function encodeVariableName(value: string): Buffer {
  return textOperand(0x01, TokenKind.Name, value);
}

function encodeApplicationClassPathBytes(path: string[]): Buffer {
  const chunks: Buffer[] = [];

  path.forEach((component, index) => {
    if (index > 0) {
      chunks.push(Buffer.from([0x57]));
    }
    chunks.push(encodeInlineName(component));
  });

  return Buffer.concat(chunks);
}

/**
 * Calibrated Application Package / Application Class subset.
 *
 * This deliberately recognizes only the source shape captured from
 * PeopleTools.  It is separate from ordinary Record/Field event PeopleCode:
 * reference allocation is not yet generalized. A current read-only capture
 * contains a PACKAGE row absent from the earlier owner-only assumption;
 * see docs/APPLICATION_CLASS_SIGNATURES.md before changing allocation rules.
 */
function parseApplicationClassProgram(
  source: string
): ApplicationClassProgramMetadata | undefined {
  if (!/^\s*import\b/i.test(source) || !/\bclass\b/i.test(source)) {
    return undefined;
  }

  const importMatch =
    /^\s*import\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s*;/i.exec(
      source
    );
  if (!importMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class import'
    );
  }

  const classMatch =
    /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s+method\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:Returns\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;\s*end-class\s*;/i.exec(
      source
    );
  if (!classMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class declaration'
    );
  }

  const parameters = classMatch[3].trim() === '' ? [] : classMatch[3].split(',').map(parameter => {
    const match = /^\s*(&[A-Za-z_][A-Za-z0-9_]*)\s+As\s+(string|integer|boolean)\s*$/i.exec(parameter);
    if (!match) throw new UnsupportedPeopleCodeError(0, 'unsupported Application Class parameter');
    return { name: match[1], type: match[2] };
  });

  const implementationMatch =
    /\bmethod\s+([A-Za-z_][A-Za-z0-9_]*)\s*((?:\/\+[\s\S]*?\+\/\s*)+)([\s\S]*?)\bend-method\s*;/i.exec(
      source.slice((classMatch.index ?? 0) + classMatch[0].length)
    );
  if (!implementationMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class method implementation'
    );
  }

  if (implementationMatch[1].toLowerCase() !== classMatch[2].toLowerCase()) {
    throw new UnsupportedPeopleCodeError(
      0,
      'Application Class method declaration/implementation name mismatch'
    );
  }

  const signatureComments = [
    ...implementationMatch[2].matchAll(/\/\+\s*([\s\S]*?)\s*\+\//g)
  ].map(match => match[1].trim());

  const body = implementationMatch[3];

  const localMatch =
    /\bLocal\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s+(&[A-Za-z_][A-Za-z0-9_]*)\s*;/i.exec(
      body
    );
  const createMatch =
    /(&[A-Za-z_][A-Za-z0-9_]*)\s*=\s*create\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s*\(\s*\)\s*;/i.exec(
      body
    );
  const callMatch =
    /(&[A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*"([^"]*)"\s*\)\s*;/i.exec(
      body
    );
  const returnMatch =
    /\bReturn\s+"([^"]*)"\s*(?:;)?/i.exec(body);

  if (!localMatch || !createMatch || !callMatch || !returnMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class method body'
    );
  }

  if (
    localMatch[2].toLowerCase() !== createMatch[1].toLowerCase() ||
    localMatch[2].toLowerCase() !== callMatch[1].toLowerCase()
  ) {
    throw new UnsupportedPeopleCodeError(
      0,
      'Application Class receiver variable mismatch'
    );
  }

  return {
    importedPath: importMatch[1].split(':'),
    className: classMatch[1],
    methodName: classMatch[2],
    parameters,
    returnType: classMatch[4],
    signatureComments,
    localVariableName: localMatch[2],
    localClassPath: localMatch[1].split(':'),
    createClassPath: createMatch[2].split(':'),
    callMethodName: callMatch[2],
    callArgument: callMatch[3],
    returnValue: returnMatch[1]
  };
}

function encodeApplicationClassExecutable(
  metadata: ApplicationClassProgramMetadata
): Buffer {
  const c: Buffer[] = [];

  // import A:B:C;  => 58 path 15 2D 4F
  c.push(Buffer.from([0x58]));
  c.push(encodeApplicationClassPathBytes(metadata.importedPath));
  c.push(Buffer.from([0x15, 0x2d, 0x4f]));

  // class TestClass
  c.push(Buffer.from([0x5a]));
  c.push(encodeInlineName(metadata.className));

  // Method declaration; parameter commas retain source order.
  c.push(Buffer.from([0x63]));
  c.push(encodeInlineName(metadata.methodName));
  c.push(Buffer.from([0x0b]));
  metadata.parameters.forEach((parameter, index) => {
    if (index > 0) c.push(fixed(','));
    c.push(encodeVariableName(parameter.name));
    c.push(Buffer.from([0x35]));
    c.push(encodeKeywordText(parameter.type));
  });
  c.push(Buffer.from([0x14]));
  if (metadata.returnType !== undefined) {
    c.push(Buffer.from([0x39]));
    c.push(encodeKeywordText(metadata.returnType));
  }
  c.push(Buffer.from([0x15]));

  // end-class;
  c.push(Buffer.from([0x5b, 0x15, 0x2d, 0x4f]));

  // method implementation header
  c.push(Buffer.from([0x63, 0x41]));
  c.push(encodeInlineName(metadata.methodName));
  c.push(Buffer.from([0x2d]));

  // /+ ... +/ compiler signature records
  for (const comment of metadata.signatureComments) {
    c.push(textOperand(0x6d, TokenKind.Comment, comment));
  }
  c.push(Buffer.from([0x4f]));

  // Local A:B:C &obj;
  c.push(Buffer.from([0x44]));
  c.push(encodeApplicationClassPathBytes(metadata.localClassPath));
  c.push(encodeVariableName(metadata.localVariableName));
  c.push(Buffer.from([0x15, 0x4f]));

  // &obj = create A:B:C();
  c.push(encodeVariableName(metadata.localVariableName));
  c.push(Buffer.from([0x06, 0x69]));
  c.push(encodeApplicationClassPathBytes(metadata.createClassPath));
  c.push(Buffer.from([0x0b, 0x14, 0x15, 0x4f]));

  // &obj.TestMethod("Input");
  c.push(encodeVariableName(metadata.localVariableName));
  c.push(Buffer.from([0x05]));
  c.push(encodeInlineName(metadata.callMethodName));
  c.push(Buffer.from([0x0b]));
  c.push(encodeStringLiteral(metadata.callArgument));
  c.push(Buffer.from([0x14, 0x15, 0x4f]));

  // Return "Hi" + calibrated Application Class method terminator structure.
  c.push(Buffer.from([0x38]));
  c.push(encodeStringLiteral(metadata.returnValue));
  c.push(Buffer.from([0x64, 0x15, 0x2d]));

  return Buffer.concat(c);
}

function encodeApplicationClassMetadata(
  metadata: ApplicationClassProgramMetadata
): Buffer {
  // Captured trailer begins with owning class path WITHOUT intermediate
  // subpackages from the imported/created dependency:
  //   OU_CORPUS:TestClass\0
  // followed by TestMethod\0.
  const ownerPackage = metadata.importedPath[0];
  const ownerName = `${ownerPackage}:${metadata.className}`;

  const strings = Buffer.concat([
    Buffer.from(ownerName + '\0', 'utf16le'),
    Buffer.from(metadata.methodName + '\0', 'utf16le')
  ]);

  const self = Buffer.alloc(16);
  self.writeUInt32LE(0x400000, 8);
  self.writeUInt32LE(0x07, 12);
  const signature = encodePrimitiveMethodSignature({
    nameOffset: ownerName.length + 1,
    slotOffset: 0,
    parameterTypes: metadata.parameters.map(parameter => parameter.type),
    returnType: metadata.returnType
  });
  return Buffer.concat([strings, self, signature.record, signature.slots]);
}

function encodeApplicationClassProgram(
  metadata: ApplicationClassProgramMetadata
): Buffer {
  const statements = encodeApplicationClassExecutable(metadata);
  const trailer = encodeApplicationClassMetadata(metadata);

  const ownerName =
    `${metadata.importedPath[0]}:${metadata.className}\0`;
  const methodName = `${metadata.methodName}\0`;

  // Captured Application Class header:
  //   @5  executable length including final 0x07
  //   @13 combined UTF-16LE owner-name + method-name byte length
  //   @21 parameter count + 1 dispatch slots
  //   @29 2
  //   @33 0x85
  const header = Buffer.alloc(37);
  header[0] = 0xa0;
  header.writeUInt32LE(0, 1);
  header.writeUInt32LE(statements.length + 1, 5);
  header.writeUInt32LE(0, 9);
  header.writeUInt32LE(
    Buffer.byteLength(ownerName + methodName, 'utf16le'),
    13
  );
  header.writeUInt32LE(0, 17);
  header.writeUInt32LE(metadata.parameters.length + 1, 21);
  header.writeUInt32LE(0, 25);
  header.writeUInt32LE(2, 29);
  header.writeUInt32LE(0x85, 33);

  return Buffer.concat([
    header,
    statements,
    Buffer.from([PROGRAM_DIRECTORY_SEPARATOR]),
    trailer
  ]);
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
export function encodeProgramArtifacts(source: string, context?: EncodeProgramContext): EncodedPeopleCode {
  const applicationClassMetadata = parseApplicationClassProgram(source);

  if (applicationClassMetadata !== undefined) {
    return {
      program: encodeApplicationClassProgram(applicationClassMetadata),
      references: []
    };
  }

  const functionMetadata = parseFunctionMetadata(source);
  const encoded = encodeFragmentInternal(source, context);
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

  const references =
    context === undefined &&
    encoded.references[0]?.kind === 'owner' &&
    encoded.references[0].recordName === undefined &&
    encoded.references[0].fieldName === undefined
      ? encoded.references.slice(1)
      : encoded.references;

  return {
    program,
    references
  };
}

export function encodeProgram(source: string, context?: EncodeProgramContext): Buffer {
  return encodeProgramArtifacts(source, context).program;
}
