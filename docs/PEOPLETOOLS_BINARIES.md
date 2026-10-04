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
