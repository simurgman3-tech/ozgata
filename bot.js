import { products } from "./products.js";
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
const familyWords=["pilot","proa","pros","trek","xience","mini","neo","armada","viatrac","amplatzer","supera","bmw"];
function distance(a,b){
 if(Math.abs(a.length-b.length)>2)return 3;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;
 }return prev[b.length];
}
function queryText(input){
 return normalize(input).replace(/([a-z])(\d)/g,"$1 $2").split(/(\s+)/).map(token=>{
  if(!/^[a-z]{4,}$/.test(token)||familyWords.includes(token))return token;
  const matches=familyWords.filter(w=>distance(token,w)<=1);
  return matches.length===1?matches[0]:token;
 }).join("");
}
const entries=products.map((p,i)=>({...p,i,n:normalize(p.name),g:normalize(p.group),r:normalize(p.ref)}));
const families=[
  ["XIENCE PROA","xience proa"],["XIENCE PROS","xience pros"],
  ["XIENCE SIERRA","xience sierra"],["XIENCE ALPINE","xience alpine"],
  ["MINI TREK","mini trek"],["NC TREK NEO","nc trek neo"],["NC TREK","nc trek"],
  ["TREK","trek"],["ARMADA","armada"],["VIATRAC","viatrac"],
  ["PILOT 50","pilot 50"],["PILOT 150","pilot 150"],["PILOT 200","pilot 200"],["PILOT","pilot"],["BMW","balance middleweight"],
  ["SUPERA","supera"],["AMPLATZER","amplatzer"]
];
function family(p) {
  for(const [label,key] of families) if(p.n.includes(key)) return label;
  return p.n.split(/\s+/).slice(0,2).join(" ").toUpperCase();
}
const byFamily=new Map();
for(const p of entries){const f=family(p);byFamily.set(f,[...(byFamily.get(f)||[]),p]);}
async function api(method,body) {
 const res=await fetch(API+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const data=await res.json();if(!data.ok) throw new Error(method+": "+data.description);return data.result;
}
const buttons=(items)=>({inline_keyboard:items.map(x=>[x])});
const send=(chat_id,text,reply_markup)=>api("sendMessage",{chat_id,text,reply_markup,link_preview_options:{is_disabled:true}});
const PER_PAGE=7;
const stateTable=sqlite.execute("CREATE TABLE IF NOT EXISTS ozgata_catalog_state(chat_id TEXT PRIMARY KEY, results TEXT NOT NULL, selected TEXT NOT NULL, page INTEGER NOT NULL)");
async function state(chat){
 await stateTable;
 const r=await sqlite.execute({sql:"SELECT results,selected,page FROM ozgata_catalog_state WHERE chat_id=?",args:[String(chat)]});
 const row=r.rows[0];return row?{results:JSON.parse(row.results),selected:JSON.parse(row.selected),page:Number(row.page)}:{results:[],selected:[],page:0};
}
async function saveState(chat,s){
 await stateTable;
 await sqlite.execute({sql:"INSERT INTO ozgata_catalog_state(chat_id,results,selected,page) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET results=excluded.results,selected=excluded.selected,page=excluded.page",args:[String(chat),JSON.stringify(s.results),JSON.stringify(s.selected),s.page]});
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
async function excel(items){
 const zip=new JSZip();const fields=["Ürün Adı","UBB","Katalog Referansı","SUT Kodları","Kaynak"];
 const lines=[fields,...items.map(p=>[p.name,p.ubb,p.ref,p.sut,p.source])];
 const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="65" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="22" customWidth="1"/><col min="4" max="4" width="25" customWidth="1"/><col min="5" max="5" width="28" customWidth="1"/></cols><sheetData>${lines.map((line,i)=>`<row r="${i+1}">${line.map((val,j)=>`<c r="${"ABCDE"[j]}${i+1}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:E${lines.length}"/></worksheet>`;
 zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
 zip.file("_rels/.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
 zip.file("xl/workbook.xml",`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ürün Listesi" sheetId="1" r:id="rId1"/></sheets></workbook>`);
 zip.file("xl/_rels/workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
 zip.file("xl/worksheets/sheet1.xml",xml);
 return await zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
}
async function pdf(items,title){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const response=await fetch(new URL("./font.ttf",import.meta.url));if(!response.ok)throw new Error("PDF font indirilemedi");
 const font=await pdf.embedFont(await response.arrayBuffer(),{subset:true});
 const cut=(t,max)=>{let s=String(t||"");while(font.widthOfTextAtSize(s,9)>max&&s.length)s=s.slice(0,-1);return s===t?s:s+"…";};
 let page,y,pageNo=0;function newPage(){page=pdf.addPage([842,595]);pageNo++;y=550;page.drawRectangle({x:0,y:565,width:842,height:30,color:rgb(.08,.16,.28)});page.drawText("ÖZGATA | "+title,{x:30,y:575,font,size:12,color:rgb(1,1,1)});}
 newPage();for(const [index,p] of items.entries()){
  if(y<45)newPage();
  if(index%2===0)page.drawRectangle({x:25,y:y-12,width:790,height:32,color:rgb(.95,.97,.99)});
  page.drawText(cut(`${index+1}. ${p.name}`,750),{x:33,y:y+4,font,size:9,color:rgb(.07,.17,.29)});
  page.drawText(cut(`UBB: ${p.ubb}    Ref: ${p.ref}    SUT: ${p.sut||"Belirtilmemiş"}`,750),{x:33,y:y-10,font,size:8,color:rgb(.28,.33,.4)});
  y-=35;
 }
 return await pdf.save();
}
function size(q){return q.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*[x×]\s*(\d{1,3})\b/i);}
function rank(q,p){
 const raw=normalize(q),s=queryText(q),compact=raw.replace(/\s+/g,"");
 if(p.ubb===raw.replace(/\D/g,""))return 10000;
 if(p.r===raw || p.r.replace(/[^a-z0-9]/g,"")===compact.replace(/[^a-z0-9]/g,""))return 9000;
 if(normalize(p.sut).split(" / ").includes(raw.replace(/\s+/g,"")))return 8000;
 let score=0;
 const terms=s.split(/\s+/).filter(Boolean);
 const dims=size(s);const needle=dims&&`${Number(dims[1].replace(",","."))}x${Number(dims[2])}`;
 const pd=p.n.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:mm)?\s*[x×]\s*(\d{1,3})\s*(?:mm)?/);
 const productSize=pd&&`${Number(pd[1].replace(",","."))}x${Number(pd[2])}`;
 if(needle && productSize!==needle)return -1;
 if(needle)score+=100;
 const length=s.match(/\b(190|300|145|150|135|80)\s*cm\b/);
 if(length && !p.n.includes(length[1]+" cm") && !p.n.includes(length[1]+"cm"))return -1;
 if(length)score+=60;
 for(const t of terms){
  if(["mm","cm","x","wire","stent","balloon","urun","ubb","sut","kodu"].includes(t))continue;
  if(dims && t.includes("x"))continue;
  if(/^\d+$/.test(t) && !new RegExp(`(^|\\D)${t}(\\D|$)`).test(p.n))return -1;
  if(p.n.includes(t))score+=t.length>=4?24:8;
  else if(p.r.includes(t))score+=18;
  else if(t.length>=4 && p.g.includes(t))score+=4;
  else if(/\d/.test(t) && !(dims && (t===dims[1]||t===dims[2])) && !(length && t===length[1]))return -1;
  else if(t.length>=4)return -1;
 }
 return score;
}
function shortName(p){
 const f=family(p),dim=p.name.match(/\b\d+(?:[.,]\d+)?\s*(?:mm)?\s*[x×]\s*\d+\s*mm\b/i);
 const cm=p.name.match(/\b(\d{2,3})\s*cm\b/ig);
 const tip=/\bJ TIP\b/i.test(p.name)?"J uç":/\bSTRAIGHT TIP\b/i.test(p.name)?"Düz uç":"";
 const variant=/\bWIRELESS\b/i.test(p.name)?"Kablosuz":/\bCABLED\b/i.test(p.name)?"Kablolu":"";
 return [f,variant,dim?.[0],cm?.at(-1),tip,p.ref].filter(Boolean).join(" · ").slice(0,64);
}
async function showPage(chat,page=0){
 const s=await state(chat);if(!s.results.length)return welcome(chat,"Önce bir ürün veya aile ara.");
 const total=Math.ceil(s.results.length/PER_PAGE);s.page=Math.max(0,Math.min(page,total-1));await saveState(chat,s);
 const shown=s.results.slice(s.page*PER_PAGE,(s.page+1)*PER_PAGE).map(e);
 const rows=shown.map(p=>row([shortName(p),`i:${p.i}`]));
 const nav=[];if(s.page>0)nav.push(["⬅️ Önceki",`pg:${s.page-1}`]);
 if(s.page+1<total)nav.push(["Sonraki ➡️",`pg:${s.page+1}`]);if(nav.length)rows.push(row(...nav));
 rows.push(row([`📋 Seçilenler (${s.selected.length})`,"selected"],["📄 Tümünü listele","list:all"]));
 rows.push(row(["📊 Excel","export:all:xlsx"],["📕 PDF","export:all:pdf"]));
 rows.push(row(["🔎 Yeni arama","home"]));
 return send(chat,`🔎 ${s.results.length} ürün bulundu\nSayfa ${s.page+1}/${total} • Gösterilen ${s.page*PER_PAGE+1}–${s.page*PER_PAGE+shown.length}\nBir ürüne dokunup ayrıntısını gör ve seç.`,markup(...rows));
}
async function welcome(chat,note=""){
 return send(chat,`${note?note+"\n\n":""}👋 ÖZGATABOT'a hoş geldin!\n\nÜrün adı, ölçü, UBB, katalog referansı veya SUT kodu yaz. Boşluksuz yazım ve küçük ad hataları da aranır.\n\n🔎 Örnek: pilot50 • 2.5x18 PROA • KR1088\n📌 Ürüne dokunup seçebilir, seçtiklerini listeleyebilir veya tüm sonuçları Excel/PDF olarak alabilirsin.\n\nHangi gruba bakalım?`,markup(
  row(["🫀 Stent","group:stent"],["🎈 Balon","group:balon"]),
  row(["〰️ Kılavuz tel","group:tel"],["📋 Seçilenler","selected"]),
  row(["➡️ Seçmeden ara","skip"])
 ));
}
async function group(chat,kind){
 const names=kind==="balon"?["MINI TREK","TREK","NC TREK","NC TREK NEO","ARMADA","VIATRAC"]:
  kind==="stent"?["XIENCE PROA","XIENCE PROS","XIENCE SIERRA","XIENCE ALPINE","SUPERA"]:
  ["PILOT 50","PILOT 150","PILOT 200","BMW"];
 const available=names.filter(n=>byFamily.has(n));
 const rows=[];for(let i=0;i<available.length;i+=2)rows.push(row(...available.slice(i,i+2).map(n=>[`${n} (${byFamily.get(n).length})`,`fam:${n}`])));
 rows.push(row(["⬅️ Geri","home"],["➡️ Geç","skip"]));
 return send(chat,"Ürün ailesini seç. İstersen herhangi bir anda ürün adını doğrudan yazabilirsin.",markup(...rows));
}
async function selected(chat){
 const s=await state(chat);if(!s.selected.length)return send(chat,"Henüz ürün seçmedin. Arama yapıp ürüne dokun, sonra ✅ Seç düğmesine bas.",markup(row(["🔎 Ara","home"],["➡️ Geç","skip"])));
 const names=s.selected.slice(0,20).map((id,i)=>`${i+1}. ${shortName(e(id))}`).join("\n");
 const more=s.selected.length>20?`\n…ve ${s.selected.length-20} ürün daha. Tümünü dosya olarak alabilirsin.`:"";
 return send(chat,`📋 Seçilenler (${s.selected.length})\n${names}${more}`,markup(
  row(["📊 Seçilenleri Excel","export:selected:xlsx"],["📕 Seçilenleri PDF","export:selected:pdf"]),
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
 const items=ids.map(e);const title=scope==="selected"?"Seçilen ürünler":"Arama sonuçları";
 await send(chat,`⏳ ${items.length} ürün için ${format.toUpperCase()} hazırlanıyor…`);
 const bytes=format==="xlsx"?await excel(items):await pdf(items,title);
 await document(chat,`OZGATA_${scope}_${new Date().toISOString().slice(0,10)}.${format}`,bytes,format==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/pdf",`${title} • ${items.length} kayıt`);
}
async function search(chat,q){
 const query=normalize(q).replace(/\bubb\b/g,"").trim();
 if(!query)return welcome(chat);
 if(["balloon","stent","wire","kilavuz wire"].includes(query)){
  return group(chat,query==="balloon"?"balon":query==="stent"?"stent":"tel");
 }
 const sut=query.match(/\b(?:kr|kv|gr)\s*\d{3,5}\b/);
 const effective=sut?sut[0].replace(/\s+/g,""):query;
 const scored=entries.map(p=>({p,score:rank(effective,p)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 if(!scored.length)return send(chat,"Bu ifadeyle güvenilir eşleşme bulamadım. Aile adı, tam ölçü, UBB veya referans yaz.",markup(row(["🔎 Yeniden dene","home"])));
 const top=scored[0].score;
 const result=scored.filter(x=>x.score>=Math.max(top-35,1)).map(x=>x.p.i);
 const s=await state(chat);s.results=result;s.page=0;await saveState(chat,s);
 return showPage(chat,0);
}
export default async function(req){
 if(req.method==="GET")return new Response("ÖZGATA ürün kataloğu botu çalışıyor.");
 if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});
 if(req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==SECRET)return new Response("Forbidden",{status:403});
 let update;
 try{
  update=await req.json();const cb=update.callback_query;
  if(cb){
   await api("answerCallbackQuery",{callback_query_id:cb.id});
   const chat=cb.message?.chat?.id;const data=String(cb.data||"");
   if(!chat)return new Response("OK");
   if(data.startsWith("i:")){
    const p=entries[Number(data.slice(2))];
    if(p){const s=await state(chat),chosen=s.selected.includes(p.i);
      await send(chat,`📦 ${p.name}\n\nAile: ${family(p)}\nUBB: ${p.ubb}\nKatalog Ref: ${p.ref}\nSUT: ${p.sut||"Listede belirtilmemiş"}\nKaynak: ${p.source}\n\nBu katalog stok miktarı içermez.`,markup(
       row([chosen?"❎ Seçimden çıkar":"✅ Seç",`pick:${p.i}`],["➡️ Geç",`pg:${s.page}`]),
       row([`📋 Seçilenler (${s.selected.length})`,"selected"],["⬅️ Sonuçlara dön","back"])
      ));}
   }else if(data.startsWith("pick:")){
    const id=Number(data.slice(5)),s=await state(chat);if(!entries[id])return new Response("OK");
    s.selected=s.selected.includes(id)?s.selected.filter(x=>x!==id):[...s.selected,id];await saveState(chat,s);
    await send(chat,`${s.selected.includes(id)?"✅ Listeye eklendi":"❎ Listeden çıkarıldı"}: ${shortName(e(id))}`,markup(row(["➡️ Devam",`pg:${s.page}`],["📋 Seçilenler","selected"])));
   }else if(data.startsWith("pg:"))await showPage(chat,Number(data.slice(3)));
   else if(data.startsWith("fam:")){
    const name=data.slice(4),items=byFamily.get(name)||[];const s=await state(chat);
    s.results=items.map(p=>p.i);s.page=0;await saveState(chat,s);await showPage(chat,0);
   }else if(data.startsWith("group:"))await group(chat,data.slice(6));
   else if(data==="home")await welcome(chat);
   else if(data==="skip")await send(chat,"Tamam, ürün adını, ölçüsünü, UBB'sini, referansını veya SUT kodunu yaz. Örn: pilot50");
   else if(data==="back")await showPage(chat,(await state(chat)).page);
   else if(data==="selected")await selected(chat);
   else if(data==="clear"){
    const s=await state(chat);s.selected=[];await saveState(chat,s);await selected(chat);
   }else if(data.startsWith("list:")){
    const [,scope,page]=data.split(":");await textList(chat,scope,Number(page||0));
   }else if(data.startsWith("export:")){
    const [,scope,format]=data.split(":");if(["all","selected"].includes(scope)&&["xlsx","pdf"].includes(format))await exportList(chat,scope,format);
   }
  }else if(update.message?.chat?.id){
   const chat=update.message.chat.id;const text=String(update.message.text||"").trim();
   if(text==="/start"||text==="/yardim")await welcome(chat);
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

