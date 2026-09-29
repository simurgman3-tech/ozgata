import JSZip from "npm:jszip@3.10.1";
import { orderTemplate } from "./order-template.js";

const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"");
export function validQuantity(value) { return Number.isSafeInteger(value) && value > 0 && value <= 100000; }

export async function orderExcel(items, orderNo, date = new Date()) {
  if (!items.length || items.some(p => !validQuantity(p.quantity))) throw new Error("Sipariş miktarlarını tamamla.");
  if (new Set(items.map(p => p.ref)).size !== items.length) throw new Error("Tekrarlanan sipariş referansı.");
  const zip = new JSZip(), last = items.length + 9, totalRow = last + 1;
  const total = items.reduce((sum,p) => sum + p.quantity, 0);
  const dateLabel = new Intl.DateTimeFormat("tr-TR", {timeZone:"Europe/Istanbul",day:"2-digit",month:"2-digit",year:"numeric"}).format(date);
  const textCell = (cell,style,text) => `<c r="${cell}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  const numberCell = (cell,style,num) => `<c r="${cell}" s="${style}"><v>${num}</v></c>`;
  let header = orderTemplate.header;
  header = header.replace(/<c\b[^>]*r="A6"[^>]*>[\s\S]*?<\/c>/,textCell("A6",4,`Order Date : ${dateLabel}`));
  header = header.replace(/<c\b[^>]*r="A7"[^>]*>[\s\S]*?<\/c>/,textCell("A7",25,`ORDER NO: ${orderNo || "—"}`));
  const body = items.map((p,index) => {
    const r=index+10, height=Math.max(30,Math.ceil(p.name.length/85)*15);
    return `<row r="${r}" spans="1:4" ht="${height}" customHeight="1">${numberCell(`A${r}`,13,index+1)}${textCell(`B${r}`,19,p.ref)}${textCell(`C${r}`,17,p.name)}${numberCell(`D${r}`,18,p.quantity)}</row>`;
  }).join("");
  const footer = `<row r="${totalRow}" ht="24" customHeight="1">${textCell(`A${totalRow}`,28,"TOTAL ORDER QTY.")}<c r="B${totalRow}" s="29"/><c r="C${totalRow}" s="30"/><c r="D${totalRow}" s="14"><f>SUM(D10:D${last})</f><v>${total}</v></c></row>`;
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:D${totalRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="9" topLeftCell="A10" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="9" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="94.42578125" customWidth="1"/><col min="4" max="4" width="10" customWidth="1"/></cols><sheetData>${header}${body}${footer}</sheetData><autoFilter ref="A9:D${last}"/><mergeCells count="4"><mergeCell ref="A2:D3"/><mergeCell ref="A7:B8"/><mergeCell ref="C6:C7"/><mergeCell ref="A${totalRow}:C${totalRow}"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><drawing r:id="rId1"/></worksheet>`;
  zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file("_rels/.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml",`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ABBOTT" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">ABBOTT!$A$1:$D$${totalRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">ABBOTT!$1:$9</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml",sheet);
  zip.file("xl/styles.xml",orderTemplate.styles);
  zip.file("xl/theme/theme1.xml",orderTemplate.theme);
  zip.file("xl/worksheets/_rels/sheet1.xml.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file("xl/drawings/drawing1.xml",orderTemplate.drawing);
  zip.file("xl/drawings/_rels/drawing1.xml.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpg"/></Relationships>`);
  zip.file("xl/media/image1.jpg",orderTemplate.image,{base64:true});
  return zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
}
