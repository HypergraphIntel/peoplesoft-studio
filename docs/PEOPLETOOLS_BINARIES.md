# PeopleTools compiler binaries (research inventory)

Static-analysis reference for the PeopleCode compiler (Cycle 169). No
binaries are committed; only hashes, versions and analysis notes.

## Local binary set and HCDEV correspondence

- Local root: `/home/noodlesploder/peoplesoft-dlls/pt861` (565 files). The
  other roots once mentioned (pt86107, pt86112, pt86209) are not present.
- Build: PeopleTools **8.61.07** (`PT861P07B_2409250501-retail`, 2024-09-25),
  x64.
- HCDEV (read-only `SYSADM.PSSTATUS`): TOOLSREL `8.61`, PTPATCHREL **15**,
  UNICODE_ENABLED 0 (NLS_CHARACTERSET WE8ISO8859P15). The corpus's
  `#ToolsRel` blocks agree with 8.61.
- So the local DLLs are the same release, a different patch (07 vs 15):
  native findings are **architectural** evidence, never byte-exact authority
  over stored PSPCMPROG. Stored programs may also predate either patch
  (delivered definitions are compiled at their own save time).

| DLL | sha256 | FileVersion | ProductVersion | Arch | PE timestamp (UTC) | PDB | Compiler relevance |
|---|---|---|---|---|---|---|---|
| pspcm.dll | `474604203feb80aa637120a052d2d34976bef82defffdc64a133bd5f965027cd` | 8.61.07 | 8.61.07 | x64 | 2024-09-25 16:59 | `C:\PT861P07B_2409250501-retail\peopletools\src\pspcm\obj_client\pspcm.pdb` | PeopleCode compiler / runtime host (lexer: token codes = opcodes, numbers via psmath ConvAsciiToDecimal) |
| pspceval.dll | `8f8b3593f62f484cb9d4b060c7f26702db3dad285089dfa38f3d335b0ad10980` | 8.61.07 | 8.61.07 | x64 | 2024-09-25 16:35 | `C:\PT861P07B_2409250501-retail\peopletools\src\pspceval\obj_client\pspceval.pdb` | PeopleCode evaluator; exports PcBuildText(PCMPROG*) -- the native program-to-text decompiler |
| psmath.dll | `da4d962c16288b5bfcd4c91686e38a2d3b3cbb40bef32a077c1edef2e1495428` | 8.61.07 | 8.61.07 | x64 | 2024-09-25 16:33 | `C:\PT861P07B_2409250501-retail\peopletools\src\psmath\obj_client\psmath.pdb` | DEC number library: 18-byte DEC = sign byte, scale byte (<= 0x51), 16-byte magnitude (the 0x50 literal operand) |
| pssys.dll | `163616516c0032dc0d52abd15026191e44010c12d3f08138c57d601e7fbfde0e` | 8.61.07 | 8.61.07 | x64 | 2024-09-25 16:35 | `C:\PT861P07B_2409250501-retail\peopletools\src\pssys\obj_client\pssys.pdb` | system / data services (DEC used in GenGetNextNumber*) |
| psmgr.dll | `cd455076728f78cf043de5029c828590c8a3fec4f958af0cb2633c4f349bbe60` | 8.61.07 | 8.61.07 | x64 | 2024-09-25 16:34 | `C:\PT861P07B_2409250501-retail\peopletools\src\psmgr\obj_client\psmgr.pdb` | manager / API layer |
| pscmn.dll | `acc16d6b0d9773f9c43edef411eb2a552f9b3f59dc8c31e0a77224a89a89d386` | 8.61.07 | 8.61.07 | x64 | 2024-09-25 16:34 | `C:\PT861P07B_2409250501-retail\peopletools\src\pscmn\obj_client\pscmn.pdb` | common runtime |
| pside.exe | `98dc809cb65aeef1201336161559a510fb476688bded5c9c275768c4eb8bcec7` | 8.61.07 | 8.61.07 | x64 | 2024-09-25 16:59 | `C:\PT861P07B_2409250501-retail\peopletools\src\pside\obj_client\pside.pdb` | Application Designer executable |

`pspcm.dll` imports (compiler-relevant): `psmath.dll` (numbers),
`pspceval.dll` (evaluator / decompiler), `pssys.dll`, `psmgr.dll`,
`pscmn.dll`, `psbld.dll`, `pscompat64.dll` (string tables).

## Findings

Evidence levels: **confirmed by compiler output** (stored corpus agrees),
**consistent with compiler output**, **suggestive only**.

- **DEC layout** (psmath.dll, exports by name): an 18-byte struct --
  byte 0 sign (`ChangeSignDecimal` = copy, then `xor byte [rcx], 1`;
  `IsDecimalNegative` tests byte 0 with a non-zero magnitude), byte 1 scale
  (validated `<= 0x51`), bytes 2-17 magnitude (compared as word / qword /
  dword / word). The 0x50 number-literal operand is exactly this DEC.
  *Confirmed by compiler output*: 172,046 corpus literals have sign 0, scale
  0-11; 29858's negative Constant stores sign 1 (`50 01 00 18 14 3D ...`).
- **Lexer** (pspcm.dll around `0x180524a00`): token code at
  `[ctx+0x828]` equals the opcode -- number `0x50`, `-` `0x0E`, `**`
  `0x46`, `>=` / `>` `8` / `9`; a number collects digits and `.`
  (`iswdigit` loop) into `ConvAsciiToDecimal`, DEC at `[ctx+0x838]`. It
  never lexes a sign, so every literal is unsigned at the lexer.
  *Consistent with compiler output*: executable negatives are `0E` + an
  unsigned literal (7,306 corpus sites).
- The sign applied to a Constant's value was not located (every
  `[ctx+0x838]` access is in the lexer region `0x18052xxxx`; the parser
  copies the DEC elsewhere). *Suggestive only* that the Constant path
  negates the DEC directly.
- `"Constant used in inappropriate context."` (`0x1806862f0`) is raised by
  the symbol lookup at `0x1804eb740` / `0x1804eb890` (name tables at
  `ctx+0x30b0..0x30e0`), not by literal emission.
- `pspceval.dll` exports `PcBuildText(PCMPROG*, ...)`: the native
  program-to-text routine -- the place to confirm decoder rendering rules.

## Method

- Versions / hashes: `pefile` version resources and debug directory.
- String cross-references: RIP-relative `lea` scan of `.text` (`8D /r`,
  `mod=00 rm=101`) against the string's VA; rizin 0.8.2 `aa` is too shallow
  for `axt` on these.
- Call sites of imports: `FF 15 disp32` scan against the IAT entry.
- Disassembly: `rizin -q -c 'pd N @ addr'`.

## Cycle 170 findings

HCTST (the second configured environment) refused the HCDEV credentials
(ORA-01017); no other credential is configured, so no secondary corpus.
No writable compile environment exists. Native analysis below is the
evidence beyond the HCDEV corpus.

### PcBuildText opcode table (pspceval.dll) -- CONFIRMED

`PcBuildText(PCMPROG*, ...)` (export at `0x180030cd0`) reads one opcode
byte (`movzx r13d, byte [r15]`) and dispatches through a 4-byte RVA jump
table at `0x180032454`, index `opcode - 1`, opcodes 0x01-0x79. Each case
loads its keyword text and spacing flags, then jumps to a shared emitter.
Against this repository's opcode table (`src/peoplecode/format.ts`): 73
opcodes with text agree, 0 disagree. Notably 0x41 / 0x42 render no text
(group markers), 0x2D and 0x4F render no text (line structure), 0x50 is
the number operand, 0x5A-0x5C and 0x70-0x72 share the class / end-class /
extends cases (class vs interface).

| Opcode | Case address | Native text |
|---|---|---|
| 0x01 | `0x180030f95` | (operand / special) |
| 0x02 | `0x180030ec4` | `^` |
| 0x03 | `0x180030edc` | `,` |
| 0x04 | `0x180030ef6` | `/` |
| 0x05 | `0x180031c50` | `.` |
| 0x06 | `0x180030f32` | `=` |
| 0x07 | `0x180030f12` | (empty) |
| 0x08 | `0x180030f4e` | `>=` |
| 0x09 | `0x180030f6a` | `>` |
| 0x0A | `0x180030f95` | (operand / special) |
| 0x0B | `0x180030fec` | `(` |
| 0x0C | `0x180031017` | `<=` |
| 0x0D | `0x180031033` | `<` |
| 0x0E | `0x18003104f` | `-` |
| 0x0F | `0x18003106b` | `*` |
| 0x10 | `0x180031087` | `<>` |
| 0x11 | `0x1800310a3` | (operand / special) |
| 0x12 | `0x180030f95` | (operand / special) |
| 0x13 | `0x18003115d` | `+` |
| 0x14 | `0x1800311a9` | `)` |
| 0x15 | `0x1800311bd` | `;` |
| 0x16 | `0x1800311eb` | (operand / special) |
| 0x17 | `0x1800312e8` | `Accept` |
| 0x18 | `0x18003131c` | `And` |
| 0x19 | `0x1800313ce` | `Else` |
| 0x1A | `0x180031407` | `End-If` |
| 0x1B | `0x180031485` | `Error` |
| 0x1C | `0x180031552` | `If` |
| 0x1D | `0x180031592` | `Not` |
| 0x1E | `0x1800315ae` | `Or` |
| 0x1F | `0x1800316a3` | `Then` |
| 0x20 | `0x18003170f` | `Warning` |
| 0x21 | `0x1800317a7` | `Invalid Name Index` |
| 0x22 | `0x180031a05` | (operand / special) |
| 0x23 | `0x18003118d` | `|` |
| 0x24 | `0x180031b11` | (operand / special) |
| 0x25 | `0x18003179b` | `While` |
| 0x26 | `0x18003145d` | `End-While` |
| 0x27 | `0x18003163a` | `Repeat` |
| 0x28 | `0x1800316e7` | `Until` |
| 0x29 | `0x180031500` | `For` |
| 0x2A | `0x1800316af` | `To` |
| 0x2B | `0x180031687` | `Step` |
| 0x2C | `0x180031439` | `End-For` |
| 0x2D | `0x1800312bc` | (empty) |
| 0x2E | `0x180031366` | `Break` |
| 0x2F | `0x1800316cb` | `True` |
| 0x30 | `0x1800314e4` | `False` |
| 0x31 | `0x1800313b6` | `Declare` |
| 0x32 | `0x180031509` | `Function` |
| 0x33 | `0x18003155e` | `Library` |
| 0x34 | `0x180031300` | `Alias` |
| 0x35 | `0x18003134a` | `As` |
| 0x36 | `0x1800316f3` | `Value` |
| 0x37 | `0x180031442` | `End-Function` |
| 0x38 | `0x180031653` | `Return` |
| 0x39 | `0x18003166b` | `Returns` |
| 0x3A | `0x180031602` | `PeopleCode` |
| 0x3B | `0x18003161e` | `Ref` |
| 0x3C | `0x1800314b5` | `Evaluate` |
| 0x3D | `0x180031727` | `When` |
| 0x3E | `0x180031760` | `When-Other` |
| 0x3F | `0x180031430` | `End-Evaluate` |
| 0x40 | `0x180030f86` | (operand / special) |
| 0x41 | `0x18003127e` | (empty) |
| 0x42 | `0x18003129d` | (empty) |
| 0x43 | `0x18003149d` | `Exit` |
| 0x44 | `0x18003157a` | `Local` |
| 0x45 | `0x18003153a` | `Global` |
| 0x46 | `0x180031179` | `**` |
| 0x47 | `0x180030ed0` | `@` |
| 0x48 | `0x180031877` | `Invalid Name Index` |
| 0x49 | `0x180031c64` | `set` |
| 0x4A | `0x1800319a0` | `Invalid Name Index` |
| 0x4B | `0x180031c7c` | `Null` |
| 0x4C | `0x180031c98` | `[` |
| 0x4D | `0x180031ca4` | `]` |
| 0x4E | `0x180031b11` | (operand / special) |
| 0x4F | `0x180031bd3` | (empty) |
| 0x50 | `0x180031120` | (operand / special) |
| 0x51 | `0x1800315ba` | `PanelGroup` |
| 0x52 | `0x180031cb8` | `NoExport` |
| 0x53 | `0x180031cd4` | `Doc` |
| 0x54 | `0x1800315d2` | `Component` |
| 0x55 | `0x180031b11` | (operand / special) |
| 0x56 | `0x18003139e` | `Constant` |
| 0x57 | `0x180031ce0` | `:` |
| 0x58 | `0x180031cf4` | `import` |
| 0x59 | `0x180031d00` | `*` |
| 0x5A | `0x180031d0c` | `class` |
| 0x5B | `0x180031d2a` | `end-class` |
| 0x5C | `0x180031d50` | `extends` |
| 0x5D | `0x180031d7c` | `out` |
| 0x5E | `0x180031d98` | `property` |
| 0x5F | `0x180031da4` | `get` |
| 0x60 | `0x180031dc0` | `readonly` |
| 0x61 | `0x180031ddc` | `private` |
| 0x62 | `0x180031de8` | `instance` |
| 0x63 | `0x180031df4` | `method` |
| 0x64 | `0x180031e00` | `end-method` |
| 0x65 | `0x180031e0c` | `try` |
| 0x66 | `0x180031e18` | `catch` |
| 0x67 | `0x180031e51` | `end-try` |
| 0x68 | `0x180031e5d` | `throw` |
| 0x69 | `0x180031e69` | `create` |
| 0x6A | `0x18003144b` | `end-get` |
| 0x6B | `0x180031454` | `end-set` |
| 0x6C | `0x180030f95` | (operand / special) |
| 0x6D | `0x180031a95` | (operand / special) |
| 0x6E | `0x180031382` | `Continue` |
| 0x6F | `0x180031e81` | `abstract` |
| 0x70 | `0x180031d0c` | `class` |
| 0x71 | `0x180031d2a` | `end-class` |
| 0x72 | `0x180031d50` | `extends` |
| 0x73 | `0x180031e9d` | `protected` |
| 0x74 | `0x180031b86` | (operand / special) |
| 0x75 | `0x180031ea9` | (operand / special) |
| 0x76 | `0x180031f4a` | (operand / special) |
| 0x77 | `0x180032023` | (operand / special) |
| 0x78 | `0x1800320f1` | (operand / special) |
| 0x79 | `0x1800315ea` | `ComponentLife` |

### Native `Declare Function ... Library` (pspcm.dll) -- CONFIRMED

- Parameter loop `0x1804ef550`-`0x1804ef697`: per parameter the native
  type (`| 0x80000000` for `Ref`) goes to one array, the PeopleCode type
  (after `As`; 4 = any without it) `| 0xC0000000` to another; after the
  loop the PeopleCode array is closed with `7`, the native array with `0`,
  and both are appended -- PeopleCode first -- to the program's descriptor
  pool by `0x1804ecb70` (grow buffer `ctx+0x3028`, count `ctx+0x3034`,
  memcpy, return the old count; no sharing). Header slot 21 counts the
  pool's dwords. The return type is not in the pool.
- Type-code tables ({wchar* name, code} pairs):
  - PeopleCode (`0x18082be00`): number 0x13, string 0x01, date 0x02,
    any 0x04, boolean 0x05, time 0x0A, datetime 0x0B, object 0x0D,
    array 0x100007, integer 0x11, float 0x12, binary 0x0C.
  - Native (`0x18082bed0`): boolean 1, integer 2, long 3, uinteger 4,
    ulong 5, string 6, lstring 7, float 8, double 9, ustring 0x0A.
- Errors at the same site: "Unsupported PeopleCode type for parameter to
  library function." (`0x180686150`).
- 29329 (the corpus's only native declarations) is byte-identical with
  these rules -- statement bytes, pool arrays and header slot 21.

### Other observations -- SUGGESTIVE

- 30162 (`end-interface` without `;`, the corpus's only unterminated unit
  closer): stored ends `71 07` (the Cycle 114 bare-closer shape), but its
  class directory also omits the interface's method record while keeping
  its signature slots -- not explained by any rule found.

## Cycle 171: the exact HCDEV patch (8.61.15)

An 8.61.15 PS_HOME exists on local storage: the DPK archive
`/mnt/ou_network/peoplesoft_dev/ps86115/dpk/archives/pt-pshome8.61.15.tgz`
(build `PT861P15B_2509220501`). The extracted
`ps_home8.61.15/bin/client/winx86` beside it is incomplete (91 files,
no pspcm.dll). The compiler-relevant files were extracted to a scratch
directory for analysis only (archive untouched, nothing committed):

| DLL | sha256 | FileVersion | ProductVersion | PE timestamp (UTC) | PDB |
|---|---|---|---|---|---|
| pspcm.dll | `ad57fe0923022e49449e33f80cc7a8f91d8b6446d5f83a8fa3fcd67c11fa1d0b` | 8.61.15 | 8.61.15 | 2025-09-22 16:53 | `C:\PT861P15B_2509220501-retail\peopletools\src\pspcm\obj_client\pspcm.pdb` |
| pspceval.dll | `78502c4dae218fcb874015d420458addb9b555dded398b035c0ab6cc556942e0` | 8.61.15 | 8.61.15 | 2025-09-22 16:38 | `C:\PT861P15B_2509220501-retail\peopletools\src\pspceval\obj_client\pspceval.pdb` |
| psmath.dll | `756bd8d54045e0235c8edbdd2465f2dc7ecda11e1aa119b89edcf3f034d2deba` | 8.61.15 | 8.61.15 | 2025-09-22 16:36 | `C:\PT861P15B_2509220501-retail\peopletools\src\psmath\obj_client\psmath.pdb` |
| pssys.dll | `d470ee890bcd56a3e75592b9b2dc97e5a5e674ddfd8ee83c01ac38d43f27d093` | 8.61.15 | 8.61.15 | 2025-09-22 16:37 | `C:\PT861P15B_2509220501-retail\peopletools\src\pssys\obj_client\pssys.pdb` |
| psmgr.dll | `5eeffcc007274aceedc9d017e4083c100b9452d139ab171a3086b41a5bf1a9c8` | 8.61.15 | 8.61.15 | 2025-09-22 16:37 | `C:\PT861P15B_2509220501-retail\peopletools\src\psmgr\obj_client\psmgr.pdb` |
| pscmn.dll | `44bb0b11a19c1a37d21da9ec65d0f1b8c8e07d9120e3b3cd252692d2bce1068d` | 8.61.15 | 8.61.15 | 2025-09-22 16:36 | `C:\PT861P15B_2509220501-retail\peopletools\src\pscmn\obj_client\pscmn.pdb` |
| pside.exe | `e1d1b610650b96986a88ea38dcf0cb5b4fea0f6e77948aa8085181f410a141f8` | 8.61.15 | 8.61.15 | 2025-09-22 16:59 | `C:\PT861P15B_2509220501-retail\peopletools\src\pside\obj_client\pside.pdb` |


Other local copies: `~/.local/share/wine-bottles/peopletools` and a
Bottles flatpak bottle hold an installed 8.61.07 client (pspcm.dll
identical to `pt861`); `~/Documents/OU/Downloads/PeopleSoftLaunchers`
holds the 8.61.07 `pside.exe`.

With this set, native findings on the class parser are **exact-patch**
evidence for HCDEV.

### Unit closer and member registration (pspcm.dll 8.61.15) -- CONFIRMED

- The class / interface header loop (around `0x18019ea8c`) consumes `;`
  member terminators (token 0x15) and, in interface mode (flag
  `ctx+0x3985`), requires token 0x71 `end-interface`, else 0x5B
  `end-class` -- otherwise "expected end-interface / end-class". Method
  signature slots are appended while the header is parsed. At the closer
  it advances and returns.
- The next routine (`0x18019ebf0`) checks the token after the closer
  (`0x18019ede1`): if `;`, it consumes it, emits 0x2D (`0x1805009f0`,
  edx 0x2D), compiles the following declarations (Global 0x45,
  Component, Declare Function 0x31), and registers the class's members
  (the hash iteration after `0x18019eeb1`, `[ctx+0x3978]+0x348`). If not,
  it returns at `0x18019f140` -- no 0x15, no 0x2D, no member
  registration.
- Corpus agreement: 30162 (`end-interface` at EOF, no `;`) stores `71 07`,
  a self-only directory and its method's signature slots; the 32 programs
  ending `end-class;` / `end-interface;` store `15 2D` and every method
  record.
- Keyword table (`0x18082dab0`..`0x18082dbf0`): end-class 0x5B,
  interface 0x70, end-interface 0x71, implements 0x72 -- the opcodes.
