# Images

Image definitions (5,066 on HRDMO, PeopleTools 8.62.09) and how PeopleSoft
Studio shows them (`src/editors/imageHtml.ts`, `imagePanel.ts`). Read-only.

| Table | Holds |
|---|---|
| `PSCONTDEFN` (`CONTTYPE` 1) | the image: `CONTNAME`, `ALTCONTNUM` (58 images have a second, often another format), `CONTFMT`, description |
| `PSCONTENT` | its bytes, by `SEQNUM` (one chunk each on HRDMO); `COMPALG` is 0 for every image: not compressed |

`CONTFMT` on HRDMO: gif 2,368, svg 2,013, png 546, jpg 166, dib 16, bmp
11, cur 2, web 1 (case varies). Every image's bytes carry its format's
signature except 13 stored as gif that are JPEG or PNG (NEW_PORTAL_HDR_POPUP,
PTACM_ERROR, PTAL_IFRAME_SEP_COLLAPSED ...): the panel goes by the bytes
where it recognises them, else by `CONTFMT`. SVGs are stored as text.

An image opens in a panel, each alternate with its format and size, from a
data URL under a policy that allows nothing but data images. Projects:
OBJECTTYPE 49, OBJECTIDs 91 name / 95 alternate. Images are in the
Definition Browser and Open Definition.
