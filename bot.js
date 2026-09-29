import { products } from "./products.js";
import { orderExcel, validQuantity } from "./order.js";
import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import JSZip from "npm:jszip@3.10.1";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const TOKEN = Deno.env.get("TELEGRAM_TOKEN");
const SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
if (!TOKEN || !SECRET) throw new Error("TELEGRAM_TOKEN ve TELEGRAM_WEBHOOK_SECRET gerekli");
const API = `https://api.telegram.org/bot${TOKEN}/`;
const normalize = (v) => String(v ?? "").toLocaleLowerCase("tr-TR")
  .replace(/ı/g,"i").replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
  .replace(/ö/g,"o").replace(/ç/g,"c").replace(/\bplot\b/g,"pilot")
  .replace(/\bpro a\b/g,"proa").replace(/\bnc neo\b/g,"nc trek neo")
  .replace(/\bbalon\b/g,"balloon").replace(/\btel\b/g,"wire").trim();
const familyWords=["pilot","proa","pros","trek","xience","mini","neo","armada","viatrac","amplatzer","supera","bmw","pressure","pressurewire","whisper","command","steelcore","spartacore","supracore","turntrac","versaturn","herculink","omnilink","progress","infiltrac","dragonfly","diamondback","perclose","prostyle","floppy","cross"];
function distance(a,b){
 if(Math.abs(a.length-b.length)>2)return 3;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;
 }if(a.length===b.length){for(let i=0;i<a.length-1;i++){if(a.slice(0,i)+a[i+1]+a[i]+a.slice(i+2)===b)return 1;}}return prev[b.length];
}
function queryText(input){
 return normalize(input).replace(/xience\s*(proa|pros|pro)/g,"xience $1").replace(/nc\s*trek\s*neo/g,"nc trek neo").replace(/mini\s*trek/g,"mini trek").replace(/supra\s*core/g,"supra core").replace(/infiltrac\s*plus/g,"infiltrac plus").replace(/pressure(?:\s*wire)?/g,"pressurewire").replace(/cross\s*-?\s*it/g,"cross it").replace(/([a-z])(\d)/g,"$1 $2").replace(/\bplot\b/g,"pilot").split(/(\s+)/).map(token=>{
  if(!/^[a-z]{4,}$/.test(token)||familyWords.includes(token))return token;
  const matches=familyWords.filter(w=>distance(token,w)<=1);
  return matches.length===1?matches[0]:token;
 }).join("").replace(/\bpressure\b/g,"pressurewire");
}
let entries=[];
const families=[
  ["XIENCE PROA","xience proa"],["XIENCE PROS","xience pros"],
  ["XIENCE PRO 48","xience pro 48"],
  ["XIENCE SIERRA","xience sierra"],["XIENCE ALPINE","xience alpine"],
  ["MINI TREK","mini trek"],["NC TREK NEO","nc trek neo"],["NC TREK","nc trek"],
  ["TREK","trek"],["ARMADA","armada"],["VIATRAC","viatrac"],
  ["PILOT 50","pilot 50"],["PILOT 150","pilot 150"],["PILOT 200","pilot 200"],["PILOT","pilot"],["BMW UNIVERSAL II","balance middleweight universal ii"],
  ["SUPERA","supera"],["AMPLATZER","amplatzer"]
];
function family(p) {
  if(p.category)return p.category;
  for(const [label,key] of families) if(p.n.includes(key)) return label;
  return p.n.split(/\s+/).slice(0,2).join(" ").toUpperCase();
}
let byFamily=new Map();
async function refreshCatalog(){
 entries=products.map((p,i)=>({...p,i,n:normalize(p.name),g:normalize(p.group),r:normalize(p.ref)}));
 for(const p of entries)p.words=queryText(p.name+" "+family(p)+" "+variant(p)).split(/[^a-z0-9.]+/);
 byFamily=new Map();for(const p of entries){const f=family(p);byFamily.set(f,[...(byFamily.get(f)||[]),p]);}
 for(const list of byFamily.values())list.sort((a,b)=>Number(b.preferred)-Number(a.preferred));
}
async function api(method,body) {
 const res=await fetch(API+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const data=await res.json();if(!data.ok) throw new Error(method+": "+data.description);return data.result;
}
const buttons=(items)=>({inline_keyboard:items.map(x=>[x])});
const send=(chat_id,text,reply_markup)=>api("sendMessage",{chat_id,text,reply_markup,link_preview_options:{is_disabled:true}});
const PER_PAGE=7;
const stateTable=sqlite.execute("CREATE TABLE IF NOT EXISTS ozgata_catalog_state_v3(chat_id TEXT PRIMARY KEY, results TEXT NOT NULL, selected TEXT NOT NULL, page INTEGER NOT NULL)");
const orderTable=sqlite.execute("CREATE TABLE IF NOT EXISTS ozgata_order_state_v1(chat_id TEXT PRIMARY KEY, quantities TEXT NOT NULL, awaiting TEXT NOT NULL, order_no TEXT NOT NULL)");
async function state(chat){
 await stateTable;await orderTable;
 const r=await sqlite.execute({sql:"SELECT results,selected,page FROM ozgata_catalog_state_v3 WHERE chat_id=?",args:[String(chat)]});
 const orders=await sqlite.execute({sql:"SELECT quantities,awaiting,order_no FROM ozgata_order_state_v1 WHERE chat_id=?",args:[String(chat)]});
 const row=r.rows[0],o=orders.rows[0];return {...(row?{results:JSON.parse(row.results),selected:JSON.parse(row.selected),page:Number(row.page)}:{results:[],selected:[],page:0}),quantities:o?JSON.parse(o.quantities):{},awaiting:o?.awaiting||"",orderNo:o?.order_no||""};
}
async function saveState(chat,s){
 await stateTable;
 await sqlite.execute({sql:"INSERT INTO ozgata_catalog_state_v3(chat_id,results,selected,page) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET results=excluded.results,selected=excluded.selected,page=excluded.page",args:[String(chat),JSON.stringify(s.results),JSON.stringify(s.selected),s.page]});
 await orderTable;
 await sqlite.execute({sql:"INSERT INTO ozgata_order_state_v1(chat_id,quantities,awaiting,order_no) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET quantities=excluded.quantities,awaiting=excluded.awaiting,order_no=excluded.order_no",args:[String(chat),JSON.stringify(s.quantities||{}),s.awaiting||"",s.orderNo||""]});
}
const e=(i)=>entries[i];
const row=(...items)=>items.map(([text,callback_data])=>({text,callback_data}));
const markup=(...rows)=>({inline_keyboard:rows});
async function document(chat,filename,bytes,mime,caption){
 const form=new FormData();form.append("chat_id",String(chat));form.append("caption",caption);
 form.append("document",new Blob([bytes],{type:mime}),filename);
 const res=await fetch(API+"sendDocument",{method:"POST",body:form});const data=await res.json();
 if(!data.ok)throw new Error("sendDocument: "+data.description);
}
const esc=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"");
async function excel(items,audience="internal"){
 const zip=new JSZip();const fields=["Kategori","Model","Ölçü","Ürün Adı","UBB","Katalog Referansı","SUT Kodları","Marka","DMO","Açıklama","Açıklama 2","Kontrol Notu","Sık Kullanılan"];
 const hospital=audience==="hospital";
 const lines=hospital?[["UBB","Referans","SUT","Marka","Ürün Adı"],...items.map(p=>[p.ubb,p.ref,p.sut||p.sutStatus||"Belirtilmemiş",p.brand,p.name])]:[fields,...items.map(p=>[family(p),model(p),measurement(p),p.name,p.ubb,p.ref,p.sut||p.sutStatus||"Belirtilmemiş",p.brand,p.dmo,p.description,p.description2,p.note,p.preferred?"Evet":""])];
 const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="3" width="24" customWidth="1"/><col min="4" max="4" width="65" customWidth="1"/><col min="5" max="9" width="24" customWidth="1"/><col min="10" max="12" width="55" customWidth="1"/><col min="13" max="13" width="18" customWidth="1"/></cols><sheetData>${lines.map((line,i)=>`<row r="${i+1}">${line.map((val,j)=>`<c r="${"ABCDEFGHIJKLM"[j]}${i+1}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:M${lines.length}"/></worksheet>`;
 zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
 zip.file("_rels/.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
 zip.file("xl/workbook.xml",`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ürün Listesi" sheetId="1" r:id="rId1"/></sheets></workbook>`);
 zip.file("xl/_rels/workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
 zip.file("xl/worksheets/sheet1.xml",hospital?xml.replace(/<cols>[\s\S]*?<\/cols>/,`<cols><col min="1" max="4" width="24" customWidth="1"/><col min="5" max="5" width="75" customWidth="1"/></cols>`).replace(`A1:M${lines.length}`,`A1:E${lines.length}`):xml);
 return await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
}
async function pdf(items,title,audience="internal"){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const response=await fetch(new URL("./font.ttf",import.meta.url));if(!response.ok)throw new Error("PDF font indirilemedi");
 const font=await pdf.embedFont(await response.arrayBuffer(),{subset:true});
 const wrap=(text,max,size=9)=>{
  const output=[];let current="";
  for(const word of String(text||"").replace(/\s+/g," ").split(" ")){
   if(font.widthOfTextAtSize((current?current+" ":"")+word,size)>max&&current){output.push(current);current="";}
   if(font.widthOfTextAtSize(word,size)>max){let part="";for(const letter of word){if(font.widthOfTextAtSize(part+letter,size)>max){output.push(part);part="";}part+=letter;}current=part;}else current+=(current?" ":"")+word;
  }if(current)output.push(current);return output;
 };
 let page,y,pageNo=0;
 function newPage(){page=pdf.addPage([842,595]);pageNo++;y=550;page.drawRectangle({x:0,y:565,width:842,height:30,color:rgb(.08,.16,.28)});page.drawText("ÖZGATA | "+title,{x:30,y:575,font,size:12,color:rgb(1,1,1)});page.drawText(String(pageNo),{x:795,y:20,font,size:8});}
 newPage();
 for(const [index,p] of items.entries()){
  const texts=audience==="hospital"?[`${index+1}. ${p.name}`,`UBB: ${p.ubb} | Ref: ${p.ref} | SUT: ${p.sut||p.sutStatus||"Belirtilmemiş"}`,`Marka: ${p.brand||"Belirtilmemiş"}`]:[`${index+1}. ${model(p)} | ${measurement(p)} | ${variant(p)}${p.preferred?" | Sık kullanılan":""}`,p.name,`UBB: ${p.ubb} | Ref: ${p.ref} | SUT: ${p.sut||p.sutStatus||"Belirtilmemiş"}`,`Marka: ${p.brand||"Belirtilmemiş"}${p.dmo?" | DMO: "+p.dmo:""}`,p.description,p.description2,p.note?"Kontrol notu: "+p.note:""];
  const lines=texts.filter(Boolean).flatMap(t=>wrap(t,750));const height=lines.length*12+12;
  if(y-height<40)newPage();
  if(index%2===0)page.drawRectangle({x:25,y:y-height+6,width:790,height,color:rgb(.95,.97,.99)});
  for(const line of lines){page.drawText(line,{x:33,y,font,size:9,color:rgb(.07,.17,.29)});y-=12;}
  y-=12;
 }
 return await pdf.save();
}
function dimensions(p){
 const match=p.name.match(/(\d+(?:[.,]\d+)?)\s*mm\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*mm/i) || p.name.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+)\s*mm/i);
 return match?`${Number(match[1].replace(",","."))}x${Number(match[2].replace(",","."))} mm`:"";
}
function model(p){
 const n=p.name,f=family(p);
 if(f==="TREK")return /mini trek/i.test(n)?"MINI TREK RX":"TREK RX";
 if(f==="PILOT")return n.match(/PILOT\s+\d+/i)?.[0].toUpperCase()||f;
 if(f==="CROSS-IT")return n.match(/CROSS-IT\s+\d+XT/i)?.[0].toUpperCase()||f;
 if(f==="PROGRESS")return n.match(/PROGRESS\s+\d+T?/i)?.[0].toUpperCase()||f;
 if(f==="COMMAND")return /COMMAND 18/i.test(n)?"COMMAND 18":"COMMAND 14";
 if(f==="INFILTRAC")return /PLUS/i.test(n)?"INFILTRAC PLUS":"INFILTRAC";
 if(f==="WHISPER")return /EXTRA SUPPORT/i.test(n)?"WHISPER ES":/\bLS\b/i.test(n)?"WHISPER LS":"WHISPER MS";
 if(f==="STEELCORE")return /\bLT\b/i.test(n)?"STEELCORE 18 LT":"STEELCORE 18";
 if(f==="AMPLATZER")return /Plug 2 /i.test(n)?"AVP 2":/Plug 4 /i.test(n)?"AVP 4":"AVP";
 return f;
}
function measurement(p){
 const dim=dimensions(p),cms=[...p.name.matchAll(/(\d+(?:[.,]\d+)?)\s*cm\b/ig)].map(m=>m[1].replace(",",".")+" cm");
 const bits=[dim,cms.at(-1)];
 if(family(p)==="SPARTACORE")bits.unshift(cms[0]?`Uç ${cms[0]}`:"");
 if(family(p)==="AMPLATZER")return p.name.match(/\d+\s*mm/i)?.[0]||"";
 return bits.filter(Boolean).join(" / ");
}
function variant(p){
 const n=p.name,bits=[];
 if(/WIRELESS/i.test(n))bits.push("Kablosuz");else if(/CABLED/i.test(n))bits.push("Kablolu");
 if(/\bJ\s*TIP\b|\bJ\s*UÇ\b|\bJ Tip\b/i.test(n))bits.push("J uç");else if(/STRAIGHT\s*TIP|DÜZ/i.test(n))bits.push("Düz uç");
 if(/W\/O\s*MARKER/i.test(n))bits.push("Markersiz");
 if(family(p)==="TURNTRAC FLEX")bits.push(n.match(/\d+(?:[.,]\d+)?\s*g\b/i)?.[0],/\bpHC\b/i.test(n)?"pHC":"HC");
 if(family(p)==="VERSATURN F")bits.push(/UNCOATED/i.test(n)?"Kaplamasız uç":"Tam kaplı");
 if(family(p)==="FLOPPY II")bits.push(/EXTRA SUPPORT/i.test(n)?"ES":"Standart",/HYDRO/i.test(n)?"Hidrofilik":"Microglide");
 if(family(p)==="PACEL")bits.push(/BALONLU/i.test(n)?"Balonlu":"",n.match(/\dF\b/i)?.[0]);
 return bits.filter(Boolean).join(" · ");
}
function shortName(p){return [p.preferred?"⭐":"",model(p),measurement(p),variant(p),p.ref].filter(Boolean).join(" · ");}
function rank(q,p){
 const raw=normalize(q),compact=raw.replace(/[^a-z0-9]/g,"");
 if(/^\d{13,14}$/.test(raw))return p.ubb===raw?10000:-1;
 if(p.r.replace(/[^a-z0-9]/g,"")===compact)return 9000;
 if(/^[a-z0-9-]+$/.test(raw)&&/\d{4}/.test(raw))return -1;
 if(/^(kr|kv|gr)\s*\d+$/.test(raw))return normalize(p.sut).split(/\s*\/\s*/).includes(raw.replace(/\s/g,""))?8000:-1;
 let s=queryText(q),score=0;
 if(/\btrek\b/.test(s)&&!(/\bnc\b|\bneo\b/.test(s))&&family(p)==="NC TREK NEO")return -1;
 const d=s.match(/(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?/i);
 if(d){const wanted=`${Number(d[1].replace(",","."))}x${Number(d[2].replace(",","."))} mm`;if(dimensions(p)!==wanted)return -1;score+=100;s=s.replace(d[0]," ");}
 const length=s.match(/\b(\d{2,3})\s*cm\b/);
 if(length){if(!new RegExp(`(^|[^0-9])${length[1]}\\s*cm\\b`,"i").test(p.name))return -1;score+=60;s=s.replace(length[0]," ");}
 const words=p.words;
 for(let term of s.split(/\s+/).filter(Boolean)){
  if(["mm","cm","x","wire","urun","ubb","sut","kodu","referans","katalog"].includes(term))continue;
  if(term==="balloon"){if(!/BALON|BALLOON|TREK|ARMADA|VIATRAC/i.test(p.group+" "+family(p)))return -1;score+=10;continue;}
  if(term==="stent"){if(!/STENT/i.test(p.name+" "+p.group))return -1;score+=10;continue;}
  if(term==="pro"&&words.includes("pro")){score+=10;continue;}
  if(!words.includes(term)&&!p.r.includes(term))return -1;
  score+=term.length>=4?24:8;
 }
 return score;
}
async function showPage(chat,page=0){
 const s=await state(chat);if(!s.results.length)return welcome(chat,"Önce bir ürün veya aile ara.");
 const total=Math.ceil(s.results.length/PER_PAGE);s.page=Math.max(0,Math.min(page,total-1));await saveState(chat,s);
 const shown=s.results.slice(s.page*PER_PAGE,(s.page+1)*PER_PAGE).map(e);
 const rows=shown.map(p=>row([shortName(p),`i3:${p.i}`]));
 const nav=[];if(s.page>0)nav.push(["⬅️ Önceki",`pg:${s.page-1}`]);
 if(s.page+1<total)nav.push(["Sonraki ➡️",`pg:${s.page+1}`]);if(nav.length)rows.push(row(...nav));
 rows.push(row([`📋 Seçilenler (${s.selected.length})`,"selected"],["📄 Tümünü listele","list:all"]));
 rows.push(row(["📊 Excel","export:all:xlsx"],["📕 PDF","export:all:pdf"]));
 rows.push(row(["📦 Abbott siparişim","order:0"],["🔎 Yeni arama","home"]));
 return send(chat,`🔎 ${s.results.length} ürün bulundu\nSayfa ${s.page+1}/${total} • Gösterilen ${s.page*PER_PAGE+1}–${s.page*PER_PAGE+shown.length}\nBir ürüne dokunup ayrıntısını gör ve seç.`,markup(...rows));
}
async function welcome(chat,note=""){
 const s=await state(chat);if(s.awaiting){s.awaiting="";await saveState(chat,s);}
 return send(chat,`${note?note+"\n\n":""}👋 ÖZGATABOT | Ürün Bilgi Merkezi\n\nÜrün adı, ölçü, UBB, katalog referansı veya SUT kodu yaz. Boşluksuz yazım ve küçük ad hataları da aranır.\n\n🔎 Örnek: pilot50 • 2.5x18 PROA • KR1088\n📌 Ürünü seç, sipariş için miktarını yaz. Siparişim menüsünde listeyi düzenleyip Abbott Excel’i alabilirsin.\n🏥 Ürün Excel/PDF çıktısında hastane veya kendim için seçeneğini kullan.\n\n⭐ Sık kullandığımız seçenekler önce gösterilir.\nKatalog v4 • 936 ürün • Sipariş\n\nHangi gruba bakalım?`,markup(
  row(["🫀 Stent","group:stent"],["🎈 Balon","group:balon"]),
  row(["〰️ Kılavuz tel","group:tel"],["📋 Seçilenler","selected"]),
  row(["🧩 Diğer ürünler","group:diger"],["📚 936 ürün","allproducts"]),
  row(["📦 Abbott siparişim","order:0"],["➡️ Seçmeden ara","skip"])
 ));
}
async function group(chat,kind){
 const names=kind==="balon"?["TREK","NC TREK NEO","ARMADA 14","ARMADA 18","ARMADA 35","VIATRAC 14 PLUS"]:
  kind==="stent"?["XIENCE PROA","XIENCE PRO 48","XIENCE PROS","SUPERA","HERCULINK","OMNILINK"]:
  kind==="tel"?["PILOT","BMW UNIVERSAL II","TURNTRAC FLEX","COMMAND","VERSATURN F","WHISPER","STEELCORE","SPARTACORE","SUPRA CORE","FLOPPY II","CROSS-IT","PROGRESS","INFILTRAC","HYDROSTEER","STANDART KILAVUZ TEL","PRESSUREWIRE X"]:
  ["PERCLOSE PROSTYLE","DRAGONFLY OPSTAR","DRAGONFLY OPTIS","DIAMONDBACK 360","AMPLATZER","PACEL"];
 const available=names.filter(n=>byFamily.has(n));
 const rows=[];for(let i=0;i<available.length;i+=2)rows.push(row(...available.slice(i,i+2).map(n=>[`${n} (${byFamily.get(n).length})`,`fam:${n}`])));
 rows.push(row(["⬅️ Geri","home"],["➡️ Geç","skip"]));
 return send(chat,"Ürün ailesini seç. İstersen herhangi bir anda ürün adını doğrudan yazabilirsin.",markup(...rows));
}
async function selected(chat){
 const s=await state(chat);if(!s.selected.length)return send(chat,"Henüz ürün seçmedin. Arama yapıp ürüne dokun, sonra ✅ Seç düğmesine bas.",markup(row(["🔎 Ara","home"],["➡️ Geç","skip"])));
 const names=s.selected.slice(0,20).map((id,i)=>`${i+1}. ${shortName(e(id))}${validQuantity(quantityOf(s,e(id)))?" — "+quantityOf(s,e(id))+" adet":""}`).join("\n");
 const more=s.selected.length>20?`\n…ve ${s.selected.length-20} ürün daha. Tümünü dosya olarak alabilirsin.`:"";
 return send(chat,`📋 Seçilenler (${s.selected.length})\n${names}${more}`,markup(
  row(["📊 Seçilenleri Excel","export:selected:xlsx"],["📕 Seçilenleri PDF","export:selected:pdf"]),
  row(["📄 Seçilenleri listele","list:selected"],["📦 Abbott siparişim","order:0"]),
  row(["🗑 Seçimleri temizle","clear"],["⬅️ Sonuçlara dön","back"])
 ));
}
async function textList(chat,scope,page=0){
 const s=await state(chat),ids=scope==="selected"?s.selected:s.results;
 if(!ids.length)return send(chat,"Liste boş. Önce ürün ara veya seç.");
 const total=Math.ceil(ids.length/20);page=Math.max(0,Math.min(page,total-1));
 const lines=ids.slice(page*20,(page+1)*20).map((id,j)=>`${page*20+j+1}. ${shortName(e(id))}`);
 const nav=[];if(page>0)nav.push(["⬅️ Önceki",`list:${scope}:${page-1}`]);if(page+1<total)nav.push(["Sonraki ➡️",`list:${scope}:${page+1}`]);
 return send(chat,`📄 ${scope==="selected"?"Seçilenler":"Arama sonuçları"} • ${page+1}/${total}\n${lines.join("\n")}`,markup(...(nav.length?[row(...nav)]:[]),row(["📊 Excel",`export:${scope}:xlsx`],["📕 PDF",`export:${scope}:pdf`]),row(["⬅️ Sonuçlara dön","back"])));
}
async function exportList(chat,scope,format){
 const s=await state(chat),ids=scope==="selected"?s.selected:s.results;
 if(!ids.length)return send(chat,"Çıktı için önce ürün ara veya seç.");
 s.awaiting="";await saveState(chat,s);
 return send(chat,`${format.toUpperCase()} dosyası kimin için?`,markup(
  row(["🏥 Hastane için",`audience:${scope}:${format}:hospital`],["👤 Kendim için",`audience:${scope}:${format}:internal`]),
  row(["⬅️ Geri",scope==="selected"?"selected":"back"])));
}
async function sendExport(chat,scope,format,audience){
 const s=await state(chat),ids=scope==="selected"?s.selected:s.results;
 if(!ids.length)return send(chat,"Liste boş. Önce ürün ara veya seç.");
 const items=ids.map(e),title=audience==="hospital"?"Ürün listesi":scope==="selected"?"Seçilen ürünler":"Arama sonuçları";
 await send(chat,`⏳ ${items.length} ürün için ${format.toUpperCase()} hazırlanıyor…`);
 const bytes=format==="xlsx"?await excel(items,audience):await pdf(items,title,audience);
 await document(chat,`OZGATA_${audience}_${new Date().toISOString().slice(0,10)}.${format}`,bytes,format==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/pdf",`${title} • ${items.length} kayıt`);
}
function quantityOf(s,p){return s.quantities[p.ref];}
async function beginQuantity(chat,id){
 const p=e(id),s=await state(chat);if(!p||!s.selected.includes(id))return send(chat,"Önce ürünü seç.");
 s.awaiting=p.ref;await saveState(chat,s);
 return send(chat,`📦 ${shortName(p)}\n\n${validQuantity(quantityOf(s,p))?"Mevcut miktar: "+quantityOf(s,p)+" adet\n":""}Sipariş miktarını adet olarak yaz. Örneğin: 5\nYeni miktar mevcut miktarın yerine geçer.`,markup(
  row(["1 adet",`setq:${id}:1`],["5 adet",`setq:${id}:5`],["10 adet",`setq:${id}:10`]),row(["➡️ Miktarı sonra gir","cancelqty"])));
}
async function setQuantity(chat,id,value){
 const p=e(id),s=await state(chat);
 if(!p||!s.selected.includes(id)||s.awaiting!==p.ref)return send(chat,"Bu miktar seçimi artık etkin değil. Sipariş menüsünden ürünü yeniden seç.",markup(row(["📦 Siparişim","order:0"])));
 if(!validQuantity(value))return send(chat,"Miktar 1–100000 arasında tam sayı olmalı. Ondalık veya sıfır miktar girme.");
 s.quantities[p.ref]=value;s.awaiting="";await saveState(chat,s);
 return send(chat,`✅ ${model(p)} • ${measurement(p)}\nRef: ${p.ref}\nMiktar: ${value} adet`,markup(row(["🔎 Ürün ekle","home"],["⬅️ Sonuçlara dön","back"]),row(["📦 Siparişim","order:0"])));
}
async function removeOrderItem(chat,id){
 const s=await state(chat),p=e(id);if(!p)return;
 s.selected=s.selected.filter(x=>x!==id);delete s.quantities[p.ref];if(s.awaiting===p.ref)s.awaiting="";
 await saveState(chat,s);return showOrder(chat,0);
}
async function showOrder(chat,page=0){
 const s=await state(chat);if(!s.selected.length)return send(chat,"Sipariş listesi boş. Bir ürün ara, seç ve miktarını gir.",markup(row(["🔎 Ürün ekle","home"])));
 const totalPages=Math.ceil(s.selected.length/8);page=Number.isFinite(page)?Math.max(0,Math.min(page,totalPages-1)):0;
 const ids=s.selected.slice(page*8,page*8+8),missing=s.selected.filter(id=>!validQuantity(quantityOf(s,e(id)))).length;
 const total=s.selected.reduce((sum,id)=>sum+(validQuantity(quantityOf(s,e(id)))?quantityOf(s,e(id)):0),0);
 const lines=ids.map((id,i)=>`${page*8+i+1}. ${shortName(e(id))}\n   Miktar: ${validQuantity(quantityOf(s,e(id)))?quantityOf(s,e(id))+" adet":"GİRİLMEDİ"}`);
 const rows=ids.map((id,i)=>row([`${page*8+i+1}. Miktarı değiştir`,`qty:${id}`],[`${page*8+i+1}. Çıkar`,`remove:${id}`]));
 const nav=[];if(page>0)nav.push(["⬅️ Önceki",`order:${page-1}`]);if(page+1<totalPages)nav.push(["Sonraki ➡️",`order:${page+1}`]);if(nav.length)rows.push(row(...nav));
 rows.push(row(["📄 Hepsini listele","orderall"],["📊 Sipariş Excel'i","orderexport"]),row(["✏️ Sipariş numarası","orderno"],["🔎 Ürün ekle","home"]),row(["🗑 Siparişi temizle","orderclearask"]));
 return send(chat,`📦 ABBOTT SİPARİŞİ\nSipariş no: ${s.orderNo||"Belirtilmedi"}\n${s.selected.length} kalem • ${total} adet${missing?" • "+missing+" kalemde miktar eksik":""}\nSayfa ${page+1}/${totalPages}\n\n${lines.join("\n\n")}`,markup(...rows));
}
async function allOrderLines(chat){
 const s=await state(chat);if(!s.selected.length)return showOrder(chat);
 let chunk="📦 ABBOTT SİPARİŞ LİSTESİ\n";
 for(const [i,id] of s.selected.entries()){
  const p=e(id),line=`${i+1}. ${shortName(p)} — ${validQuantity(quantityOf(s,p))?quantityOf(s,p)+" adet":"Miktar eksik"}\n`;
  if(chunk.length+line.length>3500){await send(chat,chunk);chunk="";}chunk+=line;
 }
 return send(chat,chunk,markup(row(["📊 Sipariş Excel'i","orderexport"],["✏️ Düzenle","order:0"])));
}
async function askOrderNo(chat,exportAfter=false){
 const s=await state(chat);s.awaiting=exportAfter?"@orderExport":"@orderNo";await saveState(chat,s);
 return send(chat,"Sipariş numarasını veya adını yaz. En fazla 60 karakter.",markup(row(["Numarasız devam",exportAfter?"ordernoneexport":"ordernone"])));
}
async function exportOrder(chat,allowNo=false){
 const s=await state(chat);if(!s.selected.length)return showOrder(chat);
 const missing=s.selected.find(id=>!validQuantity(quantityOf(s,e(id))));
 if(missing!==undefined){await send(chat,"Excel oluşturmadan önce seçili ürünlerin tüm miktarlarını tamamla.");return beginQuantity(chat,missing);}
 if(!s.orderNo&&!allowNo)return askOrderNo(chat,true);
 const items=s.selected.map(id=>({...e(id),quantity:quantityOf(s,e(id))}));
 const bytes=await orderExcel(items,s.orderNo);
 await document(chat,`OZGATA_ABBOTT_SIPARIS_${new Date().toISOString().slice(0,10)}.xlsx`,bytes,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",`Abbott sipariş listesi • ${items.length} kalem • ${items.reduce((sum,p)=>sum+p.quantity,0)} adet`);
 return send(chat,"Sipariş Excel'in hazır. Göndermeden önce listeyi kontrol edebilirsin.",markup(row(["📦 Siparişi görüntüle","order:0"],["🔎 Ürün ekle","home"])));
}
async function pendingInput(chat,text){
 const s=await state(chat);if(!s.awaiting)return false;
 if(s.awaiting.startsWith("@order")){
  if(!text.trim()||text.length>60){await send(chat,"Sipariş numarası/adı 1–60 karakter olmalı.");return true;}
  const after=s.awaiting==="@orderExport";s.orderNo=text.trim();s.awaiting="";await saveState(chat,s);
  if(after)await exportOrder(chat);else await showOrder(chat);return true;
 }
 const p=entries.find(p=>p.ref===s.awaiting);
 if(!p){s.awaiting="";await saveState(chat,s);return false;}
 if(!/^\d+$/.test(text)){await send(chat,"Bu ürün için adet bekliyorum. Örneğin 5 yaz; vazgeçmek için /iptal kullan.");return true;}
 await setQuantity(chat,p.i,Number(text));return true;
}
async function allProducts(chat){const s=await state(chat);s.results=[...entries].sort((a,b)=>Number(b.preferred)-Number(a.preferred)).map(p=>p.i);s.page=0;await saveState(chat,s);return showPage(chat,0);}
async function search(chat,q){
 const query=normalize(q).replace(/\bubb\b/g,"").trim();
 if(!query)return welcome(chat);
 if(["balloon","stent","wire","kilavuz wire"].includes(query)){
  return group(chat,query==="balloon"?"balon":query==="stent"?"stent":"tel");
 }
 const sut=query.match(/\b(?:kr|kv|gr)\s*\d{3,5}\b/);
 const effective=sut?sut[0].replace(/\s+/g,""):query;
 const scored=entries.map(p=>({p,score:rank(effective,p)})).filter(x=>x.score>0).sort((a,b)=>Number(b.p.preferred)-Number(a.p.preferred)||b.score-a.score);
 if(!scored.length)return send(chat,"Bu ifadeyle güvenilir eşleşme bulamadım. Aile adı, tam ölçü, UBB veya referans yaz.",markup(row(["🔎 Yeniden dene","home"])));
 const result=scored.map(x=>x.p.i);
 const s=await state(chat);s.results=result;s.page=0;await saveState(chat,s);
 return showPage(chat,0);
}
export default async function(req){
 if(req.method==="GET")return new Response("ÖZGATA katalog v4 • 936 ürün • Sipariş • 2026-09-29");
 if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});
 if(req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==SECRET)return new Response("Forbidden",{status:403});
 let update;
 try{
  update=await req.json();await refreshCatalog();const cb=update.callback_query;
  if(cb){
   await api("answerCallbackQuery",{callback_query_id:cb.id});
   const chat=cb.message?.chat?.id;const data=String(cb.data||"");
   if(!chat)return new Response("OK");
   if(["home","back","skip","selected","order:0"].includes(data)){const s=await state(chat);s.awaiting="";await saveState(chat,s);}
   if(data.startsWith("qty:"))await beginQuantity(chat,Number(data.slice(4)));
   else if(data.startsWith("setq:")){const [,id,value]=data.split(":");await setQuantity(chat,Number(id),Number(value));}
   else if(data.startsWith("remove:"))await removeOrderItem(chat,Number(data.slice(7)));
   else if(data.startsWith("order:"))await showOrder(chat,Number(data.slice(6)));
   else if(data==="orderall")await allOrderLines(chat);
   else if(data==="orderexport")await exportOrder(chat);
   else if(data==="orderno")await askOrderNo(chat);
   else if(data==="ordernone"||data==="ordernoneexport"){const s=await state(chat);s.orderNo="";s.awaiting="";await saveState(chat,s);if(data==="ordernoneexport")await exportOrder(chat,true);else await showOrder(chat);}
   else if(data==="cancelqty"){const s=await state(chat);s.awaiting="";await saveState(chat,s);await send(chat,"Ürün seçili kaldı. Miktarını Siparişim menüsünden girebilirsin.",markup(row(["📦 Siparişim","order:0"],["🔎 Ara","home"])));}
   else if(data==="orderclearask")await send(chat,"Seçili ürünler ve sipariş miktarları temizlensin mi?",markup(row(["Evet, temizle","orderclear"],["Vazgeç","order:0"])));
   else if(data==="orderclear"){const s=await state(chat);s.selected=[];s.quantities={};s.awaiting="";s.orderNo="";await saveState(chat,s);await showOrder(chat);}
   else if(data.startsWith("audience:")){const [,scope,format,audience]=data.split(":");if(["all","selected"].includes(scope)&&["xlsx","pdf"].includes(format)&&["hospital","internal"].includes(audience))await sendExport(chat,scope,format,audience);}
   else if(data.startsWith("i3:")){
    const p=entries[Number(data.slice(3))];
    if(p){const s=await state(chat),chosen=s.selected.includes(p.i);
      await send(chat,`📦 ${shortName(p)}\n\nÜrün: ${p.name}\nKategori: ${family(p)}\nÖlçü: ${measurement(p)||"Listede belirtilmemiş"}\nUBB: ${p.ubb}\nKatalog Ref: ${p.ref}\nSUT: ${p.sut||p.sutStatus||"Listede belirtilmemiş"}\nMarka: ${p.brand||"Listede belirtilmemiş"}${p.dmo?"\nDMO: "+p.dmo:""}${p.description?"\n\nAçıklama: "+p.description:""}${p.description2?"\n"+p.description2:""}${p.sutName?"\nSUT açıklaması: "+p.sutName:""}${p.note?"\n\n⚠️ Kontrol notu: "+p.note:""}`,markup(
       row([chosen?"❎ Seçimden çıkar":"✅ Seç",`pick3:${p.i}`],["➡️ Geç",`pg:${s.page}`]),
       ...(chosen?[row(["🔢 Sipariş miktarı",`qty:${p.i}`])]:[]),
       row([`📋 Seçilenler (${s.selected.length})`,"selected"],["⬅️ Sonuçlara dön","back"])
      ));}
   }else if(data.startsWith("pick3:")){
    const id=Number(data.slice(6)),s=await state(chat);if(!entries[id])return new Response("OK");
    if(s.selected.includes(id)){s.selected=s.selected.filter(x=>x!==id);delete s.quantities[e(id).ref];if(s.awaiting===e(id).ref)s.awaiting="";await saveState(chat,s);await send(chat,"Ürün seçimden çıkarıldı.",markup(row(["⬅️ Sonuçlar","back"],["📦 Siparişim","order:0"])));}
    else{s.selected.push(id);await saveState(chat,s);await beginQuantity(chat,id);}
   }else if(data.startsWith("pg:"))await showPage(chat,Number(data.slice(3)));
   else if(data.startsWith("fam:")){
    const name=data.slice(4),items=byFamily.get(name)||[];const s=await state(chat);
    s.results=items.map(p=>p.i);s.page=0;await saveState(chat,s);await showPage(chat,0);
   }else if(data.startsWith("group:"))await group(chat,data.slice(6));
   else if(data==="allproducts")await allProducts(chat);
   else if(data==="home")await welcome(chat);
   else if(data==="skip")await send(chat,"Tamam, ürün adını, ölçüsünü, UBB'sini, referansını veya SUT kodunu yaz. Örn: pilot50");
   else if(data==="back")await showPage(chat,(await state(chat)).page);
   else if(data==="selected")await selected(chat);
   else if(data==="clear"){
    const s=await state(chat);s.selected=[];s.quantities={};s.awaiting="";s.orderNo="";await saveState(chat,s);await selected(chat);
   }else if(data.startsWith("list:")){
    const [,scope,page]=data.split(":");await textList(chat,scope,Number(page||0));
   }else if(data.startsWith("export:")){
    const [,scope,format]=data.split(":");if(["all","selected"].includes(scope)&&["xlsx","pdf"].includes(format))await exportList(chat,scope,format);
   }
  }else if(update.message?.chat?.id){
   const chat=update.message.chat.id;const text=String(update.message.text||"").trim();
   if(text==="/iptal"){const s=await state(chat);s.awaiting="";await saveState(chat,s);await welcome(chat,"Miktar/numara girişi iptal edildi.");}
   else if(text&&!text.startsWith("/")&&await pendingInput(chat,text)){}
   else if(text==="/siparis")await showOrder(chat);
   else if(text==="/siparisexcel")await exportOrder(chat);
   else if(text==="/siparisno")await askOrderNo(chat);
   else if(update.message.document)await send(chat,"Bu sürümde onaylı ürün kataloğu kullanılıyor. Dosyadan talep okuma henüz etkin değil. Ürün adı, ölçü, UBB veya referans yazabilirsin.");
   else if(text==="/kimlik")await send(chat,`Telegram kullanıcı kimliğin: ${update.message.from?.id||"bulunamadı"}`);
   else if(text==="/urunler")await allProducts(chat);
   else if(text==="/start"||text==="/yardim")await welcome(chat);
   else if(text==="/liste"||text==="/secimler")await selected(chat);
   else if(text==="/excel")await exportList(chat,"all","xlsx");
   else if(text==="/pdf")await exportList(chat,"all","pdf");
   else if(text)await search(chat,text);
   else await welcome(chat,"Şimdilik metin araması yapıyorum.");
  }
  return new Response("OK");
 }catch(err){
  console.error(err);
  const chat=update?.callback_query?.message?.chat?.id||update?.message?.chat?.id;
  if(chat)try{await send(chat,"İşlem tamamlanamadı. Lütfen tekrar dene; sürerse bot yöneticisine bildir.");}catch(error){console.error(error);}
  return new Response("OK");
 }
}
