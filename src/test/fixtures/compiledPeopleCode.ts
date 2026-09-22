/**
 * OU_OJ_LAYOUT.Activate's real PSPCMPROG bytes (HCDEV), 104 bytes matching
 * its PROGLEN exactly. Its known-correct source, from an App Designer export
 * of the same program, is a single line:
 *   AddOnLoadScript(GetHTMLText(HTML.OU_OJ_LOAD_CSS));
 *
 * This caught a real bug: byte 0x00 (the UTF-16LE upper byte of ordinary
 * ASCII text, e.g. in "AddOnLoadScript") was mapped as an unconditional
 * end-of-program opcode, so decoding stopped after essentially one byte.
 * PROGLEN for this program is exactly its buffer length, confirming there is
 * no in-band terminator to stop early on.
 */
export const ACTIVATE_BYTES = Buffer.from([
  0xa0, 0x00, 0x00, 0x00, 0x00, 0x43, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x85, 0x00, 0x00, 0x00, 0x0a,
  0x41, 0x00, 0x64, 0x00, 0x64, 0x00, 0x4f, 0x00, 0x6e, 0x00,
  0x4c, 0x00, 0x6f, 0x00, 0x61, 0x00, 0x64, 0x00, 0x53, 0x00,
  0x63, 0x00, 0x72, 0x00, 0x69, 0x00, 0x70, 0x00, 0x74, 0x00,
  0x00, 0x00, 0x0b, 0x0a,
  0x47, 0x00, 0x65, 0x00, 0x74, 0x00, 0x48, 0x00, 0x54, 0x00,
  0x4d, 0x00, 0x4c, 0x00, 0x54, 0x00, 0x65, 0x00, 0x78, 0x00,
  0x74, 0x00,
  0x00, 0x00, 0x0b,
  0x21, 0x01, 0x00, 0x14, 0x14, 0x15, 0x07
]);


/** Read-only database capture, 2026-09-22. Source labels follow established opcode mappings. */
export const SIMPLE_PROGRAMS = [
  {
    "key": "PA_RT_EMP_FORM.FORM_LONG_NAME.FieldChange",
    "source": "",
    "hex": "a000000000010000000000000000000000000000000000000000000000000000008500000007"
  },
  {
    "key": "PSUSRPRFL_WRK.PREVIOUS_CHUNK.RowInit",
    "source": ";",
    "hex": "a00000000002000000000000000000000000000000000000000000000000000000850000001507"
  },
  {
    "key": "EOP_PUBLISHF.DUMMY.GBL.default.1900-01-01.Step05.OnExecute",
    "source": "Return;",
    "hex": "a0000000000300000000000000000000000000000000000000000000000000000085000000381507"
  }
];

/** Real WEBLIB_CAF.FUNCLIB.FieldFormula; all four sections are nonempty. */
export const DIRECTORY_PROGRAM = Buffer.from('a000000000700000000000000018000000000000000100000000000000010000008500000031320a44006f00520065006d006f007400650000003a210100404600690065006c00640046006f0072006d0075006c006100000042152d4f320a69005300630072006900700074005f0052005000430000000b142d150a44006f00520065006d006f007400650000000b141537152d0769005300630072006900700074005f0052005000430000000000000000000000000000000700000007000000', 'hex');
