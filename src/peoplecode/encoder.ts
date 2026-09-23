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
  kind: 'owner' | 'record-field' | 'package' | 'record' | 'field' | 'scroll' | 'component' | 'declare-function' | 'quoted-reference';
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

export interface ReferenceTraceEvent {
  action: 'ALLOC' | 'USE';

  sourceOffset: number;
  controlGroup: number;

  reference: PeopleCodeReference;
}

export interface EncodeProgramContext {
  owner?: PeopleCodeOwner;

  /**
   * Optional diagnostic hook for PSPCMNAME/reference provenance tracing.
   *
   * This callback is observational only. It must never influence encoding.
   */
  referenceTrace?: (
    event: ReferenceTraceEvent
  ) => void;

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
  if (typeName === '__untyped_parameter__') {
    return 0xc0000004;
  }

  return (0xc0000000 | functionTypeId(typeName)) >>> 0;
}

function encodeFunctionProgramHeader(
  executableLength: number,
  metadata: readonly FunctionMetadata[]
): Buffer {
  // Calibrated 37-byte Function PSPCMPROG header.
  const header = Buffer.alloc(37);

  const nameBytes = metadata.reduce(
    (total, item) =>
      total + Buffer.byteLength(item.name + '\0', 'utf16le'),
    0
  );

  /*
   * Header slot 21 is the total number of signature slots:
   * one return slot per Function plus one slot per parameter.
   *
   * For a single Function this is parameterCount + 1, matching the
   * original calibration. For the 9-function ABS_HIST_UK_SBR fixture,
   * with no parameters, the stored value is 9.
   */
  const signatureSlots = metadata.reduce(
    (total, item) => total + item.parameterTypes.length + 1,
    0
  );

  header[0] = 0xa0;
  header.writeUInt32LE(0, 1);
  header.writeUInt32LE(executableLength, 5);
  header.writeUInt32LE(0, 9);
  header.writeUInt32LE(nameBytes, 13);
  header.writeUInt32LE(0, 17);
  header.writeUInt32LE(signatureSlots, 21);
  header.writeUInt32LE(0, 25);
  header.writeUInt32LE(metadata.length, 29);
  header.writeUInt32LE(0x85, 33);

  return header;
}

function encodeFunctionMetadata(
  metadata: readonly FunctionMetadata[]
): Buffer {
  /*
   * Calibrated Function-directory layout:
   *
   *   [all NUL-terminated UTF-16 Function names]
   *   [one 16-byte directory record per Function]
   *   [parameter slots / 0x00000007 terminators]
   *
   * Each 16-byte record is:
   *
   *   uint32 nameOffsetUtf16
   *   uint32 functionOrdinal
   *   uint32 parameterCount
   *   uint32 returnDescriptor
   *
   * Offset 170 (nine zero-parameter Functions) stores:
   *
   *   [0,   0, 0, 5]
   *   [18,  1, 0, 5]
   *   [30,  2, 0, 5]
   *   ...
   *   [167, 8, 0, 5]
   *   [7, 7, 7, 7, 7, 7, 7, 7, 7]
   *
   * nameOffsetUtf16 is measured in UTF-16 code units, including each prior
   * name's NUL terminator.
   *
   * For a single Function this remains byte-compatible with the previous
   * calibration because nameOffset=0 and functionOrdinal=0.
   */
  const names = metadata.map(
    item => Buffer.from(item.name + '\0', 'utf16le')
  );

  const directory = Buffer.alloc(metadata.length * 16);

  let nameOffsetUtf16 = 0;

  for (let i = 0; i < metadata.length; i++) {
    const item = metadata[i];
    const offset = i * 16;

    directory.writeUInt32LE(nameOffsetUtf16, offset);
    directory.writeUInt32LE(i, offset + 4);
    directory.writeUInt32LE(item.parameterTypes.length, offset + 8);
    directory.writeUInt32LE(
      returnTypeDescriptor(item.returnType),
      offset + 12
    );

    nameOffsetUtf16 += item.name.length + 1;
  }

  /*
   * Signature tails follow all directory records. A zero-parameter Function
   * contributes only 0x00000007. Parameterized Functions contribute their
   * calibrated parameter type slots followed by the same terminator.
   */
  const signatureTails: Buffer[] = [];

  for (const item of metadata) {
    for (const typeName of item.parameterTypes) {
      const parameter = Buffer.alloc(4);
      parameter.writeUInt32LE(
        parameterTypeDescriptor(typeName),
        0
      );
      signatureTails.push(parameter);
    }

    const terminator = Buffer.alloc(4);
    terminator.writeUInt32LE(0x07, 0);
    signatureTails.push(terminator);
  }

  return Buffer.concat([
    ...names,
    directory,
    ...signatureTails
  ]);
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
    if (/^(Record|Field|Rowset|Row|SQL|File|XmlDoc|XmlNode)$/i.test(name)) {
      return textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, name);
    }

    return textOperand(0x40, TokenKind.Keyword, name);
  };

  const localDeclaration = () => {
    lastLocalHadInitializer = false;

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

      const appClassVariable = {
        packagePath: appClass.packagePath,
        className: appClass.className,
        reuseRuntimeCreateForMethods:
          functionDepth === 0 &&
          !(controlDepth === 0 && sawTopLevelExecutableStatement)
      };

      applicationClassVariables.set(
        variableName.toLowerCase(),
        appClassVariable
      );

      if (functionDepth > 0) {
        functionApplicationClassVariables.set(
          variableName.toLowerCase(),
          {
            ...appClassVariable,
            reuseRuntimeCreateForMethods: false
          }
        );
      }

      space();
      if (source[pos] === '=') {
        lastLocalHadInitializer = true;

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

      const elementType =
        /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

      chunks.push(typeName());

      if (/^File$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('FILE', 'File');
      } else if (/^XmlDoc$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('XMLDOC', 'XmlDoc');
      } else if (/^XmlNode$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('XMLNODE', 'XmlNode');
      } else if (/^Record$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('RECORD', 'Record');
      } else if (/^Field$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('FIELD', 'Field');
      } else if (/^Rowset$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('ROWSET', 'Rowset');
      } else if (/^Row$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('ROW', 'Row');
      } else if (/^SQL$/i.test(elementType ?? '')) {
        ensureLocalObjectPackageReference('SQL', 'SQL');
      }
    }

    if (/^Record$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('RECORD', 'Record');
    } else if (/^Field$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('FIELD', 'Field');
    } else if (/^Rowset$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('ROWSET', 'Rowset');
    } else if (/^Row$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('ROW', 'Row');
    } else if (/^SQL$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('SQL', 'SQL');
    } else if (/^File$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('FILE', 'File');
    } else if (/^XmlDoc$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('XMLDOC', 'XmlDoc');
    } else if (/^XmlNode$/i.test(type ?? '')) {
      ensureLocalObjectPackageReference('XMLNODE', 'XmlNode');
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
    } else if (/^Row$/i.test(type ?? '') && firstDeclaredVariable) {
      rowVariables.add(firstDeclaredVariable.toLowerCase());
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
      } else if (/^Row$/i.test(type ?? '') && declaredVariable) {
        rowVariables.add(declaredVariable.toLowerCase());
      }
      chunks.push(variable());
    }

    space();

    if (source[pos] === '=') {
      lastLocalHadInitializer = true;

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

    /*
     * Component declarations may declare multiple variables of the same
     * type, using the ordinary comma punctuation opcode:
     *
     *   Component string &A, &B, &C;
     *
     * => 54 40 "string"
     *    01 "&A"
     *    03 01 "&B"
     *    03 01 "&C"
     */
    space();
    chunks.push(variable());

    while (true) {
      space();

      if (source[pos] !== ',') {
        break;
      }

      pos++;
      chunks.push(fixed(','));

      space();
      chunks.push(variable());
    }
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
    {
      packagePath: string[];
      className: string;
      reuseRuntimeCreateForMethods: boolean;
    }
  >();

  /*
   * Keep Function-local Application Class receiver provenance separate from
   * top-level receiver provenance.
   *
   * Offset 420 requires Function-local method calls on &MYDISPLAY to allocate
   * distinct PACKAGE method rows:
   *
   *   &MYDISPLAY.SetupDisplayTmplt()
   *   &MYDISPLAY.GetChartfieldnrow(...)
   */
  const functionApplicationClassVariables = new Map<
    string,
    {
      packagePath: string[];
      className: string;
      reuseRuntimeCreateForMethods: boolean;
    }
  >();

  const recordVariables = new Set<string>();
  const rowVariables = new Set<string>();

  /*
   * Runtime `create` dependencies are distinct from import dependencies, but
   * repeated creates of the same Application Class share one PSPCMNAME row.
   *
   * Example from ACCOMPLISHMENTS.EMPLID.SavePostChange:
   *
   *   import ...:collProfileItemType;                 // PACKAGE row 11
   *   &a = create ...:collProfileItemType();          // PACKAGE row 21
   *   &b = create ...:collProfileItemType();          // reuses row 21
   *
   * Keep this registry separate from references[] so an import does not
   * suppress the first runtime-create dependency.
   */
  const runtimeCreateReferences = new Map<string, PeopleCodeReference>();

  /*
   * Local object-type declaration PACKAGE dependencies are scoped by the
   * current control group.
   *
   * Same-scope declarations reuse:
   *   Local File &fileWSDL;
   *   ...
   *   Local File &XMLFile;              // same PACKAGE FILE
   *
   * Nested-scope declarations allocate a fresh dependency:
   *   Local Row &row;                   // PACKAGE ROW seq 2
   *   If ...
   *      Local Row &L1Row, &L2Row;      // PACKAGE ROW seq 5
   */
  const localObjectPackageReferences =
    new Map<string, PeopleCodeReference>();

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

    context?.referenceTrace?.({
      action: 'ALLOC',
      sourceOffset: pos,
      controlGroup,
      reference: created
    });

    return created;
  };

  const ensureLocalObjectPackageReference = (
    packageName: string,
    objectName: string
  ): PeopleCodeReference => {
    const key =
      `${controlGroup}:${packageName.toLowerCase()}:${objectName.toLowerCase()}`;

    const existing = localObjectPackageReferences.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const created = nextReference({
      kind: 'package',
      packageName,
      objectName
    });

    localObjectPackageReferences.set(key, created);
    return created;
  };

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

  const ensureRuntimeCreateReference = (
    packagePath: string[],
    className: string
  ): PeopleCodeReference => {
    const key = [
      ...packagePath,
      className
    ].map(component => component.toLowerCase()).join(':');

    const existing = runtimeCreateReferences.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const created = addApplicationClassReference(
      packagePath,
      className
    );

    runtimeCreateReferences.set(key, created);
    return created;
  };

  const applicationClassPath = (
    options?: { allowWildcard?: boolean }
  ): {
    packagePath: string[];
    className: string;
    bytes: Buffer;
    wildcard: boolean;
  } => {
    const components: string[] = [];
    let wildcard = false;

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

      if (options?.allowWildcard && source[pos] === '*') {
        pos++;
        wildcard = true;
        break;
      }

      const componentMatch =
        /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
      if (!componentMatch) {
        return fail('expected application package/class name after :');
      }

      components.push(componentMatch[0]);
      pos += componentMatch[0].length;
    }

    /*
     * Ordinary Application Class paths require at least:
     *
     *   PACKAGE:Class
     *
     * but wildcard imports may target the package root itself:
     *
     *   import HMCF_CHARTFIELDS:*;
     *
     * which stores:
     *
     *   58 0A "HMCF_CHARTFIELDS" 57 59 15
     *
     * and a PACKAGE metadata row with blank REFNAME / QUALIFYPATH.
     */
    if (components.length < 2 && !wildcard) {
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

    if (wildcard) {
      /*
       * Wildcard import suffix:
       *
       *   import ROOT:Path:Leaf:*;
       *
       * stores the normal ':' path separator (0x57) followed by the
       * dedicated wildcard token 0x59. It is not the arithmetic '*' opcode.
       */
      encoded.push(Buffer.from([0x57, 0x59]));
    }

    return {
      packagePath,
      className,
      bytes: Buffer.concat(encoded),
      wildcard
    };
  };

  const referenceOperand = (reference: PeopleCodeReference): Buffer => {
    if (reference.index > 0xffff) {
      throw new UnsupportedPeopleCodeError(
        pos,
        'PeopleCode reference index exceeds uint16 range'
      );
    }

    context?.referenceTrace?.({
      action: 'USE',
      sourceOffset: pos,
      controlGroup,
      reference
    });

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
    let key = `${controlGroup}:${recordName.toLowerCase()}:${fieldName.toLowerCase()}`;
    const statementKey = `${recordName.toLowerCase()}:${fieldName.toLowerCase()}`;
    const existing = ordinaryRecordFieldsByControlGroup.get(key);

    const statementReference = currentStatementRecordFields.get(statementKey);
    if (statementReference !== undefined) {
      return referenceOperand(statementReference);
    }

    if (existing !== undefined) {
      /*
       * At top level, encountering a RECORD.FIELD that has already been used
       * in the current allocation group starts a fresh group.
       *
       * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula,
       * Employee_MA():
       *
       *   ABSENCE_HIST.SHPL_EE_WEEKS.DisplayOnly = True;   // 0x55
       *   ABSENCE_HIST.SHPL_WEEKS.DisplayOnly = True;      // 0x56
       *   ABSENCE_HIST.SHPP_WEEKS.DisplayOnly = True;      // 0x57
       *   ABSENCE_HIST.SHP_EE_WEEKS.DisplayOnly = True;    // 0x58
       *   ABSENCE_HIST.SHPL_EE_WEEKS.DisplayOnly = False;  // 0x59
       *
       * The second SHPL_EE_WEEKS occurrence is not reused as 0x55; it begins
       * a new sequence. Nested control structures retain their existing
       * inControlGroup() behavior.
       *
       * Consecutive field SetDefault() statements are already modeled as one
       * explicit allocation run, so do not split that run merely because a
       * SetDefault field repeats.
       */
      if (controlDepth === 0 && !inTopLevelRecordFieldSetDefaultRun) {
        controlGroup = nextControlGroup++;
        key = `${controlGroup}:${recordName.toLowerCase()}:${fieldName.toLowerCase()}`;
      } else {
        return referenceOperand(existing);
      }
    }

    const reference = nextReference({
      kind: 'record-field',
      recordName,
      fieldName
    });
    ordinaryRecordFieldsByControlGroup.set(key, reference);
    currentStatementRecordFields.set(statementKey, reference);
    return referenceOperand(reference);
  };

  let reuseRecordReferenceByName = false;

  /*
   * Bare GetRecord(Record.X) has a narrower reuse scope than GetSetId.
   * It may reuse a same-name RECORD only inside the current control group.
   */
  let reuseRecordReferenceWithinControlGroup = false;
  const recordReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();
  const ordinaryRecordFieldsByControlGroup = new Map<string, PeopleCodeReference>();
  const currentStatementRecordFields = new Map<string, PeopleCodeReference>();
  const componentReferencesByControlGroup = new Map<string, PeopleCodeReference>();
  let controlDepth = 0;
  let controlGroup = 0;
  let nextControlGroup = 1;

  /*
   * Function-local Application Class instances have distinct PSPCMNAME
   * method dependencies even when the same class already has a runtime-create
   * dependency in the function body.
   *
   * ACCT_CD_TBL.ACCT_CD.FieldFormula (offset 420) proves:
   *
   *   create HMCF_CHARTFIELDS:CHARTFIELD_COMBINATION()  -> runtime row
   *   &MYDISPLAY.SetupDisplayTmplt()                    -> method row
   *   &MYDISPLAY.GetChartfieldnrow(...)                 -> method row
   *
   * Keep this separate from top-level offset-179 behavior.
   */
  let functionDepth = 0;

  /*
   * Ordinary RECORD.FIELD references are grouped by contiguous semantic
   * statement runs. Field.SetDefault() starts a fresh allocation run, but
   * consecutive SetDefault() statements share that run.
   */
  let inTopLevelRecordFieldSetDefaultRun = false;
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

  /*
   * CreateRecord reuse is target-variable AND control-group sensitive.
   *
   * PeopleTools may allocate a new RECORD row when the same Local Record
   * variable is assigned CreateRecord(Record.X) in a later control group.
   * Reuse is therefore limited to the same target variable, record name,
   * and control group.
   *
   * ACCOMPLISHMENTS.EMPLID.SavePostChange:
   *
   *   &recAccTbl = CreateRecord(Record.ACCOMP_TBL);  // RECORD seq 25
   *   ...
   *   &recAccTbl = CreateRecord(Record.ACCOMP_TBL);  // same group: reuses
   *
   * AA_SUMM_JPN_VW.EMPLID.SavePostChange adds the complementary case:
   * a later &REC_JOB = CreateRecord(Record.JOB) in another control group
   * allocates a new RECORD row instead of reusing the top-level JOB row.
   */
  const createRecordReferencesByTarget =
    new Map<string, PeopleCodeReference>();
  let createRecordAssignmentTarget: string | undefined;

  const rowShorthandRecordsByBase = new Map<string, PeopleCodeReference>();
  const recordVariableFields = new Map<string, PeopleCodeReference>();

  /*
   * FIELD references first encountered through declared Local Record
   * variables form their own name-reuse pool.
   *
   * This must stay separate from latestFields: older FIELD references from
   * unrelated record/row contexts may have the same field name but are not
   * reusable here.
   *
   * ACCOMPLISHMENTS.EMPLID.SavePostChange calibrates the behavior:
   *
   *   &recAccomp.ACCOMPLISHMENT.Value   // first declared-Record use: allocate
   *   ...
   *   &recAccTbl.ACCOMPLISHMENT.Value   // later declared-Record use: reuse
   *
   * Both uses point to the same PSPCMNAME FIELD row.
   */
  const declaredRecordFields = new Map<string, PeopleCodeReference>();

  const rowShorthandFields = new Map<string, PeopleCodeReference>();

  /*
   * Explicit qualified chains:
   *
   *   Record.REC.FIELD.Value
   *
   * reuse both the RECORD and FIELD dependencies within one control group,
   * but allocate fresh rows in the next top-level control group.
   *
   * Offset 433 calibrates this across repeated top-level If blocks.
   */
  const explicitRecordReferences =
    new Map<string, PeopleCodeReference>();
  const explicitRecordFields =
    new Map<string, PeopleCodeReference>();

  /*
   * FIELD references reached through a declared Local Row have their own
   * reuse provenance.
   *
   * PeopleTools reuses the same FIELD PSPCMNAME row by field name across
   * different typed Row variables, even when the RECORD differs:
   *
   *   &L1Row.REC_A.LASTUPDDTTM.Value
   *   &L2Row.REC_B.LASTUPDDTTM.Value
   *
   * But a FIELD first encountered through an inline Rowset/GetRow chain does
   * not automatically seed this typed-Row reuse pool. Offset 327 proves that
   * distinction for EMPLID.
   */
  const typedRowFields = new Map<string, PeopleCodeReference>();

  const latestFields = new Map<string, PeopleCodeReference>();
  const resetRecordVariableFields = new Set<string>();

  const recordReference = (
    options: {
      explicitChainReuse?: boolean;
    } = {}
  ): Buffer => {
    if (!word('Record')) return fail('expected Record');
    if (source[pos] !== '.') return fail('expected . after Record');
    pos++;

    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected record name after Record.');
    pos += recordName.length;

    /*
     * Explicit qualified chains:
     *
     *   Record.REC.FIELD.Value
     *
     * Offset 433 proves that the RECORD dependency is reused within the
     * current control group. Keep this opt-in so every previously calibrated
     * Record.X context below retains its existing provenance behavior.
     */
    if (options.explicitChainReuse) {
      const explicitKey =
        `${controlGroup}:${recordName.toLowerCase()}`;

      const existing =
        explicitRecordReferences.get(explicitKey);

      if (existing !== undefined) {
        return referenceOperand(existing);
      }
    }

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
      if (createRecordAssignmentTarget !== undefined) {
        const targetKey =
          `${controlGroup}:${createRecordAssignmentTarget.toLowerCase()}:${recordName.toLowerCase()}`;
        const byTarget = createRecordReferencesByTarget.get(targetKey);

        if (byTarget !== undefined) {
          return referenceOperand(byTarget);
        }
      }

      const existing = rowShorthandRecords.get(recordName.toLowerCase());
      if (existing !== undefined) {
        return referenceOperand(existing);
      }

      const createCount =
        createRecordReferenceCounts.get(recordName.toLowerCase()) ?? 0;
      const previousCreate =
        createRecordReferences.get(recordName.toLowerCase());

      if (createCount >= 2 && previousCreate !== undefined) {
        return referenceOperand(previousCreate);
      }
    }

    if (reuseRecordReferenceWithinControlGroup) {
      const existing = recordReferencesByControlGroup.get(
        `${controlGroup}:${recordName.toLowerCase()}`
      );

      if (existing !== undefined) {
        return referenceOperand(existing);
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

    if (options.explicitChainReuse) {
      explicitRecordReferences.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }

    recordReferencesByControlGroup.set(
      `${controlGroup}:${recordName.toLowerCase()}`,
      reference
    );
    if (reuseRowShorthandRecord) {
      const key = recordName.toLowerCase();

      createRecordReferences.set(key, reference);
      createRecordReferenceCounts.set(
        key,
        (createRecordReferenceCounts.get(key) ?? 0) + 1
      );

      if (createRecordAssignmentTarget !== undefined) {
        createRecordReferencesByTarget.set(
          `${controlGroup}:${createRecordAssignmentTarget.toLowerCase()}:${key}`,
          reference
        );
      }
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

    /*
     * COMPONENT references are name-deduplicated only within the current
     * control group.
     *
     * Offset 166 proves that an outer If and a nested If in the same control
     * group reuse Component.ABS_SHP_LEAVE_GBR.
     *
     * The large ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula capture proves that
     * the same component name is allocated again in later independent control
     * groups; PSPCMNAME contains multiple COMPONENT/ABS_SHP_LEAVE_GBR rows.
     */
    const key = `${controlGroup}:${componentName.toLowerCase()}`;
    const existing = componentReferencesByControlGroup.get(key);

    if (existing !== undefined) {
      return referenceOperand(existing);
    }

    const reference = nextReference({
      kind: 'component',
      objectName: componentName
    });

    componentReferencesByControlGroup.set(key, reference);
    return referenceOperand(reference);
  };

  /*
   * Confirmed PeopleTools 0x48 quoted-name reference qualifiers.
   *
   * Examples:
   *   Operation."GL_JRNL_IMP"
   *   MenuName."HEADCOUNT_(FP)"
   *   BusProcess."SEND_ACA_NOTIFICATION"
   *   BusActivity."SEND_ACA_NOTIFICATION"
   *   BusEvent."Notify Employee"
   *
   * PSPCMNAME stores the qualifier in RECNAME and the quoted value in
   * REFNAME. The compiled statement stream stores:
   *
   *   48 <uint16 little-endian zero-based PSPCMNAME index>
   *
   * Keep this list aligned with the decoder's already-calibrated 0x48
   * qualifier set. Qualifiers outside this set are not guessed.
   */
  const quotedReferenceQualifiers = new Map<string, string>([
    ['operation', 'OPERATION'],
    ['menuname', 'MENUNAME'],
    ['barname', 'BARNAME'],
    ['itemname', 'ITEMNAME'],
    ['page', 'PAGE'],
    ['busprocess', 'BUSPROCESS'],
    ['busactivity', 'BUSACTIVITY'],
    ['busevent', 'BUSEVENT'],
    ['panel', 'PANEL'],
    ['panelgroup', 'PANELGROUP'],
    ['component', 'COMPONENT']
  ]);

  const quotedReference = (): Buffer => {
    const qualifierMatch =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

    if (!qualifierMatch) {
      return fail('expected quoted-reference qualifier');
    }

    const sourceQualifier = qualifierMatch[0];
    const storedQualifier =
      quotedReferenceQualifiers.get(sourceQualifier.toLowerCase());

    if (storedQualifier === undefined) {
      return fail(`unsupported quoted-reference qualifier ${sourceQualifier}`);
    }

    pos += sourceQualifier.length;
    space();

    if (source[pos] !== '.') {
      return fail('expected . after quoted-reference qualifier');
    }

    pos++;
    space();

    const quote = source[pos];
    if (quote !== '"' && quote !== "'") {
      return fail('expected quoted name after quoted-reference qualifier');
    }

    pos++;

    let refName = '';

    while (pos < source.length) {
      const char = source[pos++];

      if (char === quote) {
        if (source[pos] === quote) {
          refName += quote;
          pos++;
          continue;
        }

        /*
         * Quoted 0x48 references are deduplicated by qualifier + quoted value.
         *
         * Calibrated by ACA_XML_WRK.ACA_UPDATE_PB.FieldChange:
         *
         *   MenuName."ACA_SETUP_RPT"
         *   BarName."USE"
         *
         * appear in two separate Transfer() calls but both compiled uses point
         * back to the same PSPCMNAME rows. Different ItemName/Page values in
         * the second call allocate new rows.
         */
        let reference = references.find(
          item =>
            item.kind === 'quoted-reference' &&
            same(item.recordName, storedQualifier) &&
            same(item.fieldName, refName)
        );

        if (reference === undefined) {
          reference = nextReference({
            kind: 'quoted-reference',
            recordName: storedQualifier,
            fieldName: refName
          });
        }

        if (reference.index > 0xffff) {
          return fail('quoted-reference index exceeds uint16 range');
        }

        const bytes = Buffer.alloc(3);
        bytes[0] = 0x48;
        bytes.writeUInt16LE(reference.index, 1);
        return bytes;
      }

      if (char === '\0') {
        return fail('NUL cannot appear in quoted-reference name');
      }

      refName += char;
    }

    return fail('unterminated quoted-reference name');
  };

  const reservedCallNames = new Set([...OPCODES.values()]
    .filter(spec => spec.kind === TokenKind.Keyword && spec.text)
    .map(spec => spec.text!.toLowerCase()));
  // Value is also a real bare 0x0a-introduced conversion call in the
  // corpus; its keyword meaning applies in DLL parameter declarations.
  reservedCallNames.delete('value');
  const fail = (message: string): never => {
    throw new UnsupportedPeopleCodeError(pos, message);
  };
  const space = () => { while (pos < source.length && /\s/.test(source[pos])) pos++; };

  /*
   * Look past one or more standalone block comments to determine what the
   * next significant top-level source item is. This is used only to decide
   * whether a comment is still inside a leading Local declaration run or
   * follows the end of that run.
   */
  const nextSignificantAfterBlockComments = (
    start: number
  ): number => {
    let scan = start;

    while (true) {
      while (
        scan < source.length &&
        /\s/.test(source[scan])
      ) {
        scan++;
      }

      if (!source.startsWith('/*', scan)) {
        return scan;
      }

      const end = source.indexOf('*/', scan + 2);

      if (end < 0) {
        return scan;
      }

      scan = end + 2;
    }
  };
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

  /*
   * PeopleTools stores a REM statement as a 0x24 length-prefixed comment
   * payload containing the complete source text, including its semicolon:
   *
   *   REM &b0k = Default_SHP_setup();
   *
   * Unlike a normal PeopleCode statement, there is no separate 0x15
   * terminator after the payload.
   */

  const disabledCodeComment = (): Buffer => {
    if (!source.startsWith('<*', pos)) {
      return fail('expected <* disabled-code comment');
    }

    const end = source.indexOf('*>', pos + 2);
    if (end < 0) {
      return fail('unterminated <* disabled-code comment');
    }

    /*
     * PeopleTools preserves disabled PeopleCode blocks as one opaque token:
     *
     *   <*
     *      ... arbitrary PeopleCode text ...
     *   *>
     *
     * Offset 431 stores:
     *
     *   55 <uint16 UTF-16 byte length> <complete text including <* and *>>
     *
     * The payload is not tokenized or parsed as PeopleCode.
     */
    const value = source.slice(pos, end + 2);
    pos = end + 2;

    const payload = Buffer.from(value, 'utf16le');
    if (payload.length > 0xffff) {
      throw new UnsupportedPeopleCodeError(
        pos,
        'disabled-code comment exceeds uint16 payload length'
      );
    }

    const bytes = Buffer.alloc(3);
    bytes[0] = 0x55;
    bytes.writeUInt16LE(payload.length, 1);

    return Buffer.concat([bytes, payload]);
  };

  const remComment = (): Buffer => {
    const match = /^REM\b[^\r\n]*/i.exec(source.slice(pos));

    if (!match) {
      return fail('expected REM comment');
    }

    const remText = match[0].replace(/[ \t]+$/g, '');

    if (!remText.endsWith(';')) {
      return fail('expected ; at end of REM comment');
    }

    const payload = Buffer.from(remText, 'utf16le');

    if (payload.length > 0xffff) {
      return fail('REM comment exceeds uint16 byte-length field');
    }

    const header = Buffer.alloc(3);
    header[0] = 0x24;
    header.writeUInt16LE(payload.length, 1);

    pos += match[0].length;

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

    /*
     * PeopleCode Null literal.
     *
     * Calibrated by ACCOMPLISHMENTS.EMPLID.SavePostChange:
     *
     *   &ServiceManager.LocateService("GetPersonProfileId", "1.0", Null)
     *
     * stores the third argument as the single-byte opcode 0x4B.
     */
    if (word('Null')) return Buffer.from([0x4b]);

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
  /*
   * Encode a primary expression together with any PeopleCode application-class
   * cast suffix:
   *
   *   &ServiceManager.LocateService("GetPersonProfileId", "1.0", Null)
   *      As HJPM_PERSON_SERVICES:Person:GetPersonProfileId_v1_0:GetPersonProfileId
   *
   * ACCOMPLISHMENTS.EMPLID.SavePostChange calibrates the compiled form as:
   *
   *   <primary> 35 <application-class-path>
   *
   * where 0x35 is the ordinary `As` opcode and the type path uses the same
   * inline-name / 0x57 separator encoding as an application-class declaration.
   *
   * The cast target establishes a runtime PACKAGE dependency, separate from
   * any import dependency. Repeated runtime references to the same class are
   * deduplicated through the runtime dependency registry.
   */
  const castPrimary = () => {
    primary();

    while (true) {
      const beforeWhitespace = pos;
      space();

      if (!/^As\b/i.test(source.slice(pos))) {
        pos = beforeWhitespace;
        return;
      }

      word('As');
      chunks.push(fixed('As'));

      space();

      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      /*
       * An Application Class `As` cast establishes a runtime PACKAGE
       * dependency for the cast target.
       *
       * ACCOMPLISHMENTS.EMPLID.SavePostChange calibrates the sequence:
       *
       *   create ...ServiceManager()                         -> PACKAGE 16
       *   ... As ...GetPersonProfileId                      -> PACKAGE 17
       *   ... As ...SetPersonProfileContent                 -> PACKAGE 18
       *   ... As ...SetPersonProfileItems                   -> PACKAGE 19
       *   ... As ...DeletePersonProfileItems                -> PACKAGE 20
       *   create ...collProfileItemType()                   -> PACKAGE 21
       *   GetRowset()(&k).ACCOMPLISHMENTS                   -> RECORD 22
       *
       * Imports remain separate PACKAGE dependencies. Reuse the runtime
       * dependency registry so repeated casts/creates of the same class do
       * not create duplicate runtime rows.
       */
      ensureRuntimeCreateReference(
        appClass.packagePath,
        appClass.className
      );
    }
  };

  const expression = () => {
    castPrimary();

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
      castPrimary();
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
    const appClass = applicationClassPath({ allowWildcard: true });
    chunks.push(appClass.bytes);

    /*
     * Import itself establishes one PSPCMNAME PACKAGE dependency row.
     *
     * Ordinary class import:
     *
     *   import ROOT:Path:Class;
     *
     * => PACKAGE row for Class.
     *
     * Wildcard import:
     *
     *   import ROOT:Path:Leaf:*;
     *
     * => PACKAGE row with blank REFNAME, PACKAGEROOT=ROOT and
     *    QUALIFYPATH=Path:Leaf.
     *
     * The reference is metadata-only here; the executable stream contains
     * the 0x58/.../0x57/0x59 import bytes rather than a 0x21 operand.
     */
    if (appClass.wildcard) {
      const fullPath = [
        ...appClass.packagePath,
        appClass.className
      ];

      nextReference({
        kind: 'package',
        packageName: '',
        objectName: fullPath[0]?.toUpperCase(),
        packagePath: fullPath.map(
          (component, index) =>
            index === 0 ? component.toUpperCase() : component
        ),
        className: ''
      });
    } else {
      addApplicationClassReference(
        appClass.packagePath,
        appClass.className
      );
    }
  };

  function statement(): void {
    currentStatementRecordFields.clear();
    /*
     * Field-method SetDefault is a reference-allocation boundary.
     *
     * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
     *
     *   ABSENCE_HIST.SMP_MA_ELIG.DisplayOnly = True;
     *   ABSENCE_HIST.SMP_MA_ELIG.SetDefault();
     *   ABSENCE_HIST.DT_BOOKING_NOTICE.SetDefault();
     *   ...
     *
     * PeopleTools allocates a new PSPCMNAME row for the first
     * SMP_MA_ELIG.SetDefault() even though the same RECORD.FIELD was just
     * referenced by DisplayOnly. Consecutive field SetDefault() calls remain
     * in the same allocation group.
     *
     * Keep this scoped to controlDepth === 0; statements inside If/Evaluate
     * already receive allocation scoping from inControlGroup().
     */
    if (controlDepth === 0) {
      const startsRecordFieldSetDefault =
        /^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*SetDefault\s*\(/i
          .test(source.slice(pos));

      if (startsRecordFieldSetDefault) {
        if (!inTopLevelRecordFieldSetDefaultRun) {
          controlGroup = nextControlGroup++;
          inTopLevelRecordFieldSetDefaultRun = true;
        }
      } else {
        inTopLevelRecordFieldSetDefaultRun = false;
      }
    }

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

        /*
         * A top-level CreateRecord assignment starts a new ordinary
         * RECORD.FIELD reference-allocation group.
         *
         * Calibrated by ABSV_REQUEST.ABSV_APPROVED_FLG.SavePostChange:
         *
         *   &REC1 = CreateRecord(Record.ABSENCE_HIST);
         *   &REC1.emplid.value = ABSV_REQUEST.EMPLID;
         *   ...
         *   &REC2 = CreateRecord(Record.ABSENCE_HIST);
         *   &REC2.emplid.value = ABSV_REQUEST.EMPLID;
         *
         * PeopleTools allocates a fresh PSPCMNAME row for the second
         * ABSV_REQUEST.EMPLID instead of reusing the row from the REC1
         * construction block. Control-structure groups already get their
         * own allocation scope through inControlGroup(), so keep this rule
         * deliberately limited to top-level CreateRecord assignments.
         */
        const assignsCreateRecord =
          /^\s*CreateRecord\b/i.test(source.slice(pos));

        if (assignsCreateRecord && controlDepth === 0) {
          controlGroup = nextControlGroup++;
        }

        if (
          statementVariable !== undefined &&
          recordVariables.has(statementVariable.toLowerCase()) &&
          assignsCreateRecord &&
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

        const previousCreateRecordAssignmentTarget =
          createRecordAssignmentTarget;

        if (
          assignsCreateRecord &&
          statementVariable !== undefined &&
          recordVariables.has(statementVariable.toLowerCase())
        ) {
          createRecordAssignmentTarget = statementVariable;
        } else {
          createRecordAssignmentTarget = undefined;
        }

        try {
          expression();
        } finally {
          createRecordAssignmentTarget =
            previousCreateRecordAssignmentTarget;
        }
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

        const afterVariable = pos;
        space();

        /*
         * Function parameters may be typed:
         *
         *   &value As string
         *
         * or untyped:
         *
         *   &EMPLID
         *
         * The latter is confirmed by
         * ACCOMPLISHMENTS.MAJOR_CODE.SaveEdit.
         */
        if (word('As')) {
          chunks.push(fixed('As'));

          space();
          chunks.push(typeName());
          space();
        } else {
          /*
           * Preserve parser position semantics for the untyped form while
           * still allowing whitespace before ',' or ')'.
           */
          pos = afterVariable;
          space();
        }

        if (source[pos] !== ',') {
          break;
        }

        pos++;
        chunks.push(fixed(','));
        space();
      }
    }, true);

    /*
     * Preserve the whitespace that separates the Function header from its
     * first body item. We must capture it here: the old trailing space()
     * after the return type consumed it before the body loop could inspect it.
     */
    const afterParamsWhitespaceStart = pos;
    space();
    let functionBodyWhitespace =
      source.slice(afterParamsWhitespaceStart, pos);

    // Optional return type.
    if (word('Returns')) {
      chunks.push(fixed('Returns'));

      space();
      chunks.push(typeName());

      const afterReturnWhitespaceStart = pos;
      space();
      functionBodyWhitespace =
        source.slice(afterReturnWhitespaceStart, pos);
    }

    // Confirmed Function header -> body boundary.
    chunks.push(Buffer.from([0x2d]));

    /*
     * A Function header may carry an explicit source semicolon:
     *
     *   Function major_code_ckeck(&EMPLID, &COMPANY);
     *
     * which compiles as:
     *
     *   32 ... 14 2D 15 <body...>
     *
     * 0x2D is the structural header/body boundary and 0x15 preserves the
     * explicit semicolon, matching the same calibrated pattern used by While.
     */
    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));

      const afterHeaderSemicolonWhitespaceStart = pos;
      space();
      functionBodyWhitespace =
        source.slice(afterHeaderSemicolonWhitespaceStart, pos);
    }

    /*
     * Blank formatting lines immediately after a Function header are
     * preserved as 0x4F boundaries. The ordinary newline separating the
     * header from the first body item is not a boundary; each additional
     * newline contributes one 0x4F.
     *
     * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
     *
     *   Function Default_SHP_setup() Returns boolean
     *
     *
     *      ABSENCE_HIST.DT_BOOKING_NOTICE.DisplayOnly = True;
     *
     * which begins its body as: 2D 4F 4F 21 ...
     */
    if (
      /(?:\r?\n)[ \t]*(?:\r?\n)/.test(functionBodyWhitespace)
    ) {
      /*
       * The header/body separator consumes the first newline. Each additional
       * newline in the captured whitespace is preserved as a 0x4F boundary.
       *
       * For:
       *
       *   Function Default_SHP_setup() Returns boolean
       *
       *
       *      ABSENCE_HIST.DT_BOOKING_NOTICE.DisplayOnly = True;
       *
       * the captured whitespace contains three newline characters and
       * PeopleTools stores exactly two markers:
       *
       *   2D 4F 4F 21 ...
       */
      const markerCount = Math.max(
        1,
        (functionBodyWhitespace.match(/\r?\n/g) ?? []).length - 1
      );

      for (let marker = 0; marker < markerCount; marker++) {
        chunks.push(Buffer.from([0x4f]));
      }
    }

    let sawLocalDeclaration = false;
    let enteredExecutableSection = false;

    functionDepth++;

    if (functionDepth === 1) {
      functionApplicationClassVariables.clear();
    }

    while (true) {
      const bodyWhitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(bodyWhitespaceStart, pos);

      /*
       * Once a Function is in its executable section, blank formatting lines
       * between top-level body statements are preserved as 0x4F boundaries.
       *
       * The ordinary newline between statements is not a marker; each
       * additional newline contributes one 0x4F.
       *
       * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
       *
       *   ABSENCE_HIST.SMP_END_DATE.DisplayOnly = False;
       *
       *   If ABSENCE_HIST.PARTNER_DEC = "Y" Then
       *
       * which stores:
       *
       *   ... 06 30 15 4F 1C ...
       */
      if (
        enteredExecutableSection &&
        !/^End-Function\b/i.test(source.slice(pos)) &&
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace)
      ) {
        const markerCount = Math.max(
          1,
          (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
        );

        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
      }

      if (word('End-Function')) {
        /*
         * Blank formatting lines immediately before End-Function are
         * preserved as 0x4F boundaries.
         *
         * ACCOMPLISHMENTS.MAJOR_CODE.SaveEdit:
         *
         *   End-If;
         *
         *   End-Function;
         *
         * stores:
         *
         *   ... 1A 15 4F 37 15 ...
         */
        if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace)) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }

        chunks.push(fixed('End-Function'));

        space();

        if (source[pos] !== ';') {
          fail('expected ; after End-Function');
        }

        pos++;
        chunks.push(fixed(';'));

        // Confirmed Function-definition boundary.
        chunks.push(Buffer.from([0x2d]));

        functionDepth--;

        if (functionDepth === 0) {
          functionApplicationClassVariables.clear();
        }

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
      const whitespaceStart = pos;
      space();
      const tryWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(tryWhitespace);

      if (word('catch')) {
        /*
         * A blank formatting line immediately before catch is preserved as
         * one or more 0x4F source-group boundaries.
         *
         * ACA_ACK_RUNCTL.ACA_ATTACHADD.FieldChange:
         *
         *   &nReturn = GetAttachment(...);
         *
         *   catch Exception &ef1;
         *
         * stores:
         *
         *   ... 15 4F 66 ...
         */
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (tryWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }

        chunks.push(fixed('catch'));

        space();

        /*
         * Catch exception types may be either a simple type name or a fully
         * qualified Application Class path.
         *
         * Calibrated by ACCOMPLISHMENTS.EMPLID.SavePostChange:
         *
         *   catch HMCR_FRAMEWORK:ServiceFramework:baseClasses:baseException &ex1;
         *
         * Compiles as:
         *
         *   66
         *   0A "HMCR_FRAMEWORK"
         *   57 0A "ServiceFramework"
         *   57 0A "baseClasses"
         *   57 0A "baseException"
         *   01 "&ex1"
         *   2D 15
         *
         * The exception type path itself is executable-stream metadata and
         * does not allocate another PSPCMNAME dependency row here.
         */
        const qualifiedCatchType =
          /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/
            .test(source.slice(pos));

        if (qualifiedCatchType) {
          const exceptionClass = applicationClassPath();
          chunks.push(exceptionClass.bytes);
        } else {
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
        }

        space();

        chunks.push(variable());

        // Confirmed catch-header -> body boundary.
        chunks.push(Buffer.from([0x2d]));

        /*
         * Catch-header semicolon handling is source-dependent.
         *
         * ACCOMPLISHMENTS.EMPLID.SavePostChange contains:
         *
         *   catch HMCR_FRAMEWORK:ServiceFramework:baseClasses:baseException &ex1;
         *
         * and its compiled stream contains:
         *
         *   ... 01 "&ex1" 2D 15 ...
         *
         * Earlier calibrated try/catch fixtures omit the source semicolon and
         * likewise have no 0x15 at this position. Therefore the semicolon is
         * optional here and must be emitted only when it is present in source.
         */
        space();

        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

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
     * A For header may carry an explicit source semicolon:
     *
     *   For &I = 1 To &ACTIVE_ROW_L2;
     *
     * PeopleTools stores:
     *
     *   29 <init> 2A <limit> 2D 15 <body...>
     *
     * The 0x2D remains the structural header/body boundary; 0x15 preserves
     * the explicit source semicolon.
     */
    let explicitHeaderSemicolon = false;

    if (source[pos] === ';') {
      explicitHeaderSemicolon = true;
      pos++;
      chunks.push(fixed(';'));
    }

    /*
     * Determine the whitespace that separates the completed For header from
     * its first body item.
     *
     * Without an explicit header semicolon, expression() may already have
     * consumed this whitespace, so recover it by scanning backward.
     *
     * With an explicit semicolon:
     *
     *   For &I = 1 To &RS.RowCount;
     *
     *      &Row = ...
     *
     * the significant whitespace begins AFTER the semicolon. Consume it
     * directly so the blank formatting line produces the stored 0x4F:
     *
     *   ... 2D 15 4F <body>
     */
    let headerTrailingWhitespace: string;

    if (explicitHeaderSemicolon) {
      const afterHeaderSemicolonWhitespaceStart = pos;
      space();
      headerTrailingWhitespace =
        source.slice(afterHeaderSemicolonWhitespaceStart, pos);
    } else {
      let trailingWhitespaceStart = pos;

      while (
        trailingWhitespaceStart > 0 &&
        /\s/.test(source[trailingWhitespaceStart - 1])
      ) {
        trailingWhitespaceStart--;
      }

      headerTrailingWhitespace =
        source.slice(trailingWhitespaceStart, pos);
    }

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
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
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
      if (source.startsWith('<*', pos)) {
        if (hasBlankLine && !firstForBodyItem) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }

        chunks.push(disabledCodeComment());
        continue;
      }

      if (source.startsWith('/*', pos)) {
        if (hasBlankLine && !firstForBodyItem) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }
        chunks.push(blockComment());
        continue;
      }

      if (hasBlankLine && !firstForBodyItem) {
        /*
         * Preserve every blank formatting line between For-body constructs.
         * One ordinary newline is line separation; each additional newline
         * contributes one 0x4F.
         *
         * Offset 420:
         *
         *   End-If;
         *
         *
         *   &THISDISPLAYROW = ...
         *
         * stores:
         *
         *   ... 1A 15 4F 4F 01 ...
         */
        const markerCount = Math.max(
          1,
          (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
        );

        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
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

    /*
     * Confirmed While header encoding:
     *
     *   While <condition>;
     *
     * compiles as:
     *
     *   <condition> 0x2D 0x15 <body...>
     *
     * 0x2D is the structural condition/body boundary and 0x15 is the
     * explicit source semicolon.
     */
    chunks.push(Buffer.from([0x2d]));

    const afterWhileCondition = pos;
    space();
    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
    } else {
      pos = afterWhileCondition;
    }

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
      if (source.startsWith('<*', pos)) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }

        chunks.push(disabledCodeComment());
        continue;
      }

      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          chunks.push(Buffer.from([0x4f]));
        }

        chunks.push(blockComment());
        continue;
      }

      /*
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path.
       */
      if (/^REM\b/i.test(source.slice(pos))) {
        if (hasBlankLine) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }

        chunks.push(remComment());
        continue;
      }

      if (hasBlankLine) {
        /*
         * Inside an If body, PeopleTools preserves each blank formatting
         * line between executable constructs as a 0x4F source-group
         * boundary. One ordinary newline is just line separation; each
         * additional newline contributes one 0x4F.
         *
         * Keep these deferred because this structural marker is calibrated
         * only for programs that actually have compiled references.
         */
        const markerCount = Math.max(
          1,
          (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
        );

        for (let marker = 0; marker < markerCount; marker++) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }
      }

      statement();

      space();

      /*
       * PeopleTools can place an inline/trailing block comment before the
       * statement terminator:
       *
       *   FIELD = 0 [block comment];
       *
       * Stored shape:
       *   ... value 4E <comment> 15
       *
       * decodeProgram() may render the same 0x4E comment on its own line
       * before the semicolon, so accept that canonical form here as well.
       */
      while (source.startsWith('/*', pos)) {
        chunks.push(inlineBlockComment());
        space();
      }

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
      if (source.startsWith('<*', pos)) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }

        chunks.push(disabledCodeComment());
        continue;
      }

      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          chunks.push(Buffer.from([0x4f]));
        }

        chunks.push(blockComment());
        continue;
      }

      /*
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path.
       */
      if (/^REM\b/i.test(source.slice(pos))) {
        if (hasBlankLine) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }

        chunks.push(remComment());
        continue;
      }

      if (hasBlankLine) {
        /*
         * Inside an If body, PeopleTools preserves each blank formatting
         * line between executable constructs as a 0x4F source-group
         * boundary. One ordinary newline is just line separation; each
         * additional newline contributes one 0x4F.
         *
         * Keep these deferred because this structural marker is calibrated
         * only for programs that actually have compiled references.
         */
        const markerCount = Math.max(
          1,
          (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
        );

        for (let marker = 0; marker < markerCount; marker++) {
          pendingReferenceGroupBoundaries.push(chunks.length);
        }
      }

      statement();

      space();

      while (source.startsWith('/*', pos)) {
        chunks.push(inlineBlockComment());
        space();
      }

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

          if (source.startsWith('<*', pos)) {
            if (hasBlankLine) {
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            }

            chunks.push(disabledCodeComment());
            continue;
          }

          if (source.startsWith('/*', pos)) {
            if (hasBlankLine) {
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            }

            chunks.push(blockComment());
            continue;
          }

          /*
           * When-Other uses the same body-spacing rule as an ordinary When:
           * one normal newline separates the clause header from its body;
           * each additional blank formatting line contributes one 0x4F.
           *
           * This is a grammar-level Evaluate-body rule, not a fixture special
           * case. Offset 171 calibrates:
           *
           *   When-Other
           *
           *      &b0k = Employee_blank_mat_pay_det();
           *
           * Stored:
           *   3E 4F 01 ...
           */
          if (hasBlankLine) {
            const markerCount = Math.max(
              1,
              (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
            );

            for (let marker = 0; marker < markerCount; marker++) {
              chunks.push(Buffer.from([0x4f]));
            }
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
            /*
             * Blank formatting lines between a completed When body and the
             * next When / When-Other clause are preserved as 0x4F markers.
             *
             * One ordinary newline is clause separation; each additional
             * newline contributes one 0x4F. Offset 169 calibrates both:
             *
             *   Break;
             *
             *   When = "B"       -> one 0x4F
             *
             * and:
             *
             *   Break;
             *
             *
             *   When-Other       -> two 0x4F
             */
            if (
              hasBlankLine &&
              /^When(?:-Other)?\b/i.test(source.slice(pos))
            ) {
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            } else if (
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

          if (source.startsWith('<*', pos)) {
            if (hasBlankLine) {
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            }

            chunks.push(disabledCodeComment());
            continue;
          }

          if (source.startsWith('/*', pos)) {
            if (hasBlankLine) {
              /*
               * Inside a When body, PeopleTools preserves multiple blank-line
               * group boundaries before a standalone comment. One 0x4F is
               * emitted for each blank line beyond the ordinary line break.
               *
               * Example: three newline separators before the comment produce
               * two 0x4F markers.
               */
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            }

            chunks.push(blockComment());
            continue;
          }

          /*
           * REM inside an Evaluate/When body uses the same calibrated
           * length-prefixed 0x24 representation as REM in an If body.
           *
           * Offset 171:
           *
           *   &bok = Employee_Elig_SMP();
           *   rem &bok = Employee_MatDetails_default();
           *   &bok1 = Calculate_smp_weeks();
           *
           * Stored shape after the first call's 0x15 terminator:
           *
           *   24 <uint16 byte length> <UTF-16LE full REM text including ;>
           *
           * There is no separate 0x15 for the REM statement.
           */
          if (/^REM\b/i.test(source.slice(pos))) {
            if (hasBlankLine) {
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            }

            chunks.push(remComment());
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

  /*
   * Calibrated top-level SetDefault behavior:
   *
   *   UnGray(R.F1);
   *   ...
   *   SetDefault(R.F2);
   *   SetDefault(R.F1);
   *   R.F3 = ...;
   *
   * PeopleTools starts a fresh ordinary RECORD.FIELD allocation group at a
   * top-level SetDefault call. References encountered after that point do not
   * reuse same-name rows allocated by the preceding top-level statement run.
   *
   * Keep this scoped to bare top-level SetDefault calls. Calls inside If /
   * Evaluate / other control structures already live inside an inControlGroup()
   * allocation scope.
   */
  if (/^SetDefault$/i.test(name) && controlDepth === 0) {
    controlGroup = nextControlGroup++;
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
  const previousReuseRecordReferenceWithinControlGroup =
    reuseRecordReferenceWithinControlGroup;
  const previousReuseRowShorthandRecord =
    reuseRowShorthandRecord;
  const previousCaptureRowsetElementRecord =
    captureRowsetElementRecord;

  if (/^(?:GetSetId|ActiveRowCount|ScrollSelect|RowScrollSelect|Gray|UnGray)$/i.test(name)) {
    reuseRecordReferenceByName = true;
  }

  if (/^GetRecord$/i.test(name)) {
    reuseRecordReferenceWithinControlGroup = true;
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
    reuseRecordReferenceWithinControlGroup =
      previousReuseRecordReferenceWithinControlGroup;
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
        : (
            functionDepth > 0
              ? functionApplicationClassVariables.get(
                  baseVariableName.toLowerCase()
                )
              : undefined
          ) ??
          applicationClassVariables.get(baseVariableName.toLowerCase());

    /*
     * Track Application Class method provenance only while the postfix chain
     * is still operating directly on the typed root variable.
     *
     *   &ServiceManager.LocateService(...)       -> method dependency
     *
     * but:
     *
     *   &collItemType.ProfileItemElements.Push(...)
     *
     * traverses the ProfileItemElements property first, so Push() is a method
     * on that returned collection/object, not on collProfileItemType itself.
     * PeopleTools does not allocate a collProfileItemType.Push PSPCMNAME row.
     */
    let activeApplicationClassReceiver = baseApplicationClass;

    /*
     * Track an explicit Record.REC root through the postfix parser so its
     * next dotted identifier is encoded as a FIELD PSPCMNAME operand rather
     * than an inline member name.
     */
    let explicitRecordRootName: string | undefined;

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

      /*
       * The first runtime create of an Application Class establishes a new
       * PACKAGE dependency row even when that class was already imported.
       * Later creates of the same class reuse that runtime dependency.
       */
      ensureRuntimeCreateReference(
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

      if (identifier && !/^(true|false|null)$/i.test(identifier)) {
      const tail = source.slice(pos);

      if (/^Record\s*\./i.test(tail)) {
        /*
         * Preserve the long-standing Record.X provenance rules.
         *
         * Offset 433 adds a narrower form:
         *
         *   Record.REC.FIELD.Value
         *
         * Only that explicit RECORD -> FIELD chain reuses the RECORD
         * dependency inside the current control group.
         *
         * A bare Record.X expression, including usages such as:
         *
         *   CreateRecord(Record.JOB)
         *   GetRecord(Record.X)
         *
         * must continue through the previously calibrated occurrence /
         * target / control-group rules in recordReference().
         *
         * Offset 23 is the regression guard for this distinction.
         */
        const explicitRecordFieldChain =
          /^Record\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/i
            .exec(tail);

        if (explicitRecordFieldChain) {
          explicitRecordRootName =
            explicitRecordFieldChain[1];

          chunks.push(
            recordReference({
              explicitChainReuse: true
            })
          );
        } else {
          chunks.push(
            recordReference()
          );
        }
      } else if (/^Field\s*\./i.test(tail)) {
        chunks.push(fieldReference());
      } else if (/^Scroll\s*\./i.test(tail)) {
        chunks.push(scrollReference());
      } else if (/^Component\s*\./i.test(tail)) {
        chunks.push(componentReference());
      } else if (
        /^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*["']/.test(tail) &&
        quotedReferenceQualifiers.has(identifier.toLowerCase())
      ) {
        chunks.push(quotedReference());
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

    /*
     * A typed Row variable has two distinct postfix forms:
     *
     *   &row.RowNumber
     *   &row.IsDeleted
     *
     * are ordinary Row properties/state members and remain inline names.
     *
     * But a record/field chain rooted at a Row:
     *
     *   &row.RECORD.FIELD.Value
     *
     * compiles RECORD and FIELD through PSPCMNAME (0x4A operands).
     *
     * Therefore a Row variable enters reference-member mode only when the
     * source structurally has at least two dotted identifiers following the
     * Row variable. This preserves ordinary single-member Row properties.
     */
    const rowStartsRecordFieldChain =
      baseVariableName !== undefined &&
      rowVariables.has(baseVariableName.toLowerCase()) &&
      /^\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/
        .test(source.slice(pos));

    let expectedReferenceMember:
      'record' | 'field' | undefined =
        explicitRecordRootName !== undefined
          ? 'field'
          : rowStartsRecordFieldChain
            ? 'record'
            : baseVariableName !== undefined &&
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
            expectedReferenceMember === 'field' &&
            explicitRecordRootName !== undefined
              ? explicitRecordFields.get(
                  `${controlGroup}:${explicitRecordRootName.toLowerCase()}:${member.toLowerCase()}`
                )
              : expectedReferenceMember === 'record' && isMethodCall
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
                  `${controlGroup}:${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`
                ) ?? (
                  baseVariableName !== undefined &&
                  recordVariables.has(baseVariableName.toLowerCase())
                    ? (
                        /*
                         * FIELD references reached through declared Record
                         * variables are name-reusable across Record variables
                         * within the current control group.
                         *
                         * ACCOMPLISHMENTS.EMPLID.SavePostChange:
                         *
                         *   &recAccomp.ACCOMPLISHMENT.Value
                         *   ...
                         *   &recAccTbl = CreateRecord(Record.ACCOMP_TBL);
                         *   &recAccTbl.ACCOMPLISHMENT.Value = ...
                         *
                         * Both uses point to the same PSPCMNAME FIELD
                         * ACCOMPLISHMENT row.
                         *
                         * AA_SUMM_JPN_VW.EMPLID.SavePostChange adds a second
                         * proven provenance bridge:
                         *
                         *   &RS(...).AA_ONE_JPN_VW.ACTION_REASON_JPN.Value
                         *   ...
                         *   &Kenmu_Dtl_Rec.ACTION_REASON_JPN.Value
                         *
                         * The later declared Record variable reuses the FIELD
                         * first established through row shorthand. Therefore:
                         *
                         *   1. prefer the per-variable binding;
                         *   2. then the declared-Record field pool;
                         *   3. then the row-shorthand field pool;
                         *   4. otherwise allocate.
                         *
                         * Do NOT fall back to latestFields here: offset 380
                         * proved that an unrelated older same-name FIELD must
                         * not be reused merely because it is the latest one.
                         *
                         * AA_SUMM_JPN_VW.EMPLID.SavePostChange further proves
                         * these FIELD bindings are control-group scoped:
                         * ACTION is FIELD sequence 11 in the first block and
                         * FIELD sequence 23 in the later insert-row block.
                         */
                        declaredRecordFields.get(
                          `${controlGroup}:${member.toLowerCase()}`
                        ) ??
                        rowShorthandFields.get(
                          `${controlGroup}:${member.toLowerCase()}`
                        )
                      )
                    : baseVariableName !== undefined &&
                      rowVariables.has(baseVariableName.toLowerCase())
                      ? typedRowFields.get(member.toLowerCase())
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
            expectedReferenceMember === 'field' &&
            explicitRecordRootName !== undefined &&
            reference.kind === 'field'
          ) {
            explicitRecordFields.set(
              `${controlGroup}:${explicitRecordRootName.toLowerCase()}:${member.toLowerCase()}`,
              reference
            );
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
              `${controlGroup}:${baseVariableName.toLowerCase()}:${member.toLowerCase()}`,
              reference
            );
            latestFields.set(member.toLowerCase(), reference);

            if (rowVariables.has(baseVariableName.toLowerCase())) {
              typedRowFields.set(member.toLowerCase(), reference);
            } else if (recordVariables.has(baseVariableName.toLowerCase())) {
              declaredRecordFields.set(
                `${controlGroup}:${member.toLowerCase()}`,
                reference
              );
            } else {
              rowShorthandFields.set(
                `${controlGroup}:${member.toLowerCase()}`,
                reference
              );
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
          if (activeApplicationClassReceiver !== undefined) {
            const classKey = [
              ...activeApplicationClassReceiver.packagePath,
              activeApplicationClassReceiver.className
            ].map(component => component.toLowerCase()).join(':');

            /*
             * Leading/declaration-phase instances created in this program may
             * reuse their runtime-create dependency for method calls; offset
             * 179 has no separate method PSPCMNAME row.
             *
             * Offset 411 proves the complementary case: a late initialized
             * Application Class Local, after top-level executable code has
             * begun, stores both the runtime-create dependency and a distinct
             * method dependency.
             */
            if (
              !runtimeCreateReferences.has(classKey) ||
              !activeApplicationClassReceiver.reuseRuntimeCreateForMethods
            ) {
              addApplicationClassReference(
                activeApplicationClassReceiver.packagePath,
                activeApplicationClassReceiver.className,
                member
              );
            }
          }

          /*
           * We do not currently have return-type metadata for arbitrary
           * Application Class methods, so the result of a call cannot safely
           * retain the root receiver's class provenance.
           */
          activeApplicationClassReceiver = undefined;

          const previousReuseRecordReferenceByName =
            reuseRecordReferenceByName;
          const previousReuseRecordReferenceWithinControlGroup =
            reuseRecordReferenceWithinControlGroup;

          if (/^GetRecord$/i.test(member)) {
            reuseRecordReferenceWithinControlGroup = true;
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
            reuseRecordReferenceWithinControlGroup =
              previousReuseRecordReferenceWithinControlGroup;
          }

          expectedReferenceMember =
            member.toLowerCase() === 'getrecord'
              ? 'field'
              : member.toLowerCase() === 'getrow'
                ? 'record'
                : undefined;
        } else {
          /*
           * A property/member traversal changes the receiver. Without
           * property-type metadata, any later method in the chain must not be
           * attributed to the original Application Class variable.
           */
          activeApplicationClassReceiver = undefined;
          expectedReferenceMember = undefined;
        }

        continue;
      }

      if (source[pos] === '[') {
        activeApplicationClassReceiver = undefined;

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
  let lastLocalHadInitializer = false;
  let pendingReferenceLocalBoundary: number | undefined;
  let pendingReferenceLocalMarkers = 1;
  const pendingReferenceGroupBoundaries: number[] = [];
  let haveCompletedTopLevelStatement = false;

  /*
   * Tracks whether ordinary executable top-level code has begun.
   *
   * A leading Application Class Local participates in its calibrated Local
   * declaration section. The same syntax encountered later, after executable
   * statements have started, must not reopen a declaration section merely
   * because it begins with Local.
   */
  let sawTopLevelExecutableStatement = false;

  /*
   * Consecutive top-level imports form one declaration section, even when
   * standalone block comments appear between import groups. PeopleTools emits
   * a single 0x2D when that complete import section ends, not one after each
   * import.
   */
  let importSectionOpen = false;

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

    if (source.startsWith('<*', pos)) {
      if (haveCompletedTopLevelStatement && hasBlankLine) {
        const markerCount = Math.max(
          1,
          (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
        );

        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
      }

      chunks.push(disabledCodeComment());
      haveCompletedTopLevelStatement = true;
      leadingLocalRun = false;
      continue;
    }

    if (source.startsWith('/*', pos)) {
      const afterComments =
        nextSignificantAfterBlockComments(pos);

      const nextIsLocal =
        /^Local\b/i.test(source.slice(afterComments));

      /*
       * A standalone block comment does not, by itself, terminate the
       * leading Local declaration run.
       *
       * Example:
       *   Local ...;
       *   [block comment]
       *   Local ...;
       *
       * keeps the comment inside the Local section.
       *
       * But when the comment sequence follows the final Local declaration,
       * PeopleTools closes the Local section before the comment:
       *
       *   Local ...;
       *   [block comment]
       *   executable...
       *
       * Stored shape: ... 15 2D 4F 24 ...
       */
      if (
        leadingLocalRun &&
        sawLeadingLocalDeclaration &&
        !nextIsLocal &&
        pendingReferenceLocalBoundary === undefined
      ) {
        pendingReferenceLocalBoundary = chunks.length;

        /*
         * The ordinary top-level blank-line/comment handling below emits
         * the 0x4F. If this program ultimately has compiled references, the
         * deferred Local-section insertion therefore contributes only 0x2D.
         */
        pendingReferenceLocalMarkers = 0;
        leadingLocalRun = false;
      }

      if (haveCompletedTopLevelStatement && hasBlankLine) {
        /*
         * A comment can occur immediately after a top-level declaration
         * section. Because comments are handled before the normal statement
         * transition logic below, close the declaration section here first.
         *
         * The declaration/comment boundary preserves the same blank-line
         * multiplicity as other calibrated top-level boundaries: the first
         * newline is the ordinary line separator and each additional newline
         * contributes one 0x4F.
         *
         * Examples:
         *
         *   Declare Function ...;
         *
         *   /* comment *\/
         *
         * => ... 15 2D 4F 24 ...
         *
         * Offset 314 has two blank formatting lines before the comment and
         * stores ... 15 2D 4F 4F 24 ... .
         */
        if (
          sawTopLevelDeclaration &&
          !closedTopLevelDeclarationSection
        ) {
          chunks.push(Buffer.from([0x2d]));
          closedTopLevelDeclarationSection = true;
        }

        const markerCount = Math.max(
          1,
          (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
        );

        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
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
          /*
           * PeopleTools preserves each blank formatting line after a
           * standalone top-level block comment as a 0x4F boundary.
           *
           * One ordinary newline separates the comment from the next
           * source item; each additional newline contributes one 0x4F.
           */
          const markerCount = Math.max(
            1,
            (commentWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }
      } while (source.startsWith('/*', pos));

      continue;
    }

    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
      continue;
    }

    /*
     * A top-level REM statement uses the same calibrated representation as
     * REM inside If/Evaluate bodies:
     *
     *   0x24 <uint16 UTF-16 byte length> <complete REM text including ;>
     *
     * The semicolon is part of the payload, so there is no trailing 0x15.
     * Consume it here, before the ordinary statement/terminator path.
     */
    if (/^REM\b/i.test(source.slice(pos))) {
      chunks.push(remComment());
      haveCompletedTopLevelStatement = true;
      leadingLocalRun = false;
      continue;
    }

    const isFunction = /^Function\b/i.test(source.slice(pos));
    const isImport = /^import\b/i.test(source.slice(pos));
    const isLocalDeclaration = /^Local\b/i.test(source.slice(pos));

    /*
     * Proven top-level block statements may terminate directly at EOF
     * without a source semicolon.
     *
     * Keep these classifications before statement() consumes the source.
     */
    const isIfStatement =
      /^If\b/i.test(source.slice(pos));

    const isEvaluateStatement =
      /^Evaluate\b/i.test(source.slice(pos));

    /*
     * Offset 425 proves that a plain top-level assignment may omit its
     * semicolon at EOF:
     *
     *   RECORD.FIELD.Value = OTHER.FIELD.Value
     *
     * Keep this classification deliberately narrow so statement forms such
     * as:
     *
     *   Return True
     *
     * still fail without an explicit semicolon.
     */
    const startsTopLevelAssignment =
      (
        source[pos] === '&' ||
        source[pos] === '@' ||
        /^[A-Za-z_][A-Za-z0-9_]*\s*\./.test(source.slice(pos))
      ) &&
      /=/.test(source.slice(pos));
    const isApplicationClassLocal =
      /^Local\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\b/i.test(
        source.slice(pos)
      );

    const applicationClassLocalIsDeclarationPhase =
      isApplicationClassLocal &&
      !sawTopLevelExecutableStatement;

    const isTopLevelDeclaration =
      isImport ||
      /^(?:Global|Component|Constant|Declare\s+Function)\b/i.test(source.slice(pos));


    const closesTopLevelDeclarationSection =
      !isTopLevelDeclaration &&
      !isLocalDeclaration &&
      sawTopLevelDeclaration &&
      !closedTopLevelDeclarationSection;

    /*
     * Imports are a single declaration section. Close that section only when
     * the first non-import source statement is reached. Comments are handled
     * earlier in this loop and therefore remain inside the import section.
     *
     * ACCOMPLISHMENTS.EMPLID.SavePostChange has ten imports split into three
     * comment-labelled groups. Stored PSPCMPROG has no 0x2D between those
     * imports; it has exactly one 0x2D before the first Local declaration.
     */
    let justClosedImportSection = false;

    if (!isImport && importSectionOpen) {
      chunks.push(Buffer.from([0x2d]));

      /*
       * The import-section boundary carries at most one 0x4F formatting
       * marker. Do not derive multiplicity from decoded/source newline count:
       * ACCOMPLISHMENTS.EMPLID.SavePostChange stores exactly:
       *
       *   ... <last import> 15 2D 4F 44 <first Local> ...
       *
       * and decode formatting may expand that source boundary to several
       * newline characters without representing additional compiled 0x4F
       * bytes.
       */
      if (hasBlankLine) {
        chunks.push(Buffer.from([0x4f]));
      }

      importSectionOpen = false;
      justClosedImportSection = true;

      /*
       * An import section and a following Local declaration section are
       * distinct compiled declaration groups.
       *
       * ACCT_CD_NEW_VW.ACCT_CD.SearchInit:
       *
       *   import HMCF_CHARTFIELDS:*;
       *
       *   Local Rowset &MYACTIVECFS;
       *   Local Row &ActiveCf;
       *   Local number &I;
       *
       *   If ...
       *
       * stores:
       *
       *   <import> 15 2D 4F
       *   <locals> ... 15 2D 4F
       *   <If>
       *
       * Closing the import section therefore starts a fresh declaration-only
       * Local run when the next source item is Local.
       */
      if (isLocalDeclaration && !isApplicationClassLocal) {
        /*
         * Restart only the ordinary Local declaration-run tracker here.
         *
         * Application Class Locals already have their own calibrated section
         * lifecycle through sawApplicationClassLocalSection /
         * closesApplicationClassLocalSection. Restarting the generic Local
         * tracker for those declarations duplicates their eventual:
         *
         *   2D 4F
         *
         * boundary (offset 179 regression).
         *
         * Ordinary Locals after an import still need the distinct second
         * declaration section proven by offset 411.
         */
        leadingLocalRun = true;
        sawLeadingLocalDeclaration = false;
        pendingReferenceLocalBoundary = undefined;
        pendingReferenceLocalMarkers = 1;
      }
    }

    const closesApplicationClassLocalSection =
      !isLocalDeclaration &&
      sawApplicationClassLocalSection &&
      !closedApplicationClassLocalSection;

    /*
     * Blank formatting lines inside a leading declaration-only Local run
     * are preserved as 0x4F source-group boundaries.
     *
     * ACA_ACK_RUNCTL.ACA_ATTACHADD.FieldChange:
     *
     *   Local File &fileWSDL;
     *
     *   Local XmlDoc &XMLdoc;
     *
     * stores:
     *
     *   ... 15 4F 44 0A "XmlDoc" ...
     *
     * The first newline is ordinary source separation; each additional
     * newline contributes one 0x4F.
     */
    if (
      leadingLocalRun &&
      sawLeadingLocalDeclaration &&
      isLocalDeclaration &&
      hasBlankLine
    ) {
      const markerCount = Math.max(
        1,
        (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
      );

      for (let marker = 0; marker < markerCount; marker++) {
        chunks.push(Buffer.from([0x4f]));
      }
    }

    if (
      haveCompletedTopLevelStatement &&
      hasBlankLine &&
      !leadingLocalRun &&
      !isTopLevelDeclaration &&
      !closesTopLevelDeclarationSection &&
      !justClosedImportSection &&
      !closesApplicationClassLocalSection
    ) {
      const markerCount = Math.max(1, (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1);
      for (let marker = 0; marker < markerCount; marker++) {
        pendingReferenceGroupBoundaries.push(chunks.length);
      }
    }

    if (
      leadingLocalRun &&
      !isLocalDeclaration
    ) {
      // This is the first non-Local statement following a declaration-only
      // Local run. If the completed program ultimately contains compiled
      // references, PeopleTools closes that declaration section at this
      // exact source boundary.
      if (
        sawLeadingLocalDeclaration &&
        !isTopLevelDeclaration &&
        pendingReferenceLocalBoundary === undefined
      ) {
        pendingReferenceLocalBoundary = chunks.length;
        pendingReferenceLocalMarkers = Math.max(
          1,
          (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
        );
      }

      leadingLocalRun = false;
    }


    // An application-class Local starts a Local declaration section. The
    // section may contain following ordinary Local declarations and closes
    // only when the run ends (or at EOF), matching the full fixture.
    if (closesApplicationClassLocalSection) {
      /*
       * The complete Local declaration section closes before the first
       * executable statement.
       *
       * ACCOMPLISHMENTS.EMPLID.SavePostChange calibrates this boundary as:
       *
       *   ... <last Local> 15 2D 4F 3C <Evaluate> ...
       *
       * Keep both bytes together here so the generic deferred blank-line
       * mechanism cannot reorder them as 4F 2D.
       */
      chunks.push(Buffer.from([0x2d]));

      if (hasBlankLine) {
        const markerCount = Math.max(
          1,
          (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
        );

        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
      }

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

    const statementChunkStart = chunks.length;

    statement();

    if (
      leadingLocalRun &&
      isLocalDeclaration
    ) {
      if (lastLocalHadInitializer) {
        /*
         * An initialized Local is executable at declaration time. It does
         * not extend the declaration-only Local section.
         *
         * If declaration-only Locals preceded it, close that section
         * immediately before this initialized Local. If it is the first
         * Local, there is no declaration-only section and therefore no
         * deferred 0x2D boundary.
         */
        if (
          sawLeadingLocalDeclaration &&
          pendingReferenceLocalBoundary === undefined
        ) {
          pendingReferenceLocalBoundary = statementChunkStart;
          pendingReferenceLocalMarkers = Math.max(
            1,
            (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
          );
        }

        leadingLocalRun = false;
      } else {
        sawLeadingLocalDeclaration = true;
      }
    }

    if (isFunction) {
      /*
       * functionStatement() consumes the complete Function ... End-Function;
       * definition and emits its trailing 0x2D definition boundary.
       *
       * Mark it as a completed top-level statement before continuing so the
       * next loop iteration can preserve blank-line group boundaries between
       * adjacent Function definitions.
       *
       * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
       *
       *   End-Function;
       *
       *   Function Employee_MA() Returns boolean
       *
       * => ... 37 15 2D 4F 32 ...
       */
      haveCompletedTopLevelStatement = true;
      continue;
    }

    space();

    /*
     * Some complete block statements are self-terminating at top level.
     *
     * Calibrated cases:
     *
     *   If ... End-If
     *   Evaluate ... End-Evaluate
     *
     * At EOF, PeopleTools emits the block terminator directly before 0x07;
     * there is no synthetic 0x15 semicolon:
     *
     *   ... 1A 07   // End-If
     *   ... 3F 07   // End-Evaluate
     *
     * Ordinary top-level statements still require ';'.
     */
    if (source[pos] !== ';') {
      /*
       * Some complete top-level statements are legal at EOF without an
       * explicit source semicolon.
       *
       * Previously calibrated:
       *   If ... End-If
       *   Evaluate ... End-Evaluate
       *
       * Offset 425 adds an ordinary top-level assignment:
       *
       *   ACC_TYP_TBL_BRA.EFF_STATUS.Value =
       *      ACCDNT_TYPE_TBL.EFF_STATUS.Value
       *
       * Stored PSPCMPROG ends directly with 0x07 after the RHS expression;
       * there is no synthetic 0x15 terminator.
       *
       * Restrict this relaxation to EOF. Any non-EOF ordinary statement
       * still requires its explicit semicolon.
       */
      const selfTerminatingAtEof =
        pos === source.length &&
        (
          startsTopLevelAssignment ||
          isIfStatement ||
          isEvaluateStatement
        );

      if (!selfTerminatingAtEof) {
        fail('expected ;');
      }
    } else {
      pos++;
      chunks.push(fixed(';'));

      /*
       * A same-line block comment following a top-level statement terminator
       * is the trailing/inline 0x4E representation, exactly like the already
       * calibrated For/While/If body paths.
       *
       * ACA_CAL_YEAR.LASTUPDDTTM.SavePreChange:
       *
       *   End-For; [trailing block comment &I]
       *
       * stores:
       *
       *   ... 2C 15 4E <comment> 07
       *
       * rather than the standalone-comment 0x24 form.
       */
      trailingBlockComments();
    }

    if (isImport) {
      // Imports remain in one open declaration section until the first
      // non-import statement (comments do not close the section).
      importSectionOpen = true;

      // Keep imports out of the generic declaration-section closer; their
      // boundary is managed explicitly by importSectionOpen.
      closedTopLevelDeclarationSection = true;
    } else if (
      isApplicationClassLocal &&
      applicationClassLocalIsDeclarationPhase
    ) {
      sawApplicationClassLocalSection = true;
    } else if (isTopLevelDeclaration) {
      sawTopLevelDeclaration = true;
    }

    /*
     * Once an ordinary executable statement has been encountered, later
     * initialized App Class Locals are executable statements, not a reopened
     * Local declaration section.
     *
     * Keep pure declarations and declaration-only Locals out of this state.
     * Initialized Locals do count because their initializer executes.
     */
    if (
      !isImport &&
      !isTopLevelDeclaration &&
      (
        !isLocalDeclaration ||
        lastLocalHadInitializer
      )
    ) {
      sawTopLevelExecutableStatement = true;
    }

    haveCompletedTopLevelStatement = true;
  }

  // The implicit owner placeholder alone does not count as a compiled
  // reference. A bound/inferred owner or any additional PSPCMNAME row does.
  const hasCompiledReferences =
    references.length > 1 ||
    references[0]?.recordName !== undefined ||
    references[0]?.fieldName !== undefined;

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

  if (importSectionOpen) {
    chunks.push(Buffer.from([0x2d]));
    importSectionOpen = false;
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

function parseFunctionMetadata(
  source: string
): FunctionMetadata[] {
  const metadata: FunctionMetadata[] = [];

  /*
   * Function definitions are top-level source items in the calibrated
   * ordinary PeopleCode fixtures. Match only line-start Function headers so
   * Declare Function statements are not included.
   */
  const functionPattern =
    /(?:^|\r?\n)[ \t]*Function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;

  let functionMatch: RegExpExecArray | null;

  while ((functionMatch = functionPattern.exec(source)) !== null) {
    const name = functionMatch[1];
    const parameterStart = functionPattern.lastIndex;

    const closeParen = source.indexOf(')', parameterStart);
    if (closeParen < 0) {
      throw new Error(
        `Unterminated Function parameter list for ${name}`
      );
    }

    const parameterSource =
      source.slice(parameterStart, closeParen).trim();

    const parameterTypes: string[] = [];

    if (parameterSource.length > 0) {
      for (const parameter of parameterSource.split(',')) {
        const typedMatch =
          /^\s*&[A-Za-z_][A-Za-z0-9_]*\s+As\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(
            parameter
          );

        if (typedMatch) {
          parameterTypes.push(typedMatch[1]);
          continue;
        }

        const untypedMatch =
          /^\s*&[A-Za-z_][A-Za-z0-9_]*\s*$/.exec(parameter);

        if (untypedMatch) {
          /*
           * Untyped Function parameters compile with signature type id 4.
           *
           * ACCOMPLISHMENTS.MAJOR_CODE.SaveEdit:
           *
           *   Function major_code_ckeck(&EMPLID, &COMPANY);
           *
           * stores two parameter descriptors:
           *
           *   0xC0000004
           *   0xC0000004
           *
           * Use the primitive type whose calibrated id is 4.
           */
          parameterTypes.push('__untyped_parameter__');
          continue;
        }

        throw new Error(
          `Unsupported Function parameter: ${parameter.trim()}`
        );
      }
    }

    const afterParameters = source.slice(closeParen + 1);
    const returnMatch =
      /^[ \t]*Returns\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(
        afterParameters
      );

    metadata.push({
      name,
      parameterTypes,
      returnType: returnMatch?.[1]
    });

    /*
     * Resume scanning after this header's close paren. The global regexp will
     * find the next line-start Function definition.
     */
    functionPattern.lastIndex = closeParen + 1;
  }

  return metadata;
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

  if (functionMetadata.length === 0) {
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
