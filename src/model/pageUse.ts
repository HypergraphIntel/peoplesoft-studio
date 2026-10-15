/** Static Text's captured Use tab offers Multi-Currency/Paragraph, not field-control flags. */
export function pageUseRefusal(fieldType: number | undefined, fieldUse: number, secureInvisible: number): string | undefined {
    if (fieldType === 0 && ((fieldUse & 3) !== 0 || secureInvisible !== 0))
        return 'Static Text does not support Display Only or Invisible. Clear both flags; use a field control for those options.';
    return undefined;
}
