type ExcelCellValue = string | number | null | undefined;

export type ExcelWorkbookSection = {
  title: string;
  headers: string[];
  rows: ExcelCellValue[][];
};

type ExcelWorkbookOptions = {
  fileName: string;
  worksheetName: string;
  title: string;
  subtitle?: string;
  metadata?: Array<[string, ExcelCellValue]>;
  sections: ExcelWorkbookSection[];
};

function escapeXml(value: ExcelCellValue) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeWorksheetName(name: string) {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "Report").slice(0, 31);
}

function cell(value: ExcelCellValue, styleId?: string, mergeAcross = 0) {
  const isNumber = typeof value === "number" && Number.isFinite(value);
  const type = isNumber ? "Number" : "String";
  const style = styleId ?? (isNumber ? "NumberCell" : "TextCell");
  const merge = mergeAcross > 0 ? ` ss:MergeAcross="${mergeAcross}"` : "";

  return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

function row(cells: string[], height?: number) {
  const rowHeight = height ? ` ss:Height="${height}"` : "";
  return `<Row${rowHeight}>${cells.join("")}</Row>`;
}

function blankRow() {
  return "<Row ss:Height=\"10\" />";
}

function padCells(values: ExcelCellValue[], totalColumns: number) {
  return Array.from({ length: totalColumns }, (_, index) => values[index] ?? "");
}

function downloadFile(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/vnd.ms-excel;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".xls") ? fileName : `${fileName}.xls`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportStyledExcelWorkbook({
  fileName,
  worksheetName,
  title,
  subtitle,
  metadata = [],
  sections
}: ExcelWorkbookOptions) {
  const totalColumns = Math.max(4, ...sections.map((section) => section.headers.length), ...sections.flatMap((section) => section.rows.map((sectionRow) => sectionRow.length)));
  const mergeAll = totalColumns - 1;
  const columns = Array.from({ length: totalColumns }, (_, index) => {
    const width = index === 0 ? 210 : index === totalColumns - 1 ? 240 : 165;
    return `<Column ss:AutoFitWidth="0" ss:Width="${width}" />`;
  }).join("");

  const metadataRows = metadata.map(([label, value]) =>
    row([
      cell(label, "MetaLabel"),
      cell(value, "MetaValue", Math.max(0, totalColumns - 2))
    ])
  );

  const sectionRows = sections.flatMap((section) => [
    blankRow(),
    row([cell(section.title, "SectionTitle", mergeAll)], 24),
    row(padCells(section.headers, totalColumns).map((heading) => cell(heading, "HeaderCell")), 22),
    ...section.rows.map((sectionRow) => row(padCells(sectionRow, totalColumns).map((value) => cell(value))))
  ]);

  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>WESCOMM</Author>
    <Company>Wesleyan University-Philippines</Company>
  </DocumentProperties>
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center" ss:WrapText="1" />
      <Font ss:FontName="Aptos" ss:Size="11" ss:Color="#17211B" />
    </Style>
    <Style ss:ID="Title">
      <Alignment ss:Vertical="Center" />
      <Font ss:FontName="Aptos Display" ss:Size="20" ss:Bold="1" ss:Color="#006633" />
      <Interior ss:Color="#EAF5EC" ss:Pattern="Solid" />
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8D7BF" /></Borders>
    </Style>
    <Style ss:ID="Subtitle">
      <Alignment ss:Vertical="Center" />
      <Font ss:FontName="Aptos" ss:Size="11" ss:Color="#5F6D66" />
    </Style>
    <Style ss:ID="MetaLabel">
      <Alignment ss:Vertical="Center" ss:WrapText="1" />
      <Font ss:FontName="Aptos" ss:Size="11" ss:Bold="1" ss:Color="#344139" />
      <Interior ss:Color="#F4F8F5" ss:Pattern="Solid" />
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE6DC" /></Borders>
    </Style>
    <Style ss:ID="MetaValue">
      <Alignment ss:Vertical="Center" ss:WrapText="1" />
      <Font ss:FontName="Aptos" ss:Size="11" ss:Color="#17211B" />
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE6DC" /></Borders>
    </Style>
    <Style ss:ID="SectionTitle">
      <Alignment ss:Vertical="Center" />
      <Font ss:FontName="Aptos" ss:Size="13" ss:Bold="1" ss:Color="#FFFFFF" />
      <Interior ss:Color="#006633" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="HeaderCell">
      <Alignment ss:Vertical="Center" ss:WrapText="1" />
      <Font ss:FontName="Aptos" ss:Size="11" ss:Bold="1" ss:Color="#17211B" />
      <Interior ss:Color="#EAF5EC" ss:Pattern="Solid" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B8D7BF" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE6DC" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE6DC" />
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DCE6DC" />
      </Borders>
    </Style>
    <Style ss:ID="TextCell">
      <Alignment ss:Vertical="Top" ss:WrapText="1" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E9E3" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#EEF3EF" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#EEF3EF" />
      </Borders>
    </Style>
    <Style ss:ID="NumberCell">
      <Alignment ss:Horizontal="Right" ss:Vertical="Top" />
      <NumberFormat ss:Format="#,##0" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E9E3" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#EEF3EF" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#EEF3EF" />
      </Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="${escapeXml(safeWorksheetName(worksheetName))}">
    <Table ss:ExpandedColumnCount="${totalColumns}" x:FullColumns="1" x:FullRows="1">
      ${columns}
      ${row([cell(title, "Title", mergeAll)], 32)}
      ${subtitle ? row([cell(subtitle, "Subtitle", mergeAll)], 22) : ""}
      ${metadataRows.join("")}
      ${sectionRows.join("")}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <PageSetup>
        <Layout x:Orientation="Landscape" />
      </PageSetup>
      <FitToPage />
      <Print>
        <FitWidth>1</FitWidth>
        <FitHeight>0</FitHeight>
      </Print>
      <Selected />
      <FreezePanes />
      <FrozenNoSplit />
      <SplitHorizontal>1</SplitHorizontal>
      <TopRowBottomPane>1</TopRowBottomPane>
      <ActivePane>2</ActivePane>
      <ProtectObjects>False</ProtectObjects>
      <ProtectScenarios>False</ProtectScenarios>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`;

  downloadFile(workbook, fileName);
}
