#!/usr/bin/env python3
"""Writes the representative Build Request's business documents (V15-3) as real Office files, with no Office library:
docs/build-requests/samples/benefits-eligibility/. The request is synthetic; names and figures are invented.

  python3 -I tools/lab/build-request-samples.py
"""
from pathlib import Path
from xml.sax.saxutils import escape
import zipfile

out = Path(__file__).resolve().parents[2] / 'docs/build-requests/samples/benefits-eligibility'
out.mkdir(parents=True, exist_ok=True)
FIXED = (2026, 10, 22, 0, 0, 0)  # stable zip timestamps, so regenerating changes nothing


def write_zip(path, parts):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = zipfile.ZipInfo(name, FIXED); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)


# ---------------------------------------------------------------- requirements (.docx)
def para(text, style=None):
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
    return f'<w:p>{props}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def table(rows):
    cells = lambda row: ''.join(f'<w:tc><w:p><w:r><w:t xml:space="preserve">{escape(c)}</w:t></w:r></w:p></w:tc>' for c in row)
    return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>' + ''.join(f'<w:tr>{cells(r)}</w:tr>' for r in rows) + '</w:tbl>'


body = [
    para('Benefits Eligibility File for the Benefits Administrator', 'Title'),
    para('Requested by: Benefits Operations. Priority: needed before open enrollment.'),
    para('Background', 'Heading1'),
    para('Our new third-party benefits administrator needs a monthly file of everyone who is eligible for benefits, so '
         'they can load enrollments and send welcome packets. Today we email them a spreadsheet that someone builds by '
         'hand from a query, which is slow and has gone out with mistakes twice this year.'),
    para('What we need', 'Heading1'),
    para('1. A file we can run ourselves from PeopleSoft on the first business day of the month (and again whenever '
         'the administrator asks for a refresh). It should run in the background like our other reports, and the file '
         'should be available to download from the Report Manager when it finishes.'),
    para('2. Everyone with an active job (active, leave with pay, leave, suspended) as of the run date, one line per '
         'job, but only people who participate in a benefit program.'),
    para('3. Let us pick the as-of date when we run it (default today) and optionally limit it to one company; blank '
         'means all companies.'),
    para('4. The columns and formats are in the attached file specification from the administrator. Their system is '
         'strict: comma separated, a header line, text in double quotes, dates as YYYY-MM-DD, UTF-8 without a byte '
         'order mark, file name ZZ_BENELIG_YYYYMMDD.csv using the as-of date.'),
    para('5. Only the HR benefits team should be able to run it. Use a new permission list for it; we will add it to '
         'our role.'),
    para('6. Please put everything you build in one project so it can be moved to the test database for our sign-off '
         'and then to production.'),
    para('Rules from the administrator', 'Heading1'),
    table([['Topic', 'Rule'],
           ['Employee status', 'A = Active, L = Leave of absence, P = Leave with pay, S = Suspended; send the code as is.'],
           ['Name', 'Primary name: first name and last name in separate columns, no middle name.'],
           ['Benefit program', 'The program the person participates in as of the as-of date (most recent effective row on or before it).'],
           ['Full/part time', 'F or P from the job.'],
           ['Empty values', 'Send an empty quoted string ("") for missing text and an empty field for a missing date.']]),
    para('Questions', 'Heading1'),
    para('If something is unclear, ask in the request; Benefits Operations owns the answers. We do not need a page to '
         'view the data, only the file.'),
]
document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            + ''.join(body) + '<w:sectPr/></w:body></w:document>')
styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
          + ''.join(f'<w:style w:type="paragraph" w:styleId="{s}"><w:name w:val="{n}"/><w:rPr><w:b/><w:sz w:val="{z}"/></w:rPr></w:style>'
                    for s, n, z in [('Title', 'Title', 36), ('Heading1', 'heading 1', 28)])
          + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
          + ''.join(f'<w:{b} w:val="single" w:sz="4" w:space="0" w:color="auto"/>' for b in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
          + '</w:tblBorders></w:tblPr></w:style></w:styles>')
write_zip(out / 'Benefits_Eligibility_File_Requirements.docx', {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/document.xml': document,
    'word/styles.xml': styles,
})

# ---------------------------------------------------------------- file specification (.xlsx)
spec = [
    ['Seq', 'Column header', 'Description', 'Type', 'Max length', 'Example'],
    ['1', 'EmployeeId', 'Employee ID', 'Text', '11', 'KU0001'],
    ['2', 'RecordNumber', 'Employment record number', 'Number', '3', '0'],
    ['3', 'FirstName', 'Primary first name', 'Text', '30', 'Maria'],
    ['4', 'LastName', 'Primary last name', 'Text', '30', 'Lopez'],
    ['5', 'BirthDate', 'Date of birth', 'Date YYYY-MM-DD', '10', '1980-04-17'],
    ['6', 'HireDate', 'Most recent hire date', 'Date YYYY-MM-DD', '10', '2019-06-03'],
    ['7', 'Company', 'Company code', 'Text', '3', 'GBI'],
    ['8', 'Department', 'Department ID', 'Text', '10', '10200'],
    ['9', 'EmployeeStatus', 'Employee status code (A, L, P, S)', 'Text', '1', 'A'],
    ['10', 'FullPartTime', 'F or P', 'Text', '1', 'F'],
    ['11', 'BenefitProgram', 'Benefit program as of the as-of date', 'Text', '3', 'KUA'],
    ['12', 'AsOfDate', 'The as-of date the file was run for', 'Date YYYY-MM-DD', '10', '2026-11-02'],
]
notes = [['Item', 'Value'], ['Delimiter', 'Comma'], ['Header row', 'Yes, exactly the column headers above'],
         ['Text qualifier', 'Double quote around every Text column'], ['Encoding', 'UTF-8, no byte order mark'],
         ['Line ending', 'CRLF or LF are both accepted'], ['File name', 'ZZ_BENELIG_YYYYMMDD.csv (as-of date)'],
         ['Sort', 'EmployeeId, then RecordNumber']]
strings = sorted({c for sheet in (spec, notes) for row in sheet for c in row if not c.isdigit()})
index = {s: i for i, s in enumerate(strings)}
col = lambda i: chr(65 + i)
def sheet_xml(rows):
    out_rows = []
    for r, row in enumerate(rows, 1):
        cells = ''.join(f'<c r="{col(i)}{r}"><v>{c}</v></c>' if c.isdigit() else f'<c r="{col(i)}{r}" t="s"><v>{index[c]}</v></c>' for i, c in enumerate(row))
        out_rows.append(f'<row r="{r}">{cells}</row>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData>' + ''.join(out_rows) + '</sheetData></worksheet>')
write_zip(out / 'TPA_Eligibility_File_Specification.xlsx', {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Columns" sheetId="1" r:id="rId1"/>'
        '<sheet name="File rules" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet_xml(spec),
    'xl/worksheets/sheet2.xml': sheet_xml(notes),
    'xl/sharedStrings.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + ''.join(f'<si><t xml:space="preserve">{escape(s)}</t></si>' for s in strings) + '</sst>',
})

(out / 'Request_email.txt').write_text(
    'From: Benefits Operations\nSubject: Monthly eligibility file for the new benefits administrator\n\n'
    'Hi,\n\nAttached are our requirements and the administrator\'s file specification. We would like to run this '
    'ourselves each month instead of building the spreadsheet by hand. The first file is due before open enrollment, '
    'so please build it in development and move it to test so we can check a run against the administrator\'s '
    'sample. Let us know if anything in the spec does not match what PeopleSoft has.\n\nThanks,\nBenefits Operations\n')
print('wrote', *sorted(p.name for p in out.iterdir()))
