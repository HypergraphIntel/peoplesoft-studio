/** Static Text's captured Use tab offers Multi-Currency/Paragraph, not field-control flags. */
export function pageUseRefusal(fieldType: number | undefined, fieldUse: number, secureInvisible: number): string | undefined {
    if (fieldType === 0 && ((fieldUse & 3) !== 0 || secureInvisible !== 0))
        return 'Static Text does not support Display Only or Invisible. Clear both flags; use a field control for those options.';
    return undefined;
}

/**
 * PSPNLFIELD.LBLTEXT holds 60 characters (VARCHAR2(60) on HRDMO 8.62 and HCDEV 8.61; App Designer's label box stops
 * there). A longer label reached Oracle as ORA-12899 and rolled the save back (E27, E40, E46, E55, E69, E78); it is refused
 * first, naming the control. Text a page needs beyond that goes in an HTML Area or a message.
 */
export const PAGE_LABEL_MAX = 60;
export function pageLabelRefusal(control: string, text: string | undefined): string | undefined {
  if (text === undefined || text.length <= PAGE_LABEL_MAX) return undefined;
  return `${control}: a label holds at most ${PAGE_LABEL_MAX} characters (PSPNLFIELD.LBLTEXT); this one has ${text.length}. ` +
    'Shorten it, or put longer text in an HTML Area or a message catalog entry.';
}
