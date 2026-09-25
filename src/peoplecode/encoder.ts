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
  hasParameterList: boolean;
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

const BUILTIN_FUNCTION_TYPE_IDS: ReadonlyMap<string, number> = new Map([
  ['file', 0x80001],
  // `Function PopulateAcmArray(..., &AcmMbrSQL As SQL, &AcmMbrArray As
  // array of Record);` (definition 4861): the parameter signature tail
  // stores SQL's descriptor as `c0080002` immediately between the `date`
  // (`c0000002`) and `array of Record` (`c0180003`) parameters, i.e.
  // SQL's own type id is 0x80002 -- the gap between `file` (0x80001) and
  // `record` (0x80003) in this same enumeration.
  ['sql', 0x80002],
  ['record', 0x80003],
  ['rowset', 0x80007],
  ['row', 0x80008],
  ['field', 0x80009],
  ['apiobject', 0x8000f],
  // `Function SetCompoundColumnVisibility(&rs As Rowset, &GRID As Grid)`
  // (definition 14962): the parameter signature tail stores Grid's
  // descriptor as `c0080014` immediately after Rowset's (`c0080007`),
  // i.e. Grid's own type id is 0x80014.
  ['grid', 0x80014],
  ['xmldoc', 0x8001d],
  ['exception', 0x80021],
  ['xmlnode', 0x80022]
]);

function functionTypeId(
  typeName: string,
  applicationClassOffsets?: ReadonlyMap<string, number>
): number {
  /*
   * Each nesting level of `array of` contributes its OWN multiple of
   * 0x100000 -- NOT a single OR'd flag bit reused at every level. A bare
   * trailing `array` (no final `of ElementType`) counts as one more
   * nesting level over an implicit `any` element type.
   *
   * `Function savewideqryvalues(..., &arr As array of array of string) ...`
   * (definition 14899): the parameter signature tail stores this
   * 2-level-nested parameter as `c0200001` -- `0x200000` (TWO multiples
   * of `0x100000`, not one) OR'd with `0x000001` (`string`'s own id).
   *
   * `Function parse_objclass(..., &array_structobj As array of array of
   * array of string, ...)` (definition 15115): the 3-level-nested
   * parameter stores `c0300001` -- `0x300000` (three multiples),
   * confirming the pattern is `depth * 0x100000`, not a saturating OR.
   *
   * `Function Get_ACM_Ern(&Acm_Pin As number, &Ern_array As array)`
   * (definition 8229): the bare (untyped) `array` parameter stores
   * `c0100004` -- one level (`0x100000`) OR'd with `0x000004`, `any`'s
   * own primitive id.
   */
  let rest = typeName.trim();
  let depth = 0;
  while (true) {
    const arrayOfMatch = /^array\s+of\s+/i.exec(rest);
    if (arrayOfMatch) {
      depth++;
      rest = rest.slice(arrayOfMatch[0].length);
      continue;
    }
    if (/^array$/i.test(rest)) {
      depth++;
      rest = 'any';
    }
    break;
  }

  if (depth > 0) {
    return (
      (depth * 0x100000) |
      functionTypeId(rest, applicationClassOffsets)
    ) >>> 0;
  }

  const applicationClassOffset = applicationClassOffsets?.get(
    typeName.trim().toLowerCase()
  );
  if (applicationClassOffset !== undefined) {
    return (0x80000 | 0x100 | applicationClassOffset) >>> 0;
  }

  // Built-in object descriptors use 0x80000 plus their calibrated subtype.
  // Function parameter slots add 0xc0000000 in parameterTypeDescriptor().
  const builtinObjectType = BUILTIN_FUNCTION_TYPE_IDS.get(typeName.toLowerCase());
  if (builtinObjectType !== undefined) return builtinObjectType;

  // Function directories encode Date as scalar descriptor 0x02. This has not
  // yet been established for Application Class method signature records, so
  // keep it local to Function metadata rather than the shared primitive map.
  if (typeName.toLowerCase() === 'date') return 0x02;

  const id = PRIMITIVE_SIGNATURE_TYPE_IDS.get(typeName.toLowerCase());
  if (id === undefined) throw new Error(`Unsupported function metadata type: ${typeName}`);
  return id;
}

function returnTypeDescriptor(
  typeName?: string,
  applicationClassOffsets?: ReadonlyMap<string, number>
): number {
  return typeName === undefined
    ? 0x07
    : functionTypeId(typeName, applicationClassOffsets);
}

function parameterTypeDescriptor(
  typeName: string,
  applicationClassOffsets?: ReadonlyMap<string, number>
): number {
  if (typeName === '__untyped_parameter__') {
    return 0xc0000004;
  }

  return (
    0xc0000000 |
    functionTypeId(typeName, applicationClassOffsets)
  ) >>> 0;
}

function functionApplicationClassTypes(
  metadata: readonly FunctionMetadata[]
): string[] {
  const types: string[] = [];
  const seen = new Set<string>();

  for (const item of metadata) {
    for (const rawType of [...item.parameterTypes, item.returnType]) {
      if (rawType === undefined) continue;
      const typeName = rawType.replace(/^array\s+of\s+/i, '').trim();
      if (!typeName.includes(':')) continue;
      const key = typeName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      types.push(typeName);
    }
  }

  return types;
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
  ) + functionApplicationClassTypes(metadata).reduce(
    (total, typeName) =>
      total + Buffer.byteLength(typeName + '\0', 'utf16le'),
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
    (total, item) => total + (item.hasParameterList ? item.parameterTypes.length + 1 : 0),
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
   *   uint32 signatureSlotOffset
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
   * signatureSlotOffset is the cumulative number of signature-tail slots
   * occupied by prior Functions. Each Function contributes one slot per
   * parameter plus one 0x00000007 terminator slot.
   *
   * This was previously mistaken for a zero-based function ordinal because
   * zero-parameter Function fixtures produce 0, 1, 2, ... in both cases.
   * DERIVED_CO.FUNCLIB.FieldFormula disambiguates the field: its first
   * Function has one parameter, so the second directory record stores 2,
   * not 1.
   *
   * For a single Function this remains byte-compatible because the first
   * signatureSlotOffset is always 0.
   */
  const names = metadata.map(
    item => Buffer.from(item.name + '\0', 'utf16le')
  );
  const applicationClassTypes = functionApplicationClassTypes(metadata);
  const applicationClassNames = applicationClassTypes.map(
    typeName => Buffer.from(typeName + '\0', 'utf16le')
  );
  const applicationClassOffsets = new Map<string, number>();
  let applicationClassCharOffset = metadata.reduce(
    (total, item) => total + item.name.length + 1,
    0
  );
  for (const typeName of applicationClassTypes) {
    applicationClassOffsets.set(
      typeName.toLowerCase(),
      applicationClassCharOffset
    );
    applicationClassCharOffset += typeName.length + 1;
  }

  const directory = Buffer.alloc(metadata.length * 16);

  let nameOffsetUtf16 = 0;
  let signatureSlotOffset = 0;

  for (let i = 0; i < metadata.length; i++) {
    const item = metadata[i];
    const offset = i * 16;

    directory.writeUInt32LE(nameOffsetUtf16, offset);
    directory.writeUInt32LE(item.hasParameterList ? signatureSlotOffset : 0, offset + 4);
    directory.writeUInt32LE(item.parameterTypes.length, offset + 8);
    directory.writeUInt32LE(
      returnTypeDescriptor(item.returnType, applicationClassOffsets),
      offset + 12
    );

    nameOffsetUtf16 += item.name.length + 1;
    if (item.hasParameterList) signatureSlotOffset += item.parameterTypes.length + 1;
  }

  /*
   * Signature tails follow all directory records. A zero-parameter Function
   * contributes only 0x00000007. Parameterized Functions contribute their
   * calibrated parameter type slots followed by the same terminator.
   */
  const signatureTails: Buffer[] = [];

  for (const item of metadata) {
    if (!item.hasParameterList) continue;
    for (const typeName of item.parameterTypes) {
      const parameter = Buffer.alloc(4);
      parameter.writeUInt32LE(
        parameterTypeDescriptor(typeName, applicationClassOffsets),
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
    ...applicationClassNames,
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
    //
    // ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange (definition 772) proves
    // ApiObject belongs on this list too: `Local ApiObject &aRecordsList;`
    // stores its type as `44 0A "ApiObject"`, not `44 40 "ApiObject"`.
    //
    // AMM_FILTER.IB_DIRECTION.FieldFormula (definition 1046) proves Grid
    // belongs on it too: `Local Grid &GRID, &GRID2;` stores its type as
    // `44 0A "Grid"`, not `44 40 "Grid"`.
    //
    // BENEF_PB_WRK.ODEM_SCHED_ACTY_PB.FieldDefault (definition 1749) proves
    // ProcessRequest belongs on it too: `Local ProcessRequest &RQST;`
    // stores its type as `44 0A "ProcessRequest"`, not `44 40
    // "ProcessRequest"`.
    if (/^(Record|Field|Rowset|Row|SQL|File|XmlDoc|XmlNode|ApiObject|Grid|ProcessRequest)$/i.test(name)) {
      return textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, name);
    }

    return textOperand(0x40, TokenKind.Keyword, name);
  };

  const arrayElementTypes = (): string | undefined => {
    let elementType: string | undefined;
    do {
      space();
      /*
       * `array` (bare, with no `of ElementType` clause at all) is itself a
       * valid, untyped array declaration -- at any nesting level, not just
       * the outermost one.
       *
       * PSMCF_UQSVC_MSGS.MCFUQPUBLISH.RowInit (definition 16150):
       *
       *   Component array &QueueIDArrayAdd;
       *
       * stores only `54 40 "array" 01 "&QueueIDArrayAdd" 15` -- no `of`
       * keyword byte, nothing after the type name at all. Confirmed for
       * nested bare arrays too, e.g. `Component array of array &Var;`
       * (definition 19016): the second `array` also has no trailing `of`.
       */
      if (!word('of')) return elementType;
      chunks.push(textOperand(0x40, TokenKind.Keyword, 'of'));
      space();
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
        const appClass = applicationClassPath();
        elementType = appClass.className;
        continue;
      }
      elementType = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
      chunks.push(typeName());
    } while (/^array$/i.test(elementType ?? ''));
    return elementType;
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
    //
    // The package root may also be the reserved `%metadata` package
    // (metadata-driven Application Classes), the same leading `%?` this
    // lookahead's own `applicationClassPath()` call already accepts:
    //
    //   Local %metadata:AppDataSet &recName;
    //
    // PSPPMSSRVC_PLAT.QUERY_PLATFORM_XX.FieldFormula (one of several
    // corpus occurrences of this exact shape).
    const appClassLookahead =
      /^(%?[A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(
        source.slice(pos)
      );

    if (appClassLookahead) {
      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      space();

      const variableMatch =
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos));
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

      const registerApplicationClassVariable = (name: string) => {
        applicationClassVariables.set(
          name.toLowerCase(),
          appClassVariable
        );

        if (functionDepth > 0) {
          functionApplicationClassVariables.set(
            name.toLowerCase(),
            {
              ...appClassVariable,
              reuseRuntimeCreateForMethods: false
            }
          );
        }
      };

      registerApplicationClassVariable(variableName);

      /*
       * A late top-level Application Class Local, after executable code has
       * already begun, allocates its own PACKAGE dependency at declaration
       * time. Declaration-phase App Class Locals retain the existing behavior
       * and do not allocate here.
       *
       * COMPANY_TBL.LOCATION.FieldChange calibrates:
       *
       *   Local EO:CA:Address &LocAddress;
       *
       * after executable statements as PSPCMNAME PACKAGE sequence 28, before
       * the following Record.DERIVED_ADDRESS dependency.
       */
      if (
        ((functionDepth === 0 &&
          controlDepth === 0 &&
          sawTopLevelExecutableStatement) ||
          (functionDepth > 0 && !/^\s*=/.test(source.slice(pos)))) &&
        !/^\s*=\s*create\b/i.test(source.slice(pos))
      ) {
        addApplicationClassReference(
          appClass.packagePath,
          appClass.className
        );
      }

      while (true) {
        space();
        if (source[pos] !== ',') break;

        pos++;
        chunks.push(fixed(','));
        space();

        const additionalVariable =
          /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
        if (additionalVariable === undefined) {
          return fail('expected an ASCII &variable after ,');
        }

        chunks.push(variable());
        registerApplicationClassVariable(additionalVariable);
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

    // Calibrated compound declarations:
    //   Local array of string &values;
    // => 44 40 "array" 40 "of" 40 "string" 01 "&values"
    //   Local array &values;
    // => 44 40 "array" 01 "&values"
    if (/^array$/i.test(type ?? '')) {
      space();

      const ofMatch = /^of\b/i.exec(source.slice(pos));

      /*
       * `Local array &values;` (bare, no `of ElementType` clause) is
       * itself a valid, untyped array declaration -- the same allowance
       * `arrayElementTypes()` grants Component/Global/nested array
       * declarations.
       *
       * WEBLIB_MCF_QU.MCF_UQ_TASK_UT.FieldFormula (definition 6350):
       *
       *   Local array &NODE_ARRAY, &PARENT_ARRAY, &BRANCH_ARRAY;
       *
       * stores only `44 40 "array" 01 "&NODE_ARRAY" ...` -- no `of`
       * keyword byte at all.
       */
      if (ofMatch) {
        pos += ofMatch[0].length;
        chunks.push(textOperand(0x40, TokenKind.Keyword, 'of'));

        space();

        let elementType =
          /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

        if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
          const appClass = applicationClassPath();
          chunks.push(appClass.bytes);
          addApplicationClassReference(appClass.packagePath, appClass.className);
        } else {
          chunks.push(typeName());
          if (/^array$/i.test(elementType ?? '')) {
            elementType = arrayElementTypes();
          }
        }

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
    } else if (/^ApiObject$/i.test(type ?? '')) {
      /*
       * ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange (definition 772):
       * `Local ApiObject &aRecordsList;` allocates an implicit
       * PACKAGE/APIOBJECT dependency row the same way Rowset/Record/SQL/
       * File/XmlDoc/XmlNode already do -- this case was missing entirely,
       * so every PSPCMNAME index after the first ApiObject declaration
       * was shifted by one relative to stored.
       */
      ensureLocalObjectPackageReference('APIOBJECT', 'ApiObject');
    } else if (/^Grid$/i.test(type ?? '')) {
      /*
       * AMM_FILTER.IB_DIRECTION.FieldFormula (definition 1046):
       * `Local Grid &GRID, &GRID2;` allocates an implicit PACKAGE/GRID
       * dependency row the same way ApiObject above does -- the same
       * class of gap, a separate object-declaration type missing from
       * this dispatch entirely.
       */
      ensureLocalObjectPackageReference('GRID', 'Grid');
    } else if (/^ProcessRequest$/i.test(type ?? '')) {
      /*
       * BENEF_PB_WRK.ODEM_SCHED_ACTY_PB.FieldDefault (definition 1749):
       * `Local ProcessRequest &RQST;` allocates an implicit
       * PACKAGE/PROCESSREQUEST dependency row the same class of gap as
       * ApiObject/Grid above.
       */
      ensureLocalObjectPackageReference('PROCESSREQUEST', 'ProcessRequest');
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
      /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
    if (/^Record$/i.test(type ?? '') && firstDeclaredVariable) {
      recordVariables.add(firstDeclaredVariable.toLowerCase());
    } else if (/^Row$/i.test(type ?? '') && firstDeclaredVariable) {
      rowVariables.add(firstDeclaredVariable.toLowerCase());
    } else if (/^Rowset$/i.test(type ?? '') && firstDeclaredVariable) {
      rowsetVariables.add(firstDeclaredVariable.toLowerCase());
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
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      if (/^Record$/i.test(type ?? '') && declaredVariable) {
        recordVariables.add(declaredVariable.toLowerCase());
      } else if (/^Row$/i.test(type ?? '') && declaredVariable) {
        rowVariables.add(declaredVariable.toLowerCase());
      } else if (/^Rowset$/i.test(type ?? '') && declaredVariable) {
        rowsetVariables.add(declaredVariable.toLowerCase());
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

    /*
     * Global declarations may use a fully-qualified Application Class type:
     *
     *   Global CO_NAVIGATN:Stack &MyNavStack;
     *
     * DERIVED_CO.FUNCLIB.FieldFormula stores the type inline as:
     *
     *   45 0A "CO_NAVIGATN" 57 0A "Stack" 01 "&MyNavStack" 15
     *
     * The declaration itself does not allocate a PSPCMNAME dependency row.
     * The runtime create later in the program owns that dependency.
     */
    const appClassLookahead =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(
        source.slice(pos)
      );

    if (appClassLookahead) {
      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      space();
      chunks.push(variable());
      return;
    }

    const declaredType = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    chunks.push(typeName());
    if (/^array$/i.test(declaredType ?? '')) {
      if (/^Record$/i.test(arrayElementTypes() ?? '')) {
        ensureLocalObjectPackageReference('RECORD', 'Record');
      }
    }

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

  const panelGroupDeclaration = () => {
    /*
     * PanelGroup declarations use opcode 0x51.
     *
     * DERIVED_CO.FUNCLIB.FieldFormula:
     *   PanelGroup number &NbrHeaders, &NbrGrids;
     *   PanelGroup string &SortBy;
     *   PanelGroup boolean &Transfer;
     *
     * Stored shape:
     *   51 40 <type> 01 <var> ...
     */
    chunks.push(Buffer.from([0x51]));

    space();
    chunks.push(typeName());

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

  const componentDeclaration = () => {
    chunks.push(fixed('Component'));

    space();
    const appClassType =
      /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))
        ? applicationClassPath()
        : undefined;
    const declaredType =
      appClassType === undefined
        ? /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0]
        : undefined;
    chunks.push(appClassType?.bytes ?? typeName());
    if (/^array$/i.test(declaredType ?? '')) {
      arrayElementTypes();
    }
    if (/^Record$/i.test(declaredType ?? '')) {
      ensureLocalObjectPackageReference('RECORD', 'Record');
    } else if (/^Rowset$/i.test(declaredType ?? '')) {
      /*
       * DERIVED_ABS_EA.CLEAR_ALL.FieldChange (definition 4067):
       *
       *   Component Rowset &RsEA_Abs;
       *   For &i = &RsEA_Abs.ActiveRowCount To 1 Step - 1
       *      &RsEA_Abs.GetRow(&i).DERIVED_ABS_EA.SELECT_REC.Value = "N";
       *   End-For;
       *
       * `Component Rowset &var;` allocates the same PACKAGE/ROWSET local
       * object dependency row a `Local Rowset &var;` declaration already
       * does (see the Local-declaration handling above) -- this branch was
       * missing entirely for Component declarations, so the RECORD/FIELD
       * references allocated later for DERIVED_ABS_EA.SELECT_REC were both
       * off by one PSPCMNAME index.
       */
      ensureLocalObjectPackageReference('ROWSET', 'Rowset');
    } else if (/^XmlDoc$/i.test(declaredType ?? '')) {
      /*
       * AMM_ARCHIVE_WK.FUNCLIB.FieldFormula (definition 935):
       *
       *   Component XmlDoc &xmldoc;
       *   ...
       *   &UncompressedSize = &MsgSizeRootNode.FindNode(...).NodeValue;
       *
       * `Component XmlDoc &var;` allocates the same PACKAGE/XMLDOC local
       * object dependency row a `Local XmlDoc &var;` declaration already
       * does, exactly like the Rowset case above -- this branch was also
       * missing entirely for Component declarations, shifting every
       * reference index after it by one. Only XmlDoc is evidenced so far;
       * XmlNode/SQL/File/Row/ApiObject Component declarations may need
       * the same treatment but are unconfirmed.
       */
      ensureLocalObjectPackageReference('XMLDOC', 'XmlDoc');
    }

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
    const firstVariable =
      /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
    if (/^Record$/i.test(declaredType ?? '') && firstVariable) {
      recordVariables.add(firstVariable.toLowerCase());
    }
    /*
     * A Component-declared Application Class instance reuses its
     * runtime-create PSPCMNAME dependency for later method calls, exactly
     * like a declaration-phase Local Application Class variable does (see
     * the matching Local-declaration logic above, "offset 179"/"offset
     * 411"). A Component declaration is itself always declaration-phase
     * (it appears before any executable code), so this is unconditional
     * here.
     *
     * ADDRESS_SBR.COUNTRY.RowInit (definition 525):
     *
     *   Component EO:CA:Address &cobj_EO_CA_Address;
     *   ...
     *   If &cobj_EO_CA_Address = Null Then
     *      &cobj_EO_CA_Address = create EO:CA:Address(&Addr_Rec, &Der_Address, &Der_addr);
     *   Else
     *      &cobj_EO_CA_Address.ResetAddressRecord(&Addr_Rec);
     *      &cobj_EO_CA_Address.ResetDerivedAddressRecord(&Der_Address);
     *      &cobj_EO_CA_Address.ResetDerivedAddrRecord(&Der_addr);
     *   End-If;
     *
     * Direct stored-PSPCMNAME enumeration proves there is NO separate
     * method-dependency PSPCMNAME row at all for any of the three Reset*
     * calls -- only the single runtime-create PACKAGE|ADDRESS row exists.
     * The prior hardcoded `reuseRuntimeCreateForMethods: false` for every
     * Component Application Class declaration was backwards for this case.
     */
    const componentAppClassReuseRuntimeCreateForMethods =
      functionDepth === 0 &&
      !(controlDepth === 0 && sawTopLevelExecutableStatement);

    if (appClassType !== undefined && firstVariable) {
      applicationClassVariables.set(firstVariable.toLowerCase(), {
        packagePath: appClassType.packagePath,
        className: appClassType.className,
        reuseRuntimeCreateForMethods:
          componentAppClassReuseRuntimeCreateForMethods
      });
      if (sawWildcardImport) {
        addApplicationClassReference(
          appClassType.packagePath,
          appClassType.className
        );
      }
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
      /*
       * PeopleTools preserves a trailing comma in ordinary Component
       * declarations as the normal comma opcode immediately before the
       * declaration semicolon. HCDEV definitions 14721, 17309, 21463, and
       * 21578 independently contain this form (including scalar, Rowset,
       * and array types):
       *
       *   Component string &A,;
       *
       * => 54 40 "string" 01 "&A" 03 15
       */
      if (source[pos] === ';') {
        break;
      }

      const nextVariable =
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      if (/^Record$/i.test(declaredType ?? '') && nextVariable) {
        recordVariables.add(nextVariable.toLowerCase());
      }
      if (appClassType !== undefined && nextVariable) {
        applicationClassVariables.set(nextVariable.toLowerCase(), {
          packagePath: appClassType.packagePath,
          className: appClassType.className,
          reuseRuntimeCreateForMethods:
            componentAppClassReuseRuntimeCreateForMethods
        });
      }
      chunks.push(variable());
    }
  };

  const componentLifeDeclaration = () => {
    /*
     * ComponentLife is a fifth declarator alongside Local/Global/
     * Component/Constant (0x79, "a fourth declarator" per Component's own
     * 0x56 comment) -- a component-interface object lifetime scope, e.g.
     * `ComponentLife PTPN_PUBLISH:PublishToWindow &wlSrch;`. Structurally
     * identical declaration grammar to Component (type, then one or more
     * comma-separated &variables), confirmed by CAFNUI_CTRL_WRK.FUNCLIB.
     * FieldFormula (definition 2092): `ComponentLife string &p_compkey,
     * &p_entityname;`.
     *
     * Deliberately narrower than componentDeclaration(): no evidence yet
     * that a ComponentLife-declared Application Class variable
     * (`ComponentLife CAF_SEARCH_NUI:Search &var;`, also attested in the
     * corpus) participates in the same runtime-create PSPCMNAME reuse
     * rules Component's own declaration carefully calibrates -- so this
     * does not track it into `applicationClassVariables` at all yet.
     */
    chunks.push(fixed('ComponentLife'));

    space();
    const appClassType =
      /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))
        ? applicationClassPath()
        : undefined;
    const declaredType =
      appClassType === undefined
        ? /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0]
        : undefined;
    chunks.push(appClassType?.bytes ?? typeName());
    if (/^array$/i.test(declaredType ?? '')) {
      arrayElementTypes();
    }

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
  const rowsetVariables = new Set<string>();

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
    /*
     * ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange (definition 772) proves this
     * reuse pool is also FUNCTION-BODY sensitive, not just control-group
     * sensitive: leading Local declarations inside a `Function ...
     * End-Function;` body do not bump `controlGroup` (only executable
     * statements do, per the Function-body control-group rule), so a
     * top-level `Component Rowset &grsLevelList;` (functionDepth 0) and a
     * later `Local Rowset &rsRecordsList;` inside `Function
     * DoRecordsSearch()` (functionDepth 1) land in the SAME numeric
     * control group despite being in clearly different declaration scopes
     * -- stored allocates a distinct PACKAGE/ROWSET row for each, not one
     * shared row.
     */
    const key =
      `${controlGroup}:${functionDepth}:${packageName.toLowerCase()}:${objectName.toLowerCase()}`;

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

    /*
     * `%metadata` is a reserved package root for metadata-driven
     * Application Classes -- always the FIRST path component, never
     * later ones (67 corpus occurrences checked, 23 distinct shapes, all
     * `%metadata` as the sole root).
     *
     *   import %metadata:AnalyticModelDefn:Aceorganizer;
     *   import %metadata:*;
     */
    const firstMatch =
      /^%?[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
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
          index === 0 && /^%metadata$/i.test(component)
            ? 0x12
            : INLINE_IDENTIFIER_OPCODE,
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
  let reuseFetchValueRecord = false;
  const fetchValueRecordReferences = new Map<string, PeopleCodeReference>();

  /*
   * RowScrollSelect's own repeated Record.X arguments reuse a same-name
   * RECORD row ONLY within that same call's own argument list, as a last
   * resort when no earlier reuse-participating reference already exists
   * for that name in the current control group -- neither the broader
   * by-name reuse (any earlier occurrence anywhere, including from
   * non-participating calls) nor plain occurrence-based allocation (never
   * reuse) match stored behavior on their own.
   *
   * AE_UPGCONV_WRK.AE_REFRESH.FieldChange (definition 840):
   *
   *   ScrollFlush(Record.MESSAGE_LOG);
   *   RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "...", &PI);
   *
   * ScrollFlush is NOT a reuse-participating call (it never sets
   * `reuseRecordReferenceWithinControlGroup`), so its own Record.MESSAGE_LOG
   * allocates its own row (NAMENUM 3) without registering as reusable.
   * RowScrollSelect's FIRST Record.MESSAGE_LOG argument therefore finds no
   * participating entry and allocates fresh (NAMENUM 4); its SECOND
   * argument, in the SAME call, reuses that fresh one. A fresh Map per
   * RowScrollSelect call (saved/restored around the call like the other
   * reuse flags, to handle nesting) gives exactly this same-call scope.
   *
   * ABSENCE_CAL_VW.ABSENCE_TYPE.RowInit (definition 27, protected
   * baseline) proves the OTHER half: when a reuse-participating call HAS
   * already established a same-name RECORD row in the current control
   * group, RowScrollSelect DOES reuse it, even across statements:
   *
   *   &LEVEL1_ROWS = ActiveRowCount(Record.ABS_TYPE_TBL);
   *   ...
   *   RowScrollSelect(1, Record.ABS_TYPE_TBL, Record.ABS_TYPE_TBL, "...", ...);
   *
   * ActiveRowCount IS reuse-participating, so its Record.ABS_TYPE_TBL
   * registers in `participatingRecordReferencesByControlGroup` (see that
   * map's own declaration) -- both of RowScrollSelect's own arguments
   * reuse THAT row, not a fresh same-call one. See the priority order in
   * `recordReference()`: the participating-call check runs before the
   * same-call fallback below.
   */
  let reuseRecordReferenceWithinCallArguments = false;
  let recordReferencesWithinCallArguments =
    new Map<string, PeopleCodeReference>();

  /*
   * `PriorValue(Record.X, ...)`'s own Record.X argument must not become
   * visible to a LATER reuse-participating call's control-group-scoped
   * lookup, unlike every other Record.X allocation (the unconditional
   * write it would otherwise join).
   *
   * ARCH_SQL_LNG.ARCH_SQL.FieldChange (definition 1254):
   *
   *   &PRIOR_ARCH_SQL = PriorValue(Record.ARCH_TBL, &ZI, ARCH_SQL_LNG.ARCH_SQL, &ZJ);
   *   &CURRENT_ARCH_SQL = FetchValue(Record.ARCH_TBL, &ZI, ARCH_SQL_LNG.ARCH_SQL, &ZJ);
   *
   * `PriorValue` is not itself a reuse-participating call (it never reads
   * this map for its own argument), but its allocation would otherwise
   * still unconditionally write into `recordReferencesByControlGroup`
   * the same way any other allocation does -- and `FetchValue` IS
   * reuse-participating, so it would wrongly find and reuse that row
   * instead of allocating its own fresh one, which is what stored does.
   * Scoped narrowly to `PriorValue`'s own call (mirroring the identical,
   * already-proven RowScrollSelect-own-arguments exclusion just below)
   * so every other Record.X allocation keeps writing here exactly as
   * before -- this is NOT a claim that every non-participating call
   * behaves this way, only that `PriorValue` specifically does.
   */
  let suppressRecordReferenceControlGroupWrite = false;

  /*
   * ScrollFlush(Record.X); ScrollSelect(1, Record.X, Record.Y, ...) --
   * a RowScrollSelect/RowScrollSelectNew/ScrollSelect call's Record.X
   * argument whose name appears only ONCE across this call's own entire
   * argument list (i.e. does NOT also recur as a later argument of this
   * SAME call) reuses a same-control-group row an immediately preceding
   * ScrollFlush already allocated, unlike a repeated-within-the-call name
   * (see `reuseRecordReferenceWithinCallArguments`'s own comment: a
   * repeated name reuses ONLY within the call, never an outside row).
   *
   * ARCH_FLT_RQST.PSARCH_ID.SavePostChange (definition 1220):
   *
   *   ScrollFlush(Record.ARCH_OTH_CTL_VW);
   *   ScrollSelect(1, Record.ARCH_OTH_CTL_VW, Record.ARCH_OTH_CTRL, &WHERE | &ORDER_BY, ARCH_FLT_RQST.PSARCH_ID);
   *
   * ScrollSelect's own Record.ARCH_OTH_CTL_VW argument (name appears once
   * in this call -- ARCH_OTH_CTRL is a different name) reuses ScrollFlush's
   * row. This does NOT reopen ARCH_WRK.PSARCH_COPY_ROWS.FieldChange
   * (definition 1283, the ORIGINAL evidence for `reuseRecordReferenceWithinCallArguments`):
   *
   *   ScrollFlush(Record.ARCH_CTRL_VW2);
   *   ScrollSelect(1, Record.ARCH_CTRL_VW2, Record.ARCH_CTRL_VW2, &WHERE, ...);
   *
   * ARCH_CTRL_VW2 appears TWICE in that ScrollSelect's own argument list,
   * so it is excluded from this single-occurrence set entirely -- both of
   * its own arguments keep allocating a fresh, call-shared row exactly as
   * 1283 already proved. DERIVED_BEN.BUTTON_FUNC.FieldFormula (definition
   * 4282) looks superficially identical to 1220 (ScrollFlush immediately
   * followed by a different-name ScrollSelect) but is unaffected by this
   * rule for an unrelated reason: that pair sits inside a
   * `Function ... End-Function;` body, where each top-level statement gets
   * its own fresh control group (see the Function-body control-group
   * rule), so ScrollFlush and ScrollSelect there are never in the same
   * control group regardless of this set's contents.
   */
  let singleOccurrenceCallArgumentRecordNames:
    Set<string> | undefined;

  /*
   * The single-occurrence fallback above (`singleOccurrenceCallArgumentRecordNames`)
   * originally read straight from `recordReferencesByControlGroup`, the
   * pool EVERY Record.X allocation writes to (including a RowScrollSelect/
   * RowScrollSelectNew call's own "last call argument becomes visible"
   * write a few dozen lines below, evidenced separately by definition
   * 1145 for a LATER UpdateValue-style reader). AE_UPGCONV_WRK.UPGPATH.
   * FieldChange (definition 843) disproves reading that shared pool here:
   *
   *   ScrollFlush(Record.PSAEAPPLDEFN);
   *   RowScrollSelect(1, Record.UPGCONV_DEFN, Record.UPGCONV_DEFN);
   *   RowScrollSelectNew(1, Record.UPGCONV_DEFN, Record.PSAEAPPLDEFN, "...", &UPGPATH);
   *
   * RowScrollSelectNew's own UPGCONV_DEFN and PSAEAPPLDEFN arguments both
   * allocate fresh rows (NAMENUM 4/5) in the stored program -- reusing
   * neither the intervening RowScrollSelect's own UPGCONV_DEFN row nor
   * ScrollFlush's earlier PSAEAPPLDEFN row. AE_WRK.AE_DECIDE.SavePreChange
   * (definition 860) proves the fallback is still real, not merely
   * disprovable: a bare `ScrollSelectNew(1, Record.A, Record.B, ...)` (not
   * itself a RowScrollSelect-family name, so an utterly ordinary call)
   * immediately followed, in the sibling Else branch of the same If, by
   * `ScrollSelect(1, Record.A, Record.B, ...)` -- ScrollSelect's own A/B
   * arguments DO reuse ScrollSelectNew's rows.
   *
   * The distinguishing factor is not "was the earlier call specifically
   * ScrollFlush" -- it's whether a RowScrollSelect-family call (RowScrollSelect,
   * RowScrollSelectNew, or bare ScrollSelect) has intervened since the
   * earlier allocation. `genericRecordReferencesSinceLastFamilyCall` mirrors
   * `recordReferencesByControlGroup`'s own ordinary (non-call-private)
   * writes, but is entirely cleared in the `finally` block of every
   * RowScrollSelect-family call (after that call's own resolution has
   * already read it) -- so it carries a row forward across an ordinary
   * call (ScrollFlush, ScrollSelectNew, or a sibling If/Else branch
   * boundary) but not across a RowScrollSelect-family call. In definition
   * 843, RowScrollSelect's own completion clears it, so RowScrollSelectNew
   * finds neither row. In definition 860, ScrollSelectNew never clears it
   * (not a family name), so ScrollSelect finds both.
   */
  const genericRecordReferencesSinceLastFamilyCall =
    new Map<string, PeopleCodeReference>();

  /*
   * Bare GetRecord(Record.X) has a narrower reuse scope than GetSetId.
   * It may reuse a same-name RECORD only inside the current control group.
   */
  let reuseRecordReferenceWithinControlGroup = false;
  const recordReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

  /*
   * A call that is reuse-participating for its OWN Record.X argument (i.e.
   * checks `recordReferencesByControlGroup` before allocating) is not
   * necessarily a call whose resulting reference should become visible to a
   * LATER RowScrollSelect/ScrollSelect call's "participating" lookup (see
   * `participatingRecordReferencesByControlGroup`'s own comment).
   *
   * ScrollFlush is the proven counter-example. AE_UPGCONV_WRK.AE_REFRESH.
   * FieldChange (definition 840, established before ScrollFlush was ever
   * added to the reuse-participating list) and ARCH_WRK.PSARCH_COPY_ROWS.
   * FieldChange (definition 1283) both show:
   *
   *   ScrollFlush(Record.X);
   *   RowScrollSelect(1, Record.X, Record.X, ...);   // or ScrollSelect
   *
   * ScrollFlush's own Record.X argument correctly reuses an EARLIER
   * participating call's row when one exists in the control group
   * (definition 1236's fix), but when ScrollFlush itself is the FIRST
   * reference and must allocate fresh, that fresh allocation must NOT be
   * treated as a "participating" source for a later RowScrollSelect/
   * ScrollSelect call to find -- those calls must still allocate their own
   * fresh row (reusing only each other, within their own call). Scoped to
   * this one proven exception rather than re-deriving participation from
   * scratch for every entry already on the broader reuse list.
   */
  let marksControlGroupParticipant = false;

  /*
   * Unlike `recordReferencesByControlGroup` (populated by EVERY Record.X
   * allocation regardless of context), this parallel map is populated
   * only when the allocation itself happened while
   * `reuseRecordReferenceWithinControlGroup` was already true -- i.e.
   * only by an already-recognized reuse-participating call (ActiveRowCount,
   * GetRecord, DeleteRow, etc, see that flag's own trigger list). It lets
   * RowScrollSelect distinguish "an earlier PARTICIPATING call already
   * established this RECORD row in the current control group, reuse it"
   * from "some unrelated non-participating call (e.g. ScrollFlush) merely
   * happened to reference the same record name" -- see
   * `reuseRecordReferenceWithinCallArguments`'s own comment for the full
   * definition-27-vs-definition-840 evidence this distinction is based on.
   */
  const participatingRecordReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

  /*
   * Scroll.X is generally occurrence-based, but GetRowset(Scroll.X) has a
   * narrower reuse rule within a control group.
   *
   * DERIVED_CO.FUNCLIB.FieldFormula proves two separate
   * GetRowset(Scroll.CRSE_SESSN_VW) calls in the same function/control group
   * both point to the original SCROLL dependency rather than allocating a
   * second PSPCMNAME row.
   */
  let reuseScrollReferenceWithinControlGroup = false;
  const scrollReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

  /*
   * Field.X is generally occurrence-based ("Repeated-Field calibration
   * proves FIELD rows are occurrence-based" -- see fieldReference()), but
   * GetField(Field.X) on a .GetRecord(...) chain result has a narrower
   * reuse rule within a control group, mirroring GetRecord's own Record.X
   * reuse rule exactly.
   *
   * ADDRESS_SBR.COUNTRY.FieldChange (definition 524) proves two identical
   * &RS_Country.GetRow(1).GetRecord(Record.COUNTRY_TBL).GetField(Field.DESCR).Value
   * chains (one on the LHS-adjacent statement, one on the RHS a statement
   * later, same control group) both reuse the same PSPCMNAME FIELD row for
   * `Field.DESCR` -- not just the already-calibrated RECORD reuse for
   * `Record.COUNTRY_TBL`.
   */
  let reuseFieldReferenceWithinControlGroup = false;
  const fieldReferencesByControlGroup =
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
    const enteringTopLevel = controlDepth === 0;
    if (enteringTopLevel) controlGroup = nextControlGroup++;
    controlDepth++;
    try {
      parse();
    } finally {
      controlDepth--;
      /*
       * A top-level control-structure block (For/If/Evaluate) is bounded
       * on both sides: whatever follows it at top level starts a fresh
       * allocation group too, not a reuse-resumption of whatever group was
       * active before the block began.
       *
       * ARCH_TBL.RECNAME.SavePreChange (definition 1269) proves this:
       *
       *   &ALL_ROWS = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_CTRL);
       *   For &K = 1 To &ALL_ROWS
       *      ...
       *   End-For;
       *   &ALL_ROWS = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_OTH_CTRL);
       *
       * The second top-level ActiveRowCount's Record.ARCH_TBL argument
       * allocates a fresh PSPCMNAME row rather than reusing the row the
       * first (pre-loop) ActiveRowCount call allocated, even though both
       * calls are plain top-level statements with no control structure of
       * their own and would previously have shared controlGroup 0.
       */
      controlGroup = enteringTopLevel ? nextControlGroup++ : previousGroup;
    }
  };
  let reuseRowShorthandRecord = false;
  let captureRowsetElementRecord = false;
  const rowShorthandRecords = new Map<string, PeopleCodeReference>();
  const rowsetElementRecords = new Map<string, PeopleCodeReference>();
  const rowsetRecordNamesByVariable = new Map<string, string>();
  const level0RowsetRecordsByField = new Map<string, PeopleCodeReference>();
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

  /*
   * Row-shorthand RECORD dependencies can also be reused across different
   * Rowset/Row bases inside the same control group.
   *
   * DERIVED_CO.FUNCLIB.FieldFormula proves:
   *
   *   &SessionRowset(&j).DERIVED_HR.OPEN_SEATS.Value
   *   ...
   *   &CourseRowset(CurrentRowNumber()).DERIVED_HR.SORTBY_COURSE_SESS.Visible
   *
   * Both use the same PSPCMNAME RECORD.DERIVED_HR dependency. Keep this pool
   * separate from explicit Record.X reuse so we do not broaden that behavior
   * beyond the evidence.
   */
  const rowShorthandRecordsByControlGroup =
    new Map<string, PeopleCodeReference>();
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
        /*
         * DERIVED_HR.LOOKUP_NID_BTN.FieldChange (definition 5687):
         *
         *   ScrollFlush(Record.NID_SRCH_VW);
         *   &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_SRCH_VW1, ...);
         *   Else
         *   ScrollFlush(Record.NID_SRCH_VW);
         *   &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_DEP_SRCH_V1, ...);
         *
         * The If-branch's ScrollSelect (a RowScrollSelect-family call)
         * clears `genericRecordReferencesSinceLastFamilyCall` on completion
         * (see that map's own declaration). The Else-branch's ScrollFlush
         * then reuses NID_SRCH_VW via THIS check, not a fresh allocation --
         * but that reuse must re-populate the map so the Else-branch's own
         * ScrollSelect (another family call, right after) can still find
         * it as a single-occurrence candidate. Without this, the row would
         * wrongly look "gone" merely because the carrying call happened to
         * be a reuse rather than a fresh allocation.
         */
        genericRecordReferencesSinceLastFamilyCall.set(
          `${controlGroup}:${recordName.toLowerCase()}`,
          existing
        );
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

    if (reuseRecordReferenceWithinCallArguments) {
      const participating = participatingRecordReferencesByControlGroup.get(
        `${controlGroup}:${recordName.toLowerCase()}`
      );

      if (participating !== undefined) {
        return referenceOperand(participating);
      }

      const existing = recordReferencesWithinCallArguments.get(
        recordName.toLowerCase()
      );

      if (existing !== undefined) {
        return referenceOperand(existing);
      }

      /*
       * See `singleOccurrenceCallArgumentRecordNames`'s own declaration
       * (definition 1220 vs definition 1283): a name that appears only
       * once across this whole call's own argument list may still reuse
       * an EARLIER, same-control-group row (e.g. an immediately preceding
       * ScrollFlush's own allocation) -- unlike a name repeated within
       * this call, which normally stays call-private per the two checks
       * above.
       *
       * Read from `genericRecordReferencesSinceLastFamilyCall`, not
       * `recordReferencesByControlGroup` directly -- see that map's own
       * declaration (definition 843 vs definition 860) for why an
       * intervening RowScrollSelect-family call must invalidate this.
       *
       * A name REPEATED within this call may ALSO reuse that earlier row,
       * but only when nested inside a control-flow block (`controlDepth >
       * 0` -- If/For/While/Evaluate/etc), not at the flat top level.
       * AE_WRK.AE_REFRESH.FieldChange (definition 889, inside a Function's
       * `Evaluate ... When` body), AMM_DERIVED.PT_FORCE_RETRY.FieldChange
       * (definition 1007, inside nested top-level `If` blocks) and
       * DERIVED_BAS.BN_TOGGLE.ODEM_RemoteCall (definition 1749, inside a
       * Function's own `If` body) all prove a single-argument
       * `ScrollFlush(Record.X); RowScrollSelect(N, Record.X, Record.X,
       * ...)` / `ScrollSelect(...)` pair DOES share one row when nested --
       * disproving definition 840/1283's own flat-top-level non-reuse
       * ONLY at that same nesting depth: BENCHMARK.ARCH_FLT_RQST's own
       * definition 1220 (this fallback's ORIGINAL evidence) is itself
       * nested inside an `If %PanelGroup = ... Then` block, and 840/1283's
       * OWN repeated-name ScrollFlush/ScrollSelect pairs sit at flat
       * top level (`controlDepth === 0`) with no wrapping block at all --
       * so `controlDepth` is the actual discriminator this fallback was
       * always missing, not "single occurrence vs repeated".
       */
      if (
        singleOccurrenceCallArgumentRecordNames?.has(
          recordName.toLowerCase()
        ) ||
        controlDepth > 0
      ) {
        const controlGroupExisting =
          genericRecordReferencesSinceLastFamilyCall.get(
            `${controlGroup}:${recordName.toLowerCase()}`
          );

        if (controlGroupExisting !== undefined) {
          return referenceOperand(controlGroupExisting);
        }
      }
    }

    if (reuseFetchValueRecord) {
      const existing = fetchValueRecordReferences.get(
        `${controlGroup}:${recordName.toLowerCase()}`
      );
      if (existing !== undefined) {
        return referenceOperand(existing);
      }
    }

    const reference = nextReference({
      kind: 'record',
      recordName
    });

    if (reuseFetchValueRecord) {
      fetchValueRecordReferences.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }

    if (reuseRecordReferenceWithinCallArguments) {
      recordReferencesWithinCallArguments.set(
        recordName.toLowerCase(),
        reference
      );
    }

    if (options.explicitChainReuse) {
      explicitRecordReferences.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }

    /*
     * A RowScrollSelect/RowScrollSelectNew call's OWN Record.X arguments
     * are private to that call: they must not become visible to a LATER
     * statement's own control-group-scoped reuse check (the unconditional
     * write below, otherwise shared by every other Record.X allocation).
     *
     * ANL_MOD_DAT_SRC.QRYNAME.FieldChange (definition 1172):
     *
     *   RowScrollSelectNew(2, Record.ANL_MOD_DAT_SRC, &N_DATA_SRC_NUM, Record.ANL_MOD_DIM_FLD, Record.QRY_FLD_VW, "...", ANL_MOD_DAT_SRC.QRYNAME);
     *   &N_FLD_COUNT = ActiveRowCount(Record.ANL_MOD_DAT_SRC, &N_DATA_SRC_NUM, Record.ANL_MOD_DIM_FLD);
     *
     * both in the same control group. The immediately-following
     * ActiveRowCount call's own Record.ANL_MOD_DAT_SRC/Record.
     * ANL_MOD_DIM_FLD arguments do NOT reuse RowScrollSelectNew's rows --
     * stored allocates two fresh ones -- even though ActiveRowCount is
     * itself a normal reuse-participating call that WOULD otherwise find
     * them via this map. Scoped narrowly to
     * `reuseRecordReferenceWithinCallArguments` (true only while parsing
     * a RowScrollSelect/RowScrollSelectNew call's own argument list, see
     * that flag's own declaration) so every other Record.X allocation
     * keeps writing here exactly as before.
     */
    if (
      !reuseRecordReferenceWithinCallArguments &&
      !suppressRecordReferenceControlGroupWrite
    ) {
      recordReferencesByControlGroup.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
      genericRecordReferencesSinceLastFamilyCall.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }
    if (marksControlGroupParticipant) {
      participatingRecordReferencesByControlGroup.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }
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
    //
    // GetField(Field.X) on a .GetRecord(...) chain result is the one
    // evidenced exception: it reuses within the current control group
    // (see reuseFieldReferenceWithinControlGroup's declaration comment).
    if (reuseFieldReferenceWithinControlGroup) {
      const key = `${controlGroup}:${fieldName.toLowerCase()}`;
      const existing = fieldReferencesByControlGroup.get(key);

      if (existing !== undefined) {
        return referenceOperand(existing);
      }
    }

    const reference = nextReference({
      kind: 'field',
      fieldName
    });

    if (reuseFieldReferenceWithinControlGroup) {
      fieldReferencesByControlGroup.set(
        `${controlGroup}:${fieldName.toLowerCase()}`,
        reference
      );
    }

    return referenceOperand(reference);
  };

  const scrollReference = (): Buffer => {
    if (!word('Scroll')) return fail('expected Scroll');
    if (source[pos] !== '.') return fail('expected . after Scroll');
    pos++;

    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected scroll name after Scroll.');
    pos += recordName.length;

    if (reuseScrollReferenceWithinControlGroup) {
      const key =
        `${controlGroup}:${recordName.toLowerCase()}`;
      const existing =
        scrollReferencesByControlGroup.get(key);

      if (existing !== undefined) {
        return referenceOperand(existing);
      }

      const reference = nextReference({
        kind: 'scroll',
        recordName
      });

      scrollReferencesByControlGroup.set(
        key,
        reference
      );

      return referenceOperand(reference);
    }

    // Outside the calibrated GetRowset() context, preserve the long-standing
    // occurrence-based SCROLL allocation behavior.
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

  /*
   * Quoted 0x48 references are deduplicated by qualifier + quoted value
   * WITHIN THE SAME CONTROL GROUP, not globally across the whole program.
   *
   * ACA_XML_WRK.ACA_UPDATE_PB.FieldChange (definition 369) proves the
   * reuse case: two `Transfer(...)` calls, `MenuName."ACA_SETUP_RPT"` and
   * `BarName."USE"` identical in both, sit inside the SAME top-level `If
   * %Page = "ACA_XMIT_ACK" Then ... Else If All(...) Then ... End-If;
   * End-If;` -- one Then-branch's nested call and the Else's nested call,
   * sharing one control group (only the outermost `If` bumps it) -- both
   * compiled uses point back to the same PSPCMNAME rows.
   *
   * AE_DERIVED.AE_TEMPTBL_BTN.FieldChange (definition 805) disproves
   * reusing that GLOBALLY: its own two `Transfer(...)` calls, with an
   * IDENTICAL `BarName."USE"`, sit in two SEPARATE top-level `If
   * %PanelGroup <> ... Then ... End-If;` / `If %PanelGroup = ... Then
   * ... End-If;` statements -- different control groups -- and stored
   * allocates a completely fresh row for the second call's `BarName.
   * "USE"` (NAMENUM 15, not reusing NAMENUM 7's row from the first call).
   */
  const quotedReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

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

        // See `quotedReferencesByControlGroup`'s own declaration
        // (definition 369 vs definition 805) for why this must be scoped
        // by control group, not deduplicated globally.
        const quotedKey =
          `${controlGroup}:${storedQualifier.toLowerCase()}:${refName.toLowerCase()}`;
        let reference = quotedReferencesByControlGroup.get(quotedKey);

        if (reference === undefined) {
          reference = nextReference({
            kind: 'quoted-reference',
            recordName: storedQualifier,
            fieldName: refName
          });
          quotedReferencesByControlGroup.set(quotedKey, reference);
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

  const startsRemComment = (
    start = pos
  ): boolean =>
    /^(?:REM|remark)\b/i.test(source.slice(start));

  const remComment = (
    allowMissingSemicolon = false,
    allowIndentedSemicolonContinuation = false
  ): Buffer => {
    const match = /^(?:REM|remark)\b[^\r\n]*/i.exec(source.slice(pos));

    if (!match) {
      return fail('expected REM comment');
    }

    let remText = match[0].replace(/[ \t]+$/g, '');
    let consumedLength = match[0].length;

    /*
     * A REM line with no terminating ';' of its own is not yet a complete
     * comment token -- PeopleTools continues merging immediately
     * consecutive REM lines (no blank line between them), embedded line
     * break included, until one of them actually closes with ';'.
     *
     * AMM_DERIVED.DELETE_BTN.RowInit (definition 964):
     *
     *   rem PSCHNLDEFN is a deprecated table in PT 8.48 and above.
     *   rem SQLExec("select ...", AMM_SYNCLIST.MSGNAME, &archive);
     *
     * Line 1 has no ';' of its own (a continued comment, not a complete
     * statement), so it merges with line 2 (which does close with ';')
     * into one 0x24 record covering both lines.
     *
     * AMM_ARCHIVE_WK.XML3_PB.FieldChange (definition 937) proves the
     * merge must STOP once a line already closes with ';' of its own,
     * rather than blindly merging every immediately-consecutive REM line
     * regardless:
     *
     *   rem AMM_DERIVED.MSGNAME = PSAPMSGARCHSC.MSGNAME;
     *   rem AMM_DERIVED.SUBNAME = PSAPMSGARCHSC.SUBNAME;
     *   rem AMM_DERIVED.APMSGVER = PSAPMSGARCHSC.APMSGVER;
     *
     * Each of these three lines closes with its own ';', so each is
     * already a complete rem statement -- stored has three SEPARATE 0x24
     * records (96, 96, and 100 bytes), not one 296-byte merged record.
     */
    while (!remText.endsWith(';')) {
      const nextLineMatch =
        /^(\r?\n)((?:REM|remark)\b[^\r\n]*)/i.exec(
          source.slice(pos + consumedLength)
        );

      if (nextLineMatch) {
        remText +=
          nextLineMatch[1] + nextLineMatch[2].replace(/[ \t]+$/g, '');
        consumedLength += nextLineMatch[0].length;
        continue;
      }

      /*
       * An If-header REM can comment out the rest of a condition across an
       * indented continuation line. This is safe to recognize only in that
       * caller's before-Then position, and only when the continuation closes
       * with its own semicolon:
       *
       *   If None(...)
       *      REM And
       *         &disabled = 1;
       *      Then
       *
       * GPTH_RC_PIT90.SaveEdit (definition 22751) stores both REM lines in
       * one 0x24 payload immediately before the 0x1F Then opcode. Keep the
       * ordinary REM parser narrow everywhere else so it cannot absorb an
       * indented executable statement speculatively.
       */
      if (allowIndentedSemicolonContinuation) {
        const indentedContinuation =
          /^(\r?\n)([ \t]+[^\r\n]*;[ \t]*)/.exec(
            source.slice(pos + consumedLength)
          );

        if (indentedContinuation) {
          remText +=
            indentedContinuation[1] +
            indentedContinuation[2].replace(/[ \t]+$/g, '');
          consumedLength += indentedContinuation[0].length;
          continue;
        }
      }

      /*
       * Three DERIVED_GVT captures (definitions 5424-5426) continue a REM
       * payload onto one single-space prose line without repeating REM:
       *
       *   REM KJB Removed code ... as it is
       *    no longer valid, as Record.REVIEW_GOALS is obsolete;
       *
       * PeopleTools stores both physical lines, including the newline and
       * final semicolon, in one 0x24 payload. Keep this deliberately narrower
       * than ordinary indented source so a semicolon-less REM does not absorb
       * the next PeopleCode statement.
       */
      const proseContinuation =
        /^(\r?\n)( [^ \t\r\n][^\r\n]*)/.exec(
          source.slice(pos + consumedLength)
        );

      if (!proseContinuation) break;

      remText +=
        proseContinuation[1] +
        proseContinuation[2].replace(/[ \t]+$/g, '');
      consumedLength += proseContinuation[0].length;
    }

    if (!allowMissingSemicolon && !remText.endsWith(';')) {
      return fail('expected ; at end of REM comment');
    }

    const payload = Buffer.from(remText, 'utf16le');

    if (payload.length > 0xffff) {
      return fail('REM comment exceeds uint16 byte-length field');
    }

    const header = Buffer.alloc(3);
    header[0] = 0x24;
    header.writeUInt16LE(payload.length, 1);

    pos += consumedLength;

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
    /*
     * A `&variable` name may start with a digit and continue with letters
     * -- not just be either letter-led or purely numeric. `[A-Za-z0-9_]+`
     * is a strict superset of the previous two-branch alternation
     * (letter-led identifiers and pure-digit names both still match
     * identically), additively covering the mixed digit-prefix case.
     *
     * WEBLIB_HSE.ISCRIPT1.FieldFormula (definition 21765, one of 27
     * corpus occurrences of this exact shape):
     *
     *   Local number &80EE_pin_num, &HSEPRP_pin_num, ...;
     *
     * `&80EE_pin_num` is a single variable name; the previous regex could
     * only match its `&80` prefix (via the `\d+` branch), leaving
     * `EE_pin_num` to break the declaration's own comma/semicolon check.
     */
    const match = /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos));
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

    const numberMatch = /^([0-9]+)(?:\.([0-9]+))?/.exec(source.slice(pos));
    if (numberMatch) {
      const [wholeMatch, integerPart, fractionPart] = numberMatch;
      /*
       * A decimal literal (e.g. `33.34`, `9999999.99`) stores its
       * fractional digit count as a *scale* byte alongside the same
       * 0x50 magnitude field an integer literal uses -- the decoder
       * already reconstructs `value / 10^scale` (see `formatScaled()`
       * in decoder.ts, "found by refusing" pass thirty-four), but the
       * encoder previously only ever parsed bare integer digits, always
       * writing a zero scale. Without this, a decimal literal's `.`
       * was left for the general postfix-chain parser to choke on,
       * expecting a member name after what it saw as a `.` operator.
       *
       * CAN_AMEND_RL1_D.CORRECTED_AMOUNT.FieldFormula (definition 2291,
       * one of many corpus occurrences of this shape):
       *
       *   If CAN_AMEND_RL1_D.CORRECTED_AMOUNT > 9999999.99 Then
       */
      const scale = fractionPart?.length ?? 0;
      // Bound conversion before BigInt, including arbitrarily many leading
      // zeros. Never route the magnitude through a lossy JS Number.
      const canonical = (integerPart + (fractionPart ?? '')).replace(/^0+/, '') || '0';
      if (canonical.length > MAX_INTEGER_DIGITS) fail('unsigned integer exceeds the 128-bit magnitude field');
      let magnitude = BigInt(canonical);
      if (magnitude > MAX_UNSIGNED_INTEGER) fail('unsigned integer exceeds the 128-bit magnitude field');
      if (scale > 0xff) fail('decimal literal scale exceeds the 1-byte scale field');
      const { opcode, operandLength, valueOffset, valueBytes } = UNSIGNED_NUMBER_FORMAT;
      const bytes = Buffer.alloc(1 + operandLength);
      bytes[0] = opcode;
      // The zero prefix stays zero. Write the scale, then the entire
      // little-endian magnitude field; integer division never rounds
      // through floating point.
      bytes[2] = scale;
      for (let i = 0; i < valueBytes; i++) {
        bytes[1 + valueOffset + i] = Number(magnitude & 0xffn);
        magnitude >>= 8n;
      }
      pos += wholeMatch.length;
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

      if (!/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
        chunks.push(typeName());
        continue;
      }

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

    /*
     * A comment between a boolean operator and its right operand is
     * inline (0x4E) if it continues the operator's own line, or
     * standalone (0x24) if it starts a new line -- see
     * `blockCommentByPlacement()`. PSIBLOGICL2_WRK.IB_FIELDTYPE_GUI
     * calibrates the inline case: `... = "0" Or /* Save or Reset *\/ ...
     * = "1"`. HS_EXAM_AUDIO2.<various>.FieldChange proves the standalone
     * case, with two own-line comments in a row after `And`:
     *
     *   If None(AUDIOMETRIC_TST.EXAM_TYPE_CD) And
     *         /***** Start of Resolution 597700 ******\/
     *         /*The below error message will be thrown ... *\/
     *         &DEL = "FALSE"
     */
    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    if (source[pos] === '@') {
      pos++;
      chunks.push(fixed('@'));
      space();
      if (source[pos] !== '(') return fail('expected ( after @');
      parenthesized(expression, false);
      space();
      const operator =
        /^(<>|<=|>=|=|<|>)/.exec(source.slice(pos))?.[0];
      if (operator !== undefined) {
        pos += operator.length;
        chunks.push(fixed(operator));
        expression();
      }
      return;
    } else if (
      /^\(\s*&[A-Za-z0-9_]+#?(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*\s*\)\s*\./
        .test(source.slice(pos))
    ) {
      /*
       * Parentheses may group an object/field expression before a postfix
       * property access; they are not necessarily a parenthesized boolean
       * subexpression. Let primary() consume the group and its postfix chain.
       *
       * PRCSRUNCNTL_WRK.<fields> (definitions 14194-14196):
       *
       *   If (&recRunCtlLang.LANGUAGE_CD).IsInBuf Then
       *
       * stores 0x0B...0x14 for the grouped field, followed by ordinary
       * member access and Then.
       */
      comparisonExpression();
      return;
    } else if (source[pos] === '(') {
      parenthesized(booleanExpression, false);
      space();

      /*
       * A parenthesized group here may turn out to have held PURE
       * arithmetic (no top-level And/Or/comparison of its own) that is
       * itself only part of a larger arithmetic expression, not the
       * complete boolean operand -- the parenthesized group is just its
       * first primary. Continue the same flat left-to-right arithmetic
       * loop `expression()` itself uses before re-checking for a
       * trailing comparison operator.
       *
       * BAS_PARTIC_PLAN.FLAT_DED_AMT.SavePreChange (one of 5 corpus
       * occurrences of this shape):
       *
       *   If ((BAS_PARTIC_PLAN.FLAT_DED_AMT / &MAX_AMT) * 100) > DERIVED_BAS.EMPL_PCT_BTAX Then
       *
       * Without this, closing the outer paren fails outright: the inner
       * `(... / &MAX_AMT)` group is parsed and closed correctly, but the
       * trailing `* 100` is left unconsumed, so the outer paren's own
       * close is never reached.
       */
      while (true) {
        const arithmeticOperator = /^[+\-*/|]/.exec(source.slice(pos))?.[0];
        if (!arithmeticOperator) break;
        pos += arithmeticOperator.length;
        chunks.push(fixed(arithmeticOperator, arithmeticOperator === '*' ? 0x0f : undefined));
        castPrimary();
        space();
      }

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

  /*
   * Look past any leading `/* ... *\/` block comments (each followed by
   * ordinary whitespace) to determine whether `keyword` follows, without
   * consuming any source. Used to decide whether an And/Or-group
   * continues when a standalone comment sits between the last operand
   * and the next `And`/`Or`, e.g.:
   *
   *   PanelGroup.HS_INJ_ILL_REHAB
   *      /* Start of Resolution Id: 305302 *\/
   *      Or
   *      %Component = ...
   *
   * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value stores this comment as an
   * ordinary standalone 0x24 record positioned right after the 0x41
   * And/Or-group-open marker, before the `Or` keyword itself.
   */
  const restStartsWithKeywordPastComments = (keyword: RegExp): boolean => {
    let peek = pos;
    while (true) {
      while (peek < source.length && /\s/.test(source[peek])) peek++;
      if (source.startsWith('/*', peek)) {
        const end = source.indexOf('*/', peek + 2);
        if (end < 0) return false;
        peek = end + 2;
        continue;
      }
      break;
    }
    return keyword.test(source.slice(peek));
  };

  /*
   * A block comment renders as a standalone 0x24 record when it starts
   * on its own source line, or an inline 0x4E record when it continues
   * the same line as whatever precedes it -- the same distinction
   * `blockComment()`/`inlineBlockComment()` already draw elsewhere, just
   * decided here from the comment's own position rather than a fixed
   * per-call-site choice. Looks backward from `pos` (already positioned
   * at the comment's own `/*`) past only spaces/tabs, not newlines.
   *
   * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value proves both shapes can appear
   * around the SAME And/Or-group and If/Then boundary depending purely
   * on line placement:
   *
   *   If %PanelGroup = PanelGroup.HS_INJ_ILL_REHAB
   *         /* Start of Resolution Id: 305302 *\/    -- own line -> 0x24
   *         Or
   *         %Component = Component.HS_NE_INJILL_REHAB
   *      /* End of Resolution Id: 305302 *\/          -- own line -> 0x24
   *      Then
   */
  const blockCommentStartsOwnLine = (): boolean => {
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    return i < 0 || source[i] === '\n' || source[i] === '\r';
  };

  const blockCommentByPlacement = (): Buffer =>
    blockCommentStartsOwnLine() ? blockComment() : inlineBlockComment();

  const andExpression = () => {
    booleanUnary();
    space();

    if (!restStartsWithKeywordPastComments(/^And\b/i)) {
      return;
    }

    /*
     * An INLINE (same-line) comment between the first operand and the
     * group's first `And` still belongs to that operand's own token
     * stream, emitted BEFORE the group-open 0x41 -- the opposite order
     * from a STANDALONE (own-line) comment, which belongs to the group
     * itself and is emitted AFTER 0x41.
     *
     * BANKACCT_SBR.ACCOUNT_EC_ID.FieldFormula (definition 1411):
     *
     *   If %Component = "GPSC_BANK_ACC_FL" /*FLUID*\/ And
     *
     * stores `... "GPSC_BANK_ACC_FL" 4E<comment> 41 18(And) ...` -- the
     * inline comment directly after the string literal, THEN 0x41, THEN
     * `And`. Contrast HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value's own-line
     * comment before `Or` (definition 6509), which stores
     * `... 41 24<comment> 1E(Or) ...` -- 0x41 first.
     */
    while (source.startsWith('/*', pos) && !blockCommentStartsOwnLine()) {
      chunks.push(inlineBlockComment());
      space();
    }

    chunks.push(Buffer.from([0x41]));

    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    while (restStartsWithKeywordPastComments(/^And\b/i)) {
      /*
       * A standalone/inline comment may likewise sit between a PRIOR
       * operand and a SUBSEQUENT `And` in the same multi-operand group
       * (not just before the group's first `And`, handled above) --
       * mirrored from that same check for this loop's own re-entry
       * condition. HS_INJ_WORK.CHECK_BOX.FieldChange (definition 6507)
       * proves this with a THREE-operand Or-chain where the comment sits
       * between the second and third operands, not the first and
       * second.
       */
      while (source.startsWith('/*', pos)) {
        chunks.push(blockCommentByPlacement());
        space();
      }

      pos += 3;
      chunks.push(fixed('And'));

      /*
       * A blank line may separate `And` from its next operand, inside a
       * multi-line boolean condition -- encoded the same blank-line 0x4F
       * marker way as every other calibrated boundary in this file, not
       * previously handled at all inside an And-group.
       *
       * BAS_PARTIC_PLAN.ANNUAL_PLEDGE.SaveEdit (definition 1643):
       *
       *   If None(&RSLT) And
       *
       *         All(&PLEDGE) Then
       *
       * stores one 0x4F between the `And` keyword and `All(&PLEDGE)`.
       */
      const operandWhitespaceStart = pos;
      space();
      const operandWhitespace = source.slice(operandWhitespaceStart, pos);
      if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(operandWhitespace)) {
        const markerCount = Math.max(
          1,
          (operandWhitespace.match(/\r?\n/g) ?? []).length - 1
        );
        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
      }

      booleanUnary();
      space();
    }

    /*
     * An INLINE (same-line) block comment may follow the last And-group
     * operand, before the group's closing 0x42 -- it still logically
     * hugs that operand. A comment starting its OWN line instead belongs
     * to whatever follows the closing 0x42 (e.g. ifStatement()'s own
     * comment-before-Then handling), not inside this group -- proven by
     * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value, whose own-line comment
     * before `Then` stores AFTER the Or-group's 0x42, not before it (see
     * booleanExpression's Or-group below for the original inline-only
     * calibrating fixture this narrows).
     */
    if (source.startsWith('/*', pos) && !blockCommentStartsOwnLine()) {
      chunks.push(inlineBlockComment());
      space();
    }

    chunks.push(Buffer.from([0x42]));
  };

  const booleanExpression = () => {
    andExpression();
    space();

    if (!restStartsWithKeywordPastComments(/^Or\b/i)) {
      return;
    }

    /*
     * See andExpression()'s identical check: an INLINE comment before
     * the group's first `Or` is emitted before the group-open 0x41; a
     * STANDALONE one is emitted after it.
     */
    while (source.startsWith('/*', pos) && !blockCommentStartsOwnLine()) {
      chunks.push(inlineBlockComment());
      space();
    }

    chunks.push(Buffer.from([0x41]));

    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    while (restStartsWithKeywordPastComments(/^Or\b/i)) {
      /*
       * See andExpression()'s identical re-entry check for a comment
       * between a prior operand and a SUBSEQUENT `Or` (definition 6507's
       * three-operand chain).
       */
      while (source.startsWith('/*', pos)) {
        chunks.push(blockCommentByPlacement());
        space();
      }

      pos += 2;
      chunks.push(fixed('Or'));

      /*
       * Mirrors andExpression()'s own blank-line-before-next-operand fix
       * (definition 1643) -- only the And-group shape was directly
       * evidenced, but the Or-group has the identical code shape and is
       * presumably subject to the same rule (same pattern fix #7 already
       * used for the inline-comment case just below).
       */
      const operandWhitespaceStart = pos;
      space();
      const operandWhitespace = source.slice(operandWhitespaceStart, pos);
      if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(operandWhitespace)) {
        const markerCount = Math.max(
          1,
          (operandWhitespace.match(/\r?\n/g) ?? []).length - 1
        );
        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
      }

      andExpression();
      space();
    }

    /*
     * An INLINE (same-line) block comment may follow the last Or-group
     * operand, before the group's closing 0x42 -- it still logically
     * hugs that operand. A comment starting its OWN line instead belongs
     * to whatever follows the closing 0x42, not inside this group.
     *
     * BANKACCT_SBR.ACCOUNT_EC_ID.FieldFormula (definition 1406):
     *
     *   If (%Component = Component.PYE_BANKACCT Or
     *         %Component = "GPSC_BANK_ACC_FL" /*FLUID*\/) And
     *
     * stores the inline 0x4E comment immediately before the Or-group's
     * closing 0x42, not after it (same line as the last operand).
     * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value's own-line comment before
     * `Then` instead stores AFTER the Or-group's 0x42 (picked up by
     * ifStatement()'s own comment-before-Then handling), proving the
     * own-line case must NOT be consumed here.
     */
    if (source.startsWith('/*', pos) && !blockCommentStartsOwnLine()) {
      chunks.push(inlineBlockComment());
      space();
    }

    chunks.push(Buffer.from([0x42]));
  };

  const comparisonExpression = () => {
    expression();
    space();

    /*
     * `Not =` / `Not >` (a space-separated `Not` immediately before an
     * ordinary comparison operator) compile as two literal, separate
     * tokens -- `Not` (0x1d) directly followed by the operator's own
     * punctuation opcode (`=` is 0x06, `>` is 0x09) -- never translated
     * into a single combined opcode (e.g. `<>` is a genuinely distinct
     * single opcode, 0x10, not just an alternate rendering of `Not =`).
     * Only `=` and `>` are attested in the corpus after `Not`; `<`,
     * `<=`, `>=`, `<>` never appear there.
     *
     * PAY_LINE.BENEFIT_PROGRAM.FieldEdit (definition 23620):
     *
     *   If &BEN_SYSTEM Not = "BA" And
     *         &BEN_SYSTEM Not = "BN" And
     *         None(PAY_LINE.BENEFIT_PROGRAM) Then
     *
     * PI_DEFN_RECORD.EFFDT.SavePreChange (definition 11267, one of 11
     * corpus occurrences of `Not >`):
     *
     *   If &recCount Not > 1 Then
     */
    const notOperator =
      /^Not\s*([=>])/i.exec(source.slice(pos));

    if (notOperator) {
      pos += 3;
      chunks.push(fixed('Not'));
      space();
      pos += 1;
      chunks.push(fixed(notOperator[1]));
      expression();
      return;
    }

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

    /*
     * An inline block comment may sit between the last parenthesized
     * token and the closing ")", encoded the same same-line 0x4E way as
     * any other inline trailing comment.
     *
     * BANKACCT_SBR.ACCOUNT_EC_ID.FieldFormula (definition 1406):
     *
     *   If (%Component = Component.PYE_BANKACCT Or
     *         %Component = "GPSC_BANK_ACC_FL" /*FLUID*\/) And
     *
     * stores ... 4E 12 00 "/*FLUID*\/" 42 ... immediately before the ")".
     */
    if (source.startsWith('/*', pos)) {
      chunks.push(inlineBlockComment());
      space();
    }

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
    const name = /^[A-Za-z_][A-Za-z0-9_]*#?/.exec(source.slice(pos))?.[0];
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

    let reference: PeopleCodeReference | undefined =
      same(ownerReference.recordName, recordName) &&
      same(ownerReference.fieldName, fieldName)
        ? ownerReference
        : undefined;

    reference ??= references.find(
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
    if (appClass.wildcard) sawWildcardImport = true;
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

  /*
   * Non-consuming structural lookahead for the statement dispatcher.
   * It distinguishes a real call-result property assignment such as
   * `GetPageField(..., "EDIT").Label = value` from a plain call whose
   * string argument contains JavaScript like
   * `getElementById(...).style.visibility = ...`. A regex cannot tell the
   * source-level postfix chain from the lookalike text inside the string.
   */
  const balancedLookaheadEnd = (
    start: number,
    open: '(' | '[',
    close: ')' | ']'
  ): number => {
    if (source[start] !== open) return -1;

    let depth = 0;
    let peek = start;
    while (peek < source.length) {
      if (source[peek] === '"') {
        peek++;
        while (peek < source.length) {
          if (source[peek] !== '"') {
            peek++;
            continue;
          }
          if (source[peek + 1] === '"') {
            peek += 2;
            continue;
          }
          peek++;
          break;
        }
        continue;
      }

      if (source.startsWith('/*', peek)) {
        const commentEnd = source.indexOf('*/', peek + 2);
        if (commentEnd < 0) return -1;
        peek = commentEnd + 2;
        continue;
      }

      if (source[peek] === open) depth++;
      if (source[peek] === close) {
        depth--;
        if (depth === 0) return peek + 1;
      }
      peek++;
    }

    return -1;
  };

  const startsCallResultPropertyAssignment = (start: number): boolean => {
    const callName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(start))?.[0];
    if (callName === undefined) return false;

    let peek = start + callName.length;
    while (/\s/.test(source[peek] ?? '')) peek++;
    peek = balancedLookaheadEnd(peek, '(', ')');
    if (peek < 0) return false;

    let sawMember = false;
    while (true) {
      while (/\s/.test(source[peek] ?? '')) peek++;

      if (source[peek] === '.') {
        peek++;
        while (/\s/.test(source[peek] ?? '')) peek++;
        const member = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(peek))?.[0];
        if (member === undefined) return false;
        sawMember = true;
        peek += member.length;
        while (/\s/.test(source[peek] ?? '')) peek++;
        if (source[peek] === '(') {
          peek = balancedLookaheadEnd(peek, '(', ')');
          if (peek < 0) return false;
        }
        continue;
      }

      if (source[peek] === '(') {
        peek = balancedLookaheadEnd(peek, '(', ')');
        if (peek < 0) return false;
        continue;
      }

      if (source[peek] === '[') {
        peek = balancedLookaheadEnd(peek, '[', ']');
        if (peek < 0) return false;
        continue;
      }

      break;
    }

    while (/\s/.test(source[peek] ?? '')) peek++;
    return sawMember && source[peek] === '=';
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
    } else if (word('PanelGroup')) {
      panelGroupDeclaration();
    } else if (word('ComponentLife')) {
      componentLifeDeclaration();
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
      } else if (/^-?\d/.test(source.slice(pos))) {
        /*
         * `Exit N;` (a bare numeric literal, no parentheses) is a
         * distinct, unparenthesized alternative to `Exit(N);`.
         *
         * ACA_EXTRACT_AET.<various>.FieldFormula (definition 25166, one
         * of 197 corpus occurrences of this exact shape):
         *
         *   If ... Then
         *      Exit 1;
         *   End-If;
         */
        expression();
      } else {
        pos = afterExit;
      }

    } else if (word('Continue')) {
      /*
       * `Continue` is not in the general OPCODES table: 0x6E is heavily
       * overloaded corpus-wide with unrelated byte values outside this
       * exact grammatical position (see decoder.ts's gated `opcode ===
       * 0x6e && bytes[i] === 0x15` handling), so `fixed('Continue')` has
       * no unambiguous entry to find. The encoder already knows the
       * source keyword is literally `Continue` here -- unlike the
       * decoder, which has to infer intent from a raw byte -- so 0x6E can
       * be emitted directly with no ambiguity.
       * Continue is the context-gated 0x6E statement opcode. It stays out
       * of the general fixed-token table because 0x6E is overloaded outside
       * the `Continue;` shape, but the encoder is already inside a parsed
       * Continue statement here and can select it unambiguously.
       *
       * PRCSRUNCNTL_WRK.<fields> (definitions 14194-14196) independently
       * store `Else Continue;` as 0x19 0x6E 0x15.
       */
      chunks.push(Buffer.from([0x6e]));

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

    } else if (
      source[pos] === '&' ||
      source[pos] === '@' ||
      source[pos] === '%'
    ) {
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
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      primary();
      space();

      if (source[pos] === '=') {
        pos++;

        const assignedLevel0Rowset =
          /^\s*GetLevel0\s*\(\s*\)\s*\(\s*[^)]*\)\s*\.\s*GetRowset\s*\(\s*Scroll\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/i
            .exec(source.slice(pos));
        if (
          statementVariable !== undefined &&
          rowsetVariables.has(statementVariable.toLowerCase())
        ) {
          if (assignedLevel0Rowset !== null) {
            rowsetRecordNamesByVariable.set(
              statementVariable.toLowerCase(),
              assignedLevel0Rowset[1]
            );
          } else {
            rowsetRecordNamesByVariable.delete(statementVariable.toLowerCase());
          }
        }

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
      }
      /*
       * A variable-led method-call statement (e.g. `&RS.DeleteRow(&i)`)
       * may itself omit its trailing source semicolon under the same
       * conditions a bare (non-variable-led) call statement already can
       * -- primary() has already consumed the complete chain above; the
       * caller's own body-terminator check (e.g. `expected ; in For
       * body`, which already allows omission immediately before
       * `End-For`) decides whether the omission is legal here, exactly
       * as it does for the bare-call statement branch below.
       *
       * GPMY_RC_RCPT_FL.GPMY_RCPNT_OPTN.FieldFormula (definition 9256):
       *
       *   For &i = &RS.ActiveRowCount To 1 Step - 1
       *      &RS.DeleteRow(&i)
       *   End-For
       */
    } else if (/[A-Za-z_]/.test(source[pos] ?? '')) {
      const tail = source.slice(pos);
      if (/^Record\s*\./i.test(tail)) {
        const statementStart = pos;
        primary();
        const endsWithMethodCall = /\)\s*$/.test(
          source.slice(statementStart, pos)
        );
        space();
        if (source[pos] === '=') {
          pos++;
          chunks.push(fixed('='));
          expression();
        } else if (!endsWithMethodCall) {
          fail('expected = after explicit Record field chain');
        }
      } else if (/^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)) {
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
      } else if (startsCallResultPropertyAssignment(pos)) {
        /*
         * A call-result property chain may traverse more than one dotted
         * member before the assigned property, e.g.
         * `GetRecord().GPS_BDG_ORG2.SqlText = ExpandSqlBinds(...);`
         * (definition 9989 and 25 other corpus occurrences) --
         * `GetRecord()` then RECORD member `GPS_BDG_ORG2` then FIELD
         * member `SqlText`, not just the single-member
         * `Name(args).Property =` shape this branch originally matched.
         * primary() already walks an arbitrarily long postfix chain.
         */
        primary();
        space();
        if (source[pos] !== '=') {
          fail('expected assignment = after call-result property');
        }
        pos++;
        chunks.push(fixed('='));
        expression();
      } else {
        /*
         * A bare call statement may itself be the head of a postfix
         * chain rather than a standalone call, e.g. a call-result
         * indexed and then invoked further:
         *
         *   GetLevel0()(1).GetRowset(Scroll.PSIBDOMSTATUSVW).Flush();
         *
         * Plain call() only consumes "Name(args)" and returns, leaving
         * the rest of the chain unconsumed and the statement failing its
         * trailing ";" check. primary() consumes the complete call/
         * member/index chain (it already handles the plain "Name(args);"
         * case identically, via the same call() internally), matching
         * the call-result-property-assignment branch just above.
         *
         * AMM_DERIVED.IB_SAVE_PB.FieldChange (definition 984).
         */
        primary();
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

    const afterNameWhitespaceStart = pos;
    space();
    const afterNameWhitespace = source.slice(afterNameWhitespaceStart, pos);

    // Parameters
    if (source[pos] === '(') parenthesized(() => {
      space();

      if (source[pos] === ')') {
        return;
      }

      while (true) {
        const paramName =
          /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
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
          if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
            chunks.push(applicationClassPath().bytes);
          } else {
            const isArrayType = /^array\b/i.test(source.slice(pos));
            const paramType =
              /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
            chunks.push(typeName());
            if (isArrayType) {
              arrayElementTypes();
            } else if (/^Row$/i.test(paramType ?? '')) {
              /*
               * AGC_CAT_ASGNEE.AGC_CATEGORY_ID.FieldFormula (definition
               * 921) proves an object-typed Function PARAMETER allocates
               * the same implicit PACKAGE dependency row a `Local Row
               * &var;` declaration already does -- this was entirely
               * missing for parameters:
               *
               *   Function DeleteCatAssignee(&rowCategory As Row, ...)
               *
               * allocates PACKAGE/ROW before the function body's own
               * `Local Rowset ...;` allocates its PACKAGE/ROWSET, shifting
               * every reference index after it by one relative to a
               * parameter-parsing path that skips this allocation
               * entirely. Only `Row` is evidenced so far -- Record/Field/
               * Rowset/SQL/File/XmlDoc/XmlNode/ApiObject parameters may
               * need the same treatment but are unconfirmed; do not
               * generalize without evidence.
               */
              ensureLocalObjectPackageReference('ROW', 'Row');

              /*
               * AGC_CAT_STEP.AGC_CATEGORY_ID.FieldFormula (definition 924)
               * proves a second, related gap: a `Row`-typed PARAMETER also
               * needs to join the `rowVariables` set, exactly like a
               * `Local Row &var;` declaration already does --
               * `rowStartsRecordFieldChain`'s two-dot lookahead (the
               * mechanism that puts a Row variable's `.RECORD.FIELD` chain
               * into PSPCMNAME reference mode) only checks that set, and
               * the parameter-parsing loop never populated it:
               *
               *   Function InitStepDefautAssigneeSection(&rCurrCatTbl As
               *       Row, &rCurrentStep As Row)
               *      ...
               *      &rCurrentStep.AGC_DERIVED_ASG.GROUPBOX4.Visible = &nShow;
               *
               * Without this, `.AGC_DERIVED_ASG.GROUPBOX4` fell through to
               * plain inline text instead of two chained 0x4A RECORD/FIELD
               * references.
               */
              if (paramName !== undefined) {
                rowVariables.add(paramName.toLowerCase());
              }
            }
          }
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
      source.slice(afterParamsWhitespaceStart, pos) || afterNameWhitespace;

    // Optional return type.
    if (word('Returns')) {
      chunks.push(fixed('Returns'));

      space();
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
        chunks.push(applicationClassPath().bytes);
      } else {
        const isArrayType = /^array\b/i.test(source.slice(pos));
        chunks.push(typeName());
        if (isArrayType) arrayElementTypes();
      }

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
    /*
     * A standalone block/disabled-code comment appearing before ANY Local
     * declaration is a complete leading body item of its own. A blank line
     * between it and the first Local declaration still gets a 0x4F marker,
     * exactly like blank lines elsewhere in the body do -- but the ordinary
     * top-of-loop marker check below is gated on `enteredExecutableSection`,
     * which is not yet true this early (no Local seen yet, no executable
     * statement reached yet), so that gap went unmarked entirely.
     *
     * ADJ_CN_TAX_BAL.BALANCE_YEAR.FieldFormula (definition 634):
     *
     *   Function TAX_CLASS_CAN_List();
     *      /* Set up dropdown list of Tax Class for balance adjustment *\/
     *
     *      Local Rowset &Xlat;
     *
     * stores the blank line between the comment and `Local Rowset` as one
     * 0x4F marker (`... 4F 44 0A "Rowset" ...`), which the encoder was
     * dropping entirely.
     */
    let sawLeadingComment = false;

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
        (enteredExecutableSection ||
          (sawLeadingComment && !sawLocalDeclaration)) &&
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

      /*
       * A blank line between leading Local declarations and whatever
       * follows them (an executable statement OR a standalone comment)
       * contributes a 0x4f boundary. An ordinary newline does not
       * (DERIVED_HR_DR.HR_DR_CONTINUE1_PB.FieldChange, ValidateData).
       *
       * This transition check must run BEFORE the comment branches below,
       * not just before ordinary statement parsing: AMM_ARCHIVE_WK.
       * FUNCLIB.FieldFormula (definition 935) proves a standalone comment
       * immediately after the leading Local run needs this same marker --
       *
       *   Local string &segmentsunordered;
       *
       *   /* Archived Details Component *\/
       *
       * -- and the comment branches `continue` immediately after
       * consuming the comment, so if this check ran after them (as it
       * used to) it would never fire for a comment at all.
       */
      const isLocal = /^Local\b/i.test(source.slice(pos));

      if (!isLocal && sawLocalDeclaration && !enteredExecutableSection) {
        if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace)) {
          const markerCount = Math.max(1, (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1);
          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
        }
        enteredExecutableSection = true;
      }

      /*
       * A standalone block comment inside an already-entered Function
       * executable section is a complete body item and does not require a
       * following 0x15 statement terminator.
       *
       * DERIVED_CO.FUNCLIB.FieldFormula calibrates:
       *
       *   &HeaderRowset = ...;
       *
       *   [standalone block comment: set wording of 'no rows found' message]
       *   &Rowset(1).DERIVED_HR.NO_RESULTS.Value = ...;
       *
       * Stored shape:
       *
       *   ... 15 4F 24 <comment> 01 ...
       *
       * The generic Function-body path previously sent the comment through
       * statement() and then incorrectly required ';', producing
       * "expected ; in Function body".
       *
       * A comment immediately after leading Locals is likewise a complete
       * body item. The decoded source can render an original same-line 0x4E
       * comment on a separate line; comment opcode provenance preserves it.
       */
      if (source.startsWith('<*', pos)) {
        chunks.push(disabledCodeComment());
        if (!sawLocalDeclaration && !enteredExecutableSection) {
          sawLeadingComment = true;
        }
        continue;
      }

      if (source.startsWith('/*', pos)) {
        chunks.push(blockComment());
        if (!sawLocalDeclaration && !enteredExecutableSection) {
          sawLeadingComment = true;
        }
        continue;
      }

      /*
       * Unlike the main program's top level (where flat sequential
       * statements share one control group by default, only bumping on
       * specific triggers like SetDefault or a top-level CreateRecord
       * assignment), each top-level-of-a-Function-body statement gets its
       * OWN fresh control group -- including plain assignments, not just
       * bare calls. Nested control structures within the function (If/
       * For/etc, once entered via inControlGroup()) are unaffected: they
       * keep the ordinary shared-group reuse behavior for their own body,
       * exactly like top-level program code does.
       *
       * AE_WRK.AE_GO.FieldChange (definition 871), `Function man_stmt`:
       *
       *   InsertRow(Record.AE_STMT_TBL, ActiveRowCount(Record.AE_STMT_TBL));
       *   &TO_ROW = ActiveRowCount(Record.AE_STMT_TBL);
       *   CopyFields(1, Record.AE_TOOLS_CHK_VW, &ROW, 1, Record.AE_STMT_TBL, &TO_ROW);
       *
       * proves InsertRow's own Record.AE_STMT_TBL argument is reused ONLY
       * by its own nested ActiveRowCount(...) argument (same statement,
       * same group) -- the very next statement's OWN
       * `ActiveRowCount(Record.AE_STMT_TBL)` does NOT reuse it (fresh
       * row), and CopyFields' Record.AE_STMT_TBL argument two statements
       * later is ALSO fresh, not reusing either prior one. Direct
       * stored-PSPCMNAME enumeration confirms this pattern (each of the
       * three flat statements gets its own row for AE_STMT_TBL, some used
       * more than once only via nesting within their own statement).
       */
      if (controlDepth === 0 && !isLocal) {
        controlGroup = nextControlGroup++;
      }

      const isRemStatement = startsRemComment();
      if (isRemStatement) {
        chunks.push(remComment(true));
      } else {
        statement();
      }

      if (isLocal) {
        sawLocalDeclaration = true;
      } else {
        enteredExecutableSection = true;
      }

      if (isRemStatement) {
        /*
         * remComment() already consumed its own trailing ';' as part of
         * matching the rest of its source line, unlike an ordinary
         * statement whose semicolon is still ahead of `pos` at this point
         * (the `space()` call below exists to skip whitespace BEFORE that
         * still-unconsumed semicolon, not to skip whitespace after it).
         * Calling `space()` here for a REM statement would therefore eat
         * a following blank line that the NEXT loop iteration (or the
         * dedicated blank-line-before-End-Function check) needs intact.
         *
         * AMM_ARCHIVE_WK.FUNCLIB.FieldFormula (definition 935):
         *
         *   rem &xmldoc = GetArchPubHeaderXmlDoc(..., &xmlsegmentindex);
         *
         *   End-Function;
         *
         * was losing this blank line's 0x4F marker entirely.
         */
      } else {
        space();

        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        } else if (/^End-Function\b/i.test(source.slice(pos))) {
          // PeopleTools accepts a Return immediately before End-Function
          // without a semicolon (common in exported corpus source).
        } else {
          fail('expected ; in Function body');
        }
      }
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
        const catchHeaderTrailingWhitespaceStart = pos;
        space();

        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

        let firstCatchBodyItem = true;

        while (true) {
          const catchBodyWhitespaceStart = pos;
          space();

          /*
           * Blank formatting lines inside a catch body are preserved as
           * 0x4F source-group boundaries, including right after the catch
           * header (before the first body item) and before end-try.
           *
           * ADDRESSES.EMPLID.SavePostChange (definition 521):
           *
           *   catch Exception &ex
           *
           *   end-try;
           *
           * stores the blank line between the catch header and end-try as
           * a single 0x4F. The catch-header trailing whitespace is
           * consumed by the semicolon check above, before this loop's own
           * whitespace tracking starts, so the first iteration must look
           * back across that earlier span instead of its own (empty) one.
           */
          const catchBodyWhitespace = source.slice(
            firstCatchBodyItem
              ? catchHeaderTrailingWhitespaceStart
              : catchBodyWhitespaceStart,
            pos
          );
          firstCatchBodyItem = false;

          if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(catchBodyWhitespace)) {
            const markerCount = Math.max(
              1,
              (catchBodyWhitespace.match(/\r?\n/g) ?? []).length - 1
            );

            for (let marker = 0; marker < markerCount; marker++) {
              chunks.push(Buffer.from([0x4f]));
            }
          }

          if (source.startsWith('/*', pos)) {
            chunks.push(blockComment());
            continue;
          }

          if (startsRemComment()) {
            chunks.push(remComment(true));
            continue;
          }

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

      /*
       * Blank formatting lines inside a try body are preserved as 0x4F
       * source-group boundaries, the same way they are immediately before
       * catch above. This includes the boundary right after the `try`
       * header, before its first body item.
       *
       * ADDRESSES.EMPLID.SavePostChange (definition 521):
       *
       *   try
       *
       *      If CheckFieldExists(...) Then
       *
       * stores the blank line between `try` and the first body statement
       * as a single 0x4F.
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

      if (source.startsWith('/*', pos)) {
        chunks.push(blockComment());
        continue;
      }

      if (startsRemComment()) {
        chunks.push(remComment(true));
        continue;
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
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('Until')) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

        chunks.push(fixed('Until'));

        space();
        booleanExpression();
        return;
      }

      if (pos === source.length) {
        fail('expected Until');
      }

      /*
       * A Repeat body may contain a standalone `/* ... *\/` comment or a
       * REM comment, the same way every other body loop (If/While/For/
       * Evaluate) already does -- this body loop had neither at all.
       *
       * PA_PYE_DATA.PYE_ARCHIVE.FieldFormula (one of several corpus
       * occurrences of a standalone comment inside a Repeat body):
       *
       *   Repeat
       *      /*** ... valid ***\/
       *      &THIS_REPEAT_ROWS = &rs1.ActiveRowCount;
       *   Until ...
       */
      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

        chunks.push(blockComment());
        continue;
      }

      if (/^REM\b/i.test(source.slice(pos))) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

        chunks.push(remComment(true));
        continue;
      }

      statement();

      space();
      if (source[pos] !== ';') {
        /*
         * The final statement in a Repeat body may omit its source
         * semicolon when it is immediately followed by Until, the same
         * way a While body already can before End-While.
         *
         * TRN_SML_SUM.FUNCLIB.FieldFormula (one of several corpus
         * occurrences):
         *
         *   Repeat
         *      ...
         *      &ROW3_DEMAND_ID = FetchValue(TRN_SML_SUM_VW.DEMAND_ID, &ROW3)
         *   Until &ROW3_DEMAND_ID = &ROW2_DEMAND_ID;
         */
        if (!/^Until\b/i.test(source.slice(pos))) {
          fail('expected ; in Repeat body');
        }
        continue;
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

      if (startsRemComment()) {
        chunks.push(remComment(true));
        continue;
      }

      // An extra semicolon is an empty statement and is retained as its own
      // 0x15 token. PSIBLOGICL2_WRK.IB_LINKDOC has this inside a For body:
      // `&recPage = &row.GetRecord(Record.PSDOCLOPAGE);;`.
      if (source[pos] === ';') {
        pos++;
        chunks.push(fixed(';'));
        firstForBodyItem = false;
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
        /*
         * The final statement in a For body may omit its source semicolon
         * when it is immediately followed by End-For, the same way a
         * top-level If/Evaluate/assignment may omit its semicolon at EOF.
         *
         * CAN_TAX_TYPE.SOURCE_TAX.RowInit (definition 2406):
         *
         *   For &i = ActiveRowCount(...) To 1 Step - 1
         *      DeleteRow(Record.CAN_TAX_TYPE, &Current_Row_1, ...)
         *   End-For;
         *
         * and ARCH_TBL.RECNAME.SavePreChange (definition 1269), where the
         * omitted statement is itself a compound If block:
         *
         *   For &K = 1 To &ALL_ROWS
         *      UpdateValue(...);
         *      If &K = 1 Then
         *         UpdateValue(...);
         *      End-If
         *   End-For;
         *
         * Both decode back to this exact source (SOURCE MATCH), so no 0x15
         * token is stored for the omitted semicolon; only fail when the
         * statement is not immediately followed by End-For.
         */
        if (!/^End-For\b/i.test(source.slice(pos))) {
          fail('expected ; in For body');
        }
        continue;
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
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('End-While')) {
        /*
         * Preserve blank-line multiplicity immediately before End-While,
         * mirroring ifStatement()'s identical End-If handling above --
         * this branch was previously missing entirely.
         *
         * CO_STATETAX_TBL.EFFDT.FieldChange (definition 3235):
         *
         *   &AccountsModified = True;
         *
         *   End-If;
         *
         *   End-While;
         *
         * stores a 0x4F boundary before End-While just as it does before
         * the enclosing End-If.
         */
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

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

      /*
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path -- mirroring
       * ifStatement()'s identical REM handling above, which a While body
       * was entirely missing (only If/For/Evaluate/try bodies had it).
       *
       * PSXP_PRCSDEFN.CI_PROPERTY.FieldFormula (definition 9661):
       *
       *   While &CIProperties.Fetch(&PropertyName, &RecName, &Fieldname)
       *
       *      REM MessageBox(0, "", 0, 0, "&RecName = " | &RecName | ...);
       */
      if (startsRemComment()) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

        chunks.push(remComment(true));
        continue;
      }

      statement();

      space();
      if (source[pos] !== ';') {
        /*
         * The final statement in a While body may omit its source
         * semicolon when it is immediately followed by End-While, the
         * same way a For body already can before End-For.
         *
         * GPGB_RC_CTL.GPGB_RC_APPLD.FieldFormula (definition 7041):
         *
         *   While ...
         *      ...
         *      &i = &i + 1
         *   End-While;
         */
        if (!/^End-While\b/i.test(source.slice(pos))) {
          fail('expected ; in While body');
        }
        continue;
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

    /*
     * A block comment may appear between an If condition and Then, either
     * inline (0x4E, continuing the condition's own line) or standalone
     * (0x24, starting a new line) -- see `blockCommentByPlacement()`.
     *
     *   If &HeaderRowset(&i).Visible = True [inline block comment] Then
     *
     * DERIVED_CO.FUNCLIB.FieldFormula stores that comment as 0x4E directly
     * between the completed condition and the 0x1F Then opcode:
     *
     *   ... 06 2F 4E <comment> 1F ...
     *
     * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value proves the standalone case:
     * its own comment sits on its own line right before `Then` and
     * stores as 0x24, not 0x4E.
     */
    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    /*
     * A REM between the completed condition and Then is an opaque disabled
     * condition tail, not an executable If-body statement. Definitions
     * 22751 and 8781 independently store it as 0x24 directly before 0x1F;
     * 22751 also proves the payload may continue onto one indented line.
     */
    while (startsRemComment()) {
      chunks.push(remComment(true, true));
      space();
    }

    if (!word('Then')) {
      fail('expected Then');
    }
    chunks.push(fixed('Then'));

    /*
     * A block comment attached directly to Then is encoded as 0x4E, not as
     * a standalone 0x24 body comment.
     *
     * DERIVED_CO.FUNCLIB.FieldFormula:
     *
     *   If &NbrSessions = 0 Then [inline block comment]
     *
     * Stored shape:
     *
     *   ... 1F 4E <comment> ...
     *
     * Keep this source-side rule narrow: only horizontal whitespace may occur
     * between Then and the comment. A comment beginning on a later source line
     * remains subject to the ordinary If-body comment rules.
     */
    const afterThen = pos;
    let afterThenScan = pos;
    while (
      afterThenScan < source.length &&
      (source[afterThenScan] === ' ' || source[afterThenScan] === '\t')
    ) {
      afterThenScan++;
    }

    if (source.startsWith('/*', afterThenScan)) {
      pos = afterThenScan;
      chunks.push(inlineBlockComment());
    } else {
      pos = afterThen;
    }

    const afterInlineThenComment = pos;
    space();
    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
    } else {
      pos = afterInlineThenComment;
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
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );
          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

        chunks.push(fixed('Else'));

        /*
         * `Else` may carry its own optional, immediately-following `;`
         * before its body starts on the next line -- stored as a bare
         * `19 15` (Else then `;`), with nothing else in between (no
         * separate newline/boundary marker the way a `When` clause
         * header's own trailing `;` needs).
         *
         * PA_DFN_OPT_SET.FORM_CD_PROMPT.RowInit (definition 12251, one of
         * several corpus occurrences of this exact shape):
         *
         *   Else;
         *      DERIVED.FORM_CD_PROMPT = "PA_DFN_FORM_VW";
         *   End-If;
         */
        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

        /*
         * A block comment attached directly to Else is encoded as 0x4E.
         *
         * DERIVED_CO.FUNCLIB.FieldFormula:
         *
         *   Else [inline block comment]
         *
         * Stored shape:
         *
         *   ... 19 4E <comment> ...
         *
         * Restrict this to horizontal whitespace so a comment beginning on a
         * later line remains an ordinary Else-body comment.
         */
        const afterElse = pos;
        let afterElseScan = pos;
        while (
          afterElseScan < source.length &&
          (source[afterElseScan] === ' ' || source[afterElseScan] === '\t')
        ) {
          afterElseScan++;
        }

        if (source.startsWith('/*', afterElseScan)) {
          pos = afterElseScan;
          chunks.push(inlineBlockComment());
        } else {
          pos = afterElse;
        }

        break;
      }

      if (word('End-If')) {
        if (hasBlankLine) {
          /*
           * Preserve blank-line multiplicity immediately before End-If.
           * One ordinary newline is line separation; each additional newline
           * contributes one 0x4F boundary.
           *
           * DERIVED_CO.FUNCLIB.FieldFormula proves a case with two blank
           * formatting lines before End-If, stored as:
           *
           *   ... 15 4F 4F 1A ...
           */
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
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
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path.
       *
       * Blank-line marker multiplicity before REM follows the same rule
       * as every other body-item boundary in this same loop (the
       * sibling `<*`/`/*` branches just above, and End-If below) -- this
       * branch was pushing exactly one marker regardless of actual
       * blank-line count.
       *
       * ADDRESS_TYPE_FL.EMPLID.SavePreChange (definition 534): TWO blank
       * lines before `REM TriggerPDHEvent_Fluid(GetRow());` inside a
       * nested If body store TWO 0x4F markers, not one.
       */
      if (startsRemComment()) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

        chunks.push(remComment(true));
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
      } else if (!/^(?:Else|End-If|REM)\b/i.test(source.slice(pos))) {
        /*
         * A statement immediately followed by a REM comment (no
         * intervening statement of its own) may likewise omit its
         * trailing source semicolon, the same way one immediately
         * before Else/End-If already can.
         *
         * FUNCLIB_HR.FIELDVALUE_ERROR.FieldEdit (definition 13181):
         *
         *   Error MsgGet(2050, 10, "Field Text Type required for
         *      Field Type of VALUE")
         *   rem error "Text cannot be blank for VALUE field type ";
         *   End-If;
         */
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
          /*
           * Preserve blank-line multiplicity immediately before End-If.
           * One ordinary newline is line separation; each additional newline
           * contributes one 0x4F boundary.
           *
           * DERIVED_CO.FUNCLIB.FieldFormula proves a case with two blank
           * formatting lines before End-If, stored as:
           *
           *   ... 15 4F 4F 1A ...
           */
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
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
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path.
       *
       * Blank-line marker multiplicity before REM follows the same rule
       * as every other body-item boundary in this same loop (the
       * sibling `<*`/`/*` branches just above, and End-If below) -- this
       * branch was pushing exactly one marker regardless of actual
       * blank-line count.
       *
       * ADDRESS_TYPE_FL.EMPLID.SavePreChange (definition 534): TWO blank
       * lines before `REM TriggerPDHEvent_Fluid(GetRow());` inside a
       * nested If body store TWO 0x4F markers, not one.
       */
      if (startsRemComment()) {
        if (hasBlankLine) {
          const markerCount = Math.max(
            1,
            (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
          );

          for (let marker = 0; marker < markerCount; marker++) {
            pendingReferenceGroupBoundaries.push(chunks.length);
          }
        }

        chunks.push(remComment(true));
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

      // Evaluate may carry a REM comment between its selector and first When.
      // PSXPRPTDEFN_WRK.PROPTYPE stores it directly as a 0x24 comment record.
      if (!sawWhen && startsRemComment()) {
        chunks.push(remComment(true));
        continue;
      }

      /*
       * A standalone block comment may likewise appear between the
       * selector and the first When, stored the same direct 0x24 way as
       * the REM case above.
       *
       * AE_WRK.AE_DECIDE.FieldChange (definition 858):
       *
       *   Evaluate AE_WRK.AE_DECIDE
       *      /*
       *       Keep track of how many pending updates there are
       *      *\/
       *   When "T"
       */
      if (!sawWhen && source.startsWith('/*', pos)) {
        chunks.push(blockComment());
        continue;
      }

      if (word('When-Other')) {
        if (sawWhenOther) {
          fail('duplicate When-Other');
        }

        sawWhenOther = true;
        chunks.push(fixed('When-Other'));
        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

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

          if (startsRemComment()) {
            if (hasBlankLine) {
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            }

            chunks.push(remComment(true));
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

          /*
           * The LAST statement in a `When-Other` body may omit its
           * trailing `;` when immediately followed by `End-Evaluate` --
           * the same allowance the ordinary `When` body loop already
           * grants any statement type before `When`/`When-Other`/
           * `End-Evaluate`, and mirrors the proven EOF-omission
           * allowance for other self-terminating top-level statement
           * shapes (assignments/If/Evaluate/bare calls/try), just at
           * this body-closing boundary instead of true source EOF.
           *
           * PTAFAW_NOTIFY.PTAFEVENT.<event> (definition 18001) is the
           * `Break`-only case this allowance originally covered; the
           * corpus also has plain assignments in the same position, e.g.
           * PA_RT_TBL.DERIVED.BEN_PLAN_EDIT (definitions 12623/12626):
           *
           *   When-Other
           *      DERIVED.BEN_PLAN_EDIT = "PA_RT_FORM_VW"
           *   End-Evaluate
           */
          statement();

          space();

          /*
           * A block comment may appear between a When-Other body
           * statement's expression and its own terminating semicolon, the
           * same way top-level statements and If/For/While bodies already
           * allow -- inline (0x4E) or standalone (0x24) by placement.
           *
           * GPFR_AF_RUNCTL.DERIVED_GPFR_AF.FieldChange (definition 5000):
           *
           *   When-Other
           *      &Evtsel(&i).DERIVED_GPFR_AF.GPFR_AF_EXTRACT_ID.Enabled = True /*False*\/;
           */
          while (source.startsWith('/*', pos)) {
            chunks.push(blockCommentByPlacement());
            space();
          }

          if (source[pos] !== ';') {
            /*
             * The last statement in a When-Other body may omit its source
             * semicolon immediately before End-Evaluate. This is the same
             * boundary rule already used by ordinary When bodies below; it
             * is not limited to Break/Continue.
             *
             * PA_RT_SCHED_VW.BENEFIT_PLAN.RowInit (definition 12623)
             * proves the assignment form, while definitions 5000 and 15626
             * independently prove concatenation and Return expressions:
             *
             *   When-Other
             *      DERIVED.BEN_PLAN_EDIT = "PA_RT_FORM_VW"
             *   End-Evaluate
             *
             * None stores a 0x15 statement terminator before 0x3F.
             */
            if (/^End-Evaluate\b/i.test(source.slice(pos))) {
              continue;
            }

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

        /*
         * An inline trailing comment on the When header line (same line as
         * the selector value) is emitted BEFORE the structural 0x2D
         * boundary, not after it -- the same inline-vs-standalone ordering
         * already proven for And/Or-group leading comments.
         *
         * HR_ILL_NLD_AET.ABSENCE_TYPE.RowInit (definition 27819):
         *
         *   When "SKN" /*Sickness - SKN *\/
         *      &reason_sick = "1";
         *
         * stores `... "SKN" 00 4E ... 2D ...` (comment then 0x2D), not
         * `... "SKN" 00 2D 24 ...` (0x2D then a standalone-style comment).
         */
        if (/^[ \t]*\/\*/.test(source.slice(pos))) {
          space();
          if (source.startsWith('/*', pos) && !blockCommentStartsOwnLine()) {
            chunks.push(inlineBlockComment());
          }
        }

        /*
         * The structural 0x2D boundary comes BEFORE a When header's own
         * optional trailing source semicolon, not after it -- the reverse
         * of the order this previously emitted.
         *
         * CONTRACT.PAYMENT_TERM.FieldChange (definition 3062):
         *
         *   When = "X";
         *      UnGray(CONTRACT.PAYMENT_END_DT);
         *
         * stores `... "X" 2D 15 0A "UnGray" ...` (0x2D then 0x15), not
         * `... "X" 15 2D ...`.
         */
        chunks.push(Buffer.from([0x2d]));

        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

        let selectorWhitespaceStart = pos;
        while (
          selectorWhitespaceStart > 0 &&
          /\s/.test(source[selectorWhitespaceStart - 1])
        ) {
          selectorWhitespaceStart--;
        }
        const selectorTrailingWhitespace =
          source.slice(selectorWhitespaceStart, pos);
        if (
          /(?:\r?\n)[ \t]*(?:\r?\n)/.test(selectorTrailingWhitespace)
        ) {
          /*
           * Preserve every blank formatting line between a When header and
           * its first body statement, the same way other calibrated
           * blank-line boundaries do: one ordinary newline is line
           * separation, each additional newline contributes one 0x4F.
           *
           * ADDRESSES.EMPLID.RowInit (definition 518):
           *
           *   When Component.RA_PERS_DATA
           *
           *
           *      DERIVED_ADDR.SELF_SERVE.Enabled = False;
           *
           * has two blank lines after the When header and stores 4F 4F, not
           * a single 4F.
           */
          const markerCount = Math.max(
            1,
            (selectorTrailingWhitespace.match(/\r?\n/g) ?? []).length - 1
          );
          for (let marker = 0; marker < markerCount; marker++) {
            chunks.push(Buffer.from([0x4f]));
          }
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
          if (startsRemComment()) {
            if (hasBlankLine) {
              const markerCount = Math.max(
                1,
                (bodyWhitespace.match(/\r?\n/g) ?? []).length - 1
              );

              for (let marker = 0; marker < markerCount; marker++) {
                chunks.push(Buffer.from([0x4f]));
              }
            }

            chunks.push(remComment(true));
            continue;
          }

          if (hasBlankLine) {
            chunks.push(Buffer.from([0x4f]));
          }

          statement();

          space();

          /*
           * A standalone comment may sit between a completed When-body
           * statement (itself omitting its own semicolon, e.g. a nested
           * `If ... End-If` with no trailing `;`) and the next `When`/
           * `End-Evaluate`, the same way one already can before those
           * keywords with no comment in between.
           *
           * CAR_PLAN_TBL.MAX_LIST_AMT.FieldFormula (definition 2484):
           *
           *   End-If
           *   /* Lease *\/
           *   When = "L"
           */
          if (
            source[pos] !== ';' &&
            source.startsWith('/*', pos) &&
            restStartsWithKeywordPastComments(/^(?:When(?:-Other)?|End-Evaluate)\b/i)
          ) {
            while (source.startsWith('/*', pos)) {
              chunks.push(blockCommentByPlacement());
              space();
            }
          }

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
    /^[A-Za-z_][A-Za-z0-9_]*#?/.exec(source.slice(pos))?.[0];

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
   *
   * RowScrollSelect does NOT share this GLOBAL by-name rule, despite
   * being added to this same trigger list in an earlier bulk pass with no
   * citation of its own. AE_UPGCONV_WRK.AE_REFRESH.FieldChange (definition
   * 840) disproves it directly:
   *
   *   ScrollFlush(Record.MESSAGE_LOG);
   *   RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "...", &PI);
   *
   * ScrollFlush's own Record.MESSAGE_LOG allocates its own row (NAMENUM
   * 3). RowScrollSelect's FIRST Record.MESSAGE_LOG argument does NOT
   * reuse it (fresh NAMENUM 4) -- so RowScrollSelect isn't on the global
   * by-name list -- but its SECOND Record.MESSAGE_LOG argument, in the
   * SAME call, DOES reuse the first (also NAMENUM 4) -- so it isn't
   * plain occurrence-based either. See
   * `reuseRecordReferenceWithinCallArguments`/
   * `recordReferencesWithinCallArguments` (declared near
   * `reuseRecordReferenceByName`) for the narrower "reuse only within
   * this call's own argument list" scope this actually needs.
   *
   * `ScrollSelect` (no leading "Row") shares RowScrollSelect's exact same
   * call-arguments-only rule, NOT the GLOBAL by-name rule it was bulk-added
   * to alongside GetSetId/Gray/UnGray -- same mis-citation pattern.
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283) disproves the
   * global rule directly:
   *
   *   ScrollFlush(Record.ARCH_CTRL_VW2);
   *   ...
   *   ScrollSelect(1, Record.ARCH_CTRL_VW2, Record.ARCH_CTRL_VW2, &WHERE, &ARCHIVE_ID, &PARENT_TBL);
   *
   * ScrollFlush's own Record.ARCH_CTRL_VW2 allocates its own row.
   * ScrollSelect's own two Record.ARCH_CTRL_VW2 arguments do NOT reuse
   * it -- stored allocates a fresh row for them -- but the two arguments
   * DO reuse each other within that same call. Moved to
   * `reuseRecordReferenceWithinCallArguments`, mirroring RowScrollSelect.
   */
  const previousReuseRecordReferenceByName =
    reuseRecordReferenceByName;
  const previousReuseFetchValueRecord =
    reuseFetchValueRecord;
  const previousReuseRecordReferenceWithinControlGroup =
    reuseRecordReferenceWithinControlGroup;
  const previousMarksControlGroupParticipant =
    marksControlGroupParticipant;
  const previousReuseRowShorthandRecord =
    reuseRowShorthandRecord;
  const previousCaptureRowsetElementRecord =
    captureRowsetElementRecord;
  const previousReuseScrollReferenceWithinControlGroup =
    reuseScrollReferenceWithinControlGroup;
  const previousReuseRecordReferenceWithinCallArguments =
    reuseRecordReferenceWithinCallArguments;
  const previousRecordReferencesWithinCallArguments =
    recordReferencesWithinCallArguments;
  const previousSingleOccurrenceCallArgumentRecordNames =
    singleOccurrenceCallArgumentRecordNames;
  const previousSuppressRecordReferenceControlGroupWrite =
    suppressRecordReferenceControlGroupWrite;

  if (/^(?:GetSetId|Gray|UnGray)$/i.test(name)) {
    reuseRecordReferenceByName = true;
  }
  if (/^FetchValue$/i.test(name)) {
    reuseFetchValueRecord = true;
  }
  if (/^PriorValue$/i.test(name)) {
    suppressRecordReferenceControlGroupWrite = true;
  }
  if (/^(?:RowScrollSelect(?:New)?|ScrollSelect)$/i.test(name)) {
    /*
     * ANALYSIS_DB_WRK.BASE_CUBE_INST_ID.FieldChange (definition 1145)
     * proves `RowScrollSelectNew` shares RowScrollSelect's exact rule:
     *
     *   RowScrollSelectNew(1, Record.ANALYSIS_DB_DIM, Record.ANALYSIS_DB_DIM, "...", ANALYSIS_DB.BASE_CUBE_INST_ID);
     *
     * Both Record.ANALYSIS_DB_DIM arguments, in the same call, reuse one
     * PSPCMNAME row. ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition
     * 1283) proves plain `ScrollSelect` (no leading "Row") shares it too.
     */
    reuseRecordReferenceWithinCallArguments = true;
    recordReferencesWithinCallArguments = new Map();

    singleOccurrenceCallArgumentRecordNames = (() => {
      if (source[pos] !== '(') return undefined;

      const counts = new Map<string, number>();
      let i = pos + 1;
      let depth = 1;

      while (i < source.length && depth > 0) {
        const ch = source[i];

        if (ch === '(') {
          depth++;
          i++;
        } else if (ch === ')') {
          depth--;
          i++;
        } else if (ch === '"') {
          i++;
          while (i < source.length && source[i] !== '"') i++;
          i++;
        } else {
          const recordMatch =
            /^Record\.([A-Za-z_][A-Za-z0-9_]*)/i.exec(source.slice(i));

          if (recordMatch) {
            const key = recordMatch[1].toLowerCase();
            counts.set(key, (counts.get(key) ?? 0) + 1);
            i += recordMatch[0].length;
          } else {
            i++;
          }
        }
      }

      const singles = new Set<string>();
      for (const [recordName, count] of counts) {
        if (count === 1) singles.add(recordName);
      }
      return singles;
    })();
  }

  /*
   * Unlike RowScrollSelect (no cross-call evidence either way yet), a
   * plain `ScrollSelect` call's OWN fresh allocations must also become
   * visible to a LATER ScrollSelect call in the same control group --
   * not merely reused within its own argument list.
   *
   * ABSENCE_HIST.ABSENCE_TYPE.RowInit (definition 30, protected baseline)
   * has two TEXTUALLY IDENTICAL calls in the same control group, each
   * inside its own `If Not RecordNew(...) Then ... End-If;`:
   *
   *   ScrollSelect(2, Record.ABSENCE_HIST, Record.ABS_HIST_DET, Record.ABS_HIST_DET, "...", ...);
   *   ...
   *   ScrollSelect(2, Record.ABSENCE_HIST, Record.ABS_HIST_DET, Record.ABS_HIST_DET, "...", ...);
   *
   * The second call's Record.ABSENCE_HIST/Record.ABS_HIST_DET arguments
   * reuse the FIRST call's own rows entirely, not fresh ones -- disproven
   * for RowScrollSelect specifically (definition 840) but proven true for
   * ScrollSelect here. Marking participating does not reopen the 1283
   * ScrollFlush-then-ScrollSelect case: a single-argument ScrollFlush call
   * still does not mark participating (see `isMultiArgScrollFlushCall`),
   * so ScrollSelect's read still finds nothing there and allocates fresh,
   * exactly as 1283 requires.
   */
  if (/^ScrollSelect$/i.test(name)) {
    marksControlGroupParticipant = true;
  }

  /*
   * GetRecord, DeleteRow and ActiveRowCount's Record.X argument reuse an
   * existing same-control-group RECORD PSPCMNAME row rather than
   * allocating a fresh one.
   *
   * CAN_TAX_TYPE.SOURCE_TAX.FieldChange (definition 2406):
   *
   *   For &i = ActiveRowCount(Record.CAN_TAX_TYPE, ..., Record.CAN_TAX_STCLASS) To 1 Step - 1
   *      DeleteRow(Record.CAN_TAX_TYPE, ..., Record.CAN_TAX_STCLASS, &i)
   *   End-For;
   *   If ... Then
   *      For &i = ActiveRowCount(Record.CAN_TAX_TYPE, ..., Record.CAN_TAX_CLASS) To 1 Step - 1
   *   ...
   *
   * stores DeleteRow's Record.CAN_TAX_TYPE and Record.CAN_TAX_STCLASS
   * reusing the exact same PSPCMNAME rows ActiveRowCount's own arguments
   * allocated two statements earlier, in the same For loop's control
   * group -- but the *second* If/For's ActiveRowCount call, in a
   * different top-level control group, allocates a *fresh* Record.
   * CAN_TAX_TYPE row rather than reusing the first loop's. ActiveRowCount
   * was previously in the reuseRecordReferenceByName set below, which
   * searches `references` globally with no control-group scoping --
   * correct only by coincidence for single-control-group fixtures, and
   * wrong here. Moving it to this control-group-scoped mechanism instead
   * (checked first in recordReference()'s lookup chain) preserves
   * identical behavior for every fixture where all ActiveRowCount calls
   * either share one control group or live at plain top level (which all
   * share controlGroup 0 unless a top-level SetDefault call bumps it),
   * and only changes output for multiple ActiveRowCount calls to the same
   * record name across genuinely different top-level control groups --
   * exactly the previously-wrong case.
   *
   * This is purely additive for GetRecord/DeleteRow:
   * recordReferencesByControlGroup is only ever populated by a reference
   * that has already occurred, so it cannot change output for a call
   * whose record name has not appeared earlier in the same control group
   * (the common case today).
   *
   * UpdateValue's own Record.X argument shares this same control-group
   * reuse rule. ARCH_TBL.RECNAME.SavePreChange (definition 1269) proves it:
   *
   *   For &K = 1 To &ALL_ROWS
   *      UpdateValue(Record.ARCH_TBL, &I, ARCH_CTRL.PSARCH_MATCH_KEY, &K, &K);
   *      If &K = 1 Then
   *         UpdateValue(Record.ARCH_TBL, &I, ARCH_CTRL.PSARCH_AND_OR, &K, " ");
   *      End-If;
   *   End-For;
   *
   * The second UpdateValue's Record.ARCH_TBL (nested one control-depth
   * deeper, but still control group 1 -- only top-level entry bumps the
   * group) reuses the exact same PSPCMNAME row the first UpdateValue's
   * Record.ARCH_TBL allocated moments earlier in the same For-loop body,
   * rather than allocating a fresh one.
   *
   * InsertRow's own Record.X argument shares the same rule. The same
   * definition 1269, deep inside a nested For/If chain within that same
   * top-level For &L loop's control group:
   *
   *   ScrollFlush(Record.ARCH_TMP_RECUNQ);
   *   ...
   *   InsertRow(Record.ARCH_TMP_RECUNQ, &RT - 1);
   *
   * reuses the ARCH_TMP_RECUNQ row already allocated earlier in that same
   * control group rather than allocating a fresh one.
   *
   * SetCursorPos's own Record.X argument shares the same rule.
   * BENEF_PB_WRK.BEN_CLEAR_PB.FieldChange (definition 1738):
   *
   *   &ActRowCnt = ActiveRowCount(Record.BEN_BI_CHARGE);
   *   SetCursorPos(%Panel, Record.BEN_BI_CHARGE, &ActRowCnt, BEN_BI_CHARGE.EMPLID);
   *
   * SetCursorPos's Record.BEN_BI_CHARGE reuses the RECORD row
   * ActiveRowCount's own argument allocated one statement earlier, in the
   * same top-level If's control group.
   *
   * This mechanism is control-group-scoped, not function-scoped -- see the
   * "top-level-of-a-Function-body statement gets its own fresh control
   * group" fix in functionStatement()'s body loop (cites definition 871)
   * for why a flat run of top-level-of-function statements does not
   * spuriously reuse each other's rows even though this reuse rule applies
   * unconditionally here.
   *
   * HideScroll/UnhideScroll/UnhideRow's own Record.X argument share the
   * same rule -- also cited by definition 871, inside
   * `Function adjust_row_num`'s nested If/Else:
   *
   *   If ActiveRowCount(Record.AE_STMT_TBL) = 1 And None(&SECTION, &STEP) Then
   *      AE_WRK.AE_ROW_COUNT = 0;
   *      HideScroll(Record.AE_STMT_TBL);
   *   Else
   *      UnhideScroll(Record.AE_STMT_TBL);
   *      AE_WRK.AE_ROW_COUNT = ActiveRowCount(Record.AE_STMT_TBL);
   *      For &ROW = ActiveRowCount(Record.AE_STMT_TBL) To 1 Step - 1
   *         UnhideRow(Record.AE_STMT_TBL, &ROW);
   *      ...
   *
   * Every one of these Record.AE_STMT_TBL mentions reuses the exact same
   * PSPCMNAME row the If's own condition allocated -- not just the ones
   * already covered by ActiveRowCount above. Before this addition,
   * HideScroll/UnhideScroll/UnhideRow's own fresh allocations (bypassing
   * the reuse check because they were not yet in this list) would
   * overwrite the shared control-group cache entry, breaking reuse for
   * every reference after them too.
   *
   * CopyFields' own Record.X arguments share the same rule. The same
   * definition 871, inside `Function man_stmt` (a flat, untriggered
   * top-level-of-function run following one InsertRow trigger statement):
   *
   *   InsertRow(Record.AE_STMT_TBL, ActiveRowCount(Record.AE_STMT_TBL));
   *   &TO_ROW = ActiveRowCount(Record.AE_STMT_TBL);
   *   CopyFields(1, Record.AE_TOOLS_CHK_VW, &ROW, 1, Record.AE_STMT_TBL, &TO_ROW);
   *
   * CopyFields' second Record.X argument (Record.AE_STMT_TBL) reuses the
   * same row InsertRow's own trigger-statement group established, exactly
   * like the plain assignment `&TO_ROW = ActiveRowCount(...)` between them
   * already does via ActiveRowCount's own reuse rule -- CopyFields itself
   * is not a trigger statement (see the ScrollFlush/HideScroll/InsertRow
   * trigger in the bare-call name dispatcher above), it simply continues
   * in whichever group is currently active and reuses within it like any
   * other reuse-enabled name.
   *
   * RecordDeleted's and RecordChanged's own Record.X arguments share the
   * same rule. ADDRESS_TYPE_FL.EMPLID.SavePreChange (definition 534):
   *
   *   (&new_row = True Or
   *      RecordDeleted(Record.ADDRESS_TYPE_FL) Or
   *      RecordChanged(Record.ADDRESS_TYPE_FL)) Then
   *
   * RecordChanged's Record.ADDRESS_TYPE_FL reuses the exact same
   * PSPCMNAME row RecordDeleted's own argument allocated moments earlier,
   * in the same If condition's control group.
   *
   * CreateRowset's own Record.X argument shares the same rule.
   * AE_DERIVED.REFRESH_BTN.SavePreChange (definition 808):
   *
   *   &group = &RSComponent.GetRow(1).GetRecord(Record.DAEMONGROUP)
   *              .GetField(Field.DAEMONGROUP).Value;
   *   &RSDaemon = CreateRowset(Record.DAEMONGROUP);
   *   ...
   *   &RSDaemon.GetRow(...).GetRecord(Record.DAEMONGROUP).Delete();
   *   ...
   *   &RSComponent.GetRow(&i).GetRecord(Record.DAEMONGROUP).Insert();
   *
   * All four Record.DAEMONGROUP occurrences, spanning the GetRecord call,
   * CreateRowset's own argument, and two later GetRecord calls inside
   * separate For loops, reuse the SAME single PSPCMNAME RECORD row --
   * stored's PSPCMNAME table has only one RECORD/DAEMONGROUP entry, not
   * two. Without CreateRowset in this list, its own Record.X argument
   * allocated a fresh row (bypassing the reuse check) and then every
   * later GetRecord call reused THAT wrong row instead of the original.
   *
   * FetchValue's own Record.X argument shares the same rule.
   * ANALYSIS_DB_DIM.DIMENSION_ID.FieldEdit (definition 1128):
   *
   *   &N_AGG_COUNT = ActiveRowCount(ANALYSIS_DB.ANALYSIS_DB_ID, &N_INST_ID, Record.CUBE_AGG_DEF);
   *   For &N_AGG_NUM = 1 To &N_AGG_COUNT
   *      ... Record.CUBE_AGG_DEF, &N_AGG_NUM, Record.CUBE_AGG_DIM);
   *      For &N_AGG_DIM_NUM = 1 To &N_AGG_DIM_COUNT
   *         &S_AGG_DIM_ID = FetchValue(ANALYSIS_DB.ANALYSIS_DB_ID, &N_INST_ID, Record.CUBE_AGG_DEF, &N_AGG_NUM, CUBE_AGG_DIM.DIMENSION_ID, &N_AGG_DIM_NUM);
   *
   * FetchValue's Record.CUBE_AGG_DEF argument reuses the exact same
   * PSPCMNAME RECORD row the earlier ActiveRowCount calls already
   * established in the same control group. FetchValue already had its
   * OWN separate, narrower `reuseFetchValueRecord` mechanism (a distinct
   * cache keyed only by FetchValue-established rows), which never found
   * this ActiveRowCount-established row because it doesn't share a cache
   * with the general control-group reuse pool -- adding FetchValue here
   * too lets it also find rows established by GetRecord/ActiveRowCount/
   * etc, while leaving its own narrower mechanism as-is for whatever case
   * originally motivated it.
   *
   * DoModalPanelGroup's own Record.X argument shares the same rule.
   * ANALYSIS_DB_WRK.PB_OPEN_ANL_MODEL.FieldChange (definition 1152):
   *
   *   If ANALYSIS_DB_WRK.BASE_CUBE_TYPE = "D" Then
   *      ...
   *      DoModalPanelGroup(..., Panel.CUBE_DEF, &S_MODE, Record.ANALYSIS_DB_WRK);
   *   Else
   *      If ANALYSIS_DB_WRK.BASE_CUBE_TYPE = "I" Then
   *         ...
   *         DoModalPanelGroup(..., Panel.ANALYSIS_DB, "U", Record.ANALYSIS_DB_WRK);
   *      End-If;
   *   End-If;
   *
   * Both DoModalPanelGroup calls' own Record.ANALYSIS_DB_WRK argument
   * (one in the If body, one in a nested If inside the Else body -- still
   * the same top-level control group, since the nested If is not itself
   * a fresh top-level control structure) reuse the SAME PSPCMNAME RECORD
   * row.
   *
   * SortScroll's own Record.X argument shares the same rule.
   * ANL_MOD_DIM_FLD.COMPONENT_NBR.RowDelete (definition 1187):
   *
   *   If %Panel = Panel.CUBE_INPUT_FLD Then
   *      &I_COMP_COUNT = ActiveRowCount(Record.ANL_MOD_DIM_FLD);
   *      ...
   *      For &I_COMP_NUM = &I_STARTING_COMP To &I_COMP_COUNT
   *         UpdateValue(ANL_MOD_DIM_FLD.COMPONENT_NBR, &I_COMP_NUM, &I_COMP_NUM - 1);
   *      End-For;
   *      SortScroll(1, Record.ANL_MOD_DIM_FLD, ANL_MOD_DIM_FLD.COMPONENT_NBR, "A");
   *   End-If;
   *
   * SortScroll's own Record.ANL_MOD_DIM_FLD argument (after the nested
   * For loop closes and control returns to the enclosing If-body group)
   * reuses the ActiveRowCount call's earlier row -- SortScroll was
   * missing from this list, so it always allocated fresh.
   *
   * ScrollFlush's own Record.X argument shares the same rule.
   * ARCH_OTH_CTRL.RECNAME1.FieldChange (definition 1236):
   *
   *   &L = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_OTH_CTRL);
   *   ...
   *   If &EXIST <> "X" Then
   *      ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
   *      ...
   *      RowScrollSelect(2, Record.ARCH_TBL, ...);
   *      &P = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_COMMON_KEY);
   *      ...
   *      ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
   *   End-If;
   *
   * Without ScrollFlush in this list, its own Record.ARCH_TBL argument
   * always allocated a fresh row (unconditionally overwriting the
   * control-group cache, same failure shape as fix #18), poisoning every
   * later same-name reference in the group -- both ScrollFlush calls and
   * everything between them should reuse the ActiveRowCount call's
   * original row.
   *
   * `Hide`/`UnHide` (not `HideScroll`/`UnhideScroll` -- distinct functions,
   * field-level rather than scroll-level) share the same rule.
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283):
   *
   *   Hide(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHVAL1, &SEQ);
   *   UnHide(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHDT1, &SEQ);
   *
   * repeated several times reuse the same control-group Record.ARCH_TBL
   * row rather than each allocating a fresh one.
   *
   * `Gray`/`UnGray`'s own Record.X argument needs this SAME control-group
   * check too, even though they are ALSO on the global by-name list
   * (`reuseRecordReferenceByName` a few lines below) -- that global list
   * is checked strictly AFTER this control-group check in
   * `recordReference()`'s priority order, so adding them here only takes
   * priority when a control-group establishment actually exists; it does
   * not remove or override whatever the by-name behavior was originally
   * validated for.
   *
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283), continuing
   * the same construct as the Hide/UnHide evidence above:
   *
   *   ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
   *   ...
   *   Gray(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHVAL1, &SEQ);
   *
   * Gray's own Record.ARCH_TBL argument reuses ScrollFlush's
   * control-group row, NOT the very first ARCH_TBL reference anywhere in
   * the program (which is what the global by-name rule alone found).
   *
   * `HideRow` (distinct from `HideScroll`/`UnhideRow` -- both already on
   * this list, but the plain `HideRow` counterpart was missing entirely).
   * BAS_ENR_RUNCTL.PASSIVE_EVENT_IND.FieldChange (definition 1549):
   *
   *   DeleteRow(Record.BAS_ENR_PASSIVE, &I);
   *   ...
   *   HideRow(Record.BAS_ENR_PASSIVE, 1);
   *   ...
   *   UnhideRow(Record.BAS_ENR_PASSIVE, 1);
   *
   * `HideRow`'s own Record.BAS_ENR_PASSIVE argument reuses DeleteRow's
   * earlier control-group row; without `HideRow` on this list it always
   * allocated fresh, poisoning the later `UnhideRow` reuse too (same
   * failure shape as fix #18).
   *
   * Bare `GetRowset(Record.X)` (assigned to a variable, distinct from
   * `.GetRowset(Scroll.X)` as a postfix method call, and from
   * `CreateRowset`, already on this list) shares the same rule.
   * GPHK_PSLP.GPHK_EXCL_PRNT.FieldChange (definition 8093):
   *
   *   Evaluate GPHK_PSLP.GPHK_EXCL_PRNT
   *   When = "20"
   *      &RS = GetRowset(Record.GPHK_PSLP_LOCTN);
   *      ...
   *   When-Other
   *      &RS = GetRowset(Record.GPHK_PSLP_LOCTN);
   *      ...
   *   End-Evaluate
   *
   * the `When-Other` clause's own `GetRowset(Record.GPHK_PSLP_LOCTN)`
   * reuses the `When = "20"` clause's own row -- both `When` clause
   * bodies share one control group (only the `Evaluate` statement's own
   * entry bumps it, not each individual `When`).
   */
  if (/^(?:GetRecord|DeleteRow|ActiveRowCount|UpdateValue|InsertRow|SetCursorPos|HideScroll|UnhideScroll|UnhideRow|HideRow|CopyFields|RecordDeleted|RecordChanged|CreateRowset|GetRowset|FetchValue|DoModalPanelGroup|SortScroll|ScrollFlush|Hide|UnHide|Gray|UnGray)$/i.test(name)) {
    reuseRecordReferenceWithinControlGroup = true;
  }
  /*
   * See `marksControlGroupParticipant`'s own declaration: every name above
   * EXCEPT ScrollFlush marks its own fresh allocation as a visible
   * "participating" source for a later RowScrollSelect/ScrollSelect call.
   */
  if (/^(?:GetRecord|DeleteRow|ActiveRowCount|UpdateValue|InsertRow|SetCursorPos|HideScroll|UnhideScroll|UnhideRow|HideRow|CopyFields|RecordDeleted|RecordChanged|CreateRowset|GetRowset|FetchValue|DoModalPanelGroup|SortScroll|Hide|UnHide|Gray|UnGray)$/i.test(name)) {
    marksControlGroupParticipant = true;
  }
  if (/^CreateRecord$/i.test(name)) {
    reuseRowShorthandRecord = true;
  }
  if (/^CreateRowset$/i.test(name)) {
    captureRowsetElementRecord = true;
  }

  /*
   * Scroll.X arguments to ActiveRowCount/UpdateValue/Gray/UnGray share the
   * same control-group-scoped reuse rule as Record.X arguments above.
   *
   * DEDUCTION_TBL.SPCL_PROCESS.FieldChange (definition 3586):
   *
   *   For &I = 1 To ActiveRowCount(Scroll.DEDUCTION_TBL, CurrentRowNumber(1), Scroll.DEDUCTION_CLASS);
   *      UpdateValue(Scroll.DEDUCTION_TBL, CurrentRowNumber(1), Scroll.DEDUCTION_CLASS, &I, DEDUCTION_CLASS.DED_CLASS, "A");
   *      ...
   *      Gray(Scroll.DEDUCTION_TBL, CurrentRowNumber(1), Scroll.DEDUCTION_CLASS, &I, DEDUCTION_CLASS.DED_CLASS);
   *      ...
   *   End-For;
   *
   * Every UpdateValue/Gray call's Scroll.DEDUCTION_TBL and
   * Scroll.DEDUCTION_CLASS arguments reuse the exact same PSPCMNAME SCROLL
   * rows the loop header's ActiveRowCount call allocated, rather than each
   * one allocating a fresh row.
   *
   * DeleteRow's own Scroll.X argument shares the same rule.
   * BENEF_PB_WRK.BEN_CLEAR_PB.FieldChange (definition 1738):
   *
   *   &I = ActiveRowCount(Scroll.BEN_PRIJOB_LIST);
   *   While &I > 0
   *      DeleteRow(Scroll.BEN_PRIJOB_LIST, &I);
   *      &I = &I - 1;
   *   End-While;
   *
   * DeleteRow's Scroll.BEN_PRIJOB_LIST reuses the SCROLL row
   * ActiveRowCount's own argument allocated one statement earlier, in the
   * same top-level If's control group.
   *
   * Control-group-scoped, not function-scoped -- see the note on the
   * Record.X reuse rule above.
   *
   * HideScroll/UnhideScroll share the same rule (their own Scroll.X
   * argument both contributes to and reads from the same control-group
   * pool, mirroring how they already joined the analogous Record.X
   * reuse-checking list -- see that note above).
   * ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange (definition 772):
   *
   *   If &nCount = 0 Then
   *      HideScroll(Scroll.ADSRECORDS1_DVW);
   *      ...
   *   Else
   *      UnhideScroll(Scroll.ADSRECORDS1_DVW);
   *      ...
   *   End-If;
   *
   * UnhideScroll's Scroll.ADSRECORDS1_DVW reuses the exact same PSPCMNAME
   * SCROLL row HideScroll's own argument allocated in the other branch of
   * the same top-level If's control group.
   *
   * `FetchValue`'s own Scroll.X argument shares the same rule.
   * BAS_PAR_VW-based Function Update_Event_Display (definition 1627):
   *
   *   &BENRCD = FetchValue(Scroll.BAS_PAR_VW, &I, BAS_PAR_VW.BENEFIT_RCD_NBR);
   *   &EVENT_ID = FetchValue(Scroll.BAS_PAR_VW, &I, BAS_PAR_VW.EVENT_ID);
   *
   * The second FetchValue's own Scroll.BAS_PAR_VW argument reuses the
   * first's, rather than allocating fresh.
   */
  if (/^(?:ActiveRowCount|UpdateValue|Gray|UnGray|DeleteRow|HideScroll|UnhideScroll|FetchValue)$/i.test(name)) {
    reuseScrollReferenceWithinControlGroup = true;
  }

  /*
   * ScrollFlush's OWN participating-map visibility (see
   * `marksControlGroupParticipant`) depends on how many arguments THIS
   * call has, not just the call name.
   *
   * AE_UPGCONV_WRK.AE_REFRESH.FieldChange (definition 840):
   *   ScrollFlush(Record.MESSAGE_LOG);  -- single argument
   * does not mark participating (a later RowScrollSelect allocates fresh,
   * does not find it).
   *
   * ARCH_OTH_CTRL.RECNAME1.FieldChange (definition 1236) and
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283):
   *   ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);  -- 3 args
   * DOES mark participating -- and not merely for the third (child)
   * argument: a later RowScrollSelect's own FIRST Record.ARCH_TBL argument
   * (the parent, same position as the single-argument form) reuses it too
   * (definition 1283's own diff, once the third-argument-only version of
   * this rule was disproven). So the distinguishing factor is argument
   * COUNT for the whole call, not argument position within it.
   */
  const isMultiArgScrollFlushCall =
    /^ScrollFlush$/i.test(name) && (() => {
      let i = pos;
      if (source[i] !== '(') return false;
      i++;
      let localDepth = 1;
      while (i < source.length && localDepth > 0) {
        const ch = source[i];
        if (ch === '(') {
          localDepth++;
        } else if (ch === ')') {
          localDepth--;
          if (localDepth === 0) break;
        } else if (ch === ',' && localDepth === 1) {
          return true;
        } else if (ch === '"') {
          i++;
          while (i < source.length && source[i] !== '"') i++;
        }
        i++;
      }
      return false;
    })();

  if (isMultiArgScrollFlushCall) {
    marksControlGroupParticipant = true;
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
    /*
     * A RowScrollSelect/RowScrollSelectNew call's LAST Record.X argument
     * (its ultimate "to" table, immediately preceding the SQL where-clause
     * string) becomes visible to a LATER statement's own control-group-
     * scoped reuse check (the same `recordReferencesByControlGroup` pool
     * GetRecord/DeleteRow/ActiveRowCount/UpdateValue/etc already read from
     * via `reuseRecordReferenceWithinControlGroup`) -- unlike every other
     * Record.X argument earlier in the same call, which stays call-private
     * (see `reuseRecordReferenceWithinCallArguments`'s own comment for why).
     *
     * ANALYSIS_DB_WRK.BASE_CUBE_INST_ID.FieldChange (definition 1145):
     *
     *   RowScrollSelectNew(1, Record.ANALYSIS_DB_DIM, Record.ANL_MOD_DIM, "where ANALYSIS_MODEL_ID=:1 ORDER BY MEASURES_DIM_FLG DESC", ANALYSIS_DB.ANALYSIS_MODEL_ID);
     *   ...
     *   UpdateValue(DERIVED.EDITTABLE15, &N_DIM_NUM, Record.ANL_MOD_DIM);
     *
     * RowScrollSelectNew's own fresh Record.ANL_MOD_DIM argument (its last
     * record-typed argument) is reused by the later UpdateValue call's own
     * Record.ANL_MOD_DIM argument, several statements later in the same
     * control group -- not a fresh allocation. UpdateValue reads via
     * `reuseRecordReferenceWithinControlGroup`, which only ever consults
     * `recordReferencesByControlGroup` (never the separate
     * `participatingRecordReferencesByControlGroup` map RowScrollSelect's
     * OWN argument lookup uses), so this registers there directly rather
     * than through that other map. Scoped narrowly to the LAST entry in
     * this call's own `recordReferencesWithinCallArguments` map
     * (insertion-ordered, so the last entry is the last distinct record
     * name this call's own argument list introduced) so earlier, non-final
     * Record.X arguments in the same call keep their proven call-private
     * behavior (ARCH_WRK... definition 1172: neither ActiveRowCount's
     * Record.ANL_MOD_DAT_SRC "from" argument nor its Record.ANL_MOD_DIM_FLD
     * argument -- both NOT the last record argument in that RowScrollSelectNew
     * call -- reuse RowScrollSelectNew's own rows).
     */
    if (
      /^RowScrollSelect(?:New)?$/i.test(name) &&
      recordReferencesWithinCallArguments.size > 0
    ) {
      const lastCallArgumentReference = Array.from(
        recordReferencesWithinCallArguments.values()
      ).pop()!;

      if (lastCallArgumentReference.recordName !== undefined) {
        recordReferencesByControlGroup.set(
          `${controlGroup}:${lastCallArgumentReference.recordName.toLowerCase()}`,
          lastCallArgumentReference
        );
      }
    }

    /*
     * See `genericRecordReferencesSinceLastFamilyCall`'s own declaration
     * (definition 843 vs definition 860): every RowScrollSelect-family
     * call -- including this one -- ends the "carry an ordinary call's
     * fresh row forward into the next single-occurrence lookup" window.
     * This call's OWN resolution already read the map above (in the `try`
     * block); clearing here only affects whatever follows it.
     */
    if (/^(?:RowScrollSelect(?:New)?|ScrollSelect)$/i.test(name)) {
      genericRecordReferencesSinceLastFamilyCall.clear();
    }

    reuseRecordReferenceByName =
      previousReuseRecordReferenceByName;
    reuseFetchValueRecord =
      previousReuseFetchValueRecord;
    reuseRecordReferenceWithinControlGroup =
      previousReuseRecordReferenceWithinControlGroup;
    marksControlGroupParticipant =
      previousMarksControlGroupParticipant;
    reuseRowShorthandRecord =
      previousReuseRowShorthandRecord;
    captureRowsetElementRecord =
      previousCaptureRowsetElementRecord;
    reuseScrollReferenceWithinControlGroup =
      previousReuseScrollReferenceWithinControlGroup;
    reuseRecordReferenceWithinCallArguments =
      previousReuseRecordReferenceWithinCallArguments;
    recordReferencesWithinCallArguments =
      previousRecordReferencesWithinCallArguments;
    singleOccurrenceCallArgumentRecordNames =
      previousSingleOccurrenceCallArgumentRecordNames;
    suppressRecordReferenceControlGroupWrite =
      previousSuppressRecordReferenceControlGroupWrite;
  }
};
  const primary = () => {
    space();

    // Bare postfix (...) is calibrated for variable/object indexing such as
    // &rs(1). Do not make every literal/value callable (e.g. True()).
    let allowDirectPostfixCall = source[pos] === '&';
    /*
     * A bare `GetRecord(...)` call (no leading `&variable.` receiver) puts
     * the expression straight into field-reference mode for whatever
     * `.MEMBER` follows, exactly like a `.GetRecord(...)` postfix step
     * later in a chain already does.
     *
     * ADDRESS_TYPE_VW.ADDRESS_TYPE.RowInit (definition 535) proves this
     * matters beyond just the initial field access: a `GetField(Field.X)`
     * called directly on a bare `GetRecord(...)` result must also register
     * into the control-group FIELD reuse pool the same way
     * `&row.GetRecord(...).GetField(Field.X)` already does, so a later
     * bare `.FIELDNAME` property access elsewhere in the same control
     * group can find it.
     */
    let bareGetRecordCallResult = false;

    /*
     * A bare `GetRow()` call (no receiver, no arguments) returns the
     * current Row, exactly like a `rowVariables`-tracked Row variable
     * does -- so its own `.RECORD.FIELD.Value` two-dot postfix chain
     * compiles RECORD and FIELD through PSPCMNAME (0x4A operands), the
     * same as `&row.RECORD.FIELD.Value` already does for a declared Row
     * variable (see `rowStartsRecordFieldChain`'s own comment, a few
     * lines below). Scoped narrowly to the exact empty-parens call, like
     * `bareGetRecordCallResult` already scopes `GetRecord()` similarly.
     *
     * GPGB_SCON_TBL.GPGB_SCON.RowDelete (definition 8027):
     *
     *   &GPGB_SCON = GetRow().GPGB_SCON_TBL.GPGB_SCON.Value;
     *
     * stores two PSPCMNAME references (RECORD GPGB_SCON_TBL, FIELD
     * GPGB_SCON), not inline text.
     */
    let bareGetRowCallResult = false;
    const baseVariableName =
      /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
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
    } else if (source[pos] === '(') {
      const startsBooleanUnary = /^\(\s*Not\b/i.test(source.slice(pos));
      /*
       * The `&variable` on the left side of a parenthesized comparison
       * may itself be indexed/called (e.g. a Rowset access) before its
       * `.field.field` chain, not just a bare `&variable`:
       *
       *   DERIVED.Enabled = (&rs2(&j).PA_CLC_PLN_INPT.USE_PROCESS_SECT.Value = "Y");
       *   &EmptyRow = (&ShareScheme(&EmplRow).IsNew And ...);
       *
       * PA_CLC_PLN_INPT.EXEC_ONLY_CD.RowInit (definition 19037) and
       * GPGB_SS_EE_DATA.GPGB_SS_DEFN_VW.SavePreChange (definition 21575),
       * among others.
       */
      const startsVariableComparison =
        /^\(\s*&[A-Za-z0-9_]+#?(?:\s*\([^()]*\))?(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*\s*(?:<>|<=|>=|=|<|>)/
          .test(source.slice(pos));
      /*
       * System variables can be the left operand of the same parenthesized
       * comparison shape. Four independent HCDEV definitions use exactly:
       *
       *   (%Mode <> %Action_Add)
       *
       * and store the ordinary 0x0B / 0x10 / 0x14 grouped-comparison bytes.
       */
      const startsSystemVariableComparison =
        /^\(\s*%[A-Za-z_][A-Za-z0-9_]*\s*(?:<>|<=|>=|=|<|>)/
          .test(source.slice(pos));
      /*
       * A parenthesized comparison whose LEFT side is a function call
       * (optionally with one level of call arguments) or a bare
       * Record.Field chain, rather than a `&variable`, e.g.:
       *
       *   &bWild = (Find("*", &sFile) > 0);
       *   &bIsSRM = (GetUserOption("PPTL", "ACCESS") = "A");
       *   Visible = (GPGB_EDI_TRANS.GPGB_EDI_AUDIT = "Y");
       *
       * PORTAL_UTILS.FUNCLIB.FieldFormula (one of 41 corpus occurrences
       * of this shape, across Find/GetUserOption/MessageBox/RTrim/Upper
       * calls and bare Record.Field comparisons) proves these also need
       * `booleanExpression()`, not just the already-covered `&variable`
       * case.
       */
      const startsCallOrFieldComparison =
        /^\(\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*\s*(?:\([^()]*\))?\s*(?:<>|<=|>=|=|<|>)/
          .test(source.slice(pos));
      /*
       * A parenthesized boolean And/Or chain whose FIRST operand is a
       * bare `&variable`/field-chain truthy reference with no comparison
       * operator at all (not `&var = X`, just `&var` itself, exactly the
       * same shape `booleanUnary`/plain `If &var And ...` already
       * accepts at statement level):
       *
       *   &HALF1 = (&A And &B And &C And ...);
       *   &AddCRef = (&IncludeHiddenCrefs Or &CRef.IsVisible);
       *   PTLAYOUT.PT_QAB_TOOLBAR.Visible = (&fldMRU.Visible Or &fldFAV.Visible);
       *
       * SCC_PYE_WRK.SCC_PYE_ARCHIVE.FieldFormula (definition 1275) and
       * WEBLIB_PORTAL.ISCRIPT1.FieldFormula (definitions 19495/25089/
       * 25090), among others.
       */
      const startsVariableBooleanChain =
        /^\(\s*&(?:[A-Za-z_][A-Za-z0-9_]*|\d+)(?:\s*\([^()]*\))?(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*\s*(?:And|Or)\b/i
          .test(source.slice(pos));
      parenthesized(
        startsBooleanUnary ||
        startsVariableComparison ||
        startsCallOrFieldComparison ||
        startsSystemVariableComparison ||
        startsVariableBooleanChain
          ? booleanExpression
          : expression,
        false
      );
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
        /^[A-Za-z_][A-Za-z0-9_]*#?/.exec(source.slice(pos))?.[0];

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
         *
         * AMM_DERIVED.IB_FO_BACK_PB.FieldChange (definition 982) proves the
         * chain must NOT match when the second dotted segment is one of the
         * inline Row state/property members (RowNumber/IsNew/IsDeleted/
         * IsChanged/Visible/Selected -- the same set `isInlineRowStateMember`
         * below already recognizes for a Row-variable base):
         *
         *   If Record.AMM_DERIVED.IsChanged = True Or ...
         *
         * `IsChanged` here is a boolean Row-state property of the RECORD's
         * underlying Row, not a field name -- there is no third `.Value`
         * continuation. Taking the explicit-chain branch put
         * `expectedReferenceMember` into `'field'` mode, so the postfix
         * loop's own `isInlineRowStateMember` check (which requires
         * `'record'` mode) never got a chance to keep `IsChanged` inline.
         */
        const explicitRecordFieldChain =
          /^Record\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/i
            .exec(tail);
        const explicitRecordFieldChainIsRowStateMember =
          explicitRecordFieldChain !== null &&
          /^(?:RowNumber|IsNew|IsDeleted|IsChanged|Visible|Selected)$/i.test(
            explicitRecordFieldChain[2]
          );

        if (explicitRecordFieldChain && !explicitRecordFieldChainIsRowStateMember) {
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
      } else if (
        /^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*["']/.test(tail) &&
        quotedReferenceQualifiers.has(identifier.toLowerCase())
      ) {
        chunks.push(quotedReference());
      } else if (/^Component\s*\./i.test(tail)) {
        chunks.push(componentReference());
      } else if (/^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)) {
        chunks.push(ordinaryRecordFieldReference());
      } else if (
        /^[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)
      ) {
        /*
         * Application-package enum/key constants use the same inline-name
         * and 0x57 colon bytes as a class path, but are expression operands
         * and do not allocate a new PACKAGE dependency themselves:
         *
         *   create %metadata:Key(Key:Class_MacroSetId, &src)
         *
         * PSMACROSETACT.PTMACRODEL.FieldFormula (definition 16084) stores
         * `Key:Class_MacroSetId` as 0x0A "Key", 0x57, 0x0A
         * "Class_MacroSetId" inside the call arguments.
         */
        chunks.push(applicationClassPath().bytes);
      } else {
        /*
         * `GetRecord()` with NO arguments is a structurally different
         * construct from `GetRecord(Record.X)` / `GetRecord(N)`: it starts
         * a Row-navigation chain (`.ParentRow.ParentRowset...`), not a
         * field access, and its postfix members must stay plain inline
         * identifiers.
         *
         * ABS_H_D_NLDSBR.SAME_ADDRESS_EMPL.FieldChange (definition 180)
         * proves this: `GetRecord().ParentRow...` must NOT treat
         * `.ParentRow` as a field reference. Only the argumented form
         * (definition 535's `GetRecord(1)` / `GetRecord(Record.X)`) puts a
         * following bare `.MEMBER` into field-reference mode.
         */
        const wasBareGetRecordCall =
          /^GetRecord$/i.test(identifier) &&
          !/^GetRecord\s*\(\s*\)/i.test(tail);

        /*
         * A bare, EMPTY-PARENS `GetRecord()` call is normally a
         * Row-navigation chain root (definition 180's `.ParentRow...`,
         * kept inline -- see the comment above). But when the member that
         * follows is itself followed by a SECOND dotted member (rather
         * than being the whole chain), the first member is a FIELD access
         * on the row's default record, exactly like the argumented form
         * already puts its following bare `.MEMBER` into field-reference
         * mode -- the difference is structural (one member vs. two), not
         * the presence of call arguments.
         *
         * GPS_POSTADD_WRK.<various>.FieldFormula (definition 10023, one of
         * 26 corpus occurrences of this exact shape):
         *
         *   GetRecord().GPS_BDG_ORG2.SqlText = ExpandSqlBinds(...);
         *
         * stores a real PSPCMNAME FIELD reference (0x4A) for GPS_BDG_ORG2,
         * while SqlText -- a record property, not a field -- stays inline
         * text, matching how `expectedReferenceMember` already reverts to
         * `undefined` (not a second reference level) once a 'field'-mode
         * reference has been consumed.
         *
         * `ParentRow` is the sole exception in the corpus (definitions 180,
         * 9359, 22705, all still a `.ParentRow.ParentRowset...` navigation
         * chain, never a field): of 113 distinct first-member identifiers
         * found across every `GetRecord().MEMBER.MEMBER2` corpus occurrence,
         * `ParentRow` is the only one that is not an
         * ALL_CAPS_WITH_UNDERSCORES field-name shape, so it is excluded by
         * name, matching definition 180's own calibrated comment above.
         */
        const wasBareGetRecordCallNoArgsFieldChain =
          /^GetRecord$/i.test(identifier) &&
          /^GetRecord\s*\(\s*\)\s*\.\s*(?!ParentRow\b)[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/i
            .test(tail);

        const wasBareGetRowCall =
          /^GetRow$/i.test(identifier) &&
          /^GetRow\s*\(\s*\)/i.test(tail);

        call();

        // A function-call result may itself be invoked/indexed using (...)
        // e.g. GetLevel0()(1).
        allowDirectPostfixCall = true;

        if (wasBareGetRecordCall || wasBareGetRecordCallNoArgsFieldChain) {
          bareGetRecordCallResult = true;
        }

        if (wasBareGetRowCall) {
          bareGetRowCallResult = true;
        }
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

    const bareGetRowCallStartsRecordFieldChain =
      bareGetRowCallResult &&
      /^\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/
        .test(source.slice(pos));

    let expectedReferenceMember:
      'record' | 'field' | undefined =
        explicitRecordRootName !== undefined
          ? 'field'
          : bareGetRecordCallResult
            ? 'field'
            : rowStartsRecordFieldChain || bareGetRowCallStartsRecordFieldChain
              ? 'record'
              : baseVariableName !== undefined &&
                recordVariables.has(baseVariableName.toLowerCase())
                ? 'field'
                : undefined;

    /*
     * Distinguishes "expectedReferenceMember === 'field' because this is
     * the first postfix step off a declared Record variable" from
     * "...because this expression's field context came from a
     * .GetRecord(...) result" (either a bare `GetRecord(...)` primary call,
     * or `.GetRecord(...)` as a postfix step later in the chain). Only the
     * latter enables Field.X control-group reuse for a following
     * .GetField(...) call -- see its own comment where it's checked below.
     */
    let fieldMemberFromGetRecord = bareGetRecordCallResult;
    let selectedByDirectRowsetPostfix = false;

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
          /^(?:RowNumber|IsNew|IsDeleted|IsChanged|Visible|Selected)$/i.test(member);

        const hasExistingExpectedReference = references.some(item =>
          expectedReferenceMember === 'record'
            ? (item.kind === 'record' || (isMethodCall && item.kind === 'scroll')) &&
              same(item.recordName, member)
            : expectedReferenceMember === 'field'
              ? item.kind === 'field' && same(item.fieldName, member)
              : false
        );
        const directLevel0RecordField =
          expectedReferenceMember === 'record' &&
          selectedByDirectRowsetPostfix &&
          controlDepth === 0 &&
          functionDepth === 0 &&
          baseVariableName !== undefined &&
          same(
            rowsetRecordNamesByVariable.get(baseVariableName.toLowerCase()),
            member
          )
            ? /^\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(pos))?.[1]
            : undefined;
        const directLevel0RecordFieldKey =
          directLevel0RecordField === undefined
            ? undefined
            : `${controlGroup}:${baseVariableName!.toLowerCase()}:${member.toLowerCase()}:${directLevel0RecordField.toLowerCase()}`;

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
                ) ??
                /*
                 * The FIELD half of an explicit `Record.REC.FIELD.Value`
                 * chain is reusable by NAME ALONE across a DIFFERENT root
                 * record within the same control group -- the stored
                 * PSPCMNAME row itself has no owning-record link at all
                 * (`RECNAME` is the literal placeholder `'FIELD'`).
                 *
                 * ACL_WS_WRK.WSOPRACCESS.SaveEdit (definition 437):
                 *
                 *   &classid = Record.PTIBMAPAUTH_VW.CLASSID.Value;
                 *   ...
                 *   &classid = Record.PSAUTHWS_VW1.CLASSID.Value;
                 *
                 * both inside the same control group (an If/Else inside one
                 * Function body) -- stored has exactly one FIELD/CLASSID
                 * row, reused for both, despite the two different root
                 * records. Mirrors the already-proven cross-Record-variable
                 * FIELD reuse a few dozen lines below (ACCOMPLISHMENTS.
                 * EMPLID.SavePostChange) via the same shared
                 * `declaredRecordFields` pool.
                 */
                declaredRecordFields.get(
                  `${controlGroup}:${member.toLowerCase()}`
                )
              : expectedReferenceMember === 'record' && isMethodCall
              ? references.find(
                  item =>
                    item.kind === 'scroll' &&
                    same(item.recordName, member)
                )
              : expectedReferenceMember === 'record'
              ? (
                  directLevel0RecordFieldKey !== undefined
                    ? level0RowsetRecordsByField.get(directLevel0RecordFieldKey)
                    : rowShorthandRecordsByBase.get(
                        `${controlGroup}:${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`
                      ) ??
                      rowsetElementRecords.get(member.toLowerCase()) ??
                      rowShorthandRecordsByControlGroup.get(
                        `${controlGroup}:${member.toLowerCase()}`
                      ) ??
                      /*
                       * A row-shorthand RECORD member may reuse a RECORD
                       * dependency first established explicitly earlier in
                       * the same control group.
                       */
                      recordReferencesByControlGroup.get(
                        `${controlGroup}:${member.toLowerCase()}`
                      )
                )
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
                      : (
                          /*
                           * Ordinary Rowset/row-shorthand FIELD reuse is
                           * control-group scoped. If the field has not already
                           * been established in this group, allocate it.
                           *
                           * DERIVED_CO.FUNCLIB.FieldFormula proves that
                           * NO_RESULTS is FIELD #8 in group 0 but a fresh
                           * FIELD #26 in group 1. Falling back to latestFields
                           * incorrectly reuses the group-0 dependency.
                           *
                           * ADDRESS_TYPE_VW.ADDRESS_TYPE.RowInit (definition
                           * 535) proves a further bridge: a bare `.FIELDNAME`
                           * property access immediately after `.GetRecord(...)`
                           * reuses a FIELD row already established in the same
                           * control group by an explicit
                           * `.GetRecord(...).GetField(Field.X)` chain earlier
                           * in that group --
                           *
                           *   &FLD = GetRecord(Record.ADDRESS_TYPE_VW)
                           *            .GetField(Field.ADDRESS_TYPE);
                           *   ...
                           *   &Types.GetRow(&I).GetRecord(1).ADDRESS_TYPE.Value
                           *
                           * Both resolve to the same PSPCMNAME FIELD row for
                           * ADDRESS_TYPE, not a fresh allocation.
                           */
                          rowShorthandFields.get(
                            `${controlGroup}:${member.toLowerCase()}`
                          ) ?? declaredRecordFields.get(
                            `${controlGroup}:${member.toLowerCase()}`
                          ) ?? fieldReferencesByControlGroup.get(
                            `${controlGroup}:${member.toLowerCase()}`
                          )
                        )
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
            declaredRecordFields.set(
              `${controlGroup}:${member.toLowerCase()}`,
              reference
            );
          }

          if (
            expectedReferenceMember === 'record' &&
            reference.kind === 'record'
          ) {
            if (directLevel0RecordFieldKey !== undefined) {
              level0RowsetRecordsByField.set(
                directLevel0RecordFieldKey,
                reference
              );
            }
            rowShorthandRecords.set(member.toLowerCase(), reference);
            rowShorthandRecordsByBase.set(
              `${controlGroup}:${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`,
              reference
            );
            rowShorthandRecordsByControlGroup.set(
              `${controlGroup}:${member.toLowerCase()}`,
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

              /*
               * AGC_CAT_STEP.AGC_CATEGORY_ID.FieldFormula (definition 924)
               * proves a Row-typed variable's FIELD binding bridges to the
               * control-group-scoped `declaredRecordFields` pool too, the
               * same way a declared Record variable's own FIELD binding
               * already does (see the ACCOMPLISHMENTS.EMPLID.SavePostChange
               * / AA_SUMM_JPN_VW.EMPLID.SavePostChange provenance-bridge
               * comment above): a LATER row-shorthand access
               * (`&rowsetVar(&i).RECORD.FIELD`, a structurally different
               * access style reached through the final "ordinary
               * Rowset/row-shorthand FIELD reuse" branch below, which
               * checks `declaredRecordFields` but never `typedRowFields`)
               * reuses the SAME PSPCMNAME FIELD row a `Row`-typed
               * parameter's own `.RECORD.FIELD` chain established earlier
               * in the same control group:
               *
               *   Function InitStepDefautAssigneeSection(&rCurrCatTbl As
               *       Row, &rCurrentStep As Row)
               *      ...
               *      &rCurrentStep.AGC_DERIVED_ASG.GROUPBOX4.Visible = &nShow;
               *      &rsCategorySteps = &rCurrCatTbl.GetRowset(Scroll.AGC_CAT_STEP);
               *      For &i = 1 To &rsCategorySteps.ActiveRowCount
               *         &rsCategorySteps(&i).AGC_DERIVED_ASG.GROUPBOX4.Visible = &nShow;
               */
              declaredRecordFields.set(
                `${controlGroup}:${member.toLowerCase()}`,
                reference
              );
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
          } else if (
            expectedReferenceMember === 'field' &&
            baseVariableName === undefined &&
            fieldMemberFromGetRecord
          ) {
            /*
             * A bare `GetRecord().FIELDNAME` field reference (no
             * `&variable.` receiver) reuses within the current control
             * group the same way every other FIELD-reuse pool above does
             * -- a second `GetRecord().FIELDNAME` for the same field name
             * in the same control group (e.g. the If- and Else-branches
             * of one `If ... Then ... Else ... End-If;`) points to the
             * SAME PSPCMNAME FIELD row, not a fresh allocation.
             *
             * GPS_EDIT_WRK.GPS_BDG_ORG1.FieldChange (definition 9989):
             *
             *   If GetRecord().GPS_LEVELS.Value = 2 Then
             *      GetRecord().GPS_BDG_ORG2.SqlText = ExpandSqlBinds(...);
             *   Else
             *      GetRecord().GPS_BDG_ORG2.SqlText = ExpandSqlBinds(...);
             *   End-If;
             *
             * both `GPS_BDG_ORG2` occurrences store the same FIELD index.
             */
            fieldReferencesByControlGroup.set(
              `${controlGroup}:${member.toLowerCase()}`,
              reference
            );
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
          fieldMemberFromGetRecord = false;
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
          const previousMarksControlGroupParticipant =
            marksControlGroupParticipant;
          const previousReuseScrollReferenceWithinControlGroup =
            reuseScrollReferenceWithinControlGroup;
          const previousReuseFieldReferenceWithinControlGroup =
            reuseFieldReferenceWithinControlGroup;

          /*
           * Record.X arguments to Select() reuse the same RECORD dependency
           * within the current control group.
           *
           * DERIVED_CO.FUNCLIB.FieldFormula proves two consecutive
           * &HeaderRowset.Select(Record.CRSE_ALL_SSN_VW, ...) calls both use
           * PSPCMNAME NAMENUM 9 rather than allocating a second RECORD row.
           *
           * Neither GetRecord nor Select has ScrollFlush's proven
           * participating-map exception (see `marksControlGroupParticipant`),
           * so both also mark their own fresh allocation as a participating
           * source, matching this flag's previous combined behavior.
           */
          if (/^(?:GetRecord|Select)$/i.test(member)) {
            reuseRecordReferenceWithinControlGroup = true;
            marksControlGroupParticipant = true;
          }

          if (/^GetRowset$/i.test(member)) {
            reuseScrollReferenceWithinControlGroup = true;
          }

          /*
           * Field.X reuse is scoped to a GetField(...) call immediately
           * chained onto this same expression's own field context coming
           * from a .GetRecord(...) result -- not merely
           * expectedReferenceMember === 'field' by itself, since that is
           * ALSO true on the very first postfix step off a declared
           * Record variable (`&rec.GetField(...)` where `&rec` is
           * `Local Record &rec;`), a structurally different, unrelated
           * case. `fieldMemberFromGetRecord` rules that out: it is only
           * ever true when the current field context was established by a
           * `.GetRecord(...)` result, whether that was a postfix chain
           * step (`&row.GetRecord(...)`) or the bare primary call itself
           * (`GetRecord(Record.X)` with no leading `&variable.` receiver).
           *
           * Deliberately narrow: 'encodeProgramArtifacts allocates
           * repeated Scroll and Field references by occurrence' (existing
           * calibrated test) proves GetField(Field.CODE) called on a
           * STORED Record variable (`&rec = GetRecord(...); &rec.GetField
           * (Field.CODE); &rec.GetField(Field.CODE);`, two separate
           * statements, GetField as the first postfix step both times)
           * remains occurrence-based -- each call gets its own fresh
           * FIELD row. Only a GetField(...) directly continuing the same
           * .GetRecord(...) result (definition 524, and definition 535's
           * bare-call form) reuses.
           */
          if (
            /^GetField$/i.test(member) &&
            fieldMemberFromGetRecord &&
            expectedReferenceMember === 'field'
          ) {
            reuseFieldReferenceWithinControlGroup = true;
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
            marksControlGroupParticipant =
              previousMarksControlGroupParticipant;
            reuseScrollReferenceWithinControlGroup =
              previousReuseScrollReferenceWithinControlGroup;
            reuseFieldReferenceWithinControlGroup =
              previousReuseFieldReferenceWithinControlGroup;
          }

          expectedReferenceMember =
            member.toLowerCase() === 'getrecord'
              ? 'field'
              : member.toLowerCase() === 'getrow'
                ? 'record'
                : undefined;
          fieldMemberFromGetRecord =
            member.toLowerCase() === 'getrecord';
          if (/^GetRow$/i.test(member)) {
            selectedByDirectRowsetPostfix = false;
          }
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
           * Rowset selector result is a Row. Its first dotted member is
           * normally a RECORD dependency even when the RECORD object itself
           * is the complete expression:
           *
           *   &rs(CurrentRowNumber()).AA_HIST_JPN_VW
           *
           * AA_COST_RT_JPN.EMPLID.RowInit proves that single-member form must
           * compile through PSPCMNAME as RECORD.
           *
           * Genuine Row state/properties such as .Visible, .IsNew,
           * .IsDeleted and .IsChanged are filtered by
           * isInlineRowStateMember above and remain inline names.
           */
          expectedReferenceMember = 'record';
          selectedByDirectRowsetPostfix = true;

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
   * An initialized Local anywhere in the leading declaration run means the
   * run's eventual close (whenever it happens -- at that initializer itself
   * if no further Local follows, or later once the true first non-Local
   * statement is reached) gets no 0x2D declaration-section marker, only the
   * ordinary blank-line 0x4F marker(s) -- the initializer's own execution
   * already ended the "pure declaration" phase without a formal boundary.
   *
   * DAEMONGROUP.DAEMONGROUP.SaveEdit (definition 3539):
   *
   *   Local number &i;
   *   Local number &cnt = 0;
   *
   *   Local number &duprow;
   *
   *   Local Rowset &this;
   *
   *   &this = GetLevel0()(1).GetRowset(Scroll.DAEMONGROUP);
   *
   * stores `... &this; 15 4F 01 "&this" ...` before the assignment -- a
   * lone 0x4F for the blank line, no 0x2D -- even though the program has
   * compiled PSPCMNAME references and would otherwise get a 0x2D/0x4F
   * declaration-section close.
   */
  let leadingRunHasInitializedLocal = false;

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
  let sawWildcardImport = false;

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
      /*
       * A standalone disabled-code marker (<* ... *>) can also follow an
       * open top-level declaration section, exactly like the standalone
       * block-comment branch below already handles (see that branch's
       * own `sawTopLevelDeclaration && !closedTopLevelDeclarationSection`
       * check) -- this branch was missing the equivalent close entirely.
       *
       * BN_LIMITTYP_RUN.LIMIT_TYPE.SaveEdit (definition 1929):
       *
       *   Global boolean &RunLimits_Age;
       *
       *   <*
       *   If All(BN_LIMITTYP_RUN.LIMIT_TYPE) Then
       *      ...
       *   End-If;
       *   *>
       *
       *   If None(BN_LIMITTYP_RUN.LIMIT_TYPE) Then
       *
       * stores `... 15 2D 4F 55 ...` -- the 0x2D declaration-section close
       * belongs before the blank-line marker and the disabled-comment's
       * own 0x55 opcode, not omitted entirely.
       */
      if (
        haveCompletedTopLevelStatement &&
        hasBlankLine &&
        sawTopLevelDeclaration &&
        !closedTopLevelDeclarationSection
      ) {
        const disabledCommentEnd = source.indexOf('*>', pos + 2);
        const afterDisabledComment = nextSignificantAfterBlockComments(
          disabledCommentEnd >= 0 ? disabledCommentEnd + 2 : pos
        );
        const nextIsTopLevelDeclarationAfterDisabledComment =
          /^(?:Global|PanelGroup|Component|Constant|Declare\s+Function)\b/i.test(
            source.slice(afterDisabledComment)
          );

        if (!nextIsTopLevelDeclarationAfterDisabledComment) {
          chunks.push(Buffer.from([0x2d]));
          closedTopLevelDeclarationSection = true;
        }
      }

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

      /*
       * A standalone disabled-code marker (<* ... *>) does not, by
       * itself, terminate the leading Local declaration run any more than
       * an ordinary block comment does (see the matching block-comment
       * branch's "nextIsLocal" guard just below) -- only close the run
       * early when one had actually started (sawLeadingLocalDeclaration)
       * and no Local declaration immediately follows this marker. If no
       * Local run has started yet, leave leadingLocalRun untouched so a
       * Local declaration reached later can still be tracked.
       *
       * ADDRESS_TYPE_FL.ADDRESS_TYPE.RowDelete (definition 528):
       *
       *   [block comment: move gbl.addresses.address_type.row delete]
       *   <*Bug 25690137*>
       *   Local SQL &SQL1;
       *
       *   SQLExec(...);
       *
       * Previously this branch unconditionally set leadingLocalRun =
       * false, which fired here BEFORE `Local SQL &SQL1;` was even
       * reached (sawLeadingLocalDeclaration is still false at this
       * point) -- permanently preventing the subsequent Local from ever
       * being tracked by the leading-run mechanism at all, so the
       * section's eventual 0x2D/0x4F close before `SQLExec(...)` was
       * never emitted.
       */
      if (sawLeadingLocalDeclaration) {
        const afterDisabledComment =
          nextSignificantAfterBlockComments(pos);
        const nextIsLocalAfterDisabledComment =
          /^Local\b/i.test(source.slice(afterDisabledComment));

        if (
          leadingLocalRun &&
          !nextIsLocalAfterDisabledComment &&
          pendingReferenceLocalBoundary === undefined
        ) {
          pendingReferenceLocalBoundary = chunks.length;
          pendingReferenceLocalMarkers = 0;
          leadingLocalRun = false;
        }
      }
      continue;
    }

    if (source.startsWith('/*', pos)) {
      const afterComments =
        nextSignificantAfterBlockComments(pos);

      const nextIsLocal =
        /^Local\b/i.test(source.slice(afterComments));

      const nextIsImport =
        /^import\b/i.test(source.slice(afterComments));
      const nextIsTopLevelDeclaration =
        /^(?:Global|PanelGroup|Component|Constant|Declare\s+Function)\b/i.test(
          source.slice(afterComments)
        );

      /*
       * A standalone block comment following an import belongs to the open
       * import declaration section only when another import follows the
       * comment sequence.
       *
       * This preserves the previously calibrated multi-import case:
       *
       *   import A:B:C;
       *   [group label comment]
       *   import D:E:F;
       *
       * where PeopleTools keeps one import section, while also handling:
       *
       *   import EO:CA:Address;
       *
       *   [block comment]
       *   executable...
       *
       * which stores:
       *
       *   <import> 15 2D 4F 24 ...
       *
       * The comment loop runs before the ordinary non-import transition below,
       * so close the import section here when the comment sequence is followed
       * by anything other than another import.
       */
      // A decoded same-line import comment may be rendered on its own line.
      // Its preserved 0x4E provenance keeps it attached to the import; the
      // import section closes at the following non-import source item.
      if (
        importSectionOpen &&
        !nextIsImport &&
        context?.commentOpcodes?.[commentOpcodeIndex] !== 0x4e
      ) {
        chunks.push(Buffer.from([0x2d]));
        importSectionOpen = false;
      }

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
       *
       * When the comment sequence is instead followed by ANOTHER top-level
       * declaration (Global/PanelGroup/Component/Constant/Declare Function)
       * or an import, the Local run has ended but the declaration SECTION
       * has not -- it continues into that following declaration and closes
       * later, at the true first executable statement, via the separate
       * sawTopLevelDeclaration/closedTopLevelDeclarationSection mechanism
       * (mirrors the equivalent non-comment exclusion a few lines below,
       * `leadingLocalRun && !isLocalDeclaration` guarding on
       * `!isTopLevelDeclaration`). Do not record a boundary here in that
       * case, or an extra spurious 0x2D gets inserted right before the
       * comment.
       *
       * ARCH_SQL_LNG.ARCH_SQL.SavePostChange (definition 1257):
       *
       *   Local Record &REC;
       *   /* global strings defined in ARCH_SQL_LNG.ARCH_SQL.FieldChange *\/
       *   Global string &AUDIT_ID, &AUDIT_RECNAME, &AUDIT_PROCESS, &AUDIT_STRING;
       *   Global boolean &AUDIT_THIS;
       *
       *   If (...) Then
       *
       * stores no 0x2D at all before the comment -- the declaration section
       * (Local + both Globals) closes as one unit right before `If`.
       */
      if (
        leadingLocalRun &&
        sawLeadingLocalDeclaration &&
        !nextIsLocal &&
        pendingReferenceLocalBoundary === undefined
      ) {
        if (!nextIsTopLevelDeclaration && !nextIsImport) {
          pendingReferenceLocalBoundary = chunks.length;

          /*
           * The ordinary top-level blank-line/comment handling below emits
           * the 0x4F. If this program ultimately has compiled references, the
           * deferred Local-section insertion therefore contributes only 0x2D.
           */
          pendingReferenceLocalMarkers = 0;
        }
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
          !closedTopLevelDeclarationSection &&
          !nextIsTopLevelDeclaration
        ) {
          chunks.push(Buffer.from([0x2d]));
          closedTopLevelDeclarationSection = true;
        }

        /*
         * An open Application Class Local declaration section closes the
         * same way: a standalone block comment following the section's
         * final Local (application-class or ordinary) is not itself part
         * of the section, so the section's 0x2D boundary belongs before
         * the comment rather than deferred to the next executable
         * statement.
         *
         * ADDRESSES.ADDRESS_TYPE.RowInit (definition 513):
         *
         *   Local EO:CA:Address &LocAddress;
         *   Local string &ciName;
         *
         *   /*trying to bring...*\/
         *   If ...
         *
         * stores the section boundary immediately before the comment:
         *
         *   ... <ciName> 15 2D 4F 24 <comment> ...
         *
         * Without this, the section only closes via the ordinary
         * closesApplicationClassLocalSection path in the ordinary
         * statement branch, which a leading comment bypasses via this
         * loop's early `continue`, so the 0x2D is wrongly deferred past
         * the comment to the next executable statement.
         */
        if (
          sawApplicationClassLocalSection &&
          !closedApplicationClassLocalSection &&
          !nextIsLocal
        ) {
          chunks.push(Buffer.from([0x2d]));
          closedApplicationClassLocalSection = true;
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
        const decodedTrailingImportComment =
          importSectionOpen &&
          !nextIsImport &&
          context?.commentOpcodes?.[commentOpcodeIndex] === 0x4e;
        chunks.push(blockComment());

        const commentWhitespaceStart = pos;
        space();

        const commentWhitespace =
          source.slice(commentWhitespaceStart, pos);

        const hasBlankLineAfterComment =
          /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
            commentWhitespace
          );

        if (decodedTrailingImportComment && hasBlankLineAfterComment) {
          chunks.push(Buffer.from([0x2d, 0x4f]));
          importSectionOpen = false;
          if (nextIsLocal) {
            leadingLocalRun = true;
            sawLeadingLocalDeclaration = false;
            pendingReferenceLocalBoundary = undefined;
            pendingReferenceLocalMarkers = 1;
          }
        } else if (hasBlankLineAfterComment) {
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
    if (startsRemComment()) {
      /*
       * A REM comment after the final leading Local closes a reference-bearing
       * Local section just like a standalone block comment does. The ordinary
       * blank-line path below supplies the 0x4F; defer only the 0x2D until we
       * know the program has compiled references.
       *
       * ACL_WS_WRK.WSOPRACCESS.FieldFormula stores:
       *   Local number &I; 2D 4F REM ...
       */
      if (
        leadingLocalRun &&
        sawLeadingLocalDeclaration &&
        hasBlankLine &&
        pendingReferenceLocalBoundary === undefined
      ) {
        pendingReferenceLocalBoundary = chunks.length;
        pendingReferenceLocalMarkers = 0;
        leadingLocalRun = false;
      }

      if (haveCompletedTopLevelStatement && hasBlankLine) {
        if (sawTopLevelDeclaration && !closedTopLevelDeclarationSection) {
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
      /*
       * A top-level REM comment may omit its trailing semicolon, the same
       * way every other REM call site in this file already allows
       * (`remComment(true)`) -- this was the one remaining call site still
       * requiring it.
       *
       * AMM_DERIVED.DELETE_BTN.RowInit (definition 964):
       *
       *   rem PSCHNLDEFN is a deprecated table in PT 8.48 and above.
       *
       * has no trailing ";" and decodes back to this exact source.
       */
      chunks.push(remComment(true));
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
     * GPFR_AF_DON_SQL.GPFR_AF_APPL.FieldFormula (definition 6844) proves a
     * top-level For/End-For block also self-terminates at EOF without a
     * source semicolon, the same way If/End-If and Evaluate/End-Evaluate
     * already do.
     */
    const isForStatement =
      /^For\b/i.test(source.slice(pos));

    /*
     * GPGB_PFH.MAIN.Step10.OnExecute (definition 26707) proves a top-level
     * While/End-While block may also end at EOF without a source semicolon.
     * Its stored executable ends `... 26 07`, with no `15` between the
     * End-While opcode and the program terminator.
     */
    const isWhileStatement =
      /^While\b/i.test(source.slice(pos));

    /*
     * A bare `Warning <expr>` (or `Error <expr>`) top-level statement may
     * also omit its semicolon at EOF.
     *
     * GPGB_SCON_TBL.GPGB_SCON.FieldFormula (definition 21801):
     *
     *   Warning MsgGetText(17410, 51, "Message not found")
     */
    const isWarningOrErrorStatement =
      /^(?:Warning|Error)\b/i.test(source.slice(pos));

    /*
     * ADDRESS_SBR.COUNTRY.FieldChange (definition 524) proves a top-level
     * try/catch/end-try block may likewise terminate directly at EOF
     * without a source semicolon after end-try:
     *
     *   catch Exception &id
     *      /* Exception Caught. *\/
     *   end-try
     */
    const isTryStatement =
      /^try\b/i.test(source.slice(pos));

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

    /*
     * A bare declared-function call statement may also omit its semicolon
     * at EOF, distinct from startsTopLevelAssignment above.
     *
     * FUNCLIB_ABS_EA.CANCEL_BTN.FieldFormula (definition 4066) and 58 other
     * corpus objects end with a plain call to a Declare Function-declared
     * routine and no trailing semicolon:
     *
     *   Declare Function EA_Cancel_Process PeopleCode ...;
     *
     *   EA_Cancel_Process()
     *
     * Keep this scoped to a bare leading identifier immediately followed by
     * "(", excluding every reserved top-level statement keyword, so forms
     * like "Return True" (no parens, and Return is reserved) still fail
     * without an explicit semicolon.
     */
    const isTopLevelCallStatement =
      !/^(?:import|Declare|Function|Local|Global|PanelGroup|Component|Constant|Return|If|While|For|Repeat|try|throw|Break|Exit|Continue|Error|Warning|Evaluate|REM)\b/i.test(
        source.slice(pos)
      ) &&
      /^[A-Za-z_][A-Za-z0-9_]*#?\s*\(/.test(source.slice(pos));

    /*
     * A `&variable.Method(...)` (or `@(...)`-led) method-call statement,
     * with no assignment `=`, may likewise omit its semicolon at EOF --
     * the same relaxation `isTopLevelCallStatement` already gives a bare
     * declared-function call, just for a variable-led receiver instead
     * of a bare identifier.
     *
     * GPFR_AF_ESC.GPFR_AF_ESC_NAME.SavePreChange (definition 18046):
     *
     *   &esc.OnSavePreChange()
     */
    const isTopLevelVariableLedCallStatement =
      (source[pos] === '&' || source[pos] === '@') &&
      !/=/.test(source.slice(pos));

    const isApplicationClassLocal =
      /^Local\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\b/i.test(
        source.slice(pos)
      );

    const applicationClassLocalIsDeclarationPhase =
      isApplicationClassLocal &&
      !sawTopLevelExecutableStatement;

    const isTopLevelDeclaration =
      isImport ||
      /^(?:Global|PanelGroup|ComponentLife|Component|Constant|Declare\s+Function)\b/i.test(source.slice(pos));


    const closesTopLevelDeclarationSection =
      !isTopLevelDeclaration &&
      !isLocalDeclaration &&
      sawTopLevelDeclaration &&
      !closedTopLevelDeclarationSection &&
      !(sawApplicationClassLocalSection && !closedApplicationClassLocalSection);

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
       * The import-section boundary's 0x4F marker count scales with
       * blank-line count, like every other marker site in this file.
       * ACCOMPLISHMENTS.EMPLID.SavePostChange (a single blank line before
       * an Application Class Local) only ever exercised the single-marker
       * case, so an earlier pass hardcoded "at most one" for every OTHER
       * (non-Application-Class-Local) following declaration -- CAF_SRCH.
       * CAF_SRCH_BTN.SavePostChange (definition 2200) disproves that:
       *
       *   import CAF_SEARCH_NUI:Search;
       *   import CAFNUI_CORE:OBJECT:CompareSession;
       *   import CAFNUI_API:EntityHandler;
       *
       *
       *   Declare Function GetSearchKey PeopleCode CAF_SRCH.CAF_SRCH_BTN FieldFormula;
       *
       * (two blank lines, next declaration a Declare Function, not a
       * Local) stores TWO 0x4F markers, not one.
       */
      if (hasBlankLine) {
        const markerCount = Math.max(
          1,
          (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
        );
        for (let marker = 0; marker < markerCount; marker++) {
          chunks.push(Buffer.from([0x4f]));
        }
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

    if (
      (sawTopLevelDeclaration || sawLeadingLocalDeclaration) &&
      isTopLevelDeclaration &&
      /^(?:ComponentLife|Component|Global|PanelGroup|Declare\s+Function)\b/i.test(source.slice(pos)) &&
      hasBlankLine &&
      !justClosedImportSection
    ) {
      /*
       * DERIVED_GPFR_AF.GPFR_AF_DUPLICATE.FieldChange (definition 5026)
       * proves this same declaration-to-declaration boundary also applies
       * when the PRECEDING declaration is a leading Local-declaration run
       * rather than an earlier Global/PanelGroup/Component/Declare
       * Function -- `sawTopLevelDeclaration` alone is too narrow, since
       * plain `Local` declarations never set it:
       *
       *   Local array of string &ValueArray;
       *   Local array of Record &ExceptionArray;
       *   Local Record &REC;
       *   Local SQL &Sql1;
       *
       *   Declare Function ciCreateArray PeopleCode FUNCLIB_CI.CI_ARRAY FieldFormula;
       *
       * stores one 0x4F marker (no 0x2D at all) between `&Sql1;` and
       * `Declare Function` -- previously no marker was emitted here at
       * all, since neither this block (guarded on `sawTopLevelDeclaration`,
       * false here) nor the plain `leadingLocalRun && !isLocalDeclaration`
       * closer (which explicitly excludes `isTopLevelDeclaration` targets,
       * deferring to this block instead) covered this specific transition.
       *
       * AMM_DERIVED.AMM_CANCEL_M.FieldChange (definition 942) proves this
       * boundary scales with blank-line count like every other marker
       * site in this file, rather than always emitting exactly one:
       *
       *   Declare Function LoadSubChannelPubHdr PeopleCode AMM_WORK.FUNCLIB FieldFormula;
       *
       *
       *   Component boolean &msg_refreshed;
       *
       * (two blank lines) stores two 0x4F markers, not one.
       *
       * AMM_DERIVED.AMM_COLLAPSE_ALL.FieldChange (definition 945) proves
       * this trigger list itself was incomplete -- `PanelGroup` belongs
       * on it too, alongside `isTopLevelDeclaration`'s own full set
       * (`Global|PanelGroup|Component|Constant|Declare Function`):
       *
       *   Declare Function CollapseTreeRows PeopleCode AMM_TREE_WS.TREE_LEVEL_NUM FieldFormula;
       *
       *   PanelGroup number &CurrentTreeRow;
       *
       * had NO marker emitted at all (not even a multiplicity bug --
       * PanelGroup simply never triggered this block). `Constant` remains
       * unconfirmed by any corpus evidence and is deliberately left off.
       */
      const markerCount = Math.max(
        1,
        (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
      );
      for (let marker = 0; marker < markerCount; marker++) {
        chunks.push(Buffer.from([0x4f]));
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
        !closesApplicationClassLocalSection &&
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
       *
       * An initialized Local anywhere in the section omits this 0x2D
       * entirely, mirroring `closesTopLevelDeclarationSection`'s own
       * identical `leadingRunHasInitializedLocal` check a few lines below
       * -- this path was missing it.
       *
       * CAFNUI_CTRL_WRK.CAF_DELETE_FLG.FieldChange (definition 2102):
       *
       *   import PT_PAGE_UTILS:Utils;
       *
       *   Local PT_PAGE_UTILS:Utils &PTUtils = create PT_PAGE_UTILS:Utils();
       *
       *   If %Page = Page.CAFNUI_ED_FLST_SCF Then
       *
       * stores only the 0x4F blank-line marker before `If`, no 0x2D.
       */
      if (!leadingRunHasInitializedLocal) {
        chunks.push(Buffer.from([0x2d]));
      }

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
      // This one section boundary also closes preceding Declare/Component
      // declarations; emitting their boundary again duplicates 0x2D 0x4F.
      closedTopLevelDeclarationSection = true;
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
    //
    // An intervening Local declaration with an initializer (e.g. `Local
    // Row &Row = GetRow();` between a `Declare Function` and the first
    // executable statement) makes this an ordinary blank-line gap, not a
    // formal declaration-section boundary -- omit the 0x2D, mirroring the
    // `pendingReferenceLocalBoundary` insertion site's identical check.
    // See `leadingRunHasInitializedLocal`'s own declaration comment.
    if (closesTopLevelDeclarationSection) {
      if (!leadingRunHasInitializedLocal) {
        chunks.push(Buffer.from([0x2d]));
      }
      const markerCount = Math.max(1, (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1);
      for (let marker = 0; marker < markerCount; marker++) {
        chunks.push(Buffer.from([0x4f]));
      }
      closedTopLevelDeclarationSection = true;
    }

    const statementChunkStart = chunks.length;

    statement();

    /*
     * A top-level Local declaration's own initializer makes the
     * currently-open declaration section (tracked by
     * `sawTopLevelDeclaration`/`closedTopLevelDeclarationSection`, NOT
     * the narrower `leadingLocalRun` "run of consecutive Locals" tracker)
     * an ordinary blank-line gap rather than a formal 0x2D boundary when
     * it closes -- independent of whether `leadingLocalRun` itself is
     * still true. A preceding NON-Local top-level declaration (e.g.
     * `Declare Function ...;`) already set `leadingLocalRun = false`
     * before this Local was ever reached (see the
     * `leadingLocalRun && !isLocalDeclaration` closer above), so the
     * `leadingLocalRun`-gated block just below never runs for a Local in
     * that position and never gets a chance to set this flag on its own.
     *
     * DERIVED_GPFRDSN.GPFR_DSN_EXT_STAT.FieldDefault (definition 5002):
     *
     *   Declare Function ComputeEventEeStatus PeopleCode DERIVED_GPFRDSN.GPFR_DSN_EXT_STAT FieldFormula;
     *
     *   Local Row &Row = GetRow();
     *
     *   If %Component = Component.GPFR_DSN_EVT_EE Then
     *
     * stores no 0x2D at all before `If` -- only the three 0x4F blank-line
     * markers. `closesTopLevelDeclarationSection`'s own unconditional
     * 0x2D push (a few lines below) needs this flag true to omit it.
     *
     * An import statement closes `closedTopLevelDeclarationSection`
     * immediately (the `isImport` branch above), independent of whether a
     * following Application Class Local declaration section is still
     * open -- `closesApplicationClassLocalSection`'s own 0x2D push uses
     * this SAME flag (a few dozen lines below) and needs it set even
     * when the generic top-level section already closed.
     *
     * CAFNUI_CTRL_WRK.CAF_DELETE_FLG.FieldChange (definition 2102):
     *
     *   import PT_PAGE_UTILS:Utils;
     *
     *   Local PT_PAGE_UTILS:Utils &PTUtils = create PT_PAGE_UTILS:Utils();
     *
     *   If %Page = Page.CAFNUI_ED_FLST_SCF Then
     *
     * `closedTopLevelDeclarationSection` is already true here (set by the
     * import), so the original `!closedTopLevelDeclarationSection` guard
     * alone never let this flag get set for this Local at all.
     */
    if (
      isLocalDeclaration &&
      lastLocalHadInitializer &&
      ((sawTopLevelDeclaration && !closedTopLevelDeclarationSection) ||
        ((sawApplicationClassLocalSection ||
          (isApplicationClassLocal && applicationClassLocalIsDeclarationPhase)) &&
          !closedApplicationClassLocalSection))
    ) {
      leadingRunHasInitializedLocal = true;
    }

    if (
      leadingLocalRun &&
      isLocalDeclaration
    ) {
      if (lastLocalHadInitializer) {
        /*
         * An initialized Local is executable at declaration time. It does
         * not extend the declaration-only Local section -- but only when
         * the immediately following Local declaration (if any) is itself
         * uninitialized. If an UNINITIALIZED Local declaration follows
         * (before the first truly non-Local statement), the whole run
         * stays one section and the general
         * leadingLocalRun/!isLocalDeclaration closer below (which fires
         * once, at the actual end of the run) supplies the boundary
         * instead.
         *
         * DAEMONGROUP.DAEMONGROUP.SaveEdit (definition 3539):
         *
         *   Local number &i;
         *   Local number &cnt = 0;
         *
         *   Local number &duprow;
         *
         *   Local Rowset &this;
         *
         *   &this = GetLevel0()(1).GetRowset(Scroll.DAEMONGROUP);
         *
         * stores no 0x2D/0x4F boundary between `&i;` and the initialized
         * `&cnt = 0;` -- the section only closes once, right before
         * `&this = GetLevel0()...`, after &duprow and &this (both
         * uninitialized) have also been declared.
         *
         * Deliberately narrow to "next Local is uninitialized": ACA_BGN_MTH_TBL.
         * BEGIN_DT.SaveEdit (definition 256, protected baseline) proves TWO
         * directly-adjacent INITIALIZED Locals --
         *
         *   Local integer &year = Year(ACA_BGN_MTH_TBL.BEGIN_DT);
         *   Local integer &month = Month(ACA_BGN_MTH_TBL.BEGIN_DT);
         *
         * -- must NOT defer to the general closer this way; deferring here
         * caused the general closer to later fire using the wrong anchor
         * position (statementChunkStart of the SECOND initializer, wrongly
         * placing a boundary between the two initializers). When the next
         * Local is itself initialized, fall through to the original
         * behavior below (no boundary set here; leadingLocalRun stays
         * false for the rest of the run, matching pre-existing calibrated
         * behavior for consecutive initialized Locals).
         *
         * If declaration-only Locals preceded this initialized Local AND no
         * uninitialized Local declaration follows it, close the section
         * immediately before this initialized Local. If it is the first
         * Local, there is no declaration-only section and therefore no
         * deferred 0x2D boundary.
         */
        const afterStatementSemicolon =
          source[pos] === ';' ? pos + 1 : pos;
        const afterStatementLookaheadStart =
          nextSignificantAfterBlockComments(afterStatementSemicolon);
        const nextLocalMatch =
          /^Local\s+[A-Za-z_][A-Za-z0-9_]*\s+&[A-Za-z0-9_]+#?\s*(=)?/i.exec(
            source.slice(afterStatementLookaheadStart)
          );
        const nextIsAnotherUninitializedLocal =
          nextLocalMatch !== undefined && nextLocalMatch !== null && nextLocalMatch[1] === undefined;

        if (nextIsAnotherUninitializedLocal) {
          leadingRunHasInitializedLocal = true;
          sawLeadingLocalDeclaration = true;
        } else {
          // `leadingRunHasInitializedLocal` is already set unconditionally
          // for any initialized top-level Local right after `statement()`
          // above, regardless of `leadingLocalRun` -- see that check's own
          // comment.
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
        }
      } else {
        sawLeadingLocalDeclaration = true;
      }
      if (process.env.DEBUG_513) console.error('AFTER-LOCAL-STMT', { leadingLocalRun, sawLeadingLocalDeclaration, lastLocalHadInitializer, isApplicationClassLocal });
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
     * A block comment may appear between a top-level statement's
     * expression and its own terminating semicolon, the same way
     * If/For/While bodies already allow -- inline (0x4E) or standalone
     * (0x24) by placement (see `blockCommentByPlacement()`).
     *
     * HR_LINK_WRK.DESCR.FieldFormula (definition 18680):
     *
     *   HR_LINK_WRK.DESCR = MsgGetText(18032, 485, "Message Not Found, 18032, 485") /* Go to *\/;
     */
    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

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
      const trailingStandaloneCommentEnd = source.startsWith('/*', pos)
        ? source.indexOf('*/', pos + 2)
        : -1;
      /*
       * Any self-terminating-at-EOF statement type may have a trailing
       * standalone comment between its own end and true EOF, not just a
       * plain assignment -- HS_EXAM_AUDIO2.<various>.FieldChange
       * (definition 1353) proves this for a top-level `If ... End-If`
       * (no trailing `;`) immediately followed by
       * `/*End Resolution 301452 *\/` and nothing else:
       *
       *   If %Page = ... Then
       *      ...
       *   End-If
       *   /*End Resolution 301452 *\/
       */
      const selfTerminatingBeforeFinalStandaloneComment =
        (
          startsTopLevelAssignment ||
          isIfStatement ||
          isEvaluateStatement ||
          isForStatement ||
          isTopLevelCallStatement ||
          isTopLevelVariableLedCallStatement ||
          isWarningOrErrorStatement ||
          isTryStatement
        ) &&
        trailingStandaloneCommentEnd >= 0 &&
        /^\s*$/.test(source.slice(trailingStandaloneCommentEnd + 2));

      /*
       * A top-level statement immediately followed by a REM comment (no
       * semicolon of its own) may likewise omit it -- the REM statement
       * itself is handled by this same loop's own dedicated REM branch
       * on its next iteration, exactly like the ordinary
       * `;`-then-continue path. Not restricted to EOF: the REM statement
       * may not be the last thing in the file.
       *
       * CAF_FACTOR_360.CAF_CLOSE_BTN.FieldChange (definition 2175):
       *
       *   &cmpSession.Configuration.ComparisonHandler.
       *       DeleteFactorfromAnalysisGrouplets(&RS_Flt_Factor360(&save_i_flt_fac))
       *   rem &cmpSession.ProcessNUIAction("updfactor");
       */
      const precedesRemStatement = startsRemComment();

      const selfTerminatingAtEof =
        (
          pos === source.length &&
          (
            startsTopLevelAssignment ||
            isIfStatement ||
            isEvaluateStatement ||
            isForStatement ||
            isWhileStatement ||
            isTopLevelCallStatement ||
            isTopLevelVariableLedCallStatement ||
            isWarningOrErrorStatement ||
            isTryStatement
          )
        ) || selfTerminatingBeforeFinalStandaloneComment || precedesRemStatement;

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

      /*
       * A completed import section is distinct from a following ordinary
       * top-level declaration section.
       *
       * DERIVED_CO.FUNCLIB.FieldFormula calibrates:
       *
       *   import CO_NAVIGATN:Stack;
       *
       *   Global CO_NAVIGATN:Stack &MyNavStack;
       *   ...
       *   PanelGroup ...;
       *   Global string &SearchBy, &TrnReqFrom, &TrnReqThru;
       *
       *   [standalone comment block]
       *   Function FillSessionGrids(...)
       *
       * The import section has already closed earlier with its own 0x2D.
       * The later Global/PanelGroup declaration section must therefore reopen
       * the generic declaration-section tracker so the comment boundary emits
       * the second required 0x2D:
       *
       *   ... <last Global> 15 2D 4F 24 ...
       *
       * Without reopening here, closedTopLevelDeclarationSection remains true
       * from the import close and the second 0x2D is incorrectly suppressed.
       *
       * Keep this limited to the declaration phase; a declaration encountered
       * after executable top-level code has begun must not reopen the section.
       */
      if (!sawTopLevelExecutableStatement) {
        closedTopLevelDeclarationSection = false;
      }
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
          /*
           * An initialized Local anywhere in the leading run means this
           * close is an ordinary blank-line gap, not a formal declaration-
           * section boundary -- omit the 0x2D. See
           * leadingRunHasInitializedLocal's declaration comment above.
           */
          ...(leadingRunHasInitializedLocal ? [] : [Buffer.from([0x2d])]),
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
  /*
   * Only route a source unit through the dedicated Application Class program
   * encoder when it contains an actual top-level class declaration. Ordinary
   * event PeopleCode can begin with an import and later contain the word
   * "class" inside a comment; that must remain on the normal fragment path.
   */
  const applicationClassDeclaration =
    /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s+method\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/im;

  if (
    !/^\s*import\b/i.test(source) ||
    !applicationClassDeclaration.test(source)
  ) {
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
    /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s+method\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:Returns\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;\s*end-class\s*;/im.exec(
      source
    );
  if (!classMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class declaration'
    );
  }

  const parameters = classMatch[3].trim() === '' ? [] : classMatch[3].split(',').map(parameter => {
    const match = /^\s*(&[A-Za-z0-9_]+#?)\s+As\s+(string|integer|boolean)\s*$/i.exec(parameter);
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
    /\bLocal\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s+(&[A-Za-z0-9_]+#?)\s*;/i.exec(
      body
    );
  const createMatch =
    /(&[A-Za-z0-9_]+#?)\s*=\s*create\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s*\(\s*\)\s*;/i.exec(
      body
    );
  const callMatch =
    /(&[A-Za-z0-9_]+#?)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*"([^"]*)"\s*\)\s*;/i.exec(
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

/*
 * Replaces block comments and double-quoted string literals with spaces,
 * preserving every other character's exact position, so a regex scan for
 * top-level `Function NAME` headers never matches text that only looks
 * like one inside a comment or a SQL string.
 *
 * AE_WRK.MESSAGE_NBR.FieldChange (definition 908) proves this is a real
 * gap, not a hypothetical one: an entire `Function Check_Integrity ...
 * End-Function;` definition sits inside a `/* ... *\/` block comment,
 * ahead of the two real Functions (`load_stmt`, `Check_Syntax`). The
 * unmasked scan picked up "Check_Integrity" as a genuine third function,
 * inflating the stored function-directory count from 2 to 3 and adding a
 * spurious metadata/trailer entry.
 */
function maskCommentsAndStringLiteralsForFunctionScan(
  source: string
): string {
  let masked = '';
  let i = 0;

  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      masked += ' '.repeat(stop - i);
      i = stop;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      masked += ' '.repeat(j - i);
      i = j;
    } else {
      masked += source[i];
      i++;
    }
  }

  return masked;
}

function parseFunctionMetadata(
  source: string
): FunctionMetadata[] {
  const metadata: FunctionMetadata[] = [];

  /*
   * Function definitions are top-level source items in the calibrated
   * ordinary PeopleCode fixtures. Match only line-start Function headers so
   * Declare Function statements are not included.
   *
   * Matched against the comment/string-masked source (same length, so
   * every offset below still indexes correctly into the real `source`)
   * -- see `maskCommentsAndStringLiteralsForFunctionScan`'s own comment.
   */
  const maskedSource =
    maskCommentsAndStringLiteralsForFunctionScan(source);
  const functionPattern =
    /(?:^|\r?\n)[ \t]*Function\s+([A-Za-z_][A-Za-z0-9_]*)([ \t]*\()?/gi;

  let functionMatch: RegExpExecArray | null;

  while ((functionMatch = functionPattern.exec(maskedSource)) !== null) {
    const name = functionMatch[1];
    const parameterStart = functionPattern.lastIndex;
    const hasParameterList = functionMatch[2] !== undefined;

    const closeParen = hasParameterList
      ? source.indexOf(')', parameterStart)
      : parameterStart;
    if (hasParameterList && closeParen < 0) {
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
          /^\s*&[A-Za-z0-9_]+#?\s+As\s+((?:array\s+of\s+)*[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)\s*$/i.exec(
            parameter
          );

        if (typedMatch) {
          parameterTypes.push(typedMatch[1]);
          continue;
        }

        const untypedMatch =
          /^\s*&[A-Za-z0-9_]+#?\s*$/.exec(parameter);

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

    const afterParameters = source.slice(closeParen + (hasParameterList ? 1 : 0));
    const returnMatch =
      /^[ \t]*Returns\s+((?:array\s+of\s+)*[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)/i.exec(
        afterParameters
      );

    metadata.push({
      name,
      parameterTypes,
      returnType: returnMatch?.[1],
      hasParameterList
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
